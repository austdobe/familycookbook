const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const recipesDir = path.join(rootDir, "recipes");
const outputPath = path.join(rootDir, "recipe-index.md");

function walkMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_template.md") {
      files.push(fullPath);
    }
  }

  return files;
}

function parseFrontMatter(markdown) {
  if (!markdown.startsWith("---")) {
    return {};
  }

  const end = markdown.indexOf("\n---", 3);
  if (end === -1) {
    return {};
  }

  const block = markdown.slice(3, end).trim();
  const data = {};

  for (const line of block.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    data[key] = value;
  }

  return data;
}

function formatRecipe(filePath) {
  const markdown = fs.readFileSync(filePath, "utf8");
  const meta = parseFrontMatter(markdown);
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, "/");
  const title = meta.title || path.basename(filePath, ".md");
  const category = meta.category || path.basename(path.dirname(filePath));
  const tags = meta.tags ? ` ${meta.tags}` : "";

  return { title, category, tags, relativePath };
}

const recipes = walkMarkdownFiles(recipesDir)
  .map(formatRecipe)
  .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

const grouped = recipes.reduce((acc, recipe) => {
  acc[recipe.category] = acc[recipe.category] || [];
  acc[recipe.category].push(recipe);
  return acc;
}, {});

const lines = [
  "# Recipe Index",
  "",
  `Generated from ${recipes.length} recipe${recipes.length === 1 ? "" : "s"}.`,
  ""
];

for (const category of Object.keys(grouped).sort()) {
  lines.push(`## ${category}`, "");

  for (const recipe of grouped[category]) {
    lines.push(`- [${recipe.title}](${recipe.relativePath})${recipe.tags}`);
  }

  lines.push("");
}

fs.writeFileSync(outputPath, `${lines.join("\n").trim()}\n`);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)} with ${recipes.length} recipe(s).`);

