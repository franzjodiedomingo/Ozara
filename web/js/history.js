// js/history.js — History page (table view).
//
// 100% live data, nothing hard-coded or sample:
//   devices/{id}/history   finished runs. This is the SAME node the Monitor page
//                          reads for "Completed cycles", so both pages always agree.
//   devices/{id}/live      latest snapshot, only used for the "cycle running" strip
//
// A history record can contain (all optional, whatever the unit saved):
//   phase, status, startedAt, durationSec, count, cycleId,
//   bmeAvg (kΩ), mq136Avg, mq137Avg, humidityAvg, temperatureAvg,
//   ozoneStart / ozonePeak / ozoneEnd / ozoneAvg (only if an ozone sensor exists)
//
// Not shown: a "Final VOC" column. The hardware (BME680 + MQ-136/137) never
// records an end-of-cycle VOC value, and this page doesn't invent one.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, query, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { createPresence } from "./presence.js";
import { OZONE_SAFE_LIMIT_PPM, formatNumber, formatDuration } from "./summary.js";

const DEVICE_ID = "device1";
const PAGE_SIZE = 10;

const $ = (id) => document.getElementById(id);
const els = {
  connDot: $("connDot"),
  body: $("histBody"),
  empty: $("historyEmpty"),
  foot: $("histFoot"),
  count: $("histCount"),
  pager: $("histPager"),
  fDate: $("fDate"),
  fStatus: $("fStatus"),
  exportBtn: $("exportBtn"),
  strip: $("liveStrip"),
  stripText: $("liveStripText"),
  dlg: $("detailDialog"),
  dlgTitle: $("dlgTitle"),
  dlgSub: $("dlgSub"),
  dlgBody: $("dlgBody"),
  dlgClose: $("dlgClose")
};

const presence = createPresence();
let rows = [];          // normalized finished runs
let live = null;
let loaded = false;
let page = 1;
let filtered = [];

// ---------- Data ----------

requireAuth().then(() => {
  const onErr = (error) => {
    els.connDot.style.background = "var(--dot-err)";
    console.error(error);
    els.empty.textContent = "Couldn't load history.";
    els.empty.hidden = false;
  };

  onValue(
    query(ref(db, `devices/${DEVICE_ID}/history`), limitToLast(200)),
    (snap) => {
      els.connDot.style.background = "var(--dot-ok)";
      const list = [];
      snap.forEach((child) => { list.push({ key: child.key, ...child.val() }); });
      rows = normalize(list);
      loaded = true;
      render();
    },
    onErr
  );

  onValue(ref(db, `devices/${DEVICE_ID}/live`), (snap) => {
    live = snap.exists() ? snap.val() : null;
    if (live && live.ts) presence.observe(live.ts);
    renderStrip();
  }, onErr);

  setInterval(renderStrip, 1000);
});

const localDayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

function deriveStatus(h) {
  const raw = String(h.status || "").toLowerCase();
  const phase = String(h.phase || "");
  if (["failed", "fault", "error", "aborted", "cancelled", "canceled"].includes(raw) || /FAULT|ERROR/.test(phase)) return "failed";
  const peakHigh = typeof h.ozonePeak === "number" && h.ozonePeak > OZONE_SAFE_LIMIT_PPM;
  const endHigh = typeof h.ozoneEnd === "number" && h.ozoneEnd > OZONE_SAFE_LIMIT_PPM;
  if (phase === "check" ? peakHigh : endHigh) return "attention";
  return "completed";
}

function statusLabel(r) {
  if (r.status === "failed") return "Failed";
  if (r.status === "attention") return r.phase === "check" ? "Ozone elevated" : "Above limit";
  return "Completed";
}

// Oldest first so the per-day counter (-001, -002 …) follows real order.
function normalize(list) {
  const sorted = list.slice().sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  const perDay = {};
  return sorted.map((h) => {
    const startedAt = Number(h.startedAt) || 0;
    let id = h.cycleId;
    if (!id) {
      if (startedAt) {
        const day = localDayKey(startedAt);
        perDay[day] = (perDay[day] || 0) + 1;
        id = `OC-${day}-${String(perDay[day]).padStart(3, "0")}`;
      } else {
        id = `OC-${String(h.key).slice(-6).toUpperCase()}`;
      }
    }
    return { ...h, startedAt, id, status: deriveStatus(h) };
  });
}

