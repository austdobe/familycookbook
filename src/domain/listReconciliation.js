import { mergeGroceryEdits } from "./groceryEdits.js";
import { parsePrepTasks } from "./prepTasks.js";

export function normalizeListIdentity(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function groceryItemStableKey(weekId, section, item) {
  if (item?._grocerySourceKey) return item._grocerySourceKey;
  if (item?._manualId) {
    return `${weekId}|grocery|manual|${item._manualId}`;
  }
  return [
    weekId,
    "grocery",
    normalizeListIdentity(section?.title || "Other"),
    normalizeListIdentity(item?.Item),
  ].join("|");
}

export function prepTaskStableKey(weekId, section, task) {
  if (task?.key?.startsWith(`${weekId}|prep|`)) return task.key;
  return [
    weekId,
    "prep",
    normalizeListIdentity(section?.title || "Prep"),
    normalizeListIdentity(task?.title),
    normalizeListIdentity(prepMealOwnership(task?.details)),
  ].join("|");
}

export function reconcileGrocerySnapshot({ generatedSections = [], previousState = {}, previousGeneratedSections = [], weekId }) {
  const previousSections = previousState.sections || [];
  const checkedIdentities = checkedGroceryIdentities(previousSections, previousState.checkedKeys || [], weekId);
  const merged = mergeGroceryEdits({ generatedSections, previousState, previousGeneratedSections, weekId });
  const { sections } = merged;
  const checkedKeys = [];
  sections.forEach((section) => {
    (section.items || []).forEach((item) => {
      const key = groceryItemStableKey(weekId, section, item);
      if (checkedIdentities.has(groceryIdentity(section, item))) checkedKeys.push(key);
    });
  });
  return {
    ...merged,
    checkedKeys,
    manualItems: previousState.manualItems || [],
    sections,
  };
}

export function reconcilePrepCheckedKeys({ generatedSections = [], parseTasks = parsePrepTasksForIdentity, previousState = {}, weekId }) {
  const checkedIdentities = new Set();
  (previousState.sections || []).forEach((section) => {
    (parseTasks(section.markdown) || []).forEach((task) => {
      const stableKey = prepTaskStableKey(weekId, section, task);
      const legacyKey = [weekId, section.title, task.index, task.title].join("|");
      if ((previousState.checkedKeys || []).includes(stableKey) || (previousState.checkedKeys || []).includes(legacyKey)) {
        checkedIdentities.add(stableKey);
      }
    });
  });
  const checkedKeys = [];
  generatedSections.forEach((section) => {
    (parseTasks(section.markdown) || []).forEach((task) => {
      if (checkedIdentities.has(prepTaskStableKey(weekId, section, task))) {
        checkedKeys.push(prepTaskStableKey(weekId, section, task));
      }
    });
  });
  return checkedKeys;
}

export function parsePrepTasksForIdentity(markdown) {
  return parsePrepTasks(markdown);
}

function checkedGroceryIdentities(sections, checkedKeys, weekId) {
  const checked = new Set(checkedKeys);
  const identities = new Set();
  sections.forEach((section, sectionIndex) => {
    (section.items || []).forEach((item, itemIndex) => {
      const stableKey = groceryItemStableKey(weekId, section, item);
      const legacyKey = [weekId, sectionIndex, section.title, itemIndex, item.Quantity, item.Item, item.Recipe].join("|");
      if (checked.has(stableKey) || checked.has(legacyKey)) identities.add(groceryIdentity(section, item));
    });
  });
  return identities;
}

function groceryIdentity(section, item) {
  if (item?._grocerySourceKey) return item._grocerySourceKey.split("|grocery|")[1];
  return item?._manualId
    ? `manual|${item._manualId}`
    : `${normalizeListIdentity(section?.title)}|${normalizeListIdentity(item?.Item)}`;
}

function prepMealOwnership(details) {
  return String(details || "").match(/^-\s+Meal ownership:\s*(.+)$/im)?.[1]?.trim() || "";
}
