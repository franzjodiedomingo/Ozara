// js/layout.js — behaviour shared by every dashboard page:
//   • user menu (name, avatar, sign out)
//   • notification bell (alerts kept in this browser)
//   • "Device Online / Offline" card in the sidebar
//
// Notifications are created while Ozara is open in a browser tab. They are not
// push messages, so nothing arrives while every Ozara tab is closed.

import { auth, db } from "../firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { createPresence } from "./presence.js";
import { roleLabel, resolveName } from "./roles.js";

const DEVICE_ID = "device1";
const NOTIF_KEY = "ozara_notifications";
const LAST_KEY = "ozara_last_state";
const SETTINGS_KEY = "ozara_settings";
const MAX_NOTIFS = 30;

export const SETTINGS_DEFAULTS = { offline: true, cycle: true, fault: true, desktop: false };

const $ = (id) => document.getElementById(id);

function readJson(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export function loadSettings() { return { ...SETTINGS_DEFAULTS, ...readJson(SETTINGS_KEY, {}) }; }
export function saveSettings(settings) { writeJson(SETTINGS_KEY, settings); }

// ---------- Menus (bell + user) ----------

const closers = [];
function closeAll() { closers.forEach((close) => close()); }

function setupMenu(buttonId, panelId, onOpen) {
  const btn = $(buttonId);
  const panel = $(panelId);
  if (!btn || !panel) return;
  const close = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  closers.push(close);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = !panel.hidden;
    closeAll();
    if (!wasOpen) {
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      if (onOpen) onOpen();
    }
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
}
document.addEventListener("click", closeAll);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });

// ---------- Notifications ----------

function loadNotifs() { const l = readJson(NOTIF_KEY, []); return Array.isArray(l) ? l : []; }
function saveNotifs(list) { writeJson(NOTIF_KEY, list.slice(0, MAX_NOTIFS)); }

const SETTING_FOR_TYPE = { offline: "offline", online: "offline", cycle: "cycle", fault: "fault" };

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function updateBadge() {
  const badge = $("notifBadge");
  if (!badge) return;
  const unread = loadNotifs().filter((n) => !n.read).length;
  badge.hidden = unread === 0;
  badge.textContent = unread > 9 ? "9+" : String(unread);
}

function renderNotifs() {
  updateBadge();
  const box = $("notifList");
  if (!box) return;
  const list = loadNotifs();
  box.replaceChildren();
  if (list.length === 0) {
    const p = document.createElement("p");
    p.className = "notif-empty";
    p.textContent = "No notifications yet.";
    box.append(p);
    return;
  }
  for (const n of list) {
    const item = document.createElement("div");
    item.className = `notif-item${n.read ? "" : " unread"}`;

    const icon = document.createElement("span");
    const warn = n.type === "offline" || n.type === "fault";
    icon.className = `notif-icon${warn ? " warn" : ""}`;
    icon.textContent = warn ? "!" : n.type === "test" ? "i" : "✓";

    const body = document.createElement("div");
    const title = document.createElement("p");
    title.className = "notif-title";
    title.textContent = n.title;
    const text = document.createElement("p");
    text.className = "notif-text";
    text.textContent = n.text;
    const time = document.createElement("p");
    time.className = "notif-time";
    time.textContent = timeAgo(n.at);
    body.append(title, text, time);

    item.append(icon, body);
    box.append(item);
  }
}

function markAllRead() {
  saveNotifs(loadNotifs().map((n) => ({ ...n, read: true })));
  updateBadge();
}

