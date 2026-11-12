import { cloudWrites } from "./cloudWrite.js";
import { doc, getDoc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { firebaseIsConfigured, getFirebaseClient } from "./firebase.js";
import { parsePrepTasksForIdentity, reconcilePrepCheckedKeys } from "../domain/listReconciliation.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

const pendingKey = (weekId) => `prep:${householdId}:${weekId}`;

function emptyState() {
  return { checkedKeys: [], sections: [] };
}

function storageKey(weekId) {
  return `familyCookbook:prep:v1:${weekId}`;
}

function readLocalState(weekId) {
  try {
    return normalizeCheckedKeys(weekId, { ...emptyState(), ...JSON.parse(localStorage.getItem(storageKey(weekId)) || "{}") });
  } catch {
    return emptyState();
  }
}

function writeLocalState(weekId, state) {
  localStorage.setItem(storageKey(weekId), JSON.stringify({ ...emptyState(), ...state }));
  window.dispatchEvent(new CustomEvent("family-cookbook-prep", { detail: { weekId } }));
}

function mirrorLocalState(weekId, state) {
  localStorage.setItem(storageKey(weekId), JSON.stringify({ ...emptyState(), ...state }));
}

async function getStateRef(weekId) {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "prepWeeks", weekId);
}

export function subscribePrepState(weekId, callback) {
  let unsubscribeFirebase = null;
  let cancelled = false;

  const emitLocal = () => callback(readLocalState(weekId));
  window.addEventListener("family-cookbook-prep", emitLocal);

  getStateRef(weekId)
    .then((stateRef) => {
      if (cancelled) {
        return;
      }

      if (!stateRef) {
        emitLocal();
        return;
      }

      unsubscribeFirebase = onSnapshot(stateRef, (snapshot) => {
        if (cloudWrites.hasPending(pendingKey(weekId))) { emitLocal(); return; }
        const nextState = normalizeCheckedKeys(weekId, { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) });
        mirrorLocalState(weekId, nextState);
        callback(nextState);
      }, () => {
        emitLocal();
      });
    })
    .catch(() => {
      if (!cancelled) {
        emitLocal();
      }
    });

  return () => {
    cancelled = true;
    window.removeEventListener("family-cookbook-prep", emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

export async function savePrepState(weekId, nextState) {
  const state = { ...emptyState(), ...nextState, updatedAt: new Date().toISOString() };
  return cloudWrites.save({
    key: pendingKey(weekId), label: "prep " + weekId,
    localSave: () => writeLocalState(weekId, state),
    operations: [{ type: "set", path: ["households", householdId, "prepWeeks", weekId], data: state }],
  });
}

export async function syncPrepStateFromFirebase(weekId) {
  cloudWrites.assertNoPending(pendingKey(weekId));
  if (!firebaseIsConfigured()) {
    throw new Error("Firebase is not configured for this build.");
  }
  const stateRef = await getStateRef(weekId);
  if (!stateRef) {
    throw new Error("Firebase is unavailable. Check the app connection and Firebase settings.");
  }
  const snapshot = await getDoc(stateRef);
  cloudWrites.assertNoPending(pendingKey(weekId));
  const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
  mirrorLocalState(weekId, nextState);
  window.dispatchEvent(new CustomEvent("family-cookbook-prep", { detail: { weekId } }));
  return nextState;
}

export async function deletePrepState(weekId) {
  return cloudWrites.save({
    key: pendingKey(weekId), label: "Delete prep " + weekId,
    localSave: () => {
      localStorage.removeItem(storageKey(weekId));
      window.dispatchEvent(new CustomEvent("family-cookbook-prep", { detail: { weekId } }));
    },
    operations: [{ type: "delete", path: ["households", householdId, "prepWeeks", weekId] }],
  });
}

export async function togglePrepTask(weekId, taskKey, checked) {
  const current = readLocalState(weekId);
  const checkedSet = new Set(current.checkedKeys || []);
  if (checked) {
    checkedSet.add(taskKey);
  } else {
    checkedSet.delete(taskKey);
  }
  await savePrepState(weekId, { ...current, checkedKeys: [...checkedSet] });
}

export async function clearPrepState(weekId) {
  const current = readLocalState(weekId);
  await savePrepState(weekId, { ...current, checkedKeys: [] });
}

export async function getPrepState(weekId) {
  return readLocalState(weekId);
}

function normalizeCheckedKeys(weekId, state) {
  if (!state.sections?.length || !state.checkedKeys?.length) return state;
  return {
    ...state,
    checkedKeys: reconcilePrepCheckedKeys({
      generatedSections: state.sections,
      parseTasks: parsePrepTasksForIdentity,
      previousState: state,
      weekId,
    }),
  };
}

// Draft generation must not replace unseen cloud edits with an old local mirror.
export async function getFreshPrepState(weekId) {
  if (!firebaseIsConfigured()) return readLocalState(weekId);
  cloudWrites.assertNoPending(pendingKey(weekId));
  const stateRef = await getStateRef(weekId);
  if (!stateRef) throw new Error("Connect to the cloud before generating or applying draft lists. Direct list edits remain available.");
  const snapshot = await getDocFromServer(stateRef);
  cloudWrites.assertNoPending(pendingKey(weekId));
  return { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
}
