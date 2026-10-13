// js/home.js — Home page: device/door/sensor status, the
// Set timer -> choose duration -> Start cycle flow, and the
// running-cycle / Cancel cycle state.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, onValue, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { TEST_SAMPLE_DATA, LS_SESSIONS } from "./summary.js";
import { createPresence } from "./presence.js";

// The unit's cycle is driven by its own buttons (baseline, load clothes, timer,
// start). The current firmware does not listen to commands/startCycle or
// commands/cancelCycle, so the dashboard only MONITORS for now. Turn this on
// once the firmware reads those commands.
const REMOTE_START_ENABLED = false;

const DEVICE_ID = "device1";

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
  statusMq137: document.getElementById("statusMq137"),
  statusBme680: document.getElementById("statusBme680"),
  lcdNote: document.getElementById("lcdNote"),

  // Timer flow
  setTimerBtn: document.getElementById("setTimerBtn"),
  timerChoicePanel: document.getElementById("timerChoicePanel"),
  cancelFromChoiceBtn: document.getElementById("cancelFromChoiceBtn"),
  chooseSuggestedBtn: document.getElementById("chooseSuggestedBtn"),
  chooseManualBtn: document.getElementById("chooseManualBtn"),
  suggestedPanel: document.getElementById("suggestedPanel"),
  suggestedTable: document.getElementById("suggestedTable"),
  backFromSuggestedBtn: document.getElementById("backFromSuggestedBtn"),
  cancelFromSuggestedBtn: document.getElementById("cancelFromSuggestedBtn"),
  manualPanel: document.getElementById("manualPanel"),
  manualMinutes: document.getElementById("manualMinutes"),
  confirmManualBtn: document.getElementById("confirmManualBtn"),
  backFromManualBtn: document.getElementById("backFromManualBtn"),
  cancelFromManualBtn: document.getElementById("cancelFromManualBtn"),
  readyPanel: document.getElementById("readyPanel"),
  chosenMinutes: document.getElementById("chosenMinutes"),
  startCycleBtn: document.getElementById("startCycleBtn"),
  changeTimerBtn: document.getElementById("changeTimerBtn"),
  cancelFromReadyBtn: document.getElementById("cancelFromReadyBtn"),

  // Running state
  runningPanel: document.getElementById("runningPanel"),
  runningSub: document.getElementById("runningSub"),
  runningMinutesLeft: document.getElementById("runningMinutesLeft"),
  cancelRunningBtn: document.getElementById("cancelRunningBtn")
};

const ALL_PANELS = [
  els.setTimerBtn,
  els.timerChoicePanel,
  els.suggestedPanel,
  els.manualPanel,
  els.readyPanel,
  els.runningPanel
];

let latestStatus = null;
let rawStatus = null;
let lastPresence = null;
const presence = createPresence(); // is the ESP32 still sending? (status.lastSeen changes every push)
let isSafe = false;
let selectedMinutes = null;
let countdownTimer = null;

requireAuth().then(() => {
  const statusRef = ref(db, `devices/${DEVICE_ID}/status`);
  onValue(
    statusRef,
    (snapshot) => {
      els.connDot.style.background = "var(--dot-ok)";
      rawStatus = snapshot.exists() ? snapshot.val() : null;
      if (rawStatus) presence.observe(rawStatus.lastSeen);
      updateHomeStatus(rawStatus);
    },
    (error) => {
      els.connDot.style.background = "var(--dot-err)";
      console.error(error);
    }
  );

  // Flip to "Offline" when the unit stops sending, even if nothing new arrives.
  setInterval(() => {
    if (rawStatus && presence.state() !== lastPresence) updateHomeStatus(rawStatus);
  }, 2000);
});

