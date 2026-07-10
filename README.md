# Family Cookbook

Family Cookbook is a private recipe, weekly meal planning, grocery, and prep app for family use.

The current product is app-first for live editing and planning. Firebase is the shared live store when configured, with localStorage fallback. Markdown remains useful for seed data, human-readable archive, exports, templates, and Codex-assisted maintenance.

## Documentation Map

Use these docs as the current source of truth:

- Product context and user workflows: `docs/product-context.md`
- Source-of-truth model: `docs/source-of-truth.md`
- React app architecture: `docs/app-architecture.md`
- Commands and operations: `docs/operations.md`
- Cookbook operating rules for agents: `AGENTS.md`
- Grocery rules: `planning/grocery-rules.md`
- Prep rules: `planning/prep-rules.md`
- Reusable Markdown formats: `templates/`

Historical audits and migration plans live in `planning/`. Treat them as context, not current operating docs, unless a current doc links to them directly.

## App Surface

Current app:

- `index.html`
- `src/main.jsx`
- `src/styles.css`
- `public/styles.css`

Legacy static app files still exist under `public/index.html` and `public/app.js`. Do not treat them as the primary app unless a task explicitly targets the legacy surface.

## Common Commands

Run local dev:

```text
npm.cmd run dev
```

Build:

```text
npm.cmd run build
```

Deploy GitHub Pages:

```text
npm.cmd run deploy:pages
```

Export weekly Markdown to print HTML/PDF:

```text
npm.cmd run export:pdf -- weekly-plans/2026/week-28
```

More commands are documented in `docs/operations.md`.

## Main Folders

- `src/` - React app and app services.
- `public/` - static assets, generated cookbook data, PWA files, and OCR assets.
- `recipe-archive/` - Markdown recipe archive and import/export source.
- `weekly-plans/` - committed weekly packet snapshots.
- `planning/` - standing rules, notes, audits, and migration plans.
- `templates/` - reusable Markdown formats.
- `scripts/` - build, export, migration, import, and feedback scripts.
- `docs/` - current product, architecture, source-of-truth, and operations docs.

## Maintenance Rule

Do not duplicate rules across docs. Link to the owning file:

- Product behavior: `docs/product-context.md`
- Data ownership: `docs/source-of-truth.md`
- App implementation map: `docs/app-architecture.md`
- Commands: `docs/operations.md`
- Recipe/process rules: `AGENTS.md`, `PROCESS.md`, `planning/`, and `templates/`
