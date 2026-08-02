import test from "node:test";
import assert from "node:assert/strict";
import { resolveMealComponentDocs } from "../src/domain/plannedMeals.js";

const docs = [
  { id: "complete-pasta", title: "Spaghetti with Meat Sauce" },
  { id: "chicken", title: "Dry Rub Chicken" },
  { id: "potatoes", title: "Grilled Potatoes" },
  { id: "bread", title: "Garlic Bread" },
];

test("complete meals resolve one reusable recipe", () => {
  const resolved = resolveMealComponentDocs({ components: [{ recipeId: "complete-pasta", role: "complete" }] }, docs);
  assert.deepEqual(resolved.map((doc) => doc.id), ["complete-pasta"]);
});

test("composed meals resolve every component with main first", () => {
  const resolved = resolveMealComponentDocs({ components: [
    { recipeId: "potatoes", role: "side" },
    { recipeId: "chicken", role: "main" },
  ] }, docs);
  assert.deepEqual(resolved.map((doc) => doc.id), ["chicken", "potatoes"]);
});

test("hybrid meals resolve complete recipe and attached extras", () => {
  const resolved = resolveMealComponentDocs({ components: [
    { recipeId: "bread", role: "bread" },
    { recipeId: "complete-pasta", role: "complete" },
  ] }, docs);
  assert.deepEqual(resolved.map((doc) => doc.id), ["complete-pasta", "bread"]);
});

test("legacy single-recipe rows remain supported", () => {
  const resolved = resolveMealComponentDocs({ "Recipe id": "complete-pasta" }, docs);
  assert.deepEqual(resolved.map((doc) => doc.id), ["complete-pasta"]);
});
