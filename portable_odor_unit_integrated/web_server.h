#pragma once
#include <WiFi.h>
#include <WebServer.h>
#include <esp_system.h>
#include "dashboard.h"
// Included after the controller functions in the .ino: uses its state and caches.
// This header belongs to this sketch; it is not a standalone library.

// Physical buttons take priority. Browser holds require a renewable lease.
WebServer webServer(80);
const char* AP_NAME = "OdorRemovalUnit";
const char* AP_PASSWORD = "Admin@123"; // Change before use (at least 8 characters).
const unsigned long WEB_LEASE_MS = 700;
int webButtonIndex = -1;
unsigned long webButtonUpdatedAt = 0;
String webOwner, webToken;
bool webStarted = false;
#include "wifi_setup.h"   // saved internet Wi-Fi + /wifi setup page (needs webServer, webToken above)
bool physicalButtonActive() {
  for (int i=0;i<3;i++) if (digitalRead(BUTTON_PINS[i]) == LOW) return true;
  return false;
}
void expireWebButton() {
  if (webButtonIndex >= 0 && (millis()-webButtonUpdatedAt > WEB_LEASE_MS || physicalButtonActive())) {
    // Lost ownership must cancel a hold, not complete a tap or merge with a physical hold.
    if(webButtonIndex==0) {startTracking=false;startHoldActive=false;startConsumed=true;}
    if(webButtonIndex==1) {minusTracking=false;minusViewHandled=false;}
    if(webButtonIndex==2) {plusTracking=false;cancelHoldActive=false;plusHoldHandled=false;}
    clearSounds();displayDirty=true;
    webButtonIndex = -1; webOwner = "";
  }
}
// RAM ring buffer: CSV exports are volatile, never presented as permanent storage.
const unsigned int LOG_CAPACITY = 600;
struct ReadingRecord {
  unsigned long at;
  float gas;
  int mq136, mq137;
  float temperature, humidity;
  State phase;
  bool ozone;
};
ReadingRecord readingLog[LOG_CAPACITY];
unsigned int logHead = 0, logCount = 0;
unsigned long lastLoggedReadingAt = 0;

