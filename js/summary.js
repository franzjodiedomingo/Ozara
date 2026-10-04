// js/summary.js — shared by monitor.js and history.js:
// test flag, storage key, number formatting, and the "Test N" run card.

export const TEST_SAMPLE_DATA = true; // keep in sync with the testing mindset: false for real use
export const LS_HISTORY = "ozara_test_history";
export const OZONE_SAFE_LIMIT_PPM = 0.1;

const PHASE_LABEL = { check: "Cabinet air check", purge: "Purge cycle" };

export function formatNumber(n) {
  return typeof n === "number" ? n.toFixed(2) : "—";
}

export function formatDateTime(ts) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(sec) {
  return sec < 60 ? `${sec} sec` : `${Math.round(sec / 60)} min`;
}

// Oldest run = Test 1, then Test 2, and so on (checks and purges share one count).
export function numberRuns(list) {
  return list
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((run, i) => ({ run, no: i + 1 }));
}

export function summaryHtml(h, no) {
  const isCheck = h.phase === "check";
  const hasEnd = typeof h.ozoneEnd === "number";
  const start = typeof h.ozoneStart === "number" ? h.ozoneStart : h.ozonePeak; // older saves: peak ~ start
  const peakHigh = h.ozonePeak > OZONE_SAFE_LIMIT_PPM;
  const endSafe = hasEnd && h.ozoneEnd <= OZONE_SAFE_LIMIT_PPM;
  const warn = isCheck ? peakHigh : hasEnd && !endSafe;

  let badge;
  if (isCheck) {
    badge = peakHigh ? `<span class="summary-badge warn">Ozone elevated</span>` : `<span class="summary-badge">Air normal</span>`;
  } else if (!hasEnd) {
    badge = `<span class="summary-badge">Completed</span>`;
  } else {
    badge = endSafe ? `<span class="summary-badge">Reached safe level</span>` : `<span class="summary-badge warn">Still above limit</span>`;
  }

  // Purge: what matters is where ozone started and where it ended, not the peak.
  const dropped = !isCheck && hasEnd && start > 0
    ? ` · ozone down ${Math.max(0, Math.round(((start - h.ozoneEnd) / start) * 100))}%`
    : "";

  const tiles = isCheck
    ? `<div class="run-stat"><span>Ozone avg</span><b>${formatNumber(h.ozoneAvg)}<small>ppm</small></b></div>
      <div class="run-stat${peakHigh ? " warn" : ""}"><span>Ozone peak</span><b>${formatNumber(h.ozonePeak)}<small>ppm</small></b></div>`
    : `<div class="run-stat"><span>Ozone start</span><b>${formatNumber(start)}<small>ppm</small></b></div>
      <div class="run-stat${hasEnd ? (endSafe ? " ok" : " warn") : ""}"><span>Ozone final</span><b>${formatNumber(hasEnd ? h.ozoneEnd : h.ozoneAvg)}<small>ppm</small></b></div>`;

  return `
  <article class="run-card${warn ? " warn" : ""}">
    <div class="run-top">
      <div>
        <p class="run-name">Test ${no}</p>
        <p class="run-type">${PHASE_LABEL[h.phase] || "Run"}</p>
      </div>
      ${badge}
    </div>
    <p class="run-meta">${formatDateTime(h.startedAt)} · ${formatDuration(h.durationSec)} · ${h.count} readings${dropped}</p>
    <div class="run-stats">
      ${tiles}
      <div class="run-stat"><span>Humidity avg</span><b>${formatNumber(h.humidityAvg)}<small>%</small></b></div>
      <div class="run-stat"><span>Temp avg</span><b>${formatNumber(h.temperatureAvg)}<small>°C</small></b></div>
    </div>
  </article>`;
}