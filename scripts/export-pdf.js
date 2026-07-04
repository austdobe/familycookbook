const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const defaultBrowserPaths = [
  process.env.EDGE_PATH,
  process.env.CHROME_PATH,
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function usage() {
  console.log("Usage: npm run export:pdf -- <markdown-file-or-folder> [output-pdf-or-folder]");
  console.log("");
  console.log("Examples:");
  console.log("  npm run export:pdf -- weekly-plans/2026/week-28");
  console.log("  npm run export:pdf -- weekly-plans/2026/week-28/week-28-family-cookbook-packet.md");
  console.log("  npm run export:pdf -- recipes/breakfast/sunday-pancakes.md exports/sunday-pancakes.pdf");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value) {
  let text = escapeHtml(value);

  const codeTokens = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const token = `@@CODE${codeTokens.length}@@`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  codeTokens.forEach((code, index) => {
    text = text.replace(`@@CODE${index}@@`, code);
  });

  return text;
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

function renderTable(lines, startIndex) {
  const header = splitTableRow(lines[startIndex]);
  let index = startIndex + 2;
  const rows = [];

  while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const headerHtml = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = header.map((_, cellIndex) => row[cellIndex] || "");
      return `<tr>${cells.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join("")}</tr>`;
    })
    .join("\n");

  return {
    html: `<table>\n<thead><tr>${headerHtml}</tr></thead>\n<tbody>\n${bodyHtml}\n</tbody>\n</table>`,
    nextIndex: index,
  };
}

function normalizeCheckbox(content) {
  return content
    .replace(/^\[ \]\s+/, '<span class="checkbox"></span>')
    .replace(/^\[x\]\s+/i, '<span class="checkbox checked">x</span>');
}

