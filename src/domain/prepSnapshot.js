import { normalizeListIdentity, prepTaskStableKey, reconcilePrepCheckedKeys } from "./listReconciliation.js";
import { parsePrepTasks, serializePrepTasks } from "./prepTasks.js";

export function prepSectionsForState(state = {}, fallback = []) {
  const hasSnapshot = state.snapshotVersion === 1 || state.generatedAt || state.sections?.length;
  return hasSnapshot && Array.isArray(state.sections) ? state.sections : fallback || [];
}

function entries(sections, weekId) {
  return (sections || []).flatMap((section) => parsePrepTasks(section.markdown).map((task) => ({
    key: prepTaskStableKey(weekId, section, task), section: section.title, title: task.title, details: task.details,
  })));
}

function notes(sections) {
  return (sections || []).map((section) => {
    const lines = String(section.markdown || "").split("\n");
    const firstTask = lines.findIndex((line) => /^[-*+]\s+\[[ xX]\]\s+/.test(line));
    return { title: section.title, markdown: (firstTask < 0 ? lines : lines.slice(0, firstTask)).join("\n").trim() };
  }).filter((section) => section.markdown);
}

// Upgrade legacy snapshots lazily on the next user-authorized edit, not on read.
export function initializePrepSnapshot({ currentState = {}, sourceSections = [], previousGeneratedSections = [], weekId }) {
  if (currentState.snapshotVersion === 1) return currentState;
  const baseSections = currentState.generatedSections || previousGeneratedSections;
  const base = new Map(entries(baseSections, weekId).map((entry) => [entry.key, entry]));
  const current = entries(sourceSections, weekId);
  const present = new Set(current.map((entry) => entry.key));
  const hasSavedSnapshot = prepSectionsForState(currentState, null) === currentState.sections;
  return {
    ...currentState,
    snapshotVersion: 1,
    generatedSections: baseSections,
    sections: sourceSections,
    prepEdits: {
      additions: current.filter((entry) => !base.has(entry.key)),
      overrides: current.filter((entry) => base.has(entry.key) && (entry.details !== base.get(entry.key).details || entry.title !== base.get(entry.key).title || entry.section !== base.get(entry.key).section)),
      removedKeys: hasSavedSnapshot ? [...base.keys()].filter((key) => !present.has(key)) : [],
      notes: notes(sourceSections),
    },
  };
}

export function reconcilePrepSnapshot({ generatedSections = [], previousState = {}, previousGeneratedSections = [], weekId }) {
  const sourceSections = prepSectionsForState(previousState, previousGeneratedSections);
  const state = initializePrepSnapshot({ currentState: previousState, sourceSections, previousGeneratedSections, weekId });
  generatedSections = retainGeneratedTaskKeys(generatedSections, state.generatedSections || previousGeneratedSections, weekId);
  const edits = state.prepEdits;
  const removed = new Set(edits.removedKeys);
  const overrides = new Map(edits.overrides.map((entry) => [entry.key, entry]));
  const generated = entries(generatedSections, weekId).filter((entry) => !removed.has(entry.key)).map((entry) => overrides.get(entry.key) || entry);
  const generatedKeys = new Set(generated.map((entry) => entry.key));
  const combined = [...generated, ...edits.additions.filter((entry) => !removed.has(entry.key) && !generatedKeys.has(entry.key))];
  const sections = sectionsFromEntries(combined, [...notes(generatedSections), ...edits.notes]);
  return {
    ...state,
    generatedSections,
    sections,
    checkedKeys: reconcilePrepCheckedKeys({ generatedSections: sections, previousState: { ...state, sections: sourceSections }, weekId }),
  };
}

export function addPrepTaskState(state, sourceSections, form, weekId, id = globalThis.crypto.randomUUID()) {
  const entry = { ...fromForm(form), key: `${weekId}|prep|manual|${id}` };
  const next = { ...state, prepEdits: { ...state.prepEdits, additions: [...state.prepEdits.additions, entry] } };
  return { ...next, sections: sectionsFromEntries([...entries(sourceSections, weekId), entry], notes(sourceSections)) };
}

