import assert from "node:assert/strict";
import test from "node:test";
import { batchScaleFactor, batchWarnings, cookingRows, daysBetweenMeals, projectedRowsWithLeftovers, quantityScaleResult, recipeBaseServings, resolveSourceMeal, scaleIngredientForBatch, scaleQuantityText } from "../src/domain/batchPlanning.js";
import { collectPlannedMealIngredients } from "../src/domain/plannedMeals.js";
import { buildGrocerySectionsFromMenuRows } from "../src/domain/groceryEngine.js";

const chicken = { id: "chicken", title: "Chicken bowls", path: "chicken.md", recipe: { servings: 4, ingredients: [{ item: "chicken thighs", quantityText: "2 lb" }, { item: "rice", quantityText: "1 1/2 cups" }] } };
const source = { Day: "Sunday, November 15", Meal: "Chicken bowls", batchId: "batch-one", planKind: "cook", batchServings: 6, dinnerServings: 2, components: [{ recipeId: "chicken", role: "complete" }] };
const leftover = { Day: "Tuesday, November 17", planKind: "leftover", leftoverOfBatchId: "batch-one", dinnerServings: 2, leftoverStorage: "fridge" };

test("recipe yields are explicit; ambiguous ranges do not silently pick a number", () => {
  assert.equal(recipeBaseServings(chicken), 4);
  assert.equal(recipeBaseServings({ markdown: "## Planning Summary\n- Servings: 6 servings" }), 6);
  assert.equal(recipeBaseServings({ recipe: { servings: "4-6" } }), null);
  assert.equal(recipeBaseServings({ recipe: { servings: 0 } }), null);
  assert.equal(recipeBaseServings(null), null);
  assert.equal(batchScaleFactor({}, chicken), 1);
  assert.equal(batchScaleFactor(source, {}), null);
});

test("quantities scale mixed fractions, unicode fractions, ranges and package counts", () => {
  assert.equal(scaleQuantityText("1 1/2 lb", 2), "3 lb");
  assert.equal(scaleQuantityText(".5 cup", 2), "1 cup");
  assert.equal(scaleQuantityText("½ cup", 3), "1 1/2 cup");
  assert.equal(scaleQuantityText("1½ cups", 2), "3 cups");
  assert.equal(scaleQuantityText("1/4-1/2 tsp", 2), "1/2–1 tsp");
  assert.equal(scaleQuantityText("2 to 3 cups", 2), "4–6 cups");
  assert.equal(scaleQuantityText("1 (13.5 oz) can", 2), "2 (13.5 oz) can");
  assert.equal(scaleQuantityText("2 x 14 oz cans", 1.5), "3 x 14 oz cans");
  assert.equal(scaleQuantityText("1 cup", 1), "1 cup");
});

test("ambiguous quantities and unknown yields remain explicit review items", () => {
  assert.ok(quantityScaleResult("to taste", 2).warning);
  assert.ok(quantityScaleResult("13.5 oz can", 2).warning);
  assert.ok(quantityScaleResult("1 cup + 2 tbsp", 2).warning);
  assert.ok(quantityScaleResult("1-inch piece", 2).warning);
  assert.ok(quantityScaleResult("1/0 cup", 2).warning);
  const unchanged = scaleIngredientForBatch(source, {}, { Quantity: "2 lb", Ingredient: "beef" });
  assert.equal(unchanged.Quantity, "2 lb");
  assert.ok(unchanged._scalingWarning);
});

test("linked leftovers never duplicate recipe ingredients, even with stale recipe fields", () => {
  const copiedLeftover = { ...leftover, components: source.components, "Recipe id": "chicken" };
  const ingredients = collectPlannedMealIngredients([source, copiedLeftover], [chicken]);
  assert.deepEqual(ingredients.map(({ ingredient }) => ingredient.quantityText), ["3 lb", "2 1/4 cups"]);
  assert.equal(chicken.recipe.ingredients[0].quantityText, "2 lb");
  assert.equal(ingredients.length, 2);
});

test("legacy repeated cook cards still count separately, duplicate explicit batch IDs warn and count once", () => {
  const legacy = { Meal: "Chicken", components: source.components };
  assert.equal(collectPlannedMealIngredients([legacy, legacy], [chicken]).length, 4);
  assert.equal(cookingRows([source, { ...source, Day: "Monday" }]).length, 1);
  assert.ok(batchWarnings([source, { ...source, Day: "Monday" }], [chicken]).some((warning) => warning.includes("same batch")));
  assert.equal(resolveSourceMeal(leftover, [source, { ...source, Day: "Monday" }]), null);
});

test("linked source follows batch identity after move and labels remain current", () => {
  const moved = { ...source, Day: "Monday, November 16", Meal: "Updated chicken bowls" };
  assert.equal(resolveSourceMeal(leftover, [moved, leftover]), moved);
  assert.equal(projectedRowsWithLeftovers([moved, leftover])[1].Meal, "Leftovers: Updated chicken bowls");
  assert.equal(resolveSourceMeal(null, []), null);
  assert.match(projectedRowsWithLeftovers([leftover])[0].Meal, /missing/);
  assert.ok(batchWarnings([leftover], [chicken]).some((warning) => warning.includes("missing")));
});

