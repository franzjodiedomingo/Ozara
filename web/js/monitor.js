// js/monitor.js — Monitor page with two tabs:
//   "Checking status": 10-minute air check of the whole cabinet (before setting the timer).
//   "Purging monitor": live readings while a cycle runs (started from Home).
// Nothing is shown until the matching Start button is pressed.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, query, limitToLast, onValue, set, push, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { TEST_SAMPLE_DATA, LS_HISTORY, LS_SESSIONS, OZONE_SAFE_LIMIT_PPM, numberRuns, summaryHtml, formatNumber } from "./summary.js";

const DEVICE_ID = "device1";
const CHART_POINTS = 60;
const LOG_ROWS = 10;
const CHECK_DURATION_SEC = 600; // the check stops after 10 minutes (lower it to test quickly)

// ---- TESTING: the TEST_SAMPLE_DATA flag now lives in summary.js ----
// When true: fake readings (one every 2s) while a session runs, and
// sessions/history are kept in localStorage instead of Firebase.
const SAMPLE_INTERVAL_MS = 2000;

const PHASES = ["check", "purge"];
const COPY = {
  check: {
    title: "Check cabinet air",
    idle: "Take a 10-minute air reading of the whole cabinet before you set the timer.",
    running: "Reading the air inside the cabinet.",
    done: "Check finished. The captured readings are saved below.",
    badge: { idle: "Not started", running: "Checking", done: "Finished" },
    empty: "No readings yet. Press Start check to begin.",
    historyTitle: "Cabinet air check"
  },
  purge: {
    title: "Purging monitor",
    idle: "Live readings appear here once you start a cycle from Home.",
    running: "Cycle in progress.",
    done: "Cycle finished. The captured readings are saved below.",
    badge: { idle: "Waiting", running: "Purging", done: "Finished" },
    empty: "No readings yet. They start when a cycle starts.",
    historyTitle: "Purge cycle"
  }
};

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("connDot"),
  tabCheck: $("tabCheck"), tabPurge: $("tabPurge"),
  sessionTitle: $("sessionTitle"), sessionSub: $("sessionSub"), sessionBadge: $("sessionBadge"),
  sessionProgress: $("sessionProgress"), sessionProgressBar: $("sessionProgressBar"),
  startCheckBtn: $("startCheckBtn"), goHomeLink: $("goHomeLink"), resetTestBtn: $("resetTestBtn"),
  ozoneValue: $("ozoneValue"), ozoneStatus: $("ozoneStatus"),
  humidityValue: $("humidityValue"), temperatureValue: $("temperatureValue"),
  lastUpdated: $("lastUpdated"), logList: $("logList"), alertList: $("alertList"),
  historyList: $("historyList"),
  chartCanvas: $("readingsChart"), chartEmpty: $("chartEmpty")
};

const state = {
  check: { session: null, readings: [], status: "idle", key: "" },
  purge: { session: null, readings: [], status: "idle", key: "" }
};
let historyAll = [];
let historyReady = false;
let allReadings = []; // real mode: raw readings from Firebase
const saving = new Set();
let activePhase = new URLSearchParams(location.search).get("tab") === "purge" ? "purge" : "check";
let chart = null;
let lastRenderKey = "";

requireAuth().then(() => {
  els.resetTestBtn.hidden = !TEST_SAMPLE_DATA;
  if (TEST_SAMPLE_DATA) {
    els.connDot.style.background = "var(--dot-ok)";
  } else {
    attachFirebase();
  }
  tick();
  setInterval(tick, 1000);
});

// ---------- Data sources ----------

