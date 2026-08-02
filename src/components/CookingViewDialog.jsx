import React, { useEffect, useState } from "react";

export function CookingViewDialog({ ingredients, onClose, recipeId, steps, title }) {
  const [checkedIngredients, setCheckedIngredients] = useState(() => new Set());
  const [stepIndex, setStepIndex] = useState(0);
  const [showAllSteps, setShowAllSteps] = useState(false);

  useEffect(() => {
    setCheckedIngredients(new Set());
    setStepIndex(0);
    setShowAllSteps(false);
  }, [recipeId]);

  useEffect(() => {
    let wakeLock = null;
    const keepAwake = async () => {
      try {
        wakeLock = await navigator.wakeLock?.request("screen");
      } catch {
        wakeLock = null;
      }
    };
    keepAwake();
    return () => wakeLock?.release?.();
  }, []);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setStepIndex((current) => Math.min(current + 1, Math.max(steps.length - 1, 0)));
      if (event.key === "ArrowLeft") setStepIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, steps.length]);

  return (
    <div className="cooking-view-backdrop" role="presentation">
      <section aria-label={`Cook ${title}`} aria-modal="true" className="cooking-view" role="dialog">
        <header className="cooking-view-header">
          <div><p className="eyebrow">Cooking mode</p><h2>{title}</h2></div>
          <button aria-label="Close cooking mode" className="cooking-close" onClick={onClose} type="button">Done</button>
        </header>
        <div className="cooking-view-layout">
          <aside className="cooking-ingredients">
            <div className="cooking-section-heading"><h3>Ingredients</h3><span>{checkedIngredients.size}/{ingredients.length}</span></div>
            <div className="cooking-ingredient-list">
              {ingredients.map((ingredient, index) => {
                const key = ingredient.id || `${ingredient.item}-${index}`;
                const checked = checkedIngredients.has(key);
                return (
                  <label className={checked ? "checked" : ""} key={key}>
                    <input checked={checked} onChange={() => setCheckedIngredients((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key); else next.add(key);
                      return next;
                    })} type="checkbox" />
                    <span><strong>{ingredient.quantityText}</strong> {ingredient.item}</span>
                  </label>
                );
              })}
            </div>
          </aside>
          <main className="cooking-directions">
            <div className="cooking-section-heading">
              <h3>Directions</h3>
              <button className="quiet-button" onClick={() => setShowAllSteps((current) => !current)} type="button">{showAllSteps ? "One step" : "View all"}</button>
            </div>
            {steps.length ? showAllSteps ? (
              <ol className="cooking-all-steps">{steps.map((step, index) => <li className={index === stepIndex ? "active" : ""} key={`${step.section}-${index}`} onClick={() => { setStepIndex(index); setShowAllSteps(false); }}>{step.text}</li>)}</ol>
            ) : (
              <div className="cooking-current-step">
                <span>Step {stepIndex + 1} of {steps.length}</span>
                <p>{steps[stepIndex]?.text}</p>
                <div className="cooking-step-controls">
                  <button disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(current - 1, 0))} type="button">Previous</button>
                  <button disabled={stepIndex === steps.length - 1} onClick={() => setStepIndex((current) => Math.min(current + 1, steps.length - 1))} type="button">Next Step</button>
                </div>
              </div>
            ) : <div className="empty">No directions are attached to this recipe yet.</div>}
          </main>
        </div>
      </section>
    </div>
  );
}
