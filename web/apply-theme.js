// apply-theme.js — switches your existing pages to the new look.
//
// It only swaps the top bar and the sidebar of each page (and adds js/layout.js).
// Everything inside <main> stays exactly as you have it.
//
// Run from the web folder (the one that has home.html):   node apply-theme.js
// Safe to run twice: pages that are already updated are skipped.

const fs = require("fs");

// live.html is left alone: in this project it only redirects to monitor.html
const PAGES = ["home.html", "monitor.html", "history.html", "profile.html"];
const TITLES = { "home.html": "Home", "monitor.html": "Monitor", "history.html": "History", "profile.html": "Profile", "settings.html": "Settings" };

const NAV = [
  ["home.html", "Home", '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>'],
  ["monitor.html", "Monitor", '<path d="M3 17l5-5 4 4 8-9"/><path d="M15 7h5v5"/>'],
  ["history.html", "History", '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>'],
  ["profile.html", "Profile", '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/>']
];
const SETTINGS_ICON = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';
const LOGO = "images/ozara-logo.png";

function navLink(href, label, icon, active) {
  return `    <a class="nav-btn${active ? " active" : ""}" href="${href}"${active ? ' aria-current="page"' : ""}>
      <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
      <span>${label}</span>
    </a>`;
}

function sidebar(page) {
  return `<nav class="sidebar" aria-label="Main navigation">
  <a class="side-brand" href="home.html" aria-label="Ozara home"><img src="${LOGO}" alt="Ozara"></a>
  <div class="side-nav">
${NAV.map(([href, label, icon]) => navLink(href, label, icon, href === page)).join("\n")}
  </div>
  <div class="side-bottom">
${navLink("settings.html", "Settings", SETTINGS_ICON, page === "settings.html")}
    <div class="side-device" id="sideDevice">
      <span class="status-dot unknown" id="deviceDot"></span>
      <div>
        <p class="side-device-title" id="deviceTitle">Checking device…</p>
        <p class="side-device-sub" id="deviceSub">Please wait</p>
      </div>
    </div>
  </div>
</nav>`;
}

function topbar(page) {
  return `<header class="topbar">
  <a class="top-brand" href="home.html" aria-label="Ozara home"><img src="${LOGO}" alt="Ozara"></a>
  <h1 class="top-title">${TITLES[page]}</h1>
  <div class="topbar-right">
    <span class="status-dot" id="connDot" title="Database connection" hidden></span>

    <div class="menu">
      <button class="icon-btn" id="notifBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="notifPanel" aria-label="Notifications">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        <span class="badge" id="notifBadge" hidden>0</span>
      </button>
      <div class="dropdown notif-panel" id="notifPanel" hidden>
        <div class="dropdown-head">
          <p>Notifications</p>
          <div class="header-actions">
            <button class="link-btn" id="notifReadAll" type="button">Mark all read</button>
            <button class="link-btn link-btn-muted" id="notifClear" type="button">Clear</button>
          </div>
        </div>
        <div class="notif-list" id="notifList"><p class="notif-empty">No notifications yet.</p></div>
        <a class="dropdown-foot" href="settings.html">Notification settings</a>
      </div>
    </div>

    <div class="menu">
      <button class="user-btn" id="userBtn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="userPanel">
        <span class="avatar" id="userAvatar">?</span>
        <span class="user-text">
          <span class="user-name" id="userName">—</span>
          <span class="user-sub" id="userSub">Member</span>
        </span>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="dropdown user-panel" id="userPanel" hidden>
        <p class="user-email" id="userEmail"></p>
        <a class="dropdown-item" href="profile.html">Profile</a>
        <a class="dropdown-item" href="settings.html">Settings</a>
        <button class="dropdown-item danger" id="logoutBtn" type="button">Sign out</button>
      </div>
    </div>
  </div>
</header>`;
}

module.exports = { sidebar, topbar };

if (require.main === module) {
  let changed = 0, skipped = 0, problems = 0;
  const say = (kind, file, msg) => console.log(`${kind} ${file}${msg ? " — " + msg : ""}`);

  const LIVE_LINK = /\s*<a class="nav-btn[^"]*" href="live\.html"[^>]*>[\s\S]*?<\/a>/;
  for (const file of [...PAGES, "settings.html"]) {
    if (!fs.existsSync(file)) { say("skip ", file, "file not found"); skipped++; continue; }
    let html = fs.readFileSync(file, "utf8");
    if (html.includes('class="side-brand"')) {
      // already updated: only remove the old "Live" menu item if it is still there
      if (LIVE_LINK.test(html)) { fs.writeFileSync(file, html.replace(LIVE_LINK, "")); say("fixed", file, "removed the Live menu item"); changed++; }
      else { say("same ", file, "already updated"); skipped++; }
      continue;
    }

    const header = /<header class="topbar">[\s\S]*?<\/header>/;
    const nav = /<nav class="sidebar"[^>]*>[\s\S]*?<\/nav>/;
    if (!header.test(html) || !nav.test(html)) {
      say("check", file, "top bar or sidebar block not found, nothing changed in this file");
      problems++;
      continue;
    }
    html = html.replace(header, () => topbar(file)).replace(nav, () => sidebar(file));
    if (!html.includes("js/layout.js")) {
      html = html.replace(/<\/body>/i, '<script type="module" src="js/layout.js"></script>\n</body>');
    }
    fs.writeFileSync(file, html);
    say("done ", file);
    changed++;
  }

  // things the new pages need
  const need = [
    ["css/dashboard.css", "copy the new css/dashboard.css first"],
    ["js/layout.js", "copy js/layout.js"],
    ["js/settings.js", "copy js/settings.js"],
    ["settings.html", "copy settings.html"],
    ["js/presence.js", "this file should already be there"],
    ["images/ozara-logo.png", "the colour logo used in the sidebar"]
  ];
  for (const [f, why] of need) if (!fs.existsSync(f)) { say("MISSING", f, why); problems++; }
  if (fs.existsSync("css/dashboard.css") && !fs.readFileSync("css/dashboard.css", "utf8").includes(".side-brand")) {
    say("check", "css/dashboard.css", "this is still the OLD file, replace it with the new one"); problems++;
  }

  console.log(`\n${changed} page(s) changed, ${skipped} skipped, ${problems} to check.`);
}
