# Source Of Truth

This repo has three kinds of data. Do not treat every file as equally authoritative.

## Live App Data

Firebase is the live source of truth when configured. Each store mirrors Firebase into localStorage for responsiveness and offline/fallback behavior.

| Data | Firebase path | Local fallback | Owning code |
|---|---|---|---|
| Recipes | `households/{householdId}/recipes/{recipeId}` | `familyCookbook:recipes:v1` | `src/services/recipeStore.js` |
| Working week index | `households/{householdId}/workingWeeks/index` | `familyCookbook:workingWeeks:v1` | `src/services/workingWeeksStore.js` |
| Week documents | `households/{householdId}/weeks/{weekId}` | working week index mirror | `src/services/workingWeeksStore.js` |
| Weekly plan state | `households/{householdId}/weeklyPlans/{weekId}` | `familyCookbook:weekPlan:v1:{weekId}` | `src/services/weekPlanStore.js` |
| Grocery snapshot/checks | `households/{householdId}/groceryWeeks/{weekId}` | `familyCookbook:grocery:v2:{weekId}` | `src/services/groceryStore.js` |
| Prep snapshot/checks | `households/{householdId}/prepWeeks/{weekId}` | `familyCookbook:prep:v1:{weekId}` | `src/services/prepStore.js` |
| Recipe feedback | `households/{householdId}/recipeFeedback/{recipeId}` | `familyCookbook:recipeFeedback:v1:{recipeId}` | `src/services/recipeFeedbackStore.js` |

The app exposes a Sync action that pulls Firebase state into local mirrors for recipes, working weeks, weekly plans, grocery, and prep.

## Markdown Source Files

Markdown remains important, but its role depends on the file type.

| Path | Role |
|---|---|
| `recipe-archive/<category>/*.md` | Seed/import/export recipe archive and human-readable backup. |
| `weekly-plans/2026/week-*/*.md` | Committed historical packets and exports. Do not assume these are the live working week state. |
| `planning/*.md` | Standing planning rules and notes. |
| `templates/*.md` | Canonical Markdown formats for generated/exported documents. |
| `AGENTS.md` | Agent operating rules and promotion constraints. |

When docs need rule detail, link to the specific source file instead of copying the rule text.

## Generated Files

| Path | Owner | Commit policy |
|---|---|---|
| `public/data/cookbook.json` | `scripts/build-app-data.js` | Generated app seed/fallback. Avoid committing timestamp-only changes. |
| `dist/` | Vite build | Ignored. |
| `exports/` | `scripts/export-pdf.js` | Print artifacts; commit only when explicitly needed. |
| `reports/` | Import/migration scripts | Commit when the report is useful audit history. |

## Source-Of-Truth Rules

1. Do not duplicate rules across docs.
2. Grocery rules live in `planning/grocery-rules.md`.
3. Prep rules live in `planning/prep-rules.md`.
4. Promotion rules live in `AGENTS.md`.
5. Reusable document formats live in `templates/`.
6. Current app behavior should be documented in `docs/product-context.md` and `docs/app-architecture.md`.
7. Migration plans and audits under `planning/` are historical unless a current doc links to them as active.

## Known Mismatch To Watch

Some weekly folders contain recipe copies that also exist in `recipe-archive/`. Treat archive recipe records/Firebase recipe records as the canonical reusable recipe path. Week-local copies should be considered historical packet snapshots unless explicitly being migrated.
