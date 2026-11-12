// Dependency-free coordinator: test with a fake storage and cloud adapter.
export function createSyncManager({ storage = globalThis.localStorage, writeRemote, timeoutMs = 8000 } = {}) {
  const storageKey = "familyCookbook:pendingWrites:v1";
  const listeners = new Set();
  const active = new Map();
  let queue = {};
  let statuses = {};
  let snapshot = [];
  try {
    queue = JSON.parse(storage?.getItem(storageKey) || "{}");
    if (!queue || Array.isArray(queue) || typeof queue !== "object") queue = {};
  } catch { queue = {}; }
  for (const [key, entry] of Object.entries(queue)) {
    statuses[key] = { key, label: entry.label, state: "local-only", message: "Pending changes are saved on this device. Retry to send them to the cloud.", canRetry: true };
  }
  snapshot = Object.values(statuses);
  const emit = () => { snapshot = Object.values(statuses); listeners.forEach((listener) => listener()); };
  const status = (key, values) => { statuses[key] = { key, label: queue[key]?.label || statuses[key]?.label || key, ...values }; emit(); };
  const persist = () => storage.setItem(storageKey, JSON.stringify(queue));
  const result = (key) => ({ ...statuses[key] });

  async function drain(key) {
    while (queue[key]) {
      const entry = queue[key];
      status(key, { state: "saving", message: "Saving to the cloud...", canRetry: false });
      try {
        const available = await writeRemote(entry.operations);
        if (available === false) {
          status(key, { state: "local-only", message: "Saved on this device only. Cloud storage is unavailable; retry when connected.", canRetry: true });
          return result(key);
        }
        // A newer edit may have replaced this entry while its write was running.
        if (queue[key]?.revision !== entry.revision) continue;
        delete queue[key];
        try { persist(); } catch (error) {
          // Keep the entry so reloading cannot silently replay a stale write.
          queue[key] = entry;
          status(key, { state: "error", message: "Cloud save completed, but this device could not clear its pending record. Free storage and retry.", canRetry: true });
          return result(key);
        }
        status(key, { state: "synced", message: "Saved to the cloud.", canRetry: false });
      } catch (error) {
        if (queue[key]?.revision !== entry.revision) continue;
        status(key, { state: "error", message: "Saved on this device, but the cloud save failed. Retry to sync.", canRetry: true });
        return result(key);
      }
    }
    return result(key);
  }

  function flush(key) {
    if (!queue[key]) return Promise.resolve(result(key));
    if (active.has(key)) return active.get(key).visible;
    let timer;
    const task = drain(key);
    const visible = Promise.race([
      task,
      new Promise((resolve) => {
        timer = setTimeout(() => {
          if (queue[key]) status(key, { state: "local-only", message: "Saved on this device. The cloud save is still waiting for a connection.", canRetry: false });
          resolve(result(key));
        }, timeoutMs);
      }),
    ]);
    active.set(key, { task, visible });
    task.finally(() => { clearTimeout(timer); active.delete(key); });
    return visible;
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot() { return snapshot; },
    hasPending(key) { return Boolean(queue[key]); },
    hasPendingPrefix(prefix) { return Object.keys(queue).some((key) => key.startsWith(prefix)); },
    async save({ key, label, operations, localSave }) {
      // Keep an independent payload, not caller-owned mutable objects.
      const copied = JSON.parse(JSON.stringify(operations));
      const merged = new Map((queue[key]?.operations || []).map((operation) => [JSON.stringify(operation.path), operation]));
      copied.forEach((operation) => {
        const pathKey = JSON.stringify(operation.path);
        const previous = merged.get(pathKey);
        merged.set(pathKey, previous?.type === "set" && operation.type === "set"
          ? { ...operation, data: mergeData(previous.data, operation.data) }
          : operation);
      });
      const entry = { key, label, operations: [...merged.values()], revision: `${Date.now()}-${Math.random()}` };
      queue[key] = entry;
      try {
        persist();
        localSave();
      } catch (error) {
        // No cloud action begins if local persistence fails.
        status(key, { state: "error", message: "Could not save safely on this device. Check available browser storage before retrying.", canRetry: false });
        throw error;
      }
      status(key, { state: "saving", message: "Saving to the cloud...", canRetry: false });
      return flush(key);
    },
    async retry(key) {
      if (key) return flush(key);
      return Promise.all(Object.keys(queue).map(flush));
    },
    assertNoPending(key, prefix = false) {
      const pending = prefix ? Object.keys(queue).some((candidate) => candidate.startsWith(key)) : Boolean(queue[key]);
      if (pending) throw new Error("There are unsynced changes saved on this device. Use Retry cloud saves before pulling cloud data.");
    },
  };
}

function mergeData(previous, next) {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    const prior = merged[key];
    merged[key] = value && prior && typeof value === "object" && typeof prior === "object" && !Array.isArray(value) && !Array.isArray(prior)
      ? mergeData(prior, value) : value;
  }
  return merged;
}