function attachFirebase() {
  const base = `devices/${DEVICE_ID}`;
  const onErr = (error) => {
    els.connDot.style.background = "var(--dot-err)";
    console.error(error);
  };

  onValue(ref(db, `${base}/commands/startCheck`), (snap) => {
    const v = snap.val();
    state.check.session = v && v.requestedAt
      ? { startedAt: v.requestedAt, durationSec: v.durationSeconds || CHECK_DURATION_SEC }
      : null;
  }, onErr);

  onValue(ref(db, `${base}/commands/startCycle`), (snap) => {
    const v = snap.val();
    state.purge.session = v && v.requestedAt && v.durationSeconds
      ? { startedAt: v.requestedAt, durationSec: v.durationSeconds }
      : null;
  }, onErr);

  onValue(query(ref(db, `${base}/readings`), limitToLast(1000)), (snap) => {
    els.connDot.style.background = "var(--dot-ok)";
    const list = [];
    snap.forEach((child) => { list.push(child.val()); }); // braces matter: returning truthy stops forEach
    allReadings = list;
  }, onErr);

  onValue(query(ref(db, `${base}/history`), limitToLast(200)), (snap) => {
    const list = [];
    snap.forEach((child) => { list.push(child.val()); });
    historyAll = list;
    historyReady = true;
  }, onErr);
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function syncLocal() {
  const s = readJson(LS_SESSIONS, {});
  state.check.session = s.check || null;
  state.purge.session = s.purge || null;
  historyAll = readJson(LS_HISTORY, []);
  historyReady = true;
}

// Real mode: a reading belongs to a phase if it falls inside that phase's time window.
function rebuildRealReadings() {
  for (const p of PHASES) {
    const s = state[p].session;
    state[p].readings = s
      ? allReadings.filter((r) => {
          if (r.phase && r.phase !== p) return false;
          return r.timestamp >= s.startedAt && r.timestamp <= s.startedAt + s.durationSec * 1000 + 5000;
        })
      : [];
  }
}

// Test mode: generate fake readings from the session start up to "now" (or the session end).
function generateSample(p) {
  const st = state[p];
  const s = st.session;
  const key = s ? `${s.startedAt}:${s.durationSec}` : "";
  if (st.key !== key) { st.key = key; st.readings = []; }
  if (!s) return;
  const upTo = Math.min(Date.now(), s.startedAt + s.durationSec * 1000);
  const target = Math.floor((upTo - s.startedAt) / SAMPLE_INTERVAL_MS) + 1;
  for (let i = st.readings.length; i < target; i++) {
    st.readings.push(sampleReading(p, i, s.startedAt + i * SAMPLE_INTERVAL_MS, s));
  }
}

function sampleReading(phase, i, timestamp, session) {
  const n = (amp) => (Math.random() - 0.5) * amp;
  if (phase === "check") {
    // Before treatment: the cabinet air is ABOVE the safe limit, with peaks.
    return {
      ozone_ppm: Math.max(0, 0.15 + 0.035 * Math.sin(i / 20) + n(0.015)),
      humidity: 62 + 4 * Math.sin(i / 40) + n(1.5),
      temperature: 31 + 1.2 * Math.sin(i / 50) + n(0.3),
      timestamp
    };
  }
  // Purge: starts high and drops toward the safe limit as the treatment works.
  const progress = Math.min(1, (timestamp - session.startedAt) / (session.durationSec * 1000));
  return {
    ozone_ppm: Math.max(0, 0.04 + 0.12 * Math.exp(-3 * progress) + n(0.008)),
    humidity: 62 - 8 * progress + n(1.5),
    temperature: 31 + 1.5 * Math.sin(i / 30) + n(0.4),
    timestamp
  };
}

// ---------- Session lifecycle ----------

function computeStatus(session) {
  if (!session) return "idle";
  return Date.now() < session.startedAt + session.durationSec * 1000 ? "running" : "done";
}

function buildSummary(p, st) {
  const r = st.readings;
  const s = st.session;
  const avg = (k) => r.reduce((a, x) => a + x[k], 0) / r.length;
  return {
    phase: p,
    startedAt: s.startedAt,
    endedAt: s.startedAt + s.durationSec * 1000,
    durationSec: s.durationSec,
    count: r.length,
    ozoneAvg: avg("ozone_ppm"),
    ozonePeak: Math.max(...r.map((x) => x.ozone_ppm)),
    ozoneStart: r[0].ozone_ppm,
    ozoneEnd: r[r.length - 1].ozone_ppm,
    humidityAvg: avg("humidity"),
    temperatureAvg: avg("temperature")
  };
}

// When a run finishes, save its "captured reading status" once.
function maybeSaveSummary(p) {
  const st = state[p];
  if (st.status !== "done" || !historyReady || st.readings.length === 0) return;
  const id = `${p}:${st.session.startedAt}`;
  if (saving.has(id) || historyAll.some((h) => h.phase === p && h.startedAt === st.session.startedAt)) return;
  saving.add(id);
  const summary = buildSummary(p, st);

  if (TEST_SAMPLE_DATA) {
    try {
      const list = readJson(LS_HISTORY, []);
      list.push(summary);
      localStorage.setItem(LS_HISTORY, JSON.stringify(list));
      historyAll = list;
    } catch (e) { console.error(e); }
  } else {
    push(ref(db, `devices/${DEVICE_ID}/history`), { ...summary, savedAt: serverTimestamp() })
      .catch((e) => { console.error(e); saving.delete(id); });
  }
}

function tick() {
  if (TEST_SAMPLE_DATA) {
    syncLocal();
    PHASES.forEach(generateSample);
  } else {
    rebuildRealReadings();
  }
  for (const p of PHASES) {
    state[p].status = computeStatus(state[p].session);
    maybeSaveSummary(p);
  }
  render();
}

// ---------- Rendering ----------

function render() {
  const p = activePhase;
  const st = state[p];
  const copy = COPY[p];

  els.tabCheck.setAttribute("aria-selected", String(p === "check"));
  els.tabPurge.setAttribute("aria-selected", String(p === "purge"));

  // Session card (updates every second for the countdown)
  els.sessionTitle.textContent = copy.title;
  els.sessionBadge.textContent = copy.badge[st.status];
  els.sessionBadge.className = `session-badge ${st.status}`;
  let sub = copy[st.status];
  if (st.status === "running") {
    const total = st.session.durationSec * 1000;
    const left = Math.max(0, st.session.startedAt + total - Date.now());
    sub += ` Time left ${formatCountdown(left)}.`;
    els.sessionProgress.hidden = false;
    els.sessionProgressBar.style.width = `${Math.min(100, ((total - left) / total) * 100)}%`;
  } else {
    els.sessionProgress.hidden = true;
  }
  els.sessionSub.textContent = sub;
  els.startCheckBtn.hidden = !(p === "check" && st.status !== "running");
  els.startCheckBtn.textContent = st.status === "done" ? "Run check again" : "Start check";
  els.goHomeLink.hidden = !(p === "purge" && st.status === "idle");

  // Data sections: only redraw when something changed
  const key = `${p}:${st.session ? st.session.startedAt : 0}:${st.readings.length}:${st.status}:${historyAll.length}`;
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  const readings = st.readings;
  updateReadingCards(readings[readings.length - 1] || null, st.status);
  updateLogList(readings.slice(-LOG_ROWS).reverse(), copy.empty);
  updateChart(readings.slice(-CHART_POINTS), copy.empty);
  updateAlerts(readings);
  updateHistory(p);
}

function updateReadingCards(reading, status) {
  if (!reading) {
    els.ozoneValue.textContent = "—";
    els.humidityValue.textContent = "—";
    els.temperatureValue.textContent = "—";
    els.ozoneStatus.textContent = status === "idle" ? "Not started" : "Waiting for readings…";
    els.ozoneStatus.classList.remove("warn");
    els.lastUpdated.textContent = "No data yet";
    return;
  }
  els.ozoneValue.textContent = formatNumber(reading.ozone_ppm);
  els.humidityValue.textContent = formatNumber(reading.humidity);
  els.temperatureValue.textContent = formatNumber(reading.temperature);
  els.lastUpdated.textContent = `${status === "done" ? "Final reading" : "Updated"} ${formatTime(reading.timestamp)}`;

  const high = reading.ozone_ppm > OZONE_SAFE_LIMIT_PPM;
  els.ozoneStatus.textContent = high ? "Above safe limit" : "Within safe range";
  els.ozoneStatus.classList.toggle("warn", high);
}

function updateLogList(readings, emptyText) {
  if (readings.length === 0) {
    els.logList.innerHTML = `<p class="log-empty">${emptyText}</p>`;
    return;
  }
  els.logList.innerHTML = readings
    .map((r) => `
      <div class="log-row">
        <span>${formatNumber(r.ozone_ppm)} ppm · ${formatNumber(r.humidity)}% · ${formatNumber(r.temperature)}°C</span>
        <span class="log-time">${formatTime(r.timestamp)}</span>
      </div>`)
    .join("");
}

function ensureChart() {
  if (chart || typeof Chart === "undefined") return;
  const line = (label, color, axis, fill) => ({
    label, data: [], borderColor: color,
    backgroundColor: fill ? "rgba(26,165,101,0.12)" : "transparent",
    yAxisID: axis, tension: 0.3, fill, pointRadius: 0, borderWidth: 2
  });
  chart = new Chart(els.chartCanvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        line("Ozone (ppm)", "#1aa565", "y", true),
        line("Humidity (%)", "#3b82f6", "y1", false),
        line("Temp (°C)", "#f59e0b", "y1", false)
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: "#6b736b" } },
        y: {
          position: "left", beginAtZero: true, suggestedMax: 0.15,
          title: { display: true, text: "ppm" },
          grid: { color: "#e6e8e2" }, ticks: { color: "#6b736b" }
        },
        y1: {
          position: "right", beginAtZero: true, suggestedMax: 100,
          title: { display: true, text: "% / °C" },
          grid: { display: false }, ticks: { color: "#6b736b" }
        }
      }
    }
  });
}

