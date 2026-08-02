import { isLikelyNonIngredientRow } from "./groceryEngine.js";

export function emptyBuilderIngredient() {
  return { quantity: "", item: "", preferred: "", alternatives: "", notes: "" };
}

export function emptyRecipeBuilderDraft() {
  return {
    servings: "",
    prepTime: "",
    cookTime: "",
    protein: "",
    cuisine: "",
    equipment: "",
    ingredients: [emptyBuilderIngredient()],
    directions: [""],
    notes: "",
  };
}

export function recipeBuilderDraftFromText(markdown, fallback = emptyRecipeBuilderDraft()) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const planning = labeledValues(sectionText(text, "Planning Summary"));
  const tableIngredients = ingredientTableRows(text);
  const ingredients = tableIngredients.length ? tableIngredients : plainIngredientRows(text);
  const equipment = sectionLines(text, "Equipment", ["Ingredients"]);
  const directions = instructionSteps(text);
  const notes = sectionLines(text, "Notes", []).map((line) => line.replace(/^[-*+]\s+/, ""));

  return {
    servings: planning.Servings || topValue(text, "Servings") || fallback.servings,
    prepTime: planning["Estimated prep time"] || topValue(text, "Prep Time") || fallback.prepTime,
    cookTime: planning["Estimated cook time"] || topValue(text, "Cook Time") || fallback.cookTime,
    protein: planning.Protein || fallback.protein,
    cuisine: planning["Cuisine or flavor direction"] || fallback.cuisine,
    equipment: equipment.length ? equipment.join("\n") : fallback.equipment,
    ingredients: ingredients.length ? ingredients : fallback.ingredients,
    directions: directions.length ? directions : fallback.directions,
    notes: notes.length ? notes.join("\n") : fallback.notes,
  };
}

