# App Functionality Audit

Date: 2026-07-05  
Scope: React app, Firebase/Firestore state, Node scripts, generated app data, Markdown recipes, weekly packets, and planning docs.

## Executive Summary

The app is usable for browsing weekly packets, browsing archive recipes, creating Firebase-backed working weeks from archived recipes, checking grocery/prep items, adding manual grocery items, and capturing recipe feedback.

The biggest gap is source-of-truth alignment. The documented workflow now says Stage 1 recipes live in `recipe-archive/<category>/`, but committed weekly folders still contain recipe copies for week 28 and week 29. The generated app data therefore has both archive recipes and week-local recipes, and the week view can show the week-local version while feedback/sync workflows may target an archive version.

The second biggest gap is that the app cannot write recipe or weekly packet Markdown. It can save operational state to Firebase, but final cookbook artifacts still require scripts or manual Codex edits.

The third biggest gap is that Firestore is treated as a shared operational store, but the rules allow unrestricted read/write to the `family` household. This is convenient for a private prototype, but not safe for a hosted app unless access is otherwise controlled.

## Current Implemented Capabilities

### Markdown and Build Data

- `scripts/build-app-data.js` reads `weekly-plans/`, `recipe-archive/`, `recipes/`, and `planning/`, then writes `public/data/cookbook.json`.
- Generated data currently includes:
  - 2 weekly plans.
  - 21 archived recipes.
  - 7 planning docs.
  - 0 archived recipe paths under `recipe-archive/drafts`.
- Markdown weekly packet parsing supports:
  - date range parsing from `Week of: ... through ...`;
  - weekly menu tables;
  - grocery sections;
  - prep sections;
  - weekly recipe files inside week folders.

### React App

- Main app views: Week, Recipes, Grocery, Prep.
- Week view:
  - merges generated Markdown weeks with app-created Firebase working weeks;
  - shows weekly menu cards;
  - renders selected recipe Markdown;
  - displays recipe feedback controls.
- Recipes view:
  - groups archive recipes by folder;
  - renders selected archive recipe;
  - can create or edit a Firebase working week by assigning archive recipes to days.
- Grocery view:
  - displays recipe-driven grocery sections;
  - supports simple/detailed ingredient views;
  - supports US/metric display for simple quantities;
  - supports checking items;
  - supports manual grocery adds/edits/removals;
  - moves checked items into a "Have It" section.
- Prep view:
  - renders prep sections as checkable tasks when Markdown checklist syntax is present;
  - supports clearing prep checks.

### Firebase and Local Fallback

- Firebase client uses anonymous auth when env vars are present.
- Every operational store falls back to localStorage when Firebase is missing or unavailable.
- Firestore collections currently used:
  - `households/{householdId}/workingWeeks/index`
  - `households/{householdId}/weeks/{weekId}`
  - `households/{householdId}/weeklyPlans/{weekId}`
  - `households/{householdId}/groceryWeeks/{weekId}`
  - `households/{householdId}/prepWeeks/{weekId}`
  - `households/{householdId}/recipeFeedback/{recipeId}`

### Scripts

- `npm.cmd run build:app`: rebuilds generated app data.
- `npm.cmd run build`: rebuilds generated data and Vite app.
- `npm.cmd run migrate:firebase -- --dry-run`: confirms Markdown weeks can be converted into Firebase snapshots.
- `npm.cmd run export:pdf -- <weekly-folder>`: exports Markdown to print HTML/PDF.
- `npm.cmd run apply:feedback`: applies passed feedback args to a Markdown recipe.
- `npm.cmd run sync:feedback`: pulls feedback from Firestore and applies it to Markdown recipe files.

## High-Priority Missing Functionality

### 1. Source-of-truth cleanup for weekly recipe copies

Problem: The archive now contains Stage 1 recipes by category, but week folders still contain duplicate recipe files for several recipes. The app loads both:

- `weekly-plans/2026/week-28/lentil-lettuce-wraps.md`
- `recipe-archive/lunches/lentil-lettuce-wraps.md`
- seven week 29 recipes duplicated between `weekly-plans/2026/week-29/` and `recipe-archive/<category>/`

Impact:

- Week view may show a week-local recipe copy while Recipes view shows the archive copy.
- Feedback saved against one copy may not apply to the other.
- Grocery generation from working weeks uses archive recipe paths, while committed Markdown weeks still have local recipe files.
- Future edits can drift between duplicate files.

Missing:

- A canonical decision for committed weekly packets:
  - Option A: weekly packets link to archive recipe paths only.
  - Option B: weekly packets intentionally snapshot recipes, and the archive is separate.
