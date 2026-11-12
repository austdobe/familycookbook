// Cooking guidance is deterministic and advisory. Durations are estimates, never doneness.
const TERMINAL = new Set(["done", "skipped"]);
const VALID_STATUS = new Set(["pending", "started", "done", "skipped"]);
const FRACTIONS = { "¼": 0.25, "½": 0.5, "¾": 0.75 };

function normalized(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function hash(value) {
  let result = 2166136261;
  for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(36);
}
function numberValue(text) {
  const value = text.trim();
  const unicode = value.match(/^(\d+)?\s*([¼½¾])$/);
  if (unicode) return Number(unicode[1] || 0) + FRACTIONS[unicode[2]];
  const fraction = value.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[3]) ? Number(fraction[1] || 0) + Number(fraction[2]) / Number(fraction[3]) : NaN;
  return Number(value);
}

// One explicit duration or range only. A sentence with several timed phases is not
// silently summed: phases may overlap or be alternative cooking methods.
export function cookingDuration(step) {
  if (Number.isFinite(step?.durationMinutes) && step.durationMinutes > 0) {
    return { min: step.durationMinutes, max: step.durationMinutes, source: "metadata" };
  }
  const number = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\s*[¼½¾]|\\d+(?:\\.\\d+)?)";
  const pattern = new RegExp(`(${number})(?:\\s*(?:-|–|—|to)\\s*(${number}))?\\s*(minutes?|mins?|hours?|hrs?)\\b`, "gi");
  const text = normalized(typeof step === "string" ? step : step?.text);
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return null;
  const match = matches[0];
  // "up to", "at least", "every", or compound clock units are not useful step estimates.
  const before = text.slice(Math.max(0, match.index - 18), match.index);
  if (/(?:every|at least|up to|more than|less than)\s*$/i.test(before) || /[-–]\s*$/.test(before)) return null;
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 40);
  if (/^\s*(?:per\b|each\b|on each\b|a pound\b|before\b|ahead\b|in advance\b)/i.test(after)) return null;
  const factor = /^(?:hour|hr)/i.test(match[3]) ? 60 : 1;
  const min = numberValue(match[1]) * factor;
  const max = numberValue(match[2] || match[1]) * factor;
  if (!(min > 0 && max >= min && Number.isFinite(max))) return null;
  return { min, max, source: "recipe" };
}

export function buildCookingPlan(input = []) {
  const tasks = [];
  const warnings = [];
  const seen = new Map();
  const components = (Array.isArray(input) ? input : []).map((component, componentIndex) => {
    const title = normalized(component?.title) || `Component ${componentIndex + 1}`;
    const baseId = normalized(component?.id) || `component-${hash(title)}`;
    const occurrence = seen.get(baseId) || 0;
    seen.set(baseId, occurrence + 1);
    const componentId = `${baseId}:${occurrence}`;
    const rawSteps = Array.isArray(component?.steps) ? component.steps : [];
    const steps = rawSteps.map((step) => typeof step === "string" ? { text: step } : step).filter((step) => normalized(step?.text));
    const componentTasks = [];
    steps.forEach((step, index) => {
      const text = normalized(step.text);
      const section = normalized(step.section) || "Directions";
      const durationRange = cookingDuration(step);
      const identity = JSON.stringify([componentId, section, text, durationRange, step.passive === true]);
      const id = `${componentId}:${index}:${hash(identity)}`;
      componentTasks.push({
        id, componentId, componentTitle: title, index, text, section,
        predecessorId: componentTasks.at(-1)?.id || null,
        durationMinutes: durationRange?.max ?? null, durationRange,
        passive: step.passive === true,
      });
    });
    tasks.push(...componentTasks);
    const missingDirections = !componentTasks.length;
    if (missingDirections) warnings.push(`${title}: no usable directions are attached. Review this component before cooking.`);
    if (rawSteps.length !== steps.length) warnings.push(`${title}: some directions could not be read. Check the full recipe.`);
    const knownMinutes = componentTasks.reduce((total, task) => total + (task.durationMinutes || 0), 0);
    return { ...component, id: componentId, title, taskIds: componentTasks.map((task) => task.id), missingDirections, knownMinutes };
  });
  const hasUnknownDurations = tasks.some((task) => !task.durationRange) || components.some((component) => component.missingDirections);
  if (hasUnknownDurations) warnings.push("Some steps have no unambiguous timing. Check the recipe and allow extra time; the known minutes are not a meal finish estimate.");
  if (components.length > 1) warnings.push("Check shared pans, burners and oven temperatures before running components together. Equipment conflicts are not automatically resolved.");
  const durationRange = tasks.reduce((range, task) => ({ min: range.min + (task.durationRange?.min || 0), max: range.max + (task.durationRange?.max || 0) }), { min: 0, max: 0 });
  return { tasks, components, knownMinutes: durationRange.max, durationRange, hasUnknownDurations, warnings };
}