const char* webInstruction() {
  if (state==PURGING) return "Purge in progress. Cancellation is blocked. Test timing does not verify clearance.";
  if (readyAnnouncement || confirmationVisible) return "Please wait for the current confirmation or announcement.";
  switch(state) {
    case IDLE: return "With the unit installed in an empty cabinet, tap OK to sample baseline air.";
    case WAIT_FOR_CLOTHES: return "Load clothes and close the cabinet door, then tap OK.";
    case TIME_CHOICE: return "Tap OK for suggested duration or minus for manual duration.";
    case AUTO_CONFIRM: return "Hold OK for 3 seconds to confirm. Tap minus to go back.";
    case SUGGEST: return "Tap minus/plus to adjust. Hold OK for 3 seconds to confirm.";
    case DONE: return "Purge timer finished. Tap OK to confirm and view results; this is not a clearance measurement.";
    case RESULTS: return "Minus switches results pages. Hold OK for 3 seconds to return to Ready without rebooting.";
    case SENSOR_ERROR: return "BME680 fault: inspect sensor and wiring, then tap OK to retry.";
    default: return "Automatic phase in progress. Existing timing and physical controls remain active.";
  }
}
long webRemaining() {
  switch(state) {
    case WARMUP: return remainingSeconds(WARMUP_MS,phaseStartTime);
    case BASELINE_FAN_PRERUN: case CLOTHES_FAN_PRERUN: return remainingSeconds(FAN_PRERUN_MS,phaseStartTime);
    case BASELINE_SAMPLING: case CLOTHES_SAMPLING: return remainingSeconds(SAMPLE_WINDOW_MS,phaseStartTime);
    case SOAKING: return remainingSeconds(SOAK_TIME_MS,phaseStartTime);
    case START_COUNTDOWN: return remainingSeconds(PRE_TREATMENT_DELAY_MS,phaseStartTime);
    case RUNNING_PULSE: case RUNNING_DISPERSE: return remainingSeconds(selectedTimeS*1000UL,ozoneOverallStart);
    case PURGING: return remainingSeconds(PURGE_TIME_MS,phaseStartTime);
    default: return -1;
  }
}
void recordReading() {
  if (!liveReadingValid || lastReadingAt==lastLoggedReadingAt) return;
  lastLoggedReadingAt=lastReadingAt;
  readingLog[logHead]={lastReadingAt,liveGasKOhm,liveMQ136,liveMQ137,liveTemperatureC,liveHumidityRH,state,ozoneIsOn};
  logHead=(logHead+1)%LOG_CAPACITY;
  if(logCount<LOG_CAPACITY) logCount++;
}
void serveStatus() {
  bool valid=liveReadingValid && millis()-lastReadingAt<=READING_STALE_MS;
  unsigned int oldest=(logHead+LOG_CAPACITY-logCount)%LOG_CAPACITY;
  long remain=webRemaining();
  String out;out.reserve(1500);
  out="{\"phase\":\"";out+=stateName(state);out+="\",\"instruction\":\"";out+=webInstruction();
  out+="\",\"remaining\":";out+=remain<0 ? String("null") : String(remain);
  out+=",\"progress\":";out+=String((sectionProgressWidth()*100+63)/126);
  out+=",\"valid\":";out+=valid?"true":"false";
  out+=",\"gas\":";out+=String(valid?liveGasKOhm:0,3);
  out+=",\"mq136\":";out+=String(liveMQ136);out+=",\"mq137\":";out+=String(liveMQ137);
  out+=",\"temperature\":";out+=valid ? String(liveTemperatureC,2) : String("null");
  out+=",\"humidity\":";out+=valid ? String(liveHumidityRH,2) : String("null");
  out+=",\"readingAt\":";out+=String(lastReadingAt);
  out+=",\"ozone\":";out+=ozoneIsOn?"true":"false";
  out+=",\"fan\":";out+=digitalRead(OZONE_FAN_PIN)==LOW?"true":"false";
  out+=",\"purgeFan\":";out+=digitalRead(CARBON_FAN_PIN)==LOW?"true":"false";
  out+=",\"sensorFan\":";out+=digitalRead(SENSOR_FAN_PIN)==LOW?"true":"false";
  out+=",\"selected\":";out+=String(selectedTimeS);out+=",\"suggested\":";out+=String(suggestedTimeS);
  out+=",\"records\":";out+=String(logCount);out+=",\"oldest\":";
  out+=String(logCount?readingLog[oldest].at/1000UL:0);
  out+=",\"mode\":\"TEST\",\"score\":";out+=String(combinedScore*100,2);
  out+=",\"resultsPage\":";out+=String(resultsPage);
  out+=",\"actualTreatmentSeconds\":";out+=String(actualTreatmentMs/1000.0,3);
  out+=",\"cycleSeconds\":";out+=String(finishedCycleMs/1000.0,3);
  out+=",\"aborted\":";out+=cycleAborted ? "true" : "false";
  out+=",\"holding\":";out+=startHoldActive ? "true" : "false";
  out+=",\"holdRemaining\":";out+=startHoldActive ? String(remainingSeconds(START_CONFIRM_MS,startHeldSince)) : String("null");
  out+=",\"baseline\":[";
  for(int i=0;i<3;i++) {if(i) out+=",";out+=String(baseline[i],3);}
  out+="],\"clothes\":[";
  for(int i=0;i<3;i++) {if(i) out+=",";out+=String(clothes[i],3);}
  out+="]}";
  webServer.sendHeader("Cache-Control","no-store");webServer.send(200,"application/json",out);
}
void serveButton() {
  expireWebButton();
  if(webServer.arg("token")!=webToken) {webServer.send(403,"text/plain","Invalid control token; reload dashboard");return;}
  String client=webServer.arg("client"), key=webServer.arg("key");
  if(client.length()<1 || client.length()>80 || (key!="-1" && key!="0" && key!="1" && key!="2")) {
    webServer.send(400,"text/plain","Invalid button request");return;
  }
  if(key=="-1") {
    if(client==webOwner) {webButtonIndex=-1;webOwner="";}
    webServer.send(200,"text/plain","Released");return;
  }
  if(physicalButtonActive()) {webServer.send(409,"text/plain","Physical button is active");return;}
  // Wait for the debounced release before accepting a new remote gesture.
  if(webButtonIndex<0) {
    for(int i=0;i<3;i++) if(rawButton[i]==LOW || stableButton[i]==LOW) {
      webServer.send(409,"text/plain","Wait for button release");return;
    }
  }
  int index=key.toInt();
  if(webButtonIndex>=0 && (webOwner!=client || webButtonIndex!=index)) {
    webServer.send(409,"text/plain","Another button or browser is active");return;
  }
  webOwner=client;webButtonIndex=index;webButtonUpdatedAt=millis();
  webServer.send(200,"text/plain","Held");
}
void serveCSV() {
  // Bound response size; no writes to flash and no network dependency in cycle logic.
  String csv;csv.reserve(logCount*130+200);
  csv="seconds_since_boot,phase,bme680_gas_kohm,mq136_raw_adc,mq137_raw_adc,temperature_c,humidity_rh,ozone_commanded_on\r\n";
  unsigned int oldest=(logHead+LOG_CAPACITY-logCount)%LOG_CAPACITY;
  for(unsigned int i=0;i<logCount;i++) {
    const ReadingRecord& r=readingLog[(oldest+i)%LOG_CAPACITY];
    csv+=String(r.at/1000.0,3);csv+=",";csv+=stateName(r.phase);csv+=",";
    csv+=String(r.gas,3);csv+=",";csv+=String(r.mq136);csv+=",";csv+=String(r.mq137);
    csv+=",";csv+=String(r.temperature,2);csv+=",";csv+=String(r.humidity,2);
    csv+=r.ozone?",1\r\n":",0\r\n";
  }
  webServer.sendHeader("Content-Disposition","attachment; filename=unit_readings.csv");
  webServer.sendHeader("Cache-Control","no-store");webServer.send(200,"text/csv",csv);
}
void startWebsite() {
  webToken=String(esp_random(),HEX)+String(esp_random(),HEX);
  WiFi.persistent(false);                       // we store the network ourselves (wifi_setup.h)
  WiFi.mode(WIFI_AP_STA);                       // AP (local dashboard) + STA (internet for Firebase)
  if(!WiFi.softAP(AP_NAME,AP_PASSWORD)) {Serial.println("WEB: Access point failed; physical controls continue");return;}
  wifiConnectSaved();                           // non-blocking: connects to the saved Wi-Fi, if any
  webServer.on("/",HTTP_GET,[](){
    String page=FPSTR(DASHBOARD_HTML);page.replace("__TOKEN__",webToken);
    webServer.sendHeader("Cache-Control","no-store");webServer.send(200,"text/html",page);
  });
  webServer.on("/api/status",HTTP_GET,serveStatus);
  webServer.on("/api/button",HTTP_POST,serveButton);
  webServer.on("/api/readings.csv",HTTP_GET,serveCSV);
  registerWifiRoutes();                         // /wifi setup page
  webServer.onNotFound([](){webServer.send(404,"text/plain","Not found");});
  webServer.begin();webStarted=true;
  Serial.print("WEB: Connect to ");Serial.println(AP_NAME);
  Serial.print("WEB: Open http://");Serial.println(WiFi.softAPIP());
  Serial.println("WEB: Internet Wi-Fi is set up at /wifi (connects in the background)");
}