test("portion, moved-before-source, storage and custom-date warnings are specific", () => {
  const over = { ...source, batchServings: 3 };
  assert.ok(batchWarnings([over, leftover], [chicken]).some((warning) => warning.includes("4 dinner portions")));
  const moved = { ...source, Day: "Wednesday, November 18" };
  assert.ok(batchWarnings([moved, leftover], [chicken]).some((warning) => warning.includes("before their cooking batch")));
  const late = { ...leftover, Day: "Friday, November 20" };
  assert.ok(batchWarnings([source, late], [chicken]).some((warning) => warning.includes("refrigerator window")));
  const frozen = { ...late, leftoverStorage: "freezer" };
  assert.ok(!batchWarnings([source, frozen], [chicken]).some((warning) => warning.includes("refrigerator window")));
  assert.ok(batchWarnings([source, frozen], [chicken]).some((warning) => warning.includes("freeze portions promptly")));
  assert.ok(batchWarnings([source, { ...leftover, Day: "Ally lunch" }], [chicken]).some((warning) => warning.includes("dates manually")));
});

test("date differences handle full dates and New Year without guessing custom cards", () => {
  assert.equal(daysBetweenMeals({ Day: "2026-11-15" }, { Day: "2026-11-19" }), 4);
  assert.equal(daysBetweenMeals({ Day: "Thursday, December 31" }, { Day: "Friday, January 1" }), 1);
  assert.equal(daysBetweenMeals({ Day: "Sunday" }, { Day: "Tuesday" }), 2);
  assert.equal(daysBetweenMeals({ Day: "Party" }, { Day: "Lunch" }), null);
});

test("grocery output uses scaled quantities once and exposes manual scaling notes", () => {
  const doc = { ...chicken, recipe: { ...chicken.recipe, ingredients: [{ Quantity: "2 lb", Ingredient: "chicken thighs" }, { Quantity: "to taste", Ingredient: "salt" }] } };
  const sections = buildGrocerySectionsFromMenuRows([source, leftover], [doc], (recipe) => recipe.recipe.ingredients);
  const items = sections.flatMap((section) => section.items);
  assert.equal(items.find((item) => item.Item.toLowerCase().includes("chicken")).Quantity, "3 lb");
  assert.ok(items.find((item) => item.Item.toLowerCase().includes("salt"))["Preferred version/type"].includes("manually"));
});


test("package counts scale without changing package sizes or item dimensions", () => {
  assert.equal(scaleQuantityText("2 x 400 g cans", 2), "4 x 400 g cans");
  assert.equal(scaleQuantityText("2 (14 oz) cans", 1.5), "3 (14 oz) cans");
  assert.equal(scaleQuantityText("1/4\u20131/2 tsp", 2), "1/2\u20131 tsp");
  const dimension = quantityScaleResult("1-inch piece", 2);
  assert.ok(dimension.text.startsWith("1-inch piece (adjust for "));
  assert.ok(dimension.warning.includes("manually"));
});

test("composed recipes scale each component against its own yield and resolve nested or legacy IDs", () => {
  const side = { id: "side-document", title: "Rice", recipe: { id: "rice-recipe", servings: 2, ingredients: [{ item: "rice", quantityText: "1 cup" }] } };
  const row = { ...source, components: [{ recipeId: "rice-recipe", role: "side" }, { recipeId: chicken.id, role: "main" }] };
  const collected = collectPlannedMealIngredients([row, leftover], [chicken, side]);
  assert.deepEqual(collected.map(({ ingredient }) => ingredient.quantityText), ["3 lb", "2 1/4 cups", "3 cup"]);
  const warnings = batchWarnings([row], [chicken, side]);
  assert.ok(warnings.some((warning) => warning.includes("Chicken bowls uses a 1 1/2")));
  assert.ok(warnings.some((warning) => warning.includes("Rice uses a 3")));
  for (const field of ["Recipe id", "recipeId"]) {
    const legacy = { ...source, components: [], [field]: "rice-recipe" };
    assert.equal(collectPlannedMealIngredients([legacy], [side])[0].ingredient.quantityText, "3 cup");
    assert.ok(!batchWarnings([legacy], [side]).some((warning) => warning.includes("attach a recipe")));
  }
});

test("missing composed components and markdown-only quantities prompt manual review", () => {
  const partial = { ...source, components: [...source.components, { recipeId: "missing", role: "side" }] };
  assert.ok(batchWarnings([partial], [chicken]).some((warning) => warning.includes("missing recipe component")));
  const markdownDoc = { id: "chicken", title: "Markdown meal", markdown: "- Servings: 4" };
  assert.ok(batchWarnings([source], [markdownDoc]).some((warning) => warning.includes("Review the grocery/prep quantities")));
  const unknownYield = { ...chicken, recipe: { ingredients: chicken.recipe.ingredients } };
  assert.ok(batchWarnings([source], [unknownYield]).some((warning) => warning.includes("remain unscaled")));
});
