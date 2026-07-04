# Family Cookbook

This is a Markdown-based family cookbook and meal planning system. It is designed for planning weekly dinners, capturing draft recipes, reviewing what actually worked, and promoting only proven keepers into polished binder recipes.

## Core Workflow

1. Create new generated recipes as Stage 1 drafts in `recipe-archive/drafts/`.
2. Use the Recipes tab in the app to create or edit a planning week from archived draft recipes.
3. Use the generated working week to build the weekly menu, grocery list, and prep guide.
4. Cook the meal and complete a recipe review.
5. Move approved recipes into the archive, adding family ratings, version notes, and any changes.
6. Promote the recipe to Stage 2 only if the family would make it again.

## Family Preferences

- Protein-forward meals should be the default.
- Use international variety across the week so meals do not feel repetitive.
- Schedule perishability-first: seafood, delicate produce, and fresh herbs should be used early.
- Grocery specifications should be clear enough for another person to shop from.
- Use arrowroot instead of cornstarch unless a recipe specifically requires cornstarch.

## Main Folders

- `templates/` - reusable Markdown templates for recipes, menus, grocery lists, prep guides, and reviews.
- `weekly-plans/2026/week-[number]/` - committed weekly packets and any explicit week-local files.
- `recipe-archive/drafts/` - default home for generated Stage 1 draft recipes before review or promotion.
- `recipe-archive/promoted/` - Stage 2 recipes before category filing or for cross-category keeper lists.
- `recipe-archive/breakfast/`, `lunches/`, `beef/`, `chicken/`, `pork/`, `seafood/`, `sides/`, `sauces/`, `desserts/` - organized promoted recipes.
- `planning/` - standing notes, rules, backlog ideas, substitutions, pantry notes, and lessons learned.
- `scripts/` - optional JavaScript helpers from the original project.

## Recipe Stages

### Stage 1: Draft Recipe

Stage 1 recipes are planning drafts. New generated drafts live in `recipe-archive/drafts/` so they can be reused across working weekly menus. They need enough detail to shop and cook once, but they do not need binder-level polish.

Required sections:

- Recipe name
- Servings
- Equipment
- Ingredients with quantities
- Basic instructions
- Notes

### Stage 2: Promoted Binder Recipe

Stage 2 recipes are keepers. These should be clear enough for a tired beginner to cook successfully.

Required sections:

- Overview
- Equipment
- Before you start
- Detailed beginner-friendly instructions
- Visual cues
- Doneness indicators
- Serving notes
- Storage
- Reheating
- Version history
- Family notes

## Grocery Rules

Grocery lists are recipe-driven only. Assume nothing is on hand. Do not add household staples unless a recipe explicitly uses them.

Each grocery item should include:

- Quantity
- Preferred version or type
- Acceptable alternatives
- Which recipe uses the item

## Prep Rules

Prep guides should be organized into:

- Sunday Dinner Support
- Future Meal Prep
- Protein Thaw Schedule
- Wednesday Refresh
- Do Not Prep Ahead

Every prep task should be actionable and include ingredients, instructions, storage method, use-by date, and meal ownership.

## Suggested Weekly Packet Naming

Use this folder and packet naming pattern:

```text
weekly-plans/2026/week-04/week-04-family-cookbook-packet.md
```

## Print Exports

Markdown files are the editable source. To create print-styled PDFs and matching HTML files for every Markdown file in a weekly folder, run:

```text
npm run export:pdf -- weekly-plans/2026/week-28
```

The default output path mirrors the source file under `exports/`, for example:

```text
exports/weekly-plans/2026/week-28/pdf/week-28-family-cookbook-packet.pdf
exports/weekly-plans/2026/week-28/html/week-28-family-cookbook-packet.html
```

If PowerShell blocks `npm`, use `npm.cmd` instead:

```text
npm.cmd run export:pdf -- weekly-plans/2026/week-28
```

You can still export a single Markdown file by passing the file path:

```text
npm.cmd run export:pdf -- weekly-plans/2026/week-28/week-28-family-cookbook-packet.md
```

## Web App And PWA

The cookbook also has a React PWA. It reads generated data from the Markdown files, so Markdown stays the source of truth.

Rebuild the app data after editing recipes, weekly packets, or planning notes:

```text
npm.cmd run build:app
```

Run the local app:

```text
npm.cmd run app
```

Then open:

```text
http://localhost:4173
```

The app includes weekly meal plans, recipes, grocery lists, prep guides, planning notes, a PWA manifest, and a service worker for install/offline support. For hosting, run `npm.cmd run build` and publish the `dist/` folder.

Deploy to GitHub Pages from your machine:

```text
npm.cmd run deploy:pages
```

That command builds with the `/familycookbook/` base path and pushes the generated `dist/` contents to the `gh-pages` branch. No GitHub Actions secrets are required.

### Shared Firebase State

The React app can use Firebase for shared weekly planning, grocery, prep, and recipe feedback state. Copy `.env.example` to `.env` and fill in the Firebase web app values:

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_HOUSEHOLD_ID=family
```

If Firebase is not configured, working weeks, grocery checks, manual grocery additions, prep checks, and recipe feedback fall back to this device only.

Deploy Firestore rules after changing `firestore.rules`:

```text
firebase.cmd deploy --only firestore:rules
```

Seed Markdown weekly packets into Firebase:

```text
npm.cmd run migrate:firebase
```

The migration writes Markdown week menus, grocery sections, prep sections, and the week picker index into Firestore while preserving app-created planning weeks.

### Apply Recipe Feedback To Markdown

The hosted PWA stores live ratings and notes separately from Markdown. To write approved feedback into a recipe file as a new version entry, run:

```text
npm.cmd run apply:feedback -- --file weekly-plans/2026/week-28/greek-chicken-gyro-bowls.md --version 2.0 --rating 5/5 --notes "Family liked the sauce amount" --change "Added family rating and notes"
```
