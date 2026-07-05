import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addManualGroceryItem,
  clearGroceryState,
  removeManualGroceryItem,
  saveGroceryState,
  subscribeGroceryState,
  toggleGroceryItem,
  updateManualGroceryItem,
} from "./services/groceryStore.js";
import { markdownToHtml } from "./services/markdown.js";
import { clearPrepState, savePrepState, subscribePrepState, togglePrepTask } from "./services/prepStore.js";
import { saveRecipeFeedback, subscribeRecipeFeedback } from "./services/recipeFeedbackStore.js";
import { saveRecipe, subscribeRecipes } from "./services/recipeStore.js";
import { formatQuantity } from "./services/units.js";
import { subscribeWeekPlanState } from "./services/weekPlanStore.js";
import { subscribeWorkingWeeks, upsertWeek, upsertWorkingWeek } from "./services/workingWeeksStore.js";
import "./styles.css";

const views = [
  ["week", "Week"],
  ["recipes", "Recipes"],
  ["grocery", "Grocery"],
  ["prep", "Prep"],
];
const baseUrl = import.meta.env.BASE_URL;
const appVersion = "0.1.32";

function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("week");
  const [weekId, setWeekId] = useState("");
  const [activeDocId, setActiveDocId] = useState("");
  const [ingredientMode, setIngredientMode] = useState("simple");
  const [unitMode, setUnitMode] = useState("us");
  const [search, setSearch] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const [workingWeeks, setWorkingWeeks] = useState([]);
  const [firebaseArchiveDocs, setFirebaseArchiveDocs] = useState([]);

  useEffect(() => {
    loadData().then((nextData) => {
      setData(nextData);
      setWeekId((current) => current || getDefaultWeekId(nextData.weeks));
    });
  }, []);

  useEffect(() => subscribeWorkingWeeks(setWorkingWeeks), []);

  useEffect(() => subscribeRecipes(setFirebaseArchiveDocs), []);

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

  const archiveDocs = useMemo(() => {
    if (!data) {
      return [];
    }
    return firebaseArchiveDocs.length ? firebaseArchiveDocs : data.archivedRecipes;
  }, [data, firebaseArchiveDocs]);

  const weeks = useMemo(() => {
    if (!data) {
      return [];
    }
    return mergeCookbookWeeks(data.weeks, workingWeeks, archiveDocs);
  }, [archiveDocs, data, workingWeeks]);
  const recipeSourceLabel = firebaseArchiveDocs.length
    ? `Recipes: Firebase (${firebaseArchiveDocs.length})`
    : `Recipes: Local fallback (${archiveDocs.length})`;

  const selectedWeek = useMemo(() => {
    if (!data) {
      return null;
    }
    return weeks.find((week) => week.id === weekId) || weeks[0] || null;
  }, [data, weekId, weeks]);

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
          {weeks.map((week) => (
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

        <div className="sync-note">Build {appVersion} | Data built {formatDateTime(data.generatedAt)} | {recipeSourceLabel}</div>
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
              archiveDocs={archiveDocs}
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
              archiveDocs={archiveDocs}
              activeDocId={activeDocId}
              docs={filterDocs(archiveDocs, search)}
              ingredientMode={ingredientMode}
              onSaveWorkingWeek={async (weekPlan) => {
                setWorkingWeeks((current) => upsertWeek(current, weekPlan));
                await upsertWorkingWeek(weekPlan);
                setWeekId(weekPlan.id);
                setView("week");
                setActiveDocId("");
              }}
              setActiveDocId={setActiveDocId}
              setIngredientMode={setIngredientMode}
              setUnitMode={setUnitMode}
              unitMode={unitMode}
              weeks={weeks}
              workingWeeks={workingWeeks}
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

function WeekView({ activeDocId, archiveDocs, ingredientMode, search, setActiveDocId, setIngredientMode, setUnitMode, unitMode, week }) {
  const [weekPlanState, setWeekPlanState] = useState({ menuRows: [] });

  useEffect(() => {
    if (!week) {
      return undefined;
    }
    return subscribeWeekPlanState(week.id, setWeekPlanState);
  }, [week]);

  if (!week) {
    return <div className="empty">No weekly plans found.</div>;
  }

  const sourceMenuRows = weekPlanState.menuRows?.length ? weekPlanState.menuRows : week.weeklyMenu;
  const plannedMenuRows = sourceMenuRows.filter(hasMeal);
  const menuRows = plannedMenuRows.filter((row) => matchesSearch(Object.values(row).join(" "), search));
  const allRecipeDocs = [...week.recipes, ...archiveDocs];
  const selectedDoc = allRecipeDocs.find((doc) => doc.id === activeDocId) || getDefaultRecipeForWeek(week, plannedMenuRows, allRecipeDocs) || allRecipeDocs[0] || null;

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
              docs={allRecipeDocs}
              key={`${row.Day}-${row["Recipe path"] || row["Recipe file"] || row.Meal}`}
              row={row}
              selectedDoc={selectedDoc}
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
            <span className="pill">{selectedDoc ? stageForDoc(selectedDoc) || "Recipe" : "No draft"}</span>
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
  const [feedback, setFeedback] = useState(emptyRecipeFeedback());
  const [ingredientDraft, setIngredientDraft] = useState(emptyIngredientDraft());
  const [status, setStatus] = useState("");
  const ingredientRows = useMemo(() => extractIngredientRows(recipe.markdown), [recipe.markdown]);
  const recipeRecord = recipe.recipe || {};
  const cookedCount = Number(recipeRecord.cookedCount || feedback.cookedCount || 0);
  const lastCookedAt = recipeRecord.lastCookedAt || feedback.cookedAt || "";
  const promotedAt = recipeRecord.promotedAt || feedback.promotedAt || "";
  const isCooked = Boolean(lastCookedAt || cookedCount > 0);
  const isPromoted = recipeRecord.status === "stage-2" || stageForDoc(recipe) === "Stage 2";

  useEffect(() => {
    setStatus("");
    setIngredientDraft(emptyIngredientDraft());
    return subscribeRecipeFeedback(recipe.id, setFeedback);
  }, [recipe.id]);

  const ingredientChanges = Array.isArray(feedback.ingredientChanges) ? feedback.ingredientChanges : [];
  const markCooked = async () => {
    const cookedAt = feedback.cookedAt || formatInputDate(new Date());
    const nextFeedback = {
      ...feedback,
      cookedAt,
      cookedCount: cookedCount + 1,
      recipePath: recipe.path,
    };
    const nextRecipe = recipeSavePayloadFromDoc(recipe, {
      cookedCount: cookedCount + 1,
      lastCookedAt: cookedAt,
    });
    setFeedback(nextFeedback);
    await Promise.all([
      saveRecipeFeedback(recipe.id, recipe.path, nextFeedback),
      saveRecipe(nextRecipe),
    ]);
    setStatus(`Marked cooked on ${cookedAt}`);
  };
  const promoteRecipe = async () => {
    const promotedDate = formatInputDate(new Date());
    const cookedAt = lastCookedAt || feedback.cookedAt || promotedDate;
    const nextFeedback = {
      ...feedback,
      cookedAt,
      cookedCount: Math.max(cookedCount, 1),
      promotedAt: promotedDate,
      promotionNotes: feedback.promotionNotes || feedback.notes || "",
      recipePath: recipe.path,
    };
    const nextRecipe = recipeSavePayloadFromDoc(recipe, {
      cookedCount: Math.max(cookedCount, 1),
      lastCookedAt: cookedAt,
      promotedAt: promotedDate,
      promotionNotes: nextFeedback.promotionNotes,
      status: "stage-2",
      statusLabel: "Stage 2 - Promoted family recipe",
      sourceMarkdown: updateRecipeMarkdownStatus(recipe.markdown, "stage-2"),
      versionHistory: [
        ...(recipeRecord.versionHistory || []),
        {
          date: promotedDate,
          version: recipeRecord.version || "1.0",
          change: "Promoted to Stage 2 from family feedback.",
          result: [feedback.rating, nextFeedback.promotionNotes].filter(Boolean).join(" - "),
        },
      ],
    });
    setFeedback(nextFeedback);
    await Promise.all([
      saveRecipeFeedback(recipe.id, recipe.path, nextFeedback),
      saveRecipe(nextRecipe),
    ]);
    setStatus(`Promoted to Stage 2 on ${promotedDate}`);
  };

  return (
    <form
      className="card recipe-feedback"
      onSubmit={async (event) => {
        event.preventDefault();
        await saveRecipeFeedback(recipe.id, recipe.path, feedback);
        if (feedback.cookedAt || feedback.promotedAt) {
          await saveRecipe(recipeSavePayloadFromDoc(recipe, {
            cookedCount,
            lastCookedAt: feedback.cookedAt || lastCookedAt,
            promotedAt: feedback.promotedAt || promotedAt,
            promotionNotes: feedback.promotionNotes || "",
          }));
        }
        setStatus("Saved");
      }}
    >
      <div>
        <h3>Family Feedback</h3>
        <p>Saved to Firebase for cooking history, repeat decisions, and recipe improvements.</p>
      </div>
      <div className="recipe-lifecycle">
        <div className="lifecycle-pills">
          <span className="pill">{isCooked ? `Cooked ${cookedCount} time${cookedCount === 1 ? "" : "s"}` : "Not cooked yet"}</span>
          {lastCookedAt ? <span className="pill">Last cooked {lastCookedAt}</span> : null}
          {isPromoted ? <span className="pill">Stage 2 keeper{promotedAt ? ` ${promotedAt}` : ""}</span> : null}
        </div>
        <label>
          Cooked on
          <input
            onChange={(event) => setFeedback({ ...feedback, cookedAt: event.target.value })}
            type="date"
            value={feedback.cookedAt || lastCookedAt || formatInputDate(new Date())}
          />
        </label>
        <label>
          Promotion notes
          <textarea
            onChange={(event) => setFeedback({ ...feedback, promotionNotes: event.target.value })}
            placeholder="Why this is a keeper, what version notes matter, or what still needs adjusting."
            rows="3"
            value={feedback.promotionNotes || ""}
          />
        </label>
        <div className="feedback-actions">
          <button className="quiet-button" onClick={markCooked} type="button">
            {isCooked ? "Record Cooked Again" : "Mark Cooked"}
          </button>
          <button className="primary-button" disabled={isPromoted} onClick={promoteRecipe} type="button">
            {isPromoted ? "Already Stage 2" : "Promote to Stage 2"}
          </button>
        </div>
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
function emptyRecipeFeedback() {
  return {
    cookedAt: "",
    cookedCount: 0,
    ingredientChanges: [],
    notes: "",
    promotedAt: "",
    promotionNotes: "",
    rating: "",
    updatedAt: "",
  };
}

function recipeSavePayloadFromDoc(doc, patch = {}) {
  const existingRecipe = doc.recipe || {};
  return {
    ...existingRecipe,
    archivedMarkdownPath: existingRecipe.archivedMarkdownPath || doc.path,
    id: existingRecipe.id || doc.id,
    sourceMarkdown: existingRecipe.sourceMarkdown || doc.markdown,
    title: existingRecipe.title || doc.title,
    ...patch,
  };
}

function updateRecipeMarkdownStatus(markdown, status) {
  const statusLabel = status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing";
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  if (/^Status:\s*.+$/im.test(text)) {
    return text.replace(/^Status:\s*.+$/im, `Status: ${statusLabel}`);
  }
  const lines = text.split("\n");
  const headingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const insertIndex = headingIndex === -1 ? 0 : headingIndex + 1;
  return [
    ...lines.slice(0, insertIndex),
    `Status: ${statusLabel}`,
    ...lines.slice(insertIndex),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
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

function DayCard({ docs, onSelect, row, selectedDoc }) {
  const doc = findRecipeDocForMenuRow(row, docs);
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
        {row["Plan source"] === "archive" ? <span>Archive</span> : null}
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
  const [expandedKeys, setExpandedKeys] = useState([]);
  const headers = Object.keys(section.items[0] || {}).filter((header) => !header.startsWith("_"));
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
              {visibleHeaders.map((header) => <th key={header}>{header}</th>)}
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
                  <td className={`check-column grocery-edit-cell ${item._source === "manual" ? "" : "empty-edit"}`} data-label="Edit">
                    {item._source === "manual" ? (
                      <div className="grocery-row-actions">
                        <button className="mini-button neutral" onClick={() => onEditManual(item)} onDoubleClick={(event) => event.stopPropagation()} type="button">Edit</button>
                        <button className="mini-button" onClick={() => onRemoveManual(item)} onDoubleClick={(event) => event.stopPropagation()} type="button">Remove</button>
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

function ArchiveView({
  activeDocId,
  archiveDocs,
  docs,
  ingredientMode,
  onSaveWorkingWeek,
  setActiveDocId,
  setIngredientMode,
  setUnitMode,
  unitMode,
  weeks,
  workingWeeks,
}) {
  const directories = useMemo(() => buildArchiveDirectories(docs), [docs]);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState("");
  const activeDirectoryId = directories.some((directory) => directory.id === selectedDirectoryId)
    ? selectedDirectoryId
    : directories[0]?.id || "";
  const directoryDocs = directories.find((directory) => directory.id === activeDirectoryId)?.docs || [];
  const selected = directoryDocs.find((doc) => doc.id === activeDocId) || directoryDocs[0] || null;

  useEffect(() => {
    if (!activeDocId) {
      return;
    }
    const activeDirectory = directories.find((directory) => directory.docs.some((doc) => doc.id === activeDocId));
    if (activeDirectory) {
      setSelectedDirectoryId(activeDirectory.id);
    }
  }, [activeDocId, directories]);

  useEffect(() => {
    if (activeDirectoryId && activeDirectoryId !== selectedDirectoryId) {
      setSelectedDirectoryId(activeDirectoryId);
    }
  }, [activeDirectoryId, selectedDirectoryId]);

  return (
    <div className="stack">
      <RecipeIntakePanel
        archiveDocs={archiveDocs}
        onSaved={(recipeDoc) => setActiveDocId(recipeDoc.id)}
      />
      <CreateWeeklyMenuPanel
        activeDocId={activeDocId}
        archiveDocs={archiveDocs}
        onSaveWorkingWeek={onSaveWorkingWeek}
        weeks={weeks}
        workingWeeks={workingWeeks}
      />
      <div className="split-view">
        <div className="archive-browser">
          {directories.length ? (
            <>
              <div className="archive-directory-list" aria-label="Recipe archive directories">
                {directories.map((directory) => (
                  <button
                    className={`archive-directory-button ${directory.id === activeDirectoryId ? "active" : ""}`}
                    key={directory.id}
                    onClick={() => {
                      setSelectedDirectoryId(directory.id);
                      setActiveDocId(directory.docs[0]?.id || "");
                    }}
                    type="button"
                  >
                    <span>{directory.label}</span>
                    <small>{directory.docs.length} recipe{directory.docs.length === 1 ? "" : "s"}</small>
                  </button>
                ))}
              </div>
              <div className="archive-recipe-list" aria-label="Recipes in selected directory">
                {directoryDocs.map((doc) => (
                  <ArchiveRecipeButton activeDocId={selected?.id || activeDocId} doc={doc} key={doc.id} onSelect={setActiveDocId} />
                ))}
              </div>
            </>
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
          {selected ? <RecipeFeedbackPanel recipe={selected} /> : null}
        </div>
      </div>
    </div>
  );
}

function RecipeIntakePanel({ archiveDocs, onSaved }) {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("chicken");
  const [status, setStatus] = useState("stage-1");
  const [markdown, setMarkdown] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const categoryOptions = useMemo(() => recipeCategoryOptions(archiveDocs), [archiveDocs]);

  const updateMarkdown = (value) => {
    setMarkdown(value);
    if (!title.trim()) {
      const inferredTitle = titleFromMarkdown(value);
      if (inferredTitle) {
        setTitle(inferredTitle);
      }
    }
  };

  const savePastedRecipe = async (event) => {
    event.preventDefault();
    const finalTitle = title.trim() || titleFromMarkdown(markdown);
    if (!finalTitle || !markdown.trim()) {
      setSaveStatus("Add a title and pasted recipe before saving.");
      return;
    }

    setSaveStatus("Saving recipe...");
    try {
      const recipe = recipeFromMarkdownForSave({
        archiveDocs,
        category,
        markdown,
        status,
        title: finalTitle,
      });
      const savedRecipe = await saveRecipe(recipe);
      setSaveStatus(`Saved ${savedRecipe.title} to Firebase.`);
      setTitle("");
      setMarkdown("");
      setStatus("stage-1");
      setCategory(categoryOptions[0] || "chicken");
      setExpanded(false);
      onSaved?.({ id: savedRecipe.id });
    } catch (error) {
      setSaveStatus(`Recipe save failed: ${error.message}`);
    }
  };

  return (
    <section className="card recipe-intake">
      <div className="recipe-intake-header">
        <div>
          <h3>Add Recipe</h3>
          <p>Paste a generated recipe and save it directly as a Firebase-backed Stage 1 recipe.</p>
        </div>
        <button className="quiet-button" onClick={() => setExpanded((current) => !current)} type="button">
          {expanded ? "Close" : "Paste Recipe"}
        </button>
      </div>
      {expanded ? (
        <form className="recipe-intake-form" onSubmit={savePastedRecipe}>
          <div className="manual-grocery-grid recipe-intake-grid">
            <label>
              Title
              <input
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Jamaican Jerk Chicken"
                value={title}
              />
            </label>
            <label>
              Category
              <input
                list="recipe-category-options"
                onChange={(event) => setCategory(event.target.value)}
                placeholder="chicken"
                value={category}
              />
              <datalist id="recipe-category-options">
                {categoryOptions.map((option) => <option key={option} value={option} />)}
              </datalist>
            </label>
          </div>
          <label>
            Status
            <select onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="stage-1">Stage 1 - Draft / testing</option>
              <option value="stage-2">Stage 2 - Promoted family recipe</option>
            </select>
          </label>
          <label>
            Recipe Markdown
            <textarea
              onChange={(event) => updateMarkdown(event.target.value)}
              placeholder="# Jamaican Jerk Chicken..."
              rows="12"
              value={markdown}
            />
          </label>
          <div className="dialog-actions recipe-intake-actions">
            {saveStatus ? <span className="pill">{saveStatus}</span> : null}
            <button className="primary-button" type="submit">Save Recipe</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function CreateWeeklyMenuPanel({ activeDocId, archiveDocs, onSaveWorkingWeek, weeks, workingWeeks }) {
  const defaultWeek = useMemo(() => getNextPlanningWeekDefaults(weeks), [weeks]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetMode, setTargetMode] = useState("new");
  const [targetWeekId, setTargetWeekId] = useState("");
  const [selectedArchiveId, setSelectedArchiveId] = useState("");
  const [year, setYear] = useState(String(defaultWeek.year));
  const [weekNumber, setWeekNumber] = useState(String(defaultWeek.weekNumber));
  const [startDate, setStartDate] = useState(defaultWeek.startDate);
  const [selectedDay, setSelectedDay] = useState("");
  const [draftRows, setDraftRows] = useState([]);
  const [status, setStatus] = useState("");

  const selectedRecipe = archiveDocs.find((doc) => doc.id === selectedArchiveId)
    || archiveDocs.find((doc) => doc.id === activeDocId)
    || archiveDocs[0]
    || null;
  const targetWeek = workingWeeks.find((week) => week.id === targetWeekId) || null;
  const dayOptions = targetMode === "existing" && targetWeek
    ? workingWeekDayOptions(targetWeek)
    : buildWeekDayOptions(startDate);
  const targetDay = selectedDay || dayOptions[0] || "";
  const previewRows = draftRows.length ? draftRows : createBlankMenuRows(dayOptions);

  const openDialog = () => {
    const nextDefaults = getNextPlanningWeekDefaults(weeks);
    setYear(String(nextDefaults.year));
    setWeekNumber(String(nextDefaults.weekNumber));
    setStartDate(nextDefaults.startDate);
    setSelectedDay("");
    setDialogOpen(true);
  };

  useEffect(() => {
    if (archiveDocs.some((doc) => doc.id === activeDocId)) {
      setSelectedArchiveId(activeDocId);
    } else {
      setSelectedArchiveId((current) => current || archiveDocs[0]?.id || "");
    }
  }, [activeDocId, archiveDocs]);

  useEffect(() => {
    if (targetMode === "existing") {
      setTargetWeekId((current) => current || workingWeeks[0]?.id || "");
    }
  }, [targetMode, workingWeeks]);

  useEffect(() => {
    setSelectedDay("");
  }, [startDate, targetMode, targetWeekId]);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    const nextRows = targetMode === "existing" && targetWeek?.menuRows?.length
      ? targetWeek.menuRows
      : createBlankMenuRows(dayOptions);
    setDraftRows(nextRows);
  }, [dialogOpen, targetMode, targetWeekId, startDate]);

  useEffect(() => {
    if (!dialogOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setDialogOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dialogOpen]);

  const setRecipeForDay = () => {
    if (!selectedRecipe || !targetDay) {
      return;
    }
    const nextRow = archiveRecipeToMenuRow(selectedRecipe, targetDay);
    setDraftRows((current) => replaceMenuRowForDay(current.length ? current : createBlankMenuRows(dayOptions), nextRow));
  };

  const clearRecipeForDay = () => {
    if (!targetDay) {
      return;
    }
    setDraftRows((current) => clearMenuRowForDay(current.length ? current : createBlankMenuRows(dayOptions), targetDay));
  };

  const saveRecipeToWeek = async (event) => {
    event.preventDefault();

    const baseWeek = targetMode === "existing" && targetWeek
      ? targetWeek
      : createWorkingWeekShell({ startDate, weekNumber, year });
    const menuRows = draftRows.length ? draftRows : createBlankMenuRows(dayOptions);
    const grocerySections = buildGrocerySectionsFromMenuRows(menuRows, archiveDocs);
    const prepSections = buildPrepSectionsFromMenuRows(menuRows, archiveDocs);
    const nextWeek = {
      ...baseWeek,
      endDate: weekEndDate(baseWeek.startDate),
      groceryItems: flattenGrocerySections(grocerySections),
      grocerySections,
      meals: menuRows,
      menuRows,
      prepSections,
      prepTasks: flattenPrepSections(prepSections),
      recipePaths: uniqueValues(menuRows.map((row) => row["Recipe path"]).filter(Boolean)),
      title: baseWeek.title || baseWeek.label,
    };

    const generatedAt = new Date().toISOString();
    await Promise.all([
      onSaveWorkingWeek(nextWeek),
      saveGroceryState(nextWeek.id, {
        checkedKeys: [],
        generatedAt,
        generationSource: "firebase-recipes",
        generationVersion: "app-week-assets-v1",
        manualItems: [],
        sections: grocerySections,
      }),
      savePrepState(nextWeek.id, {
        checkedKeys: [],
        generatedAt,
        generationSource: "firebase-recipes",
        generationVersion: "app-week-assets-v1",
        sections: prepSections,
      }),
    ]);
    setStatus(`Saved ${menuRows.filter(hasMeal).length} meal${menuRows.filter(hasMeal).length === 1 ? "" : "s"} to ${nextWeek.label}`);
    setDialogOpen(false);
  };

  return (
    <>
      {status ? <span className="pill week-planner-status">{status}</span> : null}
      <button
        aria-label="Create or edit weekly menu"
        className="week-fab"
        onClick={openDialog}
        type="button"
      >
        <span aria-hidden="true">+</span>
      </button>
      {dialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}>
          <form
            aria-label="Create or edit weekly menu"
            className="card grocery-dialog week-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={saveRecipeToWeek}
          >
            <div className="dialog-header">
              <h3>Create Weekly Menu</h3>
              <button
                aria-label="Close dialog"
                className="icon-button"
                onClick={() => setDialogOpen(false)}
                type="button"
              >
                x
              </button>
            </div>
            {archiveDocs.length ? (
              <>
                <p className="dialog-help">Add an archived recipe to a new or existing planning week.</p>
                <label>
                  Recipe
                  <select
                    onChange={(event) => setSelectedArchiveId(event.target.value)}
                    value={selectedRecipe?.id || ""}
                  >
                    {archiveDocs.map((doc) => (
                      <option key={doc.id} value={doc.id}>{doc.title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Target
                  <select onChange={(event) => setTargetMode(event.target.value)} value={targetMode}>
                    <option value="new">Create new week</option>
                    <option value="existing" disabled={!workingWeeks.length}>Edit existing planning week</option>
                  </select>
                </label>
                {targetMode === "existing" ? (
                  <label>
                    Week
                    <select onChange={(event) => setTargetWeekId(event.target.value)} value={targetWeek?.id || ""}>
                      {workingWeeks.map((week) => (
                        <option key={week.id} value={week.id}>{week.label}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="manual-grocery-grid week-dialog-grid">
                    <label>
                      Year
                      <input
                        onChange={(event) => setYear(event.target.value)}
                        value={year}
                      />
                    </label>
                    <label>
                      Week
                      <input
                        min="1"
                        max="53"
                        onChange={(event) => setWeekNumber(event.target.value)}
                        type="number"
                        value={weekNumber}
                      />
                    </label>
                    <label>
                      Starts
                      <input
                        onChange={(event) => setStartDate(event.target.value)}
                        type="date"
                        value={startDate}
                      />
                    </label>
                  </div>
                )}
                <label>
                  Day
                  <select onChange={(event) => setSelectedDay(event.target.value)} value={targetDay}>
                    {dayOptions.map((day) => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </label>
                <div className="week-day-actions">
                  <button className="primary-button" onClick={setRecipeForDay} type="button">Set Day</button>
                  <button className="quiet-button" onClick={clearRecipeForDay} type="button">Clear Day</button>
                </div>
                <WeekMenuPreview rows={previewRows} targetDay={targetDay} onSelectDay={setSelectedDay} />
                <div className="dialog-actions">
                  <button className="quiet-button" onClick={() => setDialogOpen(false)} type="button">Cancel</button>
                  <button className="primary-button" type="submit">{targetMode === "existing" ? "Save Week" : "Create Week"}</button>
                </div>
              </>
            ) : (
              <p className="week-planner-empty">No archived recipes yet. Approved recipes will appear here after they move out of weekly folders.</p>
            )}
          </form>
        </div>
      ) : null}
    </>
  );
}

function WeekMenuPreview({ onSelectDay, rows, targetDay }) {
  return (
    <div className="week-menu-preview" aria-label="Weekly menu preview">
      <div className="week-menu-preview-header">
        <h4>Week Preview</h4>
        <span className="pill">{rows.filter(hasMeal).length} planned</span>
      </div>
      <div className="week-menu-preview-list">
        {rows.map((row) => {
          const isTarget = row.Day === targetDay;
          const meal = row.Meal || "Open";
          return (
            <button
              className={`week-menu-preview-item ${isTarget ? "pending" : ""} ${row.Meal ? "filled" : ""}`}
              key={row.Day || meal}
              onClick={() => onSelectDay(row.Day)}
              type="button"
            >
              <span className="week-menu-preview-day">{row.Day || "Day"}</span>
              <span className="week-menu-preview-meal">{meal}</span>
              {row.Protein ? <span className="week-menu-preview-meta">{row.Protein}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
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

function mergeCookbookWeeks(markdownWeeks, workingWeeks, archiveDocs) {
  const markdownIds = new Set(markdownWeeks.map((week) => week.id));
  const appWeeks = workingWeeks
    .filter((week) => !markdownIds.has(week.id))
    .map((week) => workingWeekToAppWeek(week, archiveDocs));

  return [...markdownWeeks, ...appWeeks].sort(compareWeeks);
}

function workingWeekToAppWeek(week, archiveDocs) {
  const menuRows = week.menuRows || [];
  const recipes = uniqueValues(menuRows.map((row) => row["Recipe path"]).filter(Boolean))
    .map((path) => archiveDocs.find((doc) => doc.path === path))
    .filter(Boolean);

  return {
    id: week.id,
    isWorkingWeek: true,
    label: week.label,
    year: week.year,
    startDate: week.startDate,
    endDate: week.endDate,
    folder: `working-weeks/${week.id}`,
    packet: {
      markdown: workingWeekMarkdown(week),
      path: `working-weeks/${week.id}`,
      title: week.label,
      type: "working-week",
    },
    recipes,
    weeklyMenu: menuRows,
    grocerySections: week.grocerySections || buildGrocerySectionsFromMenuRows(menuRows, archiveDocs),
    prepSections: week.prepSections || buildPrepSectionsFromMenuRows(menuRows, archiveDocs),
  };
}

function compareWeeks(first, second) {
  const firstDate = parseLocalDate(first.startDate);
  const secondDate = parseLocalDate(second.startDate);
  if (firstDate && secondDate && firstDate.getTime() !== secondDate.getTime()) {
    return secondDate - firstDate;
  }
  return String(second.id).localeCompare(String(first.id));
}

function workingWeekMarkdown(week) {
  const rows = week.menuRows?.filter(hasMeal) || [];
  const menuTable = rows.map((row) => (
    `| ${row.Day || ""} | ${row.Meal || ""} | ${row["Recipe file"] || ""} | ${row.Stage || ""} | ${row.Protein || ""} | ${row["Cuisine/flavor"] || ""} |`
  )).join("\n");
  return [
    `# ${week.label}`,
    "",
    `Week of: ${week.startDate || "Unscheduled"} through ${week.endDate || "Unscheduled"}`,
    "Planning status: Working app plan",
    "",
    "## Weekly Menu",
    "",
    "| Day | Meal | Recipe file | Stage | Protein | Cuisine/flavor |",
    "|---|---|---|---|---|---|",
    menuTable || "|  |  |  |  |  |  |",
  ].join("\n");
}

function buildGrocerySectionsFromMenuRows(menuRows, archiveDocs) {
  const grouped = new Map();
  menuRows.forEach((row) => {
    const doc = findRecipeDocForMenuRow(row, archiveDocs);
    if (!doc) {
      return;
    }
    ingredientRowsForDoc(doc).forEach((ingredientRow) => {
      const item = ingredientRow.Ingredient || ingredientRow.Item || "";
      if (!item) {
        return;
      }
      const sectionTitle = grocerySectionForItem(item);
      if (!grouped.has(sectionTitle)) {
        grouped.set(sectionTitle, { title: sectionTitle, items: [] });
      }
      grouped.get(sectionTitle).items.push({
        Quantity: ingredientRow.Quantity || "",
        Item: item,
        "Preferred version/type": ingredientRow["Preferred version/type"] || ingredientRow.Preferred || "",
        "Acceptable alternatives": ingredientRow["Acceptable alternatives"] || ingredientRow.Alternatives || "",
        Recipe: doc.title,
        _recipeRefs: [doc.path],
      });
    });
  });

  const sectionOrder = [
    "Produce",
    "Meat and Seafood",
    "Dairy and Eggs",
    "Bakery",
    "Pantry and Dry Goods",
    "Sauces, Condiments, and Spices",
    "Other",
  ];

  return [...grouped.values()]
    .map((section) => ({ ...section, items: sortGroceryItems(mergeGroceryItems(section.items)) }))
    .sort((first, second) => sectionOrder.indexOf(first.title) - sectionOrder.indexOf(second.title));
}

function mergeGroceryItems(items) {
  const merged = new Map();
  items.forEach((item) => {
    const key = [
      normalizeGroceryItemName(item.Item),
      normalizeGroceryItemName(item["Preferred version/type"]),
      normalizeGroceryItemName(item["Acceptable alternatives"]),
    ].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...item, _recipeRefs: item._recipeRefs || [] });
      return;
    }

    existing.Quantity = mergeQuantities(existing.Quantity, item.Quantity);
    existing.Recipe = uniqueValues([...(existing.Recipe || "").split(/,\s*/), item.Recipe].filter(Boolean)).join(", ");
    existing._recipeRefs = uniqueValues([...(existing._recipeRefs || []), ...(item._recipeRefs || [])]);
  });
  return [...merged.values()];
}

function mergeQuantities(first, second) {
  if (!first) {
    return second || "";
  }
  if (!second || first === second) {
    return first;
  }

  const firstNumber = Number(first);
  const secondNumber = Number(second);
  if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
    return String(firstNumber + secondNumber);
  }

  return uniqueValues([first, second]).join(" + ");
}

function flattenGrocerySections(sections) {
  return sections.flatMap((section) => section.items.map((item, index) => {
    const parsedQuantity = parseQuantityParts(item.Quantity);
    return {
      alternatives: item["Acceptable alternatives"] || "",
      category: section.title,
      checked: false,
      id: `${normalizeSectionName(section.title)}-${normalizeGroceryItemName(item.Item).replace(/\s+/g, "-")}-${index}`,
      name: item.Item || "",
      preferredType: item["Preferred version/type"] || "",
      quantity: parsedQuantity.quantity,
      quantityText: item.Quantity || "",
      recipeRefs: item._recipeRefs || [],
      unit: parsedQuantity.unit,
    };
  }));
}

function flattenPrepSections(sections) {
  return sections.flatMap((section) => parsePrepTasks(section.markdown).map((task) => ({
    checked: false,
    ingredients: prepDetailValue(task.details, "Ingredients"),
    instructions: prepDetailValue(task.details, "Instructions"),
    mealRefs: [prepDetailValue(task.details, "Meal ownership")].filter(Boolean),
    section: section.title,
    storageMethod: prepDetailValue(task.details, "Storage method"),
    title: task.title,
    useByDate: prepDetailValue(task.details, "Use-by date"),
  })));
}

function prepDetailValue(details, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(details || "").match(new RegExp(`^-\\s+${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

function parseQuantityParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)(?:\s+(.+))?$/);
  if (!match) {
    return { quantity: text, unit: "" };
  }
  return { quantity: match[1], unit: match[2] || "" };
}

function buildPrepSectionsFromMenuRows(menuRows, archiveDocs = []) {
  const rows = menuRows.filter(hasMeal);
  if (!rows.length) {
    return [];
  }

  const tasks = rows.flatMap((row) => prepTasksForMenuRow(row, archiveDocs));
  const sections = [
    "Start-of-Week Prep",
    "Midweek Refresh",
    "Cook-Day Reminders",
    "Do Not Prep Ahead",
  ].map((title) => ({
    title,
    tasks: tasks.filter((task) => task.section === title),
  })).filter((section) => section.tasks.length);

  return sections.map((section) => ({
    title: section.title,
    markdown: section.tasks.map(renderPrepTaskMarkdown).join("\n"),
  }));
}

function prepTasksForMenuRow(row, archiveDocs) {
  const doc = findRecipeDocForMenuRow(row, archiveDocs);
  const recipe = doc?.recipe || null;
  const meal = row.Meal || doc?.title || "Planned meal";
  const useByDate = row.Day || recipe?.bestDayToCook || "Planned cook day";
  const dayIndex = weekdayIndex(useByDate);
  const tasks = [];

  if (!recipe) {
    return [prepTask({
      ingredients: "Recipe ingredients",
      instructions: "Review the recipe and prep only items that hold safely before cooking.",
      meal,
      section: "Cook-Day Reminders",
      storageMethod: "Keep refrigerated items cold and shelf-stable items grouped together.",
      title: `Review prep needs for ${meal}`,
      useByDate,
    })];
  }

  const proteinIngredients = ingredientsByKind(recipe, "protein");
  const sturdyProduce = ingredientsByKind(recipe, "sturdy-produce");
  const delicateItems = ingredientsByKind(recipe, "delicate");
  const prepAheadIdeas = recipe.prepGuidance?.prepAheadIdeas?.length
    ? recipe.prepGuidance.prepAheadIdeas
    : [recipe.notes?.prepAhead].filter(Boolean);
  const earlySection = dayIndex <= 2 ? "Start-of-Week Prep" : "Midweek Refresh";
  const prepSection = dayIndex <= 3 ? "Start-of-Week Prep" : "Midweek Refresh";

  if (proteinIngredients.length) {
    tasks.push(prepTask({
      ingredients: ingredientNames(proteinIngredients),
      instructions: dayIndex <= 2
        ? "Confirm protein is purchased, portioned, and ready for the planned cook day. If frozen, thaw in the refrigerator."
        : "Move frozen protein to the refrigerator early enough to thaw safely before cooking.",
      meal,
      section: earlySection,
      storageMethod: "Covered container or original sealed package in refrigerator below ready-to-eat foods.",
      title: `Confirm protein for ${meal}`,
      useByDate,
    }));
  }

  prepAheadIdeas.forEach((idea) => {
    tasks.push(prepTask({
      ingredients: relevantIngredientList(recipe, idea),
      instructions: idea,
      meal,
      section: prepSection,
      storageMethod: "Covered container in refrigerator unless the recipe says otherwise.",
      title: `Prep ahead for ${meal}`,
      useByDate,
    }));
  });

  if (sturdyProduce.length) {
    tasks.push(prepTask({
      ingredients: ingredientNames(sturdyProduce),
      instructions: "Wash, trim, chop, or portion sturdy vegetables that hold well after cutting.",
      meal,
      section: prepSection,
      storageMethod: "Covered container with a dry paper towel if moisture could soften vegetables.",
      title: `Prep sturdy produce for ${meal}`,
      useByDate,
    }));
  }

  tasks.push(prepTask({
    ingredients: ingredientNames((recipe.ingredients || []).slice(0, 10)) || "Recipe ingredients",
    instructions: "Read the recipe, confirm ingredients are purchased, and group shelf-stable components together for faster cooking.",
    meal,
    section: "Cook-Day Reminders",
    storageMethod: "Shelf-stable items grouped together; refrigerated items kept cold until cooking.",
    title: `Stage ingredients for ${meal}`,
    useByDate,
  }));

  if (delicateItems.length || recipe.perishabilityNotes) {
    tasks.push(prepTask({
      ingredients: ingredientNames(delicateItems) || "Delicate or texture-sensitive ingredients",
      instructions: recipe.perishabilityNotes || "Do not cut, salt, or mix delicate fresh components too early; prep close to serving for best texture.",
      meal,
      section: "Do Not Prep Ahead",
      storageMethod: "Keep whole and refrigerated until cook day.",
      title: `Hold delicate prep for ${meal}`,
      useByDate,
    }));
  }

  return tasks;
}

function prepTask({ ingredients, instructions, meal, section, storageMethod, title, useByDate }) {
  return { ingredients, instructions, meal, section, storageMethod, title, useByDate };
}

function renderPrepTaskMarkdown(task) {
  return [
    `- [ ] ${task.title}.`,
    `  - Ingredients: ${task.ingredients || "Recipe ingredients"}.`,
    `  - Instructions: ${task.instructions || "Read the recipe and prep only what holds well."}.`,
    `  - Storage method: ${task.storageMethod || "Covered container in refrigerator unless the recipe says otherwise."}.`,
    `  - Use-by date: ${task.useByDate || "Planned cook day"}.`,
    `  - Meal ownership: ${task.meal || "Planned meal"}.`,
  ].join("\n");
}

function ingredientsByKind(recipe, kind) {
  return (recipe.ingredients || []).filter((ingredient) => {
    const item = ingredient.item || "";
    const words = new Set(groceryItemWords(item));
    if (kind === "protein") {
      return ["chicken", "beef", "steak", "pork", "salmon", "turkey", "ham", "shrimp", "fish", "sausage"].some((word) => words.has(word));
    }
    if (kind === "delicate") {
      return ["avocado", "basil", "cilantro", "cucumber", "lettuce", "lime", "mango", "parsley", "pineapple", "romaine", "tomato", "yogurt"].some((word) => words.has(word));
    }
    if (kind === "sturdy-produce") {
      return (ingredient.groceryCategory === "Produce" || grocerySectionForItem(item) === "Produce")
        && !ingredientsByKind({ ingredients: [ingredient] }, "delicate").length;
    }
    return false;
  });
}

function relevantIngredientList(recipe, text) {
  const words = new Set(groceryItemWords(text));
  const matches = (recipe.ingredients || [])
    .filter((ingredient) => groceryItemWords(ingredient.item).some((word) => words.has(word)))
    .map((ingredient) => ingredient.item)
    .filter(Boolean);
  return matches.length ? matches.join(", ") : ingredientNames((recipe.ingredients || []).slice(0, 8));
}

function ingredientNames(ingredients) {
  return ingredients.map((ingredient) => ingredient.item || ingredient.Ingredient || ingredient.Item || "").filter(Boolean).join(", ");
}

function weekdayIndex(value) {
  const text = String(value || "").toLowerCase();
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const index = days.findIndex((day) => text.includes(day));
  return index === -1 ? 3 : index;
}
function grocerySectionForItem(item) {
  const words = new Set(groceryItemWords(item));
  const hasAny = (values) => values.some((value) => words.has(value));

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

function recipeFromMarkdownForSave({ archiveDocs, category, markdown, status, title }) {
  const now = new Date().toISOString();
  const normalizedCategory = normalizeRecipeCategory(category || "uncategorized");
  const recipeId = uniqueRecipeId(slugFromTitle(title), archiveDocs);
  const planningSummary = labeledBulletValues(markdown, "Planning Summary");
  const notes = labeledBulletValues(markdown, "Notes");
  return {
    id: recipeId,
    title,
    status,
    statusLabel: status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing",
    category: normalizedCategory,
    source: topMetadataValue(markdown, "Source or inspiration"),
    dateAdded: topMetadataValue(markdown, "Date added") || now.slice(0, 10),
    lastUpdated: now.slice(0, 10),
    version: "1.0",
    servings: numericValue(planningSummary.Servings),
    estimatedPrepMinutes: minutesValue(planningSummary["Estimated prep time"]),
    estimatedCookMinutes: minutesValue(planningSummary["Estimated cook time"]),
    protein: planningSummary.Protein || "",
    cuisine: planningSummary["Cuisine or flavor direction"] || "",
    bestDayToCook: planningSummary["Best day to cook"] || "",
    perishabilityNotes: planningSummary["Perishability notes"] || "",
    difficulty: planningSummary.Difficulty || "",
    equipment: bulletItems(markdown, "Equipment"),
    ingredients: structuredIngredientsFromMarkdown(markdown),
    instructionSections: instructionSectionsFromMarkdown(markdown),
    notes: {
      testing: notes["What might need testing"] || "",
      substitutions: notes["Possible substitutions"] || "",
      prepAhead: notes["Prep-ahead ideas"] || "",
      familyPreferenceConcerns: notes["Family preference concerns"] || "",
      raw: notes,
    },
    prepGuidance: {
      prepAheadIdeas: notes["Prep-ahead ideas"] ? [notes["Prep-ahead ideas"]] : [],
      doNotPrepAhead: [],
      perishabilityNotes: planningSummary["Perishability notes"] || "",
      bestDayToCook: planningSummary["Best day to cook"] || "",
    },
    archivedMarkdownPath: `firebase/recipes/${recipeId}.md`,
    sourceMarkdown: normalizeMarkdownForRecipe(markdown, title, status, normalizedCategory),
    createdAt: now,
    updatedAt: now,
  };
}

function recipeCategoryOptions(archiveDocs) {
  const categories = archiveDocs
    .map((doc) => doc.recipe?.category || pathCategory(doc.path))
    .map(normalizeRecipeCategory)
    .filter(Boolean);
  return uniqueValues([...categories, "chicken", "beef", "pork", "seafood", "turkey", "sides", "desserts", "lunches"])
    .sort((first, second) => first.localeCompare(second));
}

function uniqueRecipeId(baseId, archiveDocs) {
  const usedIds = new Set(archiveDocs.map((doc) => doc.id));
  const usedPaths = new Set(archiveDocs.map((doc) => doc.path));
  if (!usedIds.has(baseId) && !usedPaths.has(`firebase/recipes/${baseId}.md`)) {
    return baseId;
  }
  let index = 2;
  while (usedIds.has(`${baseId}-${index}`) || usedPaths.has(`firebase/recipes/${baseId}-${index}.md`)) {
    index += 1;
  }
  return `${baseId}-${index}`;
}

function normalizeMarkdownForRecipe(markdown, title, status, category) {
  const text = String(markdown || "").replace(/\r\n/g, "\n").trim();
  const withTitle = /^#\s+.+$/m.test(text) ? text : `# ${title}\n\n${text}`;
  const lines = withTitle.split("\n");
  const firstHeadingIndex = lines.findIndex((line) => /^#\s+/.test(line));
  const insertIndex = firstHeadingIndex === -1 ? 0 : firstHeadingIndex + 1;
  const hasStatus = /^Status:\s*/im.test(withTitle);
  const hasCategory = /^Category:\s*/im.test(withTitle);
  const inserts = [
    hasStatus ? "" : `Status: ${status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing"}`,
    hasCategory ? "" : `Category: ${category}`,
  ].filter(Boolean);
  if (!inserts.length) {
    return withTitle;
  }
  return [
    ...lines.slice(0, insertIndex),
    ...inserts,
    ...lines.slice(insertIndex),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function structuredIngredientsFromMarkdown(markdown) {
  return extractIngredientTableRows(markdown).map((row, index) => {
    const quantityText = row.Quantity || "";
    const parsedQuantity = parseQuantityParts(quantityText);
    const item = row.Ingredient || row.Item || "";
    return {
      id: `ingredient-${index + 1}`,
      quantityText,
      quantityValue: numericValue(parsedQuantity.quantity),
      unit: parsedQuantity.unit,
      item,
      preferredType: row["Preferred version/type"] || row.Preferred || "",
      acceptableAlternatives: row["Acceptable alternatives"] || row.Alternatives || "",
      notes: row.Notes || row["Used in"] || "",
      groceryCategory: grocerySectionForItem(item),
      usedIn: row["Used in"] || row.Notes || "",
      optional: Object.values(row).some((value) => /\boptional\b/i.test(String(value || ""))),
      perishable: isLikelyPerishableItem(item),
      sourceRow: row,
    };
  });
}

function instructionSectionsFromMarkdown(markdown) {
  return ["Basic Instructions", "Detailed Instructions"].flatMap((heading) => {
    const steps = numberedItems(markdown, heading);
    return steps.length ? [{ title: heading, steps }] : [];
  });
}

function titleFromMarkdown(markdown) {
  return String(markdown || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
}

function topMetadataValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(markdown || "").match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
}

function labeledBulletValues(markdown, heading) {
  const values = {};
  bulletItems(markdown, heading).forEach((item) => {
    const separatorIndex = item.indexOf(":");
    if (separatorIndex === -1) {
      return;
    }
    values[item.slice(0, separatorIndex).trim()] = item.slice(separatorIndex + 1).trim();
  });
  return values;
}

function bulletItems(markdown, heading) {
  return sectionMarkdown(markdown, heading)
    .split("\n")
    .map((line) => line.match(/^\s*[-*+]\s+(.+)$/))
    .filter(Boolean)
    .map((match) => stripInlineMarkdown(match[1].trim()))
    .filter(Boolean);
}

function numberedItems(markdown, heading) {
  return sectionMarkdown(markdown, heading)
    .split("\n")
    .map((line) => line.match(/^\s*(\d+)\.\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      order: Number(match[1]),
      text: stripInlineMarkdown(match[2].trim()),
    }));
}

function sectionMarkdown(markdown, heading) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i");
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

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

function pathCategory(path) {
  const parts = String(path || "").split("/");
  const archiveIndex = parts.indexOf("recipe-archive");
  return archiveIndex === -1 ? "" : parts[archiveIndex + 1] || "";
}

function normalizeRecipeCategory(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function slugFromTitle(value) {
  return normalizeRecipeCategory(value) || `recipe-${Date.now()}`;
}

function minutesValue(value) {
  const text = String(value || "").toLowerCase();
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hour|hr)/);
  const minuteMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:minute|min)/);
  const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  const total = hours + minutes;
  if (total > 0) {
    return total;
  }
  return numericValue(text);
}

function numericValue(value) {
  const text = String(value || "").trim();
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return Number(fraction[1]) / Number(fraction[2]);
  }
  const number = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : null;
}

function isLikelyPerishableItem(item) {
  const words = new Set(groceryItemWords(item));
  return [
    "apple", "avocado", "basil", "beef", "broccoli", "carrot", "cheese", "chicken", "cilantro", "cream",
    "cucumber", "dill", "egg", "fish", "ginger", "ham", "lettuce", "lime", "meat", "milk", "mushroom",
    "onion", "parsley", "pepper", "pork", "potato", "salmon", "shrimp", "steak", "tomato", "turkey",
    "yogurt", "zucchini",
  ].some((word) => words.has(word));
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

function archiveRecipeToMenuRow(doc, day) {
  return {
    Day: day,
    Meal: doc.title,
    "Recipe file": fileNameFromPath(doc.path),
    "Recipe path": doc.path,
    Stage: stageForDoc(doc) || "Stage 2",
    Protein: doc.recipe?.protein || planningSummaryValue(doc.markdown, "Protein"),
    "Cuisine/flavor": doc.recipe?.cuisine || planningSummaryValue(doc.markdown, "Cuisine or flavor direction"),
    "Perishability reason": doc.recipe?.perishabilityNotes || planningSummaryValue(doc.markdown, "Perishability notes"),
    Notes: "Added from recipe archive",
    "Plan source": "archive",
  };
}

function createWorkingWeekShell({ startDate, weekNumber, year }) {
  const normalizedYear = String(year || new Date().getFullYear()).trim();
  const normalizedWeekNumber = String(Math.max(1, Math.min(53, Number(weekNumber) || 1))).padStart(2, "0");
  const normalizedStartDate = startDate || getNextPlanningWeekDefaults().startDate;
  return {
    endDate: weekEndDate(normalizedStartDate),
    id: `planning-${normalizedYear}-week-${normalizedWeekNumber}`,
    label: `${normalizedYear} week ${Number(normalizedWeekNumber)} planning`,
    menuRows: createBlankMenuRows(buildWeekDayOptions(normalizedStartDate)),
    startDate: normalizedStartDate,
    weekNumber: Number(normalizedWeekNumber),
    year: normalizedYear,
  };
}

function createBlankMenuRows(dayOptions) {
  return dayOptions.map((day) => ({
    Day: day,
    Meal: "",
    "Recipe file": "",
    Stage: "",
    Protein: "",
    "Cuisine/flavor": "",
    "Perishability reason": "",
    Notes: "",
  }));
}

function getNextPlanningWeekDefaults(existingWeeks = []) {
  const latestWeek = [...existingWeeks]
    .filter((week) => parseLocalDate(week.startDate))
    .sort((a, b) => parseLocalDate(b.startDate) - parseLocalDate(a.startDate))[0];

  if (latestWeek) {
    const nextStart = parseLocalDate(latestWeek.startDate);
    nextStart.setDate(nextStart.getDate() + 7);
    const latestWeekNumber = weekNumberFromWeek(latestWeek);
    const nextWeekNumber = latestWeekNumber >= 1 && latestWeekNumber < 53
      ? latestWeekNumber + 1
      : isoWeekNumber(nextStart);
    return {
      startDate: formatInputDate(nextStart),
      weekNumber: nextWeekNumber,
      year: nextStart.getFullYear(),
    };
  }

  const today = startOfLocalDay(new Date());
  const nextSunday = new Date(today);
  const daysUntilSunday = (7 - today.getDay()) % 7 || 7;
  nextSunday.setDate(today.getDate() + daysUntilSunday);
  return {
    startDate: formatInputDate(nextSunday),
    weekNumber: isoWeekNumber(nextSunday),
    year: nextSunday.getFullYear(),
  };
}

function weekNumberFromWeek(week) {
  const direct = Number(week.weekNumber);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }
  const match = `${week.id || ""} ${week.label || ""}`.match(/\bweek[-\s]*(\d{1,2})\b/i);
  return match ? Number(match[1]) : 0;
}

function buildWeekDayOptions(startDate) {
  const start = parseLocalDate(startDate);
  if (!start) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return `${date.toLocaleDateString(undefined, { weekday: "long" })}, ${date.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  });
}

function workingWeekDayOptions(week) {
  const existingDays = (week.menuRows || []).map((row) => row.Day).filter(Boolean);
  return existingDays.length ? existingDays : buildWeekDayOptions(week.startDate);
}

function weekEndDate(startDate) {
  const start = parseLocalDate(startDate);
  if (!start) {
    return "";
  }
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return formatInputDate(end);
}

function formatInputDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function isoWeekNumber(date) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  return Math.ceil((((normalized - yearStart) / 86400000) + 1) / 7);
}

function uniqueValues(values) {
  return [...new Set(values)];
}

function replaceMenuRowForDay(rows, nextRow) {
  const nextRows = rows.length ? [...rows] : [];
  const existingIndex = nextRows.findIndex((row) => row.Day === nextRow.Day);
  if (existingIndex === -1) {
    nextRows.push(nextRow);
    return nextRows;
  }
  nextRows[existingIndex] = { ...nextRows[existingIndex], ...nextRow };
  return nextRows;
}

function clearMenuRowForDay(rows, day) {
  return rows.map((row) => {
    if (row.Day !== day) {
      return row;
    }
    return {
      ...row,
      Meal: "",
      Notes: "",
      "Cuisine/flavor": "",
      "Perishability reason": "",
      "Plan source": "",
      Protein: "",
      "Recipe file": "",
      "Recipe path": "",
      Stage: "",
    };
  });
}

function findRecipeDocForMenuRow(row, docs) {
  const recipePath = row["Recipe path"] || "";
  if (recipePath) {
    const byPath = docs.find((candidate) => candidate.path === recipePath);
    if (byPath) {
      return byPath;
    }
  }

  const recipeFile = row["Recipe file"] || "";
  return docs.find((candidate) => recipeFile && candidate.path.endsWith(`/${recipeFile}`)) || null;
}

function fileNameFromPath(value) {
  return String(value || "").split("/").pop() || "";
}

function planningSummaryValue(markdown, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = (markdown || "").match(new RegExp(`^-\\s+${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

function recipeStageFromMarkdown(markdown) {
  const match = (markdown || "").match(/^Status:\s*(.+)$/im);
  if (!match) {
    return "";
  }
  const stage = match[1].match(/Stage\s+\d+/i);
  return stage ? stage[0].replace(/\bstage\b/i, "Stage") : "";
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

function formatGroceryCardQuantity(value, unitMode) {
  const formatted = formatQuantity(value, unitMode);
  if (/^\d+(?:\.\d+)?$/.test(formatted.trim())) {
    return `x${formatted.trim()}`;
  }
  return formatted;
}

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function extractIngredientRows(markdown) {
  const seenIngredients = new Set();
  return extractIngredientTableRows(markdown)
    .map((row) => ({
      ingredient: row.Ingredient || row.Item || "",
    }))
    .filter((row) => {
      const key = row.ingredient.trim().toLowerCase();
      if (!key || seenIngredients.has(key)) {
        return false;
      }
      seenIngredients.add(key);
      return true;
    });
}

function ingredientRowsForDoc(doc) {
  if (doc?.recipe?.ingredients?.length) {
    return doc.recipe.ingredients.map((ingredient) => ({
      Quantity: ingredient.quantityText || "",
      Ingredient: ingredient.item || "",
      "Preferred version/type": ingredient.preferredType || "",
      "Acceptable alternatives": ingredient.acceptableAlternatives || "",
      Notes: ingredient.notes || ingredient.usedIn || "",
    }));
  }
  return extractIngredientTableRows(doc?.markdown || "");
}

function stageForDoc(doc) {
  if (doc?.recipe?.status === "stage-2") {
    return "Stage 2";
  }
  if (doc?.recipe?.status === "stage-1") {
    return "Stage 1";
  }
  return recipeStageFromMarkdown(doc?.markdown || "");
}

function extractIngredientTableRows(markdown) {
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
          rows.push(Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] || ""])));
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

function getDefaultRecipeForWeek(week, menuRows = week.weeklyMenu, docs = week.recipes) {
  const today = startOfLocalDay(new Date());
  const datedRows = menuRows
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
    const doc = findRecipeDocForMenuRow(entry.row, docs);
    if (doc) {
      return doc;
    }
  }

  return null;
}

function formatWeekDayOption(week, index) {
  const startDate = parseLocalDate(week.startDate);
  if (!startDate) {
    return `Day ${index + 1}`;
  }
  const date = addDays(startDate, index);
  return date.toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" });
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

function buildArchiveDirectories(docs) {
  const directories = new Map();
  docs.forEach((doc) => {
    const parts = doc.path.split("/");
    const fileName = parts.pop();
    let folderParts = parts;
    if (folderParts[0] === "recipe-archive") {
      folderParts = folderParts.slice(1);
    }
    const id = folderParts.join("/") || "root";
    const label = folderParts.length ? folderParts.map(formatFolderName).join(" / ") : "Recipe Archive";
    if (!directories.has(id)) {
      directories.set(id, { docs: [], id, label });
    }
    directories.get(id).docs.push({ ...doc, fileName });
  });

  return [...directories.values()]
    .map((directory) => ({
      ...directory,
      docs: directory.docs.sort((a, b) => a.title.localeCompare(b.title)),
    }))
    .filter((directory) => directory.docs.length)
    .sort((a, b) => a.label.localeCompare(b.label));
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
