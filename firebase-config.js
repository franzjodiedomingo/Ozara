// firebase-config.js
// Replace these values with the ones from your Firebase project settings:
// Firebase Console > Project Settings > General > Your apps > SDK setup and configuration

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBwGnk3g5TvNKWlAh4zjDIN9GF9pCtjGN4",
  authDomain: "ozara-dfec7.firebaseapp.com",
  databaseURL: "https://ozara-dfec7-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ozara-dfec7",
  storageBucket: "ozara-dfec7.firebasestorage.app",
  messagingSenderId: "110213170431",
  appId: "1:110213170431:web:53a8d3960de4350ae4b8ca"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
