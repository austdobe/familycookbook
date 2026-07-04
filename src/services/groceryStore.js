import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

function emptyState() {
  return { checkedKeys: [], manualItems: [], sections: [] };
}

function storageKey(weekId) {
  return `familyCookbook:grocery:v2:${weekId}`;
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
  window.dispatchEvent(new CustomEvent("family-cookbook-grocery", { detail: { weekId } }));
}

function mirrorLocalState(weekId, state) {
  localStorage.setItem(storageKey(weekId), JSON.stringify({ ...emptyState(), ...state }));
}

async function getStateRef(weekId) {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "groceryWeeks", weekId);
}

export function subscribeGroceryState(weekId, callback) {
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
        window.addEventListener("family-cookbook-grocery", emitLocal);
        return;
      }

      unsubscribeFirebase = onSnapshot(stateRef, (snapshot) => {
        const nextState = { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
        mirrorLocalState(weekId, nextState);
        callback(nextState);
      }, () => {
        emitLocal();
        window.addEventListener("family-cookbook-grocery", emitLocal);
      });
    })
    .catch(() => {
      if (!cancelled) {
        emitLocal();
        window.addEventListener("family-cookbook-grocery", emitLocal);
      }
    });

  return () => {
    cancelled = true;
    window.removeEventListener("family-cookbook-grocery", emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

export async function saveGroceryState(weekId, nextState) {
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

export async function toggleGroceryItem(weekId, itemKey, checked) {
  const current = await readCurrentState(weekId);
  const checkedSet = new Set(current.checkedKeys || []);
  if (checked) {
    checkedSet.add(itemKey);
  } else {
    checkedSet.delete(itemKey);
  }
  await saveGroceryState(weekId, { ...current, checkedKeys: [...checkedSet] });
}

export async function addManualGroceryItem(weekId, form) {
  const current = await readCurrentState(weekId);
  const manualItems = current.manualItems || [];
  manualItems.push({
    id: `manual-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    alternatives: form.alternatives || "",
    section: form.section || "Other",
    quantity: form.quantity || "",
    item: form.item || "",
    preferred: form.preferred || "",
    recipe: form.recipe || "Manual add",
    createdAt: new Date().toISOString(),
  });
  await saveGroceryState(weekId, { ...current, manualItems });
}

export async function updateManualGroceryItem(weekId, itemId, form) {
  const current = await readCurrentState(weekId);
  const manualItems = (current.manualItems || []).map((item) => {
    if (item.id !== itemId) {
      return item;
    }
    return {
      ...item,
      alternatives: form.alternatives || "",
      item: form.item || "",
      preferred: form.preferred || "",
      quantity: form.quantity || "",
      recipe: form.recipe || "Manual add",
      section: form.section || "Other",
      updatedAt: new Date().toISOString(),
    };
  });
  await saveGroceryState(weekId, { ...current, manualItems });
}

export async function removeManualGroceryItem(weekId, itemId) {
  const current = await readCurrentState(weekId);
  await saveGroceryState(weekId, {
    ...current,
    checkedKeys: (current.checkedKeys || []).filter((key) => key !== `manual|${itemId}`),
    manualItems: (current.manualItems || []).filter((item) => item.id !== itemId),
  });
}

export async function clearGroceryState(weekId) {
  const current = await readCurrentState(weekId);
  await saveGroceryState(weekId, { ...current, checkedKeys: [] });
}

async function readCurrentState(weekId) {
  const stateRef = await getStateRef(weekId).catch(() => null);
  if (!stateRef) {
    return readLocalState(weekId);
  }

  // Firestore updates are normally driven by onSnapshot. For writes, use the
  // last local mirror if available so controls stay responsive.
  return readLocalState(weekId);
}