- A cleanup script or one-time migration to remove week-local duplicates once packets point to archive paths.
- App logic that can resolve `Recipe path` in committed Markdown weekly menus, not only filename matching.

Recommended next step:

1. Update week 28 and week 29 packet recipe tables to include archive paths.
2. Remove duplicate week-local recipe files after confirming packet links resolve.
3. Rebuild `public/data/cookbook.json`.

### 2. App cannot create or edit recipe Markdown

Problem: The workflow says recipes are Markdown-first, but the React app cannot create a Stage 1 recipe, edit a recipe body, or save Markdown changes.

Impact:

- ChatGPT/Codex can add recipes, but the app itself cannot.
- Recipe feedback is saved separately and then requires `apply:feedback` or `sync:feedback`.
- A non-technical user cannot complete the full cookbook workflow inside the app.

Missing:

- New recipe form that writes Markdown or stages a Markdown patch.
- Recipe editor for title, status, category, planning summary, equipment, ingredient table, instructions, notes, review link.
- Category-aware file placement under `recipe-archive/<category>/`.
- Guardrails for Stage 2 promotion checklist.

Recommended next step:

Build a "New Stage 1 Recipe" flow that creates a structured recipe object first, then exports Markdown. If the browser cannot write files directly, generate a downloadable Markdown file or a Codex-ready patch request.

### 3. App-created working weeks do not produce committed Markdown packets

Problem: The app can create Firebase working weeks, but there is no script or UI action to turn a working week into the committed weekly Markdown packet/folder.

Impact:

- Firebase contains planning state, but the Markdown source of truth is not automatically updated.
- A week created in the app can remain invisible to the repo unless manually recreated.
- Grocery/prep snapshots can diverge from Markdown packets.

Missing:

- Export Firebase working week to `weekly-plans/2026/week-[number]/week-[number]-family-cookbook-packet.md`.
- Export selected recipe references into packet tables.
- Optionally export grocery/prep snapshots into Markdown.
- Clear status showing whether a week is "working only" or "committed to Markdown".

Recommended next step:

Add a `scripts/export-working-week.js` command that reads `weeks/{weekId}` or `workingWeeks/index` and writes a Markdown packet using `templates/weekly-menu.md` plus grocery/prep sections.

### 4. Firestore rules are too permissive for hosted use

Problem: `firestore.rules` allows read/write whenever `householdId == "family"`. Anonymous users who can reach the Firebase project can potentially read/write family data.

Impact:

- Grocery, prep, working-week, and feedback state are not protected by user identity.
- Anyone with project config could write to the `family` household.

Missing:

- Auth-based household membership checks.
- Rules that require `request.auth != null`.
- Per-user or per-household membership document.
- Possibly App Check if hosted publicly.

Recommended next step:

Require authenticated users and a household membership document, even if only one household exists.

## Medium-Priority Missing Functionality

### 5. Recipe index script ignores the real archive

Problem: `scripts/index-recipes.js` indexes only `recipes/`, not `recipe-archive/`. `recipe-index.md` currently shows only `Sunday Pancakes`.

Impact:

- The generated recipe index is stale and misleading.
- The new category archive is not reflected.

Missing:

- Index all `recipe-archive/` category folders.
- Include recipe status, category, and path.
- Optionally include `recipes/` legacy recipes too.

Recommended next step:

Update `scripts/index-recipes.js` to scan both `recipes/` and `recipe-archive/`, then regenerate `recipe-index.md`.

### 6. Planning docs are generated but not visible in the React app

Problem: `build-app-data.js` includes `planningDocs`, and the legacy `public/app.js` has a Planning view, but the React app only exposes Week, Recipes, Grocery, and Prep.

Impact:

- Pantry notes, prep rules, substitution notes, grocery rules, and lessons learned are invisible in the current app.
- The user cannot easily consult standing rules from the PWA.

Missing:

- Planning tab in React.
- Planning docs list/detail view.
- Search results that include planning docs in a visible way.

Recommended next step:

Port the legacy Planning view into React and add it to the sidebar.

### 7. Grocery generation is useful but not fully rule-aware

Problem: Working-week grocery generation parses recipe ingredient tables and uses heuristic category assignment. It does not fully enforce the cookbook grocery rules.

Impact:

- Grocery categories can be wrong for edge cases.
- Quantities merge only when strings are identical or plain numbers.
- "1 can" plus "1/2 can" becomes `1 can + 1/2 can`, not a normalized total.
- Manual grocery additions can violate "recipe-driven only" without warning.
- There is no "assume nothing is on hand" validation beyond using recipe ingredient tables.