function renderList(lines, startIndex, ordered) {
  const tag = ordered ? "ol" : "ul";
  const markerPattern = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(markerPattern);
    if (!match) {
      break;
    }

    let content = match[1];
    index += 1;

    const details = [];
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].match(markerPattern) &&
      !lines[index].match(/^#{1,6}\s+/) &&
      !(lines[index].includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]))
    ) {
      details.push(lines[index].trim());
      index += 1;
    }

    const detailHtml = details.length
      ? `<div class="list-detail">${details.map((line) => inlineMarkdown(line)).join("<br>")}</div>`
      : "";

    content = normalizeCheckbox(inlineMarkdown(content));
    items.push(`<li>${content}${detailHtml}</li>`);
  }

  return {
    html: `<${tag}>\n${items.join("\n")}\n</${tag}>`,
    nextIndex: index,
  };
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code class="language-${escapeHtml(language)}">${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const table = renderTable(lines, index);
      blocks.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = renderList(lines, index, true);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const list = renderList(lines, index, false);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !lines[index].match(/^#{1,6}\s+/) &&
      !lines[index].startsWith("```") &&
      !lines[index].match(/^\s*\d+\.\s+/) &&
      !lines[index].match(/^\s*[-*+]\s+/) &&
      !(lines[index].includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${paragraph.map((part) => inlineMarkdown(part)).join("<br>")}</p>`);
  }

  return blocks.join("\n\n");
}

function buildHtml(markdown, title) {
  const body = markdownToHtml(markdown);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page {
    size: letter;
    margin: 0.55in 0.5in;
  }

  * {
    box-sizing: border-box;
  }

  body {
    color: #1f2933;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.35;
    margin: 0;
  }

  h1, h2, h3, h4 {
    color: #18212f;
    font-family: Arial, Helvetica, sans-serif;
    line-height: 1.12;
    page-break-after: avoid;
  }

  h1 {
    border-bottom: 2px solid #18212f;
    font-size: 22pt;
    margin: 0 0 0.22in;
    padding-bottom: 0.12in;
  }

  h2 {
    border-top: 1px solid #a7b0ba;
    font-size: 14pt;
    margin: 0.28in 0 0.1in;
    padding-top: 0.11in;
  }

  h3 {
    font-size: 11.5pt;
    margin: 0.18in 0 0.08in;
  }

  h4 {
    font-size: 10.5pt;
    margin: 0.14in 0 0.06in;
  }

  p {
    margin: 0 0 0.11in;
  }

  ul, ol {
    margin: 0 0 0.12in 0.22in;
    padding-left: 0.15in;
  }

  li {
    break-inside: avoid;
    margin: 0 0 0.04in;
  }

  .list-detail {
    color: #3b4652;
    font-size: 9.5pt;
    margin-top: 0.03in;
  }

  table {
    border-collapse: collapse;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.2pt;
    line-height: 1.2;
    margin: 0 0 0.16in;
    page-break-inside: auto;
    width: 100%;
  }

  thead {
    display: table-header-group;
  }

  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  th, td {
    border: 1px solid #c8d0d8;
    padding: 0.045in 0.055in;
    text-align: left;
    vertical-align: top;
    word-break: normal;
  }

  th {
    background: #edf2f7;
    color: #18212f;
    font-weight: 700;
  }

  code {
    background: #f3f5f7;
    border-radius: 3px;
    font-family: Consolas, "Liberation Mono", monospace;
    font-size: 0.9em;
    padding: 0.02in 0.04in;
  }

  pre {
    background: #f3f5f7;
    border: 1px solid #d8dee6;
    border-radius: 4px;
    font-size: 9pt;
    margin: 0 0 0.14in;
    padding: 0.09in;
    white-space: pre-wrap;
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  .checkbox {
    border: 1.2px solid #1f2933;
    display: inline-block;
    height: 0.12in;
    margin-right: 0.06in;
    vertical-align: -0.01in;
    width: 0.12in;
  }

  .checkbox.checked {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt;
    line-height: 0.1in;
    text-align: center;
  }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function isInsideRoot(filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function walkMarkdownFiles(dir) {
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

function resolveInput(inputArg) {
  const inputPath = path.resolve(process.cwd(), inputArg);
  if (!isInsideRoot(inputPath)) {
    throw new Error("Input must be inside the cookbook folder.");
  }

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input does not exist: ${inputArg}`);
  }

  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    return { type: "directory", path: inputPath };
  }

  if (!stat.isFile() || path.extname(inputPath).toLowerCase() !== ".md") {
    throw new Error("Input must be a Markdown .md file or a folder containing Markdown files.");
  }

  return { type: "file", path: inputPath };
}

function defaultOutputPath(inputPath) {
  const relative = path.relative(rootDir, inputPath);
  const parsed = path.parse(relative);
  return path.join(rootDir, "exports", parsed.dir, `${parsed.name}.pdf`);
}

function htmlOutputPath(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, ".html");
}

function defaultOutputDir(inputPath) {
  const relative = path.relative(rootDir, inputPath);
  return path.join(rootDir, "exports", relative);
}

function resolveFileOutput(outputArg, inputPath) {
  const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : defaultOutputPath(inputPath);
  if (!isInsideRoot(outputPath)) {
    throw new Error("Output file must be inside the cookbook folder.");
  }
  if (path.extname(outputPath).toLowerCase() !== ".pdf") {
    throw new Error("Output file must end in .pdf.");
  }
  return outputPath;
}

function resolveDirectoryOutput(outputArg, inputPath) {
  const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : defaultOutputDir(inputPath);
  if (!isInsideRoot(outputPath)) {
    throw new Error("Output folder must be inside the cookbook folder.");
  }
  if (path.extname(outputPath).toLowerCase() === ".pdf") {
    throw new Error("Directory exports must use an output folder, not a .pdf file.");
  }
  return outputPath;
}

