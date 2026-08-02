import test from "node:test";
import assert from "node:assert/strict";
import { parsePrepTasks, prepDetailValue } from "../src/domain/prepTasks.js";

test("prep task parser preserves checklist order and nested details", () => {
  const tasks = parsePrepTasks(`- [ ] Chop vegetables
  - Ingredients: carrots, onions
  - Instructions: Chop into even pieces.
- [x] Mix sauce
  - Storage method: Covered jar in refrigerator.`);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].index, 0);
  assert.equal(tasks[0].title, "Chop vegetables");
  assert.equal(prepDetailValue(tasks[0].details, "Ingredients"), "carrots, onions");
  assert.equal(prepDetailValue(tasks[1].details, "Storage method"), "Covered jar in refrigerator.");
});
