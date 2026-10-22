// js/monitor.js — Unified Live Monitor: real-time live telemetry from the ESP32.
// Pure live readings only, directly streamed from Firebase Realtime Database.
//
// Reads:
//   devices/{id}/live      latest real-time snapshot (updated every ~5s)
//   devices/{id}/readings  historical telemetry data points (updated every ~10s)
//   devices/{id}/status    device readiness, door state, and cycle status
//   devices/{id}/history   completed session history records
// Cycle controls (OK, -, +) live on the Home page.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, query, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { createPresence } from "./presence.js";
import { numberRuns, summaryHtml } from "./summary.js";

const DEVICE_ID = "device1";
const CHART_POINTS = 60;
const LOG_ROWS = 10;

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("connDot"),
  // Banner
  banner: $("liveBanner"),
  title: $("liveTitle"),
  sub: $("liveSub"),
  icon: $("liveIcon"),
  pill: $("livePill"),
  // Sensor readings
  bme: $("bmeValue"),
  mq136: $("mq136Value"),
  mq137: $("mq137Value"),
  temp: $("tempValue"),
  hum: $("humValue"),
  gen: $("genValue"),
  outputs: $("outputsStatus"),
  // Chart & Log
  chartCanvas: $("liveChart"),
  chartEmpty: $("chartEmpty"),
  lastUpdated: $("lastUpdated"),
  logList: $("logList"),
  // Alerts & History
  alertList: $("alertList"),
  historyList: $("historyList")
};

const presence = createPresence();
let live = null;
let status = null;
let readings = [];
let historyList = [];
let rawReadings = [];   // everything Firebase sent
let rawHistory = [];
let resetAt = 0;        // set at sign-out: Monitor hides anything older than this
let chart = null;
let lastReadingsKey = "";

requireAuth().then((user) => {
  const onErr = (error) => {
    els.connDot.style.background = "var(--dot-err)";
    console.error(error);
  };

  const base = `devices/${DEVICE_ID}`;

  // 0. Monitor reset point (written at sign-out, see shared.js). Display filter only.
  let localReset = 0;
  try { localReset = Number(localStorage.getItem(`ozara_monitor_reset_${user.uid}`)) || 0; } catch { /* blocked */ }
  resetAt = localReset;
  onValue(ref(db, `users/${user.uid}/monitorResetAt`), (snap) => {
    resetAt = Math.max(Number(snap.val()) || 0, localReset);
    applyReset();
  }, (error) => console.warn("Monitor reset point unavailable", error));

  // 1. Live real-time snapshot
  onValue(ref(db, `${base}/live`), (snap) => {
    els.connDot.style.background = "var(--dot-ok)";
    live = snap.exists() ? snap.val() : null;
    if (live && live.ts) presence.observe(live.ts);
    renderLive();
  }, onErr);

  // 2. Status node
  onValue(ref(db, `${base}/status`), (snap) => {
    status = snap.exists() ? snap.val() : null;
    if (status && status.lastSeen) presence.observe(status.lastSeen);
    renderLive();
  }, onErr);

  // 3. Time-series real readings
  onValue(query(ref(db, `${base}/readings`), limitToLast(CHART_POINTS)), (snap) => {
    const list = [];
    snap.forEach((child) => { list.push(child.val()); });
    rawReadings = list;
    applyReset();
  }, onErr);

  // 4. Completed history records
  onValue(query(ref(db, `${base}/history`), limitToLast(50)), (snap) => {
    const list = [];
    snap.forEach((child) => { list.push(child.val()); });
    rawHistory = list;
    applyReset();
  }, onErr);

  // Periodic ticker to check presence & count down time accurately
  setInterval(renderLive, 1000);
});

// Hide what happened before the last sign-out. The data stays in Firebase and on the History page.
function applyReset() {
  readings = rawReadings.filter((r) => !resetAt || (Number(r.timestamp) || 0) >= resetAt);
  historyList = rawHistory.filter((h) => !resetAt || (Number(h.endedAt) || Number(h.startedAt) || 0) >= resetAt);
  lastReadingsKey = "";   // force a redraw even if the last point looks the same
  renderReadings();
  renderHistory();
}

// ---------- Rendering ----------