function maybeDesktopNotify(title, text, settings) {
  if (!settings.desktop || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;     // the bell is enough while the tab is in view
  try { new Notification(title, { body: text, icon: "favicon-192.png" }); } catch { /* ignore */ }
}

// type: "offline" | "online" | "cycle" | "fault" (turned on/off in Settings), or "test"
export function addNotification(type, title, text, { force = false } = {}) {
  const settings = loadSettings();
  const key = SETTING_FOR_TYPE[type];
  if (!force && key && settings[key] === false) return;
  const list = loadNotifs();
  const now = Date.now();
  // another open tab may have just added the same alert
  if (!force && list.some((n) => n.type === type && n.title === title && now - n.at < 30000)) return;
  list.unshift({ id: now.toString(36) + Math.random().toString(36).slice(2, 6), type, title, text, at: now, read: false });
  saveNotifs(list);
  renderNotifs();
  maybeDesktopNotify(title, text, settings);
}

// ---------- User info ----------

function initials(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function showUser(name, photoURL, role) {
  const nameEl = $("userName");
  const subEl = $("userSub");
  const avatar = $("userAvatar");
  if (nameEl) nameEl.textContent = name;
  if (subEl) subEl.textContent = role || "Member";
  if (avatar) {
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
}

// ---------- Device status card + notification events ----------

const presence = createPresence();
let deviceStatus = null;

function setDeviceCard(kind, title, sub) {
  const dot = $("deviceDot");
  if (!dot) return;
  dot.className = `status-dot ${kind}`;
  $("deviceTitle").textContent = title;
  $("deviceSub").textContent = sub;
}

function refreshDevice() {
  const state = presence.state();
  if (state === "checking") {
    setDeviceCard("unknown", "Checking device…", "Please wait");
  } else if (state === "offline") {
    setDeviceCard("bad", "Device Offline", deviceStatus ? "Check power and Wi-Fi" : "No data from the unit yet");
  } else if (deviceStatus.phase === "SENSOR_FAULT") {
    setDeviceCard("bad", "Sensor fault", "Inspect the BME680");
  } else if (deviceStatus.cycleRunning) {
    setDeviceCard("ok", "Cycle running", "Sanitization in progress");
  } else if (!deviceStatus.esp32Ready) {
    setDeviceCard("unknown", "Device Online", "Sensors warming up");
  } else {
    setDeviceCard("ok", "Device Online", "System Operational");
  }
  detectEvents(state);
}

// Compares with the last state this browser saw, so moving between pages does
// not repeat alerts, and something that happened while Ozara was closed is
// reported once on the next visit.
function detectEvents(state) {
  if (state === "checking") return;
  const online = state === "online";
  const last = readJson(LAST_KEY, null);
  const now = {
    online,
    // while offline we know nothing new about the cycle or sensors: keep the old values
    cycle: online ? deviceStatus.cycleRunning === true : (last ? last.cycle : false),
    fault: online ? deviceStatus.phase === "SENSOR_FAULT" : (last ? last.fault : false)
  };
  if (last) {
    if (last.online && !online) addNotification("offline", "Device offline", "The unit stopped sending data. Check its power and Wi-Fi.");
    if (!last.online && online) addNotification("online", "Device back online", "The unit is sending data again.");
    if (!last.cycle && now.cycle) addNotification("cycle", "Cycle started", "A sanitization cycle is running.");
    if (last.cycle && !now.cycle && online) addNotification("cycle", "Cycle finished", "The unit finished its cycle. Check the results on the unit.");
    if (!last.fault && now.fault) addNotification("fault", "Sensor fault", "BME680 fault: inspect the sensor and wiring.");
  }
  writeJson(LAST_KEY, now);
}

// ---------- Start ----------

setupMenu("notifBtn", "notifPanel", () => {
  renderNotifs();          // draw with the unread highlight...
  markAllRead();           // ...then clear the badge
});
setupMenu("userBtn", "userPanel");

$("notifReadAll")?.addEventListener("click", () => { markAllRead(); renderNotifs(); });
$("notifClear")?.addEventListener("click", () => { saveNotifs([]); renderNotifs(); });
renderNotifs();
setInterval(() => { const panel = $("notifPanel"); if (panel && !panel.hidden) renderNotifs(); }, 30000);

let started = false;
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  showUser(resolveName(user, null), user.photoURL, roleLabel(user.email, null));

  // display name / role saved from Settings (users/{uid})
  onValue(ref(db, `users/${user.uid}`), (snap) => {
    const v = snap.val() || {};
    showUser(resolveName(user, v.name), user.photoURL, roleLabel(user.email, v.role));
  }, () => { /* no access: keep the fallback name */ });

  if (started) return;
  started = true;
  onValue(ref(db, `devices/${DEVICE_ID}/status`), (snap) => {
    deviceStatus = snap.exists() ? snap.val() : null;
    if (deviceStatus) presence.observe(deviceStatus.lastSeen);
    refreshDevice();
  }, () => { /* keep "Checking device…" */ });
  setInterval(refreshDevice, 2000);
});