export function sanitizeCookingStates(plan, input = {}) {
  const result = {};
  for (const task of plan?.tasks || []) {
    const candidate = input?.[task.id];
    const status = typeof candidate === "string" ? candidate : candidate?.status;
    if (!VALID_STATUS.has(status) || status === "pending") continue;
    // Never restore a later step ahead of an unfinished prerequisite.
    if (task.predecessorId && !TERMINAL.has(result[task.predecessorId]?.status)) continue;
    const state = { status };
    if (status === "started") {
      if (Number.isFinite(candidate?.startedAt)) state.startedAt = candidate.startedAt;
      if (typeof candidate?.handsOff === "boolean") state.handsOff = candidate.handsOff;
      else if (typeof candidate?.passive === "boolean") state.handsOff = candidate.passive;
    }
    result[task.id] = state;
  }
  return result;
}

export function changeCookingTaskState(plan, input, taskId, status, now = Date.now()) {
  const states = sanitizeCookingStates(plan, input);
  const task = plan?.tasks?.find((candidate) => candidate.id === taskId);
  if (!task || !VALID_STATUS.has(status)) return states;
  if (status === "pending") {
    // Undo invalidates subsequent steps in this component, not independent dishes.
    for (const later of plan.tasks) if (later.componentId === task.componentId && later.index >= task.index) delete states[later.id];
    return states;
  }
  if (task.predecessorId && !TERMINAL.has(states[task.predecessorId]?.status)) return states;
  if (status === "started") {
    states[task.id] = { ...states[task.id], status, startedAt: states[task.id]?.status === "started" ? states[task.id].startedAt : now };
  } else states[task.id] = { status };
  return states;
}

export function getCookingGuidance(plan, input = {}, now = Date.now()) {
  const tasks = plan?.tasks || [];
  const states = sanitizeCookingStates(plan, input);
  const inProgress = tasks.filter((task) => states[task.id]?.status === "started").map((task) => {
    const state = states[task.id];
    const elapsedMinutes = Number.isFinite(state.startedAt) ? Math.max(0, (now - state.startedAt) / 60000) : null;
    return { ...task, handsOff: state.handsOff ?? task.passive, elapsedMinutes,
      remainingMinutes: elapsedMinutes !== null && task.durationMinutes !== null ? Math.max(0, task.durationMinutes - elapsedMinutes) : null };
  });
  const needsAttention = inProgress.filter((task) => !task.handsOff);
  const remainingKnown = (componentId) => tasks.filter((task) => task.componentId === componentId && !TERMINAL.has(states[task.id]?.status)).reduce((sum, task) => sum + (task.durationMinutes || 0), 0);
  const availableTasks = needsAttention.length ? [] : tasks.filter((task) => !states[task.id] && (!task.predecessorId || TERMINAL.has(states[task.predecessorId]?.status)))
    .sort((a, b) => remainingKnown(b.componentId) - remainingKnown(a.componentId) || tasks.indexOf(a) - tasks.indexOf(b));
  const unresolvedComponents = (plan?.components || []).filter((component) => component.missingDirections);
  const complete = tasks.length > 0 && tasks.every((task) => TERMINAL.has(states[task.id]?.status)) && !unresolvedComponents.length;
  const warnings = [...(plan?.warnings || [])];
  if (tasks.some((task) => states[task.id]?.status === "skipped")) warnings.push("Skipped steps were not completed. Check that preparation and food-safety requirements are still met before serving.");
  if (inProgress.some((task) => task.remainingMinutes === 0)) warnings.push("A recipe time estimate has elapsed. Check the food and required temperature; nothing is marked done automatically.");
  return { nextTask: needsAttention[0] || availableTasks[0] || null, inProgress, availableTasks, complete, unresolvedComponents, warnings, states };
}