export function analyzeRecipeImport(text) {
  const draft = recipeBuilderDraftFromText(text);
  const ingredientCount = draft.ingredients.filter((ingredient) => ingredient.item.trim()).length;
  const directionCount = draft.directions.filter((step) => step.trim()).length;
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const markdownTitle = String(text || "").match(/^\s*#\s+(.+)$/m)?.[1]?.trim() || "";
  const plainTitle = lines.find((line) => !/^(?:ingredients?|directions?|instructions?|method|preparation|steps|servings?|prep time|cook time|status|category)\s*:?/i.test(line))
    ?.replace(/^#+\s*/, "") || "";
  const title = markdownTitle || plainTitle;
  const readiness = analyzeRecipeReadiness({ draft, title });
  return {
    draft,
    title,
    ingredientCount,
    directionCount,
    ...readiness,
    ready: readiness.status === "ready",
  };
}

export function analyzeRecipeReadiness({ draft, title }) {
  const ingredients = (draft?.ingredients || []).filter((ingredient) => ingredient.item.trim());
  const directions = (draft?.directions || [])
    .map((step) => step.trim())
    .filter((step) => step && !/^review and add (?:instructions|directions)/i.test(step));
  const suspiciousIngredients = ingredients.filter((ingredient) => (
    isLikelyNonIngredientRow(ingredient.item, ingredient.quantity, title)
  ));
  const usableIngredients = ingredients.filter((ingredient) => !suspiciousIngredients.includes(ingredient));
  const missingQuantityCount = usableIngredients.filter((ingredient) => (
    !ingredient.quantity.trim()
    && !/\b(?:to taste|as needed|pinch|dash|optional)\b/i.test(`${ingredient.item} ${ingredient.notes || ""}`)
    && !/^(?:salt|pepper|black pepper|salt\s*(?:&|and)\s*pepper)$/i.test(ingredient.item.trim())
    && !/^(?:juice|zest)\s+of\s+\d+/i.test(ingredient.item.trim())
  )).length;
  const blockers = [];
  const warnings = [];

  if (!String(title || "").trim()) {
    blockers.push("Add a recognizable recipe title.");
  }
  if (!usableIngredients.length) {
    blockers.push("Add at least one real ingredient before saving.");
  }
  if (!directions.length) {
    warnings.push("Add at least one cooking direction so Cooking mode can guide the recipe.");
  }
  if (suspiciousIngredients.length) {
    warnings.push(`${suspiciousIngredients.length} ingredient row${suspiciousIngredients.length === 1 ? " looks" : "s look"} like directions or the recipe title and should be reviewed.`);
  }
  if (missingQuantityCount) {
    warnings.push(`${missingQuantityCount} ingredient${missingQuantityCount === 1 ? " is" : "s are"} missing a quantity.`);
  }

  const status = blockers.length ? "invalid" : warnings.length ? "needs-review" : "ready";
  return {
    blockers,
    directionCount: directions.length,
    ingredientCount: usableIngredients.length,
    missingQuantityCount,
    status,
    suspiciousIngredientCount: suspiciousIngredients.length,
    warnings,
  };
}

export function analyzeRecipeDocReadiness(doc) {
  const markdown = String(doc?.markdown || "");
  const draft = recipeBuilderDraftFromText(markdown);
  const markdownTitle = markdown.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() || "";
  return {
    doc,
    ...analyzeRecipeReadiness({
      draft,
      title: doc?.title || markdownTitle,
    }),
  };
}

export function summarizeRecipeHealth(docs = []) {
  const recipes = docs.map(analyzeRecipeDocReadiness);
  const counts = recipes.reduce((summary, recipe) => {
    summary[recipe.status] += 1;
    return summary;
  }, { ready: 0, "needs-review": 0, invalid: 0 });
  return {
    counts,
    recipes,
    attentionCount: counts.invalid + counts["needs-review"],
  };
}

export function recipeBuilderDraftToMarkdown({ builderDraft, category, status, title }) {
  const ingredients = builderDraft.ingredients.filter((ingredient) => ingredient.item.trim());
  const directions = builderDraft.directions.map((step) => step.trim()).filter(Boolean);
  const equipment = builderDraft.equipment.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const notes = builderDraft.notes.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  return [
    `# ${title.trim() || "Untitled Recipe"}`,
    `Status: ${status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing"}`,
    `Category: ${formatCategoryLabel(category)}`,
    "## Planning Summary",
    labeledBullet("Servings", builderDraft.servings),
    labeledBullet("Estimated prep time", builderDraft.prepTime),
    labeledBullet("Estimated cook time", builderDraft.cookTime),
    labeledBullet("Protein", builderDraft.protein),
    labeledBullet("Cuisine or flavor direction", builderDraft.cuisine),
    "## Equipment",
    ...(equipment.length ? equipment.map((item) => `- ${item}`) : ["- Review and add equipment"]),
    "## Ingredients",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    ...ingredients.map((ingredient) => `| ${[ingredient.quantity, ingredient.item, ingredient.preferred, ingredient.alternatives, ingredient.notes].map(escapeTableCell).join(" | ")} |`),
    "## Basic Instructions",
    ...(directions.length ? directions.map((step, index) => `${index + 1}. ${step}`) : ["1. Review and add instructions."]),
    "## Notes",
    ...(notes.length ? notes.map((note) => `- ${note}`) : ["- Stage 1 draft; review after cooking."]),
  ].filter((line) => line !== "").join("\n");
}

function ingredientTableRows(markdown) {
  const section = sectionText(markdown, "Ingredients");
  const lines = section.split("\n");
  const headerIndex = lines.findIndex((line, index) => /\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] || ""));
  if (headerIndex === -1) return [];
  const headers = splitTableRow(lines[headerIndex]).map((header) => header.toLowerCase());
  return lines.slice(headerIndex + 2).filter((line) => line.includes("|")).map((line) => {
    const values = splitTableRow(line);
    const value = (name) => values[headers.findIndex((header) => header.includes(name))] || "";
    return { quantity: value("quantity"), item: value("ingredient") || value("item"), preferred: value("preferred"), alternatives: value("alternative"), notes: value("notes") };
  }).filter((ingredient) => ingredient.item);
}

