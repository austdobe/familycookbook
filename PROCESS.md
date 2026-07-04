# Family Cookbook Process

This cookbook system has two jobs:

1. Help plan real weekly meals with clear groceries and prep.
2. Turn recipes the family actually likes into reliable binder recipes.

The system is intentionally staged. New ideas stay lightweight until they are cooked. Only proven keepers get polished.

## 1. Capture Meal Ideas

Start with `planning/meal-ideas-backlog.md`.

Use the backlog for loose ideas, cravings, cuisines to try, or meals that might solve a weekly planning need.

Good backlog entries include:

- Protein
- Cuisine or flavor direction
- Why the meal fits the family
- Whether it might create useful leftovers
- Any perishability concerns

Do not overbuild recipes at this stage. The backlog is just a parking place for ideas.

## 2. Create Stage 1 Draft Recipes

When an idea is ready to use in a weekly plan, create the Stage 1 recipe in `recipe-archive/drafts/`. The weekly plan should then select that archive draft through the app planning flow.

Example:

```text
recipe-archive/drafts/
  jamaican-jerk-chicken-coconut-rice-pineapple-mango-salsa.md
  mongolian-beef-jasmine-rice-broccoli.md
```

Use `templates/stage-1-recipe.md`.

Stage 1 recipes are planning recipes. They need enough information to shop and cook once, but they do not need to be perfect.

Every Stage 1 recipe should include:

- Recipe name
- Servings
- Equipment
- Ingredients with quantities
- Basic instructions
- Notes

Important rule: every new generated recipe starts as a Stage 1 draft in `recipe-archive/drafts/` unless a week-local file is explicitly requested. Do not write a Stage 2 binder recipe before the family has cooked it and decided it is worth keeping.

## 3. Build the Weekly Menu

Committed weekly packets live in week-specific folders under `weekly-plans/2026/`. Working plans can be created in the app from archive drafts before a Markdown packet exists.

Use `templates/weekly-menu.md` as the starting point for a weekly packet.

The weekly menu should balance:

- Protein-forward meals
- International variety
- Perishability-first scheduling
- Busy-night reality
- Leftovers

Schedule fragile ingredients early in the week. Seafood, fresh herbs, tender greens, and delicate produce should not sit around waiting for Friday unless there is a specific reason.

## 4. Make the Grocery List From Recipes Only

Use `templates/grocery-list.md`.

The grocery list is recipe-driven only. Assume nothing is on hand.

Do not add household staples unless a recipe requires them.

Every grocery item should include:

- Quantity
- Preferred version or type
- Acceptable alternatives
- Which recipe uses the item

Example:

| Quantity | Item | Preferred version/type | Acceptable alternatives | Recipe |
|---:|---|---|---|---|
| 2 lb | Chicken thighs | Boneless skinless | Chicken breast if cook time is adjusted | Korean chicken bowls |

Use clear grocery specifications so another person can shop without guessing.

Standing preference: use arrowroot instead of cornstarch unless a recipe specifically requires cornstarch.

## 5. Create the Prep Guide

Use `templates/prep-guide.md`.

Prep guides are organized into these sections:

- Sunday Dinner Support
- Future Meal Prep
- Protein Thaw Schedule
- Wednesday Refresh
- Do Not Prep Ahead

Every prep task must be an actionable checklist item with:

- Ingredients
- Instructions
- Storage method
- Use-by date
- Meal ownership

Good prep helps the week without hurting food quality. Do not prep delicate items early if the texture, flavor, or safety will suffer.

## 6. Cook the Meals

Cook from the Stage 1 draft in `recipe-archive/drafts/`, a week-local draft if one was explicitly created, or the Stage 2 recipe listed in the weekly packet.

While cooking, note anything that matters:

- Missing grocery details
- Confusing instructions
- Timing problems
- Flavor changes
- Texture problems
- Better equipment choices
- Family reactions

These notes are what make the cookbook better over time.

## 7. Review Each New or Changed Recipe

Use `templates/recipe-review.md`.

Recipe reviews decide whether a recipe stays a draft, gets revised, or gets promoted.

Review criteria:

- Flavor
- Ease
- Leftovers
- Cost
- Time
- Would make again
- Version notes

The key question is not whether the recipe was interesting. The key question is whether the family would want it again.

## 8. Promote Keepers to Stage 2

Only promote a recipe after cooking it and deciding it is a keeper.

Use `templates/stage-2-recipe.md`.

Stage 2 recipes are binder recipes. They should be detailed enough for a beginner or tired weeknight cook to follow successfully.

Every Stage 2 recipe should include:

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

After review, move approved recipes out of `recipe-archive/drafts/` and into the most useful archive category. Add family ratings, version notes, and any changes learned during cooking before or during promotion.

- `recipe-archive/promoted/`
- `recipe-archive/breakfast/`
- `recipe-archive/lunches/`
- `recipe-archive/beef/`
- `recipe-archive/chicken/`
- `recipe-archive/pork/`
- `recipe-archive/seafood/`
- `recipe-archive/sides/`
- `recipe-archive/sauces/`
- `recipe-archive/desserts/`

## 9. Update Planning Notes

Use the planning files to preserve lessons across weeks:

- `planning/pantry-notes.md`
- `planning/substitution-notes.md`
- `planning/grocery-rules.md`
- `planning/prep-rules.md`
- `planning/lessons-learned.md`

Update these when a rule, preference, or recurring pattern becomes clear.

Examples:

- A protein cut worked better than expected.
- A sauce should be doubled next time.
- A meal did not reheat well.
- A grocery specification caused confusion.
- A prep task should move from Sunday to Wednesday.

## 10. Weekly Packet Flow

A complete weekly packet usually contains or links to:

1. Weekly menu
2. Archive draft recipes being tested
3. Stage 2 keeper recipes being reused
4. Grocery list
5. Prep guide
6. Recipe reviews after cooking
7. Lessons learned

The weekly folder is the committed packet for the week. New generated Stage 1 drafts live in `recipe-archive/drafts/`, and the app can assemble working weeks from those drafts before a final packet is written.

## Recommended Next File

Create the first Week 4 folder and packet here:

```text
weekly-plans/2026/week-04/week-04-family-cookbook-packet.md
```

That file should combine the weekly menu, grocery list link, prep guide link, and review checklist for the first planned week.
