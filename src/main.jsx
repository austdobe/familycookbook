import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addManualGroceryItem,
  clearGroceryState,
  removeManualGroceryItem,
  subscribeGroceryState,
  toggleGroceryItem,
  updateManualGroceryItem,
} from "./services/groceryStore.js";
import { markdownToHtml } from "./services/markdown.js";
import { clearPrepState, subscribePrepState, togglePrepTask } from "./services/prepStore.js";
import { saveRecipeFeedback, subscribeRecipeFeedback } from "./services/recipeFeedbackStore.js";
import { formatQuantity } from "./services/units.js";
import "./styles.css";

const views = [
  ["week", "Week"],
  ["recipes", "Recipes"],
  ["grocery", "Grocery"],
  ["prep", "Prep"],
];
const baseUrl = import.meta.env.BASE_URL;
const appVersion = "0.1.22";

function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("week");
  const [weekId, setWeekId] = useState("");
  const [activeDocId, setActiveDocId] = useState("");
  const [ingredientMode, setIngredientMode] = useState("simple");
  const [unitMode, setUnitMode] = useState("us");
  const [search, setSearch] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    loadData().then((nextData) => {
      setData(nextData);
      setWeekId((current) => current || getDefaultWeekId(nextData.weeks));
    });
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${baseUrl}service-worker.js`).catch(() => {});
    }

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  const selectedWeek = useMemo(() => {
    if (!data) {
      return null;
    }
    return data.weeks.find((week) => week.id === weekId) || data.weeks[0] || null;
  }, [data, weekId]);

  if (!data) {
    return <div className="empty full-page">Loading cookbook...</div>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Cookbook navigation">
        <div className="brand">
          <img src={`${baseUrl}icons/cookbook-icon.svg`} alt="" width="40" height="40" />
          <div>
            <p className="eyebrow">Family</p>
            <h1>Cookbook</h1>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          {views.map(([key, label]) => (
            <button
              className={`nav-button ${view === key ? "active" : ""}`}
              data-view={key}
              key={key}
              onClick={() => {
                setView(key);
                setActiveDocId("");
              }}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>

        <label className="field-label" htmlFor="week-select">Week</label>
        <select
          className="select"
          id="week-select"
          onChange={(event) => {
            setWeekId(event.target.value);
            setActiveDocId("");
          }}
          value={weekId}
        >
          {data.weeks.map((week) => (
            <option key={week.id} value={week.id}>{week.label}</option>
          ))}
        </select>

        <label className="field-label" htmlFor="search-input">Search</label>
        <input
          className="search"
          id="search-input"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Recipe, ingredient, plan"
          type="search"
          value={search}
        />

        <div className="sync-note">Build {appVersion} | Data built {formatDateTime(data.generatedAt)}</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewKicker(view)}</p>
            <h2>{viewTitle(view, selectedWeek)}</h2>
          </div>
          <div className="topbar-actions">
            {installPrompt ? (
              <button
                className="quiet-button"
                onClick={async () => {
                  installPrompt.prompt();
                  await installPrompt.userChoice;
                  setInstallPrompt(null);
                }}
                type="button"
              >
                Install
              </button>
            ) : null}
            <button
              className="quiet-button"
              onClick={() => loadData().then(setData)}
              type="button"
            >
              Refresh
            </button>
          </div>
        </header>

        <section className="content-panel" aria-live="polite">
          {view === "week" ? (
            <WeekView
              activeDocId={activeDocId}
              ingredientMode={ingredientMode}
              search={search}
              setActiveDocId={setActiveDocId}
              setIngredientMode={setIngredientMode}
              setUnitMode={setUnitMode}
              unitMode={unitMode}
              week={selectedWeek}
            />
          ) : null}
          {view === "recipes" ? (
            <ArchiveView
              activeDocId={activeDocId}
              docs={filterDocs(data.archivedRecipes, search)}
              ingredientMode={ingredientMode}
              setActiveDocId={setActiveDocId}
              setIngredientMode={setIngredientMode}
              setUnitMode={setUnitMode}
              unitMode={unitMode}
            />
          ) : null}
          {view === "grocery" ? (
            <GroceryView
              ingredientMode={ingredientMode}
              search={search}
              setIngredientMode={setIngredientMode}
              setUnitMode={setUnitMode}
              unitMode={unitMode}
              week={selectedWeek}
            />
          ) : null}
          {view === "prep" ? (
            <PrepView search={search} week={selectedWeek} />
          ) : null}
        </section>
      </main>
    </div>
  );
}

function WeekView({ activeDocId, ingredientMode, search, setActiveDocId, setIngredientMode, setUnitMode, unitMode, week }) {
  if (!week) {
    return <div className="empty">No weekly plans found.</div>;
  }

  const plannedMenuRows = week.weeklyMenu.filter(hasMeal);
  const menuRows = plannedMenuRows.filter((row) => matchesSearch(Object.values(row).join(" "), search));
  const selectedDoc = week.recipes.find((doc) => doc.id === activeDocId) || getDefaultRecipeForWeek(week) || week.recipes[0] || null;

  return (
    <div className="stack">
      <section>
        <div className="section-title">
          <h3>Weekly Menu</h3>
          <span className="pill">{plannedMenuRows.length} meals</span>
        </div>
        <div className="menu-grid">
          {menuRows.length ? menuRows.map((row) => (
            <DayCard
              key={`${row.Day}-${row.Meal}`}
              row={row}
              selectedDoc={selectedDoc}
              week={week}
              onSelect={setActiveDocId}
            />
          )) : <div className="empty">No planned meals match the current search.</div>}
        </div>
      </section>

      <section>
        <div className="section-title">
          <h3>Selected Recipe</h3>
          <div className="section-actions">
            <IngredientDetailToggle mode={ingredientMode} setMode={setIngredientMode} />
            <QuantityUnitToggle mode={unitMode} setMode={setUnitMode} />
            <span className="pill">{selectedDoc ? "Stage 1 draft" : "No draft"}</span>
          </div>
        </div>
        <MarkdownDoc
          ingredientMode={ingredientMode}
          unitMode={unitMode}
          markdown={selectedDoc ? selectedDoc.markdown : "# No Recipe Drafts Yet\n\nSelecting a planned meal will show its recipe here once a draft exists for this week."}
        />
        {selectedDoc ? <RecipeFeedbackPanel recipe={selectedDoc} /> : null}
      </section>
    </div>
  );
}

function RecipeFeedbackPanel({ recipe }) {
  const [feedback, setFeedback] = useState({ ingredientChanges: [], rating: "", notes: "" });
  const [ingredientDraft, setIngredientDraft] = useState(emptyIngredientDraft());
  const [status, setStatus] = useState("");
  const ingredientRows = useMemo(() => extractIngredientRows(recipe.markdown), [recipe.markdown]);

  useEffect(() => {
    setStatus("");
    setIngredientDraft(emptyIngredientDraft());
    return subscribeRecipeFeedback(recipe.id, setFeedback);
  }, [recipe.id]);

  const ingredientChanges = Array.isArray(feedback.ingredientChanges) ? feedback.ingredientChanges : [];

  return (
    <form
      className="card recipe-feedback"
      onSubmit={async (event) => {
        event.preventDefault();
        await saveRecipeFeedback(recipe.id, recipe.path, feedback);
        setStatus("Saved");
      }}
    >
      <div>
        <h3>Family Feedback</h3>
        <p>Saved here first. Apply approved notes to Markdown with `npm.cmd run apply:feedback`.</p>
      </div>
      <label>
        Rating
        <select
          onChange={(event) => setFeedback({ ...feedback, rating: event.target.value })}
          value={feedback.rating || ""}
        >
          <option value="">Not rated</option>
          <option value="5/5">5/5 - keeper</option>
          <option value="4/5">4/5 - repeat with tweaks</option>
          <option value="3/5">3/5 - maybe</option>
          <option value="2/5">2/5 - unlikely</option>
          <option value="1/5">1/5 - retire</option>
        </select>
      </label>
      <label>
        Notes
        <textarea
          onChange={(event) => setFeedback({ ...feedback, notes: event.target.value })}
          placeholder="What changed, who liked it, what should version 2 fix?"
          rows="4"
          value={feedback.notes || ""}
        />
      </label>

      <div className="ingredient-editor">
        <div>
          <h4>Ingredient Changes</h4>
          <p>Use this for quantity changes, swaps, removed ingredients, or ingredients added while cooking.</p>
        </div>
        <div className="ingredient-change-grid">
          <select
            aria-label="Change type"
            onChange={(event) => setIngredientDraft({ ...ingredientDraft, type: event.target.value })}
            value={ingredientDraft.type}
          >
            <option value="update">Update</option>
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </select>
          {ingredientDraft.type === "add" ? null : (
            <select
              aria-label="Existing ingredient"
              onChange={(event) => setIngredientDraft({ ...ingredientDraft, matchIngredient: event.target.value })}
              value={ingredientDraft.matchIngredient}
            >
              <option value="">Select ingredient</option>
              {ingredientRows.map((row) => (
                <option key={row.ingredient} value={row.ingredient}>{row.ingredient}</option>
              ))}
            </select>
          )}
          {ingredientDraft.type === "remove" ? null : (
            <>
              <input
                aria-label="Quantity"
                onChange={(event) => setIngredientDraft({ ...ingredientDraft, quantity: event.target.value })}
                placeholder="Quantity"
                value={ingredientDraft.quantity}
              />
              <input
                aria-label="Ingredient"
                onChange={(event) => setIngredientDraft({ ...ingredientDraft, ingredient: event.target.value })}
                placeholder={ingredientDraft.type === "add" ? "Ingredient" : "Replacement ingredient"}
                value={ingredientDraft.ingredient}
              />
              <input
                aria-label="Preferred version"
                onChange={(event) => setIngredientDraft({ ...ingredientDraft, preferred: event.target.value })}
                placeholder="Preferred version"
                value={ingredientDraft.preferred}
              />
              <input
                aria-label="Alternatives"
                onChange={(event) => setIngredientDraft({ ...ingredientDraft, alternatives: event.target.value })}
                placeholder="Alternatives"
                value={ingredientDraft.alternatives}
              />
            </>
          )}
          <input
            aria-label="Change note"
            onChange={(event) => setIngredientDraft({ ...ingredientDraft, notes: event.target.value })}
            placeholder="Why / result"
            value={ingredientDraft.notes}
          />
          <button
            className="quiet-button"
            onClick={() => {
              const normalized = normalizeIngredientChange(ingredientDraft);
              if (!normalized) {
                return;
              }
              setFeedback({
                ...feedback,
                ingredientChanges: [...ingredientChanges, normalized],
              });
              setIngredientDraft(emptyIngredientDraft());
            }}
            type="button"
          >
            Add Change
          </button>
        </div>
        {ingredientChanges.length ? (
          <div className="ingredient-change-list">
            {ingredientChanges.map((change) => (
              <div className="ingredient-change-item" key={change.id}>
                <span>
                  <strong>{formatIngredientChange(change)}</strong>
                  {change.notes ? ` - ${change.notes}` : ""}
                </span>
                <button
                  className="mini-button"
                  onClick={() => setFeedback({
                    ...feedback,
                    ingredientChanges: ingredientChanges.filter((item) => item.id !== change.id),
                  })}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="feedback-actions">
        <button className="quiet-button" type="submit">Save Feedback</button>
        {status ? <span className="pill">{status}</span> : null}
      </div>
    </form>
  );
}

function emptyIngredientDraft() {
  return {
    alternatives: "",
    ingredient: "",
    matchIngredient: "",
    notes: "",
    preferred: "",
    quantity: "",
    type: "update",
  };
}

function emptyManualGroceryForm(section = "Other") {
  return {
    alternatives: "",
    item: "",
    preferred: "",
    quantity: "",
    recipe: "Manual add",
    section,
  };
}

function normalizeIngredientChange(change) {
  if (change.type !== "add" && !change.matchIngredient) {
    return null;
  }
  if (change.type === "add" && !change.ingredient.trim()) {
    return null;
  }

  return {
    alternatives: change.alternatives.trim(),
    id: `ingredient-change-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ingredient: change.ingredient.trim(),
    matchIngredient: change.matchIngredient.trim(),
    notes: change.notes.trim(),
    preferred: change.preferred.trim(),
    quantity: change.quantity.trim(),
    type: change.type,
  };
}

