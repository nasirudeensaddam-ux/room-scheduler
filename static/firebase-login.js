import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";


const FIRESTORE_DATABASE_NAME = "a1-0000000";

const firebaseConfig = {
  apiKey: "AIzaSyBPcaCJaH9k5kdzYmUsHLdZ3X7UaNUyOZk",
  authDomain: "room-scheduler-227ec.firebaseapp.com",
  projectId: "room-scheduler-227ec",
  storageBucket: "room-scheduler-227ec.firebasestorage.app",
  messagingSenderId: "712107553929",
  appId: "1:712107553929:web:07f399e382b2700bac8258",
  measurementId: "G-H33C69HJLX"
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
