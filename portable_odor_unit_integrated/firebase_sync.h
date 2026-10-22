#pragma once
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "remote_buttons.h"   // serviceRemoteButtons(), rcSubmit(), rcTakeResult()
// Include AFTER web_server.h in the .ino (uses state, live readings, etc.).
//
// Sends the unit's live data to Firebase over the internet, through the ESP32's
// STA Wi-Fi (STA_SSID / STA_PASS in web_server.h). The Ozara web app reads it
// from anywhere, so nobody needs to join the unit's own Wi-Fi.
//
// It runs in its own FreeRTOS task on core 0. Slow HTTPS calls therefore never
// stall the buttons, buzzer timing or the cycle logic running in loop().
//
// Writes, all under devices/<FB_DEVICE_ID>/ :
//   live      overwritten every FB_LIVE_MS      -> Live page
//   status    overwritten every FB_LIVE_MS      -> Home page (ready, sensors, cycle)
//   readings  one new child every FB_READING_MS -> Live chart and recent readings
//   history   one new child per finished cycle  -> History page + Monitor "Completed cycles"
//
// The unit signs in to Firebase Auth with its own account (FB_DEVICE_EMAIL).
// Create that user in Firebase Console > Authentication > Users first, and keep
// the same email in database.rules.json.
//
// KEEP THIS FILE PRIVATE: it contains the device password. Do not put the
// sketch folder inside the website folder or in a public repository.

const char* FB_API_KEY         = "AIzaSyBwGnk3g5TvNKWlAh4zjDIN9GF9pCtjGN4"; // same as firebase-config.js
const char* FB_DB_URL          = "https://ozara-dfec7-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* FB_DEVICE_ID       = "device1";                // must match DEVICE_ID in the web app
const char* FB_DEVICE_EMAIL    = "device1@ozara.local";    // must match database.rules.json
const char* FB_DEVICE_PASSWORD = "Admin@123"; // no quotes or backslashes
const unsigned long FB_LIVE_MS    = 5000UL;   // live + status
const unsigned long FB_READING_MS = 10000UL;  // history/chart point
const unsigned long FB_POLL_MS    = 300UL;    // FALLBACK only: used while the instant stream below is down

String fbIdToken, fbRefreshToken;
SemaphoreHandle_t fbTokenLock = nullptr;   // token is read by the stream task, written by the live task
volatile bool fbStreamUp = false;          // true while the instant-command stream is connected
void fbSetToken(const String& t) {
  if (fbTokenLock) xSemaphoreTake(fbTokenLock, portMAX_DELAY);
  fbIdToken = t;
  if (fbTokenLock) xSemaphoreGive(fbTokenLock);
}
String fbGetToken() {
  if (fbTokenLock) xSemaphoreTake(fbTokenLock, portMAX_DELAY);
  String t = fbIdToken;
  if (fbTokenLock) xSemaphoreGive(fbTokenLock);
  return t;
}
unsigned long fbTokenExpiresAt = 0;   // millis() when the id token should be renewed
int lastFirebaseCode = 0;
int fbAuthFails = 0;
bool fbWarmedUp = false;              // MQ sensors have been through the warm-up phase

// Tiny JSON helper: value of a "key":"string" pair. Fine for Firebase auth
// replies (tokens contain no quotes or escapes). No extra library needed.
String fbJsonString(const String& body, const char* key) {
  String pattern = String("\"") + key + "\"";
  int i = body.indexOf(pattern);
  if (i < 0) return "";
  i = body.indexOf(':', i + pattern.length());
  if (i < 0) return "";
  i = body.indexOf('"', i);
  if (i < 0) return "";
  int j = body.indexOf('"', i + 1);
  if (j < 0) return "";
  return body.substring(i + 1, j);
}

