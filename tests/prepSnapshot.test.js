import test from "node:test";
import assert from "node:assert/strict";
import { prepTaskStableKey } from "../src/domain/listReconciliation.js";
import { parsePrepTasks } from "../src/domain/prepTasks.js";
import { addPrepTaskState, initializePrepSnapshot, prepSectionsForState, reconcilePrepSnapshot, removePrepTaskState, updatePrepTaskState } from "../src/domain/prepSnapshot.js";

const weekId = "week-47";
const original = [{ title: "Sunday Prep", markdown: "- [ ] Chop onions\n  - Instructions: Dice onions.\n  - Meal ownership: Fajitas\n- [ ] Thaw salmon\n  - Meal ownership: Salmon" }];
const keyAt = (state, sectionIndex = 0, taskIndex = 0) => prepTaskStableKey(weekId, state.sections[sectionIndex], parsePrepTasks(state.sections[sectionIndex].markdown)[taskIndex]);
const generated = () => reconcilePrepSnapshot({ generatedSections: original, weekId });
const regenerate = (state, sections = original) => reconcilePrepSnapshot({ generatedSections: sections, previousState: state, previousGeneratedSections: original, weekId });
const allTasks = (state) => state.sections.flatMap((section) => parsePrepTasks(section.markdown));

test("edit and move preserve identity, checked state, and replacement across repeated regeneration", () => {
  let state = generated();
  const key = keyAt(state);
  state.checkedKeys = [key];
  state = updatePrepTaskState(state, state.sections, key, { title: "Slice peppers instead", section: "Wednesday Refresh", details: "- Instructions: Slice peppers.\n- Meal ownership: Fajitas" });
  state = regenerate(regenerate(state));
  assert.equal(allTasks(state).length, 2);
  assert.equal(state.sections.find((section) => section.title === "Wednesday Refresh")?.markdown.includes("Slice peppers instead"), true);
  assert.equal(allTasks(state).find((task) => task.title === "Slice peppers instead").key, key);
  assert.deepEqual(state.checkedKeys, [key]);
  assert.equal(state.sections.some((section) => section.markdown.includes("Chop onions")), false);
});

test("remove using the displayed stable key persists; deleting every task stays empty", () => {
  let state = generated();
  const key = keyAt(state);
  state.checkedKeys = [key];
  state = removePrepTaskState(state, state.sections, key);
  state = regenerate(state);
  assert.deepEqual(allTasks(state).map((task) => task.title), ["Thaw salmon"]);
  assert.deepEqual(state.checkedKeys, []);
  state = removePrepTaskState(state, state.sections, keyAt(state));
  assert.deepEqual(prepSectionsForState(state, original), []);
  assert.deepEqual(regenerate(state).sections, []);
});

test("manual tasks survive updates, can be edited/deleted, and duplicate titles have unique IDs", () => {
  let state = generated();
  const form = { title: "Check freezer", section: "Before Sunday", details: "Look for chicken." };
  state = addPrepTaskState(state, state.sections, form, weekId, "first");
  state = addPrepTaskState(state, state.sections, form, weekId, "second");
  state = regenerate(state);
  const manual = allTasks(state).filter((task) => task.title === form.title);
  assert.equal(manual.length, 2);
  assert.notEqual(manual[0].key, manual[1].key);
  state = updatePrepTaskState(state, state.sections, manual[0].key, { ...form, title: "Check fridge" });
  state = removePrepTaskState(state, state.sections, manual[1].key);
  state = regenerate(regenerate(state));
  assert.deepEqual(allTasks(state).filter((task) => task.key.includes("manual")).map((task) => task.title), ["Check fridge"]);
});

test("legacy custom additions and edited instructions survive first regeneration", () => {
  const sections = [{ ...original[0], markdown: original[0].markdown.replace("Dice onions.", "Use a sealed box.") }, { title: "Custom Nov 15", markdown: "- [ ] Custom thaw plan\n  - Instructions: Thaw Saturday." }];
  let state = regenerate({ sections, checkedKeys: [], updatedAt: "2026-11-12" });
  state = regenerate(state);
  assert.ok(allTasks(state).some((task) => task.details.includes("Use a sealed box.")));
  assert.ok(allTasks(state).some((task) => task.title === "Custom thaw plan"));
});

