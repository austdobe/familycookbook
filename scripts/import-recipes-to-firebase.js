const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const archiveDir = path.join(rootDir, "recipe-archive");
const weeklyPlansDir = path.join(rootDir, "weekly-plans");
const reportsDir = path.join(rootDir, "reports");

function loadEnvFile(fileName) {
  const filePath = path.join(rootDir, fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}
function usage() {
  console.log("Usage:");
  console.log("  npm.cmd run import:recipes");
  console.log("  npm.cmd run import:recipes -- --date 2026-07-05");
  console.log("  npm.cmd run import:recipes -- --write");
  console.log("");
  console.log("By default this parses Markdown recipes into Firebase-shaped JSON and reports.");
  console.log("Pass --write to seed Firestore at households/{householdId}/recipes.");
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    args[key] = value;
    if (value !== "true") {
      index += 1;
    }
  }
  args.write = args.write === "true";
  return args;
}

function firebaseConfig() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    appId: process.env.VITE_FIREBASE_APP_ID,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  };
}

function hasConfig(config) {
  return Boolean(config.apiKey && config.appId && config.authDomain && config.projectId);
}

async function firebaseClient() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const config = firebaseConfig();
  if (!hasConfig(config)) {
    throw new Error("Firebase env vars are missing. Check .env for VITE_FIREBASE_* values.");
  }

  const [{ initializeApp }, { getAuth, signInAnonymously }, { getFirestore }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);

  const app = initializeApp(config);
  await signInAnonymously(getAuth(app));
  return { app, db: getFirestore(app) };
}

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function relativePath(filePath) {
  return toPosix(path.relative(rootDir, filePath));
}

function walkMarkdownFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort((first, second) => first.localeCompare(second));
}

function weeklyRecipeFiles() {
  return walkMarkdownFiles(weeklyPlansDir)
    .filter((filePath) => !path.basename(filePath).toLowerCase().includes("family-cookbook-packet"));
}