function updateHomeStatus(status) {
  // A status node that is no longer being refreshed is stale: show it as offline
  // instead of repeating the last "Ready".
  let presenceState = "online";
  if (status && status.lastSeen !== undefined) {
    presenceState = presence.state();
    if (presenceState !== "online") {
      status = { ...status, esp32Ready: false, climateReady: false, gasCalibrated: false, mq137Calibrated: false, cycleRunning: false };
    }
  }
  lastPresence = presenceState;
  latestStatus = status;

  // A cycle actively running takes over the whole lower section,
  // regardless of what step the timer flow was on.
  if (status && status.cycleRunning === true) {
    setBanner("safe", "Cycle running", "Sanitization in progress.", "⏱");
    setDoorCard("safe", "Door closed & locked", "Cycle in progress — do not open.");
    setStatusItem(els.statusEsp32, true, "Ready");
    setStatusItem(els.statusFirebase, true, "Synced");
    setStatusItem(els.statusMq136, status.gasCalibrated === true, status.gasCalibrated ? "Calibrated" : "Not calibrated");
    setStatusItem(els.statusMq137, status.mq137Calibrated === true, status.mq137Calibrated ? "Calibrated" : "Not calibrated");
    setStatusItem(els.statusBme680, status.climateReady === true, status.climateReady ? "Ready" : "Not ready");
    els.lcdNote.hidden = true;
    showRunning(status);
    return;
  }

  stopCountdown();

  if (!status) {
    setBanner("unknown", "Checking status…", "No status data yet from the device.", "•");
    setDoorCard("unknown", "No door sensor yet", "This device doesn't report door status yet.");
    setStatusItem(els.statusEsp32, null, "No data");
    setStatusItem(els.statusFirebase, true, "Synced"); // we're receiving this update, so DB is reachable
    setStatusItem(els.statusMq136, null, "No data");
    setStatusItem(els.statusMq137, null, "No data");
    setStatusItem(els.statusBme680, null, "No data");
    setGate(false, null);
    return;
  }

  const esp32Ready = status.esp32Ready === true;
  const doorClosed = status.doorClosed === true;
  const doorKnown = status.doorClosed !== undefined;
  const gasCalibrated = status.gasCalibrated === true;
  const mq137Calibrated = status.mq137Calibrated === true;
  const climateReady = status.climateReady === true;
  const allSensorsReady = esp32Ready && gasCalibrated && mq137Calibrated && climateReady;
  const safe = doorKnown ? doorClosed && allSensorsReady : allSensorsReady;

  setStatusItem(els.statusEsp32, esp32Ready, esp32Ready ? "Ready" : presenceState === "checking" ? "Checking…" : presenceState === "offline" ? "Offline" : "Not ready");
  setStatusItem(els.statusFirebase, true, "Synced");
  setStatusItem(els.statusMq136, gasCalibrated, gasCalibrated ? "Calibrated" : "Not calibrated");
  setStatusItem(els.statusMq137, mq137Calibrated, mq137Calibrated ? "Calibrated" : "Not calibrated");
  setStatusItem(els.statusBme680, climateReady, climateReady ? "Ready" : "Not ready");

  if (safe) {
    setBanner("safe", "Ready", "All systems normal.", "✓");
    setDoorCard(
      "safe",
      doorKnown ? "Door closed & locked" : "No door sensor yet",
      doorKnown ? "Safe to start cycle" : "Proceeding without door status."
    );
    setGate(true, null);
  } else {
    setBanner("unsafe", "Safety check", "Action required before starting.", "!");
    if (doorKnown && !doorClosed) {
      setDoorCard("unsafe", "Door not fully closed", "Close door securely to continue.");
      setGate(false, 'LCD: "Close door securely."');
    } else {
      setDoorCard("unsafe", "Sensors not ready", "Waiting for ESP32, MQ-136, MQ-137, and BME680.");
      setGate(false, 'LCD: "Waiting for sensors."');
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

// Gates the whole "Set timer" flow on whether it's currently safe to run
// a cycle. Going unsafe mid-flow (e.g. door opened while picking a time)
// snaps the UI back to the disabled button.
function setGate(safe, note) {
  isSafe = safe;
  const canStart = safe && REMOTE_START_ENABLED;
  els.setTimerBtn.disabled = !canStart;
  els.setTimerBtn.textContent = canStart ? "Set timer" : "Set timer — disabled";
  if (safe && !REMOTE_START_ENABLED) note = "Unit is ready. Start the cycle with the buttons on the unit.";

  if (note) {
    els.lcdNote.textContent = note;
    els.lcdNote.hidden = false;
  } else {
    els.lcdNote.hidden = true;
  }

  if (!canStart) resetTimerFlow();
}

// --- Timer flow: Set timer -> (Suggested | Manual) -> Ready -> Start cycle ---

function showPanel(panel) {
  ALL_PANELS.forEach((p) => (p.hidden = p !== panel));
}

function resetTimerFlow() {
  selectedMinutes = null;
  els.manualMinutes.value = "";
  showPanel(els.setTimerBtn);
}

els.setTimerBtn.addEventListener("click", () => {
  if (els.setTimerBtn.disabled) return;
  showPanel(els.timerChoicePanel);
});

els.chooseSuggestedBtn.addEventListener("click", () => showPanel(els.suggestedPanel));
els.chooseManualBtn.addEventListener("click", () => showPanel(els.manualPanel));
els.backFromSuggestedBtn.addEventListener("click", () => showPanel(els.timerChoicePanel));
els.backFromManualBtn.addEventListener("click", () => showPanel(els.timerChoicePanel));
els.changeTimerBtn.addEventListener("click", () => showPanel(els.timerChoicePanel));

// Cancel, from any step of the timer-setup flow, fully exits back to
// the initial "Set timer" button (distinct from "Back", which only
// goes up one step).
[els.cancelFromChoiceBtn, els.cancelFromSuggestedBtn, els.cancelFromManualBtn, els.cancelFromReadyBtn].forEach((btn) =>
  btn.addEventListener("click", resetTimerFlow)
);

els.suggestedTable.addEventListener("click", (e) => {
  const row = e.target.closest(".suggested-row");
  if (!row) return;
  selectDuration(Number(row.dataset.minutes));
});

els.confirmManualBtn.addEventListener("click", () => {
  const minutes = Number(els.manualMinutes.value);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
    els.manualMinutes.focus();
    return;
  }
  selectDuration(Math.round(minutes));
});

function selectDuration(minutes) {
  selectedMinutes = minutes;
  els.chosenMinutes.textContent = minutes;
  showPanel(els.readyPanel);
}

els.startCycleBtn.addEventListener("click", async () => {
  if (!isSafe || !selectedMinutes) return;
  els.startCycleBtn.disabled = true;
  els.startCycleBtn.textContent = "Starting…";
  try {
    if (TEST_SAMPLE_DATA) {
      // Test mode: Monitor reads its sessions from localStorage, so start the
      // purge session there and jump to the Purging monitor tab.
      let sessions = {};
      try { sessions = JSON.parse(localStorage.getItem(LS_SESSIONS)) || {}; } catch { sessions = {}; }
      sessions.purge = { startedAt: Date.now(), durationSec: selectedMinutes * 60 };
      localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions));
      window.location.href = "monitor.html?tab=purge";
      return;
    }
    // durationMinutes is what the ESP32 reads; durationSeconds is what the
    // Monitor page reads to build its purge session window.
    await set(ref(db, `devices/${DEVICE_ID}/commands/startCycle`), {
      durationMinutes: selectedMinutes,
      durationSeconds: selectedMinutes * 60,
      requestedAt: serverTimestamp()
    });
    // The device/status listener will flip to the "running" panel once
    // the ESP32 confirms by writing status.cycleRunning = true. If it
    // doesn't confirm, the flow simply stays on this screen so the
    // person can retry rather than looking like nothing happened.
  } catch (err) {
    console.error(err);
  } finally {
    els.startCycleBtn.disabled = false;
    els.startCycleBtn.textContent = "Start cycle";
  }
});

