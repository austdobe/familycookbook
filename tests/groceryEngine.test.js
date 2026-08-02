import assert from "node:assert/strict";
import test from "node:test";

import {
  grocerySectionForItem,
  isLikelyNonIngredientRow,
  mergeGroceryItems,
  parseQuantityParts,
} from "../src/domain/groceryEngine.js";

test("assigns practical grocery departments", () => {
  assert.equal(grocerySectionForItem("boneless chicken thighs"), "Meat and Seafood");
  assert.equal(grocerySectionForItem("fresh cilantro"), "Produce");
  assert.equal(grocerySectionForItem("ground cumin"), "Sauces, Condiments, and Spices");
});

test("rejects leaked instruction and recipe-title rows without dropping ordinary ingredients", () => {
  assert.equal(isLikelyNonIngredientRow("pat chicken dry", "1", "Dry Rub Grilled Chicken"), true);
  assert.equal(isLikelyNonIngredientRow("cut potatoes in half", "1", "Cast Iron Grilled Potatoes"), true);
  assert.equal(isLikelyNonIngredientRow("cast iron grilled potatoes", "", "Cast Iron Grilled Potatoes"), true);
  assert.equal(isLikelyNonIngredientRow("boneless chicken thighs", "", "Lemon Chicken"), false);
  assert.equal(isLikelyNonIngredientRow("fresh parsley", "", "Lemon Chicken"), false);
});

test("merges recipe quantities into practical shopping units", () => {
  const merged = mergeGroceryItems([
    { Item: "yellow onion, diced", Quantity: "1/2 onion", Recipe: "Soup" },
    { Item: "onion, chopped", Quantity: "1/2 onion", Recipe: "Tacos" },
    { Item: "garlic, minced", Quantity: "6 cloves", Recipe: "Soup" },
    { Item: "fresh garlic", Quantity: "6 cloves", Recipe: "Tacos" },
    { Item: "black beans", Quantity: "1 can", Recipe: "Tacos" },
    { Item: "canned black beans", Quantity: "1 cup", Recipe: "Soup" },
  ]);

  assert.equal(merged.find((item) => item.Item === "onion")?.Quantity, "1 onion");
  assert.equal(merged.find((item) => item.Item === "garlic")?.Quantity, "1 bulb");
  assert.equal(merged.find((item) => item.Item === "black bean")?.Quantity, "2 cans");
});

test("parses mixed and fractional quantity text", () => {
  assert.deepEqual(parseQuantityParts("1 1/2 cups"), { quantity: "1 1/2", unit: "cups" });
  assert.deepEqual(parseQuantityParts("To taste"), { quantity: "To taste", unit: "" });
});
