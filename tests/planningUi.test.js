import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

// Render the real JSX through the app's own compiler without a browser or Firebase writes.
test("batch editor and cloud status render meaningful controls for each state", async () => {
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, appType: "custom", define: { "import.meta.env.VITE_FIREBASE_API_KEY": JSON.stringify("") } });
  try {
    const { BatchPlanningPanel } = await server.ssrLoadModule("/src/components/BatchPlanningPanel.jsx");
    const { SyncStatusView } = await server.ssrLoadModule("/src/components/SyncStatusBanner.jsx");
    const { GroceryView, updateGrocerySectionsState, removeGroceryItemState } = await server.ssrLoadModule("/src/components/GroceryView.jsx");
    const groceryLoading = renderToStaticMarkup(React.createElement(GroceryView, { week: { id: "loading-week", grocerySections: [] }, search: "" }));
    assert.match(groceryLoading, /Loading grocery list/);
    assert.doesNotMatch(groceryLoading, /No grocery items|No grocery list/);
    const groceryRow = { Item: "Salmon", Quantity: "1 lb", "Preferred version/type": "fillets" };
    const grocerySections = [{ title: "Seafood", items: [groceryRow] }];
    const groceryKey = "test|grocery|seafood|salmon";
    const editedGrocery = updateGrocerySectionsState({ id: "test" }, {}, grocerySections, groceryKey, { item: "Wild salmon", quantity: "1 lb", preferred: "skin on", section: "Seafood" });
    assert.equal(editedGrocery.sections[0].items[0]._grocerySourceKey, groceryKey);
    assert.equal(editedGrocery.sections[0].items[0]._groceryOverrides["Preferred version/type"], "skin on");
    const removedGrocery = removeGroceryItemState({ id: "test" }, editedGrocery, editedGrocery.sections, groceryKey);
    assert.deepEqual(removedGrocery.sections, []);
    assert.deepEqual(removedGrocery.removedGroceryKeys, [groceryKey]);
    assert.equal(removedGrocery.grocerySnapshotVersion, 1);
    const { reconcileGrocerySnapshot } = await server.ssrLoadModule("/src/domain/listReconciliation.js");
    const legacyCustomSections = [{ title: "Seafood", items: [{ ...groceryRow, Quantity: "3 lb" }] }];
    const legacyEdited = updateGrocerySectionsState({ id: "test", grocerySections }, {}, legacyCustomSections, groceryKey, { item: "Salmon", quantity: "3 lb", preferred: "wild", section: "Seafood" });
    assert.equal(legacyEdited.sections[0].items[0]._groceryOverrides.Quantity, "3 lb");
    const regenerated = reconcileGrocerySnapshot({ weekId: "test", previousState: legacyEdited, generatedSections: [{ title: "Seafood", items: [{ ...groceryRow, Quantity: "2 lb" }] }] });
    assert.equal(regenerated.sections[0].items[0].Quantity, "3 lb");
    assert.equal(regenerated.sections[0].items[0]["Preferred version/type"], "wild");
    const source = { Day: "Sunday", Meal: "Salmon", batchId: "batch", planKind: "cook", batchServings: 4, dinnerServings: 2, components: [{ recipeId: "salmon" }] };
    const leftover = { Day: "Monday", planKind: "leftover", leftoverOfBatchId: "batch", dinnerServings: 2, leftoverStorage: "fridge" };
    const docs = [{ id: "salmon", recipe: { servings: 4 } }];
    const renderPanel = (row) => renderToStaticMarkup(React.createElement(BatchPlanningPanel, { row, rows: [source, leftover], docs, onSave() {} }));
    assert.match(renderPanel(source), /Total portions to cook/);
    assert.match(renderPanel(source), /value="4"/);
    assert.match(renderPanel(leftover), /Use batch from/);
    assert.match(renderPanel(leftover), /Sunday: Salmon/);
    assert.match(renderPanel(leftover), /Refrigerate promptly/);
    for (const state of ["saving", "local-only", "error", "synced"]) {
      const html = renderToStaticMarkup(React.createElement(SyncStatusView, { entries: [{ key: "test", label: "Meal plan", state, message: state, canRetry: state === "error" || state === "local-only" }], onRetry() {}, retried: true }));
      assert.match(html, /Cloud save status/);
      if (state === "synced") assert.match(html, /All changes saved to the cloud/);
      if (state === "error" || state === "local-only") assert.match(html, /Retry cloud saves/);
    }
  } finally { await server.close(); }
});
