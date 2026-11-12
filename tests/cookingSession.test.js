import assert from "node:assert/strict";
import test from "node:test";
import { buildCookingPlan, changeCookingTaskState, cookingDuration, getCookingGuidance, sanitizeCookingStates } from "../src/domain/cookingSession.js";

const dish = (id, steps) => ({ id, title: id, steps });
const task = (text, durationMinutes, passive = false) => ({ text, durationMinutes, passive });

test("explicit duration ranges use recipe bounds, including mixed fractions and hours", () => {
  assert.deepEqual(cookingDuration({ text: "Bake for 20–25 minutes." }), { min: 20, max: 25, source: "recipe" });
  assert.deepEqual(cookingDuration({ text: "Roast 4 to 4 1/2 hours; check temperature." }), { min: 240, max: 270, source: "recipe" });
  assert.equal(cookingDuration({ text: "Rest ½ hour." }).max, 30);
  assert.equal(cookingDuration({ text: "Wait 1½ hours." }).max, 90);
  assert.deepEqual(cookingDuration({ text: "Unspecified", durationMinutes: 12 }), { min: 12, max: 12, source: "metadata" });
});

test("unknown, overlapping, conditional and invalid times never become invented estimates", () => {
  for (const text of ["Cook until tender", "Cook 10 minutes then rest 5 minutes", "Bake 1 hour 30 minutes", "Stir every 5 minutes", "Chill up to 4 hours", "Rest at least 10 minutes", "Cook 1/0 minutes", "Cook 9–4 minutes", "Bake at 400°F", "Cook 5 minutes per side", "Roast 15 minutes per pound", "Prep 30 minutes before serving", "Cook -5 minutes"]) {
    assert.equal(cookingDuration({ text }), null, text);
  }
  assert.equal(cookingDuration({ text: "Check it", durationMinutes: -1 }), null);
});

test("single recipe flows sequentially, prioritizes current attention, and never auto completes", () => {
  const plan = buildCookingPlan([dish("chicken", [task("Prepare", 5), task("Cook to 165°F", 20)])]);
  const first = plan.tasks[0], second = plan.tasks[1];
  assert.equal(getCookingGuidance(plan).nextTask.id, first.id);
  let states = changeCookingTaskState(plan, {}, first.id, "started", 1000);
  assert.equal(getCookingGuidance(plan, states, 1000 + 3600000).nextTask.id, first.id);
  assert.equal(getCookingGuidance(plan, states, 1000 + 3600000).inProgress[0].remainingMinutes, 0);
  assert.equal(getCookingGuidance(plan, states).complete, false);
  assert.match(getCookingGuidance(plan, states, 1000 + 3600000).warnings.join(" "), /nothing is marked done/);
  states = changeCookingTaskState(plan, states, first.id, "done");
  assert.equal(getCookingGuidance(plan, states).nextTask.id, second.id);
  states = changeCookingTaskState(plan, states, second.id, "done");
  assert.equal(getCookingGuidance(plan, states).complete, true);
});

test("components start longest remaining known work first; active steps block parallel suggestions", () => {
  const plan = buildCookingPlan([dish("salad", [task("Chop", 5)]), dish("roast", [task("Prepare", 10), task("Roast", 60)])]);
  const first = plan.tasks[1];
  assert.equal(getCookingGuidance(plan).nextTask.id, first.id);
  const states = changeCookingTaskState(plan, {}, first.id, "started", 1000);
  assert.equal(getCookingGuidance(plan, states).availableTasks.length, 0);
});

