import React, { useEffect, useMemo, useRef, useState } from "react";
import { buildCookingPlan, getCookingGuidance, changeCookingTaskState } from "../domain/cookingSession.js";
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
  const [restart, setRestart] = useState(false);
  const [skipId, setSkipId] = useState("");
  const [prep, setPrep] = useState(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { setSession(readSession(storageKey)); setSavedKey(storageKey); setRestart(false); setSkipId(""); setShowTimeline(false); }, [storageKey]);
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
      const focusable = [...(dialogRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') || [])].filter((element) => element.getClientRects().length);
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
  const focus = guidance.inProgress.find((task) => !(states[task.id]?.handsOff ?? task.passive)) || guidance.nextTask;
  const checked = session.checkedIngredients || [];
  const groups = components.length ? components : [{ id: recipeId, title, ingredients }];
  const markIngredient = (key) => setSession((current) => ({ ...current, checkedIngredients: (current.checkedIngredients || []).includes(key) ? current.checkedIngredients.filter((id) => id !== key) : [...(current.checkedIngredients || []), key] }));
  const taskControls = (task) => <div className="cooking-task-actions">
    {states[task.id]?.status !== "started" ? <button type="button" onClick={() => update(task.id, "started")}>Start / already started</button> : null}
    <button type="button" onClick={() => update(task.id, "done")}>Done / already done</button>
    <button type="button" className="quiet-button" onClick={() => setSkipId(task.id)}>Skip</button>
    {skipId === task.id ? <div className="cooking-skip-confirm" role="alert"><p>Skip this step only if it is unnecessary or already covered. Do not skip required food-safety checks.</p><button type="button" onClick={() => { update(task.id, "skipped"); setSkipId(""); }}>Confirm skip</button><button type="button" onClick={() => setSkipId("")}>Cancel skip</button></div> : null}
  </div>;
  const taskText = (task) => <><p className="eyebrow">{task.componentTitle} · {task.section}</p><p className="cooking-action-text">{task.text}</p><p>{task.durationMinutes ? `Recipe estimate: about ${task.durationMinutes} min. Check progress and doneness.` : "No reliable duration provided. Follow the recipe's cues."}</p></>;
  return <div className="cooking-view-backdrop"><section ref={dialogRef} tabIndex={-1} aria-label={`Cook ${title}`} aria-modal="true" className="cooking-view" role="dialog">
    <header className="cooking-view-header"><div><p className="eyebrow">Tonight's meal · guided cooking</p><h2>{title}</h2></div><button className="cooking-close" type="button" onClick={onClose}>Close</button></header>
    <div className="cooking-view-layout guided-cooking-layout">
      <main className="cooking-directions guided-cooking-directions">
        <p className="muted">Progress stays on this device, not the shared prep checklist. No alarms or background notifications.</p>
        {storageError ? <p role="alert">{storageError}</p> : null}
        {leftover ? <p className="planning-warnings">This is a leftover night. Review storage and reheat guidance below; these are the original cooking directions, not an instruction to make another batch.</p> : null}
        {batchNote ? <p className="planning-warnings">{batchNote}</p> : null}
        <details className="cooking-preflight"><summary>Before you start: prep, timing and equipment</summary>
          <p>Check that meat is safely thawed, advance prep is finished, and you have the needed equipment. Recipe steps stay in their original order. Review the whole meal for oven temperatures, equipment conflicts and make-ahead steps before starting.</p>
          <label>Target serving time (optional)<input type="datetime-local" value={session.serveAt || ""} onChange={(event) => setSession((current) => ({ ...current, serveAt: event.target.value }))} /></label>
          {session.serveAt ? <p>Target: {new Date(session.serveAt).toLocaleString()}. This is a reminder, not a guaranteed finish time. Missing prep times and shared equipment can change the schedule.</p> : null}
          {plan.components.map((component) => <p key={component.id}>{component.title}: {component.knownMinutes ? `about ${component.knownMinutes} minutes in identified timed steps; other work may be untimed` : "timing needs review"}.</p>)}
          {plan.knownMinutes ? <p>Recipe steps contain about {plan.knownMinutes} known minutes in total, before accounting for overlap or untimed work. This is not an elapsed-time estimate.</p> : null}
          <p>Timers never establish food safety. Use a thermometer and the recipe's doneness checks; reheat leftovers to 165°F. Chill perishables within 2 hours (1 hour above 90°F).</p>
          {plan.warnings?.length ? <ul>{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
          {weekId ? <><h4>Saved weekly prep reference</h4><p>Review the relevant tasks below, including earlier-day work. These are not automatically matched or marked complete when you finish recipe steps.</p>{!prep ? <p role="status">Loading saved prep…</p> : prep.sections?.length ? prep.sections.map((section, index) => <details key={`${section.title}-${index}`}><summary>{section.title}</summary>{parsePrepTasks(section.markdown).map((task) => <article key={task.key || task.title}><strong>{(prep.checkedKeys || []).includes(prepTaskStableKey(weekId, section, task)) ? "✓ " : ""}{task.title}</strong><p className="cooking-prep-text">{task.details}</p></article>)}</details>) : <p>No saved prep tasks. Check the component recipes for advance preparation.</p>}</> : null}
        </details>
        {guidance.warnings.filter((warning) => !plan.warnings.includes(warning)).map((warning) => <p className="planning-warnings" role="status" key={warning}>{warning}</p>)}
        {targetMinutes !== null && Number.isFinite(targetMinutes) ? <p className="planning-warnings">{targetMinutes < 0 ? "Your target serving time has passed. Do not rush required cooking or temperature checks." : `${Math.ceil(targetMinutes)} minutes until your target. Review remaining steps and equipment; timing is not guaranteed.`}</p> : null}
        <div className="cooking-next" aria-live="polite"><h3>{focus ? states[focus.id]?.status === "started" ? "You're working on" : "What to do now" : guidance.inProgress.length ? "Check what's cooking" : guidance.complete ? "Checklist finished" : "Review the recipes"}</h3>
          {focus ? <>{taskText(focus)}{taskControls(focus)}{states[focus.id]?.status === "started" ? <label className="cooking-hands-off"><input type="checkbox" checked={Boolean(states[focus.id]?.handsOff ?? focus.passive)} onChange={(event) => setSession((current) => ({ ...current, states: { ...current.states, [focus.id]: { ...current.states[focus.id], handsOff: event.target.checked } } }))} />This can run while I work on another dish (keep checking it)</label> : null}</> : <p>{guidance.complete ? "All steps are marked done or skipped. Confirm doneness and serving temperatures before eating." : "No actionable step is available. Review the full timeline and the recipes."}</p>}
        </div>
        {guidance.inProgress.filter((task) => task.id !== focus?.id).map((task) => <article className="cooking-running" key={task.id}><h4>While this runs</h4>{taskText(task)}<p>{states[task.id]?.startedAt ? `${Math.max(0, Math.floor((now - states[task.id].startedAt) / 60000))} minutes since you marked it started. Check it yourself; no alarm will sound.` : "Already started; elapsed time is unknown."}</p>{taskControls(task)}<button type="button" onClick={() => setSession((current) => ({ ...current, states: { ...current.states, [task.id]: { ...current.states[task.id], handsOff: false } } }))}>Needs my attention</button></article>)}
        <button type="button" className="quiet-button" aria-expanded={showTimeline} onClick={() => setShowTimeline(!showTimeline)}>{showTimeline ? "Hide full timeline" : "View full timeline"}</button>
        {showTimeline ? <div className="cooking-timeline"><p>Dependency order by dish, not a precise clock schedule. Start with the suggested action; other dishes become available while you mark a step hands-off.</p>{plan.tasks.map((task) => <article key={task.id}><strong>{task.componentTitle} · {task.index + 1} · {states[task.id]?.status || "pending"}</strong><p>{task.text}</p>{states[task.id]?.status && states[task.id].status !== "pending" ? <button type="button" onClick={() => update(task.id, "pending")}>Undo (also resets later steps in this dish)</button> : guidance.availableTasks.some((candidate) => candidate.id === task.id) ? taskControls(task) : <span>Finish earlier steps first.</span>}</article>)}</div> : null}
        {restart ? <div className="planning-warnings"><p>Reset cooking progress for this meal on this device? Recipes and shared lists will not change.</p><button type="button" onClick={() => { setSession({}); setRestart(false); }}>Reset progress</button><button type="button" onClick={() => setRestart(false)}>Cancel</button></div> : <button type="button" className="quiet-button" onClick={() => setRestart(true)}>Restart this cooking session</button>}
      </main>
      <aside className="cooking-ingredients"><details open><summary>Ingredients by component</summary>{groups.map((group, groupIndex) => <section key={`${group.id}-${groupIndex}`}><h3>{group.title}</h3>{group.batchNote ? <p className="planning-warnings">{group.batchNote}</p> : null}<div className="cooking-ingredient-list">{(group.ingredients || []).map((ingredient, index) => { const key = `${group.id}:${groupIndex}:${index}:${ingredient.item}`; return <label key={key} className={checked.includes(key) ? "checked" : ""}><input type="checkbox" checked={checked.includes(key)} onChange={() => markIngredient(key)} /><span><strong>{ingredient.quantityText}</strong> {ingredient.item}</span></label>; })}</div></section>)}</details></aside>
    </div>
  </section></div>;
}
