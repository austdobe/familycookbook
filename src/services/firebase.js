import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let firebaseClient = null;
let firebaseUnavailable = false;

export async function getFirebaseClient() {
  if (!hasFirebaseConfig || firebaseUnavailable) {
    return null;
  }

  if (!firebaseClient) {
    try {
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);
      await signInAnonymously(auth);
      firebaseClient = { app, auth, db };
    } catch (error) {
      firebaseUnavailable = true;
      console.warn("Firebase is configured but unavailable. Falling back to device storage.", error);
      return null;
    }
  }

  return firebaseClient;
}

export function firebaseIsConfigured() {
  return hasFirebaseConfig;
}
