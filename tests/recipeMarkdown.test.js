import assert from "node:assert/strict";
import test from "node:test";

import { createRecipeMarkdownTools } from "../src/domain/recipeMarkdown.js";

function createTools() {
  const ingredientRows = (markdown) => markdown.includes("| 1 lb | chicken |")
    ? [{ Quantity: "1 lb", Ingredient: "chicken" }]
    : [];
  return createRecipeMarkdownTools({
    cleanRecipeOcrText: (markdown) => markdown,
    extractIngredientTableRows: ingredientRows,
    extractIngredientSourceRows: ingredientRows,
    extractPlainTextIngredientRows: () => [],
    grocerySectionForItem: () => "Meat and Seafood",
    ingredientTableLines: () => [],
    isLikelyPerishableItem: () => true,
    parseQuantityParts: () => ({ quantity: "1", unit: "lb" }),
  });
}

test("normalizes recipe metadata while preserving canonical ingredients", () => {
  const tools = createTools();
  const markdown = "# Lemon Chicken\nStatus: old\nCategory: old\n## Ingredients\n| Quantity | Ingredient |\n|---|---|\n| 1 lb | chicken |";
  const canonical = tools.canonicalRecipeMarkdownForSave(markdown, "Lemon Chicken", "stage-1", "chicken");

  assert.match(canonical, /^Status: Stage 1 - Draft \/ testing$/m);
  assert.match(canonical, /^Category: Chicken$/m);
});

test("builds a structured save payload with stable recipe identity", () => {
  const tools = createTools();
  const markdown = "# Lemon Chicken\n## Planning Summary\n- Servings: 4\n- Estimated prep time: 15 minutes\n## Ingredients\n| Quantity | Ingredient |\n|---|---|\n| 1 lb | chicken |";
  const recipe = tools.recipeFromMarkdownForSave({
    archiveDocs: [],
    category: "chicken",
    markdown,
    status: "stage-1",
    title: "Lemon Chicken",
  });

  assert.equal(recipe.id, "lemon-chicken");
  assert.equal(recipe.servings, 4);
  assert.equal(recipe.estimatedPrepMinutes, 15);
  assert.equal(recipe.ingredients[0].groceryCategory, "Meat and Seafood");
});

test("parses pasted Directions headings and continuation paragraphs for Cooking mode", () => {
  const tools = createTools();
  const markdown = [
    "# Grilled Chicken",
    "Directions",
    "1. Season the Chicken",
    "Pat the chicken dry.",
    "Rub with olive oil and seasoning.",
    "2. Grill the Chicken",
    "Cook over indirect heat until done.",
    "Notes",
    "Rest before slicing.",
  ].join("\n");

  assert.deepEqual(tools.instructionSectionsFromMarkdown(markdown), [{
    title: "Directions",
    steps: [
      { order: 1, text: "Season the Chicken Pat the chicken dry. Rub with olive oil and seasoning." },
      { order: 2, text: "Grill the Chicken Cook over indirect heat until done." },
    ],
  }]);
});

test("keeps canonical Basic Instructions available to Cooking mode", () => {
  const tools = createTools();
  const markdown = "# Soup\n## Basic Instructions\n1. Chop vegetables.\n2. Simmer until tender.\n## Notes\n- Serve warm.";

  assert.deepEqual(tools.instructionSectionsFromMarkdown(markdown)[0].steps.map((step) => step.text), [
    "Chop vegetables.",
    "Simmer until tender.",
  ]);
});