function readMarkdown(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function parseRecipeFile(filePath) {
  const markdown = readMarkdown(filePath);
  const warnings = [];
  const title = titleFromMarkdown(markdown, path.basename(filePath, ".md"));
  const sourcePath = relativePath(filePath);
  const id = slugFromPath(filePath);
  const metadata = parseTopMetadata(markdown);
  const archiveCategory = normalizeCategory(path.basename(path.dirname(filePath)) || metadata.category);
  const planningSummary = parseLabeledBulletSection(markdown, "Planning Summary");
  const ingredients = parseIngredients(markdown, warnings);
  const instructionSections = parseInstructionSections(markdown);

  if (!metadata.status) {
    warnings.push("Missing Status line.");
  }
  if (metadata.category && normalizeCategory(metadata.category) !== archiveCategory) {
    warnings.push(`Category line (${normalizeCategory(metadata.category)}) differs from archive folder (${archiveCategory}); using archive folder.`);
  }
  if (!ingredients.length) {
    warnings.push("No ingredient rows parsed.");
  }
  if (!instructionSections.length || instructionSections.every((section) => !section.steps.length)) {
    warnings.push("No numbered instruction steps parsed.");
  }

  return {
    recipe: {
      id,
      title,
      status: normalizeStatus(metadata.status),
      statusLabel: metadata.status || "",
      category: archiveCategory,
      source: metadata["source or inspiration"] || "",
      dateAdded: metadata["date added"] || "",
      lastUpdated: metadata["last updated"] || "",
      version: inferVersion(markdown),
      servings: parseServings(planningSummary.Servings || metadata.servings || ""),
      estimatedPrepMinutes: parseMinutes(planningSummary["Estimated prep time"] || ""),
      estimatedCookMinutes: parseMinutes(planningSummary["Estimated cook time"] || ""),
      protein: planningSummary.Protein || "",
      cuisine: planningSummary["Cuisine or flavor direction"] || "",
      bestDayToCook: planningSummary["Best day to cook"] || "",
      perishabilityNotes: planningSummary["Perishability notes"] || "",
      difficulty: planningSummary.Difficulty || "",
      equipment: parseBulletSection(markdown, "Equipment"),
      ingredients,
      instructionSections,
      notes: parseNotes(markdown),
      prepGuidance: parsePrepGuidance(markdown),
      archivePlan: parseLabeledBulletSection(markdown, "Archive Plan"),
      familyNotes: parseBulletSection(markdown, "Family Notes"),
      versionHistory: parseVersionHistory(markdown),
      archivedMarkdownPath: sourcePath,
      sourceMarkdown: normalizeMarkdownMetadata(markdown, {
        Category: formatCategoryLabel(archiveCategory),
      }),
      createdAt: "",
      updatedAt: "",
    },
    sourcePath,
    warnings,
  };
}

function titleFromMarkdown(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function slugFromPath(filePath) {
  return path.basename(filePath, ".md")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseTopMetadata(markdown) {
  const metadata = {};
  const lines = markdown.split("\n");

  for (const line of lines.slice(1)) {
    if (/^##\s+/.test(line)) {
      break;
    }
    const match = line.match(/^([^:\n]+):\s*(.*?)\s*$/);
    if (match) {
      metadata[match[1].trim().toLowerCase()] = stripInlineMarkdown(match[2].trim());
    }
  }

  return metadata;
}

function normalizeStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value.includes("stage 2")) {
    return "stage-2";
  }
  if (value.includes("stage 1")) {
    return "stage-1";
  }
  return "unknown";
}

function normalizeCategory(category) {
  return String(category || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatCategoryLabel(category) {
  return String(category || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeMarkdownMetadata(markdown, replacements) {
  const lines = String(markdown || "").split("\n");
  const remaining = { ...replacements };
  const nextLines = lines.map((line) => {
    const match = line.match(/^([^:\n]+):\s*(.*?)\s*$/);
    if (!match) {
      return line;
    }
    const key = Object.keys(remaining).find((candidate) => candidate.toLowerCase() === match[1].trim().toLowerCase());
    if (!key) {
      return line;
    }
    const value = remaining[key];
    delete remaining[key];
    return `${match[1].trim()}: ${value}`;
  });

  const inserts = Object.entries(remaining).map(([key, value]) => `${key}: ${value}`);
  if (!inserts.length) {
    return nextLines.join("\n");
  }

  const headingIndex = nextLines.findIndex((line) => /^#\s+/.test(line));
  const insertIndex = headingIndex === -1 ? 0 : headingIndex + 1;
  return [
    ...nextLines.slice(0, insertIndex),
    ...inserts,
    ...nextLines.slice(insertIndex),
  ].join("\n");
}

function inferVersion(markdown) {
  const rows = parseTableInSection(markdown, "Version History");
  const versions = rows.map((row) => row.Version).filter(Boolean);
  return versions.at(-1) || "1.0";
}

function parseServings(value) {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function parseMinutes(value) {
  const text = String(value || "").toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minute|min)/);
  const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const total = hours + minutes;
  if (total > 0) {
    return total;
  }
  const plainNumber = text.match(/\d+/);
  return plainNumber ? Number(plainNumber[0]) : null;
}

function parseIngredients(markdown, warnings) {
  const rows = parseTableInSection(markdown, "Ingredients");
  return rows.map((row, index) => {
    const item = row.Ingredient || row.Item || "";
    const parsedQuantity = parseQuantity(row.Quantity || "");
    if (!item) {
      warnings.push(`Ingredient row ${index + 1} is missing Ingredient/Item.`);
    }
    if (!row.Quantity) {
      warnings.push(`Ingredient row ${index + 1}${item ? ` (${item})` : ""} is missing Quantity.`);
    }

    return {
      id: `ingredient-${index + 1}`,
      quantityText: row.Quantity || "",
      quantityValue: parsedQuantity.value,
      unit: parsedQuantity.unit,
      item,
      preferredType: row["Preferred version/type"] || row.Preferred || "",
      acceptableAlternatives: row["Acceptable alternatives"] || row.Alternatives || "",
      notes: row.Notes || row["Used in"] || "",
      groceryCategory: groceryCategoryForItem(item),
      usedIn: row["Used in"] || row.Notes || "",
      optional: isOptionalIngredient(row),
      perishable: isLikelyPerishable(item),
      sourceRow: row,
    };
  });
}

function parseQuantity(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?:\s+([^,]+?))?(?:,|$)/);
  if (!match) {
    return { value: null, unit: "" };
  }
  return {
    value: parseNumber(match[1]),
    unit: String(match[2] || "").trim(),
  };
}

function parseNumber(value) {
  const trimmed = String(value || "").trim();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  const fraction = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return Number(fraction[1]) / Number(fraction[2]);
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function isOptionalIngredient(row) {
  return Object.values(row).some((value) => /\boptional\b/i.test(String(value || "")));
}

function isLikelyPerishable(item) {
  const words = groceryItemWords(item);
  return [
    "apple", "avocado", "basil", "beef", "broccoli", "carrot", "cheese", "chicken", "cilantro", "cream",
    "cucumber", "dill", "egg", "fish", "ginger", "ham", "lettuce", "lime", "meat", "milk", "mushroom",
    "onion", "parsley", "pepper", "pork", "potato", "salmon", "shrimp", "steak", "tomato", "turkey",
    "yogurt", "zucchini",
  ].some((word) => words.includes(word));
}

function parseInstructionSections(markdown) {
  return ["Basic Instructions", "Detailed Instructions"].flatMap((heading) => {
    const steps = parseNumberedSection(markdown, heading);
    return steps.length ? [{ title: heading, steps }] : [];
  });
}

function parseNumberedSection(markdown, heading) {
  const section = sectionMarkdown(markdown, heading);
  return section
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\.\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      order: Number(match[1]),
      text: stripInlineMarkdown(match[2].trim()),
      cue: "",
      temperature: extractTemperature(match[2]),
      timeMinutes: extractStepMinutes(match[2]),
    }));
}

function extractTemperature(value) {
  const match = String(value || "").match(/\b\d{3}\s*degrees?\s*F\b/i);
  return match ? match[0] : "";
}

function extractStepMinutes(value) {
  return parseMinutes(value);
}

function parseNotes(markdown) {
  const notes = parseLabeledBulletSection(markdown, "Notes");
  return {
    testing: notes["What might need testing"] || "",
    substitutions: notes["Possible substitutions"] || "",
    prepAhead: notes["Prep-ahead ideas"] || "",
    familyPreferenceConcerns: notes["Family preference concerns"] || "",
    raw: notes,
  };
}

function parsePrepGuidance(markdown) {
  const notes = parseNotes(markdown);
  return {
    prepAheadIdeas: notes.prepAhead ? [notes.prepAhead] : [],
    doNotPrepAhead: [],
    perishabilityNotes: parseLabeledBulletSection(markdown, "Planning Summary")["Perishability notes"] || "",
    bestDayToCook: parseLabeledBulletSection(markdown, "Planning Summary")["Best day to cook"] || "",
  };
}

function parseVersionHistory(markdown) {
  return parseTableInSection(markdown, "Version History").map((row) => ({
    date: row.Date || "",
    version: row.Version || "",
    change: row.Change || "",
    result: row.Result || "",
  }));
}

function parseBulletSection(markdown, heading) {
  return sectionMarkdown(markdown, heading)
    .split("\n")
    .map((line) => line.match(/^\s*[-*+]\s+(.+)$/))
    .filter(Boolean)
    .map((match) => stripInlineMarkdown(match[1].trim()))
    .filter(Boolean);
}

function parseLabeledBulletSection(markdown, heading) {
  const values = {};
  for (const item of parseBulletSection(markdown, heading)) {
    const separatorIndex = item.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }
    const key = item.slice(0, separatorIndex).trim();
    const value = item.slice(separatorIndex + 1).trim();
    values[key] = value;
  }
  return values;
}

