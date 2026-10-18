// js/profile.js — Profile page: name, contact number, role, joined date, change password.
//
// Saved in the Realtime Database at users/{uid}: name, phone (the rules already
// let each person write only their own node). Role and email are not editable here.

import { requireAuth } from "./shared.js";
import { auth, db } from "../firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { roleLabel, resolveName } from "./roles.js";

const $ = (id) => document.getElementById(id);
const PHONE_OK = /^\+?[0-9 ()-]{7,20}$/;

let currentUser = null;
let saved = { name: "", phone: "", role: "" };   // what is stored in the database
let editing = false;

function say(el, text, kind) {
  el.textContent = text;
  el.className = `settings-msg${kind ? " " + kind : ""}`;
}

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function showAvatar(name, photoURL) {
  const avatar = $("profAvatar");
  avatar.replaceChildren();
  if (photoURL) {
    const img = document.createElement("img");
    img.src = photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => { avatar.replaceChildren(document.createTextNode(initials(name))); });
    avatar.append(img);
  } else {
    avatar.textContent = initials(name);
  }
}

function render() {
  const user = currentUser;
  const name = resolveName(user, saved.name);
  const role = roleLabel(user.email, saved.role);
  $("profName").textContent = name;
  $("profRoleLine").textContent = role;
  $("profRole").textContent = role;
  $("profEmail").textContent = user.email || "—";
  const phone = $("profPhone");
  phone.textContent = saved.phone || "Not added";
  phone.classList.toggle("muted", !saved.phone);
  const created = user.metadata && user.metadata.creationTime ? new Date(user.metadata.creationTime) : null;
  $("profJoined").textContent = created && !isNaN(created)
    ? created.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
    : "—";
  showAvatar(name, user.photoURL);
}

function setEditing(on) {
  editing = on;
  $("profName").hidden = on;
  $("profNameInput").hidden = !on;
  $("profPhone").hidden = on;
  $("profPhoneInput").hidden = !on;
  $("editBtn").hidden = on;
  $("saveBtn").hidden = !on;
  $("cancelBtn").hidden = !on;
  if (on) {
    $("profNameInput").value = resolveName(currentUser, saved.name);
    $("profPhoneInput").value = saved.phone;
    $("profNameInput").focus();
  } else {
    render();
  }
}

async function save() {
  const name = $("profNameInput").value.trim();
  const phone = $("profPhoneInput").value.trim();
  const msg = $("profMsg");
  if (name.length > 40) { say(msg, "Keep the name under 40 characters.", "bad"); return; }
  if (phone && !PHONE_OK.test(phone)) { say(msg, "Enter a valid contact number, for example 0917 123 4567 or +63 917 123 4567.", "bad"); return; }

  $("saveBtn").disabled = true;
  say(msg, "Saving…");
  try {
    await update(ref(db, `users/${currentUser.uid}`), { name: name || null, phone: phone || null });
    saved.name = name;
    saved.phone = phone;
    say(msg, "Profile saved.", "ok");
    setEditing(false);
  } catch (err) {
    console.error(err);
    say(msg, "Couldn't save. Check your connection and the database rules.", "bad");
  } finally {
    $("saveBtn").disabled = false;
  }
}

requireAuth().then((user) => {
  currentUser = user;
  render();

  onValue(ref(db, `users/${user.uid}`), (snap) => {
    const v = snap.val() || {};
    saved = { name: v.name || "", phone: v.phone || "", role: v.role || "" };
    if (!editing) render();
  }, () => { /* no access: keep what we can show from the account */ });

  $("editBtn").addEventListener("click", () => { say($("profMsg"), ""); setEditing(true); });
  $("cancelBtn").addEventListener("click", () => { say($("profMsg"), ""); setEditing(false); });
  $("saveBtn").addEventListener("click", save);
  for (const id of ["profNameInput", "profPhoneInput"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") setEditing(false);
    });
  }

  $("changePwBtn").addEventListener("click", async () => {
    const msg = $("pwMsg");
    const providers = (user.providerData || []).map((p) => p.providerId);
    if (providers.length && !providers.includes("password")) {
      say(msg, "You sign in with Google, so your password is managed in your Google account.");
      return;
    }
    if (!user.email) { say(msg, "This account has no email address.", "bad"); return; }
    $("changePwBtn").disabled = true;
    say(msg, "Sending…");
    try {
      await sendPasswordResetEmail(auth, user.email);
      say(msg, `Password reset link sent to ${user.email}. Check your inbox and spam folder.`, "ok");
    } catch (err) {
      console.error(err);
      say(msg, "Couldn't send the email. Try again in a bit.", "bad");
    } finally {
      $("changePwBtn").disabled = false;
    }
  });
});
