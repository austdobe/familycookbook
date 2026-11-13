import { mealDisplayName } from "../domain/mealNames.js";
import React, { useEffect, useState } from "react";
import { recipeBaseServings, resolveSourceMeal } from "../domain/batchPlanning.js";

export function BatchPlanningPanel({ row, rows, docs, onSave }) {
  const [kind, setKind] = useState(row?.planKind === "leftover" ? "leftover" : "cook");
  const [batchServings, setBatchServings] = useState(row?.batchServings ? String(row.batchServings) : "");
  const [dinnerServings, setDinnerServings] = useState(String(row?.dinnerServings || 2));
  const [sourceDay, setSourceDay] = useState(rows.find((candidate) => candidate.batchId && candidate.batchId === row?.leftoverOfBatchId)?.Day || "");
  const [storage, setStorage] = useState(row?.leftoverStorage || "fridge");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const source = resolveSourceMeal(row, rows);
  const sourceRecipeId = source?.components?.[0]?.recipeId || source?.["Recipe id"] || source?.recipeId;
  const sourceDoc = sourceRecipeId ? docs.find((doc) => doc.id === sourceRecipeId || doc.recipe?.id === sourceRecipeId) : null;
  const base = recipeBaseServings(sourceDoc);
  const choices = rows.filter((candidate) => candidate.Day !== row?.Day && candidate.planKind !== "leftover" && (candidate.components?.length || candidate["Recipe id"] || candidate.recipeId));

  useEffect(() => {
    setKind(row?.planKind === "leftover" ? "leftover" : "cook");
    setBatchServings(row?.batchServings ? String(row.batchServings) : "");
    setDinnerServings(String(row?.dinnerServings || 2));
    setSourceDay(rows.find((candidate) => candidate.batchId && candidate.batchId === row?.leftoverOfBatchId)?.Day || "");
    setStorage(row?.leftoverStorage || "fridge");
    setError("");
  }, [row?.Day, row?.planKind, row?.batchServings, row?.dinnerServings, row?.leftoverOfBatchId, row?.leftoverStorage]);

  if (!row) return null;
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await onSave({ kind, batchServings: batchServings === "" ? null : Number(batchServings), dinnerServings: Number(dinnerServings), sourceDay, storage });
      if (result?.ok === false) setError(result.error);
    } catch (error) { setError(error.message || "Could not save batch plan."); }
    finally { setSaving(false); }
  };
  return (
    <section className="card batch-planning-panel" aria-label="Batch and leftovers">
      <h3>Batch cooking and leftovers</h3>
      <p>Cook once, then link the nights that use that batch. Groceries count the cooking batch only.</p>
      <div className="batch-fields">
        <label>Meal plan type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="cook">Cook a batch</option><option value="leftover">Eat leftovers</option></select></label>
        {kind === "cook" ? <label>Total portions to cook<input min="1" max="100" step="1" type="number" value={batchServings} placeholder={base ? `Recipe makes ${base}` : "Use recipe yield"} onChange={(event) => setBatchServings(event.target.value)} /></label> : <label>Use batch from<select value={sourceDay} onChange={(event) => setSourceDay(event.target.value)}><option value="">Choose a cooking day</option>{choices.map((candidate) => <option key={candidate.Day} value={candidate.Day}>{candidate.Day}: {mealDisplayName(candidate, docs)}</option>)}</select></label>}
        <label>Portions eaten this night<input min="1" max="100" step="1" type="number" value={dinnerServings} onChange={(event) => setDinnerServings(event.target.value)} /></label>
        {kind === "leftover" ? <label>Storage before this night<select value={storage} onChange={(event) => setStorage(event.target.value)}><option value="fridge">Refrigerator</option><option value="freezer">Freeze promptly, then thaw</option></select></label> : null}
      </div>
      {kind === "cook" ? <p className="dialog-help">Leave total portions blank to keep each recipe's original yield. Set it to cover dinner plus all leftover nights. This changes the week, not your saved recipe.</p> : <p className="dialog-help">Refrigerate promptly within 2 hours in shallow containers. Use refrigerated leftovers within 3–4 days; freeze promptly for later nights. Reheat hot leftovers to 165°F.</p>}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      <button className="primary-button" disabled={saving} onClick={save} type="button">{saving ? "Saving..." : "Save Batch Plan"}</button>
    </section>
  );
}
