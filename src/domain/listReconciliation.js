export function normalizeListIdentity(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function groceryItemStableKey(weekId, section, item) {
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
  return [
    weekId,
    "prep",
    normalizeListIdentity(section?.title || "Prep"),
    normalizeListIdentity(task?.title),
    normalizeListIdentity(prepMealOwnership(task?.details)),
  ].join("|");
}

export function reconcileGrocerySnapshot({ generatedSections = [], previousState = {}, weekId }) {
  const previousSections = previousState.sections || [];
  const checkedIdentities = checkedGroceryIdentities(previousSections, previousState.checkedKeys || [], weekId);
  const sections = appendManualSectionItems(generatedSections, previousSections);
  const checkedKeys = [];
  sections.forEach((section) => {
    (section.items || []).forEach((item) => {
      const key = groceryItemStableKey(weekId, section, item);
      if (checkedIdentities.has(groceryIdentity(section, item))) checkedKeys.push(key);
    });
  });
  return {
    checkedKeys,
    manualItems: previousState.manualItems || [],
    sections,
  };
}

export function reconcilePrepCheckedKeys({ generatedSections = [], parseTasks, previousState = {}, weekId }) {
  const checkedIdentities = new Set();
  (previousState.sections || []).forEach((section) => {
    (parseTasks(section.markdown) || []).forEach((task) => {
      const stableKey = prepTaskStableKey(weekId, section, task);
      const legacyKey = [weekId, section.title, task.index, task.title].join("|");
      if ((previousState.checkedKeys || []).includes(stableKey) || (previousState.checkedKeys || []).includes(legacyKey)) {
        checkedIdentities.add(prepIdentity(section, task));
      }
    });
  });
  const checkedKeys = [];
  generatedSections.forEach((section) => {
    (parseTasks(section.markdown) || []).forEach((task) => {
      if (checkedIdentities.has(prepIdentity(section, task))) {
        checkedKeys.push(prepTaskStableKey(weekId, section, task));
      }
    });
  });
  return checkedKeys;
}

export function parsePrepTasksForIdentity(markdown) {
  const tasks = [];
  let current = null;
  String(markdown || "").split("\n").forEach((line) => {
    const match = line.match(/^\s*-\s*\[[ xX]\]\s+(.+)$/);
    if (match) {
      current = { index: tasks.length, title: match[1].trim(), details: [] };
      tasks.push(current);
    } else if (current) {
      current.details.push(line.replace(/^\s{2}/, ""));
    }
  });
  return tasks.map((task) => ({ ...task, details: task.details.join("\n").trim() }));
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

function appendManualSectionItems(generatedSections, previousSections) {
  const sections = generatedSections.map((section) => ({
    ...section,
    items: (section.items || []).map((item) => ({ ...item })),
  }));
  previousSections.forEach((section) => {
    (section.items || []).filter((item) => item?._manualId).forEach((item) => {
      let target = sections.find((candidate) => normalizeListIdentity(candidate.title) === normalizeListIdentity(section.title));
      if (!target) {
        target = { title: section.title || "Other", items: [] };
        sections.push(target);
      }
      if (!target.items.some((candidate) => candidate._manualId === item._manualId)) target.items.push({ ...item });
    });
  });
  return sections;
}

function groceryIdentity(section, item) {
  return item?._manualId
    ? `manual|${item._manualId}`
    : `${normalizeListIdentity(section?.title)}|${normalizeListIdentity(item?.Item)}`;
}

function prepIdentity(section, task) {
  return [
    normalizeListIdentity(section?.title),
    normalizeListIdentity(task?.title),
    normalizeListIdentity(prepMealOwnership(task?.details)),
  ].join("|");
}

function prepMealOwnership(details) {
  return String(details || "").match(/^-\s+Meal ownership:\s*(.+)$/im)?.[1]?.trim() || "";
}