// One HTTPS request. Returns the HTTP status code (or a negative error).
// One shared keep-alive connection: polling every second would be far too slow
// if every request did a fresh TLS handshake.
WiFiClientSecure fbClient;
HTTPClient fbHttp;
String fbLastHost;
int fbRequest(const char* method, const String& url, const String& body,
              const char* contentType, String* response = nullptr) {
  int s = url.indexOf("://");
  int e = url.indexOf('/', s + 3);
  String host = url.substring(s + 3, e);
  if (host != fbLastHost) { fbClient.stop(); fbLastHost = host; }  // other server: new connection
  fbClient.setInsecure();          // OK for testing; certificate is not verified
  fbHttp.setReuse(true);
  fbHttp.setConnectTimeout(4000);
  fbHttp.setTimeout(6000);
  int code = -1;
  if (fbHttp.begin(fbClient, url)) {
    fbHttp.addHeader("Content-Type", contentType);
    code = fbHttp.sendRequest(method, body);
    if (response && code > 0) *response = fbHttp.getString();
    fbHttp.end();
  }
  if (code < 0) {                  // stale keep-alive connection: reconnect and retry once
    fbClient.stop();
    if (fbHttp.begin(fbClient, url)) {
      fbHttp.addHeader("Content-Type", contentType);
      code = fbHttp.sendRequest(method, body);
      if (response && code > 0) *response = fbHttp.getString();
      fbHttp.end();
    }
    if (code < 0) fbClient.stop();
  }
  return code;
}

bool fbSignIn() {
  String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FB_API_KEY;
  String body = String("{\"email\":\"") + FB_DEVICE_EMAIL + "\",\"password\":\"" + FB_DEVICE_PASSWORD + "\",\"returnSecureToken\":true}";
  String resp;
  int code = fbRequest("POST", url, body, "application/json", &resp);
  if (code != 200) {
    Serial.print("FIREBASE: sign-in failed, HTTP "); Serial.print(code);
    Serial.print(" "); Serial.println(fbJsonString(resp, "message")); // e.g. INVALID_LOGIN_CREDENTIALS
    return false;
  }
  fbSetToken(fbJsonString(resp, "idToken"));
  fbRefreshToken = fbJsonString(resp, "refreshToken");
  long expires = fbJsonString(resp, "expiresIn").toInt();
  if (expires <= 600) expires = 3600;
  fbTokenExpiresAt = millis() + (unsigned long)(expires - 300) * 1000UL; // renew 5 min early
  Serial.println("FIREBASE: signed in");
  return fbIdToken.length() > 0;
}

bool fbRefresh() {
  String url = String("https://securetoken.googleapis.com/v1/token?key=") + FB_API_KEY;
  String body = String("grant_type=refresh_token&refresh_token=") + fbRefreshToken;
  String resp;
  int code = fbRequest("POST", url, body, "application/x-www-form-urlencoded", &resp);
  if (code != 200) return false;
  String id = fbJsonString(resp, "id_token");
  if (id.length() == 0) return false;
  fbSetToken(id);
  String refresh = fbJsonString(resp, "refresh_token");
  if (refresh.length()) fbRefreshToken = refresh;
  long expires = fbJsonString(resp, "expires_in").toInt();
  if (expires <= 600) expires = 3600;
  fbTokenExpiresAt = millis() + (unsigned long)(expires - 300) * 1000UL;
  return true;
}

bool fbEnsureToken() {
  if (fbIdToken.length() && (long)(fbTokenExpiresAt - millis()) > 0) return true;
  bool ok = fbRefreshToken.length() ? fbRefresh() : false;
  if (!ok) ok = fbSignIn();
  return ok;
}

// Seconds left in the whole cycle (countdown + treatment + purge), or -1 when
// no cycle is running. Matches the progress bar on the OLED.
long fbCycleRemaining() {
  switch (state) {
    case START_COUNTDOWN: case RUNNING_PULSE: case RUNNING_DISPERSE: case MANUAL_OZONE: case PURGING: {
      unsigned long start = abortProgress ? abortProgressStartedAt : sectionStartedAt;
      unsigned long duration = abortProgress ? activePurgeMs() : sectionDurationMs;
      unsigned long elapsed = millis() - start;
      return elapsed >= duration ? 0 : (long)((duration - elapsed + 999UL) / 1000UL);
    }
    default: return -1;
  }
}

String fbBool(bool v) { return v ? "true" : "false"; }

