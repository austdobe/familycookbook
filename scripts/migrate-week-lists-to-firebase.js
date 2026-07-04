const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function loadEnvFile(fileName) {
  const filePath = path.join(rootDir, fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    args[key] = value;
    if (value !== "true") {
      index += 1;
    }
  }
  args.dryRun = args["dry-run"] === "true";
  return args;
}

function firebaseConfig() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    appId: process.env.VITE_FIREBASE_APP_ID,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  };
}

function hasConfig(config) {
  return Boolean(config.apiKey && config.appId && config.authDomain && config.projectId);
}

function loadCookbookData() {
  const dataPath = path.join(rootDir, "public", "data", "cookbook.json");
  if (!fs.existsSync(dataPath)) {
    throw new Error("public/data/cookbook.json is missing. Run npm.cmd run build:app first.");
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

async function firebaseClient() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const config = firebaseConfig();
  if (!hasConfig(config)) {
    throw new Error("Firebase env vars are missing. Check .env for VITE_FIREBASE_* values.");
  }

  const [{ initializeApp }, { getAuth, signInAnonymously }, { getFirestore }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);

  const app = initializeApp(config);
  await signInAnonymously(getAuth(app));
  return { app, db: getFirestore(app) };
}

function migrationPayload(week, kind) {
  const now = new Date().toISOString();
  if (kind === "week") {
    return {
      endDate: week.endDate || "",
      folder: week.folder || "",
      label: week.label || week.id,
      menuRows: week.weeklyMenu || [],
      migratedAt: now,
      planSource: "firebase",
      prepSections: week.prepSections || [],
      grocerySections: week.grocerySections || [],
      startDate: week.startDate || "",
      sourcePacketPath: week.packet.path,
      year: week.year || "",
    };
  }

  if (kind === "grocery") {
    return {
      listSource: "firebase",
      migratedAt: now,
      sourcePacketPath: week.packet.path,
      sections: week.grocerySections || [],
    };
  }

  return {
    listSource: "firebase",
    migratedAt: now,
    sourcePacketPath: week.packet.path,
    sections: week.prepSections || [],
  };
}

function weekIndexPayload(existingWeeks, markdownWeeks) {
  const byId = new Map((existingWeeks || []).map((week) => [week.id, week]));
  markdownWeeks.forEach((week) => {
    byId.set(week.id, {
      ...(byId.get(week.id) || {}),
      endDate: week.endDate || "",
      folder: week.folder || "",
      id: week.id,
      label: week.label || week.id,
      groceryItems: flattenGrocerySections(week.grocerySections || []),
      grocerySections: week.grocerySections || [],
      meals: week.weeklyMenu || [],
      menuRows: week.weeklyMenu || [],
      migratedAt: new Date().toISOString(),
      planSource: "markdown-migration",
      prepSections: week.prepSections || [],
      prepTasks: flattenPrepSections(week.prepSections || []),
      recipePaths: week.recipes.map((recipe) => recipe.path),
      sourcePacketPath: week.packet.path,
      startDate: week.startDate || "",
      year: week.year || "",
    });
  });

  return {
    migratedAt: new Date().toISOString(),
    weeks: [...byId.values()].sort((first, second) => String(second.id).localeCompare(String(first.id))),
  };
}

function weekDocumentPayload(week) {
  return {
    createdAt: new Date().toISOString(),
    folder: week.folder || "",
    groceryItems: flattenGrocerySections(week.grocerySections || []),
    grocerySections: week.grocerySections || [],
    id: week.id,
    meals: week.weeklyMenu || [],
    menuRows: week.weeklyMenu || [],
    migratedAt: new Date().toISOString(),
    planSource: "markdown-migration",
    prepSections: week.prepSections || [],
    prepTasks: flattenPrepSections(week.prepSections || []),
    recipePaths: week.recipes.map((recipe) => recipe.path),
    sourcePacketPath: week.packet.path,
    title: week.label || week.id,
    updatedAt: new Date().toISOString(),
    weekNumber: week.id.match(/week-(\d+)/)?.[1] || "",
    year: week.year || "",
  };
}

function flattenGrocerySections(sections) {
  return sections.flatMap((section) => section.items.map((item, index) => {
    const parsedQuantity = parseQuantityParts(item.Quantity);
    return {
      alternatives: item["Acceptable alternatives"] || "",
      category: section.title,
      checked: false,
      id: `${normalizeId(section.title)}-${normalizeId(item.Item)}-${index}`,
      name: item.Item || "",
      preferredType: item["Preferred version/type"] || "",
      quantity: parsedQuantity.quantity,
      quantityText: item.Quantity || "",
      recipeRefs: String(item.Recipe || "").split(/,\s*/).filter(Boolean),
      unit: parsedQuantity.unit,
    };
  }));
}

function flattenPrepSections(sections) {
  return sections.flatMap((section) => parsePrepTasks(section.markdown).map((task) => ({
    checked: false,
    ingredients: prepDetailValue(task.details, "Ingredients"),
    instructions: prepDetailValue(task.details, "Instructions"),
    mealRefs: [prepDetailValue(task.details, "Meal ownership")].filter(Boolean),
    section: section.title,
    storageMethod: prepDetailValue(task.details, "Storage method"),
    title: task.title,
    useByDate: prepDetailValue(task.details, "Use-by date"),
  })));
}

function parsePrepTasks(markdown) {
  const tasks = [];
  let current = null;

  String(markdown || "").replace(/\r\n/g, "\n").split("\n").forEach((line) => {
    const taskMatch = line.match(/^[-*+]\s+\[[ xX]\]\s+(.+)$/);
    if (taskMatch) {
      current = { details: [], title: taskMatch[1].trim() };
      tasks.push(current);
      return;
    }
    if (current) {
      current.details.push(line.replace(/^ {2}/, ""));
    }
  });

  return tasks.map((task) => ({ ...task, details: task.details.join("\n").trim() }));
}

function prepDetailValue(details, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(details || "").match(new RegExp(`^-\\s+${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

function parseQuantityParts(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d+(?:\s+\d+\/\d+|\/\d+|\.\d+)?)(?:\s+(.+))?$/);
  if (!match) {
    return { quantity: text, unit: "" };
  }
  return { quantity: match[1], unit: match[2] || "" };
}

function normalizeId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = loadCookbookData();
  const weeks = args.week ? data.weeks.filter((week) => week.id === args.week) : data.weeks;

  if (!weeks.length) {
    throw new Error(args.week ? `No week found for ${args.week}` : "No weeks found in generated cookbook data.");
  }

  if (args.dryRun) {
    for (const week of weeks) {
      console.log(`Would migrate ${week.id}: ${week.weeklyMenu.length} menu row(s), ${week.grocerySections.length} grocery section(s), ${week.prepSections.length} prep section(s), and unified week snapshot.`);
    }
    console.log(`Would update workingWeeks/index with ${weeks.length} markdown week(s).`);
    return;
  }

  const { app, db } = await firebaseClient();
  const [{ deleteApp }, { doc, getDoc, setDoc, terminate }] = await Promise.all([
    import("firebase/app"),
    import("firebase/firestore"),
  ]);
  const householdId = process.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

  try {
    const weekIndexRef = doc(db, "households", householdId, "workingWeeks", "index");
    const existingWeekIndex = await getDoc(weekIndexRef).catch(() => null);
    const existingWeeks = existingWeekIndex && existingWeekIndex.exists() ? existingWeekIndex.data().weeks || [] : [];

    await setDoc(
      weekIndexRef,
      weekIndexPayload(existingWeeks, weeks),
      { merge: true }
    );

    for (const week of weeks) {
      await setDoc(
        doc(db, "households", householdId, "weeklyPlans", week.id),
        migrationPayload(week, "week"),
        { merge: true }
      );
      await setDoc(
        doc(db, "households", householdId, "groceryWeeks", week.id),
        migrationPayload(week, "grocery"),
        { merge: true }
      );
      await setDoc(
        doc(db, "households", householdId, "prepWeeks", week.id),
        migrationPayload(week, "prep"),
        { merge: true }
      );
      await setDoc(
        doc(db, "households", householdId, "weeks", week.id),
        weekDocumentPayload(week),
        { merge: true }
      );
      console.log(`Migrated ${week.id}: ${week.weeklyMenu.length} menu row(s), ${week.grocerySections.length} grocery section(s), ${week.prepSections.length} prep section(s).`);
    }
    console.log(`Updated workingWeeks/index with ${weeks.length} markdown week(s).`);
  } finally {
    await terminate(db).catch(() => {});
    await deleteApp(app).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
