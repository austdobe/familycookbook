# App Architecture

## Runtime Surface

The current app is the Vite/React app:

- Entry HTML: `index.html`
- React entry: `src/main.jsx`
- Shared app CSS: `src/styles.css`
- Base/shared static CSS: `public/styles.css`
- Generated fallback data: `public/data/cookbook.json`

Legacy static files remain under `public/index.html` and `public/app.js`. Treat them as legacy unless a task explicitly targets them.

## Main React Views

The sidebar routes are defined by the `views` array in `src/main.jsx`.

| View | Main responsibility |
|---|---|
| Week | Plan and edit weekly menu cards, assign recipes, seal/unseal weeks, view selected recipe. |
| Recipes | Browse recipe library, add/edit recipes, import recipe photos/text. |
| Grocery | Shop from generated/editable grocery snapshots. |
| Prep | Work through generated/editable prep snapshots. |

## Important Components And Functions

| Code | Responsibility |
|---|---|
| `App` in `src/main.jsx` | App shell, global data loading, topbar actions, Firebase sync. |
| `WeekView` in `src/main.jsx` | Weekly menu cards, edit mode, drag/drop, week sealing. |
| `RecipePicker` in `src/components/RecipePicker.jsx` | Recipe search, category filters, quick-time filter, drag source. |
| `GroceryView` in `src/components/GroceryView.jsx` | Grocery snapshot rendering, manual edits, Have It state. |
| `PrepView` in `src/components/PrepView.jsx` | Prep checklist rendering and edits. |
| `RecipeFeedbackPanel` in `src/main.jsx` | Cooked count, ratings, notes, promotion controls. |
| `RecipeImportDialog` in `src/components/RecipeImportDialog.jsx` | Add/edit recipe dialog, OCR import, OCR cleanup. |
| `cleanRecipeOcrText` in `src/domain/recipeOcr.js` | Shared OCR cleanup and canonical recipe Markdown generation. |
| `markdownToHtml` in `src/services/markdown.js` | Markdown rendering for app recipe docs. |

## Service Modules

| Service | Responsibility |
|---|---|
| `src/services/firebase.js` | Firebase initialization and anonymous auth. |
| `src/services/recipeStore.js` | Subscribe/save/sync recipe records. Converts structured recipes to archive-doc shape for rendering. |
| `src/services/workingWeeksStore.js` | Subscribe/save/delete working week index and week documents. |
| `src/services/weekPlanStore.js` | Subscribe/save/delete/sync weekly plan rows and sealed state. |
| `src/services/groceryStore.js` | Subscribe/save/delete/sync grocery snapshots and checked state. |
| `src/services/prepStore.js` | Subscribe/save/delete/sync prep snapshots and checked state. |
| `src/services/recipeFeedbackStore.js` | Subscribe/save recipe feedback. |
| `src/services/units.js` | Quantity display conversions. |
| `src/domain/listReconciliation.js` | Stable grocery/prep identities and state-preserving regeneration. |
| `src/domain/groceryEngine.js` | Grocery aggregation, category assignment, quantity merging, shopping normalization, and sorting. |
| `src/domain/plannedMeals.js` | Complete, composed, hybrid, and legacy meal-component resolution. |
| `src/domain/prepSnapshot.js` | Prep task edits, additions, removals, and regeneration reconciliation. |
| `src/domain/prepEngine.js` | Recipe-owned prep task generation, scheduling, storage guidance, and checklist flattening. |
| `src/domain/recipeMarkdown.js` | Canonical recipe Markdown normalization, parsing, and recipe save payloads. |
| `src/domain/recipeOcr.js` | OCR cleanup and canonical Markdown generation from recipe images. |

## Data Flow

1. `scripts/build-app-data.js` builds `public/data/cookbook.json` from Markdown.
2. `App` loads `cookbook.json` as seed/fallback data.
3. Firebase subscriptions replace or augment seed data when configured.
4. Week planning selects recipe archive docs from Firebase recipes or generated Markdown recipes.
5. Saving week rows regenerates grocery and prep snapshots.
6. Grocery/prep edits update the snapshot for that week, not the source recipe.
7. Sealing a week prevents accidental changes to week rows, grocery, prep, and checklist state.

Generated list rows use semantic identities rather than array positions. When a meal changes, regeneration reconciles the new grocery/prep output with the previous snapshot so unchanged checks and manual grocery rows survive. Prep snapshots also retain manual additions, edited tasks, and explicit removals across regeneration. `snapshotVersion: 1` distinguishes an intentionally empty checklist from missing state; `generatedSections` records its baseline and `prepEdits` records the user overrides. Stable task identities are serialized as hidden `prep-key` comments so changing a title or section does not change checkbox/edit identity. Legacy snapshots migrate on their next edit or regeneration, not on read. A unique generated title/meal pair retains its identity when rescheduled to another section; ambiguous matches are not guessed.

## Grocery Generation Notes

Grocery generation lives in `src/domain/groceryEngine.js`. It consumes parsed recipe ingredients and applies display-oriented normalization:

- merge duplicate item names;
- keep recipe ownership;
- combine compatible quantities;
- normalize regular onions into whole onions;
- normalize garlic cloves into bulbs above the threshold;
- normalize can/cup quantities for can-friendly items;
- keep green onions separate from regular onions.

The React app uses this module directly. Export scripts should use the same engine when Firebase-backed working-week export is implemented.

## Markdown Rendering

The app renderer is `src/services/markdown.js`. It supports:

- headings;
- paragraphs;
- basic inline Markdown;
- ordered/unordered lists;
- tables;
- ingredient table classes;
- collapsible recipe Ingredients sections.

PDF export uses separate rendering code in `scripts/export-pdf.js`. Keep this mismatch in mind when changing Markdown display.

