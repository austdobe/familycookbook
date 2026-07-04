const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function usage() {
  console.log("Usage:");
  console.log("  npm.cmd run apply:feedback -- --file <recipe.md> --version 2.0 --rating 5/5 --notes \"Family liked it\"");
  console.log("");
  console.log("Optional:");
  console.log("  --change \"Reduced sugar and doubled sauce\"");
  console.log("  --result \"Better balance\"");
  console.log("  --ingredient-change \"update|Flour|120 g / 1 cup|All-purpose flour|Unbleached|Bread flour|Better texture\"");
  console.log("  --ingredient-change \"add||15 ml / 1 tbsp|Lemon juice|Fresh|Bottled|Brightened sauce\"");
  console.log("  --ingredient-change \"remove|Cayenne pepper|||||Too spicy\"");
}

function parseArgs(argv) {
  const args = { ingredientChanges: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    if (key === "ingredient-change") {
      args.ingredientChanges.push(parseIngredientChangeArg(value));
    } else {
      args[key] = value;
    }
    if (value !== "true") {
      index += 1;
    }
  }
  return args;
}

function parseIngredientChangeArg(value) {
  const [type, matchIngredient, quantity, ingredient, preferred, alternatives, notes] = String(value || "").split("|");
  return {
    alternatives: alternatives || "",
    ingredient: ingredient || "",
    matchIngredient: matchIngredient || "",
    notes: notes || "",
    preferred: preferred || "",
    quantity: quantity || "",
    type: type || "update",
  };
}

