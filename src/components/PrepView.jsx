import React, { useEffect, useRef, useState } from "react";
import { prepTaskStableKey } from "../domain/listReconciliation.js";
import { parsePrepTasks, prepDetailValue } from "../domain/prepTasks.js";
import { addPrepTaskState, updatePrepTaskState, removePrepTaskState, initializePrepSnapshot, prepSectionsForState } from "../domain/prepSnapshot.js";
import { markdownToHtml } from "../services/markdown.js";
import { savePrepState, subscribePrepState } from "../services/prepStore.js";

export function PrepView({ isSealed = false, search, week }) {
  const [prepState, setPrepState] = useState({ checkedKeys: [], sections: [] });
  const [loadedWeekId, setLoadedWeekId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const currentWeekId = useRef(week?.id);
  currentWeekId.current = week?.id;
  const [prepDialogOpen, setPrepDialogOpen] = useState(false);
  const [editingPrepKey, setEditingPrepKey] = useState("");
  const [prepForm, setPrepForm] = useState(emptyPrepForm());

  useEffect(() => {
    if (!week) {
      return undefined;
    }
    setPrepDialogOpen(false);
    setEditingPrepKey("");
    setSaveError("");
    return subscribePrepState(week.id, (state) => {
      if (currentWeekId.current !== week.id) return;
      setPrepState(state);
      setLoadedWeekId(week.id);
    });
  }, [week?.id]);

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

  if (loadedWeekId !== week.id) return <div className="empty" role="status">Loading prep checklist...</div>;

  const sourcePrepSections = prepSectionsForState(prepState, week.prepSections);
  const editablePrepState = initializePrepSnapshot({ currentState: prepState, sourceSections: sourcePrepSections, previousGeneratedSections: week.prepSections, weekId: week.id });
  const sections = sourcePrepSections.filter((section) => matchesSearch(`${section.title} ${section.markdown}`, search));
  const checkedKeys = new Set(prepState.checkedKeys || []);
  const sectionOptions = prepSectionOptions(sourcePrepSections);
  const persistChange = async (change, close = false) => {
    if (isSealed || savingRef.current) return;
    const savingWeekId = week.id;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await savePrepState(savingWeekId, change());
      if (close && currentWeekId.current === savingWeekId) closePrepDialog();
    } catch (error) {
      if (currentWeekId.current === savingWeekId) setSaveError(error.message || "Unable to save prep changes. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const closePrepDialog = () => {
    setPrepDialogOpen(false);
    setEditingPrepKey("");
  };
  const openAddPrepDialog = () => {
    if (isSealed) {
      return;
    }
    setEditingPrepKey("");
    setPrepForm(emptyPrepForm(sectionOptions[0] || "Sunday Prep"));
    setPrepDialogOpen(true);
  };
  const openEditPrepDialog = (section, task) => {
    if (isSealed) {
      return;
    }
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
    if (isSealed || !prepForm.title.trim()) {
      return;
    }

    await persistChange(() => editingPrepKey
      ? updatePrepTaskState(editablePrepState, sourcePrepSections, editingPrepKey, prepForm)
      : addPrepTaskState(editablePrepState, sourcePrepSections, prepForm, week.id), true);
  };

  return (
    <div className="stack">
      {saveError && !prepDialogOpen ? <p role="alert">{saveError}</p> : null}
      <section className="card prep-toolbar">
        <div>
          <h3>Prep Checklist</h3>
          <p>{isSealed ? "This prep list is sealed for this week." : "Prep checks stay saved for this week."}</p>
        </div>
        <div className="grocery-toolbar-actions">
          <button className="quiet-button" disabled={isSealed || saving} onClick={openAddPrepDialog} type="button">Add Prep</button>
          <button className="quiet-button" disabled={isSealed || saving} onClick={() => persistChange(() => ({ ...editablePrepState, checkedKeys: [] }))} type="button">Clear Checks</button>
        </div>
      </section>

      {sections.length ? sections.map((section) => (
        <PrepSection
          checkedKeys={checkedKeys}
          key={section.title}
          onEdit={(task) => openEditPrepDialog(section, task)}
          onRemove={(task) => persistChange(() => removePrepTaskState(editablePrepState, sourcePrepSections, prepTaskKey(week, section, task)))}
          onToggle={(task, checked) => persistChange(() => {
            const keys = new Set(editablePrepState.checkedKeys || []);
            const key = prepTaskKey(week, section, task);
            if (checked) keys.add(key); else keys.delete(key);
            return { ...editablePrepState, checkedKeys: [...keys] };
          })}
          isSealed={isSealed || saving}
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
            {saveError ? <p role="alert">{saveError}</p> : null}
            <div className="dialog-actions">
              {editingPrepKey ? (
                <button
                  className="mini-button"
                  disabled={saving}
                  onClick={async () => {
                    if (isSealed) {
                      return;
                    }
                    await persistChange(() => removePrepTaskState(editablePrepState, sourcePrepSections, editingPrepKey), true);
                  }}
                  type="button"
                >
                  Remove
                </button>
              ) : null}
              <button className="quiet-button" onClick={closePrepDialog} type="button">Cancel</button>
              <button className="primary-button" disabled={saving} type="submit">{saving ? "Saving..." : editingPrepKey ? "Save" : "Add"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function PrepSection({ checkedKeys, isSealed = false, onEdit, onRemove, onToggle, section, week }) {
  const tasks = parsePrepTasks(section.markdown);

  if (!tasks.length) {
    return <article className="doc" dangerouslySetInnerHTML={{ __html: markdownToHtml(`# ${section.title}\n\n${section.markdown}`) }} />;
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
            <div className={`card prep-task ${checked ? "prep-checked" : ""}`} key={taskKey}>
              <input
                checked={checked}
                disabled={isSealed}
                onChange={(event) => onToggle(task, event.target.checked)}
                type="checkbox"
              />
              <span className="prep-task-body">
                <span className="prep-task-title">{prepTaskTitleForDisplay(task.title)}</span>
                {task.details ? (
                  <details className="prep-task-detail">
                    <summary>{prepTaskSummary(task.details)}</summary>
                    <span dangerouslySetInnerHTML={{ __html: markdownToHtml(prepTaskDetailsForDisplay(task.details)) }} />
                  </details>
                ) : null}
              </span>
              <span className="grocery-row-actions">
                <button className="mini-button neutral" disabled={isSealed} onClick={(event) => {
                  event.preventDefault();
                  onEdit(task);
                }} type="button">Edit</button>
                <button className="mini-button" disabled={isSealed} onClick={(event) => {
                  event.preventDefault();
                  onRemove(task);
                }} type="button">Remove</button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
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

function emptyPrepForm(section = "Sunday Prep") {
  return { details: "", section, title: "" };
}

function prepTaskSummary(details) {
  const summary = prepDetailValue(details, "Instructions") || prepDetailValue(details, "Ingredients") || "View details";
  return summary.replace(/\.{2,}$/, ".");
}

function prepTaskTitleForDisplay(value) {
  return String(value || "").replace(/\.+$/, "");
}

function prepTaskDetailsForDisplay(value) {
  return String(value || "").replace(/\.{2,}(?=\s*$)/gm, ".");
}

function prepTaskKey(week, section, task) {
  return prepTaskStableKey(week.id, section, task);
}

function matchesSearch(text, search) {
  return !search || String(text || "").toLowerCase().includes(String(search).toLowerCase());
}

function uniqueValues(values) { return [...new Set(values)]; }