// ---------- Filters ----------

function applyFilters() {
  const days = Number(els.fDate.value);
  const cutoff = days > 0 ? Date.now() - days * 86400000 : 0;
  const st = els.fStatus.value;
  return rows
    .filter((r) => (cutoff ? r.startedAt >= cutoff : true))
    .filter((r) => (st === "all" ? true : r.status === st))
    .sort((a, b) => b.startedAt - a.startedAt);
}

[els.fDate, els.fStatus].forEach((el) => el.addEventListener("change", () => { page = 1; render(); }));

// ---------- Rendering ----------

const esc = (v) => {
  const d = document.createElement("div");
  d.textContent = v == null ? "" : String(v);
  return d.innerHTML;
};

function fmtDate(ts) {
  if (!ts) return `<span class="hx-id">—</span>`;
  const d = new Date(ts);
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${esc(date)}<span class="hx-time">${esc(time)}</span>`;
}

function render() {
  filtered = applyFilters();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (page > totalPages) page = totalPages;
  const start = (page - 1) * PAGE_SIZE;
  const slice = filtered.slice(start, start + PAGE_SIZE);

  els.exportBtn.disabled = filtered.length === 0;

  if (!loaded) {
    els.empty.textContent = "Loading history…";
    els.empty.hidden = false;
    els.foot.hidden = true;
    els.body.innerHTML = "";
    return;
  }

  if (filtered.length === 0) {
    els.body.innerHTML = "";
    els.foot.hidden = true;
    els.empty.hidden = false;
    els.empty.textContent = rows.length === 0
      ? "No cycles recorded yet. Finished checks and cycles will show up here once the unit completes them."
      : "No cycles match these filters. Try a wider date range or set filters to All.";
    return;
  }

  els.empty.hidden = true;
  els.body.innerHTML = slice.map((r) => {
    const pill = r.status === "failed" ? "failed" : r.status === "attention" ? "warn" : "";
    return `
    <tr>
      <td>${fmtDate(r.startedAt)}</td>
      <td class="hx-id">${esc(r.id)}</td>
      <td><span class="hx-pill ${pill}">${esc(statusLabel(r))}</span></td>
      <td>${typeof r.bmeAvg === "number" ? esc(formatNumber(r.bmeAvg, 1)) : "—"}</td>
      <td>${r.status === "failed" && !(r.durationSec > 0) ? "0 min" : esc(formatDuration(r.durationSec))}</td>
      <td>
        <div class="hx-actions">
          <button class="hx-view" type="button" data-view="${esc(r.key)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>View
          </button>
          <button class="hx-more" type="button" data-more="${esc(r.key)}" aria-label="More actions">⋮</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  els.foot.hidden = false;
  els.count.textContent = `Showing ${start + 1}–${start + slice.length} of ${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}`;
  renderPager(totalPages);
}

function renderPager(totalPages) {
  if (totalPages <= 1) { els.pager.innerHTML = ""; return; }
  const first = Math.max(1, Math.min(page - 2, totalPages - 4));
  const last = Math.min(totalPages, first + 4);
  let html = `<button type="button" data-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Previous page">‹</button>`;
  for (let p = first; p <= last; p++) {
    html += `<button type="button" data-page="${p}" class="${p === page ? "on" : ""}" ${p === page ? 'aria-current="page"' : ""}>${p}</button>`;
  }
  html += `<button type="button" data-page="${page + 1}" ${page === totalPages ? "disabled" : ""} aria-label="Next page">›</button>`;
  els.pager.innerHTML = html;
}

els.pager.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-page]");
  if (!b || b.disabled) return;
  page = Number(b.dataset.page);
  render();
});

// ---------- Live strip (same logic as Monitor's "Active" state) ----------

