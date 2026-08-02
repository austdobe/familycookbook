import test from "node:test";
import assert from "node:assert/strict";
import {
  groceryItemStableKey,
  prepTaskStableKey,
  reconcileGrocerySnapshot,
  reconcilePrepCheckedKeys,
} from "../src/domain/listReconciliation.js";

test("grocery keys survive quantity and ordering changes", () => {
  const weekId = "week-32";
  const previousSections = [{ title: "Produce", items: [
    { Item: "Tomatoes", Quantity: "1 cup", Recipe: "Tacos" },
    { Item: "Lettuce", Quantity: "2 cups", Recipe: "Tacos" },
  ] }];
  const legacyCheckedKey = [weekId, 0, "Produce", 1, "2 cups", "Lettuce", "Tacos"].join("|");
  const generatedSections = [{ title: "Produce", items: [
    { Item: "Lettuce", Quantity: "3 cups", Recipe: "Tacos, Salad" },
    { Item: "Tomatoes", Quantity: "1 cup", Recipe: "Tacos" },
  ] }];
  const reconciled = reconcileGrocerySnapshot({
    generatedSections,
    previousState: { checkedKeys: [legacyCheckedKey], sections: previousSections },
    weekId,
  });
  assert.deepEqual(reconciled.checkedKeys, [groceryItemStableKey(weekId, generatedSections[0], generatedSections[0].items[0])]);
});

test("manual grocery rows and legacy manual items survive regeneration", () => {
  const manual = { _manualId: "manual-1", Item: "Birthday candles", Quantity: "1", Recipe: "Manual add" };
  const reconciled = reconcileGrocerySnapshot({
    generatedSections: [{ title: "Produce", items: [{ Item: "Apples", Quantity: "4" }] }],
    previousState: {
      checkedKeys: [],
      manualItems: [{ id: "legacy-1", item: "Napkins", section: "Costco" }],
      sections: [{ title: "Other", items: [manual] }],
    },
    weekId: "week-32",
  });
  assert.equal(reconciled.manualItems.length, 1);
  assert.equal(reconciled.sections.find((section) => section.title === "Other").items[0]._manualId, "manual-1");
});

test("prep checks survive generated task reordering", () => {
  const parseTasks = (markdown) => markdown.split("\n").filter(Boolean).map((title, index) => ({ index, title, details: "- Meal ownership: Tacos" }));
  const previousSections = [{ title: "Sunday Prep", markdown: "Thaw beef\nChop onions" }];
  const oldTask = parseTasks(previousSections[0].markdown)[1];
  const legacyKey = ["week-32", "Sunday Prep", oldTask.index, oldTask.title].join("|");
  const generatedSections = [{ title: "Sunday Prep", markdown: "Chop onions\nThaw beef" }];
  const checkedKeys = reconcilePrepCheckedKeys({
    generatedSections,
    parseTasks,
    previousState: { checkedKeys: [legacyKey], sections: previousSections },
    weekId: "week-32",
  });
  assert.deepEqual(checkedKeys, [prepTaskStableKey("week-32", generatedSections[0], parseTasks(generatedSections[0].markdown)[0])]);
});
