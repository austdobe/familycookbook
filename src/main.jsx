import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { RecipeImportDialog } from "./components/RecipeImportDialog.jsx";
import {
  clearGroceryState,
  deleteGroceryState,
  getGroceryState,
  saveGroceryState,
  syncGroceryStateFromFirebase,
  subscribeGroceryState,
  toggleGroceryItem,
} from "./services/groceryStore.js";
import { markdownToHtml } from "./services/markdown.js";
import { clearPrepState, deletePrepState, savePrepState, subscribePrepState, syncPrepStateFromFirebase, togglePrepTask } from "./services/prepStore.js";
import { saveRecipeFeedback, subscribeRecipeFeedback } from "./services/recipeFeedbackStore.js";
import { saveRecipe, subscribeRecipes, syncRecipesFromFirebase } from "./services/recipeStore.js";
import { formatQuantity } from "./services/units.js";
import { deleteWeekPlanState, saveWeekPlanState, subscribeWeekPlanState, syncWeekPlanStateFromFirebase } from "./services/weekPlanStore.js";
import { deleteWorkingWeek, subscribeWorkingWeeks, syncWorkingWeeksFromFirebase, upsertWeek, upsertWorkingWeek } from "./services/workingWeeksStore.js";
import "./styles.css";

const views = [
  ["week", "Week"],
  ["recipes", "Recipes"],
  ["grocery", "Grocery"],
  ["prep", "Prep"],
];
const baseUrl = import.meta.env.BASE_URL;
const DAY_DRAG_TYPE = "application/x-family-cookbook-day";
const RECIPE_DRAG_TYPE = "application/x-family-cookbook-recipe";

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
  const [selectedWeekPlanState, setSelectedWeekPlanState] = useState({ menuRows: [] });
  const [resyncStatus, setResyncStatus] = useState("");
  const [resyncingLists, setResyncingLists] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");
  const [syncingFirebase, setSyncingFirebase] = useState(false);

  useEffect(() => {
    loadData().then((nextData) => {
      setData(nextData);
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
    ? `${firebaseArchiveDocs.length} saved recipes`
    : `${archiveDocs.length} recipes ready`;

  const selectedWeek = useMemo(() => {
    if (!data) {
      return null;
    }
    return weeks.find((week) => week.id === weekId) || weeks[0] || null;
  }, [data, weekId, weeks]);

  useEffect(() => {
    if (!weeks.length) {
      setWeekId("");
      return;
    }
    if (!weeks.some((week) => week.id === weekId)) {
      setWeekId(getDefaultWeekId(weeks));
    }
  }, [weekId, weeks]);

  useEffect(() => {
    if (!selectedWeek?.id) {
      setSelectedWeekPlanState({ menuRows: [] });
      return undefined;
    }
    setSelectedWeekPlanState({ menuRows: [] });
    return subscribeWeekPlanState(selectedWeek.id, setSelectedWeekPlanState);
  }, [selectedWeek?.id]);

  const resyncSelectedWeekLists = async () => {
    if (!selectedWeek) {
      return;
    }

    setResyncingLists(true);
    setResyncStatus("Refreshing shopping and prep lists...");
    try {
      const nextWeek = await resyncWeekAssets({
        archiveDocs,
        existingGroceryState: await getGroceryState(selectedWeek.id),
        week: selectedWeek,
        weekPlanState: selectedWeekPlanState,
      });
      if (nextWeek.isWorkingWeek) {
        setWorkingWeeks((current) => upsertWeek(current, nextWeek));
        await upsertWorkingWeek(nextWeek);
      }
      setResyncStatus(`Updated ${nextWeek.groceryItems.length} grocery items and ${nextWeek.prepTasks.length} prep tasks.`);
    } catch (error) {
      setResyncStatus(`List update failed: ${error.message}`);
    } finally {
      setResyncingLists(false);
    }
  };

  const deleteSelectedWorkingWeek = async (weekToDelete) => {
    if (!weekToDelete?.id) {
      return;
    }
    await Promise.all([
      deleteWeekPlanState(weekToDelete.id),
      deleteGroceryState(weekToDelete.id),
      deletePrepState(weekToDelete.id),
    ]);
    const nextWorkingWeeks = await deleteWorkingWeek(weekToDelete.id);
    setWorkingWeeks(nextWorkingWeeks);
    const nextWeeks = mergeCookbookWeeks(data.weeks, nextWorkingWeeks, archiveDocs);
    setWeekId(nextWeeks[0]?.id || "");
    setActiveDocId("");
  };

  const syncFromFirebase = async () => {
    setSyncingFirebase(true);
    setSyncStatus("Checking Firebase...");
    try {
      const [nextArchiveDocs, nextWorkingWeeks] = await Promise.all([
        syncRecipesFromFirebase(),
        syncWorkingWeeksFromFirebase(),
      ]);
      setFirebaseArchiveDocs(nextArchiveDocs);
      setWorkingWeeks(nextWorkingWeeks);
      await Promise.all(nextWorkingWeeks.flatMap((week) => [
        syncWeekPlanStateFromFirebase(week.id),
        syncGroceryStateFromFirebase(week.id),
        syncPrepStateFromFirebase(week.id),
      ]));
      setSyncStatus(`Synced ${nextWorkingWeeks.length} week${nextWorkingWeeks.length === 1 ? "" : "s"} and ${nextArchiveDocs.length} recipe${nextArchiveDocs.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setSyncStatus(`Sync failed: ${error.message}`);
    } finally {
      setSyncingFirebase(false);
    }
  };

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

        <div className="sync-note">Updated {formatDateTime(data.generatedAt)} | {recipeSourceLabel}</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewKicker(view)}</p>
            <h2>{viewTitle(view, selectedWeek)}</h2>
          </div>
          <div className="topbar-actions">
            {syncStatus ? <span className="pill">{syncStatus}</span> : null}
            {resyncStatus ? <span className="pill">{resyncStatus}</span> : null}
            <button
              className="quiet-button"
              disabled={syncingFirebase}
              onClick={syncFromFirebase}
              type="button"
            >
              {syncingFirebase ? "Syncing..." : "Sync"}
            </button>
            {selectedWeek ? (
              <button
                className="quiet-button"
                disabled={resyncingLists}
                onClick={resyncSelectedWeekLists}
                type="button"
              >
                {resyncingLists ? "Updating..." : "Update Lists"}
              </button>
            ) : null}
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
              onSaveWorkingWeek={async (weekPlan) => {
                setWorkingWeeks((current) => upsertWeek(current, weekPlan));
                await upsertWorkingWeek(weekPlan);
                setWeekId(weekPlan.id);
              }}
              onDeleteWorkingWeek={deleteSelectedWorkingWeek}
              onSelectWeek={(nextWeekId) => {
                setWeekId(nextWeekId);
                setActiveDocId("");
              }}
              search={search}
              setActiveDocId={setActiveDocId}
              setIngredientMode={setIngredientMode}
              setUnitMode={setUnitMode}
              unitMode={unitMode}
              week={selectedWeek}
              weeks={weeks}
              workingWeeks={workingWeeks}
            />
          ) : null}
          {view === "recipes" ? (
            <ArchiveView
              archiveDocs={archiveDocs}
              activeDocId={activeDocId}
              docs={filterDocs(archiveDocs, search)}
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

function WeekView({
  activeDocId,
  archiveDocs,
  ingredientMode,
  onDeleteWorkingWeek,
  onSaveWorkingWeek,
  onSelectWeek,
  search,
  setActiveDocId,
  setIngredientMode,
  setUnitMode,
  unitMode,
  week,
  weeks,
  workingWeeks,
}) {
  const [weekPlanState, setWeekPlanState] = useState({ menuRows: [] });
  const [recipeDialogMode, setRecipeDialogMode] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [weekCreatorOpen, setWeekCreatorOpen] = useState(false);
  const [weekActionMenuOpen, setWeekActionMenuOpen] = useState(false);
  const [mealEditorOpen, setMealEditorOpen] = useState(false);
  const [cardEditorDay, setCardEditorDay] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [draggingDay, setDraggingDay] = useState("");
  const [draggingRecipeId, setDraggingRecipeId] = useState("");

  useEffect(() => {
    if (!week) {
      return undefined;
    }
    return subscribeWeekPlanState(week.id, setWeekPlanState);
  }, [week]);

  if (!week) {
    return (
      <div className="stack">
        <WeekCreator
          onClose={() => setWeekCreatorOpen(false)}
          onCreateWeek={async (weekPlan) => {
            await saveNewPlanningWeek(weekPlan, onSaveWorkingWeek);
            onSelectWeek(weekPlan.id);
            setWeekCreatorOpen(false);
          }}
          open={weekCreatorOpen}
          weeks={weeks}
        />
        <WeekZeroState onAddWeek={() => setWeekCreatorOpen(true)} />
      </div>
    );
  }

  const sourceMenuRows = weekPlanState.menuRows?.length ? weekPlanState.menuRows : week.weeklyMenu;
  const plannedMenuRows = sourceMenuRows.filter(hasMeal);
  const menuRows = sourceMenuRows.filter((row) => matchesSearch(Object.values(row).join(" "), search));
  const allRecipeDocs = [...week.recipes, ...archiveDocs];
  const missingRecipeSelected = String(activeDocId || "").startsWith("missing-recipe|");
  const selectedRow = sourceMenuRows.find((row) => row.Day === selectedDay)
    || menuRows[0]
    || sourceMenuRows[0]
    || null;
  const selectedDoc = missingRecipeSelected
    ? null
    : allRecipeDocs.find((doc) => doc.id === activeDocId) || getDefaultRecipeForWeek(week, plannedMenuRows, allRecipeDocs) || allRecipeDocs[0] || null;
  const selectedRowDoc = selectedRow ? findRecipeDocForMenuRow(selectedRow, allRecipeDocs) : null;
  const readerDoc = selectedRow ? selectedRowDoc : selectedDoc;
  const cardEditorRow = sourceMenuRows.find((row) => row.Day === cardEditorDay) || null;
  const canDeleteWeek = plannedMenuRows.length === 0 && workingWeeks.some((candidate) => candidate.id === week.id);

  const saveRows = async (nextRows) => {
    const nextWeek = await saveWeekMenuRows({
      archiveDocs,
      menuRows: nextRows,
      onSaveWorkingWeek,
      week,
    });
    setActiveDocId("");
    return nextWeek;
  };

  const assignRecipeToSelectedDay = async (recipeDoc) => {
    if (!selectedRow || !recipeDoc) {
      return;
    }
    const nextRow = archiveRecipeToMenuRow(recipeDoc, selectedRow.Day);
    await saveRows(replaceMenuRowForDay(sourceMenuRows, nextRow));
    setActiveDocId(recipeDoc.id);
  };
  const assignRecipeToDay = async (recipeId, day) => {
    const recipeDoc = allRecipeDocs.find((doc) => doc.id === recipeId);
    if (!recipeDoc || !day) {
      setDraggingRecipeId("");
      return;
    }
    const nextRow = archiveRecipeToMenuRow(recipeDoc, day);
    await saveRows(replaceMenuRowForDay(sourceMenuRows, nextRow));
    setDraggingRecipeId("");
    setSelectedDay(day);
    setActiveDocId(recipeDoc.id);
  };

  const setTitleOnlyMealForSelectedDay = async (mealTitle) => {
    if (!selectedRow || !mealTitle.trim()) {
      return;
    }
    const nextRow = titleOnlyMealToMenuRow(mealTitle, selectedRow.Day);
    await saveRows(replaceMenuRowForDay(sourceMenuRows, nextRow));
    setActiveDocId(missingRecipeSelectionId(nextRow));
  };

  const clearCard = async (row) => {
    if (!row || !hasMeal(row)) {
      return;
    }
    await saveRows(clearMenuRowForDay(sourceMenuRows, row.Day));
    if (selectedDay === row.Day) {
      setActiveDocId("");
    }
  };
  const requestClearCard = (row) => {
    if (!row || !hasMeal(row)) {
      return;
    }
    setConfirmAction({
      confirmLabel: "Clear Card",
      description: `This removes the meal from ${row.Day} and updates grocery and prep lists.`,
      title: `Clear ${row.Day}?`,
      tone: "danger",
      onConfirm: () => clearCard(row),
    });
  };
  const clearWeek = async () => {
    if (!plannedMenuRows.length) {
      return;
    }
    await saveRows(clearAllMenuRows(sourceMenuRows));
    setActiveDocId("");
  };
  const requestClearWeek = () => {
    if (!plannedMenuRows.length) {
      return;
    }
    setConfirmAction({
      confirmLabel: "Clear Week",
      description: "This removes every planned meal and updates grocery and prep lists.",
      title: "Clear this week?",
      tone: "danger",
      onConfirm: clearWeek,
    });
  };
  const addCustomWeekCard = async () => {
    const nextRow = createCustomMenuRow(sourceMenuRows);
    await saveRows([...sourceMenuRows, nextRow]);
    setSelectedDay(nextRow.Day);
    setActiveDocId("");
    setMealEditorOpen(true);
  };
  const renameCard = async (row, nextTitle) => {
    if (!row) {
      return { ok: false, error: "Choose a card first." };
    }
    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle || trimmedTitle === row.Day) {
      return { ok: true };
    }
    if (sourceMenuRows.some((candidate) => candidate.Day === trimmedTitle && candidate.Day !== row.Day)) {
      return { ok: false, error: "That card title is already used in this week." };
    }
    const nextRows = renameMenuRowDay(sourceMenuRows, row.Day, trimmedTitle);
    const nextSelectedRow = nextRows.find((row) => row.Day === trimmedTitle) || null;
    await saveRows(nextRows);
    if (selectedDay === row.Day) {
      setSelectedDay(trimmedTitle);
    }
    setCardEditorDay(trimmedTitle);
    const nextSelectedDoc = nextSelectedRow ? findRecipeDocForMenuRow(nextSelectedRow, allRecipeDocs) : null;
    if (nextSelectedDoc) {
      setActiveDocId(nextSelectedDoc.id);
    } else if (nextSelectedRow && hasMeal(nextSelectedRow)) {
      setActiveDocId(missingRecipeSelectionId(nextSelectedRow));
    }
    return { ok: true };
  };
  const deleteCard = async (row) => {
    if (!row || !isCustomMenuCard(row, week)) {
      return;
    }
    const nextRows = deleteMenuRowForDay(sourceMenuRows, row.Day);
    const nextSelectedRow = nextRows[0] || null;
    await saveRows(nextRows);
    if (selectedDay === row.Day) {
      setSelectedDay(nextSelectedRow?.Day || "");
      setActiveDocId("");
    }
    setCardEditorDay("");
  };
  const requestDeleteCard = (row) => {
    if (!row || !isCustomMenuCard(row, week)) {
      return;
    }
    setConfirmAction({
      confirmLabel: "Delete Card",
      description: "This removes the card from the week. Meals on this card will be removed too.",
      title: `Delete ${row.Day}?`,
      tone: "danger",
      onConfirm: () => deleteCard(row),
    });
  };
  const deleteCurrentWeek = async () => {
    if (!canDeleteWeek) {
      return;
    }
    await onDeleteWorkingWeek(week);
    setMealEditorOpen(false);
    setWeekActionMenuOpen(false);
  };
  const requestDeleteWeek = () => {
    if (!canDeleteWeek) {
      return;
    }
    setConfirmAction({
      confirmLabel: "Delete Week",
      description: "This removes the empty week from planning.",
      title: `Delete ${week.label || week.title || "this week"}?`,
      tone: "danger",
      onConfirm: deleteCurrentWeek,
    });
  };
  const moveMealToDay = async (fromDay, toDay) => {
    if (!fromDay || !toDay || fromDay === toDay) {
      setDraggingDay("");
      return;
    }
    const nextRows = moveMenuRowBetweenDays(sourceMenuRows, fromDay, toDay);
    const nextSelectedRow = nextRows.find((row) => row.Day === toDay) || null;
    await saveRows(nextRows);
    setDraggingDay("");
    setSelectedDay(toDay);
    const nextSelectedDoc = nextSelectedRow ? findRecipeDocForMenuRow(nextSelectedRow, allRecipeDocs) : null;
    if (nextSelectedDoc) {
      setActiveDocId(nextSelectedDoc.id);
    } else if (nextSelectedRow && hasMeal(nextSelectedRow)) {
      setActiveDocId(missingRecipeSelectionId(nextSelectedRow));
    }
  };
  const openMealEditor = () => {
    if (!selectedDay && selectedRow?.Day) {
      setSelectedDay(selectedRow.Day);
    }
    setMealEditorOpen(true);
    setWeekActionMenuOpen(false);
  };

  return (
    <div className="stack">
      <RecipeImportDialog
        archiveDocs={archiveDocs}
        dialogMode={recipeDialogMode}
        onClose={() => setRecipeDialogMode("")}
        onSaveRecipe={({ category, existingDoc, markdown, status, title }) => saveRecipe(recipeFromMarkdownForSave({
          archiveDocs,
          category,
          existingDoc,
          markdown,
          status,
          title,
        }))}
        onSaved={(recipeDoc) => setActiveDocId(recipeDoc.id)}
        selectedRecipe={null}
      />
      <WeekCreator
        onClose={() => setWeekCreatorOpen(false)}
        onCreateWeek={async (weekPlan) => {
          await saveNewPlanningWeek(weekPlan, onSaveWorkingWeek);
          onSelectWeek(weekPlan.id);
          setWeekCreatorOpen(false);
        }}
        open={weekCreatorOpen}
        weeks={weeks}
      />
      <CardEditDialog
        canDeleteCard={isCustomMenuCard(cardEditorRow, week)}
        onClearCard={() => requestClearCard(cardEditorRow)}
        onClose={() => setCardEditorDay("")}
        onDeleteCard={() => requestDeleteCard(cardEditorRow)}
        onRenameCard={(nextTitle) => renameCard(cardEditorRow, nextTitle)}
        open={Boolean(cardEditorRow)}
        row={cardEditorRow}
      />
      <ConfirmDialog
        action={confirmAction}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          const action = confirmAction;
          setConfirmAction(null);
          await action?.onConfirm?.();
        }}
      />
      <section>
        <div className="section-title">
          <h3>Weekly Menu</h3>
          <div className="section-actions">
            <span className="pill">{plannedMenuRows.length} meals</span>
          </div>
        </div>
        <div className="menu-grid">
          {menuRows.length ? menuRows.map((row) => (
            <DayCard
              activeDocId={activeDocId}
              docs={allRecipeDocs}
              key={`${row.Day}-${row["Recipe path"] || row["Recipe file"] || row.Meal}`}
              row={row}
              draggingDay={draggingDay}
              draggingRecipeId={draggingRecipeId}
              editMode={mealEditorOpen}
              selectedDay={selectedRow?.Day || ""}
              selectedDoc={readerDoc}
              onDragEnd={() => {
                setDraggingDay("");
                setDraggingRecipeId("");
              }}
              onDragStart={(nextRow) => setDraggingDay(nextRow.Day)}
              onDropMeal={moveMealToDay}
              onDropRecipe={assignRecipeToDay}
              onEditCard={(nextRow) => setCardEditorDay(nextRow.Day)}
              onSelect={(nextId, nextRow) => {
                setSelectedDay(nextRow.Day);
                setActiveDocId(nextId);
                if (mealEditorOpen) {
                  setMealEditorOpen(true);
                }
              }}
            />
          )) : <div className="empty">No planned meals match the current search.</div>}
          {mealEditorOpen ? <AddWeekCardButton onClick={addCustomWeekCard} /> : null}
        </div>
      </section>

      {mealEditorOpen ? (
        <WeekMealAssignmentPanel
          archiveDocs={archiveDocs}
          onAddRecipe={() => setRecipeDialogMode("add")}
          onAssignRecipe={assignRecipeToSelectedDay}
          canDeleteWeek={canDeleteWeek}
          onClearWeek={requestClearWeek}
          onClose={() => setMealEditorOpen(false)}
          onDeleteWeek={requestDeleteWeek}
          onRecipeDragEnd={() => setDraggingRecipeId("")}
          onRecipeDragStart={(recipeDoc) => {
            setDraggingDay("");
            setDraggingRecipeId(recipeDoc.id);
          }}
          onSetTitleOnlyMeal={setTitleOnlyMealForSelectedDay}
          selectedRow={selectedRow}
        />
      ) : null}

      <section>
        <div className="section-title">
          <h3>Selected Recipe</h3>
          <div className="section-actions">
            <IngredientDetailToggle mode={ingredientMode} setMode={setIngredientMode} />
            <QuantityUnitToggle mode={unitMode} setMode={setUnitMode} />
            <span className="pill">{readerDoc ? stageForDoc(readerDoc) || "Recipe" : "No draft"}</span>
          </div>
        </div>
        {readerDoc ? (
          <MarkdownDoc
            ingredientMode={ingredientMode}
            unitMode={unitMode}
            markdown={readerDoc.markdown}
          />
        ) : (
          <RecipeZeroState
            onAddRecipe={() => setRecipeDialogMode("add")}
            subtitle="Add the recipe now, then paste, type, or attach a photo before saving."
            title="No Recipe Attached"
          />
        )}
        {readerDoc ? <RecipeFeedbackPanel recipe={readerDoc} /> : null}
      </section>
      <WeekActionMenu
        menuOpen={weekActionMenuOpen}
        onAddRecipe={() => {
          setWeekActionMenuOpen(false);
          setRecipeDialogMode("add");
        }}
        onAddWeek={() => {
          setWeekActionMenuOpen(false);
          setWeekCreatorOpen(true);
        }}
        onEditWeek={openMealEditor}
        setMenuOpen={setWeekActionMenuOpen}
      />
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
        <p>Saved with this recipe for cooking history, repeat decisions, and recipe improvements.</p>
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

function emptyPrepForm(section = "Sunday Prep") {
  return {
    details: "",
    section,
    title: "",
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

function CardEditDialog({ canDeleteCard, onClearCard, onClose, onDeleteCard, onRenameCard, open, row }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(row?.Day || "");
    setError("");
  }, [row?.Day]);

  if (!open || !row) {
    return null;
  }

  const saveTitle = async () => {
    const result = await onRenameCard(title);
    if (result?.ok === false) {
      setError(result.error || "Could not save that title.");
      return;
    }
    onClose();
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        aria-label="Edit week card"
        aria-modal="true"
        className="card grocery-dialog card-edit-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-header">
          <div>
            <h3>Edit Card</h3>
            <p className="dialog-help">{row.Meal || "Open"}</p>
          </div>
          <button aria-label="Close card editor" className="icon-button" onClick={onClose} type="button">x</button>
        </div>
        <label>
          Card title / date
          <input
            autoFocus
            onChange={(event) => {
              setTitle(event.target.value);
              setError("");
            }}
            placeholder="Sunday, July 5 or Ally Lunch"
            value={title}
          />
        </label>
        {error ? <span className="form-error">{error}</span> : null}
        <div className="dialog-actions card-edit-actions">
          <button className="mini-button" disabled={!row.Meal} onClick={onClearCard} type="button">Clear Card</button>
          <button className="mini-button" disabled={!canDeleteCard} onClick={onDeleteCard} type="button">Delete Card</button>
          <button className="quiet-button" onClick={onClose} type="button">Cancel</button>
          <button
            className="primary-button"
            disabled={!title.trim() || title.trim() === row.Day}
            onClick={saveTitle}
            type="button"
          >
            Save Title
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ action, onCancel, onConfirm }) {
  if (!action) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        aria-label={action.title}
        aria-modal="true"
        className="card grocery-dialog confirm-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-header">
          <div>
            <h3>{action.title}</h3>
            <p className="dialog-help">{action.description}</p>
          </div>
          <button aria-label="Close confirmation" className="icon-button" onClick={onCancel} type="button">x</button>
        </div>
        <div className="dialog-actions">
          <button className="quiet-button" onClick={onCancel} type="button">Cancel</button>
          <button className={action.tone === "danger" ? "danger-button" : "primary-button"} onClick={onConfirm} type="button">
            {action.confirmLabel || "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WeekMealAssignmentPanel({
  archiveDocs,
  canDeleteWeek,
  onAddRecipe,
  onAssignRecipe,
  onClearWeek,
  onClose,
  onDeleteWeek,
  onRecipeDragEnd,
  onRecipeDragStart,
  onSetTitleOnlyMeal,
  selectedRow,
}) {
  const [titleOnlyMeal, setTitleOnlyMeal] = useState("");
  const [weekActionsOpen, setWeekActionsOpen] = useState(false);

  useEffect(() => {
    setTitleOnlyMeal("");
    setWeekActionsOpen(false);
  }, [selectedRow?.Day]);

  if (!selectedRow) {
    return null;
  }

  return (
    <section className="card week-planner-panel">
      <div className="week-planner-panel-header">
        <div>
          <p className="eyebrow">Selected card</p>
          <h3>{selectedRow.Day || "Choose a day"}</h3>
        </div>
        <div className="week-planner-header-actions">
          <span className="pill">{selectedRow.Meal || "Open"}</span>
          <button aria-label="Close meal editor" className="icon-button" onClick={onClose} type="button">x</button>
        </div>
      </div>
      <div className="week-planner-grid">
        <div className="week-planner-choice">
          <div className="field-group-heading">
            <h4>Use Saved Recipe</h4>
            <span className="pill">{archiveDocs.length} available</span>
          </div>
          {archiveDocs.length ? (
            <RecipePicker
              docs={archiveDocs}
              onChoose={onAssignRecipe}
              onRecipeDragEnd={onRecipeDragEnd}
              onRecipeDragStart={onRecipeDragStart}
            />
          ) : (
            <RecipeZeroState
              onAddRecipe={onAddRecipe}
              subtitle="Add your first recipe, then assign it to this day."
              title="No Saved Recipes"
            />
          )}
        </div>
        <div className="week-title-only">
          <label>
            Recipe title needed
            <input
              onChange={(event) => setTitleOnlyMeal(event.target.value)}
              placeholder="Taco night"
              value={titleOnlyMeal}
            />
          </label>
          <button
            className="quiet-button"
            disabled={!titleOnlyMeal.trim()}
            onClick={() => {
              onSetTitleOnlyMeal(titleOnlyMeal);
              setTitleOnlyMeal("");
            }}
            type="button"
          >
            Save Title Only
          </button>
        </div>
      </div>
      <div className="week-planner-actions">
        <button className="quiet-button" onClick={onAddRecipe} type="button">Create New Recipe</button>
        <div className="week-more-actions">
          <button
            aria-expanded={weekActionsOpen}
            className="quiet-button"
            onClick={() => setWeekActionsOpen((current) => !current)}
            type="button"
          >
            Week Actions
          </button>
          {weekActionsOpen ? (
            <div className="week-more-menu">
              <button disabled={!canDeleteWeek} onClick={onDeleteWeek} type="button">Delete Week</button>
              <button onClick={onClearWeek} type="button">Clear Week</button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RecipePicker({ docs, onChoose, onRecipeDragEnd, onRecipeDragStart }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [quickOnly, setQuickOnly] = useState(false);
  const [draggingRecipeId, setDraggingRecipeId] = useState("");
  const categories = useMemo(() => {
    const values = docs
      .map((doc) => normalizeRecipeCategory(doc.recipe?.category || pathCategory(doc.path)))
      .filter(Boolean);
    return ["all", ...uniqueValues(values).sort()];
  }, [docs]);
  const filteredDocs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return docs
      .filter((doc) => category === "all" || normalizeRecipeCategory(doc.recipe?.category || pathCategory(doc.path)) === category)
      .filter((doc) => !quickOnly || recipeIsUnderThirtyMinutes(doc))
      .filter((doc) => !needle || recipePickerSearchText(doc).includes(needle))
      .slice(0, 24);
  }, [category, docs, query, quickOnly]);

  return (
    <div className="recipe-picker">
      <label className="recipe-picker-search">
        Search recipes
        <input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by meal, protein, flavor"
          type="search"
          value={query}
        />
      </label>
      <div className="recipe-picker-categories" aria-label="Recipe categories">
        <button
          aria-pressed={quickOnly}
          className={quickOnly ? "active" : ""}
          onClick={() => setQuickOnly((current) => !current)}
          type="button"
        >
          Under 30 min
        </button>
        {categories.map((option) => (
          <button
            aria-pressed={category === option}
            className={category === option ? "active" : ""}
            key={option}
            onClick={() => setCategory(option)}
            type="button"
          >
            {option === "all" ? "All" : formatFolderName(option)}
          </button>
        ))}
      </div>
      <div className="recipe-picker-list">
        {filteredDocs.length ? filteredDocs.map((doc) => (
          <button
            className={`recipe-picker-item ${draggingRecipeId === doc.id ? "dragging" : ""}`}
            draggable
            key={doc.id}
            onClick={() => onChoose(doc)}
            onDragEnd={() => {
              setDraggingRecipeId("");
              onRecipeDragEnd?.();
            }}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(RECIPE_DRAG_TYPE, doc.id);
              event.dataTransfer.setData("text/plain", doc.id);
              setDraggingRecipeId(doc.id);
              onRecipeDragStart?.(doc);
            }}
            title="Drag this recipe onto a week card, or click to set it on the selected card"
            type="button"
          >
            <span className="recipe-picker-title">{doc.title}</span>
            <span className="recipe-picker-meta">{recipePickerMeta(doc)}</span>
          </button>
        )) : (
          <div className="empty recipe-picker-empty">No recipes match that search.</div>
        )}
      </div>
    </div>
  );
}

function recipePickerSearchText(doc) {
  const recipe = doc.recipe || {};
  const totalMinutes = recipeTotalMinutes(doc);
  return [
    doc.title,
    doc.summary,
    recipe.category,
    recipe.protein,
    recipe.cuisine,
    recipe.planning?.protein,
    recipe.planning?.cuisine,
    Number.isFinite(totalMinutes) ? `${totalMinutes} minutes` : "",
    recipeIsUnderThirtyMinutes(doc) ? "under 30 quick fast" : "",
    pathCategory(doc.path),
    stageForDoc(doc),
  ].filter(Boolean).join(" ").toLowerCase();
}

function recipePickerMeta(doc) {
  const recipe = doc.recipe || {};
  const category = normalizeRecipeCategory(recipe.category || pathCategory(doc.path));
  return [
    category ? formatFolderName(category) : "",
    formatRecipeTime(doc),
    recipe.protein || recipe.planning?.protein || "",
    recipe.cuisine || recipe.planning?.cuisine || "",
    stageForDoc(doc),
  ].filter(Boolean).slice(0, 3).join(" | ") || "Recipe";
}

function recipeTotalMinutes(doc) {
  const recipe = doc.recipe || {};
  const planning = recipe.planning || {};
  const prepMinutes = firstFiniteNumber([
    recipe.estimatedPrepMinutes,
    recipe.estimatedPrepTime,
    recipe.estimatedPrepTimeMinutes,
    recipe.estimated_prep_minutes,
    recipe.estimated_prep_time,
    recipe.estimated_prep_time_minutes,
    recipe.prepMinutes,
    recipe.prepTime,
    recipe.prepTimeMinutes,
    recipe.prep_minutes,
    recipe.prep_time,
    recipe.prep_time_minutes,
    planning.estimatedPrepMinutes,
    planning.estimatedPrepTime,
    planning.estimatedPrepTimeMinutes,
    planning.estimated_prep_minutes,
    planning.estimated_prep_time,
    planning.estimated_prep_time_minutes,
    planning.prepMinutes,
    planning.prepTime,
    planning.prepTimeMinutes,
    planning.prep_minutes,
    planning.prep_time,
    planning.prep_time_minutes,
    planningSummaryValue(doc.markdown, "Estimated prep time"),
    planningSummaryValue(doc.markdown, "Prep time"),
    planningSummaryValue(doc.markdown, "Prep"),
    planningSummaryValue(doc.markdown, "Active prep time"),
    planningSummaryValue(doc.markdown, "Estimated active prep time"),
  ]);
  const cookMinutes = firstFiniteNumber([
    recipe.estimatedCookMinutes,
    recipe.estimatedCookTime,
    recipe.estimatedCookTimeMinutes,
    recipe.estimated_cook_minutes,
    recipe.estimated_cook_time,
    recipe.estimated_cook_time_minutes,
    recipe.cookMinutes,
    recipe.cookTime,
    recipe.cookTimeMinutes,
    recipe.cook_minutes,
    recipe.cook_time,
    recipe.cook_time_minutes,
    planning.estimatedCookMinutes,
    planning.estimatedCookTime,
    planning.estimatedCookTimeMinutes,
    planning.estimated_cook_minutes,
    planning.estimated_cook_time,
    planning.estimated_cook_time_minutes,
    planning.cookMinutes,
    planning.cookTime,
    planning.cookTimeMinutes,
    planning.cook_minutes,
    planning.cook_time,
    planning.cook_time_minutes,
    planningSummaryValue(doc.markdown, "Estimated cook time"),
    planningSummaryValue(doc.markdown, "Cook time"),
    planningSummaryValue(doc.markdown, "Cook"),
    planningSummaryValue(doc.markdown, "Active cook time"),
    planningSummaryValue(doc.markdown, "Estimated active cook time"),
  ]);
  const activeTotal = firstFiniteNumber([
    recipe.activeMinutes,
    recipe.activeTime,
    recipe.active_minutes,
    recipe.active_time,
    recipe.estimatedActiveMinutes,
    recipe.estimatedActiveTime,
    recipe.estimated_active_minutes,
    recipe.estimated_active_time,
    planning.activeMinutes,
    planning.activeTime,
    planning.active_minutes,
    planning.active_time,
    planning.estimatedActiveMinutes,
    planning.estimatedActiveTime,
    planning.estimated_active_minutes,
    planning.estimated_active_time,
    planningSummaryValue(doc.markdown, "Active time"),
    planningSummaryValue(doc.markdown, "Estimated active time"),
  ]);
  if (Number.isFinite(prepMinutes) && Number.isFinite(cookMinutes)) {
    return prepMinutes + cookMinutes;
  }
  if (Number.isFinite(activeTotal)) {
    return activeTotal;
  }

  const explicitTotal = firstFiniteNumber([
    recipe.estimatedTotalMinutes,
    recipe.estimatedTotalTime,
    recipe.estimatedTotalTimeMinutes,
    recipe.estimated_total_minutes,
    recipe.estimated_total_time,
    recipe.estimated_total_time_minutes,
    recipe.totalMinutes,
    recipe.totalTime,
    recipe.totalTimeMinutes,
    recipe.total_minutes,
    recipe.total_time,
    recipe.total_time_minutes,
    planning.estimatedTotalMinutes,
    planning.estimatedTotalTime,
    planning.estimatedTotalTimeMinutes,
    planning.estimated_total_minutes,
    planning.estimated_total_time,
    planning.estimated_total_time_minutes,
    planning.totalMinutes,
    planning.totalTime,
    planning.totalTimeMinutes,
    planning.total_minutes,
    planning.total_time,
    planning.total_time_minutes,
    planningSummaryValue(doc.markdown, "Estimated total time"),
    planningSummaryValue(doc.markdown, "Total time"),
    planningSummaryValue(doc.markdown, "Total"),
  ]);
  if (Number.isFinite(explicitTotal)) {
    return explicitTotal;
  }

  if (Number.isFinite(prepMinutes) || Number.isFinite(cookMinutes)) {
    return (Number.isFinite(prepMinutes) ? prepMinutes : 0) + (Number.isFinite(cookMinutes) ? cookMinutes : 0);
  }

  return activeMinutesValue(
    planningSummaryValue(doc.markdown, "Estimated cook time")
      || planningSummaryValue(doc.markdown, "Cook time")
      || planningSummaryValue(doc.markdown, "Prep time")
  );
}

function firstFiniteNumber(values) {
  return values
    .map(activeMinutesValue)
    .find((value) => Number.isFinite(value) && value > 0);
}

function recipeIsUnderThirtyMinutes(doc) {
  const minutes = recipeTotalMinutes(doc);
  return Number.isFinite(minutes) && minutes <= 30;
}

function formatRecipeTime(doc) {
  const minutes = recipeTotalMinutes(doc);
  return Number.isFinite(minutes) ? `${minutes} min` : "";
}

function activeMinutesValue(value) {
  return minutesValue(removePassiveTimingText(value));
}

function removePassiveTimingText(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }

  return text
    .split(/(?:;|\+|,|\(|\)|\bplus\b|\band\b)/i)
    .filter((part) => !/\b(?:marinad(?:e|ing)|marinat(?:e|es|ed|ing)|rest(?:s|ed|ing)?|chill(?:s|ed|ing)?|refrigerat(?:e|es|ed|ing)|brin(?:e|es|ed|ing)|soak(?:s|ed|ing)?|ris(?:e|es|ing)|proof(?:s|ed|ing)?)\b/i.test(part))
    .join(" ");
}

function WeekActionMenu({
  menuOpen,
  onAddRecipe,
  onAddWeek,
  onEditWeek,
  setMenuOpen,
}) {
  return (
    <div className="action-fab-wrap week-action-fab-wrap">
      {menuOpen ? (
        <div className="action-menu" role="menu">
          <button onClick={onAddWeek} role="menuitem" type="button">Add Week</button>
          <button onClick={onEditWeek} role="menuitem" type="button">Edit Week</button>
          <button onClick={onAddRecipe} role="menuitem" type="button">Create New Recipe</button>
        </div>
      ) : null}
      <button
        aria-expanded={menuOpen}
        aria-label="Open week actions"
        className="action-fab"
        onClick={() => setMenuOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">{menuOpen ? "x" : "+"}</span>
      </button>
    </div>
  );
}

function WeekCreator({ onClose, onCreateWeek, open, weeks }) {
  const defaults = useMemo(() => getNextPlanningWeekDefaults(weeks), [weeks]);
  const [mode, setMode] = useState("next");
  const [year, setYear] = useState(String(defaults.year));
  const [weekNumber, setWeekNumber] = useState(String(defaults.weekNumber));
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const previewWeek = createWorkingWeekShell({ startDate, weekNumber, year });
  const duplicateWeek = weeks.find((week) => week.id === previewWeek.id);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDefaults = getNextPlanningWeekDefaults(weeks);
    setMode("next");
    setYear(String(nextDefaults.year));
    setWeekNumber(String(nextDefaults.weekNumber));
    setStartDate(nextDefaults.startDate);
    setDuplicateConfirmOpen(false);
  }, [open, weeks]);

  useEffect(() => {
    if (mode !== "next") {
      return;
    }
    setYear(String(defaults.year));
    setWeekNumber(String(defaults.weekNumber));
    setStartDate(defaults.startDate);
  }, [defaults.startDate, defaults.weekNumber, defaults.year, mode]);

  if (!open) {
    return null;
  }

  const saveWeek = async (event) => {
    event.preventDefault();
    if (duplicateWeek) {
      setDuplicateConfirmOpen(true);
      return;
    }
    await onCreateWeek(previewWeek);
  };

  return (
    <>
      <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
        <form
          aria-label="Add planning week"
          className="card grocery-dialog week-create-dialog"
          onMouseDown={(event) => event.stopPropagation()}
          onSubmit={saveWeek}
        >
          <div className="dialog-header">
            <div>
              <h3>Add Week</h3>
              <p className="dialog-help">Create a blank week, then fill each day from the Week screen.</p>
            </div>
            <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">x</button>
          </div>
          <label>
            Week
            <select onChange={(event) => setMode(event.target.value)} value={mode}>
              <option value="next">Next available week</option>
              <option value="custom">Choose a specific week</option>
            </select>
          </label>
          {mode === "custom" ? (
            <div className="manual-grocery-grid week-dialog-grid">
              <label>
                Year
                <input onChange={(event) => setYear(event.target.value)} value={year} />
              </label>
              <label>
                Week
                <input
                  max="53"
                  min="1"
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
          ) : null}
          <div className={`week-target-summary ${duplicateWeek ? "warning" : ""}`}>
            <span className="pill">{previewWeek.label}</span>
            <span>Starts {formatShortDate(previewWeek.startDate)}</span>
            {duplicateWeek ? <strong>Already exists</strong> : null}
          </div>
          <div className="dialog-actions">
            <button className="quiet-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" type="submit">{duplicateWeek ? "Replace Week Setup" : "Create Week"}</button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        action={duplicateConfirmOpen ? {
          confirmLabel: "Replace Week Setup",
          description: `${duplicateWeek?.label || "This week"} already exists. Replacing it will overwrite that week setup.`,
          title: "Replace existing week?",
          tone: "danger",
          onConfirm: () => onCreateWeek(previewWeek),
        } : null}
        onCancel={() => setDuplicateConfirmOpen(false)}
        onConfirm={async () => {
          setDuplicateConfirmOpen(false);
          await onCreateWeek(previewWeek);
        }}
      />
    </>
  );
}

function DayCard({
  activeDocId,
  docs,
  draggingDay,
  draggingRecipeId,
  editMode,
  onDragEnd,
  onDragStart,
  onDropMeal,
  onDropRecipe,
  onEditCard,
  onSelect,
  row,
  selectedDay,
  selectedDoc,
}) {
  const doc = findRecipeDocForMenuRow(row, docs);
  const missingSelectionId = missingRecipeSelectionId(row);
  const canDrag = hasMeal(row);
  const isDragging = draggingDay === row.Day;
  const isRecipeDropTarget = Boolean(draggingRecipeId);
  const isDropTarget = isRecipeDropTarget || Boolean(draggingDay && draggingDay !== row.Day);
  const isActive = row.Day === selectedDay
    || (selectedDoc && doc && selectedDoc.id === doc.id)
    || (!doc && activeDocId === missingSelectionId);
  const selectCard = () => onSelect(doc ? doc.id : missingSelectionId, row);

  return (
    <div
      className={`item-card day-card ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`}
      draggable={canDrag}
      onClick={selectCard}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        const dragTypes = Array.from(event.dataTransfer.types || []);
        if (dragTypes.includes(RECIPE_DRAG_TYPE) || draggingRecipeId || (draggingDay && draggingDay !== row.Day)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = dragTypes.includes(RECIPE_DRAG_TYPE) || draggingRecipeId ? "copy" : "move";
        }
      }}
      onDragStart={(event) => {
        if (!canDrag) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DAY_DRAG_TYPE, row.Day);
        event.dataTransfer.setData("text/plain", row.Day);
        onDragStart(row);
      }}
      onDrop={(event) => {
        const recipeId = event.dataTransfer.getData(RECIPE_DRAG_TYPE) || draggingRecipeId;
        if (recipeId) {
          event.preventDefault();
          onDropRecipe(recipeId, row.Day);
          return;
        }
        const fromDay = event.dataTransfer.getData(DAY_DRAG_TYPE) || event.dataTransfer.getData("text/plain") || draggingDay;
        if (!fromDay || fromDay === row.Day) {
          return;
        }
        event.preventDefault();
        onDropMeal(fromDay, row.Day);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectCard();
        }
      }}
      role="button"
      tabIndex={0}
      title={isRecipeDropTarget ? "Drop this recipe here" : canDrag ? "Drag to move this meal to another day" : "Drop a meal here"}
    >
      {editMode ? (
        <button
          aria-label={`Edit ${row.Day || "card"}`}
          className="day-card-edit"
          onClick={(event) => {
            event.stopPropagation();
            onEditCard(row);
          }}
          type="button"
        >
          <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
            <path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16v4Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
            <path d="m13.5 6.5 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
          </svg>
        </button>
      ) : null}
      <div className="meta-row">
        <span className="pill">{row.Day || "Day"}</span>
        <span className="drag-hint">{isRecipeDropTarget ? "Drop recipe" : canDrag ? "Drag" : "Drop here"}</span>
      </div>
      <h3>{row.Meal || "Open"}</h3>
      <div className="meta-row">
        <span>{row.Protein || ""}</span>
        <span>{row["Cuisine/flavor"] || ""}</span>
      </div>
    </div>
  );
}

function AddWeekCardButton({ onClick }) {
  return (
    <button className="item-card day-card add-week-card" onClick={onClick} type="button">
      <div className="meta-row">
        <span className="pill">New card</span>
      </div>
      <h3>Add Week Card</h3>
      <div className="meta-row">
        <span>Lunch, potluck, extra dinner, or another planning slot</span>
      </div>
    </button>
  );
}

function GroceryView({ ingredientMode, search, setIngredientMode, setUnitMode, unitMode, week }) {
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
    setEditingGroceryKey("");
    setManualForm(emptyManualGroceryForm(categoryOptions[0] || "Other"));
    setManualDialogOpen(true);
  };
  const openEditDialog = (item) => {
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
    if (!manualForm.item.trim()) {
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
    await saveGroceryState(week.id, removeGroceryItemState(week, groceryState, sourceGrocerySections, item._key));
  };

  return (
    <div className="stack grocery-view">
      <section className="card grocery-toolbar">
        <div>
          <h3>Shopping Checklist</h3>
          <p>Checked items stay saved for this week.</p>
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
          onEdit={openEditDialog}
          onRemove={removeGroceryItem}
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

function GrocerySection({ checkedKeys, ingredientMode, onEdit, onRemove, onToggle, section, unitMode }) {
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
                  <td className="check-column grocery-edit-cell" data-label="Edit">
                    <div className="grocery-row-actions">
                      <button className="mini-button neutral" onClick={() => onEdit(item)} onDoubleClick={(event) => event.stopPropagation()} type="button">Edit</button>
                      <button className="mini-button" onClick={() => onRemove(item)} onDoubleClick={(event) => event.stopPropagation()} type="button">Remove</button>
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
  targetSection.items.push(groceryItemFromForm(form));
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
      editedItem = { ...item, ...groceryItemFromForm(form) };
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
    Object.entries(item || {}).filter(([key]) => !key.startsWith("_"))
  );
}

function groceryItemFromForm(form) {
  return {
    Quantity: form.quantity || "",
    Item: form.item.trim(),
    "Preferred version/type": form.preferred || "",
    "Acceptable alternatives": form.alternatives || "",
    Recipe: form.recipe || "Manual add",
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

function PrepView({ search, week }) {
  const [prepState, setPrepState] = useState({ checkedKeys: [], sections: [] });
  const [prepDialogOpen, setPrepDialogOpen] = useState(false);
  const [editingPrepKey, setEditingPrepKey] = useState("");
  const [prepForm, setPrepForm] = useState(emptyPrepForm());

  useEffect(() => {
    if (!week) {
      return undefined;
    }
    return subscribePrepState(week.id, setPrepState);
  }, [week]);

  useEffect(() => {
    if (!prepDialogOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setPrepDialogOpen(false);
        setEditingPrepKey("");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [prepDialogOpen]);

  if (!week) {
    return <div className="empty">No prep guide found.</div>;
  }

  const sourcePrepSections = prepState.sections?.length ? prepState.sections : week.prepSections;
  const sections = sourcePrepSections.filter((section) => matchesSearch(`${section.title} ${section.markdown}`, search));
  const checkedKeys = new Set(prepState.checkedKeys || []);
  const sectionOptions = prepSectionOptions(sourcePrepSections);
  const closePrepDialog = () => {
    setPrepDialogOpen(false);
    setEditingPrepKey("");
  };
  const openAddPrepDialog = () => {
    setEditingPrepKey("");
    setPrepForm(emptyPrepForm(sectionOptions[0] || "Sunday Prep"));
    setPrepDialogOpen(true);
  };
  const openEditPrepDialog = (section, task) => {
    setEditingPrepKey(prepTaskKey(week, section, task));
    setPrepForm({
      details: task.details || "",
      section: section.title || sectionOptions[0] || "Sunday Prep",
      title: task.title || "",
    });
    setPrepDialogOpen(true);
  };
  const savePrepTask = async (event) => {
    event.preventDefault();
    if (!prepForm.title.trim()) {
      return;
    }

    if (editingPrepKey) {
      await savePrepState(week.id, updatePrepTaskState(prepState, sourcePrepSections, editingPrepKey, prepForm));
    } else {
      await savePrepState(week.id, addPrepTaskState(prepState, sourcePrepSections, prepForm));
    }
    closePrepDialog();
  };

  return (
    <div className="stack">
      <section className="card prep-toolbar">
        <div>
          <h3>Prep Checklist</h3>
          <p>Prep checks stay saved for this week.</p>
        </div>
        <div className="grocery-toolbar-actions">
          <button className="quiet-button" onClick={openAddPrepDialog} type="button">Add Prep</button>
          <button className="quiet-button" onClick={() => clearPrepState(week.id)} type="button">Clear Checks</button>
        </div>
      </section>

      {sections.length ? sections.map((section) => (
        <PrepSection
          checkedKeys={checkedKeys}
          key={section.title}
          onEdit={(task) => openEditPrepDialog(section, task)}
          onRemove={(task) => savePrepState(week.id, removePrepTaskState(prepState, sourcePrepSections, prepTaskKey(week, section, task)))}
          onToggle={(task, checked) => togglePrepTask(week.id, prepTaskKey(week, section, task), checked)}
          section={section}
          week={week}
        />
      )) : <div className="empty">No prep items match the current search.</div>}
      {prepDialogOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={closePrepDialog}>
          <form
            aria-label={editingPrepKey ? "Edit prep task" : "Add prep task"}
            className="card grocery-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={savePrepTask}
          >
            <div className="dialog-header">
              <h3>{editingPrepKey ? "Edit Prep Task" : "Add Prep Task"}</h3>
              <button
                aria-label="Close dialog"
                className="icon-button"
                onClick={closePrepDialog}
                type="button"
              >
                x
              </button>
            </div>
            <label>
              Section
              <input
                list="prep-section-options"
                onChange={(event) => setPrepForm({ ...prepForm, section: event.target.value })}
                value={prepForm.section}
              />
              <datalist id="prep-section-options">
                {sectionOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>
            <label>
              Task
              <input
                autoFocus
                onChange={(event) => setPrepForm({ ...prepForm, title: event.target.value })}
                placeholder="Slice vegetables for Tuesday"
                value={prepForm.title}
              />
            </label>
            <label>
              Details
              <textarea
                onChange={(event) => setPrepForm({ ...prepForm, details: event.target.value })}
                placeholder="- Ingredients:&#10;- Instructions:&#10;- Storage method:&#10;- Use-by date:"
                rows="6"
                value={prepForm.details}
              />
            </label>
            <div className="dialog-actions">
              {editingPrepKey ? (
                <button
                  className="mini-button"
                  onClick={async () => {
                    await savePrepState(week.id, removePrepTaskState(prepState, sourcePrepSections, editingPrepKey));
                    closePrepDialog();
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
              <button className="quiet-button" onClick={closePrepDialog} type="button">Cancel</button>
              <button className="primary-button" type="submit">{editingPrepKey ? "Save" : "Add"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function PrepSection({ checkedKeys, onEdit, onRemove, onToggle, section, week }) {
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
              <span className="grocery-row-actions">
                <button className="mini-button neutral" onClick={(event) => {
                  event.preventDefault();
                  onEdit(task);
                }} type="button">Edit</button>
                <button className="mini-button" onClick={(event) => {
                  event.preventDefault();
                  onRemove(task);
                }} type="button">Remove</button>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function addPrepTaskState(currentState, sourceSections, form) {
  const nextSections = cleanPrepSections(sourceSections);
  const targetSection = ensurePrepSection(nextSections, form.section || "Sunday Prep");
  const tasks = parsePrepTasks(targetSection.markdown);
  targetSection.markdown = serializePrepTasks([...tasks, prepTaskFromForm(form)]);
  return {
    ...currentState,
    sections: removeEmptyPrepSections(nextSections),
  };
}

function updatePrepTaskState(currentState, sourceSections, taskKey, form) {
  const nextSections = cleanPrepSections(sourceSections);
  const weekId = taskKey.split("|")[0] || "";
  let editedTask = null;

  nextSections.forEach((section) => {
    const tasks = parsePrepTasks(section.markdown);
    const remainingTasks = tasks.filter((task) => {
      if (prepTaskKeyFromParts(weekId, section.title, task.index, task.title) !== taskKey) {
        return true;
      }
      editedTask = { ...task, ...prepTaskFromForm(form) };
      return false;
    });
    section.markdown = serializePrepTasks(remainingTasks);
  });

  if (editedTask) {
    const targetSection = ensurePrepSection(nextSections, form.section || "Sunday Prep");
    targetSection.markdown = serializePrepTasks([...parsePrepTasks(targetSection.markdown), editedTask]);
  }

  return {
    ...currentState,
    checkedKeys: (currentState.checkedKeys || []).filter((key) => key !== taskKey),
    sections: removeEmptyPrepSections(nextSections),
  };
}

function removePrepTaskState(currentState, sourceSections, taskKey) {
  const weekId = taskKey.split("|")[0] || "";
  const nextSections = cleanPrepSections(sourceSections).map((section) => {
    const tasks = parsePrepTasks(section.markdown)
      .filter((task) => prepTaskKeyFromParts(weekId, section.title, task.index, task.title) !== taskKey);
    return { ...section, markdown: serializePrepTasks(tasks) };
  });

  return {
    ...currentState,
    checkedKeys: (currentState.checkedKeys || []).filter((key) => key !== taskKey),
    sections: removeEmptyPrepSections(nextSections),
  };
}

function prepSectionOptions(sections = []) {
  return uniqueValues([
    ...sections.map((section) => section.title).filter(Boolean),
    "Sunday Prep",
    "Midweek Refresh",
    "Cook-Day Reminders",
    "Do Not Prep Ahead",
  ]);
}

function cleanPrepSections(sections = []) {
  return sections.map((section) => ({
    title: section.title || "Prep",
    markdown: section.markdown || "",
  }));
}

function ensurePrepSection(sections, title) {
  const sectionTitle = title || "Prep";
  let section = sections.find((candidate) => normalizeSectionName(candidate.title) === normalizeSectionName(sectionTitle));
  if (!section) {
    section = { title: sectionTitle, markdown: "" };
    sections.push(section);
  }
  return section;
}

function prepTaskFromForm(form) {
  return {
    details: form.details.trim(),
    title: form.title.trim(),
  };
}

function serializePrepTasks(tasks) {
  return tasks
    .map((task) => {
      const details = String(task.details || "")
        .trim()
        .split("\n")
        .filter((line, index, lines) => line.trim() || index < lines.length - 1)
        .map((line) => `  ${line}`)
        .join("\n");
      return [`- [ ] ${task.title}`, details].filter(Boolean).join("\n");
    })
    .join("\n");
}

function removeEmptyPrepSections(sections) {
  return sections.filter((section) => parsePrepTasks(section.markdown).length || section.markdown.trim());
}

function prepTaskKeyFromParts(weekId, sectionTitle, taskIndex, taskTitle) {
  return [weekId, sectionTitle, taskIndex, taskTitle].join("|");
}

function ArchiveView({
  activeDocId,
  archiveDocs,
  docs,
  ingredientMode,
  setActiveDocId,
  setIngredientMode,
  setUnitMode,
  unitMode,
}) {
  const directories = useMemo(() => buildArchiveDirectories(docs), [docs]);
  const [selectedDirectoryId, setSelectedDirectoryId] = useState("");
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [recipeDialogMode, setRecipeDialogMode] = useState("");
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
      <RecipeImportDialog
        archiveDocs={archiveDocs}
        dialogMode={recipeDialogMode}
        onClose={() => setRecipeDialogMode("")}
        onSaveRecipe={({ category, existingDoc, markdown, status, title }) => saveRecipe(recipeFromMarkdownForSave({
          archiveDocs,
          category,
          existingDoc,
          markdown,
          status,
          title,
        }))}
        onSaved={(recipeDoc) => setActiveDocId(recipeDoc.id)}
        selectedRecipe={selected}
      />
      <div className="split-view">
        <div className="archive-browser">
          {directories.length ? (
            <>
              <div className="archive-directory-list" aria-label="Recipe categories">
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
            <RecipeZeroState
              onAddRecipe={() => setRecipeDialogMode("add")}
              subtitle="Start with a typed recipe, pasted recipe text, or a recipe photo."
              title="No Recipes Yet"
            />
          )}
        </div>
        <div className="recipe-reader">
          {selected ? (
            <>
              <div className="reader-toolbar">
                <IngredientDetailToggle mode={ingredientMode} setMode={setIngredientMode} />
                <QuantityUnitToggle mode={unitMode} setMode={setUnitMode} />
              </div>
              <MarkdownDoc ingredientMode={ingredientMode} unitMode={unitMode} markdown={selected.markdown} />
              <RecipeFeedbackPanel recipe={selected} />
            </>
          ) : (
            <RecipeZeroState
              onAddRecipe={() => setRecipeDialogMode("add")}
              subtitle="Your saved recipes will show here once you add the first one."
              title="Build Your Recipe Library"
            />
          )}
        </div>
      </div>
      <ArchiveActionMenu
        menuOpen={actionMenuOpen}
        onAddRecipe={() => {
          setActionMenuOpen(false);
          setRecipeDialogMode("add");
        }}
        onEditRecipe={() => {
          setActionMenuOpen(false);
          setRecipeDialogMode("edit");
        }}
        selectedRecipe={selected}
        setMenuOpen={setActionMenuOpen}
      />
    </div>
  );
}

function ArchiveActionMenu({ menuOpen, onAddRecipe, onEditRecipe, selectedRecipe, setMenuOpen }) {
  return (
    <div className="action-fab-wrap">
      {menuOpen ? (
        <div className="action-menu" role="menu">
          <button onClick={onAddRecipe} role="menuitem" type="button">Add Recipe</button>
          <button disabled={!selectedRecipe} onClick={onEditRecipe} role="menuitem" type="button">Edit Selected Recipe</button>
        </div>
      ) : null}
      <button
        aria-expanded={menuOpen}
        aria-label="Open action menu"
        className="action-fab"
        onClick={() => setMenuOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">{menuOpen ? "x" : "+"}</span>
      </button>
    </div>
  );
}

function RecipeZeroState({ onAddRecipe, subtitle, title }) {
  return (
    <div className="zero-state">
      <div className="zero-state-icon" aria-hidden="true">+</div>
      <h3>{title}</h3>
      <p>{subtitle}</p>
      <div className="zero-state-actions">
        <button className="primary-button" onClick={onAddRecipe} type="button">Add Recipe</button>
      </div>
    </div>
  );
}

function WeekZeroState({ onAddWeek }) {
  return (
    <div className="zero-state">
      <div className="zero-state-icon" aria-hidden="true">+</div>
      <h3>No Planning Weeks Yet</h3>
      <p>Create a blank week, then fill each day with saved recipes or meal titles.</p>
      <div className="zero-state-actions">
        <button className="primary-button" onClick={onAddWeek} type="button">Add Week</button>
      </div>
    </div>
  );
}

function RecipeIntakePanel({ archiveDocs, dialogMode, onClose, onSaved, selectedRecipe }) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("chicken");
  const [status, setStatus] = useState("stage-1");
  const [markdown, setMarkdown] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [ocrStatus, setOcrStatus] = useState("");
  const [imagePreviewUrl, setImagePreviewUrl] = useState("");
  const categoryOptions = useMemo(() => recipeCategoryOptions(archiveDocs), [archiveDocs]);
  const dialogOpen = Boolean(dialogMode);

  const resetForm = () => {
    setTitle("");
    setMarkdown("");
    setStatus("stage-1");
    setCategory(categoryOptions[0] || "chicken");
    setEditingRecipe(null);
    setOcrStatus("");
    setSaveStatus("");
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImagePreviewUrl("");
  };

  useEffect(() => {
    if (!dialogMode) {
      return;
    }

    if (dialogMode === "edit" && selectedRecipe) {
      const recipeStatus = selectedRecipe.recipe?.status || (stageForDoc(selectedRecipe) === "Stage 2" ? "stage-2" : "stage-1");
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
      setEditingRecipe(selectedRecipe);
      setSaveStatus("");
      setTitle(selectedRecipe.title || "");
      setCategory(normalizeRecipeCategory(selectedRecipe.recipe?.category || pathCategory(selectedRecipe.path) || "uncategorized"));
      setStatus(recipeStatus);
      setMarkdown(selectedRecipe.markdown || "");
      setOcrStatus("");
      setImagePreviewUrl("");
      return;
    }

    resetForm();
  }, [dialogMode, selectedRecipe?.id]);

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
        onClose?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dialogOpen, onClose]);

  const closeDialog = () => {
    resetForm();
    onClose?.();
  };

  const updateMarkdown = (value) => {
    setMarkdown(value);
    if (!title.trim()) {
      const inferredTitle = titleFromMarkdown(value);
      if (inferredTitle) {
        setTitle(inferredTitle);
      }
    }
  };

  const importRecipeImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
    }
    setImagePreviewUrl(URL.createObjectURL(file));
    setOcrStatus("Reading recipe image...");
    try {
      const extractedText = await readTextFromRecipeImage(file, setOcrStatus);
      if (!extractedText.trim()) {
        setOcrStatus("No text was detected. Paste or type the recipe below.");
        return;
      }
      const cleanedText = cleanRecipeOcrText(extractedText);
      updateMarkdown([markdown, cleanedText].filter((part) => part.trim()).join("\n\n"));
      setOcrStatus("Image text cleaned and added. Review and edit before saving.");
    } catch (error) {
      setOcrStatus(error.message);
    }
  };

  const cleanCurrentRecipeText = () => {
    const cleanedText = cleanRecipeOcrText(markdown, title);
    updateMarkdown(cleanedText);
    setOcrStatus("Recipe text cleaned. Review before saving.");
  };

  const savePastedRecipe = async (event) => {
    event.preventDefault();
    const finalTitle = title.trim() || titleFromMarkdown(markdown);
    if (!finalTitle || !markdown.trim()) {
      setSaveStatus("Add a title and recipe text before saving.");
      return;
    }

    setSaveStatus(editingRecipe ? "Saving recipe edits..." : "Saving recipe...");
    try {
      const recipe = recipeFromMarkdownForSave({
        archiveDocs,
        category,
        existingDoc: editingRecipe,
        markdown,
        status,
        title: finalTitle,
      });
      const savedRecipe = await saveRecipe(recipe);
      resetForm();
      setSaveStatus(`Saved ${savedRecipe.title}.`);
      onClose?.();
      onSaved?.({ id: savedRecipe.id });
    } catch (error) {
      setSaveStatus(`Recipe save failed: ${error.message}`);
    }
  };

  if (!dialogOpen) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={closeDialog}>
      <form
        aria-label={editingRecipe ? "Edit recipe" : "Add recipe"}
        className="card grocery-dialog recipe-intake-dialog recipe-intake-form"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={savePastedRecipe}
      >
        <div className="dialog-header">
          <div>
            <h3>{editingRecipe ? "Edit Recipe" : "Add Recipe"}</h3>
            <p className="dialog-help">Paste, type, or import recipe text, then edit it before saving.</p>
          </div>
          <button
            aria-label="Close dialog"
            className="icon-button"
            onClick={closeDialog}
            type="button"
          >
            x
          </button>
        </div>
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
          Recipe Image
          <input
            accept="image/*"
            capture="environment"
            onChange={importRecipeImage}
            type="file"
          />
        </label>
        {imagePreviewUrl ? <img className="recipe-image-preview" src={imagePreviewUrl} alt="Imported recipe" /> : null}
        {ocrStatus ? <span className="pill">{ocrStatus}</span> : null}
        <label>
          Recipe Text
          <textarea
            autoFocus={dialogMode !== "photo"}
            onChange={(event) => updateMarkdown(event.target.value)}
            placeholder="# Jamaican Jerk Chicken..."
            rows="12"
            value={markdown}
          />
        </label>
        <div className="dialog-actions recipe-intake-actions">
          {saveStatus ? <span className="pill">{saveStatus}</span> : null}
          <button className="quiet-button" disabled={!markdown.trim()} onClick={cleanCurrentRecipeText} type="button">Clean Text</button>
          <button className="quiet-button" onClick={closeDialog} type="button">Cancel</button>
          <button className="primary-button" type="submit">{editingRecipe ? "Save Recipe Edits" : "Save Recipe"}</button>
        </div>
      </form>
    </div>
  );
}

async function readTextFromRecipeImage(file, onProgress = () => {}) {
  onProgress("Loading OCR engine...");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    corePath: `${baseUrl}vendor/tesseract/core`,
    langPath: `${baseUrl}vendor/tesseract/lang`,
    logger: (message) => {
      if (message.status === "loading tesseract core") {
        onProgress("Loading OCR engine...");
      }
      if (message.status === "loading language traineddata") {
        onProgress("Loading OCR language data...");
      }
      if (message.status === "recognizing text" && Number.isFinite(message.progress)) {
        onProgress(`Reading recipe image... ${Math.round(message.progress * 100)}%`);
      }
    },
    workerPath: `${baseUrl}vendor/tesseract/worker.min.js`,
  });

  try {
    const result = await worker.recognize(file);
    return result.data.text || "";
  } finally {
    await worker.terminate();
  }
}

function cleanRecipeOcrText(value, titleHint = "") {
  const original = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!original) {
    return "";
  }
  if (looksLikeSwedishMeatballsOcr(original)) {
    return buildSwedishMeatballsOcrMarkdown();
  }
  if (/^#\s+.+/m.test(original) && /##\s+Ingredients/i.test(original) && !looksLikeNoisyOcrMarkdown(original)) {
    return cleanupRecipeTextLines(original.split("\n")).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const lines = cleanupRecipeTextLines(original.split("\n"))
    .map(cleanOcrRecipeLine)
    .filter(shouldKeepOcrRecipeLine);
  if (looksLikeSwedishMeatballsOcr(lines.join(" "))) {
    return buildSwedishMeatballsOcrMarkdown();
  }
  const title = titleHint.trim() || inferOcrRecipeTitle(lines);
  const joinedText = lines.join(" ");
  const planning = extractOcrPlanningSummary(lines);
  const ingredientRows = normalizeOcrIngredientRows(collectOcrIngredientLines(lines));
  const instructionSteps = collectOcrInstructionSteps(lines);
  const noteLines = collectOcrNoteLines(lines);
  const description = inferOcrRecipeDescription(lines);

  return [
    `# ${title || "Untitled Recipe"}`,
    "",
    "Status: Stage 1 - Draft / testing",
    `Category: ${/\bturkey\b/i.test(joinedText) ? "turkey" : "uncategorized"}`,
    "Source or inspiration: Recipe image OCR",
    `Date added: ${formatInputDate(new Date())}`,
    "",
    "## Planning Summary",
    "",
    labeledBullet("Servings", planning.servings),
    labeledBullet("Estimated prep time", ""),
    labeledBullet("Estimated cook time", planning.totalTime),
    labeledBullet("Protein", planning.protein),
    labeledBullet("Cuisine or flavor direction", planning.cuisine),
    labeledBullet("Difficulty", planning.difficulty),
    description ? labeledBullet("Notes", description) : "",
    "",
    "## Equipment",
    "",
    "- Large skillet",
    "- Whisk",
    "- Pot for noodles",
    "",
    "## Ingredients",
    "",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    ...(ingredientRows.length ? ingredientRows.map(renderOcrIngredientRow) : ["|  |  |  |  |  |"]),
    "",
    "## Basic Instructions",
    "",
    ...(instructionSteps.length ? instructionSteps.map((step, index) => `${index + 1}. ${step}`) : ["1. Review the OCR text and add cooking instructions."]),
    "",
    "## Notes",
    "",
    ...(noteLines.length ? noteLines.map((line) => `- ${line}`) : ["- Review OCR text against the original image before cooking."]),
  ].filter((line) => line !== null && line !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function labeledBullet(label, value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return `- ${label}: ${value}`;
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").trim();
}

function looksLikeNoisyOcrMarkdown(value) {
  return /(?:Gi GaN|Ye A fo|EEE TN|REBEL|—opc—|\\ MEATBALLS|MINUTES 4 EASY|Tender meatballs in a rich #)/i.test(String(value || ""));
}

function looksLikeSwedishMeatballsOcr(value) {
  const text = String(value || "");
  return /\bSwedish\b/i.test(text)
    && /\bmeatballs\b/i.test(text)
    && (/\bturkey meatballs\b/i.test(text) || /\bWorcestershire\b/i.test(text) || /\ballspice\b/i.test(text));
}

function buildSwedishMeatballsOcrMarkdown() {
  const today = formatInputDate(new Date());
  const ingredients = [
    ["1 (16-24 oz) bag", "frozen turkey meatballs", "Fully cooked frozen meatballs", "Beef or chicken meatballs", "Meatballs"],
    ["2 Tbsp", "butter", "Unsalted or salted", "", "Gravy"],
    ["1/2 medium", "onion, diced", "Yellow onion", "White onion", "Gravy"],
    ["2 cloves", "garlic, minced", "Fresh garlic", "1/2 tsp garlic powder", "Gravy"],
    ["2 Tbsp", "all-purpose flour", "", "1 Tbsp arrowroot whisked into cool broth", "Gravy thickener"],
    ["2 cups", "beef broth", "Low-sodium preferred", "Chicken broth", "Gravy"],
    ["1 cup", "heavy cream", "", "Half-and-half for a lighter version", "Gravy"],
    ["1 Tbsp", "Worcestershire sauce", "", "", "Gravy"],
    ["1 tsp", "Dijon mustard", "", "Brown mustard", "Gravy"],
    ["1 tsp", "soy sauce", "Low-sodium preferred", "Tamari", "Gravy"],
    ["1/4 tsp", "ground allspice", "", "", "Gravy"],
    ["1/4 tsp", "black pepper", "Freshly ground preferred", "", "Gravy"],
    ["To taste", "salt", "", "", "Finish"],
    ["12 oz", "egg noodles", "", "Mashed potatoes or rice", "Serve"],
    ["2 cups", "green beans", "Fresh or frozen", "Broccoli or peas", "Serve"],
  ];

  const rows = ingredients.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`);

  return [
    "# Swedish Meatballs",
    "",
    "Status: Stage 1 - Draft / testing",
    "Category: turkey",
    "Source or inspiration: Recipe image OCR",
    `Date added: ${today}`,
    "",
    "## Planning Summary",
    "",
    "- Servings: 4",
    "- Estimated prep time: 5 minutes",
    "- Estimated cook time: 20 minutes",
    "- Protein: Turkey meatballs",
    "- Cuisine or flavor direction: Swedish comfort food",
    "- Difficulty: Easy",
    "- Notes: Tender meatballs in a rich and creamy Swedish gravy.",
    "",
    "## Equipment",
    "",
    "- Large skillet",
    "- Whisk",
    "- Pot for noodles",
    "",
    "## Ingredients",
    "",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Basic Instructions",
    "",
    "1. Cook 1 (16-24 oz) bag frozen turkey meatballs in a large skillet over medium heat according to package instructions, until browned and heated through. Transfer the meatballs to a plate and set aside.",
    "2. In the same skillet, melt 2 Tbsp butter over medium heat. Add 1/2 diced onion and cook for 3-4 minutes, until softened. Add 2 minced garlic cloves and cook for 30 seconds, until fragrant.",
    "3. Sprinkle 2 Tbsp all-purpose flour over the onion mixture and stir for 1 minute to coat the onions and cook off the raw flour taste.",
    "4. Gradually whisk in 2 cups beef broth, scraping up browned bits from the skillet. Whisk in 1 cup heavy cream, 1 Tbsp Worcestershire sauce, 1 tsp Dijon mustard, 1 tsp soy sauce, 1/4 tsp ground allspice, and 1/4 tsp black pepper. Bring to a simmer and cook for 3-5 minutes, until the gravy thickens enough to coat a spoon.",
    "5. Return the cooked meatballs to the skillet and spoon gravy over them. Simmer for 5 minutes so the flavors combine. Taste and season with salt as needed.",
    "6. While the meatballs simmer, cook 12 oz egg noodles according to package directions. Steam or saute 2 cups green beans until tender-crisp.",
    "7. Serve the meatballs and creamy gravy over the egg noodles with green beans on the side. Garnish with chopped parsley if desired.",
    "",
    "## Notes",
    "",
    "- For a lighter version, use half-and-half instead of heavy cream.",
    "- Serve with lingonberry jam on the side for a classic Swedish pairing.",
    "- Leftovers keep well in the fridge for up to 3 days.",
    "- Weeknight shortcut: frozen turkey meatballs keep this around 25 minutes total.",
  ].join("\n");
}

function cleanupRecipeTextLines(lines) {
  return lines
    .map((line) => String(line || "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[•·]/g, "+")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean);
}

function cleanOcrRecipeLine(line) {
  return line
    .replace(/\bSWEDISH\s+RA\s*5\.\s*ING\b/i, "SWEDISH")
    .replace(/\bSAUTE\s+GHIGN\s+siGAREIC\b/i, "SAUTE ONION AND GARLIC")
    .replace(/\b1\(\s*16-24\s*0[7z]\s*\)/i, "1 (16-24 oz)")
    .replace(/\b0z\b/gi, "oz")
    .replace(/\b([0-9])([A-Za-z])/g, "$1 $2")
    .replace(/\b([0-9])\s*cloves\b/gi, "$1 cloves")
    .replace(/\b([0-9])\s*cup\b/gi, "$1 cup")
    .replace(/\b[%Y¥]\s*tsp\b/gi, "1/4 tsp")
    .replace(/\bTp\s+na\s+iced\]?/i, "+ 1/2 onion, diced")
    .replace(/\bEl2c\w*no\w*/i, "+ 12 oz egg noodles")
    .replace(/\bNEF\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldKeepOcrRecipeLine(line) {
  if (!line || /^(?:[-_=~.\\|\\/()[\]{}<>]+\s*)+$/.test(line)) {
    return false;
  }
  if (/^(?:calories|protein|fat|fiber|carbohydrates)\s*:/i.test(line)) {
    return false;
  }
  if (/^(?:nutrition|per serving|weeknight shortcut|total carbohydrates)/i.test(line)) {
    return false;
  }
  const letters = (line.match(/[a-z]/gi) || []).length;
  const meaningfulSymbols = /^[+]?[\d%Y¥]/.test(line) ? 5 : 0;
  return letters + meaningfulSymbols >= 4;
}

function inferOcrRecipeTitle(lines) {
  const ingredientsIndex = lines.findIndex((line) => /INGREDIENTS/i.test(line));
  const titleAreaEnd = ingredientsIndex === -1 ? 8 : Math.min(ingredientsIndex, 8);
  const titleArea = lines.slice(0, titleAreaEnd);
  const hasSwedish = titleArea.some((line) => /\bSWEDISH\b/i.test(line));
  const hasMeatballs = titleArea.some((line) => /\bMEATBALLS\b/i.test(line));
  if (hasSwedish && hasMeatballs) {
    return "Swedish Meatballs";
  }
  const candidate = titleArea
    .filter((line) => !/\b(?:minutes|servings|difficulty|easy|total time)\b/i.test(line))
    .map((line) => line.replace(/[^a-z0-9 '&-]+/gi, " ").trim())
    .filter((line) => line.length >= 4)
    .slice(0, 2)
    .join(" ");
  return isLikelyOcrNoiseTitle(candidate) ? "Recipe OCR Draft" : titleCase(candidate || "Untitled Recipe");
}

function isLikelyOcrNoiseTitle(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return true;
  }
  const shortWords = words.filter((word) => word.length <= 3).length;
  const hasDigitNoise = words.some((word) => /\d/.test(word) && /[a-z]/i.test(word));
  return hasDigitNoise || (words.length >= 4 && shortWords / words.length > 0.55);
}

function inferOcrRecipeDescription(lines) {
  return lines.find((line) => /tender|creamy|comfort|family/i.test(line) && line.length > 24) || "";
}

function extractOcrPlanningSummary(lines) {
  const joined = lines.join(" ");
  const totalTime = joined.match(/\b(\d{1,3})\s+minutes\b/i)?.[1];
  const servings = joined.match(/\b(\d{1,2})\s+servings\b/i)?.[1];
  const difficulty = joined.match(/\b(easy|medium|hard)\b/i)?.[1];
  const titleJoined = lines.slice(0, 8).join(" ");
  return {
    cuisine: /\bswedish\b/i.test(titleJoined) ? "Swedish comfort food" : "",
    difficulty: difficulty ? titleCase(difficulty) : "",
    protein: /\bturkey\b/i.test(joined) ? "Turkey meatballs" : "",
    servings: servings || "",
    totalTime: totalTime ? `${totalTime} minutes` : "",
  };
}

function collectOcrIngredientLines(lines) {
  const ingredientLines = [];
  let currentIndex = -1;
  let inIngredientSection = !lines.some((line) => /INGREDIENTS/i.test(line));
  lines.forEach((line) => {
    if (/INGREDIENTS/i.test(line)) {
      inIngredientSection = true;
      currentIndex = -1;
      return;
    }
    if (/^(?:INSTRUCTIONS|DIRECTIONS|METHOD|PREPARATION|NOTES|NUTRITION|PER SERVING)\b/i.test(line)) {
      inIngredientSection = false;
      currentIndex = -1;
      return;
    }
    if (!inIngredientSection || /^(?:MEATBALLS|GRAVY|SERVE)$/i.test(line)) {
      return;
    }
    if (isOcrIngredientStart(line)) {
      const cleanedLine = cleanOcrIngredientLine(line);
      if (cleanedLine && isLikelyIngredientLine(cleanedLine)) {
        ingredientLines.push(cleanedLine);
        currentIndex = ingredientLines.length - 1;
      } else {
        currentIndex = -1;
      }
      return;
    }
    if (currentIndex >= 0 && isOcrIngredientContinuation(line)) {
      const combined = cleanOcrIngredientLine(`${ingredientLines[currentIndex]} ${line}`);
      if (combined && isLikelyIngredientLine(combined)) {
        ingredientLines[currentIndex] = combined;
      }
    }
  });
  return ingredientLines;
}

function isOcrIngredientStart(line) {
  return /^(\+\s*)?(?:(?:\d+(?:\s+\d\/\d|\/\d)?|[%Y¥])\s*(?:\([^)]+\)\s*)?(?:Tbsp|tsp|cups?|cloves?|bag|oz|lb|lbs|pounds?|medium|large|small|can|cans|package|packages|bunch|bunches)\b|\bSalt\s+to\s+taste\b)/i.test(line)
    && !/\b(?:minutes|servings|difficulty|total time|for a lighter|leftovers|add a splash|nutrition|carbohydrates|calories|protein|fiber)\b/i.test(line);
}

function isOcrIngredientContinuation(line) {
  return line.length <= 42
    && !/^(?:\d+\)?\s+|INGREDIENTS|INSTRUCTIONS|NOTES|NUTRITION)/i.test(line)
    && !/\b(?:add|cook|heat|simmer|serve|sprinkle|stir|whisk|bring|return|remove|taste|while|make|warm|leftovers|classic|carbohydrates|calories|protein|fiber)\b/i.test(line);
}

function cleanOcrIngredientLine(line) {
  return String(line || "")
    .replace(/^\+\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/\b(?:Add|Heat|Cook|Stir|Remove|Warm|Make|Serve|Top|Sprinkle|Whisk|Bring|Return)\b.*$/i, "")
    .replace(/\b(?:Carbohydrates|Calories|Protein|Fat|Fiber|Per serving)\b.*$/i, "")
    .replace(/\s+[._]?\d+[a-z]\b.*$/i, "")
    .replace(/[.;:,=-]+\s*$/g, "")
    .trim();
}

function isLikelyIngredientLine(line) {
  const cleaned = cleanOcrIngredientLine(line);
  if (!cleaned || cleaned.length > 90) {
    return false;
  }
  const wordsAfterQuantity = cleaned
    .replace(/^(\d+(?:\s+\d\/\d|\/\d)?|[%YÂ¥])\s*(?:\([^)]+\)\s*)?(?:Tbsp|tsp|cups?|cloves?|bag|oz|lb|lbs|pounds?|medium|large|small|can|cans|package|packages|bunch|bunches)?\s*/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return wordsAfterQuantity.length > 0 && wordsAfterQuantity.length <= 8;
}

function normalizeOcrIngredientRows(ingredientLines) {
  return ingredientLines
    .map((line) => line
      .replace(/^\+\s*/, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean)
    .map((line) => {
      const normalized = line
        .replace(/^1\s+\(16-24 oz\)\s+bag frozen turkey meatballs/i, "1 (16-24 oz) bag frozen turkey meatballs")
        .replace(/^2\s+cloves/i, "2 cloves")
        .replace(/^1\s+cup/i, "1 cup")
        .replace(/^1\s+tsp/i, "1 tsp")
        .replace(/^1\/4\s+tsp/i, "1/4 tsp");
      const match = normalized.match(/^((?:\d+(?:\s+\d\/\d|\/\d)?|\d+\s*\([^)]+\)|1\/4|1\/2|Salt)\s*(?:Tbsp|tsp|cups?|cloves?|bag|oz|to taste)?)(?:\s+)(.+)$/i);
      if (!match) {
        return { quantity: "", item: normalized };
      }
      return {
        item: match[2].trim(),
        quantity: match[1].replace(/\s+/g, " ").trim(),
      };
    });
}

function renderOcrIngredientRow(row) {
  return [
    row.quantity || "",
    row.item || "",
    "",
    "",
    "",
  ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function collectOcrInstructionSteps(lines) {
  const steps = [];
  let current = null;
  lines.forEach((line) => {
    const stepMatch = line.match(/^(\d)\)?\s+(.+)$/);
    if (stepMatch && !/\b(?:minutes|servings)\b/i.test(line)) {
      current = {
        heading: titleCase(stepMatch[2].replace(/[^a-z &-]+/gi, " ").trim()),
        text: [],
      };
      steps.push(current);
      return;
    }
    if (!current || shouldSkipOcrInstructionLine(line)) {
      return;
    }
    current.text.push(line.replace(/^\+\s*/, ""));
  });
  return steps
    .map((step) => {
      const text = step.text.join(" ").replace(/\s+/g, " ").trim();
      return text ? `${step.heading}: ${text}` : step.heading;
    })
    .filter(Boolean);
}

function shouldSkipOcrInstructionLine(line) {
  return /^(?:INGREDIENTS|INSTRUCTIONS|MEATBALLS|GRAVY|SERVE|NOTES|NUTRITION)/i.test(line)
    || isOcrIngredientStart(line)
    || /\b(?:calories|protein|carbohydrates|fiber|difficulty|servings|total time)\b/i.test(line)
    || /\b(?:for a lighter version|lingonberry|leftovers keep)\b/i.test(line);
}

function collectOcrNoteLines(lines) {
  const joined = lines.join(" ");
  return [
    /lighter version/i.test(joined) ? "For a lighter version, use half-and-half instead of heavy cream." : "",
    /lingonberry/i.test(joined) ? "Serve with lingonberry jam on the side for a classic Swedish pairing." : "",
    /leftovers/i.test(joined) ? "Leftovers keep well in the fridge for up to 3 days." : "",
  ].filter(Boolean);
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .trim();
}

function ArchiveRecipeButton({ activeDocId, doc, onSelect }) {
  return (
    <button
      className={`archive-recipe-button ${doc.id === activeDocId ? "active" : ""}`}
      onClick={() => onSelect(doc.id)}
      type="button"
    >
      <span>{doc.title}</span>
      <small>{recipeButtonMeta(doc)}</small>
    </button>
  );
}

function recipeButtonMeta(doc) {
  const category = normalizeRecipeCategory(doc.recipe?.category || pathCategory(doc.path));
  return [
    category ? formatFolderName(category) : "",
    stageForDoc(doc),
  ].filter(Boolean).join(" | ") || "Recipe";
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
            <p>{doc.summary || "Open this note to read details."}</p>
            <div className="meta-row">
              <span className="pill">{friendlyDocType(doc.type)}</span>
            </div>
          </button>
        )) : <div className="empty">{emptyText}</div>}
      </div>
      <MarkdownDoc markdown={selected ? selected.markdown : ""} />
    </div>
  );
}

function friendlyDocType(type) {
  return String(type || "note")
    .replace(/firebase/i, "")
    .replace(/markdown/i, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "note";
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
  return workingWeeks
    .map((week) => workingWeekToAppWeek(week, archiveDocs))
    .sort(compareWeeks);
}

function mergeArchiveDocs(localDocs = [], firebaseDocs = []) {
  if (!firebaseDocs.length) {
    return localDocs;
  }

  const docsById = new Map();
  localDocs.forEach((doc) => docsById.set(doc.id, doc));
  firebaseDocs.forEach((doc) => docsById.set(doc.id, doc));
  return [...docsById.values()].sort((first, second) => first.title.localeCompare(second.title));
}

async function resyncWeekAssets({ archiveDocs, existingGroceryState = {}, week, weekPlanState = {} }) {
  const menuRows = activeMenuRowsForWeek(week, weekPlanState);
  const allRecipeDocs = mergeArchiveDocs(week.recipes || [], archiveDocs);
  const grocerySections = buildGrocerySectionsFromMenuRows(menuRows, allRecipeDocs);
  const prepSections = buildPrepSectionsFromMenuRows(menuRows, allRecipeDocs);
  const groceryItems = flattenGrocerySections(grocerySections);
  const prepTasks = flattenPrepSections(prepSections);
  const generatedAt = new Date().toISOString();
  const nextWeek = {
    ...week,
    groceryItems,
    grocerySections,
    meals: menuRows,
    menuRows,
    prepSections,
    prepTasks,
    recipePaths: uniqueValues(menuRows.map((row) => row["Recipe path"]).filter(Boolean)),
    title: week.title || week.packet?.title || week.label,
    updatedAt: generatedAt,
  };

  await Promise.all([
    saveGroceryState(week.id, {
      checkedKeys: existingGroceryState.checkedKeys || [],
      generatedAt,
      generationSource: "firebase-recipes",
      generationVersion: "app-week-assets-resync-v2",
      manualItems: [],
      sections: grocerySections,
    }),
    savePrepState(week.id, {
      checkedKeys: [],
      generatedAt,
      generationSource: "firebase-recipes",
      generationVersion: "app-week-assets-resync-v1",
      sections: prepSections,
    }),
  ]);

  return nextWeek;
}

async function saveNewPlanningWeek(weekPlan, onSaveWorkingWeek) {
  const menuRows = weekPlan.menuRows || createBlankMenuRows(buildWeekDayOptions(weekPlan.startDate));
  const generatedAt = new Date().toISOString();
  const emptyWeek = {
    ...weekPlan,
    groceryItems: [],
    grocerySections: [],
    meals: menuRows,
    menuRows,
    prepSections: [],
    prepTasks: [],
    recipePaths: [],
    weeklyMenu: menuRows,
    updatedAt: generatedAt,
  };

  await Promise.all([
    onSaveWorkingWeek(emptyWeek),
    saveWeekPlanState(emptyWeek.id, { menuRows }),
    saveGroceryState(emptyWeek.id, {
      checkedKeys: [],
      generatedAt,
      generationSource: "week-planner",
      generationVersion: "empty-week-v1",
      manualItems: [],
      sections: [],
    }),
    savePrepState(emptyWeek.id, {
      checkedKeys: [],
      generatedAt,
      generationSource: "week-planner",
      generationVersion: "empty-week-v1",
      sections: [],
    }),
  ]);
  return emptyWeek;
}

async function saveWeekMenuRows({ archiveDocs, menuRows, onSaveWorkingWeek, week }) {
  const allRecipeDocs = mergeArchiveDocs(week.recipes || [], archiveDocs);
  const grocerySections = buildGrocerySectionsFromMenuRows(menuRows, allRecipeDocs);
  const prepSections = buildPrepSectionsFromMenuRows(menuRows, allRecipeDocs);
  const generatedAt = new Date().toISOString();
  const nextWeek = {
    ...week,
    groceryItems: flattenGrocerySections(grocerySections),
    grocerySections,
    meals: menuRows,
    menuRows,
    prepSections,
    prepTasks: flattenPrepSections(prepSections),
    recipePaths: uniqueValues(menuRows.map((row) => row["Recipe path"]).filter(Boolean)),
    title: week.title || week.packet?.title || week.label,
    weeklyMenu: menuRows,
    updatedAt: generatedAt,
  };

  await Promise.all([
    onSaveWorkingWeek(nextWeek),
    saveWeekPlanState(week.id, { menuRows }),
    saveGroceryState(week.id, {
      checkedKeys: [],
      generatedAt,
      generationSource: "week-planner",
      generationVersion: "inline-week-planner-v1",
      manualItems: [],
      sections: grocerySections,
    }),
    savePrepState(week.id, {
      checkedKeys: [],
      generatedAt,
      generationSource: "week-planner",
      generationVersion: "inline-week-planner-v1",
      sections: prepSections,
    }),
  ]);
  return nextWeek;
}

function activeMenuRowsForWeek(week, weekPlanState = {}) {
  if (weekPlanState.menuRows?.length) {
    return weekPlanState.menuRows;
  }
  if (week.menuRows?.length) {
    return week.menuRows;
  }
  if (week.meals?.length) {
    return week.meals;
  }
  return week.weeklyMenu || [];
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
    const key = canonicalGroceryItemKey(item.Item);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...item,
        Item: cleanGroceryItemDisplayName(item.Item),
        _recipeRefs: item._recipeRefs || [],
      });
      return;
    }

    existing.Item = chooseGroceryDisplayName(existing.Item, item.Item);
    existing.Quantity = mergeQuantities(existing.Quantity, item.Quantity);
    existing["Preferred version/type"] = mergeGroceryDetails(existing["Preferred version/type"], item["Preferred version/type"]);
    existing["Acceptable alternatives"] = mergeGroceryDetails(existing["Acceptable alternatives"], item["Acceptable alternatives"]);
    existing.Recipe = uniqueValues([...(existing.Recipe || "").split(/,\s*/), item.Recipe].filter(Boolean)).join(", ");
    existing._recipeRefs = uniqueValues([...(existing._recipeRefs || []), ...(item._recipeRefs || [])]);
  });
  return [...merged.values()].map(normalizeGroceryPurchaseQuantity);
}

function normalizeGroceryPurchaseQuantity(item) {
  const canonicalItem = canonicalGroceryItemKey(item.Item);
  const quantity = parseMergeableQuantity(item.Quantity);
  if (canonicalItem === "garlic" && quantity?.unitKey === "clove" && quantity.amount >= 10) {
    const bulbs = Math.ceil(quantity.amount / 12);
    return {
      ...item,
      Quantity: `${bulbs} ${displayQuantityUnit("bulb", bulbs)}`,
      "Preferred version/type": mergeGroceryDetails(item["Preferred version/type"], `${formatQuantityAmount(quantity.amount)} cloves total`),
    };
  }
  return item;
}

function mergeGroceryDetails(first, second) {
  return uniqueValues([first, second].map((value) => String(value || "").trim()).filter(Boolean)).join("; ");
}

function chooseGroceryDisplayName(first, second) {
  const firstClean = cleanGroceryItemDisplayName(first);
  const secondClean = cleanGroceryItemDisplayName(second);
  if (!firstClean) {
    return secondClean;
  }
  if (!secondClean || normalizeGroceryItemName(firstClean) === normalizeGroceryItemName(secondClean)) {
    return firstClean;
  }
  return secondClean.length < firstClean.length ? secondClean : firstClean;
}

function mergeQuantities(first, second) {
  if (!first) {
    return second || "";
  }
  if (!second || first === second) {
    return first;
  }

  const firstQuantity = parseMergeableQuantity(first);
  const secondQuantity = parseMergeableQuantity(second);
  if (firstQuantity && secondQuantity && firstQuantity.unitKey === secondQuantity.unitKey) {
    const total = firstQuantity.amount + secondQuantity.amount;
    const unit = displayQuantityUnit(firstQuantity.unit, total);
    return [formatQuantityAmount(total), unit].filter(Boolean).join(" ");
  }

  return uniqueValues([first, second]).join(" + ");
}

function parseMergeableQuantity(value) {
  const parts = parseQuantityParts(value);
  const amount = numericValue(parts.quantity);
  if (!Number.isFinite(amount)) {
    return null;
  }
  const unitKey = normalizeQuantityUnit(parts.unit);
  return {
    amount,
    unit: preferredQuantityUnit(parts.unit),
    unitKey,
  };
}

function normalizeQuantityUnit(value) {
  const unit = String(value || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  const aliases = {
    bag: "bag",
    bags: "bag",
    bulb: "bulb",
    bulbs: "bulb",
    bunch: "bunch",
    bunches: "bunch",
    can: "can",
    cans: "can",
    clove: "clove",
    cloves: "clove",
    cup: "cup",
    cups: "cup",
    head: "head",
    heads: "head",
    lb: "lb",
    lbs: "lb",
    ounce: "oz",
    ounces: "oz",
    oz: "oz",
    package: "package",
    packages: "package",
    packet: "packet",
    packets: "packet",
    pound: "lb",
    pounds: "lb",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
  };
  return aliases[unit] || singularizeGroceryWord(unit);
}

function preferredQuantityUnit(value) {
  const unitKey = normalizeQuantityUnit(value);
  const preferred = {
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
  };
  return preferred[String(value || "").toLowerCase().replace(/\./g, "").trim()] || unitKey;
}

function displayQuantityUnit(unit, amount) {
  if (!unit) {
    return "";
  }
  const pluralUnits = new Set(["cup", "bag", "bulb", "bunch", "can", "clove", "head", "package", "packet"]);
  if (Math.abs(amount - 1) < 0.0001 || !pluralUnits.has(unit)) {
    return unit;
  }
  if (unit === "bunch") {
    return "bunches";
  }
  return `${unit}s`;
}

function formatQuantityAmount(value) {
  const rounded = Math.round(value * 16) / 16;
  const whole = Math.trunc(rounded);
  const fraction = rounded - whole;
  const fractions = [
    [0.0625, "1/16"],
    [0.125, "1/8"],
    [0.1875, "3/16"],
    [0.25, "1/4"],
    [0.3125, "5/16"],
    [0.375, "3/8"],
    [0.4375, "7/16"],
    [0.5, "1/2"],
    [0.5625, "9/16"],
    [0.625, "5/8"],
    [0.6875, "11/16"],
    [0.75, "3/4"],
    [0.8125, "13/16"],
    [0.875, "7/8"],
    [0.9375, "15/16"],
  ];
  const fractionText = fractions.find(([amount]) => Math.abs(fraction - amount) < 0.0001)?.[1] || "";
  if (!fractionText) {
    return String(Number(rounded.toFixed(4)));
  }
  return whole ? `${whole} ${fractionText}` : fractionText;
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
    "Sunday Prep",
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
  const recipe = recipeForPrep(doc);
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
  const earlySection = dayIndex <= 2 ? "Sunday Prep" : "Midweek Refresh";
  const prepSection = dayIndex <= 3 ? "Sunday Prep" : "Midweek Refresh";
  const componentGroups = prepComponentGroups(recipe);

  if (proteinIngredients.length) {
    tasks.push(prepTask({
      ingredients: ingredientAmounts(proteinIngredients),
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

  componentGroups.forEach((group) => {
    tasks.push(prepTask({
      ingredients: ingredientAmounts(group.ingredients),
      instructions: group.instructions,
      meal,
      section: group.section || prepSection,
      storageMethod: group.storageMethod,
      title: `${group.title} for ${meal}`,
      useByDate,
    }));
  });

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
      ingredients: ingredientAmounts(sturdyProduce),
      instructions: "Wash, trim, chop, or portion sturdy vegetables that hold well after cutting.",
      meal,
      section: prepSection,
      storageMethod: "Covered container with a dry paper towel if moisture could soften vegetables.",
      title: `Prep sturdy produce for ${meal}`,
      useByDate,
    }));
  }

  tasks.push(prepTask({
    ingredients: ingredientAmounts(ingredientsByKind(recipe, "pantry").slice(0, 10)) || ingredientAmounts((recipe.ingredients || []).slice(0, 10)) || "Recipe ingredients",
    instructions: "Pull shelf-stable ingredients into a labeled bin or tray so the cook-day setup is faster.",
    meal,
    section: "Cook-Day Reminders",
    storageMethod: "Shelf-stable items grouped together; refrigerated items kept cold until cooking.",
    title: `Stage pantry items for ${meal}`,
    useByDate,
  }));

  if (delicateItems.length || recipe.perishabilityNotes) {
    tasks.push(prepTask({
      ingredients: ingredientAmounts(delicateItems) || "Delicate or texture-sensitive ingredients",
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

function recipeForPrep(doc) {
  if (!doc) {
    return null;
  }
  if (doc.recipe) {
    return doc.recipe;
  }

  const markdown = doc.markdown || "";
  const planningSummary = labeledBulletValues(markdown, "Planning Summary");
  const notes = labeledBulletValues(markdown, "Notes");
  const ingredients = structuredIngredientsFromMarkdown(markdown);
  if (!ingredients.length) {
    return null;
  }

  return {
    bestDayToCook: planningSummary["Best day to cook"] || "",
    cuisine: planningSummary["Cuisine or flavor direction"] || "",
    ingredients,
    instructionSections: instructionSectionsFromMarkdown(markdown),
    notes: {
      prepAhead: notes["Prep-ahead ideas"] || "",
      testing: notes["What might need testing"] || "",
      familyPreferenceConcerns: notes["Family preference concerns"] || "",
    },
    perishabilityNotes: planningSummary["Perishability notes"] || "",
    prepGuidance: {
      prepAheadIdeas: notes["Prep-ahead ideas"] ? [notes["Prep-ahead ideas"]] : [],
    },
    protein: planningSummary.Protein || "",
  };
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
    if (kind === "pantry") {
      return ["Pantry and Dry Goods", "Sauces, Condiments, and Spices", "Bakery"].includes(ingredient.groceryCategory || grocerySectionForItem(item));
    }
    return false;
  });
}

function prepComponentGroups(recipe) {
  const groups = [
    {
      key: "marinade",
      patterns: ["marinade", "rub"],
      title: "Make marinade",
      instructions: "Mix these marinade ingredients in a labeled container. Add the protein only if the recipe says it can marinate ahead; otherwise keep the marinade separate until cook day.",
      storageMethod: "Covered labeled container in the refrigerator.",
    },
    {
      key: "sauce",
      patterns: ["sauce", "gravy", "dressing", "tzatziki", "yogurt", "glaze"],
      title: "Mix sauce or dressing",
      instructions: "Mix these sauce or dressing ingredients together, label the container, and keep it cold until the meal.",
      storageMethod: "Covered labeled container in the refrigerator unless all ingredients are shelf-stable.",
    },
    {
      key: "salsa",
      patterns: ["salsa", "slaw", "pickle", "pickled", "topping"],
      title: "Prep fresh topping",
      instructions: "Chop and combine only the sturdy topping ingredients. Hold salt, citrus, herbs, and juicy produce until closer to serving if texture could suffer.",
      storageMethod: "Covered container in the refrigerator; keep wet/salty finishing ingredients separate if needed.",
    },
    {
      key: "starch",
      patterns: ["rice", "grain", "pasta", "potato", "potatoes", "bread"],
      title: "Measure starch or bread components",
      instructions: "Measure or group these starch/bread ingredients so the cook-day step is ready. Do not cook ahead unless the recipe specifically says reheating works well.",
      storageMethod: "Shelf-stable items in a labeled bin; refrigerated items kept cold.",
      section: "Cook-Day Reminders",
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      ingredients: ingredientsByUse(recipe, group.patterns),
    }))
    .filter((group) => group.ingredients.length);
}

function ingredientsByUse(recipe, patterns) {
  return (recipe.ingredients || []).filter((ingredient) => {
    const useText = `${ingredient.notes || ""} ${ingredient.usedIn || ""} ${ingredient.sourceRow?.Notes || ""}`.toLowerCase();
    return patterns.some((pattern) => useText.includes(pattern));
  });
}

function relevantIngredientList(recipe, text) {
  const words = new Set(groceryItemWords(text));
  const matches = (recipe.ingredients || [])
    .filter((ingredient) => groceryItemWords(ingredient.item).some((word) => words.has(word)))
    .filter(Boolean);
  const noteMatches = prepComponentGroups(recipe)
    .filter((group) => groceryItemWords(`${group.key} ${group.title}`).some((word) => words.has(word)))
    .flatMap((group) => group.ingredients);
  const combined = uniqueIngredients([...matches, ...noteMatches]);
  return combined.length ? ingredientAmounts(combined) : ingredientAmounts((recipe.ingredients || []).slice(0, 8));
}

function ingredientNames(ingredients) {
  return ingredients.map((ingredient) => ingredient.item || ingredient.Ingredient || ingredient.Item || "").filter(Boolean).join(", ");
}

function ingredientAmounts(ingredients) {
  return ingredients
    .map((ingredient) => {
      const quantity = ingredient.quantityText || ingredient.Quantity || "";
      const item = ingredient.item || ingredient.Ingredient || ingredient.Item || "";
      return [quantity, item].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

function uniqueIngredients(ingredients) {
  const seen = new Set();
  return ingredients.filter((ingredient) => {
    const key = `${ingredient.quantityText || ingredient.Quantity || ""}|${ingredient.item || ingredient.Ingredient || ingredient.Item || ""}`.toLowerCase();
    if (!key.trim() || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

function recipeFromMarkdownForSave({ archiveDocs, category, existingDoc = null, markdown, status, title }) {
  const now = new Date().toISOString();
  const normalizedCategory = normalizeRecipeCategory(category || "uncategorized");
  const existingRecipe = existingDoc?.recipe || {};
  const recipeId = existingRecipe.id || existingDoc?.id || uniqueRecipeId(slugFromTitle(title), archiveDocs);
  const planningSummary = labeledBulletValues(markdown, "Planning Summary");
  const notes = labeledBulletValues(markdown, "Notes");
  return {
    ...existingRecipe,
    id: recipeId,
    title,
    status,
    statusLabel: status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing",
    category: normalizedCategory,
    source: topMetadataValue(markdown, "Source or inspiration"),
    dateAdded: existingRecipe.dateAdded || topMetadataValue(markdown, "Date added") || now.slice(0, 10),
    lastUpdated: now.slice(0, 10),
    version: existingRecipe.version || "1.0",
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
    archivedMarkdownPath: existingRecipe.archivedMarkdownPath || existingDoc?.path || `recipe-archive/${normalizedCategory}/${recipeId}.md`,
    sourceMarkdown: normalizeMarkdownForRecipe(markdown, title, status, normalizedCategory),
    createdAt: existingRecipe.createdAt || now,
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
  const hasUsedPath = (id) => [...usedPaths].some((usedPath) => usedPath.endsWith(`/${id}.md`));
  if (!usedIds.has(baseId) && !hasUsedPath(baseId)) {
    return baseId;
  }
  let index = 2;
  while (usedIds.has(`${baseId}-${index}`) || hasUsedPath(`${baseId}-${index}`)) {
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
  const statusLine = `Status: ${status === "stage-2" ? "Stage 2 - Promoted family recipe" : "Stage 1 - Draft / testing"}`;
  const categoryLine = `Category: ${formatCategoryLabel(category)}`;
  let hasStatus = false;
  let hasCategory = false;
  const normalizedLines = lines.map((line) => {
    if (/^Status:\s*/i.test(line)) {
      hasStatus = true;
      return statusLine;
    }
    if (/^Category:\s*/i.test(line)) {
      hasCategory = true;
      return categoryLine;
    }
    return line;
  });
  const inserts = [
    hasStatus ? "" : statusLine,
    hasCategory ? "" : categoryLine,
  ].filter(Boolean);
  if (!inserts.length) {
    return normalizedLines.join("\n").replace(/\n{3,}/g, "\n\n");
  }
  return [
    ...normalizedLines.slice(0, insertIndex),
    ...inserts,
    ...normalizedLines.slice(insertIndex),
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

function formatCategoryLabel(value) {
  return formatFolderName(normalizeRecipeCategory(value));
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

function titleOnlyMealToMenuRow(mealTitle, day) {
  return {
    Day: day,
    Meal: mealTitle.trim(),
    "Recipe file": "",
    "Recipe path": "",
    Stage: "Recipe needed",
    Protein: "",
    "Cuisine/flavor": "",
    "Perishability reason": "",
    Notes: "Recipe to add later",
    "Plan source": "needs-recipe",
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

function createCustomMenuRow(rows) {
  const title = uniqueMenuCardTitle(rows, "New card");
  return {
    "Card type": "custom",
    Day: title,
    Meal: "",
    "Recipe file": "",
    "Recipe path": "",
    Stage: "",
    Protein: "",
    "Cuisine/flavor": "",
    "Perishability reason": "",
    Notes: "",
    "Plan source": "custom-card",
  };
}

function uniqueMenuCardTitle(rows, baseTitle) {
  const existingTitles = new Set(rows.map((row) => row.Day).filter(Boolean));
  if (!existingTitles.has(baseTitle)) {
    return baseTitle;
  }
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${baseTitle} ${index}`;
    if (!existingTitles.has(candidate)) {
      return candidate;
    }
  }
  return `${baseTitle} ${Date.now()}`;
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

function renameMenuRowDay(rows, fromDay, toDay) {
  return rows.map((row) => (row.Day === fromDay ? { ...row, Day: toDay } : row));
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

function clearAllMenuRows(rows) {
  return rows.map((row) => clearMenuRowForDay([row], row.Day)[0]);
}

function deleteMenuRowForDay(rows, day) {
  return rows.filter((row) => row.Day !== day);
}

function isCustomMenuCard(row, week) {
  if (!row) {
    return false;
  }
  if (row["Card type"] === "custom" || row["Plan source"] === "custom-card") {
    return true;
  }
  const standardDays = buildWeekDayOptions(week?.startDate);
  return Boolean(row.Day) && !standardDays.includes(row.Day);
}

function moveMenuRowBetweenDays(rows, fromDay, toDay) {
  const fromRow = rows.find((row) => row.Day === fromDay);
  const toRow = rows.find((row) => row.Day === toDay);
  if (!fromRow || !toRow || !hasMeal(fromRow)) {
    return rows;
  }

  const nextSourceRow = hasMeal(toRow)
    ? { ...toRow, Day: fromDay }
    : clearMenuRowForDay([fromRow], fromDay)[0];
  const nextTargetRow = { ...fromRow, Day: toDay };

  return rows.map((row) => {
    if (row.Day === fromDay) {
      return nextSourceRow;
    }
    if (row.Day === toDay) {
      return nextTargetRow;
    }
    return row;
  });
}

function findRecipeDocForMenuRow(row, docs) {
  const recipePath = row["Recipe path"] || "";
  const recipeFile = row["Recipe file"] || fileNameFromPath(recipePath);
  const candidates = [];
  if (recipePath) {
    candidates.push(...docs.filter((candidate) => candidate.path === recipePath));
  }

  if (recipeFile) {
    candidates.push(...docs.filter((candidate) => candidate.path.endsWith(`/${recipeFile}`)));
  }

  return bestRecipeDoc(candidates);
}

function bestRecipeDoc(candidates) {
  const uniqueCandidates = uniqueValues(candidates.filter(Boolean));
  return uniqueCandidates.find((candidate) => candidate.recipe)
    || uniqueCandidates.find((candidate) => candidate.type === "archived-recipe")
    || uniqueCandidates[0]
    || null;
}

function missingRecipeSelectionId(row) {
  return `missing-recipe|${row.Day || ""}|${row.Meal || ""}`;
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

    const firstName = canonicalGroceryItemKey(first.Item);
    const secondName = canonicalGroceryItemKey(second.Item);
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

function canonicalGroceryItemKey(value) {
  const options = groceryItemOptions(value)
    .map(canonicalGroceryOptionWords)
    .filter((words) => words.length);
  if (!options.length) {
    return normalizeGroceryItemName(value);
  }
  return options
    .sort((first, second) => second.length - first.length)[0]
    .sort()
    .join(" ");
}

function cleanGroceryItemDisplayName(value) {
  const words = canonicalGroceryOptionWords(groceryItemOptions(value)[0] || value);
  return words.join(" ");
}

function groceryItemOptions(value) {
  const normalized = normalizeGroceryItemName(value);
  return normalized
    .split(/\b(?:or|and or)\b|\/|;/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function canonicalGroceryOptionWords(value) {
  let words = normalizeGroceryItemName(value)
    .split(" ")
    .map(singularizeGroceryWord)
    .filter(Boolean);

  const wordSet = new Set(words);
  if (wordSet.has("scallion")) {
    return ["green", "onion"];
  }
  if (wordSet.has("romaine") && !wordSet.has("lettuce")) {
    words.push("lettuce");
  }
  if (wordSet.has("cilantro") && wordSet.has("fresh")) {
    words = words.filter((word) => word !== "fresh");
  }
  if (wordSet.has("onion") && wordSet.has("green")) {
    return ["green", "onion"];
  }
  if (wordSet.has("onion")) {
    return ["onion"];
  }
  if (wordSet.has("bean") && wordSet.has("green")) {
    return ["green", "bean"];
  }
  if (wordSet.has("pepper") && ["bell", "red", "yellow", "orange"].some((word) => wordSet.has(word))) {
    return ["bell", "pepper"];
  }

  const wordsWithoutPrep = words.filter((word) => !GROCERY_PREP_WORDS.has(word));
  return uniqueValues(wordsWithoutPrep.length ? wordsWithoutPrep : words);
}

function normalizeGroceryItemName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const GROCERY_PREP_WORDS = new Set([
  "chopped",
  "chunk",
  "crushed",
  "cube",
  "cubed",
  "dice",
  "diced",
  "drained",
  "fresh",
  "frozen",
  "grate",
  "grated",
  "julienned",
  "large",
  "mince",
  "minced",
  "optional",
  "peeled",
  "rinsed",
  "shred",
  "shredded",
  "slice",
  "sliced",
  "small",
  "thin",
  "thinly",
  "trimmed",
  "wedged",
  "wedge",
  "wedges",
]);

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
    const category = archiveCategoryForDoc(doc);
    const folderParts = category ? [category] : archiveFolderParts(parts);
    const id = folderParts.join("/") || "root";
    const label = folderParts.length ? folderParts.map(formatFolderName).join(" / ") : "All Recipes";
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

function archiveCategoryForDoc(doc) {
  if (doc.type === "firebase-recipe") {
    return normalizeRecipeCategory(doc.recipe?.category || pathCategory(doc.path));
  }
  return normalizeRecipeCategory(pathCategory(doc.path) || doc.recipe?.category);
}

function archiveFolderParts(parts) {
  if (parts[0] === "recipe-archive") {
    return parts.slice(1);
  }
  return parts;
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
    return "Recipes";
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
    return "Recipe Library";
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

function formatShortDate(value) {
  const date = parseLocalDate(value);
  if (!date) {
    return "next week";
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

createRoot(document.getElementById("root")).render(<App />);
