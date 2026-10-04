// js/home.js — Home page: device/door/sensor status and the Start cycle action.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, onValue, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const DEVICE_ID = "device1";

// ---- TESTING FLAGS (set both to false before real use) ----
// TEST_FORCE_ENABLE: buttons stay enabled even if door/sensors aren't ready.
// TEST_SEND_COMMAND: if false, Start cycle only logs to the console and
// does NOT write to Firebase (so the ESP32 can't actually start ozone).
const TEST_FORCE_ENABLE = true;
const TEST_SEND_COMMAND = false;
// TEST_FORCE_STATUS: Home shows "Ready" with all systems normal, ignoring the device.
const TEST_FORCE_STATUS = true;

const els = {
  connDot: document.getElementById("connDot"),
  statusBanner: document.getElementById("statusBanner"),
  statusTitle: document.getElementById("statusTitle"),
  statusSub: document.getElementById("statusSub"),
  statusIcon: document.getElementById("statusIcon"),
  statusRowLabel: document.getElementById("statusRowLabel"),
  statusPill: document.getElementById("statusPill"),
  doorCard: document.getElementById("doorCard"),
  doorIcon: document.getElementById("doorIcon"),
  doorTitle: document.getElementById("doorTitle"),
  doorSub: document.getElementById("doorSub"),
  statusEsp32: document.getElementById("statusEsp32"),
  statusFirebase: document.getElementById("statusFirebase"),
  statusMq136: document.getElementById("statusMq136"),
  statusBme680: document.getElementById("statusBme680"),
  setTimerBtn: document.getElementById("setTimerBtn"),
  timerCard: document.getElementById("timerCard"),
  modeSuggested: document.getElementById("modeSuggested"),
  modeManual: document.getElementById("modeManual"),
  suggestedPanel: document.getElementById("suggestedPanel"),
  manualPanel: document.getElementById("manualPanel"),
  presetList: document.getElementById("presetList"),
  manualHours: document.getElementById("manualHours"),
  manualMinutes: document.getElementById("manualMinutes"),
  manualError: document.getElementById("manualError"),
  timerSummary: document.getElementById("timerSummary"),
  timerSummaryText: document.getElementById("timerSummaryText"),
  startCycleBtn: document.getElementById("startCycleBtn"),
  lcdNote: document.getElementById("lcdNote")
};

let latestStatus = null;

// Suggested timers (edit these to tune the presets).
const MAX_MINUTES = 120;
const PRESETS = [
  { id: "quick",    name: "Quick refresh",   desc: "Light freshening for lightly worn clothes", minutes: 15 },
  { id: "standard", name: "Standard",        desc: "Everyday shirts, pants, and uniforms",       minutes: 30 },
  { id: "bedding",  name: "Bedding & towels", desc: "Thicker, heavier fabrics",                  minutes: 45 },
  { id: "deep",     name: "Deep sanitize",   desc: "Strong odors or shared items",               minutes: 60 },
  { id: "heavy",    name: "Heavy duty",      desc: "Jackets, blankets, and bulky loads",         minutes: 90 }
];

let canStart = false;   // device is safe to run
let timerMode = null;   // "suggested" | "manual" | null
let selectedPreset = null;
let timer = null;       // { mode, presetId, minutes } once valid

requireAuth().then(() => {
  const statusRef = ref(db, `devices/${DEVICE_ID}/status`);
  onValue(
    statusRef,
    (snapshot) => {
      els.connDot.style.background = "var(--dot-ok)";
      updateHomeStatus(snapshot.exists() ? snapshot.val() : null);
    },
    (error) => {
      els.connDot.style.background = "var(--dot-err)";
      console.error(error);
    }
  );
});

