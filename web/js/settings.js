// js/settings.js — Settings page: display name, notification choices, password reset.

import { requireAuth } from "./shared.js";
import { auth, db } from "../firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { loadSettings, saveSettings, addNotification } from "./layout.js";

const $ = (id) => document.getElementById(id);

function say(el, text, kind) {
  el.textContent = text;
  el.className = `settings-msg${kind ? " " + kind : ""}`;
}

requireAuth().then(async (user) => {
  // ----- Profile -----
  $("setEmail").value = user.email || "";
  const nameInput = $("setName");
  const nameMsg = $("nameMsg");
  try {
    const snap = await get(ref(db, `users/${user.uid}/name`));
    nameInput.value = snap.exists() ? snap.val() : (user.displayName || "");
  } catch {
    nameInput.value = user.displayName || "";
  }

  $("saveNameBtn").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (name.length > 40) { say(nameMsg, "Keep the name under 40 characters.", "bad"); return; }
    $("saveNameBtn").disabled = true;
    say(nameMsg, "Saving…");
    try {
      await set(ref(db, `users/${user.uid}/name`), name || null);
      say(nameMsg, name ? "Saved." : "Name cleared. Your email name is shown instead.", "ok");
    } catch (err) {
      console.error(err);
      say(nameMsg, "Couldn't save. Check your connection and the database rules.", "bad");
    } finally {
      $("saveNameBtn").disabled = false;
    }
  });

  // ----- Account -----
  $("resetPwBtn").addEventListener("click", async () => {
    const msg = $("accountMsg");
    if (!user.email) { say(msg, "This account has no email address.", "bad"); return; }
    $("resetPwBtn").disabled = true;
    say(msg, "Sending…");
    try {
      await sendPasswordResetEmail(auth, user.email);
      say(msg, `Password reset link sent to ${user.email}.`, "ok");
    } catch (err) {
      console.error(err);
      say(msg, "Couldn't send the email. If you sign in with Google, manage your password in your Google account.", "bad");
    } finally {
      $("resetPwBtn").disabled = false;
    }
  });
});

// ----- Notifications (kept in this browser) -----
const settings = loadSettings();
const toggles = { offline: $("optOffline"), cycle: $("optCycle"), fault: $("optFault"), desktop: $("optDesktop") };
const notifMsg = $("notifMsg");

for (const [key, input] of Object.entries(toggles)) input.checked = settings[key] === true;

if (typeof Notification === "undefined") {
  toggles.desktop.disabled = true;
  toggles.desktop.checked = false;
  say(notifMsg, "This browser doesn't support desktop notifications.");
}

for (const key of ["offline", "cycle", "fault"]) {
  toggles[key].addEventListener("change", () => {
    saveSettings({ ...loadSettings(), [key]: toggles[key].checked });
    say(notifMsg, "Saved.", "ok");
  });
}

toggles.desktop.addEventListener("change", async () => {
  if (!toggles.desktop.checked) {
    saveSettings({ ...loadSettings(), desktop: false });
    say(notifMsg, "Saved.", "ok");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    saveSettings({ ...loadSettings(), desktop: true });
    say(notifMsg, "Desktop notifications on. They appear when this tab is in the background.", "ok");
  } else {
    toggles.desktop.checked = false;
    say(notifMsg, "The browser blocked notifications. Allow them in the site settings, then try again.", "bad");
  }
});

$("testNotifBtn").addEventListener("click", () => {
  addNotification("test", "Test notification", "This is how Ozara alerts will look.", { force: true });
  say(notifMsg, "Test sent. Check the bell at the top.", "ok");
});
