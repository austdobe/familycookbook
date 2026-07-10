# Product Context

## Purpose

Family Cookbook is a private family meal planning and recipe management app. It supports four practical jobs:

1. Keep reusable recipes organized.
2. Build a weekly meal plan from saved recipes.
3. Generate and edit grocery and prep lists for that week.
4. Capture cooking feedback so recipes can improve or be promoted.

The product is not a public recipe site, social sharing tool, or restaurant-style menu builder. It is optimized for repeat family use: planning, shopping, cooking, reviewing, and keeping only recipes that are worth repeating.

## Primary Users

- Family planner: creates weeks, assigns meals, imports recipes, updates grocery and prep lists.
- Shopper: uses the mobile grocery checklist.
- Cook: uses the selected recipe and prep checklist while cooking.
- Maintainer: uses Codex/scripts to export, migrate, verify, and improve the repository.

## Main User Workflows

### Recipe Library

Source UI: `src/components/RecipeImportDialog.jsx` and the Recipes view in `src/main.jsx`.

- Add a recipe from typed text, pasted text, or a recipe image.
- OCR is handled in the browser through Tesseract assets under `public/vendor/tesseract/`.
- Imported text is cleaned into editable Markdown before saving.
- Existing recipes can be edited from the Recipes view.
- Recipes are saved to Firebase when configured, with localStorage fallback.

Canonical data behavior: see `docs/source-of-truth.md`.

### Weekly Planning

Source UI: Week view in `src/main.jsx`.

- Create a new planning week.
- Select a day/card.
- Assign a saved recipe, create a new recipe, or use a title-only placeholder.
- Drag recipes from the picker to day cards on desktop.
- Drag meals between day cards.
- Add custom cards while editing a week, such as lunch, potluck, or extra dinner.
- Clear/delete cards and clear/delete empty weeks through guarded dialogs.
- Seal a week to prevent accidental menu, grocery, and prep changes.

### Grocery Checklist

Source UI: Grocery view in `src/main.jsx`.

- Grocery sections are generated from selected recipes.
- Users can edit recipe-driven rows, add rows, remove rows, and check items.
- Checked items move into a Have It section.
- Mobile shopping rows prioritize item, quantity, and checkbox.
- Grocery merging includes practical normalization for regular onions, garlic bulbs, and can/cup cases.
- Sealed weeks lock grocery editing and check state.

Rule source: `planning/grocery-rules.md`.

### Prep Checklist

Source UI: Prep view in `src/main.jsx`.

- Prep sections are generated from the planned recipes.
- Users can add, edit, remove, and check prep tasks.
- Sealed weeks lock prep editing and check state.

Rule source: `planning/prep-rules.md`.

### Recipe Feedback And Promotion

Source UI: `RecipeFeedbackPanel` in `src/main.jsx`.

- Save cooked date, cooked count, rating, notes, promotion notes, and ingredient changes.
- Mark recipes as cooked.
- Promote to Stage 2 from the app once the recipe is known to be a keeper.

Canonical promotion checklist: `AGENTS.md`.

## Product Principles

- App-first for live planning and editing.
- Recipe-driven grocery lists only.
- Assume nothing is on hand when generating grocery lists.
- Keep weekly grocery/prep as snapshots so later recipe changes do not silently alter an active shopping week.
- Keep generated/exported Markdown useful, but do not duplicate live app state by hand.
- Prefer practical shopping units over literal recipe fragments where the app can safely normalize them.

## Current Product Boundaries

Implemented:

- Firebase-backed recipes.
- Firebase-backed working weeks.
- Firebase-backed weekly plan state, grocery state, prep state, and recipe feedback.
- Manual sync from Firebase.
- Local fallback when Firebase is unavailable.
- Recipe OCR import with editable cleanup.
- Week sealing and unsealing.
- PDF/HTML export from Markdown.

Not fully implemented:

- Authenticated household membership rules.
- Full Firebase-to-Markdown export for working weeks.
- Planning docs tab in the React app.
- Shared Markdown renderer between app and PDF export.
- Automated validation for recipe/weekly packet structure.
- Full Stage 2 template conversion workflow.
