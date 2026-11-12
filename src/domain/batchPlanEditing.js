import { clearMenuRowForDay } from "./weekMenuRows.js";

export function applyBatchPlan(rows, selectedDay, input, hasRecipe, makeId = () => crypto.randomUUID()) {
  const { kind, batchServings, dinnerServings, sourceDay, storage } = input;
  const selected = rows.find((row) => row.Day === selectedDay);
  if (!selected || !Number.isInteger(dinnerServings) || dinnerServings < 1 || dinnerServings > 100) return { error: "Choose 1–100 whole portions for this night." };
  if (kind !== "leftover" && batchServings !== null && (!Number.isInteger(batchServings) || batchServings < 1 || batchServings > 100)) return { error: "Choose 1–100 total portions, or leave the total blank." };
  if (kind === "leftover") {
    const source = rows.find((row) => row.Day === sourceDay && row.Day !== selectedDay && row.planKind !== "leftover");
    if (!source || !hasRecipe(source)) return { error: "Choose a cooking day with a saved recipe." };
    const batchId = source.batchId || makeId();
    return { rows: rows.map((row) => {
      if (row.Day === source.Day) return { ...row, planKind: "cook", batchId, dinnerServings: row.dinnerServings || 2 };
      if (row.Day !== selectedDay) return row;
      return { ...clearMenuRowForDay([row], row.Day)[0], planKind: "leftover", leftoverOfBatchId: batchId, dinnerServings, leftoverStorage: storage === "freezer" ? "freezer" : "fridge", Meal: `Leftovers: ${source.Meal}` };
    }) };
  }
  if (!hasRecipe(selected) || selected.planKind === "leftover") return { error: "Attach a recipe to this day first, then set its batch portions." };
  return { rows: rows.map((row) => row.Day !== selectedDay ? row : { ...row, planKind: "cook", batchId: row.batchId || makeId(), batchServings, dinnerServings, leftoverOfBatchId: "", leftoverStorage: "" }) };
}