test("legacy empty saved snapshot is authoritative; uninitialized state uses fallback", () => {
  assert.deepEqual(prepSectionsForState({ sections: [] }, original), original);
  assert.deepEqual(prepSectionsForState({ sections: [], generatedAt: "today" }, original), []);
  const state = regenerate({ sections: [], checkedKeys: [], generatedAt: "today" });
  assert.deepEqual(state.sections, []);
});

test("obsolete generated tasks disappear, manual tasks remain, and edits return only if source returns", () => {
  let state = generated();
  const key = keyAt(state);
  state = updatePrepTaskState(state, state.sections, key, { title: "Edited onions", section: "Sunday Prep", details: "" });
  state = addPrepTaskState(state, state.sections, { title: "Buy containers", section: "Custom", details: "" }, weekId, "containers");
  state = regenerate(state, []);
  assert.deepEqual(allTasks(state).map((task) => task.title), ["Buy containers"]);
  state = regenerate(state);
  assert.ok(allTasks(state).some((task) => task.title === "Edited onions"));
});

test("legacy positional checks migrate and task identity metadata is not shown as details", () => {
  const legacyKey = [weekId, original[0].title, 0, "Chop onions"].join("|");
  const state = regenerate({ sections: original, checkedKeys: [legacyKey] });
  assert.equal(state.checkedKeys.length, 1);
  assert.equal(state.checkedKeys[0], keyAt(state));
  assert.ok(!allTasks(state)[0].details.includes("prep-key"));
});

test("invalid edit/remove rejects rather than pretending a save succeeded", () => {
  const state = generated();
  assert.throws(() => removePrepTaskState(state, state.sections, "week-47|prep|missing"));
  assert.throws(() => updatePrepTaskState(state, state.sections, "week-47|prep|missing", { title: "No", section: "No", details: "" }));
});

test("editing preserves unrelated prose sections and does not mutate its inputs", () => {
  const sourceSections = [...original, { title: "Notes", markdown: "Keep food chilled." }];
  let state = initializePrepSnapshot({ sourceSections, currentState: { sections: sourceSections }, previousGeneratedSections: original, weekId });
  const before = JSON.stringify(state);
  const next = updatePrepTaskState(state, state.sections, keyAt(state), { title: "Dice onions", section: "Sunday Prep", details: "" });
  assert.equal(JSON.stringify(state), before);
  assert.ok(next.sections.some((section) => section.markdown === "Keep food chilled."));
});


test("legacy check-only state does not hide fallback tasks; initializing preserves them", () => {
  const checkOnly = { sections: [], checkedKeys: [], updatedAt: "today" };
  assert.deepEqual(prepSectionsForState(checkOnly, original), original);
  const state = initializePrepSnapshot({ currentState: checkOnly, sourceSections: original, previousGeneratedSections: original, weekId });
  const afterCheck = { ...state, checkedKeys: [keyAt(state)] };
  assert.equal(allTasks(afterCheck).length, 2);
  assert.equal(allTasks(regenerate(afterCheck)).length, 2);
  assert.equal(allTasks(regenerate({ ...afterCheck, checkedKeys: [] })).length, 2);
});


test("section introductions survive editing and repeated regeneration", () => {
  const sections = [{ title: "Sunday Prep", markdown: "## Important\nKeep the raw meat cold.\n\n" + original[0].markdown }];
  let state = reconcilePrepSnapshot({ generatedSections: sections, weekId });
  state = updatePrepTaskState(state, state.sections, keyAt(state), { title: "Dice onions", section: "Sunday Prep", details: "" });
  state = regenerate(regenerate(state, sections), sections);
  assert.equal(state.sections[0].markdown.split("Keep the raw meat cold.").length - 1, 1);
  assert.ok(state.sections[0].markdown.startsWith("## Important"));
});


test("rescheduling uniquely identified generated tasks preserves edits and removals", () => {
  let state = generated();
  const first = keyAt(state);
  const second = keyAt(state, 0, 1);
  state = updatePrepTaskState(state, state.sections, first, { title: "Edited onions", section: "Custom", details: "Use strips." });
  state = removePrepTaskState(state, state.sections, second);
  const moved = [{ ...original[0], title: "Midweek Refresh" }];
  state = regenerate(state, moved);
  state = regenerate(state, moved);
  assert.deepEqual(allTasks(state).map((task) => task.title), ["Edited onions"]);
  assert.equal(allTasks(state)[0].key, first);
});
