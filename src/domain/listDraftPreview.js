import { groceryItemStableKey, prepTaskStableKey, normalizeListIdentity } from "./listReconciliation.js";
import { parsePrepTasks } from "./prepTasks.js";

const groceryFields = ["Item", "Quantity", "Preferred version/type", "Acceptable alternatives", "Recipe"];
function groceryEntries(sections, weekId) {
  return sections.flatMap((section) => (section.items || []).map((item) => ({
    key: groceryItemStableKey(weekId, section, item),
    text: [`Category: ${section.title || "Other"}`, ...[...groceryFields, ...Object.keys(item).filter((field) => !field.startsWith("_") && !groceryFields.includes(field)).sort()].filter((field) => item[field] !== undefined && item[field] !== null && item[field] !== "").map((field) => `${field}: ${item[field]}`)].join("\n"),
  })));
}
function prepEntries(sections, weekId) {
  return sections.flatMap((section) => {
    const markdown = String(section.markdown || "").replace(/\r\n/g, "\n");
    const firstTask = markdown.search(/^[-*+]\s+\[[ xX]\]\s+/m);
    const notes = (firstTask < 0 ? markdown : markdown.slice(0, firstTask)).trim();
    const entries = parsePrepTasks(markdown).map((task) => ({
      key: prepTaskStableKey(weekId, section, task),
      text: [`Section: ${section.title || "Prep"}`, task.title, task.details].filter(Boolean).join("\n"),
    }));
    if (notes) entries.unshift({ key: `${weekId}|prep-notes|${normalizeListIdentity(section.title)}`, text: `Section: ${section.title || "Prep"}\n${notes}` });
    return entries;
  });
}
// Occurrence suffixes keep duplicated legacy identities visible instead of silently
// dropping one through Map de-duplication. Neither input is changed.
function keyed(entries) {
  const counts = new Map();
  return new Map(entries.map(({ key, text }) => {
    const count = counts.get(key) || 0;
    counts.set(key, count + 1);
    return [`${key}|occurrence:${count}`, text];
  }));
}
function compare(beforeEntries, afterEntries) {
  const before = keyed(beforeEntries);
  const after = keyed(afterEntries);
  const changes = [];
  for (const [key, text] of before) {
    if (!after.has(key)) changes.push({ key, kind: "removed", before: text, after: "" });
    else if (after.get(key) !== text) changes.push({ key, kind: "modified", before: text, after: after.get(key) });
  }
  for (const [key, text] of after) if (!before.has(key)) changes.push({ key, kind: "added", before: "", after: text });
  return { changes, added: changes.filter((change) => change.kind === "added").length, removed: changes.filter((change) => change.kind === "removed").length, modified: changes.filter((change) => change.kind === "modified").length };
}
export function buildListDraftPreview({ weekId, previousGrocerySections = [], previousPrepSections = [], grocerySnapshot = {}, prepSnapshot = {} }) {
  const grocery = compare(groceryEntries(previousGrocerySections, weekId), groceryEntries(grocerySnapshot.sections || [], weekId));
  const prep = compare(prepEntries(previousPrepSections, weekId), prepEntries(prepSnapshot.sections || [], weekId));
  return { grocery, prep, hasChanges: Boolean(grocery.changes.length || prep.changes.length) };
}