function updateHomeStatus(status) {
  if (TEST_FORCE_STATUS) {
    status = { esp32Ready: true, doorClosed: true, gasCalibrated: true, climateReady: true };
  }
  latestStatus = status;

  if (!status) {
    setBanner("unknown", "Checking status…", "No status data yet from the device.", "•");
    setDoorCard("unknown", "No door sensor yet", "This device doesn't report door status yet.");
    setStatusItem(els.statusEsp32, null, "No data");
    setStatusItem(els.statusFirebase, true, "Synced"); // we're receiving this update, so DB is reachable
    setStatusItem(els.statusMq136, null, "No data");
    setStatusItem(els.statusBme680, null, "No data");
    setStartCycle(false, "Start cycle — disabled", null);
    return;
  }

  const esp32Ready = status.esp32Ready === true;
  const doorClosed = status.doorClosed === true;
  const doorKnown = status.doorClosed !== undefined;
  const gasCalibrated = status.gasCalibrated === true;
  const climateReady = status.climateReady === true;
  const allSensorsReady = esp32Ready && gasCalibrated && climateReady;
  const safe = doorKnown ? doorClosed && allSensorsReady : allSensorsReady;

  setStatusItem(els.statusEsp32, esp32Ready, esp32Ready ? "Ready" : "Offline");
  setStatusItem(els.statusFirebase, true, "Synced");
  setStatusItem(els.statusMq136, gasCalibrated, gasCalibrated ? "Calibrated" : "Not calibrated");
  setStatusItem(els.statusBme680, climateReady, climateReady ? "Ready" : "Not ready");

  if (safe) {
    setBanner("safe", "Ready", "All systems normal.", "✓");
    setDoorCard(
      "safe",
      doorKnown ? "Door closed & locked" : "No door sensor yet",
      doorKnown ? "Safe to start cycle" : "Proceeding without door status."
    );
    setStartCycle(true, "Start cycle", null);
  } else {
    setBanner("unsafe", "Safety check", "Action required before starting.", "!");
    if (doorKnown && !doorClosed) {
      setDoorCard("unsafe", "Door not fully closed", "Close door securely to continue.");
      setStartCycle(false, "Start cycle — disabled", 'LCD: "Close door securely."');
    } else {
      setDoorCard("unsafe", "Sensors not ready", "Waiting for ESP32, MQ-136, and BME680.");
      setStartCycle(false, "Start cycle — disabled", 'LCD: "Waiting for sensors."');
    }
  }
}

function setBanner(state, title, sub, icon) {
  els.statusBanner.className = `status-banner ${state}`;
  els.statusTitle.textContent = title;
  els.statusSub.textContent = sub;
  els.statusIcon.textContent = icon;
  els.statusRowLabel.textContent = "Cycle start";
  els.statusPill.textContent = state === "safe" ? "Ready" : state === "unsafe" ? "Blocked" : "Unknown";
}

function setDoorCard(state, title, sub) {
  els.doorCard.className = `card door-card ${state}`;
  els.doorIcon.textContent = state === "safe" ? "🔒" : state === "unsafe" ? "🔓" : "–";
  els.doorTitle.textContent = title;
  els.doorSub.textContent = sub;
}

function setStatusItem(el, ok, label) {
  el.textContent = label;
  el.className = `status-item-value ${ok === null ? "unknown" : ok ? "ok" : "bad"}`;
}

function setStartCycle(enabled, label, note) {
  if (TEST_FORCE_ENABLE) enabled = true;
  canStart = enabled;
  els.setTimerBtn.disabled = !enabled;
  els.setTimerBtn.textContent = enabled ? (timerOpen() ? "Hide timer" : "Set timer") : "Set timer — disabled";
  if (!enabled) closeTimer();
  refreshStartButton();
  if (note) {
    els.lcdNote.textContent = note;
    els.lcdNote.hidden = false;
  } else {
    els.lcdNote.hidden = true;
  }
}

els.startCycleBtn.addEventListener("click", async () => {
  if (els.startCycleBtn.disabled || !timer) return;
  els.startCycleBtn.disabled = true;
  els.startCycleBtn.textContent = "Starting…";
  let started = false;
  try {
    const payload = {
      requestedAt: serverTimestamp(),
      mode: timer.mode,
      presetId: timer.presetId,
      durationMinutes: timer.minutes,
      durationSeconds: timer.minutes * 60
    };
    if (TEST_SEND_COMMAND) {
      await set(ref(db, `devices/${DEVICE_ID}/commands/startCycle`), payload);
    } else {
      console.log("[TEST] startCycle not sent:", payload);
    }
    // Lets the Monitor page's Purging tab start its readings (testing only).
    if (!TEST_SEND_COMMAND) {
      try {
        const sessions = JSON.parse(localStorage.getItem("ozara_test_sessions") || "{}");
        sessions.purge = { startedAt: Date.now(), durationSec: timer.minutes * 60 };
        localStorage.setItem("ozara_test_sessions", JSON.stringify(sessions));
      } catch (e) { console.error(e); }
    }
    started = true;
  } catch (err) {
    console.error(err);
  } finally {
    if (latestStatus) updateHomeStatus(latestStatus);
    if (started) {
      els.lcdNote.textContent = "Cycle started. Watch it in Monitor → Purging monitor.";
      els.lcdNote.hidden = false;
    }
  }
});

