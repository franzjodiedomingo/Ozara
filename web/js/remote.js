// js/remote.js — Remote controls (OK, −, +) on the Monitor page.
//
// Mirrors the three physical buttons on the unit, over Firebase:
//   writes  devices/{id}/commands/button      { key, action, id, requestedAt }
//             key    0 = OK, 1 = −, 2 = +   (same order as the firmware's BUTTON_PINS)
//             action "tap"     quick press and release
//                    "hold"    press and keep holding (the unit counts the 3 s / 6 s itself)
//                    "release" let go of a hold
//   reads   devices/{id}/commands/buttonAck   { id, action, ok, note }  written by the unit
//           devices/{id}/live                 phase, hint text, online/offline
//
// The unit polls this node about once a second, so expect a short delay.
// Nothing here is simulated: if the unit is offline the buttons are disabled.

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, onValue, set, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { createPresence } from "./presence.js";

const DEVICE_ID = "device1";
const HOLD_START_MS = 400;     // pressed longer than this counts as a hold
const ACK_TIMEOUT_MS = 350;    // short lock so a press can finish on the unit; we no longer wait for the ack

// holdMs matches CANCEL_HOLD_MS / START_CONFIRM_MS in the firmware (progress bar only).
const BUTTONS = {
  0: { name: "OK", holdMs: 3000 },
  1: { name: "−", holdMs: 0 },
  2: { name: "+", holdMs: 6000 }
};

const $ = (id) => document.getElementById(id);
const els = {
  card: $("remoteCard"),
  badge: $("remoteBadge"),
  hint: $("remoteHint"),
  status: $("remoteStatus")
};
const buttons = [...document.querySelectorAll(".rc-btn")];

if (els.card) init();

function init() {
  const presence = createPresence();
  let live = null;
  let lastId = null;       // id of the newest command we sent
  let lastAction = null;
  let seq = 0;
  let busyUntil = 0;       // blocks new presses until the unit answers (or times out)
  let active = null;       // { key, btn, timer, holding, startedAt, raf }

  const isOnline = () => presence.state() === "online" && !!live;

  function setStatus(text, kind = "") {
    els.status.textContent = text;
    els.status.className = `remote-status ${kind}`.trim();
  }

  function render() {
    const online = isOnline();
    els.badge.textContent = online ? "Online" : "Offline";
    els.badge.className = `rc-pill${online ? " on" : ""}`;

    if (!online) {
      els.hint.textContent = live
        ? "Unit offline. Check its power and Wi-Fi connection."
        : "Waiting for the unit…";
    } else {
      els.hint.textContent = live.hint || "Unit is online.";
    }

    const busy = Date.now() < busyUntil;
    buttons.forEach((b) => {
      const mine = active && active.btn === b;
      b.disabled = !online || (!mine && (busy || !!active));
    });
  }

  async function send(key, action) {
    const id = `${Date.now().toString(36)}${(seq++).toString(36)}`;
    lastId = id;
    lastAction = action;
    if (action !== "release") busyUntil = Date.now() + ACK_TIMEOUT_MS;
    setStatus(action === "release" ? "Releasing…" : "Sending…");
    render();
    try {
      await set(ref(db, `devices/${DEVICE_ID}/commands/button`), {
        key,
        action,
        id,
        requestedAt: serverTimestamp()
      });
      if (lastId === id) setStatus("Sent. Waiting for the unit…");
    } catch (err) {
      console.error("Remote button failed:", err);
      busyUntil = 0;
      setStatus("Couldn't send. Check your connection and try again.", "bad");
      render();
    }
  }

  // ---------- Press handling ----------

  function clearHoldVisual(btn) {
    btn.classList.remove("down", "holding");
    const fill = btn.querySelector(".rc-fill");
    if (fill) fill.style.transform = "scaleX(0)";
  }

  function startHoldVisual(a) {
    const holdMs = BUTTONS[a.key].holdMs;
    a.btn.classList.add("holding");
    if (!holdMs) return;
    const fill = a.btn.querySelector(".rc-fill");
    const step = () => {
      if (active !== a) return;
      const p = Math.min(1, (performance.now() - a.startedAt) / holdMs);
      fill.style.transform = `scaleX(${p})`;
      if (p < 1) a.raf = requestAnimationFrame(step);
    };
    a.startedAt = performance.now();
    a.raf = requestAnimationFrame(step);
  }

  function pressStart(btn, key) {
    if (active || !isOnline() || Date.now() < busyUntil) return;
    const a = { key, btn, holding: false, timer: null, raf: 0, startedAt: 0 };
    active = a;
    btn.classList.add("down");
    a.timer = setTimeout(() => {
      if (active !== a) return;
      a.holding = true;
      btn.classList.remove("down");
      startHoldVisual(a);
      send(key, "hold");
    }, HOLD_START_MS);
    render();
  }

  function pressEnd() {
    const a = active;
    if (!a) return;
    clearTimeout(a.timer);
    cancelAnimationFrame(a.raf);
    clearHoldVisual(a.btn);
    active = null;
    send(a.key, a.holding ? "release" : "tap");
  }

  buttons.forEach((btn) => {
    const key = Number(btn.dataset.key);

    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* not supported */ }
      pressStart(btn, key);
    });
    btn.addEventListener("pointerup", pressEnd);
    btn.addEventListener("pointercancel", pressEnd);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());

    // Keyboard: Space / Enter sends a tap.
    btn.addEventListener("keydown", (e) => {
      if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        if (!active && isOnline() && Date.now() >= busyUntil) send(key, "tap");
      }
    });
  });

  // Never leave a hold running if the tab is hidden or closed (the unit also
  // releases on its own after a few seconds as a safety).
  document.addEventListener("visibilitychange", () => { if (document.hidden) pressEnd(); });
  window.addEventListener("blur", pressEnd);
  window.addEventListener("pagehide", pressEnd);

  // ---------- Firebase ----------

  requireAuth().then(() => {
    onValue(ref(db, `devices/${DEVICE_ID}/live`), (snap) => {
      live = snap.exists() ? snap.val() : null;
      if (live && live.ts) presence.observe(live.ts);
      render();
    });

    onValue(ref(db, `devices/${DEVICE_ID}/commands/buttonAck`), (snap) => {
      const ack = snap.exists() ? snap.val() : null;
      if (!ack || ack.id !== lastId) return;
      if (!ack.ok) busyUntil = 0;   // rejected: allow an immediate retry
      if (ack.ok) {
        setStatus(lastAction === "release" ? "Released." : "Done. The unit received it.", "ok");
      } else {
        setStatus(ack.note ? `Not applied: ${ack.note}` : "The unit didn't apply that press.", "bad");
      }
      render();
    });

    setInterval(render, 1000);
  });
}
