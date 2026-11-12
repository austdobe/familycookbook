import test from "node:test";
import assert from "node:assert/strict";
import { applyBatchPlan } from "../src/domain/batchPlanEditing.js";
import { projectedRowsWithLeftovers, batchWarnings } from "../src/domain/batchPlanning.js";

const rows = [{ Day: "Sunday", Meal: "Chicken", components: [{ recipeId: "chicken" }], "Recipe id": "chicken" }, { Day: "Monday", Meal: "Beef", components: [{ recipeId: "beef" }], "Recipe id": "beef" }];
const hasRecipe = (row) => Boolean(row.components?.length);
const leftover = { kind: "leftover", batchServings: null, dinnerServings: 2, sourceDay: "Sunday", storage: "fridge" };

test("linking creates one stable source batch and clears stale target recipe references", () => {
  const result = applyBatchPlan(rows, "Monday", leftover, hasRecipe, () => "batch-1");
  assert.equal(result.rows[0].batchId, "batch-1");
  assert.equal(result.rows[1].leftoverOfBatchId, "batch-1");
  assert.deepEqual(result.rows[1].components, []);
  assert.equal(result.rows[1]["Recipe id"], "");
  assert.equal(result.rows[1].Meal, "Leftovers: Chicken");
  assert.equal(rows[1].Meal, "Beef");
});

test("portion edits reuse source identity, and linked titles follow source changes", () => {
  let result = applyBatchPlan(rows, "Monday", leftover, hasRecipe, () => "batch-1");
  result = applyBatchPlan(result.rows, "Sunday", { kind: "cook", batchServings: 6, dinnerServings: 2 }, hasRecipe, () => "wrong");
  assert.equal(result.rows[0].batchId, "batch-1");
  assert.equal(result.rows[0].batchServings, 6);
  result.rows[0].Meal = "Fajitas";
  assert.equal(projectedRowsWithLeftovers(result.rows)[1].Meal, "Leftovers: Fajitas");
});

test("cannot link to self or to another leftover and validates quantities", () => {
  assert.ok(applyBatchPlan(rows, "Sunday", leftover, hasRecipe).error);
  const linked = applyBatchPlan(rows, "Monday", leftover, hasRecipe, () => "batch-1").rows;
  assert.ok(applyBatchPlan(linked, "Sunday", { ...leftover, sourceDay: "Monday" }, hasRecipe).error);
  assert.ok(applyBatchPlan(rows, "Sunday", { kind: "cook", batchServings: 0, dinnerServings: 2 }, hasRecipe).error);
  assert.ok(applyBatchPlan(rows, "Sunday", { kind: "cook", batchServings: 4, dinnerServings: 1.5 }, hasRecipe).error);
});

test("source moved after leftover is visibly flagged, not silently relinked", () => {
  const linked = applyBatchPlan(rows, "Monday", leftover, hasRecipe, () => "batch-1").rows;
  const moved = linked.map((row) => row.batchId ? { ...row, Day: "Wednesday" } : row);
  assert.ok(batchWarnings(moved, []).some((warning) => warning.includes("before their cooking batch")));
});
