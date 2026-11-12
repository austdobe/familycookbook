import assert from "node:assert/strict";
import test from "node:test";

import { clearMenuRowForDay } from "../src/domain/weekMenuRows.js";

test("clearing a menu row removes current and legacy recipe references", () => {
  const otherRow = { Day: "Monday", Meal: "Soup" };
  const [cleared, unchanged] = clearMenuRowForDay([
    {
      Day: "Sunday",
      Meal: "Slaw",
      components: [{ recipeId: "slaw", role: "complete" }],
      "Recipe id": "slaw",
      recipeId: "legacy-slaw",
      "Recipe file": "slaw.md",
    },
    otherRow,
  ], "Sunday");

  assert.equal(cleared.Meal, "");
  assert.deepEqual(cleared.components, []);
  assert.equal(cleared["Recipe id"], "");
  assert.equal(cleared.recipeId, "");
  assert.equal(cleared["Recipe file"], "");
  assert.equal(unchanged, otherRow);
});


test("clearing a cook or leftover removes batch links and portion settings", () => {
  const [row] = clearMenuRowForDay([{ Day: "Monday", Meal: "Leftovers", planKind: "leftover", batchId: "old", leftoverOfBatchId: "batch", batchServings: 6, dinnerServings: 2, leftoverStorage: "fridge" }], "Monday");
  assert.equal(row.batchId, "");
  assert.equal(row.leftoverOfBatchId, "");
  assert.equal(row.planKind, "");
  assert.equal(row.batchServings, null);
});
