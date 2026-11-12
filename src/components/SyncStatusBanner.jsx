import React, { useState, useSyncExternalStore } from "react";
import { cloudWrites } from "../services/cloudWrite.js";

export function SyncStatusBanner() {
  const entries = useSyncExternalStore(cloudWrites.subscribe, cloudWrites.getSnapshot, cloudWrites.getSnapshot);
  const [retried, setRetried] = useState(false);
  return <SyncStatusView entries={entries} retried={retried} onRetry={async () => { await cloudWrites.retry(); setRetried(true); }} />;
}

export function SyncStatusView({ entries, onRetry, retried = false }) {
  const pending = entries.filter((entry) => entry.state !== "synced");
  if (!entries.length) return null;
  const canRetry = pending.some((entry) => entry.canRetry);
  return (
    <section className="card" aria-label="Cloud save status" aria-live="polite">
      {pending.length ? <>
        <strong>{pending.some((entry) => entry.state === "error") ? "Some changes have not synced" : pending.some((entry) => entry.state === "local-only") ? "Changes saved on this device only" : "Saving changes..."}</strong>
        <ul>{pending.map((entry) => <li key={entry.key}><strong>{entry.label}:</strong> {entry.message}</li>)}</ul>
        {canRetry ? <button className="quiet-button" type="button" onClick={onRetry}>Retry cloud saves</button> : null}
      </> : <><span>All changes saved to the cloud.</span>{retried ? <p>After reconnecting, refresh the app to pick up changes from other devices.</p> : null}</>}
    </section>
  );
}