function renderStrip() {
  const online = presence.state() === "online";
  const phase = live && live.phase ? String(live.phase) : "";
  const running = online && (phase.includes("RUNNING") || phase.includes("PURGING") || phase === "START_COUNTDOWN");
  els.strip.hidden = !running;
  if (!running) return;
  const label = phase.replaceAll("_", " ").toLowerCase();
  const pretty = label.charAt(0).toUpperCase() + label.slice(1);
  const rem = typeof live.remaining === "number" && live.remaining >= 0
    ? ` · ${Math.floor(live.remaining / 60)}:${String(live.remaining % 60).padStart(2, "0")} remaining` : "";
  els.stripText.textContent = `Cycle in progress: ${pretty}${rem}. It will appear below once it finishes.`;
}

// ---------- Row actions + detail dialog ----------

function closeMenus() { document.querySelectorAll(".hx-menu").forEach((m) => m.remove()); }
document.addEventListener("click", (e) => { if (!e.target.closest("[data-more]")) closeMenus(); });

els.body.addEventListener("click", (e) => {
  const view = e.target.closest("[data-view]");
  const more = e.target.closest("[data-more]");
  if (view) {
    const r = rows.find((x) => x.key === view.dataset.view);
    if (r) openDetail(r);
  } else if (more) {
    const r = rows.find((x) => x.key === more.dataset.more);
    const wrap = more.closest(".hx-actions");
    const had = wrap.querySelector(".hx-menu");
    closeMenus();
    if (had || !r) return;
    const menu = document.createElement("div");
    menu.className = "hx-menu";
    menu.innerHTML = `<button type="button">Copy cycle ID</button>`;
    menu.firstElementChild.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(r.id); } catch { /* clipboard blocked */ }
      closeMenus();
    });
    wrap.appendChild(menu);
  }
});

function stat(label, value, unit) {
  return `<div class="hx-stat"><span>${esc(label)}</span><b>${esc(value)}${unit ? `<small>${esc(unit)}</small>` : ""}</b></div>`;
}

function openDetail(r) {
  els.dlgTitle.textContent = r.id;
  els.dlgSub.textContent = r.startedAt ? new Date(r.startedAt).toLocaleString() : "—";
  const n = (v, d) => (typeof v === "number" ? formatNumber(v, d) : "—");
  let html = stat("Status", statusLabel(r)) + stat("Duration", r.durationSec > 0 ? formatDuration(r.durationSec) : "—") +
    stat("VOC (BME680 avg)", n(r.bmeAvg, 1), "kΩ") + stat("Readings captured", r.count || 0) +
    stat("MQ-136 avg", n(r.mq136Avg, 0), "ADC") + stat("MQ-137 avg", n(r.mq137Avg, 0), "ADC") +
    stat("Humidity avg", n(r.humidityAvg, 0), "%") + stat("Temp avg", n(r.temperatureAvg, 1), "°C");
  if (typeof r.ozoneAvg === "number" || typeof r.ozonePeak === "number") {
    html += stat("Ozone avg", n(r.ozoneAvg, 2), "ppm") + stat("Ozone peak", n(r.ozonePeak, 2), "ppm");
  }
  els.dlgBody.innerHTML = html;
  els.dlg.showModal();
}

els.dlgClose.addEventListener("click", () => els.dlg.close());
els.dlg.addEventListener("click", (e) => { if (e.target === els.dlg) els.dlg.close(); });

// ---------- Export CSV (exports whatever the filters currently show) ----------

els.exportBtn.addEventListener("click", () => {
  if (filtered.length === 0) return;
  const head = ["Date & Time", "Cycle ID", "Status", "Duration (sec)", "Readings",
    "VOC BME680 avg (kOhm)", "MQ-136 avg (ADC)", "MQ-137 avg (ADC)", "Humidity avg (%)", "Temp avg (C)"];
  const cell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [head.map(cell).join(",")].concat(filtered.map((r) => [
    r.startedAt ? new Date(r.startedAt).toISOString() : "", r.id, statusLabel(r),
    r.durationSec ?? "", r.count ?? "", r.bmeAvg ?? "", r.mq136Avg ?? "", r.mq137Avg ?? "",
    r.humidityAvg ?? "", r.temperatureAvg ?? ""
  ].map(cell).join(",")));
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ozara-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
