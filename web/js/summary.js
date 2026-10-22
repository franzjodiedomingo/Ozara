// js/summary.js — shared by monitor.js and history.js:
// Real data flags, number formatting, and run card renderer.

export const TEST_SAMPLE_DATA = false; // Live readings and real database only
export const LS_HISTORY = "ozara_test_history";
export const LS_SESSIONS = "ozara_test_sessions";
export const OZONE_SAFE_LIMIT_PPM = 0.1;

export const PHASE_LABEL = {
  check: "Cabinet air check",
  purge: "Purge cycle",
  WARMUP: "Sensor warm-up",
  IDLE: "Idle baseline",
  RUNNING_PULSE: "Ozone pulse",
  RUNNING_DISPERSE: "Ozone disperse",
  PURGING: "Carbon purge",
  CYCLE_COMPLETE: "Cycle complete",
  cycle: "Odor treatment cycle",
  manual: "Manual ozone test"
};

// The ESP32 has no clock, so finished-cycle records carry endedAt (server time).
// Start time = end time minus the cycle length. Older records that already have startedAt are untouched.
export function startedAtOf(h) {
  const s = Number(h.startedAt) || 0;
  if (s) return s;
  return h.endedAt ? Number(h.endedAt) - (Number(h.durationSec) || 0) * 1000 : 0;
}

export function formatNumber(n, decimals = 2) {
  return typeof n === "number" ? n.toFixed(decimals) : "—";
}

export function formatDateTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(sec) {
  if (typeof sec !== "number" || sec <= 0) return "—";
  return sec < 60 ? `${sec} sec` : `${Math.round(sec / 60)} min`;
}

// Oldest run = Test 1, then Test 2, and so on.
export function numberRuns(list) {
  return list
    .slice()
    .sort((a, b) => startedAtOf(a) - startedAtOf(b))
    .map((run, i) => ({ run, no: i + 1 }));
}

export function summaryHtml(h, no) {
  const isCheck = h.phase === "check";
  const hasEnd = typeof h.ozoneEnd === "number";
  const start = typeof h.ozoneStart === "number" ? h.ozoneStart : h.ozonePeak;
  const peakHigh = typeof h.ozonePeak === "number" && h.ozonePeak > OZONE_SAFE_LIMIT_PPM;
  const endSafe = hasEnd && h.ozoneEnd <= OZONE_SAFE_LIMIT_PPM;
  const warn = isCheck ? peakHigh : (hasEnd && !endSafe);

  let badge;
  if (isCheck) {
    badge = peakHigh ? `<span class="summary-badge warn">Ozone elevated</span>` : `<span class="summary-badge">Air normal</span>`;
  } else if (!hasEnd) {
    badge = h.status === "aborted"
      ? `<span class="summary-badge warn">Aborted</span>`
      : `<span class="summary-badge">Completed</span>`;
  } else {
    badge = endSafe ? `<span class="summary-badge">Reached safe level</span>` : `<span class="summary-badge warn">Still above limit</span>`;
  }

  const dropped = !isCheck && hasEnd && typeof start === "number" && start > 0
    ? ` · ozone down ${Math.max(0, Math.round(((start - h.ozoneEnd) / start) * 100))}%`
    : "";

  let tiles = "";
  if (typeof h.ozoneAvg === "number" || typeof h.ozonePeak === "number") {
    tiles += `<div class="run-stat"><span>Ozone avg</span><b>${formatNumber(h.ozoneAvg)}<small>ppm</small></b></div>`;
    tiles += `<div class="run-stat${peakHigh ? " warn" : ""}"><span>Ozone peak</span><b>${formatNumber(h.ozonePeak)}<small>ppm</small></b></div>`;
  } else {
    if (typeof h.mq136Avg === "number") tiles += `<div class="run-stat"><span>MQ-136 avg</span><b>${formatNumber(h.mq136Avg, 0)}<small>ADC</small></b></div>`;
    if (typeof h.mq137Avg === "number") tiles += `<div class="run-stat"><span>MQ-137 avg</span><b>${formatNumber(h.mq137Avg, 0)}<small>ADC</small></b></div>`;
    if (typeof h.bmeAvg === "number") tiles += `<div class="run-stat"><span>BME680 avg</span><b>${formatNumber(h.bmeAvg, 1)}<small>kΩ</small></b></div>`;
  }

  return `
  <article class="run-card${warn ? " warn" : ""}">
    <div class="run-top">
      <div>
        <p class="run-name">Run ${no}</p>
        <p class="run-type">${PHASE_LABEL[h.phase] || h.phase || "Run"}</p>
      </div>
      ${badge}
    </div>
    <p class="run-meta">${formatDateTime(startedAtOf(h))} · ${formatDuration(h.durationSec)} · ${h.count || 0} readings${dropped}</p>
    <div class="run-stats">
      ${tiles}
      <div class="run-stat"><span>Humidity avg</span><b>${formatNumber(h.humidityAvg, 0)}<small>%</small></b></div>
      <div class="run-stat"><span>Temp avg</span><b>${formatNumber(h.temperatureAvg, 1)}<small>°C</small></b></div>
    </div>
  </article>`;
}