// Meal labels are presentation only; never change recipe/session identity.
const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
export function cookingMealTitle(title, components = []) {
  const original = clean(title);
  const names = components.map((component) => clean(component?.title)).filter(Boolean);
  // This is the exact projection made by menuRowWithComponents. Do not split
  // arbitrary names on +: a single recipe may legitimately contain that symbol.
  const generated = names.length > 1 && original === names.join(" + ");
  const excessiveComposed = names.length > 1 && original.length > 100;
  return {
    heading: generated || excessiveComposed ? "Tonight's meal" : original || "Tonight's meal",
    fullTitle: original,
    componentCount: names.length,
    showDetails: names.length > 1 || original.length > 65,
  };
}
