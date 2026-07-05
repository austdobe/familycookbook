# Family Cookbook Agent Guide

This project is a Markdown-first family cookbook and weekly meal planning system.

## Operating Rules

- New generated recipes start as Stage 1 drafts filed immediately in the best `recipe-archive/<category>/` folder unless the user explicitly asks for a week-local draft.
- Weekly menus should be built by selecting Stage 1 or Stage 2 recipes from the category archive through the app planning flow, then adding those recipes to a working week.
- Keep Stage 1 recipes in their category folders until review; do not move them to `recipe-archive/promoted/` or rewrite them as Stage 2 until the family has cooked, reviewed, and approved them as keepers.
- Do not promote a recipe to Stage 2 until the family has cooked it and decided it is a keeper.
- Stage 2 recipes must be beginner-friendly binder recipes, not brief notes.
- Grocery lists must be recipe-driven only.
- Assume nothing is on hand when building a grocery list.
- Do not add household staples unless they are required by a listed recipe.
- Prefer arrowroot instead of cornstarch unless a specific recipe requires cornstarch.
- Keep meals protein-forward by default.
- Preserve international variety across a weekly plan.
- Schedule perishable ingredients first.
- Write grocery specs clearly: quantity, preferred version/type, acceptable alternatives, and recipe ownership.

## File Placement

- Stage 1 generated drafts: best matching `recipe-archive/<category>/` folder
- Week-local drafts, only when explicitly requested: `weekly-plans/2026/week-[number]/`
- Stage 2 promoted recipes: `recipe-archive/promoted/` or the best category folder
- Weekly packets: `weekly-plans/2026/week-[number]/`
- Standing planning rules and notes: `planning/`
- Reusable formats: `templates/`

## Tone and Detail

Write recipes for real family use. Be specific, practical, and clear. Avoid vague instructions like "cook until done" unless visual cues and doneness indicators are also included.

For every mixing, sauce, marinade, batter, filling, meatball, dressing, spice blend, or bowl-assembly step, name the exact ingredient amounts inside the instruction step. Do not write vague steps like "mix the sauce ingredients" or "combine marinade ingredients." Write the amounts again, for example: "Whisk together 1/4 cup low-sodium soy sauce, 2 tbsp brown sugar, 1 tbsp rice vinegar, 1 tsp grated ginger, and 2 minced garlic cloves."

## Promotion Checklist

Before promoting a recipe to Stage 2, confirm:

- The family cooked it at least once.
- Flavor was strong enough to repeat.
- Instructions were easy enough to follow.
- Leftovers were acceptable or clearly noted.
- Cost and time felt reasonable.
- Any changes were captured in version notes.
