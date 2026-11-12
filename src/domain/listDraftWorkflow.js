export function draftFingerprint(value) {
  if (Array.isArray(value)) return `[${value.map(draftFingerprint).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${draftFingerprint(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// Meal edits intentionally have no list-store or list-generation dependencies.
export async function savePlanningMenu({ week, menuRows, recipePaths, onSaveWorkingWeek, saveWeekPlanState }) {
  const nextWeek = { ...week, meals: menuRows, menuRows, weeklyMenu: menuRows, recipePaths,
    title: week.title || week.packet?.title || week.label, updatedAt: new Date().toISOString() };
  await Promise.all([onSaveWorkingWeek(nextWeek), saveWeekPlanState(week.id, { menuRows })]);
  return nextWeek;
}

export async function applyReviewedLists({ draft, getContext, readLists, saveGrocery, savePrep }) {
  const stale = () => getContext() !== draft.context;
  if (stale()) throw new Error("The plan changed after preview. Generate a fresh draft; no lists were applied.");
  const current = await readLists();
  if (stale() || draftFingerprint(current) !== draftFingerprint(draft.original)) {
    throw new Error("The plan or lists changed after preview. Generate a fresh draft; no lists were applied.");
  }
  const results = await Promise.allSettled([Promise.resolve().then(() => saveGrocery(draft.grocery)), Promise.resolve().then(() => savePrep(draft.prep))]);
  if (results.some((result) => result.status === "rejected")) {
    const saved = results.map((result, index) => result.status === "fulfilled" ? ["Grocery", "Prep"][index] : null).filter(Boolean);
    throw new Error(`${saved.length ? `${saved.join(" and ")} list applied, but the other list could not be saved.` : "Lists could not be saved."} Check the lists and cloud status, then generate a fresh draft before retrying.`);
  }
}
