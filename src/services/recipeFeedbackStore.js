import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

function emptyFeedback() {
  return { ingredientChanges: [], rating: "", notes: "", updatedAt: "" };
}

function storageKey(recipeId) {
  return `familyCookbook:recipeFeedback:v1:${recipeId}`;
}

function readLocal(recipeId) {
  try {
    return { ...emptyFeedback(), ...JSON.parse(localStorage.getItem(storageKey(recipeId)) || "{}") };
  } catch {
    return emptyFeedback();
  }
}

function writeLocal(recipeId, feedback) {
  localStorage.setItem(storageKey(recipeId), JSON.stringify({ ...emptyFeedback(), ...feedback }));
  window.dispatchEvent(new CustomEvent("family-cookbook-recipe-feedback", { detail: { recipeId } }));
}

async function feedbackRef(recipeId) {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "recipeFeedback", encodeURIComponent(recipeId));
}

export function subscribeRecipeFeedback(recipeId, callback) {
  let unsubscribeFirebase = null;
  let cancelled = false;
  const emitLocal = () => callback(readLocal(recipeId));

  feedbackRef(recipeId)
    .then((stateRef) => {
      if (cancelled) {
        return;
      }

      if (!stateRef) {
        emitLocal();
        window.addEventListener("family-cookbook-recipe-feedback", emitLocal);
        return;
      }

      unsubscribeFirebase = onSnapshot(stateRef, (snapshot) => {
        const nextFeedback = { ...emptyFeedback(), ...(snapshot.exists() ? snapshot.data() : {}) };
        localStorage.setItem(storageKey(recipeId), JSON.stringify(nextFeedback));
        callback(nextFeedback);
      }, () => {
        emitLocal();
        window.addEventListener("family-cookbook-recipe-feedback", emitLocal);
      });
    })
    .catch(() => {
      if (!cancelled) {
        emitLocal();
        window.addEventListener("family-cookbook-recipe-feedback", emitLocal);
      }
    });

  return () => {
    cancelled = true;
    window.removeEventListener("family-cookbook-recipe-feedback", emitLocal);
    if (unsubscribeFirebase) {
      unsubscribeFirebase();
    }
  };
}

export async function saveRecipeFeedback(recipeId, recipePath, feedback) {
  const nextFeedback = {
    ingredientChanges: Array.isArray(feedback.ingredientChanges) ? feedback.ingredientChanges : [],
    rating: feedback.rating || "",
    notes: feedback.notes || "",
    recipePath,
    updatedAt: new Date().toISOString(),
  };
  const stateRef = await feedbackRef(recipeId).catch(() => null);
  if (!stateRef) {
    writeLocal(recipeId, nextFeedback);
    return;
  }
  localStorage.setItem(storageKey(recipeId), JSON.stringify(nextFeedback));
  try {
    await setDoc(stateRef, nextFeedback, { merge: true });
  } catch {
    writeLocal(recipeId, nextFeedback);
  }
}
