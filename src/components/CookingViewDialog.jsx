import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildCookingPlan, getCookingGuidance, changeCookingTaskState } from "../domain/cookingSession.js";
import { cookingMealTitle } from "../domain/cookingTitle.js";
import { subscribePrepState } from "../services/prepStore.js";
import { parsePrepTasks } from "../domain/prepTasks.js";
import { prepTaskStableKey } from "../domain/listReconciliation.js";

function readSession(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return { states: value.states && typeof value.states === "object" && !Array.isArray(value.states) ? value.states : {},
      checkedIngredients: Array.isArray(value.checkedIngredients) ? value.checkedIngredients.filter((id) => typeof id === "string") : [],
      serveAt: typeof value.serveAt === "string" && Number.isFinite(new Date(value.serveAt).getTime()) ? value.serveAt : "" };
  } catch { return {}; }
}

export function CookingViewDialog({ components = [], ingredients = [], steps = [], recipeId, title, onClose, batchNote = "", sessionId = recipeId || title, weekId, leftover = false }) {
  const plan = useMemo(() => buildCookingPlan(components.length ? components : [{ id: recipeId || "recipe", title, ingredients, steps }]), [components, recipeId, title, ingredients, steps]);
  const fingerprint = JSON.stringify({ tasks: plan.tasks.map((task) => task.id), ingredients: (components.length ? components : [{ ingredients }]).map((component) => component.ingredients) });
  const storageKey = `familyCookbook:cooking:v1:${sessionId}:${fingerprint}`;
  const [session, setSession] = useState(() => readSession(storageKey));
  const [savedKey, setSavedKey] = useState(storageKey);
  const [storageError, setStorageError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [showTimeline, setShowTimeline] = useState(false);
  const [preferredDish, setPreferredDish] = useState("");
  const [restart, setRestart] = useState(false);
  const [skipId, setSkipId] = useState("");
  const [prep, setPrep] = useState(null);
  const dialogRef = useRef(null);
  const nextActionRef = useRef(null);
  const previousTask = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { setSession(readSession(storageKey)); setSavedKey(storageKey); setRestart(false); setSkipId(""); setShowTimeline(false); setPreferredDish(""); }, [storageKey]);
  useEffect(() => {
    if (savedKey !== storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(session)); setStorageError(""); }
    catch { setStorageError("Progress could not be saved on this device. Keep this screen open."); }
  }, [session, storageKey, savedKey]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { setPrep(null); return weekId ? subscribePrepState(weekId, setPrep) : undefined; }, [weekId]);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    let wakeLock; let disposed = false;
    navigator.wakeLock?.request("screen").then((lock) => { if (disposed) lock.release(); else wakeLock = lock; }).catch(() => {});
    const onKey = (event) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, select, [tabindex="0"]') || [])].filter((element) => element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { disposed = true; wakeLock?.release(); document.body.style.overflow = overflow; window.removeEventListener("keydown", onKey); previousFocus?.focus?.(); };
  }, []);
  const guidance = getCookingGuidance(plan, session.states || {}, now);
  const states = guidance.states;
  const targetMinutes = session.serveAt ? (new Date(session.serveAt).getTime() - now) / 60000 : null;
  const update = (id, status) => setSession((current) => ({ ...current, states: changeCookingTaskState(plan, current.states || {}, id, status) }));
  const focus = guidance.inProgress.find((task) => !(states[task.id]?.handsOff ?? task.passive)) || guidance.availableTasks.find((task) => task.componentId === preferredDish) || guidance.nextTask;
  useEffect(() => {
    if (previousTask.current && previousTask.current !== focus?.id) nextActionRef.current?.focus();
    previousTask.current = focus?.id;
  }, [focus?.id]);
  const checked = session.checkedIngredients || [];
  const groups = components.length ? components : [{ id: recipeId, title, ingredients }];
  const markIngredient = (key) => setSession((current) => ({ ...current, checkedIngredients: (current.checkedIngredients || []).includes(key) ? current.checkedIngredients.filter((id) => id !== key) : [...(current.checkedIngredients || []), key] }));
  const taskControls = (task) => <div className="cooking-task-actions" key={task.id}>
    {states[task.id]?.status !== "started" ? <button type="button" onClick={() => update(task.id, "started")}>Start step</button> : <button type="button" onClick={() => update(task.id, "done")}>Done · next step</button>}
    <details className="cooking-step-options"><summary>More options</summary>
      {states[task.id]?.status !== "started" ? <><button type="button" onClick={() => update(task.id, "done")}>Already done</button><button type="button" onClick={() => update(task.id, "started")}>Already started</button></> : null}
      <button type="button" onClick={() => setSkipId(task.id)}>Skip step</button>
    </details>
    {skipId === task.id ? <div className="cooking-skip-confirm" role="alert"><p>Skip only if unnecessary or covered elsewhere. Keep required food-safety checks.</p><button type="button" onClick={() => { update(task.id, "skipped"); setSkipId(""); }}>Confirm skip</button><button type="button" onClick={() => setSkipId("")}>Cancel skip</button></div> : null}
  </div>;
  const taskText = (task) => <><p className="eyebrow">{task.componentTitle} · Step {task.index + 1}</p><p className="cooking-action-text">{task.text}</p>{task.durationRange ? <p className="cooking-duration">{task.durationRange.min === task.durationRange.max ? task.durationRange.max : `${task.durationRange.min}–${task.durationRange.max}`} min · recipe estimate, not a doneness check</p> : null}</>;
  const mealTitle = cookingMealTitle(title, groups);
  const completed = plan.tasks.filter((task) => ["done", "skipped"].includes(states[task.id]?.status)).length;
  return <div className="cooking-view-backdrop"><section ref={dialogRef} tabIndex={-1} aria-label={`Cook ${mealTitle.heading}`} aria-modal="true" className="cooking-view" role="dialog">
    <header className="cooking-view-header"><div><p className="eyebrow">Start cooking · {completed}/{plan.tasks.length} steps checked</p><h2 title={mealTitle.fullTitle}>{mealTitle.heading}</h2></div><button className="cooking-close" type="button" onClick={onClose}>Close</button></header>
    <div className="cooking-view-layout guided-cooking-layout"><main className="cooking-directions guided-cooking-directions">
      {storageError ? <p role="alert">{storageError}</p> : null}
      <div className="cooking-next" aria-live="polite"><h3 ref={nextActionRef} tabIndex={-1}>{focus ? states[focus.id]?.status === "started" ? "You're working on" : "What to do now" : guidance.inProgress.length ? "Check what's cooking" : guidance.complete ? "Checklist finished" : "Review the recipes"}</h3>
        {focus ? <>{taskText(focus)}{taskControls(focus)}{states[focus.id]?.status === "started" ? <label className="cooking-hands-off"><input type="checkbox" checked={Boolean(states[focus.id]?.handsOff ?? focus.passive)} onChange={(event) => setSession((current) => ({ ...current, states: { ...current.states, [focus.id]: { ...current.states[focus.id], handsOff: event.target.checked } } }))} />Hands-off for now. Show another dish.</label> : null}</> : <p>{guidance.complete ? "Confirm doneness and serving temperatures before eating." : "Check the running dishes or open all steps below."}</p>}
      </div>
      {guidance.inProgress.filter((task) => task.id !== focus?.id).map((task) => <details className="cooking-running" key={task.id}><summary>{task.componentTitle} · running{states[task.id]?.startedAt ? ` · ${Math.max(0, Math.floor((now - states[task.id].startedAt) / 60000))} min since marked started` : ""}</summary>{taskText(task)}<p>Keep checking it. No alarm will sound.</p>{taskControls(task)}<button type="button" onClick={() => setSession((current) => ({ ...current, states: { ...current.states, [task.id]: { ...current.states[task.id], handsOff: false } } }))}>Needs my attention</button></details>)}
      {guidance.warnings.filter((warning) => !plan.warnings.includes(warning) && !warning.startsWith("Component timing is incomplete.")).map((warning) => <p className="planning-warnings" role="status" key={warning}>{warning}</p>)}
      {guidance.unresolvedComponents.length ? <p role="alert">Some recipes have missing directions. Check Prep & timing before continuing.</p> : null}
      {targetMinutes !== null && Number.isFinite(targetMinutes) ? <p className="cooking-duration">{targetMinutes < 0 ? "Serving target passed. Keep required doneness checks." : `${Math.ceil(targetMinutes)} min until serving target · not a finish estimate`}</p> : null}
      {guidance.timingNeedsReview ? <details className="cooking-order-note"><summary>Timing incomplete · review order</summary><p>Unknown cook times are not treated as zero. This is a suggested order, not a calculated schedule. Choose a different dish below when needed.</p></details> : null}
      {guidance.availableTasks.length > 1 ? <label className="cooking-dish-choice">Work on<select value={focus?.componentId || ""} onChange={(event) => setPreferredDish(event.target.value)}>{guidance.availableTasks.map((task) => <option key={task.componentId} value={task.componentId}>{task.componentTitle}</option>)}</select></label> : null}
      <p className="cooking-session-note">Saved on this device · no alarms</p>
      {mealTitle.showDetails ? <details className="cooking-support cooking-meal-details"><summary>Meal details{mealTitle.componentCount > 1 ? ` · ${mealTitle.componentCount} dishes` : ""}</summary>{mealTitle.fullTitle !== groups.map((group) => group.title).join(" + ") ? <p>{mealTitle.fullTitle}</p> : null}{mealTitle.componentCount > 1 ? <ul>{groups.map((group, index) => <li key={`${group.id}-${index}`}>{group.title}</li>)}</ul> : null}</details> : null}
      <details className="cooking-support"><summary>Ingredients</summary>{groups.map((group, groupIndex) => <section key={`${group.id}-${groupIndex}`}><h3>{group.title}</h3>{group.batchNote ? <p className="planning-warnings">{group.batchNote}</p> : null}<div className="cooking-ingredient-list">{(group.ingredients || []).map((ingredient, index) => { const key = `${group.id}:${groupIndex}:${index}:${ingredient.item}`; return <label key={key} className={checked.includes(key) ? "checked" : ""}><input type="checkbox" checked={checked.includes(key)} onChange={() => markIngredient(key)} /><span><strong>{ingredient.quantityText}</strong> {ingredient.item}</span></label>; })}</div></section>)}</details>
      <details className="cooking-support cooking-preflight"><summary>Prep & timing</summary>
        <p>Check thawing, make-ahead prep and equipment before starting. Earlier-day prep is not assumed done: use More options → Already done only for steps you actually finished. Follow recipe order. Shared ovens and pans may limit overlap.</p>
        {leftover ? <p>Leftover night: review safe storage and reheating rather than making another batch.</p> : null}
        {batchNote ? <p className="planning-warnings">{batchNote}</p> : null}
        <label>Target serving time (optional)<input type="datetime-local" value={session.serveAt || ""} onChange={(event) => setSession((current) => ({ ...current, serveAt: event.target.value }))} /></label>
        <p>Serving target is a reminder, not a calculated finish time. Unknown times are not zero. Estimates never establish food safety.</p>
        {plan.components.map((component) => <p key={component.id}><strong>{component.title}:</strong> {component.durationEstimate ? `${component.durationEstimate.min === component.durationEstimate.max ? component.durationEstimate.max : `${component.durationEstimate.min}–${component.durationEstimate.max}`} min · ${component.timingStatus === "recipe-estimate" ? "recipe summary estimate" : "timed steps"}.` : component.knownMinutes ? `Partial timing only: ${component.knownMinutes} min found in steps. Total unknown.` : "No reliable total time. Review the recipe."}</p>)}
        {plan.warnings?.length ? <ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
        <p>Use a thermometer and recipe doneness checks. Reheat leftovers to 165°F. Chill perishables within 2 hours (1 hour above 90°F).</p>
        {weekId ? <><h4>Saved weekly prep reference</h4><p>Read-only reference. Cooking progress does not update the shared prep checklist.</p>{!prep ? <p role="status">Loading saved prep.</p> : prep.sections?.length ? prep.sections.map((section, index) => <details key={`${section.title}-${index}`}><summary>{section.title}</summary>{parsePrepTasks(section.markdown).map((task) => <article key={task.key || task.title}><strong>{(prep.checkedKeys || []).includes(prepTaskStableKey(weekId, section, task)) ? "✓ " : ""}{task.title}</strong><p className="cooking-prep-text">{task.details}</p></article>)}</details>) : <p>No saved prep tasks. Check recipe advance preparation.</p>}</> : null}
      </details>
      <details className="cooking-support" open={showTimeline} onToggle={(event) => setShowTimeline(event.currentTarget.open)}><summary>All steps & progress</summary><div className="cooking-timeline"><p>Recipe order, not a precise clock schedule. Finish earlier steps before starting later ones.</p>{plan.tasks.map((task) => <article key={task.id}><strong>{task.componentTitle} · {task.index + 1} · {states[task.id]?.status || "pending"}</strong><p>{task.text}</p>{states[task.id]?.status && states[task.id].status !== "pending" ? <button type="button" onClick={() => update(task.id, "pending")}>Undo this and later steps in this dish</button> : guidance.availableTasks.some((candidate) => candidate.id === task.id) ? taskControls(task) : <span>Finish earlier steps first.</span>}</article>)}</div>
        {restart ? <div className="planning-warnings"><p>Reset this device's progress? Recipes and shared lists stay unchanged.</p><button type="button" onClick={() => { setSession({}); setRestart(false); }}>Reset progress</button><button type="button" onClick={() => setRestart(false)}>Cancel</button></div> : <button type="button" className="quiet-button" onClick={() => setRestart(true)}>Restart cooking</button>}
      </details>
    </main></div>
  </section></div>;
}
