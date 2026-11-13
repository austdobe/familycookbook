import { mealDisplayName } from "./mealNames.js";
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const unicodeFractions = { "¼": "1/4", "½": "1/2", "¾": "3/4", "⅓": "1/3", "⅔": "2/3", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8" };
const numberPattern = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)`;
const quantityPattern = new RegExp(`^(${numberPattern})(?:\\s*(?:-|–|—|to)\\s*(${numberPattern}))?(.*)$`, "i");

export function positivePortions(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function recipeBaseServings(doc) {
  const value = doc?.recipe?.servings ?? doc?.servings;
  if (typeof value === "number") return positivePortions(value);
  const text = String(value || "").trim() || String(doc?.markdown || doc?.recipe?.sourceMarkdown || "").match(/^\s*(?:[-*]\s*)?Servings\s*:\s*(.+)$/im)?.[1]?.trim() || "";
  const match = text.match(/^(\d+(?:\.\d+)?)(?:\s+(?:servings?|portions?|people|adults?))?\s*$/i);
  return match ? positivePortions(match[1]) : null;
}

export function batchScaleFactor(row, doc) {
  const requested = positivePortions(row?.batchServings);
  if (!requested) return 1;
  const base = recipeBaseServings(doc);
  return base ? requested / base : null;
}

function normalizedQuantity(value) {
  return String(value ?? "").trim().replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, "$1 $2").replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, (fraction) => unicodeFractions[fraction]);
}

function parseNumber(value) {
  if (!value.includes("/")) return Number(value);
  const parts = value.trim().split(/\s+/);
  const [numerator, denominator] = parts.pop().split("/").map(Number);
  if (!denominator) return NaN;
  return (parts.length ? Number(parts[0]) : 0) + numerator / denominator;
}

function displayNumber(value) {
  const whole = Math.floor(value + 1e-9);
  const fraction = value - whole;
  for (const denominator of [2, 3, 4, 8, 16]) {
    const numerator = Math.round(fraction * denominator);
    if (numerator && numerator < denominator && Math.abs(fraction - numerator / denominator) < 0.0001) return `${whole ? `${whole} ` : ""}${numerator}/${denominator}`;
  }
  return String(Number(value.toFixed(3)));
}

export function quantityScaleResult(text, factor) {
  const original = String(text ?? "").trim();
  if (factor === 1) return { text: original, warning: "" };
  if (!Number.isFinite(factor) || factor <= 0) return { text: original, warning: "Set a valid recipe serving count before scaling this amount." };
  const match = normalizedQuantity(original).match(quantityPattern);
  // Do not mistake package sizes, item dimensions, or multiple alternative units for a simple count.
  const suffix = match?.[3] || "";
  const unsafeSuffix = /^\s*(?:oz|ounce|g|gram|ml|liter|litre)s?[- ]+(?:can|jar|package|bottle)\b/i.test(suffix)
    || /\s+\+\s+|\s+or\s+|\s+\/\s+/.test(suffix)
    || /^\s*[-–]\s*[A-Za-z]/.test(suffix);
  if (!match || unsafeSuffix) return { text: `${original || "Unspecified amount"} (adjust for ${displayNumber(factor)}× batch)`, warning: `Check the amount "${original || "unspecified"}" manually for the ${displayNumber(factor)}× batch.` };
  const first = parseNumber(match[1]);
  const last = match[2] ? parseNumber(match[2]) : null;
  if (!Number.isFinite(first) || (last !== null && !Number.isFinite(last))) return { text: original, warning: `Cannot scale "${original}" safely.` };
  return { text: `${displayNumber(first * factor)}${last !== null ? `–${displayNumber(last * factor)}` : ""}${suffix}`, warning: "" };
}

export function scaleQuantityText(text, factor) {
  return quantityScaleResult(text, factor).text;
}

export function scaleIngredientForBatch(row, doc, ingredient) {
  const factor = batchScaleFactor(row, doc);
  if (factor === 1) return ingredient;
  const quantityKey = Object.hasOwn(ingredient, "Quantity") ? "Quantity" : Object.hasOwn(ingredient, "quantityText") ? "quantityText" : "quantity";
  const original = ingredient[quantityKey] ?? "";
  const result = quantityScaleResult(original, factor);
  return { ...ingredient, [quantityKey]: result.text, _scalingWarning: result.warning };
}

export function cookingRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    if (row.planKind === "leftover") return false;
    if (!row.batchId) return true;
    if (seen.has(row.batchId)) return false;
    seen.add(row.batchId);
    return true;
  });
}

export function resolveSourceMeal(row, rows = []) {
  if (!row) return null;
  if (row.planKind !== "leftover") return row;
  if (!row.leftoverOfBatchId) return null;
  const sources = rows.filter((candidate) => candidate.planKind !== "leftover" && candidate.batchId === row.leftoverOfBatchId);
  return sources.length === 1 ? sources[0] : null;
}

export function projectedRowsWithLeftovers(rows = []) {
  return rows.map((row) => {
    if (row.planKind !== "leftover") return row;
    const source = resolveSourceMeal(row, rows);
    return { ...row, Meal: source?.Meal ? `Leftovers: ${mealDisplayName(source)}` : "Leftovers: source meal missing or conflicting" };
  });
}

// Date labels in a single planning week are allowed to omit their year.
export function daysBetweenMeals(source, leftover) {
  const values = [source, leftover].map((row) => String(row?.date || row?.Day || ""));
  const iso = values.map((text) => text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/));
  if (iso.every(Boolean)) return (Date.UTC(+iso[1][1], +iso[1][2] - 1, +iso[1][3]) - Date.UTC(+iso[0][1], +iso[0][2] - 1, +iso[0][3])) / 86400000;
  const dated = values.map((text) => text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i));
  if (dated.every(Boolean)) {
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const firstYear = Number(dated[0][3] || dated[1][3] || 2000);
    let secondYear = Number(dated[1][3] || firstYear);
    const firstMonth = months.indexOf(dated[0][1].toLowerCase());
    const secondMonth = months.indexOf(dated[1][1].toLowerCase());
    if (!dated[1][3] && firstMonth === 11 && secondMonth === 0) secondYear++;
    return (Date.UTC(secondYear, secondMonth, +dated[1][2]) - Date.UTC(firstYear, firstMonth, +dated[0][2])) / 86400000;
  }
  const indices = values.map((text) => weekdays.findIndex((day) => new RegExp(`\\b${day}\\b`, "i").test(text)));
  return indices.every((index) => index >= 0) ? indices[1] - indices[0] : null;
}

function recipeIdsForRow(row) {
  return Array.isArray(row.components) && row.components.length
    ? row.components.map((component) => component?.recipeId).filter(Boolean)
    : [row["Recipe id"] || row.recipeId].filter(Boolean);
}

function docsForRow(row, docs) {
  return recipeIdsForRow(row).map((id) => docs.find((doc) => doc.id === id || doc.recipe?.id === id)).filter(Boolean);
}

export function batchWarnings(rows = [], docs = []) {
  const warnings = [];
  const sources = cookingRows(rows);
  const ids = rows.filter((row) => row.planKind !== "leftover" && row.batchId).map((row) => row.batchId);
  for (const id of new Set(ids.filter((id, index) => ids.indexOf(id) !== index))) warnings.push(`Multiple cooking cards use the same batch: ${rows.filter((row) => row.planKind !== "leftover" && row.batchId === id).map((row) => row.Day).join(", ")}. Relink those meals before relying on quantities.`);
  for (const source of sources) {
    const linked = rows.filter((row) => row.planKind === "leftover" && row.leftoverOfBatchId === source.batchId && source.batchId);
    const total = positivePortions(source.batchServings);
    if (linked.length && !total) warnings.push(`${source.Day}: set total batch servings so leftover portions can be checked.`);
    if (total) {
      const allocated = [source, ...linked].reduce((sum, row) => sum + (positivePortions(row.dinnerServings) || 0), 0);
      if ([source, ...linked].some((row) => !positivePortions(row.dinnerServings))) warnings.push(`${source.Day}: enter portions for each dinner to check whether the batch is large enough.`);
      if (allocated > total) warnings.push(`${source.Day}: ${allocated} dinner portions are planned from a ${total}-serving batch.`);
      const recipes = docsForRow(source, docs);
      if (recipes.length < recipeIdsForRow(source).length) warnings.push(`${source.Day}: a missing recipe component was not included in grocery/prep quantities. Restore or replace it before relying on the list.`);
      if (!recipes.length) warnings.push(`${source.Day}: attach a recipe before using batch ingredient scaling.`);
      for (const doc of recipes) {
        const factor = batchScaleFactor(source, doc);
        if (factor === null) warnings.push(`${source.Day}: ${doc.title || "Recipe"} has no unambiguous serving count. Ingredient quantities remain unscaled; review them manually.`);
        else if (factor !== 1) {
          warnings.push(`${source.Day}: ${doc.title || "Recipe"} uses a ${displayNumber(factor)}× batch. Grocery/prep ingredient amounts are scaled; written cooking instructions still show the original recipe amounts.`);
          const ingredients = doc.recipe?.ingredients || [];
          if (!ingredients.length) warnings.push(`${source.Day}: ${doc.title || "Recipe"} has no structured ingredient list to validate. Review the grocery/prep quantities and manual-scaling notes before cooking.`);
          if (ingredients.some((ingredient) => quantityScaleResult(ingredient.quantityText || ingredient.Quantity || ingredient.quantity, factor).warning)) warnings.push(`${source.Day}: some quantities in ${doc.title || "the recipe"} need manual scaling. Check the grocery list notes.`);
        }
      }
    }
  }
  for (const leftover of rows.filter((row) => row.planKind === "leftover")) {
    const source = resolveSourceMeal(leftover, rows);
    if (!source || !source.Meal) {
      warnings.push(`${leftover.Day}: leftover source is missing or conflicting. Choose a cooking batch.`);
      continue;
    }
    const days = daysBetweenMeals(source, leftover);
    if (days === null) warnings.push(`${leftover.Day}: check the cook/eat dates manually for this custom card; safe storage timing cannot be calculated.`);
    else if (days < 0) warnings.push(`${leftover.Day}: leftovers are scheduled before their cooking batch on ${source.Day}. Move or relink the meal.`);
    else if (days > 4 && leftover.leftoverStorage !== "freezer") warnings.push(`${leftover.Day}: ${days} days after cooking is beyond the usual 3–4 day refrigerator window. Freeze promptly or move the meal earlier.`);
    if (leftover.leftoverStorage === "freezer") warnings.push(`${leftover.Day}: freeze portions promptly after cooling on cook day; thaw in the refrigerator before this meal.`);
  }
  return [...new Set(warnings)];
}