// --- Running state ---
//
// Expects the ESP32 to write, once it actually starts:
//   devices/{id}/status/cycleRunning = true
//   devices/{id}/status/cycleStartedAt = <server timestamp, ms>
//   devices/{id}/status/cycleDurationMinutes = <number>
// and to set cycleRunning back to false when it finishes on its own.

function showRunning(status) {
  showPanel(els.runningPanel);
  els.cancelRunningBtn.hidden = !REMOTE_START_ENABLED;

  stopCountdown();

  // The unit reports how many seconds are left (cycleRemainingSeconds); count
  // down from the moment this update arrived. Older firmware may instead send
  // cycleStartedAt + cycleDurationMinutes.
  let endAt = null;
  if (typeof status.cycleRemainingSeconds === "number") {
    endAt = Date.now() + status.cycleRemainingSeconds * 1000;
  } else if (status.cycleDurationMinutes && status.cycleStartedAt) {
    endAt = status.cycleStartedAt + status.cycleDurationMinutes * 60 * 1000;
  }

  if (endAt === null) {
    els.runningSub.textContent = "Sanitization in progress…";
    els.runningMinutesLeft.textContent = "—";
    return;
  }

  const tick = () => {
    const msLeft = endAt - Date.now();
    if (msLeft <= 0) {
      els.runningMinutesLeft.textContent = "0";
      els.runningSub.textContent = "Finishing up…";
      stopCountdown();
      return;
    }
    els.runningMinutesLeft.textContent = Math.ceil(msLeft / 60000);
    els.runningSub.textContent = "Sanitization in progress…";
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

els.cancelRunningBtn.addEventListener("click", async () => {
  const confirmed = window.confirm("Cancel the running cycle?");
  if (!confirmed) return;

  els.cancelRunningBtn.disabled = true;
  els.cancelRunningBtn.textContent = "Cancelling…";
  try {
    await set(ref(db, `devices/${DEVICE_ID}/commands/cancelCycle`), {
      requestedAt: serverTimestamp()
    });
    // The ESP32 should stop and set status.cycleRunning = false, which
    // the listener above will pick up and return the UI to normal.
  } catch (err) {
    console.error(err);
  } finally {
    els.cancelRunningBtn.disabled = false;
    els.cancelRunningBtn.textContent = "Cancel cycle";
  }
});