function formatIngredientChange(change) {
  if (change.type === "add") {
    return `Add ${[change.quantity, change.ingredient].filter(Boolean).join(" ")}`;
  }
  if (change.type === "remove") {
    return `Remove ${change.matchIngredient}`;
  }
  const replacement = [change.quantity, change.ingredient || change.matchIngredient].filter(Boolean).join(" ");
  return `Update ${change.matchIngredient}${replacement ? ` to ${replacement}` : ""}`;
}

function DayCard({ onSelect, row, selectedDoc, week }) {
  const recipeFile = row["Recipe file"] || "";
  const doc = week.recipes.find((candidate) => recipeFile && candidate.path.endsWith(`/${recipeFile}`));
  const isActive = selectedDoc && doc && selectedDoc.id === doc.id;

  return (
    <button
      className={`item-card day-card ${isActive ? "active" : ""}`}
      onClick={() => doc && onSelect(doc.id)}
      type="button"
    >
      <div className="meta-row">
        <span className="pill">{row.Day || "Day"}</span>
        <span>{row.Stage || ""}</span>
      </div>
      <h3>{row.Meal || ""}</h3>
      <div className="meta-row">
        <span>{row.Protein || ""}</span>
        <span>{row["Cuisine/flavor"] || ""}</span>
      </div>
    </button>
  );
}

