import test from "node:test";
import assert from "node:assert/strict";
import { collectPlannedMealIngredients } from "../src/domain/plannedMeals.js";
import { recipeMatchesQuery } from "../src/domain/recipeDiscovery.js";
import { analyzeRecipeImport, recipeBuilderDraftToMarkdown } from "../src/domain/recipeImport.js";

test("pasted recipe remains discoverable and supplies its planned grocery ingredients", () => {
  const pasted = `Lemon Chicken
Ingredients:
- 2 lb chicken thighs
- 1 lemon
- 2 cloves garlic
Directions:
1. Heat the oven.
2. Roast until browned.`;
  const parsed = analyzeRecipeImport(pasted);
  assert.equal(parsed.ready, true);

  const markdown = recipeBuilderDraftToMarkdown({
    builderDraft: parsed.draft,
    category: "chicken",
    status: "stage-1",
    title: parsed.title,
  });
  const recipeDoc = {
    id: "lemon-chicken",
    title: parsed.title,
    path: "recipe-archive/chicken/lemon-chicken.md",
    markdown,
    recipe: {
      category: "chicken",
      ingredients: parsed.draft.ingredients.map((ingredient) => ({
        item: ingredient.item,
        quantityText: ingredient.quantity,
      })),
    },
  };

  assert.equal(recipeMatchesQuery(recipeDoc, "garlic chicken"), true);

  const plannedRows = [{
    Day: "Tuesday",
    Meal: "Lemon Chicken",
    components: [{ recipeId: recipeDoc.id, role: "complete" }],
  }];
  const groceries = collectPlannedMealIngredients(plannedRows, [recipeDoc]);
  assert.deepEqual(groceries.map(({ ingredient }) => ingredient.item), ["chicken thighs", "lemon", "garlic"]);
  assert.ok(groceries.every(({ doc, row }) => doc.id === recipeDoc.id && row.Day === "Tuesday"));
});

test("composed and hybrid plans collect ingredients from every attached recipe", () => {
  const docs = [
    { id: "pasta", recipe: { ingredients: [{ item: "spaghetti" }, { item: "tomato sauce" }] } },
    { id: "bread", recipe: { ingredients: [{ item: "sourdough bread" }, { item: "butter" }] } },
    { id: "salad", recipe: { ingredients: [{ item: "romaine" }] } },
  ];
  const rows = [
    { components: [{ recipeId: "pasta", role: "complete" }, { recipeId: "bread", role: "bread" }] },
    { components: [{ recipeId: "salad", role: "side" }] },
  ];
  assert.deepEqual(
    collectPlannedMealIngredients(rows, docs).map(({ ingredient }) => ingredient.item),
    ["spaghetti", "tomato sauce", "sourdough bread", "butter", "romaine"],
  );
});