function parseTableInSection(markdown, heading) {
  const section = sectionMarkdown(markdown, heading);
  const lines = section.split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !isTableSeparator(lines[index + 1])) {
      continue;
    }
    const headers = splitTableRow(lines[index]);
    const rows = [];
    index += 2;
    while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
      const values = splitTableRow(lines[index]);
      rows.push(Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] || ""])));
      index += 1;
    }
    return rows;
  }
  return [];
}

function sectionMarkdown(markdown, heading) {
  const lines = markdown.split("\n");
  const pattern = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const start = lines.findIndex((line) => pattern.test(line.trim()));
  if (start === -1) {
    return "";
  }

  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => stripInlineMarkdown(cell.trim()));
}

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groceryCategoryForItem(item) {
  const words = groceryItemWords(item);
  const hasAny = (values) => values.some((value) => words.includes(value));

  if (hasAny(["chicken", "beef", "steak", "pork", "salmon", "turkey", "ham", "shrimp", "fish"])) {
    return "Meat and Seafood";
  }
  if (hasAny(["milk", "cream", "cheese", "yogurt", "egg", "butter", "feta", "mozzarella", "cheddar", "swiss"])) {
    return "Dairy and Eggs";
  }
  if (hasAny(["flatbread", "naan", "bread", "tortilla", "wrap", "bun", "roll", "pita"])) {
    return "Bakery";
  }
  if (hasAny(["salt", "pepper", "cumin", "paprika", "oregano", "coriander", "turmeric", "powder", "seasoning", "spice", "flake"])) {
    return "Sauces, Condiments, and Spices";
  }
  if (hasAny(["rice", "breadcrumb", "panko", "arrowroot", "flour", "sugar", "honey", "oil", "vinegar", "sauce", "mustard", "mayonnaise", "broth", "stock", "peanut", "soy"])) {
    return "Pantry and Dry Goods";
  }
  if (hasAny(["apple", "avocado", "basil", "broccoli", "cabbage", "carrot", "cilantro", "cucumber", "dill", "garlic", "ginger", "herb", "jalapeno", "lemon", "lettuce", "lime", "mint", "mushroom", "onion", "parsley", "pepper", "potato", "radish", "tomato", "zucchini"])) {
    return "Produce";
  }
  return "Other";
}

function groceryItemWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(singularize)
    .filter(Boolean);
}

function singularize(word) {
  if (word.endsWith("ies") && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith("oes") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("ses") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

function firestoreRecipePayload(recipe, importedAt) {
  return {
    ...recipe,
    createdAt: recipe.createdAt || importedAt,
    importedAt,
    importSource: "markdown-archive",
    updatedAt: importedAt,
  };
}

async function writeRecipesToFirestore(recipes) {
  const importedAt = new Date().toISOString();
  const { app, db } = await firebaseClient();
  const [{ deleteApp }, { collection, doc, getDocs, setDoc, terminate }] = await Promise.all([
    import("firebase/app"),
    import("firebase/firestore"),
  ]);
  const householdId = process.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

  try {
    for (const recipe of recipes) {
      await setDoc(
        doc(db, "households", householdId, "recipes", recipe.id),
        firestoreRecipePayload(recipe, importedAt),
        { merge: true }
      );
      console.log(`Wrote recipe ${recipe.id}`);
    }

    const snapshot = await getDocs(collection(db, "households", householdId, "recipes"));
    const localIds = new Set(recipes.map((recipe) => recipe.id));
    const remoteIds = new Set(snapshot.docs.map((snapshotDoc) => snapshotDoc.id));
    const missingLocalRecipes = [...localIds].filter((id) => !remoteIds.has(id)).sort();
    const firebaseOnlyRecipes = [...remoteIds].filter((id) => !localIds.has(id)).sort();

    return {
      checkedAt: new Date().toISOString(),
      householdId,
      localRecipeCount: recipes.length,
      remoteRecipeCount: remoteIds.size,
      missingLocalRecipes,
      firebaseOnlyRecipes,
    };
  } finally {
    await terminate(db).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}
function buildSummary(parsedRecipes, weeklyFiles = []) {
  const byStatus = {};
  const byCategory = {};
  const duplicateIds = duplicates(parsedRecipes.map((entry) => entry.recipe.id));
  const duplicateTitles = duplicates(parsedRecipes.map((entry) => entry.recipe.title.toLowerCase()));
  const archiveIds = new Set(parsedRecipes.map((entry) => entry.recipe.id));
  const weeklyOnlyRecipes = weeklyFiles
    .map((filePath) => ({
      id: slugFromPath(filePath),
      sourcePath: relativePath(filePath),
      title: titleFromMarkdown(readMarkdown(filePath), path.basename(filePath, ".md")),
    }))
    .filter((entry) => !archiveIds.has(entry.id));

  for (const entry of parsedRecipes) {
    byStatus[entry.recipe.status] = (byStatus[entry.recipe.status] || 0) + 1;
    byCategory[entry.recipe.category] = (byCategory[entry.recipe.category] || 0) + 1;
  }

  return {
    recipeCount: parsedRecipes.length,
    warningCount: parsedRecipes.reduce((total, entry) => total + entry.warnings.length, 0),
    byStatus,
    byCategory,
    duplicateIds,
    duplicateTitles,
    weeklyOnlyRecipes,
  };
}

function duplicates(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
}

function renderMarkdownReport(parsedRecipes, summary, jsonPath) {
  const lines = [
    "# Firebase Recipe Import Dry Run",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Recipes parsed: ${summary.recipeCount}`,
    `- Warnings: ${summary.warningCount}`,
    `- JSON preview: \`${relativePath(jsonPath)}\``,
    "",
    "### By Status",
    "",
    "| Status | Count |",
    "|---|---:|",
    ...Object.entries(summary.byStatus).sort().map(([status, count]) => `| ${status} | ${count} |`),
    "",
    "### By Category",
    "",
    "| Category | Count |",
    "|---|---:|",
    ...Object.entries(summary.byCategory).sort().map(([category, count]) => `| ${category} | ${count} |`),
    "",
  ];

  if (summary.duplicateIds.length || summary.duplicateTitles.length) {
    lines.push("## Duplicates", "");
    for (const id of summary.duplicateIds) {
      lines.push(`- Duplicate recipe id: \`${id}\``);
    }
    for (const title of summary.duplicateTitles) {
      lines.push(`- Duplicate recipe title: ${title}`);
    }
    lines.push("");
  }

  lines.push("## Weekly Folder Audit", "");
  lines.push(`- Week-only recipe files missing from archive: ${summary.weeklyOnlyRecipes.length}`);
  if (summary.weeklyOnlyRecipes.length) {
    lines.push("");
    summary.weeklyOnlyRecipes.forEach((entry) => {
      lines.push(`- ${entry.title} - \`${entry.sourcePath}\``);
    });
  }
  lines.push("");

  if (summary.firestoreAudit) {
    lines.push("## Firestore Audit", "");
    lines.push(`- Household: ${summary.firestoreAudit.householdId}`);
    lines.push(`- Local recipe count: ${summary.firestoreAudit.localRecipeCount}`);
    lines.push(`- Remote recipe count: ${summary.firestoreAudit.remoteRecipeCount}`);
    lines.push(`- Missing local recipes in Firestore: ${summary.firestoreAudit.missingLocalRecipes.length}`);
    lines.push(`- Firebase-only recipes: ${summary.firestoreAudit.firebaseOnlyRecipes.length}`);
    if (summary.firestoreAudit.missingLocalRecipes.length) {
      lines.push("", "### Missing Local Recipes", "");
      summary.firestoreAudit.missingLocalRecipes.forEach((id) => lines.push(`- ${id}`));
    }
    if (summary.firestoreAudit.firebaseOnlyRecipes.length) {
      lines.push("", "### Firebase-Only Recipes", "");
      summary.firestoreAudit.firebaseOnlyRecipes.forEach((id) => lines.push(`- ${id}`));
    }
    lines.push("");
  }

  lines.push("## Recipes", "");
  for (const entry of parsedRecipes) {
    lines.push(`### ${entry.recipe.title}`, "");
    lines.push(`- ID: \`${entry.recipe.id}\``);
    lines.push(`- Source: \`${entry.sourcePath}\``);
    lines.push(`- Status: ${entry.recipe.status}`);
    lines.push(`- Category: ${entry.recipe.category}`);
    lines.push(`- Ingredients: ${entry.recipe.ingredients.length}`);
    lines.push(`- Instruction sections: ${entry.recipe.instructionSections.length}`);
    if (entry.warnings.length) {
      lines.push("- Warnings:");
      entry.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    } else {
      lines.push("- Warnings: none");
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const reportDate = args.date || new Date().toISOString().slice(0, 10);
  const recipeFiles = walkMarkdownFiles(archiveDir);
  const parsedRecipes = recipeFiles.map(parseRecipeFile);
  const summary = buildSummary(parsedRecipes, weeklyRecipeFiles());
  let firestoreAudit = null;

  if (args.write) {
    firestoreAudit = await writeRecipesToFirestore(parsedRecipes.map((entry) => entry.recipe));
    summary.firestoreAudit = firestoreAudit;
  }

  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, `firebase-recipe-import-${reportDate}.json`);
  const reportPath = path.join(reportsDir, `firebase-recipe-import-${reportDate}.md`);
  const payload = {
    generatedAt: new Date().toISOString(),
    dryRun: !args.write,
    summary,
    firestoreAudit,
    recipes: parsedRecipes.map((entry) => entry.recipe),
    warnings: parsedRecipes
      .filter((entry) => entry.warnings.length)
      .map((entry) => ({ recipeId: entry.recipe.id, sourcePath: entry.sourcePath, warnings: entry.warnings })),
  };

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderMarkdownReport(parsedRecipes, summary, jsonPath));

  console.log(`Parsed ${summary.recipeCount} recipe(s).`);
  console.log(`Warnings: ${summary.warningCount}`);
  console.log(`Wrote ${relativePath(jsonPath)}`);
  console.log(`Wrote ${relativePath(reportPath)}`);
  if (args.write) {
    console.log(`Wrote ${summary.recipeCount} recipe document(s) to Firestore.`);
    console.log(`Firestore recipes checked: ${firestoreAudit.remoteRecipeCount}.`);
    console.log(`Missing local recipes in Firestore: ${firestoreAudit.missingLocalRecipes.length}.`);
    console.log(`Firebase-only recipes: ${firestoreAudit.firebaseOnlyRecipes.length}.`);
  } else {
    console.log("Dry run only. Firestore was not changed. Pass --write to seed recipes.");
  }
}

main().catch((error) => {
  console.error(`Recipe import failed: ${error.message}`);
  process.exit(1);
});
