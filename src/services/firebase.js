import { getApps, getApp, initializeApp } from "firebase/app";
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
let initialization = null;

export async function getFirebaseClient() {
  if (!hasFirebaseConfig) return null;
  if (firebaseClient) return firebaseClient;
  if (!initialization) {
    initialization = (async () => {
      try {
        const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);
        if (!auth.currentUser) await signInAnonymously(auth);
        firebaseClient = { app, auth, db };
        return firebaseClient;
      } catch (error) {
        console.warn("Firebase is unavailable. Changes remain saved on this device until retry.", error);
        return null;
      }
    })();
  }
  const attempt = initialization;
  try { return await attempt; }
  finally { if (initialization === attempt) initialization = null; }
}

export function firebaseIsConfigured() {
  return hasFirebaseConfig;
}