Missing:

- Strong quantity parser with units, package sizes, and fractional amounts.
- Recipe ownership validation for manual items.
- Rule checks for staples/household items.
- Category override map.
- Store-friendly consolidation without losing recipe ownership.

Recommended next step:

Create a shared grocery engine module used by both React and scripts, then add validations/warnings instead of only display logic.

### 8. Prep generation is too generic for app-created weeks

Problem: `buildPrepSectionsFromMenuRows` creates one generic task per meal rather than using recipe-specific prep notes, perishability notes, or thaw logic.

Impact:

- App-created weeks are less useful than hand-written weekly packets.
- Protein thaw schedule, Wednesday refresh, and do-not-prep-ahead logic are not generated in the app.

Missing:

- Parse recipe notes such as prep-ahead ideas and perishability notes.
- Generate protein thaw schedule.
- Generate Sunday prep, Wednesday refresh, and do-not-prep-ahead sections.
- Allow user edits to prep snapshot before saving.

Recommended next step:

Build a prep-generation module that reads recipe planning summary and notes, then produces the standard prep sections.

### 9. Feedback workflow is split between app and scripts

Problem: The app saves feedback to Firestore/localStorage, but Markdown updates require a CLI script.

Impact:

- Family ratings and recipe changes are easy to enter but easy to forget to apply.
- There is no in-app "applied to Markdown" status.
- If a recipe path changes, stored feedback may point to the old path.

Missing:

- In-app feedback status: unsynced, synced, applied to Markdown.
- A feedback review queue.
- Path migration or lookup by stable recipe id.
- Script support for choosing next version number automatically.

Recommended next step:

Add a "Feedback Queue" view and extend `sync:feedback` to mark feedback as applied after writing Markdown.

### 10. Markdown rendering differs across app and PDF export

Problem: React uses `src/services/markdown.js`; PDF export uses its own Markdown renderer in `scripts/export-pdf.js`.

Impact:

- Checklists, lists with details, links, tables, and ingredient display can render differently in app versus printed packet.
- Fixes must be made in two renderers.

Missing:

- Shared Markdown rendering module for app and export.
- Visual regression check for exported packets.

Recommended next step:

Extract a shared Markdown parser/renderer or use a small Markdown library consistently in both places.

## Lower-Priority Missing Functionality

### 11. Legacy static app files may be confusing

Problem: `public/index.html` and `public/app.js` represent a non-React static app, while Vite uses root `index.html` and `src/main.jsx`.

Impact:

- `npm.cmd run serve:app` serves `public/index.html`, which is not the same surface as the Vite React app.
- The legacy app has a Planning tab that React lacks.
- Feature parity is unclear.

Missing:

- Decision: keep static app as a fallback or remove it.
- If kept, make sure it is feature-aligned with React.
- If removed, update `serve:app` and docs to avoid serving stale UI.

Recommended next step:

Use Vite preview as the only app surface, or explicitly label `public/app.js` as legacy.

### 12. PWA/offline cache is basic

Problem: service worker caches app shell and `cookbook.json`, then cache-falls-back for GET requests.

Impact:

- Offline behavior exists, but there is no user-visible sync/offline status.
- Firebase writes while offline rely on fallback/local behavior, not a clear sync queue.
- Cache version is manual.

Missing:

- Online/offline indicator.
- Pending write status.
- Cache version automation from package version.
- Clear "data last built" versus "Firebase latest state" messaging.

### 13. Search is basic

Problem: Search filters current view content only. It does not provide global results across weeks, archive recipes, groceries, prep, and planning docs.

Impact:

- Searching for an ingredient or recipe can miss relevant planning docs or another view.

Missing:

- Global search results grouped by source.
- Ingredient-specific search across recipe tables.
- Filter by category, stage, cuisine, protein, review status.

### 14. No promotion workflow in app

Problem: Stage 2 promotion is documented but not implemented in React.

Impact:

- The app cannot enforce the promotion checklist.
- It cannot convert a Stage 1 recipe to Stage 2 format.
- It cannot move/mark recipes as keepers.

Missing:

- Promotion checklist UI.
- Stage 2 template generator.
- Version history and family notes workflow.
- Status transition from Stage 1 to Stage 2.

### 15. No validation command for cookbook rules

Problem: There is no automated validator for recipe/packet structure.

Impact:

- Broken ingredient tables, missing recipe ownership, missing preferred alternatives, and stale weekly links can slip in.

Missing:

