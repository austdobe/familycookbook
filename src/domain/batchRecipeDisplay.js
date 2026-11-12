export function markdownWithBatchIngredients(markdown, ingredients) {
  const escapeCell = (value) => String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const table = ["## Ingredients", "", "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives |", "| --- | --- | --- | --- |", ...ingredients.map((ingredient) => `| ${escapeCell(ingredient.quantityText)} | ${escapeCell(ingredient.item)} | ${escapeCell(ingredient.preferredType)} | ${escapeCell(ingredient.acceptableAlternatives)} |`), ""].join("\n");
  const source = String(markdown || "");
  return /^##\s+Ingredients\s*$/im.test(source) ? source.replace(/^##\s+Ingredients\s*$[\s\S]*?(?=^##\s|$(?![\s\S]))/im, table) : `${table}\n${source}`;
}
