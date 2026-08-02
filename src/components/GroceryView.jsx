import React, { useEffect, useState } from "react";
import { sortGroceryItems } from "../domain/groceryEngine.js";
import { groceryItemStableKey } from "../domain/listReconciliation.js";
import { clearGroceryState, saveGroceryState, subscribeGroceryState, toggleGroceryItem } from "../services/groceryStore.js";
import { formatQuantity } from "../services/units.js";

export function GroceryView({ ingredientMode, isSealed = false, search, setIngredientMode, setUnitMode, unitMode, week }) {
  const [groceryState, setGroceryState] = useState({ checkedKeys: [], manualItems: [], sections: [] });
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [editingGroceryKey, setEditingGroceryKey] = useState("");
  const [manualForm, setManualForm] = useState(emptyManualGroceryForm());

  useEffect(() => {
    if (!week) {
      return undefined;
    }
    return subscribeGroceryState(week.id, setGroceryState);
  }, [week]);

  useEffect(() => {
    if (!week) {
      return;
    }
    const options = groceryCategoryOptions(groceryState.sections?.length ? groceryState.sections : week.grocerySections);
    setManualForm((current) => ({
      ...current,
      section: resolveGrocerySectionTitle(current.section, options) || options[0] || "Other",
    }));
  }, [groceryState.sections, week?.id]);

  useEffect(() => {
    if (!manualDialogOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setManualDialogOpen(false);
        setEditingGroceryKey("");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [manualDialogOpen]);

  if (!week) {
    return <div className="empty">No grocery list found.</div>;
  }

  const checkedKeys = new Set(groceryState.checkedKeys || []);
  const storedGrocerySections = groceryState.sections?.length ? groceryState.sections : week.grocerySections;
  const legacyManualItems = groceryState.manualItems || [];
  const sourceGrocerySections = legacyManualItems.length
    ? mergeManualItemsIntoSections(storedGrocerySections, legacyManualItems, groceryCategoryOptions(storedGrocerySections))
    : storedGrocerySections;
  const categoryOptions = groceryCategoryOptions(sourceGrocerySections);
  const recipeSections = sourceGrocerySections.map((section, sectionIndex) => ({
    ...section,
    items: section.items.map((item, itemIndex) => ({
      ...item,
      _key: groceryItemKey(week, section, item, sectionIndex, itemIndex),
      _section: section.title,
    })),
  }));
  const sections = moveCheckedItemsToHaveIt(recipeSections
    .map((section) => ({
      ...section,
      items: sortGroceryItems(section.items.filter((item) => matchesSearch(Object.values(item).join(" "), search))),
    }))
    .filter((section) => section.items.length), checkedKeys);
  const openAddDialog = () => {
    if (isSealed) {
      return;
    }
    setEditingGroceryKey("");
    setManualForm(emptyManualGroceryForm(categoryOptions[0] || "Other"));
    setManualDialogOpen(true);
  };
  const openEditDialog = (item) => {
    if (isSealed) {
      return;
    }
    setEditingGroceryKey(item._key);
    setManualForm({
      alternatives: item["Acceptable alternatives"] || "",
      item: item.Item || "",
      preferred: item["Preferred version/type"] || "",
      quantity: item.Quantity || "",
      recipe: item.Recipe || "",
      section: resolveGrocerySectionTitle(item._section, categoryOptions) || categoryOptions[0] || "Other",
    });
    setManualDialogOpen(true);
  };
  const closeManualDialog = () => {
    setManualDialogOpen(false);
    setEditingGroceryKey("");
  };
  const saveManualItem = async (event) => {
    event.preventDefault();
    if (isSealed || !manualForm.item.trim()) {
      return;
    }
    const section = resolveGrocerySectionTitle(manualForm.section, categoryOptions) || categoryOptions[0] || "Other";
    const nextForm = { ...manualForm, section };
    if (editingGroceryKey) {
      await saveGroceryState(week.id, updateGrocerySectionsState(week, groceryState, sourceGrocerySections, editingGroceryKey, nextForm));
    } else {
      await saveGroceryState(week.id, addGroceryItemState(groceryState, sourceGrocerySections, nextForm));
    }
    setManualForm(emptyManualGroceryForm(section));
    closeManualDialog();
  };
  const removeGroceryItem = async (item) => {
    if (isSealed) {
      return;
    }
    await saveGroceryState(week.id, removeGroceryItemState(week, groceryState, sourceGrocerySections, item._key));
  };

  return (
    <div className="stack grocery-view">
      <section className="card grocery-toolbar">
        <div>
          <h3>Shopping Checklist</h3>
          <p>{isSealed ? "This grocery list is sealed for this week." : "Checked items stay saved for this week."}</p>
        </div>
        <div className="grocery-toolbar-actions">
          <IngredientDetailToggle mode={ingredientMode} setMode={setIngredientMode} />
          <QuantityUnitToggle mode={unitMode} setMode={setUnitMode} />
          <button className="quiet-button" disabled={isSealed} onClick={() => clearGroceryState(week.id)} type="button">Clear Checks</button>
        </div>
      </section>

      {sections.length ? sections.map((section) => (
        <GrocerySection
          checkedKeys={checkedKeys}
          ingredientMode={ingredientMode}
          key={section.title}
          onEdit={openEditDialog}
          onRemove={removeGroceryItem}
          onToggle={(item, checked) => !isSealed && toggleGroceryItem(week.id, item._key, checked)}
          isSealed={isSealed}
          section={section}
          unitMode={unitMode}
        />
      )) : <div className="empty">No grocery items match the current search.</div>}
      <button
        aria-label="Add grocery item"
        className="grocery-fab"
        disabled={isSealed}
        onClick={openAddDialog}
        type="button"
      >
        <span aria-hidden="true">+</span>
      </button>
      {manualDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closeManualDialog}>
          <form
            aria-label={editingGroceryKey ? "Edit grocery item" : "Add grocery item"}
            className="card grocery-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={saveManualItem}
          >
            <div className="dialog-header">
              <h3>{editingGroceryKey ? "Edit Grocery Item" : "Add Grocery Item"}</h3>
              <button
                aria-label="Close dialog"
                className="icon-button"
                onClick={closeManualDialog}
                type="button"
              >
                x
              </button>
            </div>
            <label>
              Category
              <select
                onChange={(event) => setManualForm({ ...manualForm, section: event.target.value })}
                value={manualForm.section}
              >
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </label>
            <div className="manual-grocery-grid">
              <label>
                Quantity
                <input
                  onChange={(event) => setManualForm({ ...manualForm, quantity: event.target.value })}
                  placeholder="2 bunches"
                  value={manualForm.quantity}
                />
              </label>
              <label>
                Item
                <input
                  autoFocus
                  onChange={(event) => setManualForm({ ...manualForm, item: event.target.value })}
                  placeholder="Green onions"
                  value={manualForm.item}
                />
              </label>
            </div>
            <label>
              Preferred version
              <input
                onChange={(event) => setManualForm({ ...manualForm, preferred: event.target.value })}
                placeholder="Optional"
                value={manualForm.preferred}
              />
            </label>
            <label>
              Acceptable alternatives
              <input
                onChange={(event) => setManualForm({ ...manualForm, alternatives: event.target.value })}
                placeholder="Optional"
                value={manualForm.alternatives}
              />
            </label>
            <label>
              Used for
              <input
                onChange={(event) => setManualForm({ ...manualForm, recipe: event.target.value })}
                placeholder="Recipe or note"
                value={manualForm.recipe}
              />
            </label>
            <div className="dialog-actions">
              {editingGroceryKey ? (
                <button
                  className="mini-button"
                  onClick={async () => {
                    if (isSealed) {
                      return;
                    }
                    await saveGroceryState(week.id, removeGroceryItemState(week, groceryState, sourceGrocerySections, editingGroceryKey));
                    closeManualDialog();
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
              <button className="quiet-button" onClick={closeManualDialog} type="button">Cancel</button>
              <button className="primary-button" type="submit">{editingGroceryKey ? "Save" : "Add"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function GrocerySection({ checkedKeys, ingredientMode, isSealed = false, onEdit, onRemove, onToggle, section, unitMode }) {
  const [expandedKeys, setExpandedKeys] = useState([]);
  const headers = orderedGroceryHeaders(section.items);
  const visibleHeaders = ingredientMode === "simple" ? headers.filter(isEssentialGroceryHeader) : headers;
  const detailHeaders = headers.filter((header) => !isEssentialGroceryHeader(header));
  const toggleExpanded = (itemKey) => {
    setExpandedKeys((current) => (
      current.includes(itemKey)
        ? current.filter((key) => key !== itemKey)
        : [...current, itemKey]
    ));
  };

  return (
    <section className={section.isHaveIt ? "have-it-section" : ""}>
      <div className="section-title">
        <h3>{section.title}</h3>
        <span className="pill">{section.isHaveIt ? `${section.items.length} checked` : `${section.items.length} items`}</span>
      </div>
      <div className="table-wrap">
        <table className={`grocery-table grocery-mode-${ingredientMode}`}>
          <thead>
            <tr>
              <th className="check-column">Have</th>
              {visibleHeaders.map((header) => <th className={groceryFieldClass(header)} key={header}>{header}</th>)}
              <th className="check-column">Edit</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((item) => {
              const checked = checkedKeys.has(item._key);
              const expanded = ingredientMode === "detailed" || expandedKeys.includes(item._key);
              const canToggleDetails = ingredientMode === "simple";
              return (
                <tr
                  aria-expanded={canToggleDetails ? expanded : undefined}
                  className={`${checked ? "grocery-checked" : ""} ${expanded ? "grocery-expanded" : ""} ${canToggleDetails ? "grocery-can-expand" : ""}`}
                  key={item._key}
                  onDoubleClick={() => canToggleDetails && toggleExpanded(item._key)}
                  onKeyDown={(event) => {
                    if (!canToggleDetails || (event.key !== "Enter" && event.key !== " ")) {
                      return;
                    }
                    event.preventDefault();
                    toggleExpanded(item._key);
                  }}
                  tabIndex={canToggleDetails ? 0 : undefined}
                >
                  <td className="grocery-mobile-summary">
                    <div className="grocery-mobile-main">
                      <span className="grocery-mobile-item">{item.Item || ""}</span>
                      {item.Quantity ? (
                        <span className="grocery-mobile-quantity">{formatGroceryCardQuantity(item.Quantity, unitMode)}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="check-column grocery-check-cell" data-label="Have">
                    <label className="grocery-check-control">
                      <input
                        checked={checked}
                        className="grocery-check"
                        disabled={isSealed}
                        onChange={(event) => onToggle(item, event.target.checked)}
                        onDoubleClick={(event) => event.stopPropagation()}
                        type="checkbox"
                      />
                      <span>{checked ? "Have it" : "Need it"}</span>
                    </label>
                  </td>
                  {visibleHeaders.map((header) => (
                    <td className={groceryFieldClass(header)} data-label={header} key={header}>
                      {isQuantityHeader(header) ? formatQuantity(item[header], unitMode) : item[header] || ""}
                    </td>
                  ))}
                  {ingredientMode === "simple" ? detailHeaders.map((header) => (
                    <td className={`${groceryFieldClass(header)} grocery-detail-field`} data-label={header} key={`detail-${header}`}>
                      {item[header] || ""}
                    </td>
                  )) : null}
                  <td className="check-column grocery-edit-cell" data-label="Edit">
                    <div className="grocery-row-actions">
                      <button className="mini-button neutral" disabled={isSealed} onClick={() => onEdit(item)} onDoubleClick={(event) => event.stopPropagation()} type="button">Edit</button>
                      <button className="mini-button" disabled={isSealed} onClick={() => onRemove(item)} onDoubleClick={(event) => event.stopPropagation()} type="button">Remove</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function orderedGroceryHeaders(items = []) {
  const presentHeaders = new Set(
    items.flatMap((item) => Object.keys(item || {}).filter((header) => !header.startsWith("_")))
  );
  const preferredOrder = [
    "Item",
    "Quantity",
    "Preferred version/type",
    "Acceptable alternatives",
    "Recipe",
  ];
  return [
    ...preferredOrder.filter((header) => presentHeaders.has(header)),
    ...[...presentHeaders].filter((header) => !preferredOrder.includes(header)).sort(),
  ];
}

function addGroceryItemState(currentState, sourceSections, form) {
  const nextSections = cleanGrocerySections(sourceSections);
  const targetSection = ensureGrocerySection(nextSections, form.section || "Other");
  targetSection.items.push(groceryItemFromForm(form, `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`));
  return {
    ...currentState,
    manualItems: [],
    sections: removeEmptyGrocerySections(nextSections),
  };
}

function updateGrocerySectionsState(week, currentState, sourceSections, itemKey, form) {
  const nextSections = cleanGrocerySections(sourceSections);
  let editedItem = null;

  nextSections.forEach((section, sectionIndex) => {
    section.items = section.items.filter((item, itemIndex) => {
      if (groceryItemKey(week, section, item, sectionIndex, itemIndex) !== itemKey) {
        return true;
      }
      editedItem = { ...item, ...groceryItemFromForm(form, item._manualId) };
      return false;
    });
  });

  if (editedItem) {
    ensureGrocerySection(nextSections, form.section || "Other").items.push(editedItem);
  }

  return {
    ...currentState,
    checkedKeys: (currentState.checkedKeys || []).filter((key) => key !== itemKey),
    manualItems: [],
    sections: removeEmptyGrocerySections(nextSections),
  };
}

function removeGroceryItemState(week, currentState, sourceSections, itemKey) {
  const nextSections = cleanGrocerySections(sourceSections).map((section, sectionIndex) => ({
    ...section,
    items: section.items.filter((item, itemIndex) => groceryItemKey(week, section, item, sectionIndex, itemIndex) !== itemKey),
  }));

  return {
    ...currentState,
    checkedKeys: (currentState.checkedKeys || []).filter((key) => key !== itemKey),
    manualItems: [],
    sections: removeEmptyGrocerySections(nextSections),
  };
}

function cleanGrocerySections(sections = []) {
  return sections.map((section) => ({
    title: section.title || "Other",
    items: (section.items || []).map(cleanGroceryItem),
  }));
}

function cleanGroceryItem(item) {
  return Object.fromEntries(
    Object.entries(item || {}).filter(([key]) => !key.startsWith("_") || key === "_manualId" || key === "_source")
  );
}

function groceryItemFromForm(form, manualId = "") {
  return {
    Quantity: form.quantity || "",
    Item: form.item.trim(),
    "Preferred version/type": form.preferred || "",
    "Acceptable alternatives": form.alternatives || "",
    Recipe: form.recipe || "Manual add",
    ...(manualId ? { _manualId: manualId, _source: "manual" } : {}),
  };
}

function ensureGrocerySection(sections, title) {
  const sectionTitle = title || "Other";
  let section = sections.find((candidate) => normalizeSectionName(candidate.title) === normalizeSectionName(sectionTitle));
  if (!section) {
    section = { title: sectionTitle, items: [] };
    sections.push(section);
  }
  return section;
}

function removeEmptyGrocerySections(sections) {
  return sections.filter((section) => section.items.length);
}

const GROCERY_CATEGORY_OPTIONS = ["Produce", "Meat and Seafood", "Dairy and Eggs", "Bakery", "Pantry and Dry Goods", "Sauces, Condiments, and Spices", "Frozen", "Costco", "Other"];

function groceryCategoryOptions(sections) { return uniqueValues([...GROCERY_CATEGORY_OPTIONS, ...(sections || []).map((section) => section.title).filter(Boolean)]); }
function resolveGrocerySectionTitle(value, options) { const normalized = normalizeSectionName(value || "Other"); return options.find((option) => normalizeSectionName(option) === normalized) || ""; }
function normalizeSectionName(value) { return String(value || "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function uniqueValues(values) { return [...new Set(values)]; }
function matchesSearch(text, search) { return !search || String(text || "").toLowerCase().includes(String(search).toLowerCase()); }
function groceryItemKey(week, section, item) { return groceryItemStableKey(week.id, section, item); }
function groceryFieldClass(header) { return `grocery-field grocery-field-${normalizeHeader(header)}`; }
function isEssentialGroceryHeader(header) { return ["quantity", "item"].includes(normalizeHeader(header)); }
function isQuantityHeader(header) { return normalizeHeader(header) === "quantity"; }
function normalizeHeader(header) { return header.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }
function formatGroceryCardQuantity(value, unitMode) { const formatted = formatQuantity(value, unitMode); return /^\\d+(?:\\.\\d+)?$/.test(formatted.trim()) ? `x${formatted.trim()}` : formatted; }

function mergeManualItemsIntoSections(recipeSections, manualItems, categoryOptions) {
  const grouped = new Map();
  manualItems.forEach((item) => {
    const title = resolveGrocerySectionTitle(item.section, categoryOptions) || "Other";
    if (!grouped.has(title)) grouped.set(title, { title, items: [] });
    grouped.get(title).items.push({ Quantity: item.quantity || "", Item: item.item || "", "Preferred version/type": item.preferred || "Manual add", "Acceptable alternatives": item.alternatives || "", Recipe: item.recipe || "Manual add", _key: `manual|${item.id}`, _manualId: item.id, _section: title, _source: "manual" });
  });
  const sections = (recipeSections || []).map((section) => {
    const manualSection = grouped.get(section.title);
    grouped.delete(section.title);
    return manualSection ? { ...section, items: [...section.items, ...manualSection.items] } : section;
  });
  return [...sections, ...grouped.values()];
}

function moveCheckedItemsToHaveIt(sections, checkedKeys) {
  const checkedItems = [];
  const activeSections = sections.map((section) => ({ ...section, items: section.items.filter((item) => { if (checkedKeys.has(item._key)) { checkedItems.push(item); return false; } return true; }) })).filter((section) => section.items.length);
  return checkedItems.length ? [...activeSections, { isHaveIt: true, title: "Have It", items: sortGroceryItems(checkedItems) }] : activeSections;
}

function emptyManualGroceryForm(section = "Other") { return { alternatives: "", item: "", preferred: "", quantity: "", recipe: "Manual add", section }; }

function IngredientDetailToggle({ mode, setMode }) {
  return <div className="segmented-control" aria-label="Ingredient detail level">{["simple", "detailed"].map((option) => <button aria-pressed={mode === option} className={mode === option ? "active" : ""} key={option} onClick={() => setMode(option)} type="button">{option === "simple" ? "Simple" : "Detailed"}</button>)}</div>;
}
function QuantityUnitToggle({ mode, setMode }) {
  return <div className="segmented-control unit-control" aria-label="Quantity units">{["us", "metric"].map((option) => <button aria-pressed={mode === option} className={mode === option ? "active" : ""} key={option} onClick={() => setMode(option)} type="button">{option === "us" ? "US" : "Metric"}</button>)}</div>;
}