function phaseLabel(phase) {
  if (!phase) return "—";
  const s = String(phase).replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatClock(seconds) {
  if (typeof seconds !== "number" || seconds < 0) return "0:00";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderLive() {
  const pState = presence.state();
  const online = pState === "online";
  const valid = online && live && live.valid === true;

  // Banner state
  let bannerClass = "unknown", title, sub, icon, pill;
  if (pState === "checking") {
    title = "Checking device…";
    sub = "Waiting for the unit to report in.";
    icon = "•";
    pill = "Checking";
  } else if (!online) {
    title = "Unit offline";
    sub = live
      ? "No update from the unit recently. Check its power and Wi-Fi connection."
      : "Waiting for telemetry from the unit.";
    icon = "!";
    pill = "Offline";
  } else {
    const fault = live.phase === "SENSOR_FAULT" || live.phase === "SENSOR_ERROR";
    bannerClass = fault ? "unsafe" : "safe";
    title = phaseLabel(live.phase);
    sub = typeof live.remaining === "number" && live.remaining > 0
      ? `${formatClock(live.remaining)} remaining in this phase`
      : "Unit is online and streaming live telemetry.";
    icon = fault ? "!" : "✓";
    pill = "Online";
  }

  els.banner.className = `status-banner ${bannerClass}`;
  els.title.textContent = title;
  els.sub.textContent = sub;
  els.icon.textContent = icon;
  els.pill.textContent = pill;

  // Sensor reading values
  els.mq136.textContent = valid && typeof live.mq136 === "number" ? live.mq136 : "—";
  els.mq137.textContent = valid && typeof live.mq137 === "number" ? live.mq137 : "—";
  els.bme.textContent = valid && typeof live.gasKOhm === "number" ? live.gasKOhm.toFixed(2) : "—";
  els.temp.textContent = valid && typeof live.temperature === "number" ? live.temperature.toFixed(1) : "—";
  els.hum.textContent = valid && typeof live.humidity === "number" ? live.humidity.toFixed(1) : "—";

  // Actuator / Fan Outputs
  if (online && live) {
    els.gen.textContent = live.ozoneOn ? "ON" : "OFF";
    els.gen.style.color = live.ozoneOn ? "var(--green)" : "";
    const fanState = (on) => (on ? "on" : "off");
    els.outputs.textContent =
      `Circulation fan ${fanState(live.fan)} · Purge fan ${fanState(live.purgeFan)} · Sensor fan ${fanState(live.sensorFan)}`;
  } else {
    els.gen.textContent = "—";
    els.gen.style.color = "";
    els.outputs.textContent = "Commanded outputs, not measured";
  }

  // System & Safety Alerts
  renderAlerts(online, valid);
}

function renderAlerts(online, valid) {
  const alerts = [];

  if (!online) {
    alerts.push("Unit is currently offline. Ensure ESP32 is powered on and connected to Wi-Fi.");
  } else {
    if (live && (live.phase === "SENSOR_FAULT" || live.phase === "SENSOR_ERROR")) {
      alerts.push("Sensor fault detected on ESP32 unit. Check wiring and sensors.");
    }
    if (live && live.valid === false) {
      alerts.push("Sensors are currently warming up. Readings will stabilize shortly.");
    }
    if (status && status.doorOpen) {
      alerts.push("Cabinet door is currently OPEN.");
    }
  }

  if (alerts.length === 0) {
    els.alertList.innerHTML = `<p class="log-empty">No active alerts. Operating within safe parameters.</p>`;
  } else {
    els.alertList.innerHTML = alerts.map((msg) => `
      <div class="log-row" style="color:var(--err); font-weight:600;">
        <span>⚠️ ${msg}</span>
      </div>`).join("");
  }
}

function renderReadings() {
  const last = readings[readings.length - 1];
  const key = `${readings.length}:${last ? last.timestamp : 0}`;
  if (key === lastReadingsKey) return;
  lastReadingsKey = key;

  els.lastUpdated.textContent = last ? `Last reading ${formatTime(last.timestamp)}` : "No data yet";
  updateLog();
  updateChart();
}

function updateLog() {
  const rows = readings.filter((r) => r.valid !== false).slice(-LOG_ROWS).reverse();
  if (rows.length === 0) {
    els.logList.innerHTML = `<p class="log-empty">No readings yet.</p>`;
    return;
  }
  const n = (v, d = 0) => (typeof v === "number" ? v.toFixed(d) : "—");
  els.logList.innerHTML = rows.map((r) => `
    <div class="log-row">
      <span>MQ-136 ${n(r.mq136)} · MQ-137 ${n(r.mq137)} · BME ${n(r.gasKOhm, 1)} kΩ · ${n(r.temperature, 1)}°C · ${n(r.humidity, 0)}%</span>
      <span class="log-time">${formatTime(r.timestamp)}</span>
    </div>`).join("");
}

function ensureChart() {
  if (chart || typeof Chart === "undefined") return;
  const line = (label, color, axis) => ({
    label,
    data: [],
    borderColor: color,
    backgroundColor: "transparent",
    yAxisID: axis,
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 2
  });

  chart = new Chart(els.chartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        line("MQ-136", "#1aa565", "y"),
        line("MQ-137", "#f59e0b", "y"),
        line("BME680 (kΩ)", "#3b82f6", "y1")
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6, color: "#6b736b" }
        },
        y: {
          position: "left",
          beginAtZero: true,
          suggestedMax: 4095,
          title: { display: true, text: "ADC" },
          grid: { color: "#e6e8e2" },
          ticks: { color: "#6b736b" }
        },
        y1: {
          position: "right",
          beginAtZero: true,
          title: { display: true, text: "kΩ" },
          grid: { display: false },
          ticks: { color: "#6b736b" }
        }
      }
    }
  });
}

function updateChart() {
  ensureChart();
  if (!chart) {
    els.chartEmpty.style.display = "flex";
    els.chartEmpty.textContent = "Chart library loading…";
    return;
  }
  const rows = readings.filter((r) => r.valid !== false);
  chart.data.labels = rows.map((r) => formatTime(r.timestamp));
  chart.data.datasets[0].data = rows.map((r) => r.mq136);
  chart.data.datasets[1].data = rows.map((r) => r.mq137);
  chart.data.datasets[2].data = rows.map((r) => r.gasKOhm);
  chart.update("none");

  els.chartEmpty.textContent = "No readings yet.";
  els.chartEmpty.style.display = rows.length === 0 ? "flex" : "none";
}

function renderHistory() {
  if (!historyList || historyList.length === 0) {
    els.historyList.innerHTML = `<p class="log-empty">No completed cycles recorded yet.</p>`;
    return;
  }
  const numbered = numberRuns(historyList).reverse();
  els.historyList.innerHTML = numbered.slice(0, 10).map(({ run, no }) => summaryHtml(run, no)).join("");
}