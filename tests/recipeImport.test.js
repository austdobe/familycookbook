import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRecipeDocReadiness, analyzeRecipeImport, analyzeRecipeReadiness, recipeBuilderDraftFromText, recipeBuilderDraftToMarkdown, summarizeRecipeHealth } from "../src/domain/recipeImport.js";

test("recognizes canonical recipe Markdown", () => {
  const result = analyzeRecipeImport(`# Lemon Chicken
## Ingredients
| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |
|---|---|---|---|---|
| 2 lb | chicken thighs | bone-in | breasts | |
| 1 | lemon | fresh | | |
## Basic Instructions
1. Heat the oven.
2. Roast until browned.`);
  assert.equal(result.title, "Lemon Chicken");
  assert.equal(result.ingredientCount, 2);
  assert.equal(result.directionCount, 2);
  assert.equal(result.ready, true);
});

test("recognizes ordinary pasted recipe sections and unicode fractions", () => {
  const result = analyzeRecipeImport(`Weeknight Pasta
Ingredients:
- ½ cup parmesan
- salt to taste
- 12 oz spaghetti
Directions:
1. Boil the pasta.
2. Toss with parmesan.`);
  assert.equal(result.ingredientCount, 3);
  assert.equal(result.directionCount, 2);
  assert.equal(result.title, "Weeknight Pasta");
  assert.equal(result.draft.ingredients[0].quantity, "½ cup");
  assert.equal(result.draft.ingredients[0].item, "parmesan");
  assert.equal(result.warnings.length, 0);
});

test("warns when pasted text cannot create grocery items", () => {
  const result = analyzeRecipeImport("# Toast\n\nDirections\n1. Toast the bread.");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join(" "), /ingredient/i);
});

test("generated Markdown round trips through the parser", () => {
  const markdown = recipeBuilderDraftToMarkdown({
    title: "Tacos",
    category: "beef",
    status: "stage-1",
    builderDraft: {
      servings: "4",
      prepTime: "15 minutes",
      cookTime: "20 minutes",
      protein: "Beef",
      cuisine: "Mexican",
      equipment: "Skillet",
      ingredients: [{ quantity: "1 lb", item: "ground beef", preferred: "lean", alternatives: "turkey", notes: "" }],
      directions: ["Brown the beef.", "Fill the tortillas."],
      notes: "Serve warm",
    },
  });
  const draft = recipeBuilderDraftFromText(markdown);
  assert.equal(draft.ingredients[0].item, "ground beef");
  assert.deepEqual(draft.directions, ["Brown the beef.", "Fill the tortillas."]);
  assert.match(markdown, /\| 1 lb \| ground beef \|/);
});

test("marks complete recipes ready for planning and Cooking mode", () => {
  const result = analyzeRecipeImport("# Soup\n## Ingredients\n- 2 cups broth\n- 1 lb chicken\n## Basic Instructions\n1. Simmer until cooked.");

  assert.equal(result.status, "ready");
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test("allows incomplete recipes to remain Stage 1 review drafts", () => {
  const readiness = analyzeRecipeReadiness({
    title: "Simple Salad",
    draft: {
      ingredients: [{ quantity: "", item: "lettuce" }],
      directions: [],
    },
  });

  assert.equal(readiness.status, "needs-review");
  assert.equal(readiness.blockers.length, 0);
  assert.match(readiness.warnings.join(" "), /cooking direction/i);
  assert.match(readiness.warnings.join(" "), /missing a quantity/i);
});

test("blocks recipes without a title or real ingredients", () => {
  const readiness = analyzeRecipeReadiness({
    title: "",
    draft: {
      ingredients: [{ quantity: "1", item: "mix everything together" }],
      directions: ["Serve."],
    },
  });

  assert.equal(readiness.status, "invalid");
  assert.equal(readiness.blockers.length, 2);
});

test("flags instruction and recipe-title rows in Ingredients", () => {
  const readiness = analyzeRecipeReadiness({
    title: "Cast Iron Grilled Potatoes",
    draft: {
      ingredients: [
        { quantity: "2 lb", item: "baby potatoes" },
        { quantity: "1", item: "cut potatoes in half" },
        { quantity: "", item: "cast iron grilled potatoes" },
      ],
      directions: ["Grill until tender."],
    },
  });

  assert.equal(readiness.status, "needs-review");
  assert.equal(readiness.ingredientCount, 1);
  assert.equal(readiness.suspiciousIngredientCount, 2);
});

test("applies recipe readiness rules to saved library documents", () => {
  const readiness = analyzeRecipeDocReadiness({
    id: "quick-soup",
    title: "Quick Soup",
    markdown: "# Quick Soup\n## Ingredients\n- broth\n## Directions\n1. Simmer until hot.",
  });

  assert.equal(readiness.status, "needs-review");
  assert.equal(readiness.doc.id, "quick-soup");
  assert.match(readiness.warnings.join(" "), /missing a quantity/i);
});

test("summarizes the existing recipe repair queue", () => {
  const health = summarizeRecipeHealth([
    { title: "Ready Soup", markdown: "# Ready Soup\n## Ingredients\n- 2 cups broth\n## Directions\n1. Simmer." },
    { title: "Draft Soup", markdown: "# Draft Soup\n## Ingredients\n- broth" },
    { title: "Empty", markdown: "# Empty\n## Ingredients" },
  ]);

  assert.deepEqual(health.counts, { ready: 1, "needs-review": 1, invalid: 1 });
  assert.equal(health.attentionCount, 2);
});

test("plain recipe subsection labels and explanatory notes do not become ingredients", () => {
  const draft = recipeBuilderDraftFromText(`# Thai Basil Chicken
Ingredients
Chicken
1 1/2 lb chicken thighs
Vegetables
1 bell pepper
Sauce
3 tbsp soy sauce
Finish
1 cup Thai basil
(Sweet basil works if Thai basil is not available.)
Rice
2 cups jasmine rice
Directions
Cook the chicken and vegetables.
Add the sauce and basil.
Serve over rice.`);

  assert.deepEqual(draft.ingredients.map((ingredient) => ingredient.item), [
    "chicken thighs",
    "bell pepper",
    "soy sauce",
    "Thai basil",
    "jasmine rice",
  ]);
  assert.equal(analyzeRecipeReadiness({ draft, title: "Thai Basil Chicken" }).status, "ready");
});

test("plain recipe parsing preserves mixed fractions and optional subsection context", () => {
  const draft = recipeBuilderDraftFromText(`# Grilled Chicken
Ingredients
Chicken
1½ lb chicken thighs
Sauce
1 1/2 cups broth
Optional:
Cayenne
Fresh parsley
Directions
Cook until done.`);

  assert.equal(draft.ingredients[0].quantity, "1½ lb");
  assert.equal(draft.ingredients[0].item, "chicken thighs");
  assert.equal(draft.ingredients[1].quantity, "1 1/2 cups");
  assert.equal(draft.ingredients[2].notes, "Optional");
  assert.equal(analyzeRecipeReadiness({ draft, title: "Grilled Chicken" }).status, "ready");
});
