const state = {
  data: null,
  view: "week",
  weekId: null,
  activeDocId: null,
  deferredInstallPrompt: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  els.content = document.querySelector("#content");
  els.viewTitle = document.querySelector("#view-title");
  els.viewKicker = document.querySelector("#view-kicker");
  els.weekSelect = document.querySelector("#week-select");
  els.search = document.querySelector("#search-input");
  els.syncNote = document.querySelector("#sync-note");
  els.installButton = document.querySelector("#install-button");
  els.refreshButton = document.querySelector("#refresh-button");
  els.navButtons = [...document.querySelectorAll(".nav-button")];

  wireEvents();
  registerServiceWorker();
  loadData();
});

function wireEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.activeDocId = null;
      render();
    });
  });

  els.weekSelect.addEventListener("change", () => {
    state.weekId = els.weekSelect.value;
    state.activeDocId = null;
    render();
  });

  els.search.addEventListener("input", () => render());
  els.refreshButton.addEventListener("click", () => loadData());

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    els.installButton.hidden = false;
  });

  els.installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) {
      return;
    }
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    els.installButton.hidden = true;
  });
}

async function loadData() {
  els.content.innerHTML = '<div class="empty">Loading cookbook...</div>';
  const response = await fetch("data/cookbook.json", { cache: "no-store" });
  state.data = await response.json();
  state.weekId = state.weekId || (state.data.weeks[0] && state.data.weeks[0].id);
  hydrateWeekSelect();
  render();
}

function hydrateWeekSelect() {
  els.weekSelect.innerHTML = state.data.weeks
    .map((week) => `<option value="${escapeHtml(week.id)}">${escapeHtml(week.label)}</option>`)
    .join("");
  els.weekSelect.value = state.weekId || "";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("service-worker.js").catch(() => {});
}

function render() {
  if (!state.data) {
    return;
  }

  els.navButtons.forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  els.syncNote.textContent = `Data built ${formatDateTime(state.data.generatedAt)}`;

  if (state.view === "week") {
    renderWeek();
  } else if (state.view === "recipes") {
    renderRecipes();
  } else if (state.view === "grocery") {
    renderGrocery();
  } else if (state.view === "prep") {
    renderPrep();
  } else {
    renderPlanning();
  }
}

function selectedWeek() {
  return state.data.weeks.find((week) => week.id === state.weekId) || state.data.weeks[0];
}

function query() {
  return els.search.value.trim().toLowerCase();
}

function matchesSearch(text) {
  const needle = query();
  return !needle || text.toLowerCase().includes(needle);
}

function renderWeek() {
  const week = selectedWeek();
  els.viewKicker.textContent = "Weekly plan";
  els.viewTitle.textContent = week ? week.packet.title : "Week";

  if (!week) {
    els.content.innerHTML = '<div class="empty">No weekly plans found.</div>';
    return;
  }

  const plannedMenuRows = week.weeklyMenu.filter(hasMeal);
  const menuRows = plannedMenuRows.filter((row) => matchesSearch(Object.values(row).join(" ")));
  const recipeCards = week.recipes;
  const selectedDoc = activeDoc(recipeCards, recipeCards[0]);

  els.content.innerHTML = `
    <div class="stack">
      <section>
        <div class="section-title">
          <h3>Weekly Menu</h3>
          <span class="pill">${plannedMenuRows.length} meals</span>
        </div>
        <div class="menu-grid">
          ${menuRows.map((row) => renderDayCard(row, selectedDoc)).join("") || '<div class="empty">No planned meals match the current search.</div>'}
        </div>
      </section>

      <section>
        <div class="section-title">
          <h3>Selected Recipe</h3>
          <span class="pill">${selectedDoc ? "Stage 1 draft" : "No draft"}</span>
        </div>
        <article class="doc">${selectedDoc ? markdownToHtml(selectedDoc.markdown) : '<h1>No Recipe Drafts Yet</h1><p>Selecting a planned meal will show its recipe here once a draft exists for this week.</p>'}</article>
      </section>
    </div>
  `;

  wireDocButtons(recipeCards);
}

function hasMeal(row) {
  return Boolean(
    [
      row.Meal,
      row["Recipe file"],
      row.Protein,
      row["Cuisine/flavor"],
    ]
      .join("")
      .trim()
  );
}

function renderDayCard(row, selectedDoc) {
  const recipeFile = row["Recipe file"] || "";
  const isActive = selectedDoc && recipeFile && selectedDoc.path.endsWith(`/${recipeFile}`);
  return `
    <button class="item-card day-card ${isActive ? "active" : ""}" type="button" data-recipe-file="${escapeHtml(recipeFile)}">
      <div class="meta-row">
        <span class="pill">${escapeHtml(row.Day || "Day")}</span>
        <span>${escapeHtml(row.Stage || "")}</span>
      </div>
      <h3>${escapeHtml(row.Meal || "")}</h3>
      <div class="meta-row">
        <span>${escapeHtml(row.Protein || "")}</span>
        <span>${escapeHtml(row["Cuisine/flavor"] || "")}</span>
      </div>
    </button>
  `;
}

