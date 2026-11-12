import test from "node:test";
import assert from "node:assert/strict";
import { markdownWithBatchIngredients } from "../src/domain/batchRecipeDisplay.js";

test("scaled reader replaces ingredient amounts, preserves directions and notes", () => {
  const original = "# Chicken\n\n## Ingredients\n\n| Quantity | Ingredient |\n| --- | --- |\n| 1 lb | Chicken |\n\n## Basic Instructions\n1. Cook 1 lb chicken to 165 F.\n\n## Notes\nKeep cold.";
  const result = markdownWithBatchIngredients(original, [{ item: "Chicken", quantityText: "2 lb", preferredType: "Boneless", acceptableAlternatives: "Thighs" }]);
  assert.ok(result.includes("| 2 lb | Chicken | Boneless | Thighs |"));
  assert.ok(!result.includes("| 1 lb |"));
  assert.ok(result.includes("1. Cook 1 lb chicken to 165 F."));
  assert.ok(result.includes("## Notes\nKeep cold."));
});

test("scaled reader safely escapes table separators and supports missing original section", () => {
  const result = markdownWithBatchIngredients("# Recipe\nInstructions stay.", [{ item: "Salt | pepper", quantityText: "To taste" }]);
  assert.ok(result.includes("Salt \\| pepper"));
  assert.ok(result.includes("# Recipe\nInstructions stay."));
});