function plainIngredientRows(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^#{0,6}\s*ingredients\s*:?\s*$/i.test(line.trim()));
  if (start === -1) return [];
  const rows = [];
  let optionalSection = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].replace(/^\s*[-*+]\s+/, "").trim();
    if (!line) continue;
    if (/^#{1,2}\s+/.test(line) || /^(?:#{0,6}\s*)?(?:(?:basic|detailed)\s+)?(?:directions?|instructions?|method|preparation|steps)\s*:?\s*$/i.test(line)) break;
    if (isOptionalPlainIngredientSubheading(line)) {
      optionalSection = true;
      continue;
    }
    if (isPlainIngredientSubheading(line) || /^\([^)]*[.!?]\)?$/.test(line)) continue;
    const match = line.match(/^(\d+\s+\d+\/\d+|(?:\d+\s*)?[¼½¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+|\/\d+)?(?:\s*[–-]\s*\d+(?:\.\d+|\/\d+)?)?|(?:small|large)?\s*pinch|dash|to taste|as needed)\s+(.+)$/i);
    if (!match) {
      rows.push({ ...emptyBuilderIngredient(), item: line, notes: optionalSection ? "Optional" : "" });
      continue;
    }
    const unitMatch = match[2].match(/^((?:cups?|tbsp|tablespoons?|tsp|teaspoons?|lb|lbs|oz|ounces?|cloves?|cans?|packages?|packets?|bunches?|grams?|g|kg|ml|liters?))\s+(.+)$/i);
    rows.push({ ...emptyBuilderIngredient(), quantity: unitMatch ? `${match[1]} ${unitMatch[1]}` : match[1], item: unitMatch ? unitMatch[2] : match[2], notes: optionalSection ? "Optional" : "" });
  }
  return rows;
}

function isOptionalPlainIngredientSubheading(line) {
  return /^(?:optional|garnish\s*\(optional\))\s*:?$/i.test(line.trim());
}

function isPlainIngredientSubheading(line) {
  return /^(?:pasta|chicken|beef|pork|shrimp|fish|vegetables?|sauce|dressing|dry rub|glaze|fresh peach bbq glaze|finish|rice|toppings?|for serving|serve with)\s*:?$/i.test(line.trim());
}

function sectionText(markdown, heading) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const escaped = escapeRegExp(heading);
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${escaped}\\s*:?\\s*$`, "i").test(line.trim()));
  if (start === -1) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{1,6}\s+/.test(lines[index].trim())) { end = index; break; }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

function sectionLines(markdown, heading, endHeadings) {
  const canonical = sectionText(markdown, heading);
  if (canonical) return canonical.split("\n").map((line) => line.replace(/^[-*+]\s+/, "").trim()).filter(Boolean);
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => new RegExp(`^(?:#{1,6}\\s*)?${escapeRegExp(heading)}\\s*:?$`, "i").test(line.trim()));
  if (start === -1) return [];
  const result = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (endHeadings.some((end) => new RegExp(`^(?:#{1,6}\\s*)?${escapeRegExp(end)}\\s*:?$`, "i").test(line))) break;
    if (line) result.push(line.replace(/^[-*+]\s+/, ""));
  }
  return result;
}

function instructionSteps(markdown) {
  const headings = ["Basic Instructions", "Detailed Instructions", "Directions", "Instructions", "Method", "Preparation", "Steps"];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => headings.some((heading) => new RegExp(`^(?:#{1,6}\\s*)?${escapeRegExp(heading)}\\s*:?$`, "i").test(line.trim())));
  if (start === -1) return [];
  const steps = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^#{1,6}\s+/.test(line) || /^(?:notes?|nutrition)\s*:?$/i.test(line)) break;
    const step = line.replace(/^\d+[.)]\s+/, "").replace(/^[-*+]\s+/, "").trim();
    if (step) steps.push(step);
  }
  return steps;
}

function labeledValues(section) {
  return Object.fromEntries(section.split("\n").map((line) => line.match(/^[-*+]\s+([^:]+):\s*(.+)$/)).filter(Boolean).map((match) => [match[1].trim(), match[2].trim()]));
}

function topValue(markdown, label) {
  return String(markdown || "").match(new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
}

function labeledBullet(label, value) { return value ? `- ${label}: ${value}` : ""; }
function splitTableRow(line) { return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()); }
function escapeTableCell(value) { return String(value || "").replace(/\|/g, "\\|").trim(); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function formatCategoryLabel(value) { return String(value || "uncategorized").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
