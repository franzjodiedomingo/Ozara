// js/manual.js — User Manual page: sign-in check + jump-to-section chips for the embedded PDF.

import { requireAuth } from "./shared.js";

const PDF = "docs/OZARA_User_Manual.pdf";
const wide = window.matchMedia("(min-width: 861px)");

requireAuth().then(() => {
  const chips = [...document.querySelectorAll(".manual-chip")];

  chips.forEach((chip) => {
    chip.addEventListener("click", (e) => {
      // On small screens the PDF opens in its own tab (the default link behaviour).
      if (!wide.matches) return;
      e.preventDefault();
      const frame = document.getElementById("manualFrame");
      if (!frame) return;
      // Replace the frame so the viewer reliably jumps to the page.
      const fresh = frame.cloneNode(false);
      fresh.src = `${PDF}#page=${chip.dataset.page}&view=FitH`;
      frame.replaceWith(fresh);
      chips.forEach((c) => c.classList.toggle("active", c === chip));
    });
  });
});
