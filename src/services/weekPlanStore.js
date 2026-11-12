import { cloudWrites } from "./cloudWrite.js";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { firebaseIsConfigured, getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

const pendingKey = (weekId) => `weekPlan:${householdId}:${weekId}`;

function emptyState() {
  return { menuRows: [], sealed: false, sealedAt: "", unsealedAt: "" };
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
  window.addEventListener("family-cookbook-week-plan", emitLocal);

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
        const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
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
    window.removeEventListener("family-cookbook-week-plan", emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

export async function saveWeekPlanState(weekId, nextState) {
  const state = { ...emptyState(), ...nextState, updatedAt: new Date().toISOString() };
  return cloudWrites.save({
    key: pendingKey(weekId), label: "Weekly plan " + weekId,
    localSave: () => writeLocalState(weekId, state),
    operations: [{ type: "set", path: ["households", householdId, "weeklyPlans", weekId], data: state }],
  });
}

export async function syncWeekPlanStateFromFirebase(weekId) {
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
  window.dispatchEvent(new CustomEvent("family-cookbook-week-plan", { detail: { weekId } }));
  return nextState;
}

export async function deleteWeekPlanState(weekId) {
  return cloudWrites.save({
    key: pendingKey(weekId), label: "Delete weekPlan " + weekId,
    localSave: () => {
      localStorage.removeItem(storageKey(weekId));
      window.dispatchEvent(new CustomEvent("family-cookbook-week-plan", { detail: { weekId } }));
    },
    operations: [{ type: "delete", path: ["households", householdId, "weeklyPlans", weekId] }],
  });
}