function GroceryView({ ingredientMode, search, setIngredientMode, setUnitMode, unitMode, week }) {
  const [groceryState, setGroceryState] = useState({ checkedKeys: [], manualItems: [], sections: [] });
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [editingManualId, setEditingManualId] = useState("");
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
        setEditingManualId("");
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
  const manualItems = groceryState.manualItems || [];
  const sourceGrocerySections = groceryState.sections?.length ? groceryState.sections : week.grocerySections;
  const categoryOptions = groceryCategoryOptions(sourceGrocerySections);
  const recipeSections = sourceGrocerySections.map((section, sectionIndex) => ({
    ...section,
    items: section.items.map((item, itemIndex) => ({
      ...item,
      _key: groceryItemKey(week, section, item, sectionIndex, itemIndex),
      _source: "recipe",
    })),
  }));
  const sections = moveCheckedItemsToHaveIt(mergeManualItemsIntoSections(recipeSections, manualItems, categoryOptions)
    .map((section) => ({
      ...section,
      items: sortGroceryItems(section.items.filter((item) => matchesSearch(Object.values(item).join(" "), search))),
    }))
    .filter((section) => section.items.length), checkedKeys);
  const openAddDialog = () => {
    setEditingManualId("");
    setManualForm(emptyManualGroceryForm(categoryOptions[0] || "Other"));
    setManualDialogOpen(true);
  };
  const openEditDialog = (item) => {
    setEditingManualId(item._manualId);
    setManualForm({
      alternatives: item["Acceptable alternatives"] || "",
      item: item.Item || "",
      preferred: item["Preferred version/type"] === "Manual add" ? "" : item["Preferred version/type"] || "",
      quantity: item.Quantity || "",
      recipe: item.Recipe || "Manual add",
      section: resolveGrocerySectionTitle(item._section, categoryOptions) || categoryOptions[0] || "Other",
    });
    setManualDialogOpen(true);
  };
  const closeManualDialog = () => {
    setManualDialogOpen(false);
    setEditingManualId("");
  };
  const saveManualItem = async (event) => {
    event.preventDefault();
    if (!manualForm.item.trim()) {
      return;
    }
    const section = resolveGrocerySectionTitle(manualForm.section, categoryOptions) || categoryOptions[0] || "Other";
    const nextForm = { ...manualForm, section };
    if (editingManualId) {
      await updateManualGroceryItem(week.id, editingManualId, nextForm);
    } else {
      await addManualGroceryItem(week.id, nextForm);
    }
    setManualForm(emptyManualGroceryForm(section));
    closeManualDialog();
  };

  return (
    <div className="stack grocery-view">
      <section className="card grocery-toolbar">
        <div>
          <h3>Shopping Checklist</h3>
          <p>Checked items sync with Firebase when configured. Otherwise they stay saved on this device.</p>
        </div>
        <div className="grocery-toolbar-actions">
          <IngredientDetailToggle mode={ingredientMode} setMode={setIngredientMode} />
          <QuantityUnitToggle mode={unitMode} setMode={setUnitMode} />
          <button className="quiet-button" onClick={() => clearGroceryState(week.id)} type="button">Clear Checks</button>
        </div>
      </section>

      {sections.length ? sections.map((section) => (
        <GrocerySection
          checkedKeys={checkedKeys}
          ingredientMode={ingredientMode}
          key={section.title}
          onEditManual={openEditDialog}
          onRemoveManual={(item) => removeManualGroceryItem(week.id, item._manualId)}
          onToggle={(item, checked) => toggleGroceryItem(week.id, item._key, checked)}
          section={section}
          unitMode={unitMode}
        />
      )) : <div className="empty">No grocery items match the current search.</div>}
      <button
        aria-label="Add grocery item"
        className="grocery-fab"
        onClick={openAddDialog}
        type="button"
      >
        <span aria-hidden="true">+</span>
      </button>
      {manualDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closeManualDialog}>
          <form
            aria-label={editingManualId ? "Edit grocery item" : "Add grocery item"}
            className="card grocery-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={saveManualItem}
          >
            <div className="dialog-header">
              <h3>{editingManualId ? "Edit Grocery Item" : "Add Grocery Item"}</h3>
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
              Source
              <input
                onChange={(event) => setManualForm({ ...manualForm, recipe: event.target.value })}
                placeholder="Manual add"
                value={manualForm.recipe}
              />
            </label>
            <div className="dialog-actions">
              {editingManualId ? (
                <button
                  className="mini-button"
                  onClick={async () => {
                    await removeManualGroceryItem(week.id, editingManualId);
                    closeManualDialog();
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
              <button className="quiet-button" onClick={closeManualDialog} type="button">Cancel</button>
              <button className="primary-button" type="submit">{editingManualId ? "Save" : "Add"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function GrocerySection({ checkedKeys, ingredientMode, onEditManual, onRemoveManual, onToggle, section, unitMode }) {
  const headers = Object.keys(section.items[0] || {}).filter((header) => !header.startsWith("_"));
  const visibleHeaders = ingredientMode === "simple" ? headers.filter(isEssentialGroceryHeader) : headers;

  return (
    <section className={section.isHaveIt ? "have-it-section" : ""}>
      <div className="section-title">
        <h3>{section.title}</h3>
        <span className="pill">{section.isHaveIt ? `${section.items.length} checked` : `${section.items.length} items`}</span>
      </div>
      <div className="table-wrap">
        <table className="grocery-table">
          <thead>
            <tr>
              <th className="check-column">Have</th>
              {visibleHeaders.map((header) => <th key={header}>{header}</th>)}
              <th className="check-column">Edit</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((item) => {
              const checked = checkedKeys.has(item._key);
              return (
                <tr className={checked ? "grocery-checked" : ""} key={item._key}>
                  <td className="check-column grocery-check-cell" data-label="Have">
                    <label className="grocery-check-control">
                      <input
                        checked={checked}
                        className="grocery-check"
                        onChange={(event) => onToggle(item, event.target.checked)}
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
                  <td className={`check-column grocery-edit-cell ${item._source === "manual" ? "" : "empty-edit"}`} data-label="Edit">
                    {item._source === "manual" ? (
                      <div className="grocery-row-actions">
                        <button className="mini-button neutral" onClick={() => onEditManual(item)} type="button">Edit</button>
                        <button className="mini-button" onClick={() => onRemoveManual(item)} type="button">Remove</button>
                      </div>
                    ) : null}
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

function PrepView({ search, week }) {
  const [prepState, setPrepState] = useState({ checkedKeys: [], sections: [] });

  useEffect(() => {
    if (!week) {
      return undefined;
    }
    return subscribePrepState(week.id, setPrepState);
  }, [week]);

  if (!week) {
    return <div className="empty">No prep guide found.</div>;
  }

  const sourcePrepSections = prepState.sections?.length ? prepState.sections : week.prepSections;
  const sections = sourcePrepSections.filter((section) => matchesSearch(`${section.title} ${section.markdown}`, search));
  const checkedKeys = new Set(prepState.checkedKeys || []);

  return (
    <div className="stack">
      <section className="card prep-toolbar">
        <div>
          <h3>Prep Checklist</h3>
          <p>Prep checks sync with Firebase when configured. Otherwise they stay saved on this device.</p>
        </div>
        <button className="quiet-button" onClick={() => clearPrepState(week.id)} type="button">Clear Checks</button>
      </section>

      {sections.length ? sections.map((section) => (
        <PrepSection
          checkedKeys={checkedKeys}
          key={section.title}
          onToggle={(task, checked) => togglePrepTask(week.id, prepTaskKey(week, section, task), checked)}
          section={section}
          week={week}
        />
      )) : <div className="empty">No prep items match the current search.</div>}
    </div>
  );
}

function PrepSection({ checkedKeys, onToggle, section, week }) {
  const tasks = parsePrepTasks(section.markdown);

  if (!tasks.length) {
    return <MarkdownDoc markdown={`# ${section.title}\n\n${section.markdown}`} />;
  }

  return (
    <section className="prep-section">
      <div className="section-title">
        <h3>{section.title}</h3>
        <span className="pill">{tasks.length} tasks</span>
      </div>
      <div className="prep-task-list">
        {tasks.map((task) => {
          const taskKey = prepTaskKey(week, section, task);
          const checked = checkedKeys.has(taskKey);
          return (
            <label className={`card prep-task ${checked ? "prep-checked" : ""}`} key={taskKey}>
              <input
                checked={checked}
                onChange={(event) => onToggle(task, event.target.checked)}
                type="checkbox"
              />
              <span className="prep-task-body">
                <span className="prep-task-title">{task.title}</span>
                {task.details ? (
                  <span
                    className="prep-task-detail"
                    dangerouslySetInnerHTML={{ __html: markdownToHtml(task.details) }}
                  />
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function ArchiveView({ activeDocId, docs, ingredientMode, setActiveDocId, setIngredientMode, setUnitMode, unitMode }) {
  const selected = docs.find((doc) => doc.id === activeDocId) || docs[0] || null;

  return (
    <div className="split-view">
      <div className="folder-tree">
        {docs.length ? (
          <FolderTree
            activeDocId={activeDocId}
            node={buildFolderTree(docs)}
            onSelect={setActiveDocId}
          />
        ) : (
          <div className="empty">No archived recipes yet. Approved recipes will appear here after they move out of weekly folders.</div>
        )}
      </div>
      <div className="recipe-reader">
        <div className="reader-toolbar">
          <IngredientDetailToggle mode={ingredientMode} setMode={setIngredientMode} />
          <QuantityUnitToggle mode={unitMode} setMode={setUnitMode} />
        </div>
        <MarkdownDoc ingredientMode={ingredientMode} unitMode={unitMode} markdown={selected ? selected.markdown : "# Recipe Archive\n\nPromoted and archived recipes will render here."} />
      </div>
    </div>
  );
}

function FolderTree({ activeDocId, depth = 0, node, onSelect }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
  const docs = node.docs.sort((a, b) => a.title.localeCompare(b.title));

  if (depth === 0) {
    return (
      <>
        {folders.map((folder) => <FolderTree activeDocId={activeDocId} depth={1} key={folder.name} node={folder} onSelect={onSelect} />)}
        {docs.map((doc) => <ArchiveRecipeButton activeDocId={activeDocId} doc={doc} key={doc.id} onSelect={onSelect} />)}
      </>
    );
  }

  return (
    <details className="folder-section" open>
      <summary>
        <span>{formatFolderName(node.name)}</span>
        <span className="folder-count">{countFolderDocs(node)}</span>
      </summary>
      <div className="folder-contents">
        {folders.map((folder) => <FolderTree activeDocId={activeDocId} depth={depth + 1} key={folder.name} node={folder} onSelect={onSelect} />)}
        {docs.map((doc) => <ArchiveRecipeButton activeDocId={activeDocId} doc={doc} key={doc.id} onSelect={onSelect} />)}
      </div>
    </details>
  );
}

function ArchiveRecipeButton({ activeDocId, doc, onSelect }) {
  return (
    <button
      className={`archive-recipe-button ${doc.id === activeDocId ? "active" : ""}`}
      onClick={() => onSelect(doc.id)}
      type="button"
    >
      <span>{doc.title}</span>
      <small>{doc.fileName || doc.path}</small>
    </button>
  );
}

function DocListView({ activeDocId, docs, emptyText, setActiveDocId }) {
  const selected = docs.find((doc) => doc.id === activeDocId) || docs[0] || null;

  return (
    <div className="split-view">
      <div className="stack">
        {docs.length ? docs.map((doc) => (
          <button
            className={`item-card ${doc.id === activeDocId ? "active" : ""}`}
            key={doc.id}
            onClick={() => setActiveDocId(doc.id)}
            type="button"
          >
            <h3>{doc.title}</h3>
            <p>{doc.summary || doc.path}</p>
            <div className="meta-row">
              <span className="pill">{doc.type.replace(/-/g, " ")}</span>
              <span>{doc.path}</span>
            </div>
          </button>
        )) : <div className="empty">{emptyText}</div>}
      </div>
      <MarkdownDoc markdown={selected ? selected.markdown : ""} />
    </div>
  );
}

function MarkdownDoc({ ingredientMode = "detailed", markdown, unitMode = "us" }) {
  return <article className={`doc ingredient-mode-${ingredientMode}`} dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown, { unitMode }) }} />;
}

function IngredientDetailToggle({ mode, setMode }) {
  return (
    <div className="segmented-control" aria-label="Ingredient detail level">
      {["simple", "detailed"].map((option) => (
        <button
          aria-pressed={mode === option}
          className={mode === option ? "active" : ""}
          key={option}
          onClick={() => setMode(option)}
          type="button"
        >
          {option === "simple" ? "Simple" : "Detailed"}
        </button>
      ))}
    </div>
  );
}

function QuantityUnitToggle({ mode, setMode }) {
  return (
    <div className="segmented-control unit-control" aria-label="Quantity units">
      {["us", "metric"].map((option) => (
        <button
          aria-pressed={mode === option}
          className={mode === option ? "active" : ""}
          key={option}
          onClick={() => setMode(option)}
          type="button"
        >
          {option === "us" ? "US" : "Metric"}
        </button>
      ))}
    </div>
  );
}

async function loadData() {
  const response = await fetch(`${baseUrl}data/cookbook.json`, { cache: "no-store" });
  return response.json();
}

function filterDocs(docs, search) {
  return docs.filter((doc) => matchesSearch(`${doc.title} ${doc.summary} ${doc.path}`, search));
}

function matchesSearch(text, search) {
  const needle = search.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
}

function hasMeal(row) {
  return Boolean([row.Meal, row["Recipe file"], row.Protein, row["Cuisine/flavor"]].join("").trim());
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

function groceryFieldClass(header) {
  return `grocery-field grocery-field-${header.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function isEssentialGroceryHeader(header) {
  const normalized = normalizeHeader(header);
  return normalized === "quantity" || normalized === "item";
}

function isQuantityHeader(header) {
  return normalizeHeader(header) === "quantity";
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function extractIngredientRows(markdown) {
  const lines = (markdown || "").replace(/\r\n/g, "\n").split("\n");
  const ingredientsHeading = lines.findIndex((line) => /^##\s+Ingredients\s*$/.test(line.trim()));
  if (ingredientsHeading === -1) {
    return [];
  }

  for (let index = ingredientsHeading + 1; index < lines.length - 1; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    if (lines[index].includes("|") && isMarkdownTableSeparator(lines[index + 1])) {
      const headers = splitMarkdownRow(lines[index]);
      const ingredientIndex = headers.findIndex((header) => normalizeHeader(header) === "ingredient");
      if (ingredientIndex === -1) {
        continue;
      }

      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const values = splitMarkdownRow(lines[index]);
        if (values[ingredientIndex]) {
          rows.push({ ingredient: values[ingredientIndex] });
        }
        index += 1;
      }
      return rows;
    }
  }

  return [];
}

function isMarkdownTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitMarkdownRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function getDefaultWeekId(weeks) {
  if (!weeks.length) {
    return "";
  }

  const today = startOfLocalDay(new Date());
  const datedWeeks = weeks
    .map((week) => ({
      ...week,
      end: parseLocalDate(week.endDate),
      start: parseLocalDate(week.startDate),
    }))
    .filter((week) => week.start && week.end);

  const currentWeek = datedWeeks.find((week) => week.start <= today && today <= week.end);
  if (currentWeek) {
    return currentWeek.id;
  }

  const nextWeek = datedWeeks
    .filter((week) => week.start > today)
    .sort((a, b) => a.start - b.start)[0];
  if (nextWeek) {
    return nextWeek.id;
  }

  const mostRecentPastWeek = datedWeeks
    .filter((week) => week.end < today)
    .sort((a, b) => b.end - a.end)[0];
  return mostRecentPastWeek?.id || weeks[0].id;
}

function getDefaultRecipeForWeek(week) {
  const today = startOfLocalDay(new Date());
  const datedRows = week.weeklyMenu
    .filter(hasMeal)
    .map((row, index) => ({
      row,
      date: parseMenuRowDate(row, week, index),
    }))
    .filter((entry) => entry.date);

  const nextRows = datedRows
    .filter((entry) => entry.date >= today)
    .sort((a, b) => a.date - b.date);
  const fallbackRows = datedRows.sort((a, b) => b.date - a.date);

  for (const entry of [...nextRows, ...fallbackRows]) {
    const recipeFile = entry.row["Recipe file"] || "";
    const doc = week.recipes.find((candidate) => recipeFile && candidate.path.endsWith(`/${recipeFile}`));
    if (doc) {
      return doc;
    }
  }

  return null;
}

function parseMenuRowDate(row, week, index) {
  const day = row.Day || "";
  if (day) {
    const dayWithYear = /\b\d{4}\b/.test(day) ? day : `${day}, ${week.year}`;
    const parsed = new Date(`${dayWithYear} 12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return startOfLocalDay(parsed);
    }
  }

  const startDate = parseLocalDate(week.startDate);
  if (!startDate) {
    return null;
  }
  return addDays(startDate, index);
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function parseLocalDate(value) {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function groceryCategoryOptions(grocerySections) {
  const options = grocerySections.map((section) => section.title).filter(Boolean);
  if (!options.some((option) => normalizeSectionName(option) === "other")) {
    options.push("Other");
  }
  return options;
}

function mergeManualItemsIntoSections(recipeSections, manualItems, categoryOptions) {
  const grouped = new Map();
  manualItems.forEach((item) => {
    const title = resolveGrocerySectionTitle(item.section, categoryOptions) || "Other";
    if (!grouped.has(title)) {
      grouped.set(title, { title, items: [] });
    }
    grouped.get(title).items.push({
      Quantity: item.quantity || "",
      Item: item.item || "",
      "Preferred version/type": item.preferred || "Manual add",
      "Acceptable alternatives": item.alternatives || "",
      Recipe: item.recipe || "Manual add",
      _key: `manual|${item.id}`,
      _manualId: item.id,
      _section: title,
      _source: "manual",
    });
  });

  const sections = recipeSections.map((section) => {
    const manualSection = grouped.get(section.title);
    grouped.delete(section.title);
    return manualSection ? { ...section, items: [...section.items, ...manualSection.items] } : section;
  });

  return [...sections, ...grouped.values()];
}

function moveCheckedItemsToHaveIt(sections, checkedKeys) {
  const checkedItems = [];
  const neededSections = sections
    .map((section) => {
      const neededItems = [];
      section.items.forEach((item) => {
        if (checkedKeys.has(item._key)) {
          checkedItems.push(item);
        } else {
          neededItems.push(item);
        }
      });
      return { ...section, items: neededItems };
    })
    .filter((section) => section.items.length);

  if (!checkedItems.length) {
    return neededSections;
  }

  return [
    ...neededSections,
    {
      isHaveIt: true,
      items: sortGroceryItems(checkedItems),
      title: "Have It",
    },
  ];
}

function sortGroceryItems(items) {
  return [...items].sort((first, second) => {
    const firstFamily = groceryItemFamilyKey(first);
    const secondFamily = groceryItemFamilyKey(second);
    if (firstFamily !== secondFamily) {
      return firstFamily.localeCompare(secondFamily);
    }

    const firstName = normalizeGroceryItemName(first.Item);
    const secondName = normalizeGroceryItemName(second.Item);
    if (firstName !== secondName) {
      return firstName.localeCompare(secondName);
    }

    return String(first.Recipe || "").localeCompare(String(second.Recipe || ""));
  });
}

function groceryItemFamilyKey(item) {
  const words = groceryItemWords(item.Item);
  const families = [
    "apple",
    "bean",
    "beef",
    "berry",
    "bread",
    "broccoli",
    "cabbage",
    "carrot",
    "cheese",
    "chicken",
    "cream",
    "cucumber",
    "egg",
    "garlic",
    "ginger",
    "ham",
    "lettuce",
    "lemon",
    "lime",
    "milk",
    "mushroom",
    "oil",
    "onion",
    "pepper",
    "pork",
    "potato",
    "rice",
    "salmon",
    "sauce",
    "steak",
    "tomato",
    "tortilla",
    "turkey",
    "yogurt",
    "zucchini",
  ];
  const family = families.find((candidate) => words.includes(candidate));
  if (family) {
    return family;
  }

  const descriptors = new Set([
    "baby",
    "bell",
    "canned",
    "cherry",
    "dried",
    "fresh",
    "gold",
    "green",
    "greek",
    "large",
    "mini",
    "plain",
    "red",
    "roma",
    "russet",
    "small",
    "sweet",
    "white",
    "yellow",
    "yukon",
  ]);
  const meaningfulWords = words.filter((word) => !descriptors.has(word));
  return meaningfulWords.at(-1) || words.at(-1) || "";
}

function groceryItemWords(value) {
  return normalizeGroceryItemName(value)
    .split(" ")
    .map(singularizeGroceryWord)
    .filter(Boolean);
}

function normalizeGroceryItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function singularizeGroceryWord(word) {
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

function resolveGrocerySectionTitle(value, options) {
  const normalized = normalizeSectionName(value || "Other");
  return options.find((option) => normalizeSectionName(option) === normalized) || "";
}

function normalizeSectionName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parsePrepTasks(markdown) {
  const tasks = [];
  let current = null;

  (markdown || "").replace(/\r\n/g, "\n").split("\n").forEach((line) => {
    const taskMatch = line.match(/^[-*+]\s+\[[ xX]\]\s+(.+)$/);
    if (taskMatch) {
      current = {
        details: [],
        index: tasks.length,
        title: taskMatch[1].trim(),
      };
      tasks.push(current);
      return;
    }

    if (current) {
      current.details.push(line.replace(/^ {2}/, ""));
    }
  });

  return tasks.map((task) => ({
    ...task,
    details: task.details.join("\n").trim(),
  }));
}

function prepTaskKey(week, section, task) {
  return [week.id, section.title, task.index, task.title].join("|");
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

function viewKicker(view) {
  if (view === "recipes") {
    return "Archive";
  }
  if (view === "week" || view === "grocery" || view === "prep") {
    return "Weekly plan";
  }
  return "Cookbook";
}

function viewTitle(view, week) {
  if (view === "week") {
    return week ? week.packet.title : "Week";
  }
  if (view === "recipes") {
    return "Recipe Archive";
  }
  if (view === "grocery") {
    return "Grocery";
  }
  if (view === "prep") {
    return "Meal Prep";
  }
  return "Cookbook";
}

function formatDateTime(value) {
  if (!value) {
    return "recently";
  }
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

createRoot(document.getElementById("root")).render(<App />);
