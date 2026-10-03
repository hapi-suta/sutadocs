# SUTA Labs Docs

A documentation website for the SUTA Labs database curriculum. Left sidebar of
topics and subtopics, right side with the detailed, server-tested steps students
follow.

Built with [Starlight](https://starlight.astro.build) (Astro). The lab content is
**not** stored here - it lives in the [`stepup-labs`](https://github.com/hapi-suta/stepup-labs)
repo, pulled in as a git submodule. A sync script turns that markdown into
Starlight pages, so you keep editing labs where you already do.

## How it works

```
sutadocs/
├── vendor/stepup-labs/          git submodule (the lab content, single source of truth)
├── scripts/sync-content.ts      injects frontmatter, derives titles, builds the sidebar,
│                                 renders survive scripts as code pages
├── src/content/docs/postgres/   GENERATED - do not hand-edit (gitignored)
├── src/content/docs/index.mdx   landing page
├── src/sidebar.generated.json   GENERATED sidebar (gitignored)
└── astro.config.mjs
```

The sync step is required because the source lab files have no frontmatter, which
Starlight needs. `title` comes from each file's first `# H1` (falling back to the
filename). Modules are ordered Concepts -> Build -> Use -> Survive.

## Develop

```bash
git clone --recurse-submodules <this-repo-url>
cd sutadocs
npm install
npm run dev          # sync + live server at http://localhost:4321
```

Already cloned without submodules? Run `git submodule update --init --recursive`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Sync content, then start the dev server |
| `npm run sync` | Regenerate pages + sidebar from the submodule once |
| `npm run sync:watch` | Re-sync automatically as you edit the labs |
| `npm run build` | Sync, then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |

### Editing content

Edit the markdown in `vendor/stepup-labs/labs/postgres/...` (or in your main
`stepup-labs` checkout, then update the submodule here). Run `npm run sync` and the
site reflects it. Never edit `src/content/docs/postgres/` - it is overwritten on
every sync.

To pull the latest labs into the site:

```bash
git submodule update --remote vendor/stepup-labs
npm run sync
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. One-time
setup: in the repo, go to **Settings -> Pages -> Build and deployment -> Source** and
choose **GitHub Actions**.

- **Default (project page):** publishes to `https://<owner>.github.io/<repo>/`. The
  workflow sets `SITE`/`BASE` for you - nothing else to do.
- **Custom domain (e.g. `docs.yourdomain.com`):** add a DNS `CNAME` record pointing
  the subdomain at `<owner>.github.io`, set the domain under **Settings -> Pages**,
  and in `deploy.yml` set `SITE` to `https://docs.yourdomain.com` and `BASE` to `/`.
  Add a `public/CNAME` file containing just the domain so it survives deploys.
- **User/org page (`<owner>.github.io` repo):** set `BASE` to `/`.

## Scope

v1 covers the PostgreSQL modules. Other engines (EDB, MySQL, MongoDB, SQL Server,
AWS RDS, etc.) exist in `stepup-labs` and can be added the same way.