## Batch and Leftover Planning

Working-week rows may carry `planKind`, stable `batchId`, `batchServings`, `dinnerServings`, `leftoverOfBatchId`, and `leftoverStorage`. Legacy rows keep their original yield. Linked leftover nights resolve the current cooking row, do not add ingredients or cooking prep twice, and become visibly unresolved if their source is cleared. `batchPlanning.js` scales each component against its own explicit recipe yield and flags ambiguous quantities/yields for review rather than guessing. Recipe ingredient tables scale; written directions intentionally retain original quantities and carry a warning.

`batchPlanEditing.js` validates UI edits without changing other rows. Warnings cover insufficient portions, orphan/duplicate links, leftovers before cooking, and refrigerator storage beyond four days. These are planning reminders, not automatic food-safety guarantees. Frozen leftovers get thaw/reheat reminders.

## Cloud Save Feedback

All mutable stores use `cloudWrite.js` and `syncStatus.js` for saving/local-only/error/synced feedback and explicit retry. Unsent immutable write payloads persist in local storage; newer edits supersede/coalesce pending writes. Pending local edits are protected from cloud reads. Related working-week index/document updates use an atomic batch. A stalled cloud request releases the UI after eight seconds without starting overlapping retries.

This is not cross-device conflict resolution: successful writes remain last-write-wins. A subscription initially opened offline stays local until refresh; after retry the UI advises refreshing to pick up other-device changes. Local storage remains necessary for offline durability.


## Grocery Override Preservation

Regeneration now keeps a generated baseline separate from grocery field overrides and removed source identities. Custom specifications, renamed items, category moves and manually changed quantities survive batch saves and Update Lists; untouched quantities still regenerate from current batch sizes. Legacy lists are compared with their previous generated baseline when available. The initial app and per-week views wait for their matching subscriptions before showing empty states or editing controls. Weekly counts separate flexible placeholders from cooking and linked-leftover nights.


## Explicit List Drafts

Meal assignment, batch size, leftover links, clearing and reordering now save the plan only. They do not regenerate or write grocery/prep snapshots. The menu action Generate draft lists computes reconciled proposed snapshots without saving them and shows additions, changes and removals. Apply draft lists is the only generation write path; Cancel discards the in-memory draft. Direct list editing/checking remains independent.

Before applying, the app re-reads both list snapshots and rejects stale drafts if the plan, recipes or list data changed. List editing is hidden while reviewing. Saves use existing local-first stores and expose cloud save status. If one local save fails, the message identifies partial success and requires a fresh preview before retrying. This is not a cross-device transaction: a remote change racing after the final check can still conflict with last-write-wins storage. Drafts are not persisted across reloads.

Draft generation and Apply require fresh server reads when Firebase is configured, and refuse to proceed while local writes are pending or cloud access fails. This deliberately limits offline regeneration; direct list editing remains local-first. Working-week display never generates fallback lists implicitly.

## Guided Start Cooking

Start Cooking coordinates every recipe attached to the selected meal. It recommends the next dependency-ready step, favoring the longest comparable recipe estimate; when durations are incomplete it keeps mains first, then the selected component order. Starting an active step pauses other suggestions until the user finishes it or explicitly marks it hands-off. Parallel work never implies that food can be left unattended. Steps are never completed by a timer. Done/already-done, confirmed Skip, Undo, and a confirmed session reset are available.

The full timeline preserves each recipe's dependency order, not a precise oven/equipment schedule. Only one unambiguous recipe duration is parsed; missing/conditional timing remains unknown. An optional serving target is a visible reminder rather than a promised finish time. Shared oven/pan conflicts and make-ahead work require review. Saved weekly prep is available read-only inside preflight; it is not automatically matched or checked off by cooking actions.

Progress and ingredient checks are local to this browser/device, keyed by week/card/batch plus content-sensitive task IDs. Recipe or portion changes start a separate session rather than silently carrying completion to changed directions. Cooking progress does not write recipes, menu data, or shared prep/grocery state. Linked leftover nights show storage/reheat guidance instead of starting another cooking batch.

### Touch-first guided cooking refinement
The cooking dialog foregrounds one next-action card, with ingredient, prep/timing, and full-progress sections collapsed by default. Touch targets are at least 48px. More options holds already-done/started and skip controls; step changes move keyboard focus to the next-action heading. A dish selector allows an intentional override without bypassing recipe dependencies.

Component role and explicit recipe timing summaries are passed to the planner. Unknown durations are not zero: when component times are incomparable, mains precede sides in the chosen component order and the UI discloses that this is not a longest-cook calculation. Conditional stuffed/unstuffed roast ranges remain unknown. Earlier-day prep is never assumed complete merely because it was scheduled; the user can mark completed steps already done. The prep reference is still read-only and not semantically linked to recipe steps.

Cooking headers now recognize exact component-title projections and use a compact meal label instead. Named meals and single-dish titles are preserved. The fixed header is capped at two title lines; full names and component lists remain available through Meal details below the action. This is presentation-only and does not rename stored meals or affect progress keys.

### Optional composed-meal names
Build from Components and hybrid meals offer an optional meal-name field. `customMealName` is a backward-compatible row field: missing means legacy name inference; an explicit empty string means the owner cleared the name and wants the dynamic day fallback. Weekly cards, Start Cooking, and leftover labels use the same resolver. An unnamed Thursday composition displays “Thursday's meal”; no lunch/dinner slots are inferred. Custom card labels use “Meal for <card>”. Complete single-recipe titles are unchanged. Component edits preserve the custom name; clearing/replacing the meal clears naming state. Stored recipe documents are never renamed. Existing legacy names are interpreted without background migration writes, and the existing weekly plan store persists the additional row field.
