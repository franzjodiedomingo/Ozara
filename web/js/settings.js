// js/settings.js — Settings page: notification choices, password reset.

import { requireAuth } from "./shared.js";
import { auth } from "../firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { loadSettings, saveSettings } from "./layout.js";

const $ = (id) => document.getElementById(id);

function say(el, text, kind) {
  el.textContent = text;
  el.className = `settings-msg${kind ? " " + kind : ""}`;
}

requireAuth().then(async (user) => {
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
