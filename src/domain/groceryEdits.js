import { groceryItemStableKey, normalizeListIdentity } from "./listReconciliation.js";

const fields = ["Item", "Quantity", "Preferred version/type", "Acceptable alternatives", "Recipe"];
const cloneSections = (sections) => sections.map((section) => ({ ...section, items: (section.items || []).map((item) => ({ ...item })) }));
const entries = (sections, weekId) => sections.flatMap((section) => (section.items || []).map((item) => ({ section, item, key: groceryItemStableKey(weekId, section, item) })));

// Record only changed fields, so a preference edit does not freeze generated quantities.
export function recordGroceryEdit(item, oldSection, newSection, values, weekId, baselineItem = null) {
  if (item._manualId) return { ...item, ...values };
  const overrides = { ...(item._groceryOverrides || {}) };
  if (!item._groceryOverrides) {
    for (const field of baselineItem ? fields : ["Preferred version/type", "Acceptable alternatives"]) {
      if (baselineItem ? (item[field] || "") !== (baselineItem[field] || "") : Boolean(item[field])) overrides[field] = item[field] || "";
    }
  }
  for (const field of fields) if ((values[field] || "") !== (item[field] || "")) overrides[field] = values[field] || "";
  if (newSection !== oldSection) overrides.section = newSection;
  return { ...item, ...values, _grocerySourceKey: groceryItemStableKey(weekId, { title: oldSection }, item), _groceryOverrides: overrides };
}

export function mergeGroceryEdits({ generatedSections, previousState, previousGeneratedSections = [], weekId }) {
  const previous = entries(previousState.sections || [], weekId);
  const baseline = new Map(entries(previousState.generatedSections || previousGeneratedSections, weekId).map((entry) => [entry.key, entry.item]));
  const overrides = new Map(Object.entries(previousState.groceryOverrides || {}));
  for (const { item, key } of previous) {
    if (item._manualId) continue;
    const patch = { ...(item._groceryOverrides || {}) };
    if (!item._groceryOverrides) {
      const original = baseline.get(key);
      // Legacy snapshots without a trustworthy baseline preserve specifications,
      // but do not lock quantities or generated recipe ownership by guessing.
      for (const field of original ? fields : ["Preferred version/type", "Acceptable alternatives"]) {
        if (original ? (item[field] || "") !== (original[field] || "") : Boolean(item[field])) patch[field] = item[field] || "";
      }
    }
    overrides.set(key, patch);
  }
  const removed = new Set(previousState.removedGroceryKeys || []);
  const sections = [];
  const append = (title, item) => {
    let section = sections.find((candidate) => normalizeListIdentity(candidate.title) === normalizeListIdentity(title));
    if (!section) { section = { title, items: [] }; sections.push(section); }
    section.items.push(item);
  };
  for (const { section, item, key } of entries(generatedSections, weekId)) {
    if (removed.has(key)) continue;
    const patch = overrides.get(key) || {};
    const { section: targetSection, ...values } = patch;
    append(targetSection || section.title, { ...item, ...values, _grocerySourceKey: key, _groceryOverrides: patch });
  }
  const generatedKeys = new Set(entries(generatedSections, weekId).map((entry) => entry.key));
  for (const { section, item, key } of previous) {
    if (item._manualId) append(section.title, { ...item });
    else if (!item._grocerySourceKey && !item._groceryOverrides && baseline.size && !baseline.has(key) && !generatedKeys.has(key)) {
      // A legacy renamed/moved item cannot be mapped back reliably. Preserve it
      // as a manual row rather than silently discard the user's specification.
      append(section.title, { ...item, _manualId: `legacy-${encodeURIComponent(key)}`, _grocerySourceKey: key, _source: "manual" });
    }
  }
  return { sections, generatedSections: cloneSections(generatedSections), grocerySnapshotVersion: 1, removedGroceryKeys: [...removed], groceryOverrides: Object.fromEntries(overrides) };
}
