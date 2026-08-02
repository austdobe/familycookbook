export function recipeDiscoveryText(doc) {
  const recipe = doc?.recipe || {};
  const ingredients = (recipe.ingredients || []).flatMap((ingredient) => [
    ingredient.item,
    ingredient.Ingredient,
    ingredient.Item,
    ingredient.preferredType,
    ingredient.acceptableAlternatives,
    ingredient.notes,
  ]);
  return [
    doc?.title,
    doc?.summary,
    recipe.category,
    recipe.protein,
    recipe.cuisine,
    recipe.planning?.protein,
    recipe.planning?.cuisine,
    ...(recipe.tags || []),
    ...(recipe.equipment || []),
    ...ingredients,
    doc?.path,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function recipeMatchesQuery(doc, query) {
  const terms = String(query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const searchable = recipeDiscoveryText(doc);
  return terms.every((term) => searchable.includes(term));
}

export function recipeProtein(doc) {
  return String(doc?.recipe?.protein || doc?.recipe?.planning?.protein || "").trim();
}

export function recipeStage(doc) {
  const status = String(doc?.recipe?.status || "").toLowerCase();
  return status === "stage-2" || /stage\s*2|promoted/.test(status) ? "stage-2" : "stage-1";
}