function renderRecipes() {
  const docs = state.data.archivedRecipes
    .filter((doc) => matchesSearch(`${doc.title} ${doc.summary} ${doc.path}`));

  els.viewKicker.textContent = "Archive";
  els.viewTitle.textContent = "Recipe Archive";
  renderArchiveRecipeList(docs);
}

function renderGrocery() {
  const week = selectedWeek();
  els.viewKicker.textContent = "Weekly plan";
  els.viewTitle.textContent = "Grocery";

  if (!week) {
    els.content.innerHTML = '<div class="empty">No grocery list found.</div>';
    return;
  }

  const checkedKeys = getGroceryCheckedSet(week.id);
  const sections = week.grocerySections
    .map((section, sectionIndex) => ({
      ...section,
      items: section.items
        .map((item, itemIndex) => ({
          ...item,
          _key: groceryItemKey(week, section, item, sectionIndex, itemIndex),
        }))
        .filter((item) => matchesSearch(Object.values(item).join(" "))),
    }))
    .filter((section) => section.items.length);

  els.content.innerHTML = `
    <div class="stack">
      <section class="card grocery-toolbar">
        <div>
          <h3>Shopping Checklist</h3>
          <p>Checked items stay saved on this device for the selected week.</p>
        </div>
        <button id="clear-grocery-checks" class="quiet-button" type="button">Clear Checks</button>
      </section>
      ${sections.map((section) => renderGrocerySection(section, checkedKeys)).join("") || '<div class="empty">No grocery items match the current search.</div>'}
    </div>
  `;

  wireGroceryCheckboxes(week.id);
}

