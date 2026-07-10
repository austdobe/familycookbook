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
| `RecipePicker` in `src/main.jsx` | Recipe search, category filters, quick-time filter, drag source. |
| `GroceryView` in `src/main.jsx` | Grocery snapshot rendering, manual edits, Have It state. |
| `PrepView` in `src/main.jsx` | Prep checklist rendering and edits. |
| `RecipeFeedbackPanel` in `src/main.jsx` | Cooked count, ratings, notes, promotion controls. |
| `RecipeImportDialog` in `src/components/RecipeImportDialog.jsx` | Add/edit recipe dialog, OCR import, OCR cleanup. |
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

## Data Flow

1. `scripts/build-app-data.js` builds `public/data/cookbook.json` from Markdown.
2. `App` loads `cookbook.json` as seed/fallback data.
3. Firebase subscriptions replace or augment seed data when configured.
4. Week planning selects recipe archive docs from Firebase recipes or generated Markdown recipes.
5. Saving week rows regenerates grocery and prep snapshots.
6. Grocery/prep edits update the snapshot for that week, not the source recipe.
7. Sealing a week prevents accidental changes to week rows, grocery, prep, and checklist state.

## Grocery Generation Notes

Grocery generation currently lives in `src/main.jsx`. It parses recipe ingredient tables and applies display-oriented normalization:

- merge duplicate item names;
- keep recipe ownership;
- combine compatible quantities;
- normalize regular onions into whole onions;
- normalize garlic cloves into bulbs above the threshold;
- normalize can/cup quantities for can-friendly items;
- keep green onions separate from regular onions.

This logic should eventually move into a shared grocery engine module so scripts and app behavior match.

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
