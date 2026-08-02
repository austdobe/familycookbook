import React, { useEffect, useMemo, useState } from "react";
import { RecipePicker } from "./RecipePicker.jsx";
import { ConfirmDialog } from "./WeekPresentation.jsx";

export function WeekMealAssignmentPanel({
  archiveDocs,
  canDeleteWeek,
  components,
  initialMealStyle,
  onAddRecipe,
  onAssignRecipe,
  onClearWeek,
  onClose,
  onDeleteWeek,
  onRecipeDragEnd,
  onRecipeDragStart,
  onRemoveComponent,
  onSetTitleOnlyMeal,
  pickerProps,
  selectedRow,
}) {
  const [titleOnlyMeal, setTitleOnlyMeal] = useState("");
  const [weekActionsOpen, setWeekActionsOpen] = useState(false);
  const [mealStyle, setMealStyle] = useState("complete");
  const [componentRole, setComponentRole] = useState("main");

  useEffect(() => {
    setTitleOnlyMeal("");
    setWeekActionsOpen(false);
    setMealStyle(initialMealStyle);
    setComponentRole(initialMealStyle === "hybrid" ? "side" : "main");
  }, [initialMealStyle, selectedRow?.Day]);

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
      <div className="meal-style-picker" aria-label="Meal style">
        {[
          ["complete", "Add complete recipe", "One recipe represents the whole meal."],
          ["composed", "Build from components", "Combine a main, sides, sauces, and extras."],
          ["hybrid", "Add sides to selected recipe", "Keep the complete recipe and attach optional extras."],
        ].map(([value, label, help]) => (
          <button
            aria-pressed={mealStyle === value}
            className={mealStyle === value ? "active" : ""}
            key={value}
            onClick={() => {
              setMealStyle(value);
              setComponentRole(value === "hybrid" ? "side" : "main");
            }}
            type="button"
          >
            <strong>{label}</strong>
            <span>{help}</span>
          </button>
        ))}
      </div>
      {mealStyle !== "complete" ? (
        <label className="meal-component-role">
          Add selected recipe as
          <select onChange={(event) => setComponentRole(event.target.value)} value={componentRole}>
            <option value="main">Main</option>
            <option value="side">Side</option>
            <option value="sauce">Sauce</option>
            <option value="bread">Bread</option>
            <option value="dessert">Dessert</option>
            <option value="drink">Drink</option>
          </select>
        </label>
      ) : null}
      {components.length ? (
        <div className="planned-meal-components">
          <h4>Attached recipes</h4>
          {components.map((component, index) => {
            const doc = archiveDocs.find((candidate) => candidate.id === component.recipeId || candidate.recipe?.id === component.recipeId);
            return (
              <div key={`${component.recipeId}-${component.role}-${index}`}>
                <span><strong>{formatCategoryLabel(component.role)}</strong> · {doc?.title || component.recipeId}</span>
                <button className="mini-button" onClick={() => onRemoveComponent(index)} type="button">Remove</button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="week-planner-grid">
        <div className="week-planner-choice">
          <div className="field-group-heading">
            <h4>Use Saved Recipe</h4>
            <span className="pill">{archiveDocs.length} available</span>
          </div>
          {archiveDocs.length ? (
            <RecipePicker
              actionLabel={mealStyle === "complete" ? "Use for this day" : `Add as ${formatLabel(componentRole)}`}
              docs={archiveDocs}
              {...pickerProps}
              onChoose={(doc) => onAssignRecipe(doc, { mealStyle, role: mealStyle === "complete" ? "complete" : componentRole })}
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

export function WeekCreator({ createWeekShell, formatDate, getDefaults, onClose, onCreateWeek, open, weeks }) {
  const defaults = useMemo(() => getDefaults(weeks), [getDefaults, weeks]);
  const [mode, setMode] = useState("next");
  const [year, setYear] = useState(String(defaults.year));
  const [weekNumber, setWeekNumber] = useState(String(defaults.weekNumber));
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const previewWeek = createWeekShell({ startDate, weekNumber, year });
  const duplicateWeek = weeks.find((week) => week.id === previewWeek.id);

  useEffect(() => {
    if (!open) {
      return;
    }
    const nextDefaults = getDefaults(weeks);
    setMode("next");
    setYear(String(nextDefaults.year));
    setWeekNumber(String(nextDefaults.weekNumber));
    setStartDate(nextDefaults.startDate);
    setDuplicateConfirmOpen(false);
  }, [getDefaults, open, weeks]);

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
            <span>Starts {formatDate(previewWeek.startDate)}</span>
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

function RecipeZeroState({ onAddRecipe, subtitle, title }) {
  return <div className="zero-state"><h3>{title}</h3><p>{subtitle}</p><button className="primary-button" onClick={onAddRecipe} type="button">Add Recipe</button></div>;
}

function formatLabel(value) { return String(value || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
const formatCategoryLabel = formatLabel;
