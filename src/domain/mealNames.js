// Optional names belong to the planned meal, never to its component recipes.
const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
const ROLE_ORDER = { complete: 0, main: 1, side: 2, sauce: 3, bread: 4, dessert: 5, drink: 6 };
const componentsFor = (row) => Array.isArray(row?.components) ? row.components.filter((component) => component?.recipeId) : [];

export function isComposedMeal(row) {
  if (!row || row.planKind === "leftover" || row.planKind === "flexible") return false;
  const components = componentsFor(row);
  return row.mealType === "composed" || row.mealType === "hybrid"
    || components.length > 1
    || (components.length === 1 && Boolean(components[0].role) && components[0].role !== "complete");
}

function componentNames(row, docs, sortByRole = false) {
  return componentsFor(row)
    .map((component, index) => ({ component, index }))
    .sort((a, b) => sortByRole ? (ROLE_ORDER[a.component.role] ?? 99) - (ROLE_ORDER[b.component.role] ?? 99) || a.index - b.index : a.index - b.index)
    .map(({ component }) => {
      const doc = (Array.isArray(docs) ? docs : []).find((candidate) => candidate?.id === component.recipeId || candidate?.recipe?.id === component.recipeId);
      return clean(doc?.title || doc?.recipe?.title || component.title);
    });
}

function isGeneratedName(row, docs, name) {
  const components = componentsFor(row);
  if (!components.length) return false;
  const names = componentNames(row, docs);
  if (components.length === 1) return components[0].role !== "complete" && Boolean(names[0]) && name === names[0];
  if (names.length === components.length && names.every(Boolean)) return name === names.join(" + ") || name === componentNames(row, docs, true).join(" + ");
  // Old rows may predate recipe IDs or current titles. Only a multi-component
  // row without fully resolvable names gets this legacy concatenation fallback.
  return /\s\+\s/.test(name);
}

export function mealCustomName(row, docs = []) {
  if (!isComposedMeal(row)) return "";
  if (typeof row.customMealName === "string") return clean(row.customMealName);
  const legacy = clean(row.Meal);
  return legacy && !isGeneratedName(row, docs, legacy) ? legacy : "";
}

export function defaultMealName(row) {
  const day = clean(row?.Day);
  const weekday = day.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/i)?.[1];
  if (weekday) return `${weekday[0].toUpperCase()}${weekday.slice(1).toLowerCase()}'s meal`;
  return day ? `Meal for ${day}` : "This meal";
}

export function mealDisplayName(row, docs = []) {
  if (!row) return "";
  if (isComposedMeal(row)) return mealCustomName(row, docs) || defaultMealName(row);
  const existing = clean(row.Meal);
  if (existing) return existing;
  const names = componentNames(row, docs).filter(Boolean);
  if (names.length === 1) return names[0];
  const id = row["Recipe id"] || row.recipeId;
  const recipe = (Array.isArray(docs) ? docs : []).find((doc) => id && (doc?.id === id || doc?.recipe?.id === id));
  return clean(recipe?.title || recipe?.recipe?.title);
}

export function withMealName(row, name, docs = []) {
  if (!isComposedMeal(row)) return row;
  const next = { ...row, customMealName: clean(name) };
  return { ...next, Meal: mealDisplayName(next, docs) };
}
