import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";

const householdId = import.meta.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";
const eventName = "family-cookbook-recipes";
const storageKey = "familyCookbook:recipes:v1";

function emptyState() {
  return { recipes: [] };
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

async function getRecipesCollectionRef() {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return collection(client.db, "households", householdId, "recipes");
}

async function getRecipeRef(recipeId) {
  const client = await getFirebaseClient();
  if (!client) {
    return null;
  }
  return doc(client.db, "households", householdId, "recipes", recipeId);
}

export function subscribeRecipes(callback) {
  let unsubscribeFirebase = null;
  let cancelled = false;

  const emitLocal = () => callback(toArchiveDocs(readLocalState().recipes || []));

  getRecipesCollectionRef()
    .then((recipesRef) => {
      if (cancelled) {
        return;
      }

      if (!recipesRef) {
        emitLocal();
        window.addEventListener(eventName, emitLocal);
        return;
      }

      unsubscribeFirebase = onSnapshot(recipesRef, (snapshot) => {
        const recipes = snapshot.docs.map((snapshotDoc) => ({
          id: snapshotDoc.id,
          ...snapshotDoc.data(),
        }));
        const nextState = { recipes, updatedAt: new Date().toISOString() };
        mirrorLocalState(nextState);
        callback(toArchiveDocs(recipes));
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

export async function saveRecipe(recipe) {
  const recipeId = recipe.id || slugFromTitle(recipe.title || "recipe");
  const now = new Date().toISOString();
  const nextRecipe = {
    ...recipe,
    id: recipeId,
    createdAt: recipe.createdAt || now,
    updatedAt: now,
  };
  const recipeRef = await getRecipeRef(recipeId).catch(() => null);

  if (!recipeRef) {
    upsertLocalRecipe(nextRecipe);
    return nextRecipe;
  }

  mirrorUpsertLocalRecipe(nextRecipe);
  try {
    await setDoc(recipeRef, nextRecipe, { merge: true });
  } catch {
    upsertLocalRecipe(nextRecipe);
  }
  return nextRecipe;
}

export async function updateRecipe(recipeId, patch) {
  return saveRecipe({ ...patch, id: recipeId });
}

function upsertLocalRecipe(recipe) {
  const current = readLocalState();
  writeLocalState({
    ...current,
    recipes: upsertRecipe(current.recipes || [], recipe),
    updatedAt: new Date().toISOString(),
  });
}

function mirrorUpsertLocalRecipe(recipe) {
  const current = readLocalState();
  mirrorLocalState({
    ...current,
    recipes: upsertRecipe(current.recipes || [], recipe),
    updatedAt: new Date().toISOString(),
  });
}

function upsertRecipe(recipes, recipe) {
  const existingIndex = recipes.findIndex((candidate) => candidate.id === recipe.id);
  if (existingIndex === -1) {
    return [...recipes, recipe];
  }
  return recipes.map((candidate, index) => (index === existingIndex ? { ...candidate, ...recipe } : candidate));
}

function toArchiveDocs(recipes) {
  return recipes
    .map(recipeToArchiveDoc)
    .sort((first, second) => first.title.localeCompare(second.title));
}

function recipeToArchiveDoc(recipe) {
  const markdown = recipe.sourceMarkdown || recipeToMarkdown(recipe);
  return {
    id: recipe.id,
    title: recipe.title || recipe.id,
    type: "firebase-recipe",
    path: recipe.archivedMarkdownPath || `firebase/recipes/${recipe.id}.md`,
    markdown,
    summary: markdown.slice(0, 240),
    recipe,
  };
}

function recipeToMarkdown(recipe) {
  const planningSummary = [
    labeledBullet("Servings", recipe.servings),
    labeledBullet("Estimated prep time", minutesLabel(recipe.estimatedPrepMinutes)),
    labeledBullet("Estimated cook time", minutesLabel(recipe.estimatedCookMinutes)),
    labeledBullet("Protein", recipe.protein),
    labeledBullet("Cuisine or flavor direction", recipe.cuisine),
    labeledBullet("Best day to cook", recipe.bestDayToCook),
    labeledBullet("Perishability notes", recipe.perishabilityNotes),
    labeledBullet("Difficulty", recipe.difficulty),
  ].filter(Boolean);
  const equipment = recipe.equipment || [];
  const ingredients = recipe.ingredients || [];
  const instructionSections = recipe.instructionSections?.length
    ? recipe.instructionSections
    : [{ title: "Basic Instructions", steps: [] }];
  const notes = recipe.notes || {};

  return [
    `# ${recipe.title || "Untitled Recipe"}`,
    "",
    `Status: ${recipe.statusLabel || stageLabel(recipe.status)}`,
    `Category: ${recipe.category || ""}`,
    `Source or inspiration: ${recipe.source || ""}`,
    `Date added: ${recipe.dateAdded || ""}`,
    `Last updated: ${recipe.lastUpdated || ""}`,
    "",
    "## Planning Summary",
    "",
    ...planningSummary,
    "",
    "## Equipment",
    "",
    ...(equipment.length ? equipment.map((item) => `- ${item}`) : ["- "]),
    "",
    "## Ingredients",
    "",
    "| Quantity | Ingredient | Preferred version/type | Acceptable alternatives | Notes |",
    "|---|---|---|---|---|",
    ...(ingredients.length ? ingredients.map(renderIngredientRow) : ["|  |  |  |  |  |"]),
    "",
    ...instructionSections.flatMap(renderInstructionSection),
    "## Notes",
    "",
    labeledBullet("What might need testing", notes.testing),
    labeledBullet("Possible substitutions", notes.substitutions),
    labeledBullet("Prep-ahead ideas", notes.prepAhead),
    labeledBullet("Family preference concerns", notes.familyPreferenceConcerns),
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

function renderInstructionSection(section) {
  const steps = section.steps || [];
  return [
    `## ${section.title || "Basic Instructions"}`,
    "",
    ...(steps.length ? steps.map((step, index) => `${step.order || index + 1}. ${step.text || ""}`) : ["1. "]),
    "",
  ];
}

function renderIngredientRow(ingredient) {
  return [
    ingredient.quantityText || "",
    ingredient.item || "",
    ingredient.preferredType || "",
    ingredient.acceptableAlternatives || "",
    ingredient.notes || ingredient.usedIn || "",
  ].map(escapeTableCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function labeledBullet(label, value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return `- ${label}: ${value}`;
}

function minutesLabel(value) {
  return value ? `${value} minutes` : "";
}

function stageLabel(status) {
  if (status === "stage-2") {
    return "Stage 2 - Promoted family recipe";
  }
  if (status === "stage-1") {
    return "Stage 1 - Draft / testing";
  }
  return status || "";
}

function escapeTableCell(value) {
  return String(value || "").replace(/\|/g, "\\|").trim();
}

function slugFromTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `recipe-${Date.now()}`;
}
