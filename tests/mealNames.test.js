import assert from "node:assert/strict";
import test from "node:test";
import { defaultMealName, isComposedMeal, mealCustomName, mealDisplayName, withMealName } from "../src/domain/mealNames.js";

const docs = [{ id: "turkey", title: "Roast turkey" }, { id: "potatoes", title: "Mashed potatoes" }];
const row = { Day: "Thursday, November 26", Meal: "Roast turkey + Mashed potatoes", mealType: "composed", components: [{ recipeId: "turkey", role: "main" }, { recipeId: "potatoes", role: "side" }] };

test("composed and hybrid classification does not alter single complete, leftover or flexible meals", () => {
  assert.equal(isComposedMeal(row), true);
  assert.equal(isComposedMeal({ ...row, mealType: "hybrid" }), true);
  assert.equal(isComposedMeal({ components: [{ recipeId: "one", role: "main" }] }), true);
  assert.equal(isComposedMeal({ components: [{ recipeId: "one", role: "complete" }] }), false);
  assert.equal(isComposedMeal({ ...row, planKind: "leftover" }), false);
  assert.equal(isComposedMeal({ ...row, planKind: "flexible" }), false);
  assert.equal(isComposedMeal(null), false);
});

test("generated component concatenation gets a day fallback, not a dinner slot", () => {
  assert.equal(mealDisplayName(row, docs), "Thursday's meal");
  assert.equal(mealCustomName(row, docs), "");
  assert.equal(defaultMealName({ Day: "sunday, Nov 15" }), "Sunday's meal");
  assert.equal(defaultMealName({ Day: "Ally lunches" }), "Meal for Ally lunches");
  assert.equal(defaultMealName({}), "This meal");
});

test("explicit optional names preserve intent even when they contain plus signs", () => {
  assert.equal(mealDisplayName({ ...row, customMealName: "  Thanksgiving   Dinner " }, docs), "Thanksgiving Dinner");
  assert.equal(mealDisplayName({ ...row, customMealName: row.Meal }, docs), row.Meal);
  assert.equal(mealCustomName({ ...row, customMealName: "" }, docs), "");
});

test("meaningful legacy names are preserved without migration writes", () => {
  const old = { ...row, Meal: "Thanksgiving" };
  const before = JSON.stringify(old);
  assert.equal(mealDisplayName(old, docs), "Thanksgiving");
  assert.equal(mealCustomName(old, docs), "Thanksgiving");
  assert.equal(JSON.stringify(old), before);
  assert.equal(mealDisplayName({ ...row, Meal: "Friends + family supper" }, docs), "Friends + family supper");
});

test("missing legacy identities use plus fallback only on multi-component meals", () => {
  assert.equal(mealDisplayName(row), "Thursday's meal");
  const single = { Day: "Monday", Meal: "Mac + cheese", components: [{ recipeId: "mac", role: "complete" }] };
  assert.equal(mealDisplayName(single), "Mac + cheese");
  assert.equal(mealDisplayName({ ...single, mealType: "composed", components: [{ recipeId: "mac", role: "main" }] }), "Mac + cheese");
});

test("single recipes preserve their title and resolve missing legacy Meal through recipe ID", () => {
  assert.equal(mealDisplayName({ Day: "Monday", components: [{ recipeId: "turkey", role: "complete" }] }, docs), "Roast turkey");
  assert.equal(mealDisplayName({ "Recipe id": "turkey" }, docs), "Roast turkey");
  assert.equal(mealDisplayName(null, docs), "");
  assert.equal(mealDisplayName({}, docs), "");
});

test("name save is pure and survives JSON persistence", () => {
  const before = JSON.stringify(row);
  const named = withMealName(row, " Thanksgiving ", docs);
  assert.equal(named.customMealName, "Thanksgiving");
  assert.equal(named.Meal, "Thanksgiving");
  assert.equal(mealDisplayName(JSON.parse(JSON.stringify(named)), docs), "Thanksgiving");
  assert.equal(JSON.stringify(row), before);
  assert.equal(named.components, row.components);
});

test("clear name stores an explicit empty marker that suppresses stale legacy names after moving", () => {
  const cleared = withMealName({ ...row, Meal: "Thanksgiving", customMealName: "Thanksgiving" }, "  ", docs);
  assert.equal(cleared.customMealName, "");
  assert.equal(cleared.Meal, "Thursday's meal");
  const roundtrip = JSON.parse(JSON.stringify(cleared));
  assert.equal(mealDisplayName({ ...roundtrip, Day: "Friday, November 27" }, docs), "Friday's meal");
  assert.equal(mealDisplayName({ ...roundtrip, Meal: "Old Thanksgiving" }, docs), "Thursday's meal");
});

test("leftover labels and noncomposed edits remain unchanged", () => {
  const leftover = { ...row, planKind: "leftover", customMealName: "Thanksgiving", Meal: "Leftovers: Thanksgiving" };
  assert.equal(mealDisplayName(leftover, docs), "Leftovers: Thanksgiving");
  assert.equal(withMealName(leftover, "Other", docs), leftover);
  assert.equal(mealDisplayName({ Day: "Saturday", planKind: "flexible", Meal: "Flexible" }), "Flexible");
});

test("component roles determine exact generated projection and malformed names are ignored", () => {
  const reversed = { ...row, components: [...row.components].reverse() };
  assert.equal(mealDisplayName(reversed, docs), "Thursday's meal");
  assert.equal(mealDisplayName({ ...row, customMealName: null }, docs), "Thursday's meal");
});


test("legacy generated labels are recognized in insertion order as well as role order", () => {
  const reversed = { ...row, components: [...row.components].reverse(), Meal: "Mashed potatoes + Roast turkey" };
  assert.equal(mealDisplayName(reversed, docs), "Thursday's meal");
});


test("a single composed main uses the day fallback only when its old name matches its resolved recipe", () => {
  const main = { Day: "Thursday", mealType: "composed", Meal: "Roast turkey", components: [{ recipeId: "turkey", role: "main" }] };
  assert.equal(mealDisplayName(main, docs), "Thursday's meal");
  assert.equal(mealDisplayName(main), "Roast turkey", "unresolved names are preserved");
  assert.equal(mealDisplayName({ ...main, customMealName: "Roast turkey" }, docs), "Roast turkey");
  assert.equal(mealDisplayName({ ...main, mealType: "complete_recipe", components: [{ recipeId: "turkey", role: "complete" }] }, docs), "Roast turkey");
});
