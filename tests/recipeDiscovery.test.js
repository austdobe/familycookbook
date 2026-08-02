import test from "node:test";
import assert from "node:assert/strict";
import { recipeDiscoveryText, recipeMatchesQuery, recipeProtein, recipeStage } from "../src/domain/recipeDiscovery.js";

const doc = {
  title: "Lemon Herb Chicken",
  path: "recipe-archive/chicken/lemon-herb.md",
  recipe: {
    category: "chicken",
    cuisine: "Mediterranean",
    protein: "Chicken",
    status: "stage-2",
    equipment: ["sheet pan"],
    ingredients: [
      { item: "chicken thighs", preferredType: "bone-in" },
      { item: "fresh rosemary", acceptableAlternatives: "thyme" },
    ],
  },
};

test("recipe discovery indexes ingredient and equipment details", () => {
  const text = recipeDiscoveryText(doc);
  assert.match(text, /rosemary/);
  assert.match(text, /sheet pan/);
  assert.match(text, /thyme/);
});

test("multi-word discovery requires every search term", () => {
  assert.equal(recipeMatchesQuery(doc, "chicken rosemary"), true);
  assert.equal(recipeMatchesQuery(doc, "chicken beef"), false);
});

test("discovery exposes stable protein and stage facets", () => {
  assert.equal(recipeProtein(doc), "Chicken");
  assert.equal(recipeStage(doc), "stage-2");
  assert.equal(recipeStage({ recipe: {} }), "stage-1");
});
