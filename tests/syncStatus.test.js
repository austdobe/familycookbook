import test from "node:test";
import assert from "node:assert/strict";
import { createSyncManager } from "../src/services/syncStatus.js";

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), values };
};
const operation = (data = { title: "Dinner" }, id = "one") => ({ type: "set", path: ["households", "family", "recipes", id], data });
const save = (manager, overrides = {}) => manager.save({ key: "recipe:one", label: "Dinner", operations: [operation()], localSave() {}, ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

test("successful write is locally persisted before remote request and reports synced", async () => {
  const storage = memoryStorage();
  let locallySaved = false;
  const states = [];
  const manager = createSyncManager({ storage, writeRemote: async () => { assert.ok(locallySaved); assert.ok(manager.hasPending("recipe:one")); return true; } });
  manager.subscribe(() => states.push(manager.getSnapshot()[0].state));
  const outcome = await save(manager, { localSave() { locallySaved = true; } });
  assert.equal(outcome.state, "synced");
  assert.equal(manager.hasPending("recipe:one"), false);
  assert.ok(states.includes("saving"));
  assert.equal(states.at(-1), "synced");
});

test("failed write survives reload, protects local data from pulls, and can retry", async () => {
  const storage = memoryStorage();
  const manager = createSyncManager({ storage, writeRemote: async () => { throw new Error("unavailable"); } });
  assert.equal((await save(manager)).state, "error");
  assert.throws(() => manager.assertNoPending("recipe:one"), /unsynced/);
  let uploaded;
  const reloaded = createSyncManager({ storage, writeRemote: async (ops) => { uploaded = ops; return true; } });
  assert.equal(reloaded.getSnapshot()[0].state, "local-only");
  assert.equal((await reloaded.retry("recipe:one")).state, "synced");
  assert.deepEqual(uploaded, [operation()]);
  assert.doesNotThrow(() => reloaded.assertNoPending("recipe:one"));
});

test("unavailable cloud is explicitly local-only, not reported as synced", async () => {
  const manager = createSyncManager({ storage: memoryStorage(), writeRemote: async () => false });
  const outcome = await save(manager);
  assert.equal(outcome.state, "local-only");
  assert.equal(outcome.canRetry, true);
  assert.equal(manager.hasPendingPrefix("recipe:"), true);
});

test("a new edit supersedes an in-flight write; older completion cannot clear the new edit", async () => {
  const first = deferred();
  const writes = [];
  const manager = createSyncManager({ storage: memoryStorage(), writeRemote: async (ops) => { writes.push(ops); if (writes.length === 1) await first.promise; return true; } });
  const firstSave = save(manager, { operations: [operation({ title: "Old", notes: "Keep this" })] });
  const secondSave = save(manager, { operations: [operation({ title: "New" })] });
  first.resolve();
  await Promise.all([firstSave, secondSave]);
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1][0].data, { title: "New", notes: "Keep this" });
  assert.equal(manager.hasPending("recipe:one"), false);
});

test("retry preserves all pending document operations for working week batches", async () => {
  const storage = memoryStorage();
  let connected = false;
  let written;
  const manager = createSyncManager({ storage, writeRemote: async (ops) => { if (!connected) return false; written = ops; return true; } });
  await save(manager, { key: "weeks", operations: [operation({ weeks: [1] }, "index"), operation({ title: "Week 1" }, "week1")] });
  await save(manager, { key: "weeks", operations: [operation({ weeks: [1, 2] }, "index"), operation({ title: "Week 2" }, "week2")] });
  connected = true;
  await manager.retry();
  assert.equal(written.length, 3);
  assert.deepEqual(written.find((op) => op.path.at(-1) === "index").data.weeks, [1, 2]);
});

test("deletion supersedes queued write and a later recreation supersedes deletion", async () => {
  let connected = false;
  let written;
  const manager = createSyncManager({ storage: memoryStorage(), writeRemote: async (ops) => { written = ops; return connected; } });
  await save(manager);
  await save(manager, { operations: [{ type: "delete", path: operation().path }] });
  connected = true;
  await manager.retry();
  assert.equal(written[0].type, "delete");
  connected = false;
  await save(manager, { operations: [{ type: "delete", path: operation().path }] });
  await save(manager, { operations: [operation({ title: "Recreated" })] });
  connected = true;
  await manager.retry();
  assert.deepEqual(written[0], operation({ title: "Recreated" }));
});

test("slow/offline Firestore write releases UI wait while retaining the single active request", async () => {
  const pending = deferred();
  let calls = 0;
  const manager = createSyncManager({ storage: memoryStorage(), timeoutMs: 10, writeRemote: async () => { calls++; await pending.promise; return true; } });
  const outcome = await save(manager);
  assert.equal(outcome.state, "local-only");
  assert.equal(outcome.canRetry, false);
  await manager.retry();
  assert.equal(calls, 1);
  pending.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(manager.getSnapshot()[0].state, "synced");
});

test("payloads are immutable copies and local storage failures never initiate cloud writes", async () => {
  const payload = operation();
  const storage = memoryStorage();
  const gate = deferred();
  let written;
  const manager = createSyncManager({ storage, writeRemote: async (ops) => { await gate.promise; written = ops; return true; } });
  const promise = save(manager, { operations: [payload] });
  payload.data.title = "Mutation";
  gate.resolve();
  await promise;
  assert.equal(written[0].data.title, "Dinner");
  let calls = 0;
  const broken = createSyncManager({ storage: { getItem: () => null, setItem() { throw new Error("Quota"); } }, writeRemote: async () => { calls++; return true; } });
  await assert.rejects(save(broken), /Quota/);
  assert.equal(calls, 0);
  assert.equal(broken.getSnapshot()[0].state, "error");
});

test("pending nested merge patches preserve earlier fields while replacing arrays", async () => {
  let available = false;
  let written;
  const manager = createSyncManager({ storage: memoryStorage(), writeRemote: async (ops) => { written = ops; return available; } });
  await save(manager, { operations: [operation({ notes: { testing: "Keep", substitutions: "Old" }, ingredients: ["Old"] })] });
  await save(manager, { operations: [operation({ notes: { substitutions: "New" }, ingredients: ["New"] })] });
  available = true;
  await manager.retry();
  assert.deepEqual(written[0].data, { notes: { testing: "Keep", substitutions: "New" }, ingredients: ["New"] });
});
