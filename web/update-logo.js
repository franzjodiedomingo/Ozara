// update-logo.js — swaps the tab icon and the top-bar logo on every page,
// editing YOUR files in place so your own changes are kept.
//
// Run from the web folder (the one that has home.html):   node update-logo.js
// Safe to run twice: pages that are already updated are skipped.

const fs = require("fs");
const path = require("path");

const LOGO = "images/ozara-logo-white.png";   // white logo on the green top bar

const DASHBOARD_PAGES = ["home.html", "live.html", "monitor.html", "history.html", "profile.html"];
const ICON_ONLY_PAGES = ["login.html"];

const ICON_LINKS = [
  '<link rel="icon" href="favicon.ico" sizes="48x48">',
  '<link rel="icon" type="image/png" sizes="192x192" href="favicon-192.png">',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">'
].join("\n");

const BRAND_HTML =
`<a class="brand" href="home.html" aria-label="Ozara home">
    <img class="brand-logo" src="${LOGO}" alt="Ozara — sensor-assisted ozone treatment">
  </a>`;

const BRAND_CSS = `
/* Top-bar logo image */
a.brand{ text-decoration:none; color:inherit; }
.brand-logo{ display:block; height:40px; width:auto; max-width:100%; }
@media (max-width:600px){ .brand-logo{ height:34px; } }
`;

function read(file) { return fs.readFileSync(file, "utf8"); }
function write(file, text) { fs.writeFileSync(file, text); }

function swapIcons(html) {
  // remove every existing icon / touch-icon link, then add the new set once
  const stripped = html.replace(/[ \t]*<link\s+rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>\s*\n?/gi, "");
  if (!/<link rel="stylesheet"/i.test(stripped) && !/<\/head>/i.test(stripped)) return null;
  const marker = /<title>[^<]*<\/title>\s*\n?/i;
  if (!marker.test(stripped)) return null;
  return stripped.replace(marker, (m) => m.replace(/\s*$/, "\n") + ICON_LINKS + "\n");
}

let changed = 0, skipped = 0, problems = 0;
function report(kind, file, msg) {
  console.log(`${kind} ${file}${msg ? " — " + msg : ""}`);
}

for (const file of [...DASHBOARD_PAGES, ...ICON_ONLY_PAGES]) {
  if (!fs.existsSync(file)) { report("skip ", file, "file not found"); skipped++; continue; }
  let html = read(file);
  const before = html;

  const withIcons = swapIcons(html);
  if (withIcons === null) { report("check", file, "could not find <title> to place the icons"); problems++; }
  else html = withIcons;

  if (DASHBOARD_PAGES.includes(file)) {
    if (html.includes('class="brand-logo"')) {
      // already swapped
    } else {
      const brand = /<div class="brand">[\s\S]*?<p class="brand-sub">[\s\S]*?<\/p>\s*<\/div>\s*<\/div>/;
      if (brand.test(html)) html = html.replace(brand, BRAND_HTML);
      else { report("check", file, "top-bar logo block not found (edit it by hand, see README)"); problems++; }
    }
  }

  if (html !== before) { write(file, html); report("done ", file); changed++; }
  else if (!problems) { report("same ", file, "already up to date"); skipped++; }
}

// CSS for the logo image
const cssFile = path.join("css", "dashboard.css");
if (fs.existsSync(cssFile)) {
  const css = read(cssFile);
  if (!css.includes(".brand-logo")) { write(cssFile, css.replace(/\s*$/, "\n") + BRAND_CSS); report("done ", cssFile); changed++; }
  else report("same ", cssFile, "already has the logo styles");
} else { report("check", cssFile, "not found"); problems++; }

// the files the pages now point to
for (const f of ["favicon.ico", "favicon-192.png", "apple-touch-icon.png", LOGO]) {
  if (!fs.existsSync(f)) { report("MISSING", f, "copy this file into the web folder"); problems++; }
}

console.log(`\n${changed} file(s) changed, ${skipped} skipped, ${problems} to check.`);
