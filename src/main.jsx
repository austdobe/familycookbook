import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { RecipeImportDialog } from "./components/RecipeImportDialog.jsx";
import { CookingViewDialog } from "./components/CookingViewDialog.jsx";
import { GroceryView } from "./components/GroceryView.jsx";
import { PrepView } from "./components/PrepView.jsx";
import { AddWeekCardButton, CardEditDialog, ConfirmDialog, DayCard, WeekActionMenu } from "./components/WeekPresentation.jsx";
import { WeekCreator, WeekMealAssignmentPanel } from "./components/WeekEditors.jsx";
import { recipeMatchesQuery } from "./domain/recipeDiscovery.js";
import {
  buildGrocerySectionsFromMenuRows,
  flattenGrocerySections,
  groceryItemWords,
  grocerySectionForItem,
  isLikelyPerishableItem,
  normalizeSectionName,
  parseQuantityParts,
} from "./domain/groceryEngine.js";
import { createRecipeMarkdownTools } from "./domain/recipeMarkdown.js";
import { cleanRecipeOcrText } from "./domain/recipeOcr.js";
import { createPrepEngine } from "./domain/prepEngine.js";
import {
  deleteGroceryState,
  getGroceryState,
  saveGroceryState,
  syncGroceryStateFromFirebase,
} from "./services/groceryStore.js";
import { markdownToHtml } from "./services/markdown.js";
import { deletePrepState, getPrepState, savePrepState, syncPrepStateFromFirebase } from "./services/prepStore.js";
import { saveRecipeFeedback, subscribeRecipeFeedback } from "./services/recipeFeedbackStore.js";
import { saveRecipe, subscribeRecipes, syncRecipesFromFirebase } from "./services/recipeStore.js";
import { formatQuantity } from "./services/units.js";
import { deleteWeekPlanState, saveWeekPlanState, subscribeWeekPlanState, syncWeekPlanStateFromFirebase } from "./services/weekPlanStore.js";
import { deleteWorkingWeek, subscribeWorkingWeeks, syncWorkingWeeksFromFirebase, upsertWeek, upsertWorkingWeek } from "./services/workingWeeksStore.js";
import { reconcileGrocerySnapshot, reconcilePrepCheckedKeys } from "./domain/listReconciliation.js";
import { resolveMealComponentDocs } from "./domain/plannedMeals.js";
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
const {
  formatCategoryLabel,
  instructionSectionsFromMarkdown,
  labeledBulletValues,
  minutesValue,
  normalizeRecipeCategory,
  numericValue,
  pathCategory,
  recipeFromMarkdownForSave,
  structuredIngredientsFromMarkdown,
} = createRecipeMarkdownTools({
  cleanRecipeOcrText,
  extractIngredientTableRows,
  extractIngredientSourceRows,
  extractPlainTextIngredientRows,
  grocerySectionForItem,
  ingredientTableLines,
  isLikelyPerishableItem,
  parseQuantityParts,
});
const {
  buildPrepSectionsFromMenuRows,
  flattenPrepSections,
} = createPrepEngine({
  fileNameFromPath,
  findRecipeDocForMenuRow,
  hasMeal,
  instructionSectionsFromMarkdown,
  labeledBulletValues,
  recipeDocsForMenuRow,
  structuredIngredientsFromMarkdown,
});

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
  const [pageActionMenuOpen, setPageActionMenuOpen] = useState(false);

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
  const selectedWeekSealed = Boolean(selectedWeekPlanState.sealed);

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
    if (!selectedWeek || selectedWeekSealed) {
      return;
    }

    setResyncingLists(true);
    setResyncStatus("Refreshing shopping and prep lists...");
    try {
      const nextWeek = await resyncWeekAssets({
        archiveDocs,
        existingGroceryState: await getGroceryState(selectedWeek.id),
        existingPrepState: await getPrepState(selectedWeek.id),
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
            {selectedWeekSealed ? <span className="pill">Sealed</span> : null}
            <div className="topbar-more-actions">
              <button
                aria-expanded={pageActionMenuOpen}
                aria-label="Open page actions"
                className="quiet-button topbar-more-button"
                onClick={() => setPageActionMenuOpen((current) => !current)}
                type="button"
              >
                ...
              </button>
              {pageActionMenuOpen ? (
                <div className="action-menu topbar-action-menu" role="menu">
                  <button
                    disabled={syncingFirebase}
                    onClick={() => {
                      setPageActionMenuOpen(false);
                      syncFromFirebase();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    {syncingFirebase ? "Syncing..." : "Sync"}
                  </button>
                  {selectedWeek ? (
                    <button
                      disabled={resyncingLists || selectedWeekSealed}
                      onClick={() => {
                        setPageActionMenuOpen(false);
                        resyncSelectedWeekLists();
                      }}
                      role="menuitem"
                      type="button"
                    >
                      {selectedWeekSealed ? "Update Lists Locked" : resyncingLists ? "Updating..." : "Update Lists"}
                    </button>
                  ) : null}
                  {installPrompt ? (
                    <button
                      onClick={async () => {
                        setPageActionMenuOpen(false);
                        installPrompt.prompt();
                        await installPrompt.userChoice;
                        setInstallPrompt(null);
                      }}
                      role="menuitem"
                      type="button"
                    >
                      Install
                    </button>
                  ) : null}
                  <button
                    onClick={() => {
                      setPageActionMenuOpen(false);
                      loadData().then(setData);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    Refresh
                  </button>
                </div>
              ) : null}
            </div>
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
              weekPlanState={selectedWeekPlanState}
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
              isSealed={selectedWeekSealed}
            />
          ) : null}
          {view === "prep" ? (
            <PrepView isSealed={selectedWeekSealed} search={search} week={selectedWeek} />
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
  weekPlanState: appWeekPlanState,
  weeks,
  workingWeeks,
}) {
  const [weekPlanState, setWeekPlanState] = useState({ menuRows: [] });
  const [recipeDialogMode, setRecipeDialogMode] = useState("");
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [cookingDialogOpen, setCookingDialogOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedRecipeIndex, setSelectedRecipeIndex] = useState(0);
  const [weekCreatorOpen, setWeekCreatorOpen] = useState(false);
  const [weekActionMenuOpen, setWeekActionMenuOpen] = useState(false);
  const [mealEditorOpen, setMealEditorOpen] = useState(false);
  const [cardEditorDay, setCardEditorDay] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);
  const [draggingDay, setDraggingDay] = useState("");
  const [draggingRecipeId, setDraggingRecipeId] = useState("");
  const isSealed = Boolean(weekPlanState.sealed);

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
          createWeekShell={createWorkingWeekShell}
          formatDate={formatShortDate}
          getDefaults={getNextPlanningWeekDefaults}
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
  const allRecipeDocs = mergeArchiveDocs(week.recipes, archiveDocs);
  const missingRecipeSelected = String(activeDocId || "").startsWith("missing-recipe|");
  const selectedRow = sourceMenuRows.find((row) => row.Day === selectedDay)
    || menuRows[0]
    || sourceMenuRows[0]
    || null;
  const selectedDoc = missingRecipeSelected
    ? null
    : allRecipeDocs.find((doc) => doc.id === activeDocId) || getDefaultRecipeForWeek(week, plannedMenuRows, allRecipeDocs) || allRecipeDocs[0] || null;
  const selectedRowDoc = selectedRow ? findRecipeDocForMenuRow(selectedRow, allRecipeDocs) : null;
  const selectedRowDocs = selectedRow ? recipeDocsForMenuRow(selectedRow, allRecipeDocs) : [];
  const currentSelectedRecipeIndex = selectedRowDocs.length
    ? Math.min(selectedRecipeIndex, selectedRowDocs.length - 1)
    : 0;
  const readerDoc = selectedRow
    ? selectedRowDocs[currentSelectedRecipeIndex] || selectedRowDoc
    : selectedDoc;
  const cardEditorRow = sourceMenuRows.find((row) => row.Day === cardEditorDay) || null;
  const canDeleteWeek = plannedMenuRows.length === 0 && workingWeeks.some((candidate) => candidate.id === week.id);
  const sealWeek = async () => {
    await saveWeekPlanState(week.id, {
      ...(appWeekPlanState || weekPlanState),
      menuRows: sourceMenuRows,
      sealed: true,
      sealedAt: new Date().toISOString(),
    });
    setWeekActionMenuOpen(false);
    setMealEditorOpen(false);
  };
  const unsealWeek = async () => {
    await saveWeekPlanState(week.id, {
      ...(appWeekPlanState || weekPlanState),
      menuRows: sourceMenuRows,
      sealed: false,
      unsealedAt: new Date().toISOString(),
    });
    setWeekActionMenuOpen(false);
  };
  const requestUnsealWeek = () => {
    if (!isSealed) {
      return;
    }
    setWeekActionMenuOpen(false);
    setConfirmAction({
      confirmLabel: "Unseal Week",
      description: "This week is sealed. Unsealing allows menu, grocery, prep, and list updates to change again.",
      title: "Unseal this week?",
      tone: "danger",
      onConfirm: unsealWeek,
    });
  };

  const saveRows = async (nextRows) => {
    if (isSealed) {
      requestUnsealWeek();
      return null;
    }
    const nextWeek = await saveWeekMenuRows({
      archiveDocs,
      menuRows: nextRows,
      onSaveWorkingWeek,
      week,
    });
    setActiveDocId("");
    return nextWeek;
  };

  const assignRecipeToSelectedDay = async (recipeDoc, assignment = {}) => {
    if (!selectedRow || !recipeDoc) {
      return;
    }
    const nextRow = addRecipeToPlannedMeal(selectedRow, recipeDoc, { ...assignment, docs: allRecipeDocs });
    await saveRows(replaceMenuRowForDay(sourceMenuRows, nextRow));
    const nextDocs = recipeDocsForMenuRow(nextRow, allRecipeDocs);
    setSelectedRecipeIndex(Math.max(0, nextDocs.findIndex((doc) => doc.id === recipeDoc.id)));
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

  const removeMealComponentForSelectedDay = async (componentIndex) => {
    if (!selectedRow) return;
    const components = mealComponentsForRow(selectedRow).filter((_, index) => index !== componentIndex);
    const nextRow = components.length
      ? menuRowWithComponents(selectedRow, components, allRecipeDocs)
      : clearMenuRowForDay([selectedRow], selectedRow.Day)[0];
    await saveRows(replaceMenuRowForDay(sourceMenuRows, nextRow));
    setSelectedRecipeIndex((current) => Math.max(0, Math.min(current, components.length - 1)));
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
    if (isSealed) {
      requestUnsealWeek();
      setWeekActionMenuOpen(false);
      return;
    }
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
        createWeekShell={createWorkingWeekShell}
        formatDate={formatShortDate}
        getDefaults={getNextPlanningWeekDefaults}
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
        canDeleteCard={!isSealed && isCustomMenuCard(cardEditorRow, week)}
        onClearCard={() => requestClearCard(cardEditorRow)}
        onClose={() => setCardEditorDay("")}
        onDeleteCard={() => requestDeleteCard(cardEditorRow)}
        onRenameCard={(nextTitle) => renameCard(cardEditorRow, nextTitle)}
        open={!isSealed && Boolean(cardEditorRow)}
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
            {isSealed ? <span className="pill">Sealed</span> : null}
            <span className="pill">{plannedMenuRows.length} meals</span>
          </div>
        </div>
        <div className="menu-grid">
          {menuRows.length ? menuRows.map((row) => (
            <DayCard
              activeDocId={activeDocId}
              canDrag={!isSealed && hasMeal(row)}
              componentDocs={recipeDocsForMenuRow(row, allRecipeDocs)}
              dayDragType={DAY_DRAG_TYPE}
              doc={findRecipeDocForMenuRow(row, allRecipeDocs)}
              key={`${row.Day}-${row["Recipe path"] || row["Recipe file"] || row.Meal}`}
              row={row}
              draggingDay={isSealed ? "" : draggingDay}
              draggingRecipeId={isSealed ? "" : draggingRecipeId}
              editMode={!isSealed && mealEditorOpen}
              isSealed={isSealed}
              missingSelectionId={missingRecipeSelectionId(row)}
              selectedDay={selectedRow?.Day || ""}
              selectedDoc={readerDoc}
              onDragEnd={() => {
                setDraggingDay("");
                setDraggingRecipeId("");
              }}
              onDragStart={(nextRow) => !isSealed && setDraggingDay(nextRow.Day)}
              onDropMeal={isSealed ? requestUnsealWeek : moveMealToDay}
              onDropRecipe={isSealed ? requestUnsealWeek : assignRecipeToDay}
              onEditCard={(nextRow) => !isSealed && setCardEditorDay(nextRow.Day)}
              onSelect={(nextId, nextRow, nextRecipeIndex = 0) => {
                setSelectedDay(nextRow.Day);
                setSelectedRecipeIndex(nextRecipeIndex);
                setActiveDocId(nextId);
                if (mealEditorOpen) {
                  setMealEditorOpen(true);
                }
              }}
              recipeDragType={RECIPE_DRAG_TYPE}
            />
          )) : <div className="empty">No planned meals match the current search.</div>}
          {!isSealed && mealEditorOpen ? <AddWeekCardButton onClick={addCustomWeekCard} /> : null}
        </div>
      </section>

      {!isSealed && mealEditorOpen ? (
        <WeekMealAssignmentPanel
          archiveDocs={allRecipeDocs}
          components={mealComponentsForRow(selectedRow)}
          initialMealStyle={mealTypeForRow(selectedRow)}
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
          onRemoveComponent={removeMealComponentForSelectedDay}
          onSetTitleOnlyMeal={setTitleOnlyMealForSelectedDay}
          pickerProps={{
            dragType: RECIPE_DRAG_TYPE,
            getCategory: recipePickerCategory,
            getMeta: recipePickerMeta,
            isQuick: recipeIsUnderThirtyMinutes,
          }}
          selectedRow={selectedRow}
        />
      ) : null}

      <section>
        <div className="section-title">
          <div className="selected-recipe-heading">
            <h3>Selected Recipe</h3>
            {selectedRowDocs.length > 1 ? (
              <div className="selected-recipe-navigation" aria-label="Attached recipe navigation">
                <button
                  aria-label="Previous attached recipe"
                  className="icon-button"
                  onClick={() => setSelectedRecipeIndex((current) => (current - 1 + selectedRowDocs.length) % selectedRowDocs.length)}
                  type="button"
                >
                  ←
                </button>
                <span>{currentSelectedRecipeIndex + 1} of {selectedRowDocs.length} · {readerDoc?.title}</span>
                <button
                  aria-label="Next attached recipe"
                  className="icon-button"
                  onClick={() => setSelectedRecipeIndex((current) => (current + 1) % selectedRowDocs.length)}
                  type="button"
                >
                  →
                </button>
              </div>
            ) : readerDoc ? <span className="selected-recipe-name">{readerDoc.title}</span> : null}
          </div>
          <div className="section-actions">
            <button className="primary-button" disabled={!readerDoc} onClick={() => setCookingDialogOpen(true)} type="button">Start Cooking</button>
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
      </section>
      {cookingDialogOpen && readerDoc ? (
        <CookingViewDialog
          ingredients={recipeIngredientsForEditing(readerDoc)}
          onClose={() => setCookingDialogOpen(false)}
          recipeId={readerDoc.id}
          steps={cookingStepsForRecipe(readerDoc)}
          title={readerDoc.title}
        />
      ) : null}
      {feedbackDialogOpen && readerDoc ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setFeedbackDialogOpen(false)}>
          <div
            aria-label={`Rate ${readerDoc.title}`}
            aria-modal="true"
            className="recipe-feedback-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="dialog-header">
              <div>
                <h3>Rate Selected Recipe</h3>
                <p className="dialog-help">{readerDoc.title}</p>
              </div>
              <button aria-label="Close recipe rating" className="icon-button" onClick={() => setFeedbackDialogOpen(false)} type="button">x</button>
            </div>
            <RecipeFeedbackPanel recipe={readerDoc} />
          </div>
        </div>
      ) : null}
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
        isSealed={isSealed}
        onEditWeek={openMealEditor}
        onRequestUnsealWeek={requestUnsealWeek}
        onRateRecipe={() => {
          setWeekActionMenuOpen(false);
          setFeedbackDialogOpen(true);
        }}
        selectedRecipe={readerDoc}
        onSealWeek={sealWeek}
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
        const pendingIngredientChanges = ingredientChanges.filter((change) => !change.appliedAt);
        const appliedAt = new Date().toISOString();
        let nextFeedback = feedback;
        const recipePatch = {};

        if (feedback.cookedAt || feedback.promotedAt) {
          Object.assign(recipePatch, {
            cookedCount,
            lastCookedAt: feedback.cookedAt || lastCookedAt,
            promotedAt: feedback.promotedAt || promotedAt,
            promotionNotes: feedback.promotionNotes || "",
          });
        }

        if (pendingIngredientChanges.length) {
          const nextVersion = nextMajorRecipeVersion(recipeRecord.version || "1.0");
          const nextIngredients = applyIngredientChangesToIngredients(recipe, pendingIngredientChanges);
          nextFeedback = {
            ...feedback,
            ingredientChanges: ingredientChanges.map((change) => (
              change.appliedAt
                ? change
                : { ...change, appliedAt, appliedRecipeVersion: nextVersion }
            )),
          };
          Object.assign(recipePatch, {
            ingredients: nextIngredients,
            lastUpdated: formatInputDate(new Date()),
            sourceMarkdown: updateRecipeMarkdownIngredients(recipe.markdown, nextIngredients),
            version: nextVersion,
            versionHistory: [
              ...(recipeRecord.versionHistory || []),
              {
                date: formatInputDate(new Date()),
                version: nextVersion,
                change: `Applied ingredient feedback: ${pendingIngredientChanges.map(formatIngredientChange).join("; ")}.`,
                result: [feedback.rating, feedback.notes].filter(Boolean).join(" - "),
              },
            ],
          });
        }

        await saveRecipeFeedback(recipe.id, recipe.path, nextFeedback);
        setFeedback(nextFeedback);
        if (Object.keys(recipePatch).length) {
          await saveRecipe(recipeSavePayloadFromDoc(recipe, recipePatch));
        }
        setStatus(pendingIngredientChanges.length ? `Saved as recipe version ${recipePatch.version}` : "Saved");
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

function nextMajorRecipeVersion(version) {
  const match = String(version || "1.0").match(/^(\d+)(?:\.(\d+))?/);
  const currentMajor = match ? Number(match[1]) : 1;
  return `${Math.max(1, currentMajor) + 1}.0`;
}

function applyIngredientChangesToIngredients(recipeDoc, changes) {
  const currentIngredients = recipeIngredientsForEditing(recipeDoc);
  return changes.reduce((ingredients, change) => {
    if (change.type === "add") {
      return [...ingredients, ingredientFromChange(change, ingredients.length)];
    }

    const matchIndex = ingredients.findIndex((ingredient) => sameIngredientName(ingredient.item, change.matchIngredient));
    if (matchIndex === -1) {
      return ingredients;
    }

    if (change.type === "remove") {
      return ingredients.filter((_, index) => index !== matchIndex);
    }

    return ingredients.map((ingredient, index) => {
      if (index !== matchIndex) {
        return ingredient;
      }
      const nextItem = change.ingredient || ingredient.item;
      return {
        ...ingredient,
        acceptableAlternatives: change.alternatives || ingredient.acceptableAlternatives || "",
        groceryCategory: grocerySectionForItem(nextItem),
        item: nextItem,
        notes: change.notes || ingredient.notes || ingredient.usedIn || "",
        preferredType: change.preferred || ingredient.preferredType || "",
        quantityText: change.quantity || ingredient.quantityText || "",
        sourceRow: undefined,
        usedIn: change.notes || ingredient.usedIn || ingredient.notes || "",
      };
    });
  }, currentIngredients).map((ingredient, index) => ({
    ...ingredient,
    id: ingredient.id || `ingredient-${index + 1}`,
  }));
}

function recipeIngredientsForEditing(recipeDoc) {
  const recipe = recipeDoc.recipe || {};
  const ingredients = recipe.ingredients?.length
    ? recipe.ingredients
    : structuredIngredientsFromMarkdown(recipeDoc.markdown || "");
  return ingredients.map((ingredient, index) => {
    const item = ingredient.item || ingredient.Ingredient || ingredient.Item || "";
    const quantityText = ingredient.quantityText || ingredient.Quantity || "";
    return {
      id: ingredient.id || `ingredient-${index + 1}`,
      quantityText,
      quantityValue: ingredient.quantityValue ?? numericValue(parseQuantityParts(quantityText).quantity),
      unit: ingredient.unit || parseQuantityParts(quantityText).unit || "",
      item,
      preferredType: ingredient.preferredType || ingredient["Preferred version/type"] || ingredient.Preferred || "",
      acceptableAlternatives: ingredient.acceptableAlternatives || ingredient["Acceptable alternatives"] || ingredient.Alternatives || "",
      notes: ingredient.notes || ingredient.Notes || ingredient.usedIn || "",
      groceryCategory: ingredient.groceryCategory || grocerySectionForItem(item),
      usedIn: ingredient.usedIn || ingredient.notes || ingredient.Notes || "",
      optional: Boolean(ingredient.optional),
      perishable: ingredient.perishable ?? isLikelyPerishableItem(item),
    };
  }).filter((ingredient) => ingredient.item);
}

function ingredientFromChange(change, index) {
  const parsedQuantity = parseQuantityParts(change.quantity || "");
  return {
    id: `ingredient-${index + 1}`,
    quantityText: change.quantity || "",
    quantityValue: numericValue(parsedQuantity.quantity),
    unit: parsedQuantity.unit,
    item: change.ingredient || "",
    preferredType: change.preferred || "",
    acceptableAlternatives: change.alternatives || "",
    notes: change.notes || "Added from family feedback",
    groceryCategory: grocerySectionForItem(change.ingredient || ""),
    usedIn: change.notes || "Added from family feedback",
    optional: false,
    perishable: isLikelyPerishableItem(change.ingredient || ""),
  };
}

function sameIngredientName(first, second) {
  return normalizeGroceryItemName(first) === normalizeGroceryItemName(second);
}

function updateRecipeMarkdownIngredients(markdown, ingredients) {
  const text = String(markdown || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const ingredientsHeading = lines.findIndex((line) => /^##\s+Ingredients\s*$/i.test(line.trim()));
  const tableLines = ingredientTableLines(ingredients);

  if (ingredientsHeading === -1) {
    return [text.trim(), "", "## Ingredients", "", ...tableLines].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  let tableStart = -1;
  for (let index = ingredientsHeading + 1; index < lines.length - 1; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      break;
    }
    if (lines[index].includes("|") && isMarkdownTableSeparator(lines[index + 1])) {
      tableStart = index;
      break;
    }
  }

  if (tableStart === -1) {
    return [
      ...lines.slice(0, ingredientsHeading + 1),
      "",
      ...tableLines,
      "",
      ...lines.slice(ingredientsHeading + 1),
    ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  let tableEnd = tableStart + 2;
  while (tableEnd < lines.length && lines[tableEnd].includes("|") && lines[tableEnd].trim()) {
    tableEnd += 1;
  }

  return [
    ...lines.slice(0, tableStart),
    ...tableLines,
    ...lines.slice(tableEnd),
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ingredientTableLines(ingredients) {
  return [
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    ...ingredients.map((ingredient) => [
      ingredient.quantityText || "",
      ingredient.item || "",
      ingredient.preferredType || "",
      ingredient.acceptableAlternatives || "",
      ingredient.notes || ingredient.usedIn || "",
    ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |")),
  ];
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

function recipePickerCategory(doc) {
  return normalizeRecipeCategory(doc.recipe?.category || pathCategory(doc.path));
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
  const [libraryQuery, setLibraryQuery] = useState("");
  const visibleDocs = useMemo(() => libraryQuery.trim() ? archiveDocs.filter((doc) => recipeMatchesQuery(doc, libraryQuery)) : docs, [archiveDocs, docs, libraryQuery]);
  const directories = useMemo(() => buildArchiveDirectories(visibleDocs), [visibleDocs]);
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
          <div className="archive-library-search">
            <label>
              Find a recipe
              <input
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="Search name, ingredient, protein, or flavor"
                type="search"
                value={libraryQuery}
              />
            </label>
            <span>{visibleDocs.length} recipe{visibleDocs.length === 1 ? "" : "s"}</span>
          </div>
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
              subtitle={libraryQuery ? "Try another ingredient, title, protein, or flavor." : "Start with a typed recipe, pasted recipe text, or a recipe photo."}
              title={libraryQuery ? "No Matching Recipes" : "No Recipes Yet"}
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

function cookingStepsForRecipe(recipe) {
  const sections = recipe.recipe?.instructionSections?.length
    ? recipe.recipe.instructionSections
    : instructionSectionsFromMarkdown(recipe.markdown || "");
  return sections.flatMap((section) => (section.steps || []).map((step) => ({
    section: section.title || section.name || "Directions",
    text: step.text || String(step || ""),
  }))).filter((step) => step.text);
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

async function resyncWeekAssets({ archiveDocs, existingGroceryState = {}, existingPrepState = {}, week, weekPlanState = {} }) {
  const menuRows = activeMenuRowsForWeek(week, weekPlanState);
  const allRecipeDocs = mergeArchiveDocs(week.recipes || [], archiveDocs);
  const grocerySections = buildGrocerySectionsFromMenuRows(menuRows, allRecipeDocs, ingredientRowsForDoc);
  const prepSections = buildPrepSectionsFromMenuRows(menuRows, allRecipeDocs);
  const groceryItems = flattenGrocerySections(grocerySections);
  const prepTasks = flattenPrepSections(prepSections);
  const generatedAt = new Date().toISOString();
  const grocerySnapshot = reconcileGrocerySnapshot({ generatedSections: grocerySections, previousState: existingGroceryState, weekId: week.id });
  const prepCheckedKeys = reconcilePrepCheckedKeys({ generatedSections: prepSections, parseTasks: parsePrepTasks, previousState: existingPrepState, weekId: week.id });
  const nextWeek = {
    ...week,
    groceryItems,
    grocerySections,
    meals: menuRows,
    menuRows,
    prepSections,
    prepTasks,
    recipePaths: uniqueValues(menuRows.flatMap((row) => recipePathsForMenuRow(row, allRecipeDocs))),
    title: week.title || week.packet?.title || week.label,
    updatedAt: generatedAt,
  };

  await Promise.all([
    saveGroceryState(week.id, {
      ...grocerySnapshot,
      generatedAt,
      generationSource: "firebase-recipes",
      generationVersion: "app-week-assets-resync-v3",
    }),
    savePrepState(week.id, {
      checkedKeys: prepCheckedKeys,
      generatedAt,
      generationSource: "firebase-recipes",
      generationVersion: "app-week-assets-resync-v2",
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
  const [existingGroceryState, existingPrepState] = await Promise.all([
    getGroceryState(week.id),
    getPrepState(week.id),
  ]);
  const allRecipeDocs = mergeArchiveDocs(week.recipes || [], archiveDocs);
  const grocerySections = buildGrocerySectionsFromMenuRows(menuRows, allRecipeDocs, ingredientRowsForDoc);
  const prepSections = buildPrepSectionsFromMenuRows(menuRows, allRecipeDocs);
  const generatedAt = new Date().toISOString();
  const grocerySnapshot = reconcileGrocerySnapshot({ generatedSections: grocerySections, previousState: existingGroceryState, weekId: week.id });
  const prepCheckedKeys = reconcilePrepCheckedKeys({ generatedSections: prepSections, parseTasks: parsePrepTasks, previousState: existingPrepState, weekId: week.id });
  const nextWeek = {
    ...week,
    groceryItems: flattenGrocerySections(grocerySections),
    grocerySections,
    meals: menuRows,
    menuRows,
    prepSections,
    prepTasks: flattenPrepSections(prepSections),
    recipePaths: uniqueValues(menuRows.flatMap((row) => recipePathsForMenuRow(row, allRecipeDocs))),
    title: week.title || week.packet?.title || week.label,
    weeklyMenu: menuRows,
    updatedAt: generatedAt,
  };

  await Promise.all([
    onSaveWorkingWeek(nextWeek),
    saveWeekPlanState(week.id, { menuRows }),
    saveGroceryState(week.id, {
      ...grocerySnapshot,
      generatedAt,
      generationSource: "week-planner",
      generationVersion: "inline-week-planner-v2",
    }),
    savePrepState(week.id, {
      checkedKeys: prepCheckedKeys,
      generatedAt,
      generationSource: "week-planner",
      generationVersion: "inline-week-planner-v2",
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
  const recipes = uniqueValues(menuRows.flatMap((row) => recipeDocsForMenuRow(row, archiveDocs)));

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
    grocerySections: week.grocerySections?.length
      ? week.grocerySections
      : buildGrocerySectionsFromMenuRows(menuRows, archiveDocs, ingredientRowsForDoc),
    prepSections: week.prepSections?.length
      ? week.prepSections
      : buildPrepSectionsFromMenuRows(menuRows, archiveDocs),
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

function labeledBullet(label, value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return `- ${label}: ${value}`;
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").trim();
}

function filterDocs(docs, search) {
  return docs.filter((doc) => matchesSearch(`${doc.title} ${doc.summary} ${doc.path}`, search));
}

function matchesSearch(text, search) {
  const needle = search.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
}

function hasMeal(row) {
  return Boolean(mealComponentsForRow(row).length || [row.Meal, row["Recipe file"], row.Protein, row["Cuisine/flavor"]].join("").trim());
}

function archiveRecipeToMenuRow(doc, day, role = "complete") {
  return {
    Day: day,
    Meal: doc.title,
    mealType: role === "complete" ? "complete_recipe" : "composed",
    components: [plannedMealComponent(doc, role)],
    "Recipe id": doc.id,
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

function plannedMealComponent(doc, role = "complete") {
  return {
    recipeId: doc.recipe?.id || doc.id,
    role,
  };
}

function mealComponentsForRow(row) {
  if (Array.isArray(row?.components) && row.components.length) {
    return row.components
      .filter((component) => component?.recipeId)
      .map((component) => ({
        recipeId: component.recipeId,
        role: component.role || "main",
        ...(component.servings ? { servings: component.servings } : {}),
      }));
  }
  const legacyRecipeId = row?.["Recipe id"] || row?.recipeId || "";
  return legacyRecipeId ? [{ recipeId: legacyRecipeId, role: "complete" }] : [];
}

function mealTypeForRow(row) {
  const components = mealComponentsForRow(row);
  if (!components.length) return "complete";
  if (components.length === 1 && components[0].role === "complete") return "complete";
  if (components.some((component) => component.role === "complete")) return "hybrid";
  return "composed";
}

function addRecipeToPlannedMeal(row, doc, { docs = [], mealStyle = "complete", role = "main" } = {}) {
  if (mealStyle === "complete") {
    return { ...row, ...archiveRecipeToMenuRow(doc, row.Day, "complete") };
  }

  const storedComponents = mealComponentsForRow(row);
  const legacyDoc = storedComponents.length ? null : findLegacyRecipeDocForMenuRow(row, docs);
  const existingComponents = storedComponents.length
    ? storedComponents
    : (legacyDoc ? [plannedMealComponent(legacyDoc, "complete")] : []);
  if (mealStyle === "hybrid" && !existingComponents.length) {
    return {
      ...row,
      ...archiveRecipeToMenuRow(doc, row.Day, "complete"),
      mealType: "hybrid",
    };
  }
  const baseComponents = existingComponents;
  const nextComponent = plannedMealComponent(doc, role);
  const components = baseComponents.some((component) => component.recipeId === nextComponent.recipeId && component.role === nextComponent.role)
    ? baseComponents
    : [...baseComponents, nextComponent];
  return menuRowWithComponents(row, components, [...docs, doc]);
}

function menuRowWithComponents(row, components, docs) {
  const componentDocs = components
    .map((component) => docs.find((candidate) => candidate.id === component.recipeId || candidate.recipe?.id === component.recipeId))
    .filter(Boolean);
  const primaryDoc = componentDocs[0];
  if (!primaryDoc) return { ...row, components };
  const projected = archiveRecipeToMenuRow(primaryDoc, row.Day, components[0].role);
  return {
    ...row,
    ...projected,
    Meal: componentDocs.map((doc) => doc.title).join(" + "),
    components,
    mealType: components.some((component) => component.role === "complete")
      ? (components.length === 1 ? "complete_recipe" : "hybrid")
      : "composed",
  };
}

function titleOnlyMealToMenuRow(mealTitle, day) {
  return {
    Day: day,
    Meal: mealTitle.trim(),
    components: [],
    mealType: "title_only",
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
    components: [],
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
    components: [],
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
      components: [],
      mealType: "",
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
  const componentDocs = recipeDocsForMenuRow(row, docs);
  if (componentDocs.length) {
    return componentDocs[0];
  }
  return findLegacyRecipeDocForMenuRow(row, docs);
}

function recipeDocsForMenuRow(row, docs) {
  const componentDocs = resolveMealComponentDocs(row, docs);
  if (componentDocs.length) {
    return componentDocs;
  }
  const components = mealComponentsForRow(row);
  if (!components.length) {
    const legacyDoc = findLegacyRecipeDocForMenuRow(row, docs);
    return legacyDoc ? [legacyDoc] : [];
  }
  return [];
}

function recipePathsForMenuRow(row, docs) {
  const componentPaths = recipeDocsForMenuRow(row, docs).map((doc) => doc.path).filter(Boolean);
  if (componentPaths.length) return componentPaths;
  return [row?.["Recipe path"]].filter(Boolean);
}

function findLegacyRecipeDocForMenuRow(row, docs) {
  const recipeId = row["Recipe id"] || row.recipeId || "";
  const recipePath = row["Recipe path"] || "";
  const recipeFile = row["Recipe file"] || fileNameFromPath(recipePath);
  const candidates = [];
  if (recipeId) {
    candidates.push(...docs.filter((candidate) => candidate.id === recipeId || candidate.recipe?.id === recipeId));
  }
  if (recipePath) {
    candidates.push(...docs.filter((candidate) => candidate.path === recipePath));
  }

  if (recipeFile) {
    candidates.push(...docs.filter((candidate) => candidate.path.endsWith(`/${recipeFile}`)));
  }

  if (!candidates.length && row["Plan source"] !== "needs-recipe") {
    const mealTitle = String(row.Meal || "").trim().toLowerCase();
    candidates.push(...docs.filter((candidate) => String(candidate.title || "").trim().toLowerCase() === mealTitle));
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

function normalizeHeader(header) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function extractIngredientRows(markdown) {
  const seenIngredients = new Set();
  return extractIngredientSourceRows(markdown)
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
      Quantity: ingredient.quantityText || ingredient.Quantity || "",
      Ingredient: ingredient.item || ingredient.Ingredient || ingredient.Item || "",
      "Preferred version/type": ingredient.preferredType || ingredient["Preferred version/type"] || ingredient.Preferred || "",
      "Acceptable alternatives": ingredient.acceptableAlternatives || ingredient["Acceptable alternatives"] || ingredient.Alternatives || "",
      Notes: ingredient.notes || ingredient.usedIn || ingredient.Notes || "",
    }));
  }
  return extractIngredientSourceRows(doc?.markdown || "");
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
  const ingredientsHeading = lines.findIndex((line) => /^##\s+Ingredients\s*$/i.test(line.trim()));
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

function extractIngredientSourceRows(markdown) {
  const tableRows = extractIngredientTableRows(markdown);
  return tableRows.length ? tableRows : extractPlainTextIngredientRows(markdown);
}

function extractPlainTextIngredientRows(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^#{0,6}\s*ingredients\s*:?\s*$/i.test(line.trim()));
  if (start === -1) {
    return [];
  }

  const endHeading = /^(?:#{0,6}\s*)?(?:directions?|instructions?|method|preparation|steps)\s*:?\s*$/i;
  const groupHeading = /^(?:chicken|meat|protein|produce|vegetables?|dry rub|rub|seasoning|spice blend|marinade|sauce|glaze|dressing|garnish(?:\s*\(optional\))?|for serving|to serve|assembly)\s*:?$/i;
  const rows = [];

  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) {
      continue;
    }
    if (endHeading.test(line)) {
      break;
    }
    const nextLine = lines.slice(index + 1).map((candidate) => candidate.trim()).find(Boolean) || "";
    const looksLikeNamedGroup = !startsWithPlainIngredientQuantity(line)
      && startsWithPlainIngredientQuantity(nextLine)
      && line.split(/\s+/).length <= 8;
    if (groupHeading.test(line) || looksLikeNamedGroup) {
      continue;
    }
    if (/^(?:prep|cook|total)\s+time|^servings?|^equipment$/i.test(line)) {
      continue;
    }

    const parsed = splitPlainTextIngredient(line);
    if (parsed.Ingredient) {
      rows.push(parsed);
    }
  }

  return rows;
}

function startsWithPlainIngredientQuantity(line) {
  return /^((?:\d+\s+)?[¼½¾⅓⅔⅛⅜⅝⅞](?:\s*[–-]\s*(?:\d+\s+)?[¼½¾⅓⅔⅛⅜⅝⅞])?|\d+(?:\.\d+|\/\d+)?(?:\s*[–-]\s*\d+(?:\.\d+|\/\d+)?)?|(?:pinch|dash|handful|to taste|as needed))\s+/i.test(line);
}

function splitPlainTextIngredient(line) {
  const quantityMatch = line.match(/^((?:\d+\s+)?[¼½¾⅓⅔⅛⅜⅝⅞](?:\s*[–-]\s*(?:\d+\s+)?[¼½¾⅓⅔⅛⅜⅝⅞])?|\d+(?:\.\d+|\/\d+)?(?:\s*[–-]\s*\d+(?:\.\d+|\/\d+)?)?|(?:pinch|dash|handful|to taste|as needed))\s+(.+)$/i);
  if (!quantityMatch) {
    return {
      Quantity: "",
      Ingredient: line,
      "Preferred version/type": "",
      "Acceptable alternatives": "",
      Notes: "",
    };
  }

  const unitMatch = quantityMatch[2].match(/^((?:cups?|tbsp|tablespoons?|tsp|teaspoons?|lb|lbs|pounds?|oz|ounces?|cloves?|cans?|packages?|packets?|bunches?|sticks?))\s+(.+)$/i);
  if (unitMatch) {
    quantityMatch[1] = `${quantityMatch[1]} ${unitMatch[1]}`;
    quantityMatch[2] = unitMatch[2];
  }

  return {
    Quantity: quantityMatch[1],
    Ingredient: quantityMatch[2],
    "Preferred version/type": "",
    "Acceptable alternatives": "",
    Notes: "",
  };
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
