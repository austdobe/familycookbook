import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";
const eventName = "family-cookbook-working-weeks";
const storageKey = "familyCookbook:workingWeeks:v1";

function emptyState() {
  return { weeks: [] };
}

function readLocalState() {
  try {
    return { ...emptyState(), ...JSON.parse(localStorage.getItem(storageKey) || "{}") };
  } catch {
    return emptyState();
  }
}

function writeLocalState(state) {
  localStorage.setItem(storageKey, JSON.stringify({ ...emptyState(), ...state }));
  window.dispatchEvent(new CustomEvent(eventName));
}

function mirrorLocalState(state) {
  localStorage.setItem(storageKey, JSON.stringify({ ...emptyState(), ...state }));
}

async function getStateRef() {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "workingWeeks", "index");
}

export function subscribeWorkingWeeks(callback) {
  let unsubscribeFirebase = null;
  let cancelled = false;

  const emitLocal = () => callback(readLocalState().weeks || []);

  getStateRef()
    .then((stateRef) => {
      if (cancelled) {
        return;
      }

      if (!stateRef) {
        emitLocal();
        window.addEventListener(eventName, emitLocal);
        return;
      }

      unsubscribeFirebase = onSnapshot(stateRef, (snapshot) => {
        const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
        mirrorLocalState(nextState);
        callback(nextState.weeks || []);
      }, () => {
        emitLocal();
        window.addEventListener(eventName, emitLocal);
      });
    })
    .catch(() => {
      if (!cancelled) {
        emitLocal();
        window.addEventListener(eventName, emitLocal);
      }
    });

  return () => {
    cancelled = true;
    window.removeEventListener(eventName, emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

export async function upsertWorkingWeek(week) {
  const current = readLocalState();
  const weeks = upsertWeek(current.weeks || [], week);
  const nextState = { weeks, updatedAt: new Date().toISOString() };
  const stateRef = await getStateRef().catch(() => null);
  if (!stateRef) {
    writeLocalState(nextState);
    return weeks;
  }

  mirrorLocalState(nextState);
  try {
    await setDoc(stateRef, nextState, { merge: true });
  } catch {
    writeLocalState(nextState);
  }
  return weeks;
}

export function upsertWeek(weeks, week) {
  const existingIndex = weeks.findIndex((candidate) => candidate.id === week.id);
  const nextWeek = { ...week, updatedAt: new Date().toISOString() };
  if (existingIndex === -1) {
    return [...weeks, { ...nextWeek, createdAt: nextWeek.createdAt || nextWeek.updatedAt }];
  }
  return weeks.map((candidate, index) => (index === existingIndex ? { ...candidate, ...nextWeek } : candidate));
}