// With no readings the chart keeps its axes and legend but draws no lines.
function updateChart(readings, emptyText) {
  ensureChart();
  if (!chart) {
    els.chartEmpty.style.display = "flex";
    els.chartEmpty.textContent = "Chart library failed to load. Check your connection or ad blocker, then refresh.";
    return;
  }
  chart.data.labels = readings.map((r) => formatTime(r.timestamp));
  chart.data.datasets[0].data = readings.map((r) => r.ozone_ppm);
  chart.data.datasets[1].data = readings.map((r) => r.humidity);
  chart.data.datasets[2].data = readings.map((r) => r.temperature);
  chart.update("none");

  els.chartEmpty.textContent = emptyText;
  els.chartEmpty.style.display = readings.length === 0 ? "flex" : "none";
}

function updateAlerts(readings) {
  const high = readings.filter((r) => r.ozone_ppm > OZONE_SAFE_LIMIT_PPM).slice(-5).reverse();
  if (high.length === 0) {
    els.alertList.innerHTML = `<p class="log-empty">No alerts. Ozone levels are within the safe range.</p>`;
    return;
  }
  els.alertList.innerHTML = high
    .map((r) => `
      <div class="log-row alert-row">
        <span>Ozone reading ${formatNumber(r.ozone_ppm)} ppm exceeded safe limit</span>
        <span class="log-time">${formatTime(r.timestamp)}</span>
      </div>`)
    .join("");
}

