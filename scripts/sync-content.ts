/**
 * sync-content.ts
 *
 * Reads the beginner lab markdown from the stepup-labs submodule and writes a
 * Starlight-ready copy into src/content/docs/postgres/, injecting the frontmatter
 * Starlight requires (the source files have none). It also emits an explicit
 * sidebar (src/sidebar.generated.json) so modules read Concepts -> Build -> Use
 * -> Survive instead of raw alphabetical order.
 *
 * Source of truth stays the submodule - this output is generated and gitignored.
 * Run: `npm run sync`  (or `npm run sync:watch`)
 */
import { readFileSync, writeFileSync, copyFileSync, rmSync, mkdirSync, readdirSync, statSync, watch } from 'node:fs';
import { dirname, join, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = join(ROOT, 'vendor', 'stepup-labs', 'labs', 'postgres');
const OUT_DIR = join(ROOT, 'src', 'content', 'docs', 'postgres');
const SIDEBAR_FILE = join(ROOT, 'src', 'sidebar.generated.json');
const URL_BASE = '/postgres';

/** Section folders get a human label and a fixed teaching order. */
const SECTIONS: Record<string, { label: string; order: number }> = {
  concepts: { label: 'Concepts', order: 1 },
  build: { label: 'Build', order: 2 },
  use: { label: 'Use', order: 3 },
  survive: { label: 'Survive', order: 4 },
};

type SidebarLink = { label: string; link: string };
type SidebarGroup = { label: string; items: SidebarItem[] };
type SidebarItem = SidebarLink | SidebarGroup;

/** Turn "module09-backup-pitr" -> "Module 09 - Backup Pitr", "01-server-prep" -> "Server Prep". */
function humanize(name: string): string {
  const moduleMatch = name.match(/^module(\d+)-(.+)$/);
  if (moduleMatch) {
    return `Module ${moduleMatch[1]} - ${titleCase(moduleMatch[2]!.replace(/-/g, ' '))}`;
  }
  return titleCase(name.replace(/^\d+[-_]/, '').replace(/[-_]/g, ' '));
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Leading numeric prefix of a filename drives order within a group. */
function numericPrefix(name: string): number {
  const m = name.match(/^(\d+)/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** JSON string is valid YAML - safe for titles containing ':' or quotes. */
function yamlString(s: string): string {
  return JSON.stringify(s);
}

/**
 * Derive a page title: first markdown H1, else humanized filename
 * (README -> parent folder name). Returns the title and the body with that
 * leading H1 removed (Starlight renders the frontmatter title as the page H1).
 */
function deriveTitle(raw: string, filePath: string): { title: string; body: string } {
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i++;
  const first = lines[i];
  if (first && /^#\s+/.test(first)) {
    const title = first.replace(/^#\s+/, '').trim();
    const rest = lines.slice(i + 1);
    while (rest.length && rest[0]!.trim() === '') rest.shift();
    return { title, body: rest.join('\n') };
  }
  const base = basename(filePath).replace(/\.md$/i, '');
  const fallback = /^readme$/i.test(base)
    ? humanize(basename(dirname(filePath)))
    : humanize(base);
  return { title: fallback, body: raw };
}

/** Lowercase the output path so the file path matches Starlight's slug. */
function outRelPath(relPath: string): string {
  return relPath.toLowerCase();
}

/** stat that tolerates broken symlinks (some lab folders contain dangling links). */
function safeIsDir(path: string): boolean {
  const s = statSync(path, { throwIfNoEntry: false });
  return s?.isDirectory() ?? false;
}

const ASSET_RE = /\.(png|jpe?g|gif|svg|webp|avif)$/i;

// Survive scenarios ship as inject.sh + runbook.md + validate.sh. We render the
// scripts as read-only code pages so students can see what breaks and how it's checked.
const SCRIPT_RE = /\.(sh|py|sql)$/i;
const SCRIPT_LANG: Record<string, string> = { sh: 'bash', py: 'python', sql: 'sql' };
// Reading order within a survive scenario.
const SURVIVE_STEM_ORDER: Record<string, number> = { inject: 1, runbook: 2, validate: 3 };

/** True when a path sits anywhere under a `survive/` folder. */
function inSurvive(fullPath: string): boolean {
  return relative(SRC_DIR, fullPath).split(/[\\/]/).includes('survive');
}

/** Output path for a rendered script page: foo.sh -> foo-sh.md (lowercased). */
function scriptOutRel(relPath: string): string {
  return outRelPath(relPath).replace(SCRIPT_RE, (_m, ext: string) => `-${ext.toLowerCase()}.md`);
}

/** Wrap a script's contents in a fenced code block as a Starlight page. */
function renderScriptPage(filePath: string): { title: string; markdown: string } {
  const title = basename(filePath);
  const ext = title.split('.').pop()!.toLowerCase();
  const lang = SCRIPT_LANG[ext] ?? '';
  const code = readFileSync(filePath, 'utf8');
  // Four-backtick fence survives any triple-backticks inside the script.
  const body = `\n\`\`\`\`${lang}\n${code}\n\`\`\`\`\n`;
  return { title, markdown: `---\ntitle: ${yamlString(title)}\n---\n${body}` };
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (safeIsDir(full)) out.push(...walkMarkdown(full));
    else if (/\.md$/i.test(entry)) out.push(full);
  }
  return out;
}

/** Copy image assets so relative ![](...) links in the markdown resolve. */
function walkAssets(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (safeIsDir(full)) out.push(...walkAssets(full));
    else if (ASSET_RE.test(entry)) out.push(full);
  }
  return out;
}

/** Collect survive scripts (rendered as code pages) across the tree. */
function walkSurviveScripts(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (safeIsDir(full)) out.push(...walkSurviveScripts(full));
    else if (SCRIPT_RE.test(entry) && inSurvive(full)) out.push(full);
  }
  return out;
}

/** Order key for a file: README first, then survive inject/runbook/validate, then prefix. */
function fileOrder(name: string, under: boolean): number {
  if (/^readme\.md$/i.test(name)) return -1;
  if (under) {
    const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
    const s = SURVIVE_STEM_ORDER[stem];
    if (s !== undefined) return s;
  }
  return numericPrefix(name);
}

/** Build the sidebar tree for one directory, recursing into subfolders. */
function buildItems(dir: string): SidebarItem[] {
  const under = inSurvive(dir);
  const entries = readdirSync(dir).map((name) => {
    const full = join(dir, name);
    return { name, full, isDir: safeIsDir(full) };
  });

  const ranked = entries
    .map((e) => {
      if (e.isDir) {
        const items = buildItems(e.full);
        if (items.length === 0) return null; // skip folders with no renderable content
        const section = SECTIONS[e.name.toLowerCase()];
        const order = section ? section.order : numericPrefix(e.name);
        const label = section ? section.label : humanize(e.name);
        return { order, label, node: { label, items } as SidebarGroup };
      }
      const isMd = /\.md$/i.test(e.name);
      const isScript = SCRIPT_RE.test(e.name) && under;
      if (!isMd && !isScript) return null;
      const isReadme = /^readme\.md$/i.test(e.name);
      const relPath = relative(SRC_DIR, e.full);
      const slug = isScript
        ? `${URL_BASE}/${scriptOutRel(relPath).replace(/\.md$/i, '')}/`
        : `${URL_BASE}/${outRelPath(relPath).replace(/\.md$/i, '')}/`;
      const label = isReadme ? 'Overview' : isScript ? e.name : readMeta(e.full).title;
      return {
        order: fileOrder(e.name, under),
        label,
        node: { label, link: slug } as SidebarLink,
      };
    })
    .filter((x): x is { order: number; label: string; node: SidebarItem } => x !== null);

  ranked.sort((a, b) => (a.order - b.order) || a.label.localeCompare(b.label));
  return ranked.map((r) => r.node);
}

const metaCache = new Map<string, { title: string }>();
function readMeta(filePath: string): { title: string } {
  const cached = metaCache.get(filePath);
  if (cached) return cached;
  const { title } = deriveTitle(readFileSync(filePath, 'utf8'), filePath);
  const meta = { title };
  metaCache.set(filePath, meta);
  return meta;
}

function generate(): void {
  metaCache.clear();
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const files = walkMarkdown(SRC_DIR);
  for (const file of files) {
    const raw = readFileSync(file, 'utf8');
    const { title, body } = deriveTitle(raw, file);
    metaCache.set(file, { title });
    const relPath = outRelPath(relative(SRC_DIR, file));
    const outPath = join(OUT_DIR, relPath);
    mkdirSync(dirname(outPath), { recursive: true });
    const frontmatter = `---\ntitle: ${yamlString(title)}\n---\n\n`;
    writeFileSync(outPath, frontmatter + body);
  }

  const scripts = walkSurviveScripts(SRC_DIR);
  for (const script of scripts) {
    const { markdown } = renderScriptPage(script);
    const outPath = join(OUT_DIR, scriptOutRel(relative(SRC_DIR, script)));
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown);
  }

  const assets = walkAssets(SRC_DIR);
  for (const asset of assets) {
    const outPath = join(OUT_DIR, outRelPath(relative(SRC_DIR, asset)));
    mkdirSync(dirname(outPath), { recursive: true });
    copyFileSync(asset, outPath);
  }

  const sidebar: SidebarItem[] = buildItems(SRC_DIR);
  writeFileSync(SIDEBAR_FILE, JSON.stringify(sidebar, null, 2));
  console.log(
    `synced ${files.length} pages + ${scripts.length} survive scripts, ${assets.length} assets -> ${relative(ROOT, OUT_DIR)}`,
  );
}

generate();

if (process.argv.includes('--watch')) {
  console.log('watching for changes in stepup-labs/labs/postgres ...');
  let timer: NodeJS.Timeout | undefined;
  watch(SRC_DIR, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        generate();
      } catch (err) {
        console.error('sync failed:', err instanceof Error ? err.message : err);
      }
    }, 150);
  });
}