export function updatePrepTaskState(state, sourceSections, taskKey, form) {
  const weekId = taskKey.split("|")[0];
  const current = entries(sourceSections, weekId);
  if (!current.some((entry) => entry.key === taskKey)) throw new Error("This prep task changed. Close the editor and try again.");
  const entry = { ...fromForm(form), key: taskKey };
  const edits = state.prepEdits;
  const isManual = edits.additions.some((candidate) => candidate.key === taskKey);
  const nextEdits = {
    ...edits,
    additions: isManual ? edits.additions.map((candidate) => candidate.key === taskKey ? entry : candidate) : edits.additions,
    overrides: isManual ? edits.overrides : [...edits.overrides.filter((candidate) => candidate.key !== taskKey), entry],
  };
  return { ...state, prepEdits: nextEdits, sections: sectionsFromEntries(current.map((candidate) => candidate.key === taskKey ? entry : candidate), notes(sourceSections)) };
}

export function removePrepTaskState(state, sourceSections, taskKey) {
  const weekId = taskKey.split("|")[0];
  const current = entries(sourceSections, weekId);
  if (!current.some((entry) => entry.key === taskKey)) throw new Error("This prep task changed. Refresh the list and try again.");
  const edits = state.prepEdits;
  return {
    ...state,
    checkedKeys: (state.checkedKeys || []).filter((key) => key !== taskKey),
    prepEdits: {
      ...edits,
      additions: edits.additions.filter((entry) => entry.key !== taskKey),
      overrides: edits.overrides.filter((entry) => entry.key !== taskKey),
      removedKeys: [...new Set([...edits.removedKeys, taskKey])],
    },
    sections: sectionsFromEntries(current.filter((entry) => entry.key !== taskKey), notes(sourceSections)),
  };
}

function fromForm(form) {
  return { section: form.section.trim() || "Sunday Prep", title: form.title.trim(), details: form.details.trim() };
}

function sectionsFromEntries(tasks, noteSections = []) {
  const sections = [];
  for (const entry of tasks) {
    let section = sections.find((candidate) => normalizeListIdentity(candidate.title) === normalizeListIdentity(entry.section));
    if (!section) {
      section = { title: entry.section || "Prep", tasks: [] };
      sections.push(section);
    }
    section.tasks.push(entry);
  }
  const result = sections.map(({ title, tasks }) => ({ title, markdown: serializePrepTasks(tasks) }));
  const seenNotes = new Set();
  for (const note of noteSections) {
    const identity = `${normalizeListIdentity(note.title)}|${note.markdown}`;
    if (seenNotes.has(identity)) continue;
    seenNotes.add(identity);
    const section = result.find((candidate) => normalizeListIdentity(candidate.title) === normalizeListIdentity(note.title));
    if (section) section.markdown = `${note.markdown}\n\n${section.markdown}`;
    else result.push({ ...note });
  }
  return result;
}

// Rescheduling moves a task between sections without changing its identity.
// Match only unique title/meal pairs; ambiguity must not transfer an edit to another task.
function retainGeneratedTaskKeys(sections, previousSections, weekId) {
  const previous = entries(previousSections, weekId);
  const next = entries(sections, weekId);
  const identity = (entry) => `${normalizeListIdentity(entry.title)}|${normalizeListIdentity(entry.details.match(/^-\s+Meal ownership:\s*(.+)$/im)?.[1] || "")}`;
  const currentKeys = new Set(next.map((entry) => entry.key));
  const previousKeys = new Set(previous.map((entry) => entry.key));
  return sectionsFromEntries(next.map((entry) => {
    if (previousKeys.has(entry.key)) return entry;
    const matches = previous.filter((candidate) => identity(candidate) === identity(entry));
    if (matches.length !== 1 || next.filter((candidate) => identity(candidate) === identity(entry)).length !== 1 || currentKeys.has(matches[0].key)) return entry;
    return { ...entry, key: matches[0].key };
  }), notes(sections));
}
