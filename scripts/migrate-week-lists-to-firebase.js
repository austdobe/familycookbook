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
  return getFirestore(app);
}

function migrationPayload(week, kind) {
  const now = new Date().toISOString();
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = loadCookbookData();
  const weeks = args.week ? data.weeks.filter((week) => week.id === args.week) : data.weeks;

  if (!weeks.length) {
    throw new Error(args.week ? `No week found for ${args.week}` : "No weeks found in generated cookbook data.");
  }

  if (args.dryRun) {
    for (const week of weeks) {
      console.log(`Would migrate ${week.id}: ${week.grocerySections.length} grocery section(s), ${week.prepSections.length} prep section(s).`);
    }
    return;
  }

  const db = await firebaseClient();
  const { doc, setDoc } = await import("firebase/firestore");
  const householdId = process.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";

  for (const week of weeks) {
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
    console.log(`Migrated ${week.id}: ${week.grocerySections.length} grocery section(s), ${week.prepSections.length} prep section(s).`);
  }
}

main().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exit(1);
});
