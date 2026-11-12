import test from "node:test";
import assert from "node:assert/strict";
import { reconcileGrocerySnapshot, groceryItemStableKey } from "../src/domain/listReconciliation.js";
import { recordGroceryEdit } from "../src/domain/groceryEdits.js";
const weekId = "week";
const item = { Item: "Salmon", Quantity: "1 lb", Recipe: "Dinner", "Preferred version/type": "fillets", "Acceptable alternatives": "" };
const sections = (value = item, title = "Seafood") => [{ title, items: [value] }];
const reconcile = (previousState, generatedSections = sections({ ...item, Quantity: "2 lb" }), previousGeneratedSections = []) => reconcileGrocerySnapshot({ previousState, generatedSections, previousGeneratedSections, weekId });

test("grocery preference edits survive scaling, category moves and renamed items without duplicates", () => {
  const edited = recordGroceryEdit(item, "Seafood", "Costco", { ...item, Item: "Wild salmon", "Preferred version/type": "skin on" }, weekId);
  const key = groceryItemStableKey(weekId, { title: "Seafood" }, item);
  const result = reconcile({ sections: sections(edited, "Costco"), checkedKeys: [key] });
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].title, "Costco");
  assert.equal(result.sections[0].items[0].Item, "Wild salmon");
  assert.equal(result.sections[0].items[0].Quantity, "2 lb");
  assert.equal(result.sections[0].items[0]["Preferred version/type"], "skin on");
  assert.deepEqual(result.checkedKeys, [key]);
  assert.equal(reconcile(result).sections[0].items.length, 1);
});

test("explicit quantity override and deliberate blank specification survive regeneration", () => {
  const edited = recordGroceryEdit(item, "Seafood", "Seafood", { ...item, Quantity: "3 lb", "Preferred version/type": "" }, weekId);
  const result = reconcile({ sections: sections(edited) });
  assert.equal(result.sections[0].items[0].Quantity, "3 lb");
  assert.equal(result.sections[0].items[0]["Preferred version/type"], "");
});

test("removed generated items remain removed across repeated regeneration and empty list", () => {
  const key = groceryItemStableKey(weekId, { title: "Seafood" }, item);
  const result = reconcile({ sections: [], removedGroceryKeys: [key], grocerySnapshotVersion: 1 });
  assert.deepEqual(result.sections, []);
  assert.deepEqual(reconcile(result).sections, []);
});

test("legacy baseline preserves changed specifications and quantities but scales untouched quantities", () => {
  const legacy = { sections: sections({ ...item, "Preferred version/type": "wild caught" }) };
  const result = reconcile(legacy, undefined, sections());
  assert.equal(result.sections[0].items[0].Quantity, "2 lb");
  assert.equal(result.sections[0].items[0]["Preferred version/type"], "wild caught");
  const customQuantity = reconcile({ sections: sections({ ...item, Quantity: "3 lb" }) }, undefined, sections());
  assert.equal(customQuantity.sections[0].items[0].Quantity, "3 lb");
});

test("legacy without baseline keeps specifications but does not guess a quantity override", () => {
  const result = reconcile({ sections: sections({ ...item, "Acceptable alternatives": "trout" }) });
  assert.equal(result.sections[0].items[0].Quantity, "2 lb");
  assert.equal(result.sections[0].items[0]["Acceptable alternatives"], "trout");
});

test("manual items survive and generated overrides survive temporary source removal", () => {
  const edited = recordGroceryEdit(item, "Seafood", "Seafood", { ...item, "Preferred version/type": "wild" }, weekId);
  const manual = { Item: "Napkins", Quantity: "1", _manualId: "napkins" };
  const result = reconcile({ sections: [{ title: "Seafood", items: [edited, manual] }] }, []);
  assert.equal(result.sections[0].items.length, 1);
  const restored = reconcile(result);
  assert.equal(restored.sections[0].items[0]["Preferred version/type"], "wild");
  assert.equal(restored.sections[0].items.length, 2);
});


test("legacy renamed or moved rows are retained for review rather than silently discarded", () => {
  const renamed = { ...item, Item: "Wild salmon", "Preferred version/type": "specific cut" };
  const result = reconcile({ sections: sections(renamed, "Costco") }, undefined, sections());
  const preserved = result.sections.find((section) => section.title === "Costco").items[0];
  assert.ok(preserved._manualId.startsWith("legacy-"));
  assert.equal(preserved.Item, "Wild salmon");
  assert.equal(reconcile(result).sections.find((section) => section.title === "Costco").items.length, 1);
});
