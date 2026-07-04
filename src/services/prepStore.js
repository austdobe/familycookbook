import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

function emptyState() {
  return { checkedKeys: [], sections: [] };
}

function storageKey(weekId) {
  return `familyCookbook:prep:v1:${weekId}`;
}

function readLocalState(weekId) {
  try {
    return { ...emptyState(), ...JSON.parse(localStorage.getItem(storageKey(weekId)) || "{}") };
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

  getStateRef(weekId)
    .then((stateRef) => {
      if (cancelled) {
        return;
      }

      if (!stateRef) {
        emitLocal();
        window.addEventListener("family-cookbook-prep", emitLocal);
        return;
      }

      unsubscribeFirebase = onSnapshot(stateRef, (snapshot) => {
        const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
        mirrorLocalState(weekId, nextState);
        callback(nextState);
      }, () => {
        emitLocal();
        window.addEventListener("family-cookbook-prep", emitLocal);
      });
    })
    .catch(() => {
      if (!cancelled) {
        emitLocal();
        window.addEventListener("family-cookbook-prep", emitLocal);
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
  const stateRef = await getStateRef(weekId).catch(() => null);
  if (!stateRef) {
    writeLocalState(weekId, state);
    return;
  }
  mirrorLocalState(weekId, state);
  try {
    await setDoc(stateRef, state, { merge: true });
  } catch {
    writeLocalState(weekId, state);
  }
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
