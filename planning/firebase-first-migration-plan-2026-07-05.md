# Firebase-First Migration Plan

Date: 2026-07-05  
Goal: Move the cookbook from Markdown-driven workflows to a Firebase-backed app where structured recipe records power weekly planning, grocery lists, prep, reviews, and promotion.

## Direction

Recipes remain the conceptual source of truth. The change is where the editable recipe truth lives.

Target state:

- Firebase stores structured recipe records, reviews, weekly plans, grocery snapshots, prep tasks, and recipe version history.
- React is the primary workflow surface for creating, editing, planning, shopping, prepping, reviewing, and promoting recipes.
- Markdown becomes seed data, backup, export, print/PDF source, and optional human-readable archive.
- Existing Markdown recipes and packets are migrated into Firebase, then treated as imports rather than the main editing path.

This avoids the current split where the app can improve grocery/prep state but cannot directly change the recipe data that generates those flows.

## Source Of Truth Model

### Primary Source Of Truth

Firebase should become authoritative for:

- Recipe identity and metadata.
- Stage 1 and Stage 2 recipe content.
- Ingredient rows and grocery specifications.
- Equipment.
- Instructions.
- Planning summary.
- Prep guidance.
- Family notes.
- Reviews and ratings.
- Promotion status.
- Weekly menus.
- Grocery and prep snapshots.

### Secondary Sources

Markdown should become:

- Import format for existing recipes and weekly packets.
- Export format for backups, binder printing, and Codex review.
- Human-readable generated artifact, not the live app database.

PDF/HTML exports should become:

- Print outputs generated from Firebase-backed recipe/week data.
- Optional static archive of a week.

## Proposed Firestore Shape

All documents below live under:

```text
households/{householdId}/
```

### Recipes

```text
recipes/{recipeId}
```

Suggested fields:

```json
{
  "id": "jamaican-jerk-chicken-coconut-rice-pineapple-mango-salsa",
  "title": "Jamaican Jerk Chicken with Coconut Rice and Pineapple Mango Salsa",
  "status": "stage-1",
  "category": "chicken",
  "source": "Next-week family menu idea",
  "dateAdded": "2026-07-04",
  "lastUpdated": "2026-07-05",
  "version": "1.0",
  "servings": 4,
  "estimatedPrepMinutes": 30,
  "estimatedCookMinutes": 35,
  "protein": "Chicken thighs",
  "cuisine": "Jamaican-inspired jerk",
  "bestDayToCook": "Sunday",
  "perishabilityNotes": "Uses fresh chicken, mango, pineapple, cilantro, lime, and peppers.",
  "equipment": [],
  "ingredients": [],
  "instructionSections": [],
  "notes": {},
  "prepGuidance": {},
  "storage": {},
  "reheating": {},
  "familyNotes": [],
  "versionHistory": [],
  "archivedMarkdownPath": "recipe-archive/chicken/jamaican-jerk-chicken-coconut-rice-pineapple-mango-salsa.md",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Ingredient row shape:

```json
{
  "id": "ingredient-1",
  "quantityText": "2 1/2 lb",
  "quantityValue": 2.5,
  "unit": "lb",
  "item": "Boneless skinless chicken thighs",
  "preferredType": "Trimmed",
  "acceptableAlternatives": "Chicken breasts, watched carefully",
  "notes": "Main protein",
  "groceryCategory": "Meat and Seafood",
  "usedIn": "Main dish",
  "optional": false,
  "perishable": true
}
```

Instruction section shape:

```json
{
  "title": "Basic Instructions",
  "steps": [
    {
      "order": 1,
      "text": "Blend or finely mash 4 sliced scallions, 2 tbsp lime juice, 2 tbsp low-sodium soy sauce, 1 tbsp brown sugar, 1 tbsp olive oil, 2 minced garlic cloves, 1 tbsp grated ginger, 1 tbsp jerk seasoning, 1 tsp dried thyme, 1/2 tsp allspice, and 1 minced seeded jalapeno into a coarse marinade.",
      "cue": "",
      "temperature": "",
      "timeMinutes": null,
      "ingredientRefs": ["ingredient-2", "ingredient-3", "ingredient-4"]
    }
  ]
}
```

Recipe editor rule: instruction text should not rely on vague references such as "sauce ingredients," "marinade ingredients," or "seasoning mixture." Store the exact ingredient amounts in the step text, and optionally attach `ingredientRefs` when the UI needs structured grocery/prep ownership.

### Recipe Reviews

```text
recipes/{recipeId}/reviews/{reviewId}
```

Suggested fields:

```json
{
  "dateCooked": "2026-07-10",
  "cookedBy": "Family",
  "stageAtCooking": "stage-1",
  "weekId": "2026-week-28",
  "ratings": {
    "flavor": "",
    "ease": "",
    "leftovers": "",
    "cost": "",
    "time": "",
    "family": "5/5"
  },
  "wouldMakeAgain": "yes",
  "whatWorked": [],
  "whatDidNotWork": [],
  "versionNotes": {
    "ingredientChanges": [],
    "timingChanges": [],
    "equipmentChanges": [],
    "servingChanges": [],
    "familyFeedback": []
  },
  "promotionDecision": "keep-stage-1",
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Weeks

```text
weeks/{weekId}
```

Suggested fields:

```json
{
  "id": "2026-week-28",
  "year": "2026",
  "weekNumber": 28,
  "startDate": "2026-07-05",
  "endDate": "2026-07-11",
  "status": "working",
  "packetTitle": "Week 28 Family Cookbook Packet",
  "menuRows": [],
  "grocerySnapshotId": "2026-week-28",
  "prepSnapshotId": "2026-week-28",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Menu row shape:

```json
{
  "day": "Sunday",
  "date": "2026-07-05",
  "mealSlot": "Dinner",
  "recipeId": "jamaican-jerk-chicken-coconut-rice-pineapple-mango-salsa",
  "recipeTitle": "Jamaican Jerk Chicken with Coconut Rice and Pineapple Mango Salsa",
  "stage": "stage-1",
  "protein": "Chicken thighs",
  "cuisine": "Jamaican-inspired jerk",
  "perishabilityReason": "Uses fresh chicken, mango, pineapple, cilantro, and peppers",
  "notes": "Grill-friendly Sunday meal"
}
```

### Grocery Snapshots

```text
groceryWeeks/{weekId}
```

Suggested fields:

```json
{
  "weekId": "2026-week-28",
  "sourceRecipeIds": [],
  "generatedAt": "...",
  "generatedFromRecipeVersions": {},
  "sections": [],
  "checkedItemIds": [],
  "manualItems": [],
  "updatedAt": "..."
}
```

Snapshot items should preserve:

- quantity text as shown to the shopper;
- parsed quantity where possible;
- item;
- preferred type;
- acceptable alternatives;
- recipe ownership;
- source recipe ids;
- source ingredient ids;
- category;
- checked/have state.

### Prep Snapshots

```text
prepWeeks/{weekId}
```

Suggested fields:

```json
{
  "weekId": "2026-week-28",
  "sourceRecipeIds": [],
  "generatedAt": "...",
  "sections": [],
  "checkedTaskIds": [],
  "updatedAt": "..."
}
```

Prep task shape:

```json
{
  "id": "task-1",
  "section": "Sunday Dinner Support",
  "title": "Make jerk marinade.",
  "ingredients": "4 sliced scallions, 2 tbsp lime juice, 2 tbsp low-sodium soy sauce, 1 tbsp brown sugar, 1 tbsp olive oil, 2 minced garlic cloves, 1 tbsp grated ginger, 1 tbsp jerk seasoning, 1 tsp dried thyme, 1/2 tsp allspice, 1 minced seeded jalapeno, and 2 1/2 lb boneless skinless chicken thighs.",
  "instructions": "Blend or finely mash 4 sliced scallions, 2 tbsp lime juice, 2 tbsp low-sodium soy sauce, 1 tbsp brown sugar, 1 tbsp olive oil, 2 minced garlic cloves, 1 tbsp grated ginger, 1 tbsp jerk seasoning, 1 tsp dried thyme, 1/2 tsp allspice, and 1 minced seeded jalapeno into a coarse marinade. Coat 2 1/2 lb boneless skinless chicken thighs evenly and refrigerate.",
  "storageMethod": "Covered container or zip-top bag in refrigerator.",
  "useByDate": "2026-07-05",
  "mealOwnership": ["jamaican-jerk-chicken-coconut-rice-pineapple-mango-salsa"],
  "checked": false
}
```

### Planning Notes

```text
planningDocs/{docId}
```

Suggested fields:

```json
{
  "title": "Grocery Rules",
  "type": "grocery-rules",
  "content": "...",
  "updatedAt": "..."
}
```

Planning docs can stay as Markdown-like rich text initially, then become structured later only where it matters.

## Migration Strategy

### Phase 1: Stabilize Existing Data

Purpose: Make the current app data safe to migrate.

Tasks:

1. Decide how to handle duplicate week-local recipes.
   - Recommended: archive category recipe is canonical.
   - Week packets should reference recipe ids or archive paths, not contain duplicate recipe files.
2. Give every recipe a stable id.
   - Use existing slug filename as initial id.
   - Store old Markdown path as `archivedMarkdownPath`.
3. Add a migration report for duplicate titles, duplicate filenames, and conflicting recipe content.
4. Keep current Markdown files untouched until the migration has a verified Firebase import.

Deliverables:

- Duplicate report.
- Recipe id map.
- Canonical recipe list.

### Phase 2: Import Recipes Into Firebase

Purpose: Convert Markdown recipes into structured Firebase recipes.

Tasks:

1. Build `scripts/import-recipes-to-firebase.js`.
2. Parse Stage 1 and Stage 2 Markdown into structured recipe documents.
3. Preserve original Markdown in an optional `sourceMarkdown` field during the transition.
4. Store each ingredient as structured rows.
5. Store instructions as sectioned steps.
6. Store notes, family notes, archive path, version history, and status.
7. Dry-run import first and print counts/warnings.

Deliverables:

- `recipes/{recipeId}` documents in Firestore.
- Import warnings for missing sections or ambiguous ingredient rows.
- A local `reports/firebase-recipe-import-YYYY-MM-DD.md` report.

### Phase 3: Switch React Recipe Views To Firebase

Purpose: Make Firebase recipe records the app's recipe source.

Tasks:

1. Add `src/services/recipeStore.js`.
2. Subscribe to `households/{householdId}/recipes`.
3. Replace `data.archivedRecipes` usage with Firebase recipes when configured.
4. Keep `public/data/cookbook.json` as fallback seed data.
5. Add loading/error/empty states for Firebase recipe loading.
6. Add Firebase/localStorage fallback for recipe data, similar to grocery/prep stores.

Deliverables:

- Recipes tab reads structured Firebase recipes.
- Week planner selects Firebase recipe records.
- Existing generated JSON remains fallback only.

### Phase 4: Recipe CRUD In App

Purpose: Let the app create and edit the recipe source of truth.

Tasks:

1. Add "New Recipe" action.
2. Add Stage 1 recipe editor:
   - title;
   - category;
   - source;
   - servings;
   - prep/cook time;
   - protein;
   - cuisine;
   - perishability notes;
   - equipment;
   - ingredients;
   - instructions;
   - notes.
3. Add ingredient table editor with clear grocery fields.
4. Add save/version history.
5. Add validation before save.
6. Support duplicating a recipe as a variant.

Deliverables:

- New recipe can be created entirely in React.
- Existing recipe can be edited in React.
- Grocery/prep generators use updated recipe immediately.

### Phase 5: Firebase-Backed Weekly Planning

Purpose: Make weeks fully app-native.

Tasks:

1. Replace working-week-only model with a real `weeks/{weekId}` lifecycle.
2. Week statuses:
   - planning;
   - active;
   - cooked/reviewing;
   - archived.
3. Save menu rows with recipe ids and recipe version references.
4. Generate grocery snapshot from selected recipe records.
5. Generate prep snapshot from selected recipe records.
6. Add regenerate buttons with diff/confirmation:
   - regenerate grocery from recipes;
   - regenerate prep from recipes.

Deliverables:

- Weekly planning no longer depends on Markdown packets.
- Grocery/prep snapshots are derived from structured Firebase recipes.

### Phase 6: Grocery Engine Upgrade

Purpose: Improve shopping functionality using structured ingredient data.

Tasks:

1. Build shared grocery engine.
2. Parse quantities into:
   - amount;
   - unit;
   - package descriptor;
   - raw display text.
3. Merge compatible items while preserving recipe ownership.
4. Flag non-mergeable quantities clearly.
5. Add category override per ingredient.
6. Add "staple but required" handling.
7. Add shop-mode grouping:
   - Produce;
   - Meat and Seafood;
   - Dairy and Eggs;
   - Pantry and Dry Goods;
   - Sauces, Condiments, and Spices;
   - Frozen;
   - Bakery;
   - Other.

Deliverables:

- Cleaner grocery consolidation.
- Better mobile shopping checklist.
- Fewer manual grocery corrections.

### Phase 7: Prep Engine Upgrade

Purpose: Generate practical prep plans from recipes.

Tasks:

1. Add structured prep guidance to recipe documents:
   - prep-ahead tasks;
   - do-not-prep-ahead items;
   - protein thaw timing;
   - perishability notes;
   - sauce/marinade timing;
   - leftover expectations.
2. Generate standard prep sections:
   - Sunday Dinner Support;
   - Future Meal Prep;
   - Protein Thaw Schedule;
   - Wednesday Refresh;
   - Do Not Prep Ahead.
3. Allow user edits before saving weekly prep snapshot.
4. Preserve generated vs manually edited state.

Deliverables:

- Prep guide quality approaches the hand-written packets.
- User can edit prep plan without changing the underlying recipe.

### Phase 8: Reviews And Promotion

Purpose: Complete the family cookbook lifecycle inside the app.

Tasks:

1. Add review form after a recipe is cooked.
2. Store reviews under `recipes/{recipeId}/reviews`.
3. Add "Would make again" and family rating.
4. Add ingredient/timing/equipment/serving change capture.
5. Add promotion checklist.
6. Add Stage 2 promotion action:
   - convert status to `stage-2`;
   - require checklist completion;
   - add detailed beginner-friendly fields;
   - preserve prior versions.

Deliverables:

- No CLI script needed to capture family feedback.
- Stage 2 promotion is app-guided and rule-compliant.

### Phase 9: Export And Backup

Purpose: Keep Markdown/PDF useful without making it the editing source.

Tasks:

1. Export recipe to Markdown.
2. Export week packet to Markdown.
3. Export selected week to PDF/HTML.
4. Export full Firebase backup to JSON.
5. Optional scheduled backup.

Deliverables:

- Binder/print workflows continue.
- Data is recoverable outside Firebase.
- Codex can still review generated Markdown artifacts.

## Updated React App Roadmap

Priority 1:

- Firebase recipe store.
- Recipe import script.
- Recipe list/detail from Firebase.
- New/edit Stage 1 recipe form.

Priority 2:

- Firebase-native weekly planner.
- Grocery regeneration from Firebase recipe data.
- Prep regeneration from Firebase recipe data.
- Recipe review form.

Priority 3:

- Stage 2 promotion flow.
- Export Markdown/PDF from Firebase.
- Planning docs in app.
- Better auth/security.

Priority 4:

- Offline sync visibility.
- Advanced search/filtering.
- Meal rotation suggestions.
- Cost/time tracking.

## Firestore Rules Direction

Current rules are fine only for a private prototype. Before broader hosted use, update to require membership.

Recommended shape:

```text
households/{householdId}/members/{uid}
```

Rules should require:

- `request.auth != null`;
- member doc exists for the current user;
- writes are scoped to that household;
- optional role checks for destructive actions.

Example policy direction:

```text
allow read: if isHouseholdMember(householdId);
allow write: if isHouseholdEditor(householdId);
```

## Markdown Transition Policy

During migration:

- Keep Markdown as a trusted import source.
- Do not delete Markdown recipe files until Firebase import is verified.
- Add `firebaseRecipeId` to exported Markdown once Firebase is canonical.
- Stop hand-editing Markdown recipes after a recipe is imported, unless intentionally preparing a one-time re-import.

After migration:

- App edits Firebase.
- Markdown exports are generated.
- Weekly packets are generated artifacts.
- PDF exports are generated from Firebase-backed Markdown/HTML.

## Immediate Next Build Steps

1. Add a recipe import dry-run script.
   - Input: `recipe-archive/**/*.md`.
   - Output: parsed recipe objects and warnings.
   - No Firebase write yet.
2. Define `recipeStore.js`.
   - Subscribe to recipes.
   - Save recipe.
   - Update recipe.
   - Local fallback.
3. Add Firestore rules for `recipes/{recipeId}` and recipe reviews.
4. Build a basic Firebase recipe browser behind the current Recipes tab.
5. Add a Stage 1 recipe editor.
6. Only then migrate week planning to use Firebase recipe ids.

## Open Decisions

- Should Markdown exports be committed to git after every Firebase change, or generated only when needed?
- Should recipe ids be human slugs forever, or generated ids with slug aliases?
- Should ingredient quantities be stored as raw text only at first, or parsed at import time?
- Should anonymous Firebase auth remain, or should the app move to Google sign-in?
- Should old `weekly-plans/2026/week-*/*.md` recipe copies become historical snapshots or be removed after Firebase import?

## Recommended Answer

Use Firebase as the live source of truth for structured recipes and app workflows. Keep Markdown as import/export/print backup. Do not try to perfect the Markdown-first workflow further except where it helps seed or verify the Firebase migration.
