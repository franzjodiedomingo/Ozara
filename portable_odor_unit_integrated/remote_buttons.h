#pragma once
// remote_buttons.h — presses requested from the Ozara web app (over Firebase).
// Included by firebase_sync.h, which is included after web_server.h in the .ino.
//
// The web app writes devices/<id>/commands/button:
//     { key: 0|1|2, action: "tap"|"hold"|"release", id: "<unique>" }
//     key 0 = OK, 1 = minus, 2 = plus   (same order as BUTTON_PINS)
//
// firebaseTask() (core 0) only READS that node and hands the request over with
// rcSubmit(). serviceRemoteButtons() (called from loop(), core 1) is the only
// code that touches the button state. It uses the same webButtonIndex /
// webButtonUpdatedAt "lease" as the local web dashboard, so the physical
// buttons keep priority and every existing rule still applies (OK hold 3 s,
// plus hold 6 s, purge cancel blocked, and so on).
//
// tap     the button is held for RC_TAP_MS, long enough to pass the debounce.
// hold    held until a "release" request arrives. RC_HOLD_MAX_MS is a safety:
//         if the release is lost (browser closed, Wi-Fi drop) it lets go by itself.

const unsigned long RC_TAP_MS = 180;
const unsigned long RC_HOLD_MAX_MS = 8000;
const char* const RC_OWNER = "cloud";
enum { RC_TAP = 0, RC_HOLD = 1, RC_RELEASE = 2 };

portMUX_TYPE rcMux = portMUX_INITIALIZER_UNLOCKED;

struct RcRequest { bool pending; int key; int action; char id[28]; };
struct RcResult  { bool pending; bool ok; int action; char id[28]; char note[48]; };
RcRequest rcReq = {false, 0, 0, {0}};
RcResult  rcRes = {false, false, 0, {0}, {0}};

// Called from the Firebase task. Only plain id characters are kept.
void rcSubmit(int key, int action, const String& id) {
  portENTER_CRITICAL(&rcMux);
  rcReq.key = key;
  rcReq.action = action;
  int n = 0;
  for (unsigned int i = 0; i < id.length() && n < (int)sizeof(rcReq.id) - 1; i++) {
    char c = id[i];
    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '-' || c == '_') rcReq.id[n++] = c;
  }
  rcReq.id[n] = 0;
  rcReq.pending = true;
  portEXIT_CRITICAL(&rcMux);
}

// Called from the Firebase task: the answer to send back to the web app.
bool rcTakeResult(RcResult& out) {
  bool have = false;
  portENTER_CRITICAL(&rcMux);
  if (rcRes.pending) { out = rcRes; rcRes.pending = false; have = true; }
  portEXIT_CRITICAL(&rcMux);
  return have;
}

static void rcReport(const RcRequest& r, bool ok, const char* note) {
  portENTER_CRITICAL(&rcMux);
  rcRes.ok = ok;
  rcRes.action = r.action;
  strncpy(rcRes.id, r.id, sizeof(rcRes.id) - 1); rcRes.id[sizeof(rcRes.id) - 1] = 0;
  strncpy(rcRes.note, note, sizeof(rcRes.note) - 1); rcRes.note[sizeof(rcRes.note) - 1] = 0;
  rcRes.pending = true;
  portEXIT_CRITICAL(&rcMux);
}

int rcMode = -1;              // -1 idle, RC_TAP or RC_HOLD while a press is active
int rcKey = -1;
unsigned long rcStartedAt = 0;

static bool rcAllReleased() {
  for (int i = 0; i < 3; i++) if (rawButton[i] == LOW || stableButton[i] == LOW) return false;
  return true;
}

static void rcLetGo() {
  if (webButtonIndex == rcKey && webOwner == RC_OWNER) { webButtonIndex = -1; webOwner = ""; }
  rcMode = -1; rcKey = -1;
}

// Call once per loop(), before updateButtons().
void serviceRemoteButtons() {
  if (rcMode >= 0) {
    if (webButtonIndex != rcKey || webOwner != RC_OWNER) {
      rcMode = -1; rcKey = -1;                 // expireWebButton() took it back (physical press)
    } else {
      webButtonUpdatedAt = millis();           // keep the lease alive
      unsigned long held = millis() - rcStartedAt;
      if (rcMode == RC_TAP && held >= RC_TAP_MS) rcLetGo();
      else if (rcMode == RC_HOLD && held >= RC_HOLD_MAX_MS) rcLetGo();
    }
  }

  RcRequest r;
  bool have = false;
  portENTER_CRITICAL(&rcMux);
  if (rcReq.pending) { r = rcReq; rcReq.pending = false; have = true; }
  portEXIT_CRITICAL(&rcMux);
  if (!have) return;

  if (r.action == RC_RELEASE) {
    if (rcMode == RC_HOLD && rcKey == r.key) rcLetGo();
    rcReport(r, true, "Released");
    return;
  }
  if (rcMode >= 0)             { rcReport(r, false, "Another remote press is active"); return; }
  if (physicalButtonActive())  { rcReport(r, false, "A physical button is being pressed"); return; }
  if (webButtonIndex >= 0)     { rcReport(r, false, "Another browser is using the buttons"); return; }
  if (!rcAllReleased())        { rcReport(r, false, "Wait for the last press to finish"); return; }

  webOwner = RC_OWNER;
  webButtonIndex = r.key;
  webButtonUpdatedAt = millis();
  rcMode = r.action;                           // RC_TAP or RC_HOLD
  rcKey = r.key;
  rcStartedAt = millis();
  rcReport(r, true, "OK");
}
