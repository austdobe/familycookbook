import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRecipeImport, recipeBuilderDraftFromText, recipeBuilderDraftToMarkdown } from "../src/domain/recipeImport.js";

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
  assert.match(result.warnings.join(" "), /ingredients/i);
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
