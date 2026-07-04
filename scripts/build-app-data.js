const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "public", "data");
const outputPath = path.join(outputDir, "cookbook.json");

function toPosix(filePath) {
  return filePath.replace(/\\/g, "/");
}

function relativePath(filePath) {
  return toPosix(path.relative(rootDir, filePath));
}

function readMarkdown(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
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

  return files.sort((a, b) => a.localeCompare(b));
}

function titleFromMarkdown(markdown, fallback) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

function slugFromTitle(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readDoc(filePath, type) {
  const markdown = readMarkdown(filePath);
  const title = titleFromMarkdown(markdown, path.basename(filePath, ".md"));

  return {
    id: slugFromTitle(relativePath(filePath).replace(/\.md$/i, "")),
    type,
    title,
    path: relativePath(filePath),
    markdown,
    summary: summarizeMarkdown(markdown),
  };
}

function summarizeMarkdown(markdown) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("|") && !/^[-:|\s]+$/.test(line));

  return (lines[0] || "").replace(/\s{2,}/g, " ").slice(0, 180);
}

function parseWeekDateRange(markdown) {
  const match = markdown.match(/^Week of:\s*(.+?)\s+through\s+(.+?)\s*$/im);
  if (!match) {
    return { startDate: "", endDate: "" };
  }

  return {
    startDate: toDateOnly(match[1]),
    endDate: toDateOnly(match[2]),
  };
}

function toDateOnly(value) {
  const date = new Date(`${value} 12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sectionMarkdown(markdown, headingText) {
  const lines = markdown.split("\n");
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(headingText)}\\s*$`, "i");
  const start = lines.findIndex((line) => headingPattern.test(line.trim()));

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTables(markdown) {
  const lines = markdown.split("\n");
  const tables = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes("|") || !isTableSeparator(lines[index + 1])) {
      continue;
    }

    const headers = splitTableRow(lines[index]);
    const rows = [];
    index += 2;

    while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
      const values = splitTableRow(lines[index]);
      const row = {};
      headers.forEach((header, headerIndex) => {
        row[header] = values[headerIndex] || "";
      });
      rows.push(row);
      index += 1;
    }

    tables.push({ headers, rows });
  }

  return tables;
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
  return trimmed.split("|").map((cell) => cleanInlineMarkdown(cell.trim()));
}

function cleanInlineMarkdown(value) {
  return value.replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
}

function parseGrocerySections(packetMarkdown) {
  const grocery = sectionMarkdown(packetMarkdown, "Grocery List");
  const lines = grocery.split("\n");
  const sections = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^###\s+(.+)$/);
    if (heading) {
      current = { title: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }

    if (current && lines[index].includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      current.items.push(...parseTables(tableLines.join("\n"))[0].rows);
    }
  }

  return sections;
}

function parsePrepSections(packetMarkdown) {
  const prep = sectionMarkdown(packetMarkdown, "Prep Guide");
  const lines = prep.split("\n");
  const sections = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^###\s+(.+)$/);
    if (heading) {
      current = { title: heading[1].trim(), markdown: "" };
      sections.push(current);
      continue;
    }

    if (current) {
      current.markdown += `${line}\n`;
    }
  }

  return sections.map((section) => ({ ...section, markdown: section.markdown.trim() }));
}

function buildWeeks() {
  const weeklyRoot = path.join(rootDir, "weekly-plans");
  const yearDirs = fs.existsSync(weeklyRoot)
    ? fs.readdirSync(weeklyRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const weeks = [];

  for (const yearDir of yearDirs) {
    const yearPath = path.join(weeklyRoot, yearDir.name);
    const weekDirs = fs.readdirSync(yearPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const weekDir of weekDirs) {
      const weekPath = path.join(yearPath, weekDir.name);
      const markdownFiles = walkMarkdownFiles(weekPath);
      const packetPath = markdownFiles.find((filePath) => /packet\.md$/i.test(filePath)) || markdownFiles[0];

      if (!packetPath) {
        continue;
      }

      const packet = readDoc(packetPath, "packet");
      const dateRange = parseWeekDateRange(packet.markdown);
      const recipeDocs = markdownFiles
        .filter((filePath) => filePath !== packetPath)
        .map((filePath) => readDoc(filePath, "stage-1-recipe"));
      const weeklyMenuTable = parseTables(sectionMarkdown(packet.markdown, "Weekly Menu"))[0];

      weeks.push({
        id: `${yearDir.name}-${weekDir.name}`,
        label: `${yearDir.name} ${weekDir.name.replace("-", " ")}`,
        year: yearDir.name,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        folder: relativePath(weekPath),
        packet,
        recipes: recipeDocs,
        weeklyMenu: weeklyMenuTable ? weeklyMenuTable.rows : [],
        grocerySections: parseGrocerySections(packet.markdown),
        prepSections: parsePrepSections(packet.markdown),
      });
    }
  }

  return weeks.sort((a, b) => b.id.localeCompare(a.id));
}

function buildRecipeArchive() {
  const roots = [
    path.join(rootDir, "recipes"),
    path.join(rootDir, "recipe-archive"),
  ];

  return roots
    .flatMap((dir) => walkMarkdownFiles(dir))
    .filter((filePath) => !filePath.endsWith("_template.md"))
    .map((filePath) => readDoc(filePath, "archived-recipe"));
}

function buildPlanningDocs() {
  return walkMarkdownFiles(path.join(rootDir, "planning")).map((filePath) => readDoc(filePath, "planning"));
}

function main() {
  const data = {
    generatedAt: new Date().toISOString(),
    weeks: buildWeeks(),
    archivedRecipes: buildRecipeArchive(),
    planningDocs: buildPlanningDocs(),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`Wrote ${relativePath(outputPath)}`);
  console.log(`Weeks: ${data.weeks.length}`);
  console.log(`Archived recipes: ${data.archivedRecipes.length}`);
  console.log(`Planning docs: ${data.planningDocs.length}`);
}

main();