// ---- Timer flow: Set timer -> choose mode -> Start cycle ----

function timerOpen() {
  return !els.timerCard.hidden;
}

function closeTimer() {
  els.timerCard.hidden = true;
  els.setTimerBtn.classList.remove("open");
  if (canStart) els.setTimerBtn.textContent = "Set timer";
}

els.setTimerBtn.addEventListener("click", () => {
  if (els.setTimerBtn.disabled) return;
  const open = !timerOpen();
  els.timerCard.hidden = !open;
  els.setTimerBtn.classList.toggle("open", open);
  els.setTimerBtn.textContent = open ? "Hide timer" : "Set timer";
});

function renderPresets() {
  els.presetList.innerHTML = PRESETS.map(
    (p) => `
    <button type="button" class="preset" data-id="${p.id}" aria-pressed="false">
      <span>
        <p class="preset-name">${p.name}</p>
        <p class="preset-desc">${p.desc}</p>
      </span>
      <span class="preset-time">${formatDuration(p.minutes)}</span>
    </button>`
  ).join("");
}

function setMode(mode) {
  timerMode = mode;
  const suggested = mode === "suggested";
  els.modeSuggested.setAttribute("aria-selected", String(suggested));
  els.modeManual.setAttribute("aria-selected", String(!suggested));
  els.suggestedPanel.hidden = !suggested;
  els.manualPanel.hidden = suggested;
  // Switching modes clears the old choice until a new valid one is made.
  if (suggested) {
    applyPreset(selectedPreset);
  } else {
    readManual();
  }
}

function applyPreset(id) {
  selectedPreset = id;
  els.presetList.querySelectorAll(".preset").forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.id === id));
  });
  const preset = PRESETS.find((p) => p.id === id);
  timer = preset ? { mode: "suggested", presetId: preset.id, minutes: preset.minutes } : null;
  updateSummary(preset ? `${preset.name} · ${formatDuration(preset.minutes)}` : null);
}

function readManual() {
  const h = parseInt(els.manualHours.value, 10);
  const m = parseInt(els.manualMinutes.value, 10);
  const hours = Number.isNaN(h) ? 0 : h;
  const mins = Number.isNaN(m) ? 0 : m;
  const total = hours * 60 + mins;

  let error = null;
  if (hours < 0 || mins < 0) error = "Time can't be negative.";
  else if (total < 1) error = "Set at least 1 minute.";
  else if (total > MAX_MINUTES) error = `Maximum is ${formatDuration(MAX_MINUTES)} per cycle.`;

  els.manualError.hidden = !error;
  els.manualError.textContent = error || "";
  timer = error ? null : { mode: "manual", presetId: null, minutes: total };
  updateSummary(error ? null : `Custom · ${formatDuration(total)}`);
}

function updateSummary(text) {
  els.timerSummary.hidden = !text;
  els.timerSummaryText.textContent = text ? `Timer set: ${text}` : "";
  refreshStartButton();
}

// Start cycle only shows after a valid timer is chosen and the device is safe.
function refreshStartButton() {
  const show = canStart && timer !== null;
  els.startCycleBtn.hidden = !show;
  els.startCycleBtn.disabled = !show;
  els.startCycleBtn.textContent = show ? `Start cycle · ${formatDuration(timer.minutes)}` : "Start cycle";
}

function formatDuration(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}

els.modeSuggested.addEventListener("click", () => setMode("suggested"));
els.modeManual.addEventListener("click", () => setMode("manual"));
els.presetList.addEventListener("click", (e) => {
  const btn = e.target.closest(".preset");
  if (btn) applyPreset(btn.dataset.id);
});
els.manualHours.addEventListener("input", readManual);
els.manualMinutes.addEventListener("input", readManual);

renderPresets();

if (TEST_FORCE_ENABLE) setStartCycle(true, "Start cycle", null);
if (TEST_FORCE_STATUS) updateHomeStatus(null);