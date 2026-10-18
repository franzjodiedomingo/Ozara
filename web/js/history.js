// js/history.js — History page.
//
// Two sources, shown together:
//
// 1) Finished runs saved by the Monitor page (cabinet air checks and purge
//    cycles). Same data as "Captured reading status" on Monitor:
//      real mode:  devices/{deviceId}/history/{pushId}   (see monitor.js)
//      test mode:  localStorage[LS_HISTORY]              (TEST_SAMPLE_DATA in summary.js)
//
// 2) Optional cycle summaries written by the ESP32 / a Cloud Function:
// devices/{deviceId}/cycles/{cycleId}/
//   label: "Cycle 1"              (optional — falls back to insertion order)
//   tests/{testId}/
//     title: "Test 1"
//     subtitle: "Cabinet air check"
//     status: "safe" | "elevated" | "neutral"
//     statusLabel: "Reached safe level" | "Ozone elevated"
//     timestamp: 1733300000000
//     durationMinutes: 10
//     readingCount: 301
//     summaryNote: "ozone down 74%"        (optional, appended to the summary line)
//     metrics: [ { label, value, unit, highlight } ... ]   (up to 4, any labels)

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, query, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { TEST_SAMPLE_DATA, LS_HISTORY, numberRuns, summaryHtml } from "./summary.js";

const DEVICE_ID = "device1";

const main = document.getElementById("historyMain");
const emptyEl = document.getElementById("historyEmpty");
const connDot = document.getElementById("connDot");

let runs = [];          // finished runs from Monitor (history / localStorage)
let cyclesObj = null;   // optional cycles/tests data from the device
let runsLoaded = false;
let cyclesLoaded = false;

requireAuth().then(() => {
  const onErr = (error) => {
    connDot.style.background = "var(--dot-err)";
    console.error(error);
    emptyEl.textContent = "Couldn't load history.";
    emptyEl.hidden = false;
  };

  // Finished runs from Firebase
  onValue(
    query(ref(db, `devices/${DEVICE_ID}/history`), limitToLast(200)),
    (snapshot) => {
      connDot.style.background = "var(--dot-ok)";
      const list = [];
      snapshot.forEach((child) => { list.push(child.val()); });
      runs = list;
      runsLoaded = true;
      render();
    },
    onErr
  );

  // Optional device-written cycles
  onValue(
    ref(db, `devices/${DEVICE_ID}/cycles`),
    (snapshot) => {
      if (!TEST_SAMPLE_DATA) connDot.style.background = "var(--dot-ok)";
      cyclesObj = snapshot.exists() ? snapshot.val() : null;
      cyclesLoaded = true;
      render();
    },
    onErr
  );
});

function loadLocalRuns() {
  try { runs = JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { runs = []; }
  runsLoaded = true;
  render();
}

function render() {
  const hasRuns = runs.length > 0;
  const hasCycles = !!cyclesObj;

  renderRuns();
  renderCycles(cyclesObj);

  if (hasRuns || hasCycles) {
    emptyEl.hidden = true;
  } else if (runsLoaded && cyclesLoaded) {
    emptyEl.textContent = "Nothing here yet. Finished checks and cycles will show up once they complete.";
    emptyEl.hidden = false;
  } else if (runsLoaded && TEST_SAMPLE_DATA) {
    emptyEl.textContent = "Nothing here yet. Finished checks and cycles will show up once they complete.";
    emptyEl.hidden = false;
  }
}

// Finished runs, newest first, labeled Test N (same numbering as Monitor).
function renderRuns() {
  main.querySelectorAll(".runs-group").forEach((n) => n.remove());
  if (runs.length === 0) return;

  const group = document.createElement("section");
  group.className = "cycle-group runs-group";

  const heading = document.createElement("h2");
  heading.className = "cycle-heading";
  heading.textContent = "Tests";
  group.appendChild(heading);

  const list = document.createElement("div");
  list.className = "run-list";
  list.innerHTML = numberRuns(runs)
    .reverse()
    .map((x) => summaryHtml(x.run, x.no))
    .join("");
  group.appendChild(list);

  // Put the runs first, above any device-written cycles.
  main.insertBefore(group, emptyEl.nextSibling);
}

function renderCycles(cyclesData) {
  main.querySelectorAll(".cycle-group:not(.runs-group)").forEach((n) => n.remove());
  if (!cyclesData) return;

  // Newest cycle first. Object keys (push ids or "cycle1" style) sort fine
  // either way since we also show each cycle's own label.
  const cycleEntries = Object.entries(cyclesData).reverse();

  cycleEntries.forEach(([cycleId, cycle], index) => {
    const group = document.createElement("section");
    group.className = "cycle-group";

    const heading = document.createElement("h2");
    heading.className = "cycle-heading";
    heading.textContent = cycle.label || `Cycle ${cycleEntries.length - index}`;
    group.appendChild(heading);

    const tests = cycle.tests ? Object.values(cycle.tests) : [];
    // Newest test first within the cycle.
    tests
      .slice()
      .reverse()
      .forEach((test) => group.appendChild(renderTestCard(test)));

    if (tests.length === 0) {
      const empty = document.createElement("p");
      empty.className = "log-empty";
      empty.textContent = "No tests recorded for this cycle yet.";
      group.appendChild(empty);
    }

    main.appendChild(group);
  });
}

function renderTestCard(test) {
  const card = document.createElement("article");
  const status = test.status === "safe" || test.status === "elevated" ? test.status : "neutral";
  card.className = `card test-card test-${status}`;

  const top = document.createElement("div");
  top.className = "test-card-top";

  const titleWrap = document.createElement("div");
  const title = document.createElement("p");
  title.className = "test-title";
  title.textContent = test.title || "Test";
  titleWrap.appendChild(title);

  if (test.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "test-subtitle";
    subtitle.textContent = test.subtitle;
    titleWrap.appendChild(subtitle);
  }
  top.appendChild(titleWrap);

  if (test.statusLabel) {
    const pill = document.createElement("span");
    pill.className = "test-pill";
    pill.textContent = test.statusLabel;
    top.appendChild(pill);
  }
  card.appendChild(top);

  const summary = document.createElement("p");
  summary.className = "test-summary";
  summary.textContent = buildSummaryLine(test);
  card.appendChild(summary);

  if (Array.isArray(test.metrics) && test.metrics.length > 0) {
    const grid = document.createElement("div");
    grid.className = "test-metric-grid";
    test.metrics.slice(0, 4).forEach((m) => grid.appendChild(renderMetric(m)));
    card.appendChild(grid);
  }

  return card;
}

function renderMetric(m) {
  const box = document.createElement("div");
  box.className = `test-metric${m.highlight ? " test-metric-highlight" : ""}`;

  const label = document.createElement("p");
  label.className = "test-metric-label";
  label.textContent = m.label || "";
  box.appendChild(label);

  const value = document.createElement("p");
  value.className = "test-metric-value";
  value.innerHTML = `${formatNumber(m.value)}${m.unit ? ` <span class="test-metric-unit">${escapeHtml(m.unit)}</span>` : ""}`;
  box.appendChild(value);

  return box;
}

function buildSummaryLine(test) {
  const parts = [];
  if (test.timestamp) parts.push(formatDateTime(test.timestamp));
  if (test.durationMinutes) parts.push(`${test.durationMinutes} min`);
  if (test.readingCount) parts.push(`${test.readingCount} readings`);
  if (test.summaryNote) parts.push(test.summaryNote);
  return parts.join(" · ");
}

function formatNumber(n) {
  return typeof n === "number" ? n.toFixed(2) : (n ?? "—");
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const datePart = d.toLocaleDateString([], { month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