// Fields shared by the live node and each history reading.
String fbReadingFields(bool fresh) {
  String s;
  s += "\"phase\":\"" + String(stateName(state)) + "\"";
  s += ",\"valid\":" + fbBool(fresh);
  if (fresh) {
    s += ",\"gasKOhm\":" + String(liveGasKOhm, 3);   // BME680 gas resistance, not ozone
    s += ",\"mq136\":" + String(liveMQ136);          // raw ADC, not ppm
    s += ",\"mq137\":" + String(liveMQ137);          // raw ADC, not ppm
    s += ",\"temperature\":" + String(liveTemperatureC, 2);
    s += ",\"humidity\":" + String(liveHumidityRH, 2);
  }
  s += ",\"ozoneOn\":" + fbBool(ozoneIsOn);          // commanded relay state, not measured
  return s;
}

// PATCH body for devices/<id>: replaces "live" and "status" in one request.
String fbBuildPatch() {
  bool fresh = readingsFresh();
  long phaseLeft = webRemaining();
  long cycleLeft = fbCycleRemaining();
  bool ready = state != WARMUP && state != SENSOR_ERROR;
  if (ready) fbWarmedUp = true;

  String b;
  b.reserve(900);
  b = "{\"live\":{";
  b += fbReadingFields(fresh);
  if (phaseLeft >= 0) b += ",\"remaining\":" + String(phaseLeft);
  b += ",\"fan\":" + fbBool(digitalRead(OZONE_FAN_PIN) == LOW);
  b += ",\"purgeFan\":" + fbBool(digitalRead(CARBON_FAN_PIN) == LOW);
  b += ",\"sensorFan\":" + fbBool(digitalRead(SENSOR_FAN_PIN) == LOW);
  b += ",\"hint\":\"" + String(webInstruction()) + "\"";   // shown on the Remote card
  b += ",\"selectedSeconds\":" + String(selectedTimeS);
  b += ",\"aborted\":" + fbBool(cycleAborted);
  b += ",\"ts\":{\".sv\":\"timestamp\"}},";

  // Home page flags. The firmware has no real calibration step: "calibrated"
  // here means the MQ sensors have finished their warm-up.
  b += "\"status\":{";
  b += "\"esp32Ready\":" + fbBool(ready);
  b += ",\"climateReady\":" + fbBool(fresh);
  b += ",\"gasCalibrated\":" + fbBool(fbWarmedUp);
  b += ",\"mq137Calibrated\":" + fbBool(fbWarmedUp);
  b += ",\"cycleRunning\":" + fbBool(cycleLeft >= 0);
  if (cycleLeft >= 0) b += ",\"cycleRemainingSeconds\":" + String(cycleLeft);
  b += ",\"phase\":\"" + String(stateName(state)) + "\"";
  b += ",\"lastSeen\":{\".sv\":\"timestamp\"}}}";
  return b;
}

String fbBuildReading() {
  String b = "{";
  b += fbReadingFields(true);
  b += ",\"timestamp\":{\".sv\":\"timestamp\"}}";
  return b;
}

// One finished-cycle summary (see queueHistoryRecord() in the .ino).
// endedAt is the server clock when the record arrives; the web app derives
// startedAt = endedAt - durationSec because the ESP32 has no real-time clock.
String fbBuildHistory(const HistRec& r) {
  String b = "{";
  b += "\"phase\":\"" + String(r.manual ? "manual" : "cycle") + "\"";
  b += ",\"status\":\"" + String(r.aborted ? "aborted" : "completed") + "\"";
  b += ",\"endedAt\":{\".sv\":\"timestamp\"}";
  b += ",\"durationSec\":" + String(r.durationS);
  b += ",\"treatmentSec\":" + String(r.treatmentS);
  b += ",\"count\":" + String(r.count);
  if (r.hasAvg) {
    b += ",\"bmeAvg\":" + String(r.bme, 3);            // kOhm, BME680 gas resistance
    b += ",\"mq136Avg\":" + String(r.mq136, 1);        // raw ADC
    b += ",\"mq137Avg\":" + String(r.mq137, 1);        // raw ADC
    b += ",\"temperatureAvg\":" + String(r.temp, 2);
    b += ",\"humidityAvg\":" + String(r.hum, 2);
    b += ",\"baselineBmeAvg\":" + String(r.baseBme, 3);
    b += ",\"baselineMq136Avg\":" + String(r.baseMq136, 1);
    b += ",\"baselineMq137Avg\":" + String(r.baseMq137, 1);
  }
  b += "}";
  return b;
}

