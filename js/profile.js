// js/profile.js — Profile page (placeholder for now).

import { requireAuth } from "./shared.js";

requireAuth().then((user) => {
  const placeholder = document.getElementById("profilePlaceholder");
  if (placeholder) placeholder.textContent = `Signed in as ${user.email}.`;
});