test("parallel suggestions require explicit metadata or user hands-off confirmation", () => {
  const plan = buildCookingPlan([dish("roast", [task("Roast 60 minutes", 60), task("Check temperature", 2)]), dish("salad", [task("Chop", 5)])]);
  const states = changeCookingTaskState(plan, {}, plan.tasks[0].id, "started", 1000);
  assert.equal(plan.tasks[0].passive, false, "roast prose alone is not evidence of unattended safety");
  assert.equal(getCookingGuidance(plan, states).availableTasks.length, 0);
  states[plan.tasks[0].id].handsOff = true;
  assert.equal(getCookingGuidance(plan, states).nextTask.id, plan.tasks[2].id);
  assert.equal(getCookingGuidance(plan, states).availableTasks.some((entry) => entry.id === plan.tasks[1].id), false);
  const passivePlan = buildCookingPlan([dish("beans", [task("Wait", 20, true)]), dish("salad", [task("Chop", 5)])]);
  const passiveStates = changeCookingTaskState(passivePlan, {}, passivePlan.tasks[0].id, "started", 1000);
  assert.equal(getCookingGuidance(passivePlan, passiveStates).nextTask.id, passivePlan.tasks[1].id);
  passiveStates[passivePlan.tasks[0].id].handsOff = false;
  assert.equal(getCookingGuidance(passivePlan, passiveStates).availableTasks.length, 0);
});

test("dependency gating rejects out-of-order completion/start and ignores stale restored states", () => {
  const plan = buildCookingPlan([dish("dish", ["Prepare", "Cook", "Serve"])]);
  for (const status of ["started", "done", "skipped"]) {
    assert.deepEqual(changeCookingTaskState(plan, {}, plan.tasks[2].id, status), {});
  }
  const stale = { old: { status: "done" }, [plan.tasks[2].id]: { status: "done" }, [plan.tasks[0].id]: { status: "nonsense" } };
  assert.deepEqual(sanitizeCookingStates(plan, stale), {});
});

test("undo resets downstream component steps only; repeated start preserves its original clock", () => {
  const plan = buildCookingPlan([dish("first", ["Prepare", "Cook"]), dish("second", ["Mix"])]);
  let states = {};
  for (const entry of plan.tasks) states = changeCookingTaskState(plan, states, entry.id, "done");
  states = changeCookingTaskState(plan, states, plan.tasks[0].id, "pending");
  assert.deepEqual(Object.keys(states), [plan.tasks[2].id]);
  states = changeCookingTaskState(plan, states, plan.tasks[0].id, "started", 1000);
  states = changeCookingTaskState(plan, states, plan.tasks[0].id, "started", 5000);
  assert.equal(states[plan.tasks[0].id].startedAt, 1000);
});

test("skipping is explicit and keeps a serving safety warning", () => {
  const plan = buildCookingPlan([dish("soup", ["Check temperature"])]);
  const states = changeCookingTaskState(plan, {}, plan.tasks[0].id, "skipped");
  assert.equal(getCookingGuidance(plan, states).complete, true);
  assert.match(getCookingGuidance(plan, states).warnings.join(" "), /Skipped steps were not completed/);
});

test("missing or malformed directions do not falsely report a complete meal", () => {
  const plan = buildCookingPlan([dish("side", [null, {}, ""]), dish("main", ["Cook"])]);
  const states = changeCookingTaskState(plan, {}, plan.tasks[0].id, "done");
  assert.equal(getCookingGuidance(plan, states).complete, false);
  assert.equal(getCookingGuidance(plan, states).unresolvedComponents[0].title, "side");
  assert.equal(getCookingGuidance(buildCookingPlan([])).complete, false);
  assert.equal(plan.hasUnknownDurations, true);
});

test("task identities are stable but changed text invalidates saved progress and dependents", () => {
  const first = buildCookingPlan([dish("soup", ["Chop", "Cook"])]);
  const same = buildCookingPlan([dish("soup", ["Chop", "Cook"])]);
  const changed = buildCookingPlan([dish("soup", ["Chop safely", "Cook"])]);
  assert.deepEqual(first.tasks.map((entry) => entry.id), same.tasks.map((entry) => entry.id));
  let states = {};
  for (const entry of first.tasks) states = changeCookingTaskState(first, states, entry.id, "done");
  assert.deepEqual(sanitizeCookingStates(changed, states), {});
});

test("known time totals are explicitly partial, not multiplied for components or portions", () => {
  const plan = buildCookingPlan([dish("main", [{ text: "Roast 40–50 minutes" }, "Serve"]), dish("side", [{ text: "Cook 10 minutes" }])]);
  assert.equal(plan.knownMinutes, 60);
  assert.deepEqual(plan.durationRange, { min: 50, max: 60 });
  assert.equal(plan.hasUnknownDurations, true);
  assert.match(plan.warnings.join(" "), /not a meal finish estimate/);
});

