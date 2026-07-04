const fs = require("fs");
const path = require("path");
const { applyFeedbackToMarkdown, assertInsideRoot } = require("./apply-recipe-feedback.js");

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

function shouldApplyFeedback(feedback) {
  return Boolean(
    feedback.recipePath &&
    (feedback.rating || feedback.notes || (Array.isArray(feedback.ingredientChanges) && feedback.ingredientChanges.length))
  );
}

async function readFeedbackDocs() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const config = firebaseConfig();
  if (!hasConfig(config)) {
    throw new Error("Firebase env vars are missing. Check .env for VITE_FIREBASE_* values.");
  }

  const [{ initializeApp }, { getAuth, signInAnonymously }, { collection, getDocs, getFirestore }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
    import("firebase/firestore"),
  ]);

  const app = initializeApp(config);
  await signInAnonymously(getAuth(app));

  const householdId = process.env.VITE_FIREBASE_HOUSEHOLD_ID || "family";
  const snapshot = await getDocs(collection(getFirestore(app), "households", householdId, "recipeFeedback"));
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const feedbackDocs = (await readFeedbackDocs()).filter(shouldApplyFeedback);
  const filteredDocs = args.file
    ? feedbackDocs.filter((feedback) => feedback.recipePath === args.file)
    : feedbackDocs;

  let updated = 0;
  for (const feedback of filteredDocs) {
    const recipePath = path.resolve(rootDir, feedback.recipePath);
    assertInsideRoot(recipePath);
    if (!fs.existsSync(recipePath)) {
      console.warn(`Skipping missing recipe: ${feedback.recipePath}`);
      continue;
    }

    const markdown = fs.readFileSync(recipePath, "utf8");
    const nextMarkdown = applyFeedbackToMarkdown(markdown, feedback);
    if (nextMarkdown === markdown) {
      continue;
    }

    updated += 1;
    if (!args.dryRun) {
      fs.writeFileSync(recipePath, nextMarkdown);
    }
    console.log(`${args.dryRun ? "Would update" : "Updated"} ${feedback.recipePath}`);
  }

  console.log(`${args.dryRun ? "Would update" : "Updated"} ${updated} recipe file(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`Sync feedback failed: ${error.message}`);
    process.exit(1);
  });
