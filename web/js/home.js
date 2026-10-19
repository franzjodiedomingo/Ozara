// js/home.js — Home page: device/door/sensor status and the live running-cycle
// countdown. The cycle itself is controlled with the Remote controls card
// (js/remote.js), which mirrors the unit's OK / - / + buttons.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { createPresence } from "./presence.js";

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

  // Running state
  runningPanel: document.getElementById("runningPanel"),
  runningSub: document.getElementById("runningSub"),
  runningMinutesLeft: document.getElementById("runningMinutesLeft")
};

let latestStatus = null;
let rawStatus = null;
let lastPresence = null;
const presence = createPresence(); // is the ESP32 still sending? (status.lastSeen changes every push)
let isSafe = false;
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
  els.runningPanel.hidden = true;

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

// Remembers whether it is currently safe to run a cycle and shows the note
// under the status cards. The Remote controls card is always available; the
// unit itself refuses presses it can't act on.
function setGate(safe, note) {
  isSafe = safe;
  if (safe) note = "Unit is ready. Use the Remote controls below, or the buttons on the unit.";

  if (note) {
    els.lcdNote.textContent = note;
    els.lcdNote.hidden = false;
  } else {
    els.lcdNote.hidden = true;
  }
}

// --- Running state ---
//
// The unit reports status.cycleRunning and status.cycleRemainingSeconds; this
// panel just shows that countdown live.

function showRunning(status) {
  els.runningPanel.hidden = false;

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

