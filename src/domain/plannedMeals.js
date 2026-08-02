const rolePriority = { complete: 0, main: 1, side: 2, sauce: 3, bread: 4, dessert: 5, drink: 6 };

export function resolveMealComponentDocs(row, docs) {
  const components = Array.isArray(row?.components) && row.components.length
    ? row.components.filter((component) => component?.recipeId)
    : legacyComponents(row);
  return components
    .map((component, index) => ({ component, index }))
    .sort((first, second) => (rolePriority[first.component.role] ?? 99) - (rolePriority[second.component.role] ?? 99) || first.index - second.index)
    .map(({ component }) => docs.find((candidate) => candidate.id === component.recipeId || candidate.recipe?.id === component.recipeId))
    .filter(Boolean);
}

function legacyComponents(row) {
  const recipeId = row?.["Recipe id"] || row?.recipeId || "";
  return recipeId ? [{ recipeId, role: "complete" }] : [];
}