// "Captured reading status": finished runs of this tab, newest first, labeled Test N.
function updateHistory(p) {
  const items = numberRuns(historyAll).filter((x) => x.run.phase === p).reverse().slice(0, 10);
  els.historyList.innerHTML = items.length
    ? items.map((x) => summaryHtml(x.run, x.no)).join("")
    : `<p class="log-empty">Nothing captured yet. A summary is saved when the run finishes.</p>`;
}

// ---------- Events ----------

els.tabCheck.addEventListener("click", () => { activePhase = "check"; lastRenderKey = ""; render(); });
els.tabPurge.addEventListener("click", () => { activePhase = "purge"; lastRenderKey = ""; render(); });

els.startCheckBtn.addEventListener("click", async () => {
  els.startCheckBtn.disabled = true;
  try {
    if (TEST_SAMPLE_DATA) {
      const s = readJson(LS_SESSIONS, {});
      s.check = { startedAt: Date.now(), durationSec: CHECK_DURATION_SEC };
      localStorage.setItem(LS_SESSIONS, JSON.stringify(s));
    } else {
      await set(ref(db, `devices/${DEVICE_ID}/commands/startCheck`), {
        requestedAt: serverTimestamp(),
        durationSeconds: CHECK_DURATION_SEC
      });
    }
  } catch (err) {
    console.error(err);
  } finally {
    els.startCheckBtn.disabled = false;
    tick();
  }
});

els.resetTestBtn.addEventListener("click", () => {
  localStorage.removeItem(LS_SESSIONS);
  localStorage.removeItem(LS_HISTORY);
  saving.clear();
  lastRenderKey = "";
  tick();
});

// ---------- Formatting ----------

function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatCountdown(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}