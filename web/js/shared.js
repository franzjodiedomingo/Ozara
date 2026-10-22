// js/shared.js
// Common auth guard + sign-out wiring used by every dashboard page
// (home.html, monitor.html, history.html, profile.html, settings.html).

import { auth, db } from "../firebase-config.js";
import { ref, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const userEmailEl = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");

// ---------- Sign-out pop-up ----------

// styles for the pop-up (css/signout.css), added once
if (!document.querySelector("link[data-signout-css]")) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../css/signout.css", import.meta.url).href;
  link.dataset.signoutCss = "";
  document.head.append(link);
}

const DIALOG_HTML = `
  <div class="signout-card" role="dialog" aria-modal="true" aria-labelledby="signoutTitle" aria-describedby="signoutDesc">
    <svg class="signout-deco" viewBox="0 0 300 300" aria-hidden="true">
      <circle cx="230" cy="110" r="150" fill="none" stroke="#22e1e4" stroke-opacity="0.14" stroke-width="1.5"/>
      <circle cx="230" cy="110" r="95" fill="none" stroke="#22e1e4" stroke-opacity="0.12" stroke-width="1.5"/>
      <circle cx="230" cy="110" r="34" fill="none" stroke="#22e1e4" stroke-opacity="0.18" stroke-width="1.5"/>
      <circle cx="230" cy="110" r="9" fill="#0e8f86"/>
    </svg>
    <div class="signout-body">
      <span class="signout-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
      </span>
      <div>
        <h2 class="signout-title" id="signoutTitle">Sign out of Ozara?</h2>
        <p class="signout-text" id="signoutDesc">You’ll be signed out of your account and returned to the login page.</p>
      </div>
    </div>
    <p class="signout-msg" data-msg role="alert" hidden></p>
    <div class="signout-actions">
      <button type="button" class="signout-btn signout-cancel" data-cancel>Cancel</button>
      <button type="button" class="signout-btn signout-confirm" data-confirm>
        <span data-confirm-label>Sign out</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
      </button>
    </div>
  </div>`;

let dialogOpen = false;

// On sign-out the Monitor page starts fresh next time: it only shows readings and
// completed cycles recorded AFTER this moment. Nothing is deleted. The History page
// never looks at this value, so every past cycle stays there.
// Never blocks sign-out: if Firebase is unreachable we keep a local fallback instead.
export async function markMonitorReset() {
  const user = auth.currentUser;
  if (!user) return;
  const localKey = `ozara_monitor_reset_${user.uid}`;
  try {
    await Promise.race([
      set(ref(db, `users/${user.uid}/monitorResetAt`), serverTimestamp()),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2500))
    ]);
    try { localStorage.removeItem(localKey); } catch { /* storage blocked */ }
  } catch (err) {
    console.warn("Monitor reset not saved to Firebase, using local fallback", err);
    try { localStorage.setItem(localKey, String(Date.now())); } catch { /* storage blocked */ }
  }
}

function openSignOutDialog() {
  if (dialogOpen) return;
  dialogOpen = true;

  // the user menu is still open behind the pop-up: close it and return focus to its button
  const userPanel = document.getElementById("userPanel");
  const userBtn = document.getElementById("userBtn");
  if (userPanel) userPanel.hidden = true;
  if (userBtn) userBtn.setAttribute("aria-expanded", "false");
  const returnFocusTo = userBtn || logoutBtn;

  const overlay = document.createElement("div");
  overlay.className = "signout-overlay";
  overlay.innerHTML = DIALOG_HTML;          // fixed markup, no user data
  document.body.append(overlay);
  document.body.classList.add("signout-lock");

  const cancelBtn = overlay.querySelector("[data-cancel]");
  const confirmBtn = overlay.querySelector("[data-confirm]");
  const label = overlay.querySelector("[data-confirm-label]");
  const message = overlay.querySelector("[data-msg]");
  let busy = false;

  function close() {
    document.removeEventListener("keydown", onKeydown, true);
    overlay.remove();
    document.body.classList.remove("signout-lock");
    dialogOpen = false;
    if (returnFocusTo) returnFocusTo.focus();
  }

  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!busy) close();
      return;
    }
    if (e.key === "Tab") {                  // keep keyboard focus inside the pop-up
      const items = [cancelBtn, confirmBtn].filter((b) => !b.disabled);
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!items.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener("keydown", onKeydown, true);

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay && !busy) close(); });
  cancelBtn.addEventListener("click", close);

  confirmBtn.addEventListener("click", async () => {
    busy = true;
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    message.hidden = true;
    label.textContent = "Signing out…";
    try {
      await markMonitorReset();   // Monitor starts fresh next login; History is untouched
      await signOut(auth);
      window.location.href = "login.html";
    } catch (err) {
      console.error(err);
      busy = false;
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      label.textContent = "Sign out";
      message.textContent = "Couldn’t sign out. Check your connection and try again.";
      message.hidden = false;
    }
  });

  cancelBtn.focus();                        // the safe choice is focused first
}

if (logoutBtn) logoutBtn.addEventListener("click", openSignOutDialog);

// ---------- Auth guard ----------

// Resolves with the signed-in user, or redirects to login.html if there
// isn't one. Call this first thing on every protected page.
export function requireAuth() {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, (user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }
      if (userEmailEl) userEmailEl.textContent = user.email;
      resolve(user);
    });
  });
}