- `npm.cmd run validate` or similar.
- Checks for required Stage 1/Stage 2 sections.
- Checks for grocery row fields.
- Checks that weekly packet recipe files resolve.
- Checks for duplicate recipe files across week folders and archive.

## Data Model Gaps

### Recipe Identity

Current:

- App ids are derived from file paths.
- Feedback docs are keyed by encoded recipe id.
- Feedback stores `recipePath`.

Missing:

- Stable recipe id independent of file path.
- Slug/title/category metadata layer.
- Path migration handling.

Why it matters:

Moving a recipe between folders changes its id, which can orphan feedback.

### Week Identity

Current:

- Markdown weeks use ids like `2026-week-29`.
- App-created weeks use ids like `planning-2026-week-30`.
- Firebase migration writes Markdown weeks into the same working week index used by app-created weeks.

Missing:

- Clear distinction between committed weeks and working weeks.
- Lifecycle states: working, committed, archived, superseded.
- Export path from working to committed.

### Grocery Snapshots

Current:

- Markdown packet grocery sections are parsed.
- App-created weeks generate grocery sections from recipe ingredient tables.
- Firebase stores grocery snapshots and checked/manual state separately.

Missing:

- Single canonical grocery item shape shared across Markdown parser, React, and migration script.
- Snapshot versioning.
- "Regenerate from recipes" action with diff preview.

### Prep Snapshots

Current:

- Markdown prep sections parse checklist tasks.
- App-created weeks generate generic prep tasks.
- Firebase stores checked state.

Missing:

- Structured prep task schema in Markdown or frontmatter.
- Regenerate/diff workflow.
- Recipe-specific prep hints.

## Firebase/Firestore Gaps

- No membership/auth checks beyond household id string.
- No schema validation in rules.
- No write restrictions by collection or field.
- No server timestamp enforcement.
- No conflict resolution beyond last-write-wins.
- No "applied feedback" marker.
- No deletion/archive flow for obsolete working weeks.
- `firebase.json` deploys rules only; hosting is not configured there even though README mentions GitHub Pages deployment.

## Script Gaps

- `index-recipes.js` is obsolete for the new archive.
- `apply-recipe-feedback.js` accepts args but does not read a local feedback queue file.
- `sync-recipe-feedback.js` can apply Firestore feedback but does not mark it as applied.
- `migrate-week-lists-to-firebase.js` does not delete stale Firebase snapshots for removed Markdown weeks.
- `export-pdf.js` duplicates Markdown rendering logic from React.
- No script exports Firebase working weeks back to Markdown.
- No script validates weekly packet links against archive paths.

## React UX Gaps

- No Planning tab in the current React app.
- No create/edit recipe flow.
- No edit weekly packet text flow.
- No committed-vs-working week status.
- No export/commit working week button.
- No feedback queue.
- No promotion workflow.
- No duplicate recipe warning.
- No Firebase connection status beyond generic copy.
- No error UI for failed `cookbook.json` load.
- No way to hide or archive old working weeks.
- No direct print/export action from the app.

## Recommended Implementation Order

1. Resolve source-of-truth duplication.
   - Update weekly packet rows to use archive recipe paths.
   - Remove week-local duplicate recipes or explicitly mark them as snapshots.
   - Add validation for duplicate filenames across weekly folders and archive.

2. Update recipe index and validation.
   - Make `index-recipes.js` scan `recipe-archive/`.
   - Add `npm.cmd run validate` for required sections, grocery fields, recipe links, and duplicate paths.

3. Restore planning docs in React.
   - Add Planning tab.
   - Render `planningDocs`.
   - Include planning docs in global search.

4. Build working-week to Markdown export.
   - Read Firebase or local working week.
   - Write committed weekly packet Markdown.
   - Mark week as committed.

5. Harden Firebase.
   - Require `request.auth != null`.
   - Add household membership rules.
   - Add applied feedback status and basic schema checks.

6. Build recipe creation/editing.
   - Start with Stage 1 recipe creation.
   - Add category placement and required-field validation.
   - Later add Stage 2 promotion workflow.

7. Improve grocery and prep generation.
   - Shared grocery engine.
   - Better quantity parsing.
   - Prep sections based on recipe metadata.

## Verification Performed

- `npm.cmd run build` passed.
- `npm.cmd run migrate:firebase -- --dry-run` passed.
- `public/data/cookbook.json` currently reports:
  - 2 weeks.
  - 21 archived recipes.
  - 7 planning docs.
- Duplicate filename check found 8 week-local recipe copies that also exist in the archive.
- Scan found no remaining `recipe-archive/drafts` references in active docs/data after the previous migration.
