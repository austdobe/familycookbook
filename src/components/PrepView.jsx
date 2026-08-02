import React, { useEffect, useState } from "react";
import { prepTaskStableKey } from "../domain/listReconciliation.js";
import { parsePrepTasks, prepDetailValue } from "../domain/prepTasks.js";
import { markdownToHtml } from "../services/markdown.js";
import { clearPrepState, savePrepState, subscribePrepState, togglePrepTask } from "../services/prepStore.js";

export function PrepView({ isSealed = false, search, week }) {
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
          <p>{isSealed ? "This prep list is sealed for this week." : "Prep checks stay saved for this week."}</p>
        </div>
        <div className="grocery-toolbar-actions">
          <button className="quiet-button" disabled={isSealed} onClick={openAddPrepDialog} type="button">Add Prep</button>
          <button className="quiet-button" disabled={isSealed} onClick={() => clearPrepState(week.id)} type="button">Clear Checks</button>
        </div>
      </section>

      {sections.length ? sections.map((section) => (
        <PrepSection
          checkedKeys={checkedKeys}
          key={section.title}
          onEdit={(task) => openEditPrepDialog(section, task)}
          onRemove={(task) => !isSealed && savePrepState(week.id, removePrepTaskState(prepState, sourcePrepSections, prepTaskKey(week, section, task)))}
          onToggle={(task, checked) => !isSealed && togglePrepTask(week.id, prepTaskKey(week, section, task), checked)}
          isSealed={isSealed}
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
                    if (isSealed) {
                      return;
                    }
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

function normalizeSectionName(value) {
  return String(value || "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function uniqueValues(values) { return [...new Set(values)]; }
