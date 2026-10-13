// js/live.js — Live page: real readings from the ESP32, sent over the internet.
//
// Reads:
//   devices/{id}/live      latest snapshot (overwritten every ~5 s)
//   devices/{id}/readings  history points (one every ~10 s), last CHART_POINTS shown
//
// Values: BME680 gas resistance (kOhm), MQ-136 and MQ-137 raw ADC (0-4095),
// temperature and humidity. None of these are ppm and none are an ozone reading.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, query, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { createPresence } from "./presence.js";

const DEVICE_ID = "device1";
const CHART_POINTS = 60;
const LOG_ROWS = 10;

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("connDot"),
  banner: $("liveBanner"), title: $("liveTitle"), sub: $("liveSub"), icon: $("liveIcon"), pill: $("livePill"),
  bme: $("bmeValue"), mq136: $("mq136Value"), mq137: $("mq137Value"),
  temp: $("tempValue"), hum: $("humValue"), gen: $("genValue"), outputs: $("outputsStatus"),
  lastUpdated: $("lastUpdated"), logList: $("logList"),
  chartCanvas: $("liveChart"), chartEmpty: $("chartEmpty")
};

const presence = createPresence();
let live = null;
let readings = [];
let chart = null;
let lastReadingsKey = "";

requireAuth().then(() => {
  const onErr = (error) => {
    els.connDot.style.background = "var(--dot-err)";
    console.error(error);
  };

  onValue(ref(db, `devices/${DEVICE_ID}/live`), (snap) => {
    els.connDot.style.background = "var(--dot-ok)";
    live = snap.exists() ? snap.val() : null;
    if (live) presence.observe(live.ts);
    render();
  }, onErr);

  onValue(query(ref(db, `devices/${DEVICE_ID}/readings`), limitToLast(CHART_POINTS)), (snap) => {
    const list = [];
    snap.forEach((child) => { list.push(child.val()); }); // braces matter: returning truthy stops forEach
    readings = list;
    renderReadings();
  }, onErr);

  setInterval(render, 1000); // so "offline" shows even when no new data arrives
});

// ---------- Rendering ----------

function phaseLabel(phase) {
  if (!phase) return "—";
  const s = String(phase).replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatClock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function render() {
  const state = live ? presence.state() : (presence.state() === "checking" ? "checking" : "offline");
  const online = state === "online";
  const valid = online && live && live.valid === true;

  // Banner
  let bannerClass = "unknown", title, sub, icon, pill;
  if (state === "checking") {
    title = "Checking device…"; sub = "Waiting for the unit to report in."; icon = "•"; pill = "Checking";
  } else if (!online) {
    title = "Unit offline";
    sub = live ? "No update from the unit for a while. Check its power and Wi-Fi." : "No data yet from the unit.";
    icon = "!"; pill = "Offline";
  } else {
    const fault = live.phase === "SENSOR_FAULT";
    bannerClass = fault ? "unsafe" : "safe";
    title = phaseLabel(live.phase);
    sub = typeof live.remaining === "number"
      ? `${formatClock(live.remaining)} left in this phase`
      : "Waiting for input on the unit";
    icon = fault ? "!" : "✓";
    pill = "Online";
  }
  els.banner.className = `status-banner ${bannerClass}`;
  els.title.textContent = title;
  els.sub.textContent = sub;
  els.icon.textContent = icon;
  els.pill.textContent = pill;

  // Reading cards
  els.bme.textContent = valid && typeof live.gasKOhm === "number" ? live.gasKOhm.toFixed(2) : "—";
  els.mq136.textContent = valid && typeof live.mq136 === "number" ? live.mq136 : "—";
  els.mq137.textContent = valid && typeof live.mq137 === "number" ? live.mq137 : "—";
  els.temp.textContent = valid && typeof live.temperature === "number" ? live.temperature.toFixed(1) : "—";
  els.hum.textContent = valid && typeof live.humidity === "number" ? live.humidity.toFixed(1) : "—";

  if (online && live) {
    els.gen.textContent = live.ozoneOn ? "ON" : "OFF";
    els.outputs.textContent =
      `Circulation fan ${live.fan ? "on" : "off"} · Purge fan ${live.purgeFan ? "on" : "off"} · Sensor fan ${live.sensorFan ? "on" : "off"}`;
  } else {
    els.gen.textContent = "—";
    els.outputs.textContent = "Commanded outputs, not measured";
  }
}

function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function renderReadings() {
  const last = readings[readings.length - 1];
  const key = `${readings.length}:${last ? last.timestamp : 0}`;
  if (key === lastReadingsKey) return;
  lastReadingsKey = key;

  els.lastUpdated.textContent = last ? `Last point ${formatTime(last.timestamp)}` : "No data yet";
  updateLog();
  updateChart();
}

function updateLog() {
  const rows = readings.filter((r) => r.valid !== false).slice(-LOG_ROWS).reverse();
  if (rows.length === 0) {
    els.logList.innerHTML = `<p class="log-empty">No readings yet.</p>`;
    return;
  }
  const n = (v, d) => (typeof v === "number" ? v.toFixed(d) : "—");
  els.logList.innerHTML = rows.map((r) => `
    <div class="log-row">
      <span>BME ${n(r.gasKOhm, 1)} kΩ · MQ136 ${n(r.mq136, 0)} · MQ137 ${n(r.mq137, 0)} · ${n(r.temperature, 1)}°C · ${n(r.humidity, 0)}%</span>
      <span class="log-time">${formatTime(r.timestamp)}</span>
    </div>`).join("");
}

function ensureChart() {
  if (chart || typeof Chart === "undefined") return;
  const line = (label, color, axis) => ({
    label, data: [], borderColor: color, backgroundColor: "transparent",
    yAxisID: axis, tension: 0.3, pointRadius: 0, borderWidth: 2
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
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: "#6b736b" } },
        y: {
          position: "left", beginAtZero: true, suggestedMax: 4095,
          title: { display: true, text: "ADC" },
          grid: { color: "#e6e8e2" }, ticks: { color: "#6b736b" }
        },
        y1: {
          position: "right", beginAtZero: true,
          title: { display: true, text: "kΩ" },
          grid: { display: false }, ticks: { color: "#6b736b" }
        }
      }
    }
  });
}

function updateChart() {
  ensureChart();
  if (!chart) {
    els.chartEmpty.style.display = "flex";
    els.chartEmpty.textContent = "Chart library failed to load. Check your connection or ad blocker, then refresh.";
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