function renderGrocerySection(section, checkedKeys) {
  const headers = Object.keys(section.items[0] || {}).filter((header) => !header.startsWith("_"));
  return `
    <section>
      <div class="section-title">
        <h3>${escapeHtml(section.title)}</h3>
        <span class="pill">${section.items.length} items</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="check-column">Have</th>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${section.items.map((item) => renderGroceryRow(item, headers, checkedKeys)).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderGroceryRow(item, headers, checkedKeys) {
  const checked = checkedKeys.has(item._key);
  return `
    <tr class="${checked ? "grocery-checked" : ""}">
      <td class="check-column">
        <input class="grocery-check" type="checkbox" data-grocery-key="${escapeHtml(item._key)}" ${checked ? "checked" : ""} aria-label="Mark ${escapeHtml(item.Item || "item")} as already handled">
      </td>
      ${headers.map((header) => `<td>${escapeHtml(item[header] || "")}</td>`).join("")}
    </tr>
  `;
}

function wireGroceryCheckboxes(weekId) {
  const checkedKeys = getGroceryCheckedSet(weekId);

  document.querySelectorAll(".grocery-check").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const key = checkbox.dataset.groceryKey;
      if (checkbox.checked) {
        checkedKeys.add(key);
      } else {
        checkedKeys.delete(key);
      }
      saveGroceryCheckedSet(weekId, checkedKeys);
      checkbox.closest("tr").classList.toggle("grocery-checked", checkbox.checked);
    });
  });

  const clearButton = document.querySelector("#clear-grocery-checks");
  if (clearButton) {
    clearButton.addEventListener("click", () => {
      saveGroceryCheckedSet(weekId, new Set());
      renderGrocery();
    });
  }
}

function groceryItemKey(week, section, item, sectionIndex, itemIndex) {
  return [
    week.id,
    sectionIndex,
    section.title,
    itemIndex,
    item.Quantity,
    item.Item,
    item.Recipe,
  ].join("|");
}

function groceryStorageKey(weekId) {
  return `familyCookbook:grocery:${weekId}`;
}

function getGroceryCheckedSet(weekId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(groceryStorageKey(weekId)) || "[]"));
  } catch {
    return new Set();
  }
}

function saveGroceryCheckedSet(weekId, checkedKeys) {
  localStorage.setItem(groceryStorageKey(weekId), JSON.stringify([...checkedKeys]));
}

function renderPrep() {
  const week = selectedWeek();
  els.viewKicker.textContent = "Weekly plan";
  els.viewTitle.textContent = "Meal Prep";

  if (!week) {
    els.content.innerHTML = '<div class="empty">No prep guide found.</div>';
    return;
  }

  const sections = week.prepSections.filter((section) => matchesSearch(`${section.title} ${section.markdown}`));
  els.content.innerHTML = `
    <div class="stack">
      ${sections.map((section) => `
        <article class="doc">
          <h1>${escapeHtml(section.title)}</h1>
          ${markdownToHtml(section.markdown)}
        </article>
      `).join("") || '<div class="empty">No prep items match the current search.</div>'}
    </div>
  `;
}

function renderPlanning() {
  const docs = state.data.planningDocs.filter((doc) => matchesSearch(`${doc.title} ${doc.summary} ${doc.path}`));
  els.viewKicker.textContent = "Notes";
  els.viewTitle.textContent = "Planning";
  renderDocList(docs, docs[0]);
}

function renderDocList(docs, fallbackDoc) {
  const selected = activeDoc(docs, fallbackDoc);
  els.content.innerHTML = `
    <div class="split-view">
      <div class="stack">${docs.map((doc) => renderDocButton(doc)).join("") || '<div class="empty">Nothing matches the current search.</div>'}</div>
      <article class="doc">${selected ? markdownToHtml(selected.markdown) : ""}</article>
    </div>
  `;
  wireDocButtons(docs);
}

function renderArchiveRecipeList(docs) {
  const selected = activeDoc(docs, docs[0]);

  els.content.innerHTML = `
    <div class="split-view">
      <div class="folder-tree">
        ${docs.length ? renderFolderTree(buildFolderTree(docs)) : '<div class="empty">No archived recipes yet. Approved recipes will appear here after they move out of weekly folders.</div>'}
      </div>
      <article class="doc">${selected ? markdownToHtml(selected.markdown) : '<h1>Recipe Archive</h1><p>Promoted and archived recipes will render here.</p>'}</article>
    </div>
  `;

  wireDocButtons(docs);
}

function buildFolderTree(docs) {
  const root = { name: "Recipe Archive", folders: new Map(), docs: [] };

  docs.forEach((doc) => {
    const parts = doc.path.split("/");
    const fileName = parts.pop();
    let folderParts = parts;

    if (folderParts[0] === "recipe-archive") {
      folderParts = folderParts.slice(1);
    } else if (folderParts[0] === "recipes") {
      folderParts = ["recipes", ...folderParts.slice(1)];
    }

    let node = root;
    folderParts.forEach((part) => {
      if (!node.folders.has(part)) {
        node.folders.set(part, { name: part, folders: new Map(), docs: [] });
      }
      node = node.folders.get(part);
    });

    node.docs.push({ ...doc, fileName });
  });

  return root;
}

function renderFolderTree(node, depth = 0) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const docs = node.docs.sort((a, b) => a.title.localeCompare(b.title));
  const folderHtml = folders.map((folder) => renderFolderTree(folder, depth + 1)).join("");
  const docsHtml = docs.map((doc) => renderArchiveDocButton(doc)).join("");

  if (depth === 0) {
    return `${folderHtml}${docsHtml}`;
  }

  const docCount = countFolderDocs(node);
  return `
    <details class="folder-section" open>
      <summary>
        <span>${escapeHtml(formatFolderName(node.name))}</span>
        <span class="folder-count">${docCount}</span>
      </summary>
      <div class="folder-contents">
        ${folderHtml}${docsHtml || '<div class="empty">No recipes in this folder.</div>'}
      </div>
    </details>
  `;
}

function renderArchiveDocButton(doc) {
  return `
    <button class="archive-recipe-button ${doc.id === state.activeDocId ? "active" : ""}" type="button" data-doc-id="${escapeHtml(doc.id)}">
      <span>${escapeHtml(doc.title)}</span>
      <small>${escapeHtml(doc.fileName || doc.path)}</small>
    </button>
  `;
}

function countFolderDocs(node) {
  return node.docs.length + [...node.folders.values()].reduce((total, folder) => total + countFolderDocs(folder), 0);
}

function formatFolderName(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function renderDocButton(doc) {
  return `
    <button class="item-card ${doc.id === state.activeDocId ? "active" : ""}" type="button" data-doc-id="${escapeHtml(doc.id)}">
      <h3>${escapeHtml(doc.title)}</h3>
      <p>${escapeHtml(doc.summary || doc.path)}</p>
      <div class="meta-row">
        <span class="pill">${escapeHtml(doc.type.replace(/-/g, " "))}</span>
        <span>${escapeHtml(doc.path)}</span>
      </div>
    </button>
  `;
}

function wireDocButtons(docs) {
  document.querySelectorAll("[data-doc-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeDocId = button.dataset.docId;
      render();
    });
  });

  document.querySelectorAll("[data-recipe-file]").forEach((button) => {
    button.addEventListener("click", () => {
      const recipeFile = button.dataset.recipeFile;
      if (!recipeFile) {
        return;
      }
      const doc = docs.find((candidate) => candidate.path.endsWith(`/${recipeFile}`));
      if (doc) {
        state.activeDocId = doc.id;
        render();
      }
    });
  });
}

function activeDoc(docs, fallbackDoc) {
  return docs.find((doc) => doc.id === state.activeDocId) || fallbackDoc || docs[0];
}

function markdownToHtml(markdown) {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const table = renderMarkdownTable(lines, index);
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

  return html.join("");
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

function renderMarkdownTable(lines, startIndex) {
  const headers = splitTableRow(lines[startIndex]);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  return {
    html: `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map((header) => `<th>${inlineMarkdown(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${inlineMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </div>
    `,
    nextIndex: index,
  };
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

function formatDateTime(value) {
  if (!value) {
    return "recently";
  }
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