function assertInsideRoot(filePath) {
  const relative = path.relative(rootDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Recipe file must be inside the cookbook folder.");
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function ensureSection(markdown, heading, initialBody) {
  if (new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "m").test(markdown)) {
    return markdown;
  }
  if (!initialBody.trim()) {
    return `${markdown.trim()}\n\n## ${heading}\n`;
  }
  return `${markdown.trim()}\n\n## ${heading}\n\n${initialBody.trim()}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyFeedbackToMarkdown(markdown, feedback) {
  markdown = updateLastUpdated(markdown);
  markdown = applyIngredientChanges(markdown, feedback.ingredientChanges || []);
  markdown = appendFamilyNotes(markdown, feedback);
  markdown = appendVersionHistory(markdown, feedback);
  return `${markdown.trim()}\n`;
}

function appendFamilyNotes(markdown, feedback) {
  markdown = ensureSection(markdown, "Family Notes", "");
  const notes = [];

  if (feedback.rating) {
    notes.push(`- ${today()} rating: ${feedback.rating}`);
  }
  if (feedback.notes) {
    notes.push(`- ${today()} notes: ${feedback.notes}`);
  }
  for (const change of feedback.ingredientChanges || []) {
    notes.push(`- ${today()} ingredient ${formatIngredientChange(change)}`);
  }

  if (!notes.length) {
    return markdown;
  }

  const newNotes = notes.filter((note) => !markdown.includes(note));
  if (!newNotes.length) {
    return markdown;
  }

  return markdown.replace(
    /(^##\s+Family Notes\s*$)/m,
    `$1\n\n${newNotes.join("\n")}`
  );
}

function appendVersionHistory(markdown, feedback) {
  const hasFeedback = feedback.rating || feedback.notes || (feedback.ingredientChanges || []).length;
  if (!hasFeedback) {
    return markdown;
  }

  const version = feedback.version || "2.0";
  const ingredientSummary = (feedback.ingredientChanges || []).map(formatIngredientChange).join("; ");
  const change = feedback.change || [feedback.notes, ingredientSummary].filter(Boolean).join("; ") || "Added family feedback from app";
  const result = feedback.result || (feedback.rating ? `Family rating: ${feedback.rating}` : "Needs review");
  const row = `| ${today()} | ${version} | ${escapeTableCell(change)} | ${escapeTableCell(result)} |`;

  if (markdown.includes(row)) {
    return markdown;
  }

  markdown = ensureSection(
    markdown,
    "Version History",
    "| Date | Version | Change | Result |\n|---|---|---|---|"
  );

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^##\s+Version History\s*$/.test(line));
  if (headingIndex === -1) {
    return markdown;
  }

  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].trim() !== "") {
    insertIndex += 1;
  }
  while (insertIndex < lines.length && lines[insertIndex].trim() === "") {
    insertIndex += 1;
  }

  if (insertIndex < lines.length && lines[insertIndex].startsWith("|")) {
    while (insertIndex < lines.length && lines[insertIndex].startsWith("|")) {
      insertIndex += 1;
    }
    lines.splice(insertIndex, 0, row);
  } else {
    lines.splice(insertIndex, 0, "| Date | Version | Change | Result |", "|---|---|---|---|", row);
  }

  return lines.join("\n");
}

function updateLastUpdated(markdown) {
  if (/^Last updated:\s*.*$/m.test(markdown)) {
    return markdown.replace(/^Last updated:\s*.*$/m, `Last updated: ${today()}`);
  }
  return markdown;
}

function applyIngredientChanges(markdown, ingredientChanges) {
  const changes = ingredientChanges.filter((change) => change && change.type);
  if (!changes.length) {
    return markdown;
  }

  const table = findIngredientTable(markdown);
  if (!table) {
    return markdown;
  }

  let rows = table.rows.map((row) => ({ ...row }));
  for (const change of changes) {
    if (change.type === "add") {
      if (!rows.some((row) => normalize(row.Ingredient) === normalize(change.ingredient))) {
        rows.push(rowFromChange(table.headers, change));
      }
      continue;
    }

    const rowIndex = rows.findIndex((row) => normalize(row.Ingredient) === normalize(change.matchIngredient));
    if (rowIndex === -1) {
      continue;
    }

    if (change.type === "remove") {
      rows = rows.filter((_, index) => index !== rowIndex);
      continue;
    }

    rows[rowIndex] = {
      ...rows[rowIndex],
      ...nonEmptyRowValues(table.headers, change),
    };
  }

  const nextTable = renderTable(table.headers, rows);
  return `${markdown.slice(0, table.startOffset)}${nextTable}${markdown.slice(table.endOffset)}`;
}

function findIngredientTable(markdown) {
  const lines = markdown.split(/\r?\n/);
  const offsets = lineOffsets(markdown, lines);
  const headingIndex = lines.findIndex((line) => /^##\s+Ingredients\s*$/.test(line.trim()));
  if (headingIndex === -1) {
    return null;
  }

  for (let index = headingIndex + 1; index < lines.length - 1; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    if (!lines[index].includes("|") || !isTableSeparator(lines[index + 1])) {
      continue;
    }

    const headers = splitTableRow(lines[index]);
    if (!headers.includes("Quantity") || !headers.includes("Ingredient")) {
      continue;
    }

    const rows = [];
    let endIndex = index + 2;
    while (endIndex < lines.length && lines[endIndex].includes("|") && lines[endIndex].trim()) {
      const values = splitTableRow(lines[endIndex]);
      const row = {};
      headers.forEach((header, headerIndex) => {
        row[header] = values[headerIndex] || "";
      });
      rows.push(row);
      endIndex += 1;
    }

    return {
      endOffset: offsets[endIndex] ?? markdown.length,
      headers,
      rows,
      startOffset: offsets[index],
    };
  }

  return null;
}

function lineOffsets(markdown, lines) {
  const offsets = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function rowFromChange(headers, change) {
  const row = {};
  headers.forEach((header) => {
    row[header] = "";
  });
  return {
    ...row,
    ...nonEmptyRowValues(headers, change),
  };
}

function nonEmptyRowValues(headers, change) {
  const values = {};
  const mapping = {
    "Acceptable alternatives": change.alternatives || "",
    Ingredient: change.ingredient || "",
    Notes: change.notes || "",
    "Preferred version/type": change.preferred || "",
    Quantity: change.quantity || "",
  };

  headers.forEach((header) => {
    if (mapping[header]) {
      values[header] = mapping[header];
    }
  });

  return values;
}

function renderTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map((header) => (header === "Quantity" ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((row) => `| ${headers.map((header) => escapeTableCell(row[header] || "")).join(" | ")} |`),
    "",
  ].join("\n");
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
  return trimmed.split("|").map((cell) => cell.trim());
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|");
}

function formatIngredientChange(change) {
  if (change.type === "add") {
    return `added ${[change.quantity, change.ingredient].filter(Boolean).join(" ")}`;
  }
  if (change.type === "remove") {
    return `removed ${change.matchIngredient}`;
  }
  const replacement = [change.quantity, change.ingredient || change.matchIngredient].filter(Boolean).join(" ");
  return `updated ${change.matchIngredient}${replacement ? ` to ${replacement}` : ""}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file || args.help) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const recipePath = path.resolve(process.cwd(), args.file);
  assertInsideRoot(recipePath);
  if (!fs.existsSync(recipePath)) {
    throw new Error(`Recipe file does not exist: ${args.file}`);
  }

  const markdown = fs.readFileSync(recipePath, "utf8");
  const nextMarkdown = applyFeedbackToMarkdown(markdown, args);

  fs.writeFileSync(recipePath, nextMarkdown);
  console.log(`Updated ${path.relative(process.cwd(), recipePath)}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Apply feedback failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  applyFeedbackToMarkdown,
  assertInsideRoot,
};
