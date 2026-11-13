import assert from "node:assert/strict";
import test from "node:test";
import { buildCookingPlan, changeCookingTaskState, componentCookingEstimate, cookingDuration, getCookingGuidance, sanitizeCookingStates } from "../src/domain/cookingSession.js";

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



const turkeySteps = [
  { text: "Thaw an 18 lb turkey in the refrigerator for 4-5 days starting Saturday November 21; cook within 1-2 days after thawing." },
  { text: "Heat oven to 325°F. Remove giblets, season, and stuff immediately before roasting if desired." },
  { text: "Roast on rack. Allow roughly 4–4 1/2 hours unstuffed or 4 1/4–4 3/4 hours stuffed, but use a thermometer rather than time. Breast and innermost thigh/wing must reach 165°F; stuffing center must also reach 165°F. Shield overly browned skin loosely with foil." },
  { text: "Rest 20 minutes, carve, and refrigerate leftovers promptly." },
];
const collardSteps = [
  { text: "Cook bacon and onion, then add garlic for 30 seconds." },
  { text: "Add greens and broth; simmer 60–90 minutes until tender." },
  { text: "Add vinegar and season to taste." },
  { text: "Make Wednesday if desired and reheat Thursday to 165°F." },
];

test("actual Thanksgiving conditional roast time remains unknown and never ranks as only 20 minutes", () => {
  const plan = buildCookingPlan([
    { id: "collards", title: "Collards", role: "side", steps: collardSteps },
    { id: "turkey", title: "Turkey", role: "main", steps: turkeySteps },
  ]);
  const turkey = plan.components.find((component) => component.title === "Turkey");
  const collards = plan.components.find((component) => component.title === "Collards");
  assert.equal(cookingDuration(turkeySteps[2]), null, "stuffed/unstuffed alternatives are not added together or guessed");
  assert.equal(turkey.knownMinutes, 20);
  assert.equal(turkey.durationEstimate, null);
  assert.equal(turkey.timingStatus, "partial");
  assert.equal(collards.knownMinutes, 90);
  assert.equal(collards.timingStatus, "partial");
  const guidance = getCookingGuidance(plan);
  assert.equal(guidance.nextTask.componentTitle, "Turkey");
  assert.equal(guidance.timingNeedsReview, true);
  assert.match(guidance.warnings.join(" "), /not a longest-cook calculation/);
  assert.equal(guidance.nextTask.text, turkeySteps[0].text, "advance prep is not marked done because it was scheduled earlier");
});

test("unknown timing fallback is deterministic main-first, not a numeric zero estimate", () => {
  const plan = buildCookingPlan([
    { ...dish("timed side", [task("Cook", 90)]), role: "side" },
    { ...dish("unknown main", ["Cook until thermometer target"]), role: "main" },
    { ...dish("timed main", [task("Cook", 30)]), role: "main" },
  ]);
  const guidance = getCookingGuidance(plan);
  assert.equal(plan.components[1].timingStatus, "unknown");
  assert.equal(plan.components[1].durationEstimate, null);
  assert.deepEqual(guidance.availableTasks.map((entry) => entry.componentTitle), ["unknown main", "timed main", "timed side"]);
  assert.equal(guidance.timingNeedsReview, true);
});

test("explicit recipe metadata supports ordering without manufacturing step timers", () => {
  assert.deepEqual(componentCookingEstimate({ timing: { totalTime: "4–4 1/2 hours" } }), { min: 240, max: 270, source: "recipe-total" });
  assert.deepEqual(componentCookingEstimate({ timing: { prepTime: "20 minutes", cookTime: "60–90 minutes" } }), { min: 80, max: 110, source: "recipe-prep-and-cook" });
  assert.equal(componentCookingEstimate({ timing: { cookTime: "90 minutes" } }), null, "cook-only is not a whole-recipe estimate");
  assert.equal(componentCookingEstimate({ timing: { totalTime: "4 hours unstuffed or 5 hours stuffed" } }), null);
  const plan = buildCookingPlan([
    { ...dish("salad", [task("Make salad", 5)]), role: "side" },
    { ...dish("main", ["Prepare", "Roast to safe temperature"]), role: "main", timing: { totalMinutes: 240 } },
  ]);
  assert.equal(plan.components[1].timingStatus, "recipe-estimate");
  assert.equal(plan.components[1].durationEstimate.max, 240);
  assert.equal(plan.tasks[1].durationMinutes, null);
  assert.equal(getCookingGuidance(plan).nextTask.componentTitle, "main");
  assert.equal(getCookingGuidance(plan).timingNeedsReview, false);
  const states = changeCookingTaskState(plan, {}, plan.tasks[1].id, "done");
  assert.equal(getCookingGuidance(plan, states).timingNeedsReview, true, "whole recipe estimate cannot be treated as remaining time after untimed work");
});

test("active work, dependencies and hands-off remain authoritative with unknown timing", () => {
  const plan = buildCookingPlan([
    { id: "collards", title: "Collards", role: "side", steps: collardSteps },
    { id: "turkey", title: "Turkey", role: "main", steps: turkeySteps },
  ]);
  const collardFirst = plan.tasks[0];
  let states = changeCookingTaskState(plan, {}, collardFirst.id, "started", 1000);
  assert.equal(getCookingGuidance(plan, states).nextTask.id, collardFirst.id, "don't interrupt already active bacon cooking");
  assert.equal(getCookingGuidance(plan, states).availableTasks.length, 0);
  states = changeCookingTaskState(plan, states, collardFirst.id, "done");
  states = changeCookingTaskState(plan, states, plan.tasks[1].id, "started", 2000);
  states[plan.tasks[1].id].handsOff = true;
  assert.equal(getCookingGuidance(plan, states).nextTask.componentTitle, "Turkey");
  assert.equal(getCookingGuidance(plan, states).availableTasks.some((entry) => entry.id === plan.tasks[2].id), false, "do not advance collards until simmer completed");
});
