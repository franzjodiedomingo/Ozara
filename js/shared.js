// js/shared.js
// Common auth guard + sign-out wiring used by every dashboard page
// (home.html, monitor.html, history.html, profile.html).

import { auth } from "../firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const userEmailEl = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

logoutBtn.addEventListener("click", async () => {
  const confirmed = window.confirm("Sign out of Ozara?");
  if (!confirmed) return;

  await signOut(auth);
  window.location.href = "login.html";
});

// Resolves with the signed-in user, or redirects to login.html if there
// isn't one. Call this first thing on every protected page.
export function requireAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      userEmailEl.textContent = user.email;
      resolve(user);
    });
  });
}