void fbHandleCode(int code, const char* what) {
  lastFirebaseCode = code;
  Serial.print("FIREBASE: "); Serial.print(what); Serial.print(" HTTP "); Serial.println(code);
  if (code == 200 || code == 204) { fbAuthFails = 0; return; }
  if (code == 401 && ++fbAuthFails >= 3) {   // token rejected or rules denied
    Serial.println("FIREBASE: permission denied. Check device email and database rules.");
    fbSetToken("");                           // force a fresh sign-in
    fbAuthFails = 0;
  }
}

// ---------- Remote buttons (web app -> unit) ----------
// The task (core 0) only reads/writes Firebase. It hands each command to loop()
// (core 1) through this mailbox, and loop() does the actual button press, so
// all controller state is still touched from one place only.
long fbJsonLong(const String& body, const char* key, long def) {
  String pattern = String("\"") + key + "\"";
  int i = body.indexOf(pattern);
  if (i < 0) return def;
  i = body.indexOf(':', i + pattern.length());
  if (i < 0) return def;
  return body.substring(i + 1).toInt();
}

// Reads commands/button and hands it to remote_buttons.h. A command already
// sitting there at boot is ignored, so a restart never replays an old "tap OK".
void fbParseCommand(const String& resp) {
  static String handledId = "";
  static bool primed = false;
  if (resp.length() < 5) { primed = true; return; }          // "null" = no command yet
  String id = fbJsonString(resp, "id");
  if (id.length() == 0) return;
  if (!primed) { handledId = id; primed = true; return; }
  if (id == handledId) return;                                // already handled
  handledId = id;
  String action = fbJsonString(resp, "action");
  int key = (int)fbJsonLong(resp, "key", -1);
  int act = action == "tap" ? RC_TAP : action == "hold" ? RC_HOLD : action == "release" ? RC_RELEASE : -1;
  Serial.print("REMOTE: "); Serial.print(action); Serial.print(" key "); Serial.println(key);
  if (key < 0 || key > 2 || act < 0) return;                  // invalid: ignore
  rcSubmit(key, act, id);
}


// ---------- Instant remote buttons (Firebase streaming) ----------
// Instead of asking Firebase "anything new?" every 300 ms, this task keeps one
// connection open (Server-Sent Events). Firebase PUSHES the command the moment
// the web app writes it, so there is no polling delay and the 5 s live update
// in firebaseTask() can no longer hold a button press back.
// If the stream drops, firebaseTask() falls back to the 300 ms poll automatically.
void fbStreamTask(void*) {
  WiFiClientSecure client;
  String usedToken = "";
  for (;;) {
    String token = fbGetToken();
    if (WiFi.status() != WL_CONNECTED || token.length() == 0) { fbStreamUp = false; vTaskDelay(pdMS_TO_TICKS(500)); continue; }

    String host = String(FB_DB_URL); host.replace("https://", "");
    String path = String("/devices/") + FB_DEVICE_ID + "/commands/button.json?auth=" + token;
    client.setInsecure();
    client.setNoDelay(true);
    if (!client.connect(host.c_str(), 443, 5000)) { fbStreamUp = false; client.stop(); vTaskDelay(pdMS_TO_TICKS(1500)); continue; }
    // HTTP/1.0 on purpose: the server then streams the events without chunk framing.
    client.print(String("GET ") + path + " HTTP/1.0\r\nHost: " + host + "\r\nAccept: text/event-stream\r\n\r\n");

    usedToken = token;
    bool headersDone = false, ok = false;
    String line, evt;
    unsigned long lastData = millis();
    while (client.connected() || client.available()) {
      if (fbGetToken() != usedToken) break;                 // token renewed: reconnect with the new one
      if (millis() - lastData > 70000UL) break;             // Firebase sends a keep-alive about every 30 s
      if (!client.available()) { vTaskDelay(pdMS_TO_TICKS(2)); continue; }
      char c = client.read();
      lastData = millis();
      if (c == '\r') continue;
      if (c != '\n') { if (line.length() < 600) line += c; continue; }

      if (!headersDone) {                                   // status line + headers
        if (line.startsWith("HTTP/")) ok = line.indexOf(" 200") > 0;
        if (line.length() == 0) { headersDone = true; if (!ok) break; fbStreamUp = true; Serial.println("FIREBASE: command stream connected"); }
      } else if (line.startsWith("event:")) {
        evt = line.substring(6); evt.trim();
        if (evt == "auth_revoked" || evt == "cancel") break;
      } else if (line.startsWith("data:")) {
        if (evt == "put" && line.indexOf("\"path\":\"/\"") > 0) {
          if (line.indexOf("\"data\":null") > 0) fbParseCommand("null");   // empty node: just mark as primed
          else fbParseCommand(line.substring(5));
        }
      }
      line = "";
    }
    fbStreamUp = false;
    client.stop();
    Serial.println("FIREBASE: command stream closed, reconnecting");
    vTaskDelay(pdMS_TO_TICKS(500));
  }
}

