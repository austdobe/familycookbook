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
