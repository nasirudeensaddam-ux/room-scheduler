import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/** Must match your named Firestore database id (e.g. A1-studentnumber). */
const FIRESTORE_DATABASE_NAME = "a1-0000000";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
const db = getFirestore(app, FIRESTORE_DATABASE_NAME);

async function login() {
  await signInWithPopup(auth, provider);
}

async function logout() {
  await signOut(auth);
}

function handleAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export { app, auth, db, login, logout, handleAuthState };