void firebaseTask(void*) {
  unsigned long lastLive = 0, lastReading = 0, lastReadingAtSent = 0, lastPoll = 0, lastHistTry = 0;
  bool first = true;
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(10));   // fine checking so acks go out right away
    if (WiFi.status() != WL_CONNECTED) continue;
    bool liveDue = first || millis() - lastLive >= FB_LIVE_MS;
    bool pollDue = !fbStreamUp && !rcReq.pending && !rcRes.pending && millis() - lastPoll >= FB_POLL_MS;
    bool histDue = histHead != histTail && millis() - lastHistTry >= 5000UL;   // retry every 5 s until sent
    if (!liveDue && !pollDue && !rcRes.pending && !histDue) continue;
    if (!fbEnsureToken()) { vTaskDelay(pdMS_TO_TICKS(10000)); continue; }

    String base = String(FB_DB_URL) + "/devices/" + FB_DEVICE_ID;
    String authQ = String("?auth=") + fbIdToken;
    String auth = authQ + "&print=silent";

    RcResult res;
    if (rcTakeResult(res)) {   // tell the web app what happened to its last press
      const char* act = res.action == RC_TAP ? "tap" : res.action == RC_HOLD ? "hold" : "release";
      String a = String("{\"id\":\"") + res.id + "\",\"action\":\"" + act +
                 "\",\"ok\":" + fbBool(res.ok) + ",\"note\":\"" + res.note + "\"}";
      fbHandleCode(fbRequest("PUT", base + "/commands/buttonAck.json" + auth, a, "application/json"), "ack");
    }
    if (pollDue) {
      lastPoll = millis();
      String resp;
      int code = fbRequest("GET", base + "/commands/button.json" + authQ, "", "application/json", &resp);
      if (code == 200) fbParseCommand(resp);
      else fbHandleCode(code, "command poll");
    }
    if (histDue) {
      lastHistTry = millis();
      HistRec rec = histQueue[histTail];                 // copy; only drop it once Firebase accepted it
      int code = fbRequest("POST", base + "/history.json" + authQ, fbBuildHistory(rec), "application/json");
      fbHandleCode(code, "history");
      if (code == 200) { __sync_synchronize(); histTail = (histTail + 1) % HIST_QUEUE; }
    }
    if (liveDue) {
      first = false;
      lastLive = millis();
      fbHandleCode(fbRequest("PATCH", base + ".json" + auth, fbBuildPatch(), "application/json"), "live+status");

      // A new history point only when there is a fresh reading we haven't sent yet.
      unsigned long readingAt = lastReadingAt;
      if (millis() - lastReading >= FB_READING_MS && readingsFresh() && readingAt != lastReadingAtSent) {
        lastReading = millis();
        lastReadingAtSent = readingAt;
        fbHandleCode(fbRequest("POST", base + "/readings.json" + auth, fbBuildReading(), "application/json"), "reading");
      }
    }
  }
}

// Called from loop() in the .ino. The first call starts the background task;
// later calls do nothing, so the loop is never blocked.
void pushToFirebase() {
  static bool started = false;
  if (started) return;
  started = true;
  fbTokenLock = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(firebaseTask, "firebase", 16384, nullptr, 1, nullptr, 0);
  xTaskCreatePinnedToCore(fbStreamTask, "fbstream", 10240, nullptr, 1, nullptr, 0);
}