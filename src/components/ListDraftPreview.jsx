import React from "react";

export function ListDraftPreview({ preview, onApply, onCancel, busy = false, error = "", weekTitle = "" }) {
  if (!preview) return null;
  return (
    <section className="card stack" aria-label="Draft lists preview">
      <h2>Review draft lists{weekTitle ? `: ${weekTitle}` : ""}</h2>
      <p>Nothing has been applied. Meal edits do not automatically change your lists. Review these proposed changes, then apply both lists or cancel.</p>
      <p>Saved manual edits, additions and removals are preserved. Manually changed grocery quantities stay fixed, so review them after changing batch portions.</p>
      {!preview.hasChanges ? <p>No item or task changes. Applying can still save the current generation baseline.</p> : null}
      {[["Grocery", preview.grocery], ["Prep", preview.prep]].map(([label, group]) => (
        <section key={label} aria-label={`${label} changes`}>
          <h3>{label}: {group.added} added, {group.modified} changed, {group.removed} removed</h3>
          {group.changes.length ? <ul>{group.changes.map((change) => <li key={change.key} className="card">
            <strong>{change.kind === "added" ? "Add" : change.kind === "removed" ? "Remove" : "Change"}</strong>
            {change.before ? <div><h4>Before</h4><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{change.before}</pre></div> : null}
            {change.after ? <div><h4>After</h4><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{change.after}</pre></div> : null}
          </li>)}</ul> : <p>No {label.toLowerCase()} changes.</p>}
        </section>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <div className="section-actions">
        <button type="button" className="quiet-button" disabled={busy} onClick={onCancel}>Cancel draft</button>
        <button type="button" className="primary-button" disabled={busy} onClick={onApply}>{busy ? "Applying..." : "Apply draft lists"}</button>
      </div>
    </section>
  );
}
