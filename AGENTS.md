# Family Cookbook Agent Guide

This project is a Markdown-first family cookbook and weekly meal planning system.

## Operating Rules

- New generated recipes start as Stage 1 drafts in `recipe-archive/drafts/` unless the user explicitly asks for a week-local draft.
- Weekly menus should be built by selecting recipes from the archive/drafts through the app planning flow, then adding those recipes to a working week.
- Move approved Stage 1 drafts from `recipe-archive/drafts/` into the best archive category only after the family has cooked, reviewed, and approved them as keepers or ongoing tested recipes.
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

- Stage 1 generated drafts: `recipe-archive/drafts/`
- Week-local drafts, only when explicitly requested: `weekly-plans/2026/week-[number]/`
- Stage 2 promoted recipes: `recipe-archive/promoted/` or the best category folder
- Weekly packets: `weekly-plans/2026/week-[number]/`
- Standing planning rules and notes: `planning/`
- Reusable formats: `templates/`

## Tone and Detail

Write recipes for real family use. Be specific, practical, and clear. Avoid vague instructions like "cook until done" unless visual cues and doneness indicators are also included.

## Promotion Checklist

Before promoting a recipe to Stage 2, confirm:

- The family cooked it at least once.
- Flavor was strong enough to repeat.
- Instructions were easy enough to follow.
- Leftovers were acceptable or clearly noted.
- Cost and time felt reasonable.
- Any changes were captured in version notes.