function buildExportJobs(input, outputArg) {
  if (input.type === "file") {
    const outputPath = resolveFileOutput(outputArg, input.path);
    return [
      {
        inputPath: input.path,
        htmlPath: htmlOutputPath(outputPath),
        outputPath,
      },
    ];
  }

  const outputDir = resolveDirectoryOutput(outputArg, input.path);
  const markdownFiles = walkMarkdownFiles(input.path);

  if (markdownFiles.length === 0) {
    throw new Error(`No Markdown files found in ${path.relative(process.cwd(), input.path)}.`);
  }

  return markdownFiles.map((inputPath) => {
    const relative = path.relative(input.path, inputPath);
    const parsed = path.parse(relative);
    return {
      inputPath,
      htmlPath: path.join(outputDir, "html", parsed.dir, `${parsed.name}.html`),
      outputPath: path.join(outputDir, "pdf", parsed.dir, `${parsed.name}.pdf`),
    };
  });
}

function findBrowser() {
  return defaultBrowserPaths.filter((browserPath) => fs.existsSync(browserPath));
}

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, "/").replace(/#/g, "%23")}`;
}

function runBrowserPrint(browserPath, htmlPath, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "family-cookbook-browser-"));
  const browserProfilePath = path.join(tempDir, "profile");
  const commonArgs = [
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-software-rasterizer",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${browserProfilePath}`,
    `--print-to-pdf=${outputPath}`,
    fileUrl(htmlPath),
  ];
  const attempts = [
    ["--headless=new", ...commonArgs],
    ["--headless", ...commonArgs],
  ];
  const errors = [];

  for (const args of attempts) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const result = spawnSync(browserPath, args, { encoding: "utf8" });

    if (result.error) {
      errors.push(`${path.basename(browserPath)}: ${result.error.message}`);
      continue;
    }

    const pdfExists = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
    if (result.status === 0 && pdfExists) {
      return { ok: true };
    }

    const reason = result.status === 0
      ? "browser exited successfully but did not write a PDF"
      : `exit code ${result.status}`;
    const details = (result.stderr || result.stdout || "").trim();
    errors.push(`${path.basename(browserPath)} ${args[0]}: ${reason}${details ? `\n${details}` : ""}`);
  }

  return { ok: false, errors };
}

function exportMarkdownFile(browserPaths, inputPath, htmlPath, outputPath) {
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const markdown = fs.readFileSync(inputPath, "utf8");
  const title = path.basename(inputPath, ".md");
  const html = buildHtml(markdown, title);
  fs.writeFileSync(htmlPath, html);

  const errors = [];
  for (const browserPath of browserPaths) {
    const result = runBrowserPrint(browserPath, htmlPath, outputPath);
    if (result.ok) {
      console.log(`Wrote ${path.relative(process.cwd(), htmlPath)}`);
      console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
      return { ok: true };
    }
    errors.push(...result.errors);
  }

  return {
    ok: false,
    error: [
      `Browser PDF export failed for ${path.relative(process.cwd(), inputPath)}.`,
      `Wrote printable HTML fallback: ${path.relative(process.cwd(), htmlPath)}`,
      "",
      ...errors,
    ].join("\n"),
  };
}

function main() {
  const [, , inputArg, outputArg] = process.argv;
  if (!inputArg || inputArg === "--help" || inputArg === "-h") {
    usage();
    process.exit(inputArg ? 0 : 1);
  }

  const input = resolveInput(inputArg);
  const jobs = buildExportJobs(input, outputArg);
  const browserPaths = findBrowser();

  if (browserPaths.length === 0) {
    throw new Error("Could not find Chrome or Edge. Set CHROME_PATH or EDGE_PATH to a browser executable.");
  }

  console.log(`Exporting ${jobs.length} Markdown file${jobs.length === 1 ? "" : "s"}...`);

  const failures = [];
  for (const job of jobs) {
    const result = exportMarkdownFile(browserPaths, job.inputPath, job.htmlPath, job.outputPath);
    if (!result.ok) {
      failures.push(result.error);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n\n"));
  }
}

try {
  main();
} catch (error) {
  console.error(`Export failed: ${error.message}`);
  process.exit(1);
}
