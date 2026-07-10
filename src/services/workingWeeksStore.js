import { deleteDoc, doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { firebaseIsConfigured, getFirebaseClient } from "./firebase.js";

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

async function getWeekRef(weekId) {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "weeks", weekId);
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
  const [stateRef, weekRef] = await Promise.all([
    getStateRef().catch(() => null),
    getWeekRef(week.id).catch(() => null),
  ]);
  if (!stateRef) {
    writeLocalState(nextState);
    return weeks;
  }

  mirrorLocalState(nextState);
  try {
    await Promise.all([
      setDoc(stateRef, nextState, { merge: true }),
      weekRef ? setDoc(weekRef, weekDocumentPayload(week), { merge: true }) : Promise.resolve(),
    ]);
  } catch {
    writeLocalState(nextState);
  }
  return weeks;
}

export async function syncWorkingWeeksFromFirebase() {
  if (!firebaseIsConfigured()) {
    throw new Error("Firebase is not configured for this build.");
  }
  const stateRef = await getStateRef();
  if (!stateRef) {
    throw new Error("Firebase is unavailable. Check the app connection and Firebase settings.");
  }
  const snapshot = await getDoc(stateRef);
  const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
  mirrorLocalState(nextState);
  window.dispatchEvent(new CustomEvent(eventName));
  return nextState.weeks || [];
}

export async function deleteWorkingWeek(weekId) {
  const current = readLocalState();
  const weeks = (current.weeks || []).filter((week) => week.id !== weekId);
  const nextState = { weeks, updatedAt: new Date().toISOString() };
  const [stateRef, weekRef] = await Promise.all([
    getStateRef().catch(() => null),
    getWeekRef(weekId).catch(() => null),
  ]);
  if (!stateRef) {
    writeLocalState(nextState);
    return weeks;
  }

  mirrorLocalState(nextState);
  try {
    await Promise.all([
      setDoc(stateRef, nextState, { merge: true }),
      weekRef ? deleteDoc(weekRef) : Promise.resolve(),
    ]);
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

function weekDocumentPayload(week) {
  return {
    createdAt: week.createdAt || new Date().toISOString(),
    groceryItems: week.groceryItems || [],
    grocerySections: week.grocerySections || [],
    meals: week.meals || week.menuRows || [],
    menuRows: week.menuRows || week.meals || [],
    prepSections: week.prepSections || [],
    prepTasks: week.prepTasks || [],
    recipePaths: week.recipePaths || [],
    title: week.title || week.label || week.id,
    updatedAt: new Date().toISOString(),
    weekNumber: week.weekNumber || "",
    year: week.year || "",
  };
}
