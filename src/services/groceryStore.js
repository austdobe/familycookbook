import { cloudWrites } from "./cloudWrite.js";
import { doc, getDoc, getDocFromServer, onSnapshot } from "firebase/firestore";
import { firebaseIsConfigured, getFirebaseClient } from "./firebase.js";
import { reconcileGrocerySnapshot } from "../domain/listReconciliation.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

const pendingKey = (weekId) => `grocery:${householdId}:${weekId}`;

function emptyState() {
  return { checkedKeys: [], manualItems: [], sections: [] };
}

function storageKey(weekId) {
  return `familyCookbook:grocery:v2:${weekId}`;
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
  window.addEventListener("family-cookbook-grocery", emitLocal);

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
    window.removeEventListener("family-cookbook-grocery", emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

function normalizeCheckedKeys(weekId, state) {
  if (!state.sections?.length || !state.checkedKeys?.length) return state;
  return {
    ...state,
    checkedKeys: reconcileGrocerySnapshot({ generatedSections: state.sections, previousState: state, weekId }).checkedKeys,
  };
}

export async function saveGroceryState(weekId, nextState) {
  const state = { ...emptyState(), ...nextState, updatedAt: new Date().toISOString() };
  return cloudWrites.save({
    key: pendingKey(weekId), label: "grocery " + weekId,
    localSave: () => writeLocalState(weekId, state),
    operations: [{ type: "set", path: ["households", householdId, "groceryWeeks", weekId], data: state }],
  });
}

export async function syncGroceryStateFromFirebase(weekId) {
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
  window.dispatchEvent(new CustomEvent("family-cookbook-grocery", { detail: { weekId } }));
  return nextState;
}

export async function deleteGroceryState(weekId) {
  return cloudWrites.save({
    key: pendingKey(weekId), label: "Delete grocery " + weekId,
    localSave: () => {
      localStorage.removeItem(storageKey(weekId));
      window.dispatchEvent(new CustomEvent("family-cookbook-grocery", { detail: { weekId } }));
    },
    operations: [{ type: "delete", path: ["households", householdId, "groceryWeeks", weekId] }],
  });
}

export async function getGroceryState(weekId) {
  return readCurrentState(weekId);
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

// Draft generation must not replace unseen cloud edits with an old local mirror.
export async function getFreshGroceryState(weekId) {
  if (!firebaseIsConfigured()) return readLocalState(weekId);
  cloudWrites.assertNoPending(pendingKey(weekId));
  const stateRef = await getStateRef(weekId);
  if (!stateRef) throw new Error("Connect to the cloud before generating or applying draft lists. Direct list edits remain available.");
  const snapshot = await getDocFromServer(stateRef);
  cloudWrites.assertNoPending(pendingKey(weekId));
  return { ...emptyState(), ...(snapshot.exists() ? snapshot.data() : {}) };
}
