# Family Cookbook Process

This process describes the cookbook lifecycle. Product behavior, data ownership, and commands are documented separately:

- Product context: `docs/product-context.md`
- Source of truth: `docs/source-of-truth.md`
- App architecture: `docs/app-architecture.md`
- Operations: `docs/operations.md`

## Lifecycle

1. Capture meal ideas.
2. Create or import a Stage 1 recipe.
3. Build a weekly plan from saved recipes.
4. Generate and edit grocery/prep snapshots.
5. Cook the meal.
6. Record feedback.
7. Promote keepers to Stage 2 only after the family has cooked and approved them.

## 1. Capture Meal Ideas

Use `planning/meal-ideas-backlog.md` for loose ideas, cravings, cuisines to try, or meals that might solve a planning need.

Keep backlog entries lightweight. Do not overbuild recipes at this stage.

## 2. Create Or Import Stage 1 Recipes

Current app workflow:

- Use the Recipes view or Week action menu.
- Add typed text, pasted recipe text, or a recipe photo.
- Review/edit OCR output before saving.
- Save as Stage 1 unless the family has already cooked and approved the recipe.

Markdown/template reference:

- Stage 1 format: `templates/stage-1-recipe.md`
- Archive folders: `recipe-archive/<category>/`
- Agent operating rules: `AGENTS.md`

## 3. Build The Weekly Plan

Use the Week view to create a planning week, assign saved recipes to day cards, add custom cards, or create title-only placeholders.

The app saves working week state to Firebase when configured. See `docs/source-of-truth.md` for the exact data owner.

Committed weekly packet reference:

- Weekly template: `templates/weekly-menu.md`
- Packet folders: `weekly-plans/2026/week-[number]/`

## 4. Generate And Edit Grocery/Prep Snapshots

Grocery and prep are week snapshots. Editing a grocery or prep row changes that week's snapshot, not the source recipe.

Rule sources:

- Grocery: `planning/grocery-rules.md`
- Prep: `planning/prep-rules.md`
- Grocery template: `templates/grocery-list.md`
- Prep template: `templates/prep-guide.md`

Seal a week when grocery/prep should stop changing accidentally.

## 5. Cook The Meals

Cook from the app recipe view, an archive Markdown recipe, or a committed weekly packet snapshot.

Capture practical notes while cooking:

- missing grocery details;
- unclear instructions;
- timing problems;
- flavor or texture changes;
- better equipment choices;
- family reactions.

## 6. Review Recipes

Use the app feedback controls for cooked date, rating, notes, promotion notes, and ingredient changes.

Markdown review reference:

- `templates/recipe-review.md`

Feedback scripts are documented in `docs/operations.md`.

## 7. Promote Keepers

Only promote a recipe after it has been cooked and the family wants it again.

Promotion rule source:

- `AGENTS.md`

Stage 2 template:

- `templates/stage-2-recipe.md`

## 8. Update Standing Notes

Update planning files when a durable preference or rule changes:

- `planning/pantry-notes.md`
- `planning/substitution-notes.md`
- `planning/grocery-rules.md`
- `planning/prep-rules.md`
- `planning/lessons-learned.md`

Do not copy those rules into README or product docs. Link to the planning file that owns the rule.
