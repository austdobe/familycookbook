import React, { useEffect, useState } from "react";

export function CardEditDialog({ canDeleteCard, onClearCard, onClose, onDeleteCard, onRenameCard, open, row }) {
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

export function ConfirmDialog({ action, onCancel, onConfirm }) {
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

export function WeekActionMenu({
  isSealed,
  menuOpen,
  onAddRecipe,
  onAddWeek,
  onEditWeek,
  onRequestUnsealWeek,
  onRateRecipe,
  onSealWeek,
  selectedRecipe,
  setMenuOpen,
}) {
  return (
    <div className="action-fab-wrap week-action-fab-wrap">
      {menuOpen ? (
        <div className="action-menu" role="menu">
          <button onClick={onAddWeek} role="menuitem" type="button">Add Week</button>
          <button disabled={isSealed} onClick={onEditWeek} role="menuitem" type="button">Edit Week</button>
          <button onClick={isSealed ? onRequestUnsealWeek : onSealWeek} role="menuitem" type="button">
            {isSealed ? "Unseal Week Lists" : "Seal Week Lists"}
          </button>
          <button onClick={onAddRecipe} role="menuitem" type="button">Create New Recipe</button>
          <button disabled={!selectedRecipe} onClick={onRateRecipe} role="menuitem" type="button">Rate Selected Recipe</button>
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

export function DayCard({
  activeDocId,
  canDrag,
  componentDocs,
  dayDragType,
  doc,
  draggingDay,
  draggingRecipeId,
  editMode,
  isSealed = false,
  missingSelectionId,
  onDragEnd,
  onDragStart,
  onDropMeal,
  onDropRecipe,
  onEditCard,
  onSelect,
  recipeDragType,
  row,
  selectedDay,
  selectedDoc,
}) {
  const [recipesExpanded, setRecipesExpanded] = useState(false);
  const isDragging = draggingDay === row.Day;
  const isRecipeDropTarget = !isSealed && Boolean(draggingRecipeId);
  const isDropTarget = isRecipeDropTarget || Boolean(!isSealed && draggingDay && draggingDay !== row.Day);
  const isActive = row.Day === selectedDay
    || (selectedDoc && doc && selectedDoc.id === doc.id)
    || (!doc && activeDocId === missingSelectionId);
  const selectCard = () => onSelect(doc ? doc.id : missingSelectionId, row, 0);

  return (
    <div
      className={`item-card day-card ${isActive ? "active" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "drop-target" : ""}`}
      draggable={canDrag}
      onClick={selectCard}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        const dragTypes = Array.from(event.dataTransfer.types || []);
        if (!isSealed && (dragTypes.includes(recipeDragType) || draggingRecipeId || (draggingDay && draggingDay !== row.Day))) {
          event.preventDefault();
          event.dataTransfer.dropEffect = dragTypes.includes(recipeDragType) || draggingRecipeId ? "copy" : "move";
        }
      }}
      onDragStart={(event) => {
        if (!canDrag) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(dayDragType, row.Day);
        event.dataTransfer.setData("text/plain", row.Day);
        onDragStart(row);
      }}
      onDrop={(event) => {
        const recipeId = event.dataTransfer.getData(recipeDragType) || draggingRecipeId;
        if (recipeId) {
          event.preventDefault();
          onDropRecipe(recipeId, row.Day);
          return;
        }
        const fromDay = event.dataTransfer.getData(dayDragType) || event.dataTransfer.getData("text/plain") || draggingDay;
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
      title={isSealed ? "Week lists are sealed" : isRecipeDropTarget ? "Drop this recipe here" : canDrag ? "Drag to move this meal to another day" : "Drop a meal here"}
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
        <span className="drag-hint">{isSealed ? "Sealed" : isRecipeDropTarget ? "Drop recipe" : canDrag ? "Drag" : "Drop here"}</span>
      </div>
      <h3>{row.Meal || "Open"}</h3>
      {componentDocs.length > 1 ? (
        <div className="day-card-recipes">
          <button
            aria-expanded={recipesExpanded}
            className="day-card-recipes-toggle"
            onClick={(event) => {
              event.stopPropagation();
              setRecipesExpanded((current) => !current);
            }}
            type="button"
          >
            {recipesExpanded ? "Hide recipes" : `Show all ${componentDocs.length} recipes`}
          </button>
          {recipesExpanded ? (
            <div className="day-card-recipe-list">
              {componentDocs.map((componentDoc, index) => (
                <button
                  key={`${componentDoc.id}-${index}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(componentDoc.id, row, index);
                  }}
                  type="button"
                >
                  <span>{index + 1}</span>
                  {componentDoc.title}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="meta-row">
        <span>{row.Protein || ""}</span>
        <span>{row["Cuisine/flavor"] || ""}</span>
      </div>
    </div>
  );
}

export function AddWeekCardButton({ onClick }) {
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
