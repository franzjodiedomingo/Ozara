// js/history.js — History page: every captured check/purge run, labeled Test 1, Test 2, ...

import { requireAuth } from "./shared.js";
import { db } from "../firebase-config.js";
import { ref, query, limitToLast, onValue } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { TEST_SAMPLE_DATA, LS_HISTORY, numberRuns, summaryHtml } from "./summary.js";

const DEVICE_ID = "device1";
const listEl = document.getElementById("historyList");
const countEl = document.getElementById("historyCount");
const connDot = document.getElementById("connDot");

function render(runs) {
  const numbered = numberRuns(runs).reverse(); // newest first, numbers stay fixed
  countEl.textContent = numbered.length ? `${numbered.length} captured` : "No tests yet";
  listEl.innerHTML = numbered.length
    ? numbered.map((x) => summaryHtml(x.run, x.no)).join("")
    : `<p class="log-empty">No tests yet. Finished checks and purge cycles are saved here.</p>`;
}

function renderLocal() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(LS_HISTORY)) || []; } catch { list = []; }
  render(list);
}

requireAuth().then(() => {
  if (TEST_SAMPLE_DATA) {
    connDot.style.background = "var(--dot-ok)";
    renderLocal();
    window.addEventListener("storage", renderLocal);
    return;
  }
  onValue(
    query(ref(db, `devices/${DEVICE_ID}/history`), limitToLast(200)),
    (snap) => {
      connDot.style.background = "var(--dot-ok)";
      const list = [];
      snap.forEach((child) => { list.push(child.val()); });
      render(list);
    },
    (error) => {
      connDot.style.background = "var(--dot-err)";
      console.error(error);
    }
  );
});