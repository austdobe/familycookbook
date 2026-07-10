import { deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

function emptyState() {
  return { menuRows: [] };
}

function storageKey(weekId) {
  return `familyCookbook:weekPlan:v1:${weekId}`;
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
  window.dispatchEvent(new CustomEvent("family-cookbook-week-plan", { detail: { weekId } }));
}

function mirrorLocalState(weekId, state) {
  localStorage.setItem(storageKey(weekId), JSON.stringify({ ...emptyState(), ...state }));
}

async function getStateRef(weekId) {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "weeklyPlans", weekId);
}

export function subscribeWeekPlanState(weekId, callback) {
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
        window.addEventListener("family-cookbook-week-plan", emitLocal);
        return;
      }

      unsubscribeFirebase = onSnapshot(stateRef, (snapshot) => {
        const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
        mirrorLocalState(weekId, nextState);
        callback(nextState);
      }, () => {
        emitLocal();
        window.addEventListener("family-cookbook-week-plan", emitLocal);
      });
    })
    .catch(() => {
      if (!cancelled) {
        emitLocal();
        window.addEventListener("family-cookbook-week-plan", emitLocal);
      }
    });

  return () => {
    cancelled = true;
    window.removeEventListener("family-cookbook-week-plan", emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

export async function saveWeekPlanState(weekId, nextState) {
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

export async function deleteWeekPlanState(weekId) {
  localStorage.removeItem(storageKey(weekId));
  window.dispatchEvent(new CustomEvent("family-cookbook-week-plan", { detail: { weekId } }));
  const stateRef = await getStateRef(weekId).catch(() => null);
  if (!stateRef) {
    return;
  }
  try {
    await deleteDoc(stateRef);
  } catch {
    // Local state is already removed; ignore remote cleanup failures.
  }
}
