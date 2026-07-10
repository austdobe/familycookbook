import { formatQuantity } from "./units.js";

export function markdownToHtml(markdown, options = {}) {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;
  const unitMode = options.unitMode || "us";
  let openCollapsibleSectionLevel = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      if (openCollapsibleSectionLevel && level <= openCollapsibleSectionLevel) {
        html.push("</details>");
        openCollapsibleSectionLevel = 0;
      }
      if (level === 2 && isCollapsibleRecipeSection(heading[2])) {
        html.push(`
          <details class="collapsible-section recipe-ingredients-section" open>
            <summary>
              <span class="collapsible-section-title">${inlineMarkdown(heading[2])}</span>
              <span class="collapsible-section-indicator" aria-hidden="true"></span>
            </summary>
        `);
        openCollapsibleSectionLevel = level;
      } else {
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      }
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const table = renderMarkdownTable(lines, index, unitMode);
      html.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const list = renderMarkdownList(lines, index, /^\s*\d+\.\s+/.test(line));
      html.push(list.html);
      index = list.nextIndex;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^#{1,6}\s+/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !(lines[index].includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    html.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
  }

  if (openCollapsibleSectionLevel) {
    html.push("</details>");
  }

  return html.join("");
}

function isCollapsibleRecipeSection(value) {
  return String(value || "").replace(/[*_`]/g, "").trim().toLowerCase() === "ingredients";
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderMarkdownList(lines, startIndex, ordered) {
  const tag = ordered ? "ol" : "ul";
  const pattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const match = lines[index].match(pattern);
    if (!match) {
      break;
    }
    items.push(`<li>${inlineMarkdown(match[1])}</li>`);
    index += 1;
  }

  return { html: `<${tag}>${items.join("")}</${tag}>`, nextIndex: index };
}

function renderMarkdownTable(lines, startIndex, unitMode) {
  const headers = splitTableRow(lines[startIndex]);
  const tableKind = getTableKind(headers);
  const tableClass = ["markdown-table", tableKind === "ingredients" ? "ingredient-table" : ""].filter(Boolean).join(" ");
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  return {
    html: `
      <div class="table-wrap">
        <table class="${tableClass}">
          <thead><tr>${headers.map((header) => `<th class="${columnClass(header, tableKind)}">${inlineMarkdown(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${headers.map((header, cellIndex) => `<td class="${columnClass(header, tableKind)}" data-label="${escapeHtml(header)}">${inlineMarkdown(cellValue(header, row[cellIndex] || "", unitMode))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    `,
    nextIndex: index,
  };
}

function cellValue(header, value, unitMode) {
  return normalizeHeader(header) === "quantity" ? formatQuantity(value, unitMode) : value;
}

function getTableKind(headers) {
  const normalized = headers.map(normalizeHeader);
  if (normalized.includes("quantity") && (normalized.includes("ingredient") || normalized.includes("item"))) {
    return "ingredients";
  }
  return "";
}

function columnClass(header, tableKind) {
  const normalized = normalizeHeader(header);
  const classes = [`table-column-${normalized || "blank"}`];

  if (tableKind === "ingredients") {
    const essential = normalized === "quantity" || normalized === "ingredient" || normalized === "item";
    classes.push(essential ? "ingredient-essential-column" : "ingredient-detail-column");
  }

  return classes.join(" ");
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
