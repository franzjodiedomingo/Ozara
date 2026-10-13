#pragma once
#include <WiFi.h>
#include <Preferences.h>
// Included from web_server.h, after webServer and webToken exist.
//
// One-time Wi-Fi setup from the unit's own page, so no Wi-Fi name or password
// is written in the code:
//   1. Join the unit's Wi-Fi (OdorRemovalUnit) on a phone or laptop.
//   2. Open http://192.168.4.1/wifi, pick the network, type its password, save.
// The unit stores it in flash (Preferences) and reconnects by itself on every
// boot and whenever the connection drops. To move the unit to another place,
// open the same page and save the new network.

extern int lastFirebaseCode;   // defined in firebase_sync.h; 200/204 = cloud sync OK

Preferences wifiPrefs;
String wifiSavedSsid, wifiSavedPass;

const char WIFI_HTML[] PROGMEM = R"WIFIHTML(<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unit Wi-Fi setup</title>
<style>*{box-sizing:border-box}body{margin:0;background:#eef3f6;color:#17313b;font:16px system-ui,sans-serif}main{max-width:520px;margin:auto;padding:20px}h1{font-size:22px;margin:0 0 6px}section{background:#fff;padding:18px;border-radius:14px;margin-bottom:12px}label{display:block;font-size:14px;color:#526c78;margin:12px 0 6px}input{width:100%;padding:12px;border:1px solid #cdd9de;border-radius:10px;font:inherit}button{border:0;border-radius:10px;background:#086b70;color:#fff;padding:13px 18px;font:inherit;cursor:pointer}button.alt{background:#fff;color:#086b70;border:1px solid #086b70}button.danger{background:#a43d32}button:disabled{opacity:.5}button.net{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;background:#f4f8fa;color:#17313b;border:1px solid #dce6ea;margin-top:8px}.small{font-size:13px;color:#526c78;line-height:1.5}.ok{color:#0a7a3d}.bad{color:#a43d32}.row{display:flex;align-items:center;gap:8px;margin-top:10px}.row input{width:auto}</style>
<main><h1>Unit Wi-Fi setup</h1>
<p class="small">Pick the Wi-Fi that has internet. The unit remembers it and reconnects by itself, including after a power cut. Use a 2.4 GHz network.</p>
<section><b>Status</b><p id="status" class="small">Checking…</p></section>
<section>
<button class="alt" id="scanBtn" type="button">Scan networks</button>
<div id="nets"></div>
<label for="ssid">Wi-Fi name</label><input id="ssid" maxlength="32" autocomplete="off" autocapitalize="none" spellcheck="false">
<label for="pass">Password</label><input id="pass" type="password" maxlength="63" autocomplete="off">
<div class="row"><input type="checkbox" id="show"><label for="show" style="margin:0">Show password</label></div>
<p><button id="saveBtn" type="button">Save and connect</button></p>
<p id="msg" class="small"></p>
</section>
<section><button class="danger" id="forgetBtn" type="button">Forget saved Wi-Fi</button><p class="small">The unit stops connecting to the internet until you save a network again.</p></section>
<p class="small"><a href="/">Back to dashboard</a></p></main>
<script>
const token='__TOKEN__',$=id=>document.getElementById(id),wait=ms=>new Promise(r=>setTimeout(r,ms));
const form=o=>new URLSearchParams({token,...o});
async function status(){try{const r=await fetch('/api/wifi/status',{cache:'no-store',signal:AbortSignal.timeout(2500)});const d=await r.json();
$('status').className='small'+(d.connected?' ok':'');
$('status').textContent=d.saved?(d.connected?'Connected to '+d.saved+' ('+d.rssi+' dBm, '+d.ip+') · '+(d.cloud?'Cloud sync OK':'Cloud sync not confirmed yet'):'Saved: '+d.saved+' · not connected'):'No Wi-Fi saved yet';return d}
catch(e){$('status').className='small bad';$('status').textContent="Can't reach the unit. If its Wi-Fi dropped, reconnect to it and reload.";return null}}
function show(list){const box=$('nets');box.replaceChildren();if(!list.length){box.textContent='No networks found. Type the name below.';return}
list.sort((a,b)=>b.rssi-a.rssi).forEach(n=>{const b=document.createElement('button');b.type='button';b.className='net';const a=document.createElement('span');a.textContent=n.ssid;const c=document.createElement('span');c.textContent=(n.secure?'🔒 ':'')+n.rssi+' dBm';b.append(a,c);b.onclick=()=>{$('ssid').value=n.ssid;$('pass').focus()};box.append(b)})}
async function scan(){const b=$('scanBtn');b.disabled=true;$('nets').textContent='Scanning…';
try{await fetch('/api/wifi/scan?start=1',{cache:'no-store'});for(let i=0;i<20;i++){await wait(800);const d=await(await fetch('/api/wifi/scan',{cache:'no-store'})).json();if(!d.scanning){show(d.networks);return}}$('nets').textContent='Scan took too long. Try again.'}
catch(e){$('nets').textContent='Scan failed. Try again.'}finally{b.disabled=false}}
async function save(){const ssid=$('ssid').value.trim(),pass=$('pass').value,m=$('msg');
if(!ssid){m.className='small bad';m.textContent='Enter the Wi-Fi name.';return}
if(pass.length&&pass.length<8){m.className='small bad';m.textContent='Password must be at least 8 characters (leave empty only for an open network).';return}
$('saveBtn').disabled=true;m.className='small';m.textContent='Saving…';
try{const r=await fetch('/api/wifi/save',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({ssid,pass}),signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error(await r.text())}
catch(e){m.className='small bad';m.textContent='Not saved: '+e.message;$('saveBtn').disabled=false;return}
m.textContent='Saved. Connecting… this can take up to 40 seconds. The unit may briefly drop its own Wi-Fi.';
for(let i=0;i<27;i++){await wait(1500);const d=await status();if(d&&d.connected){m.className='small ok';m.textContent='Connected. The unit will reconnect by itself from now on.';$('saveBtn').disabled=false;return}}
m.className='small bad';m.textContent="Couldn't confirm the connection. Check the name and password, that the Wi-Fi has internet, and that it is 2.4 GHz.";$('saveBtn').disabled=false}
async function forget(){if(!confirm('Forget the saved Wi-Fi?'))return;try{const r=await fetch('/api/wifi/forget',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form({}),signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error(await r.text());$('msg').className='small';$('msg').textContent='Forgotten.'}catch(e){$('msg').className='small bad';$('msg').textContent='Failed: '+e.message}status()}
$('scanBtn').onclick=scan;$('saveBtn').onclick=save;$('forgetBtn').onclick=forget;
$('show').onchange=e=>{$('pass').type=e.target.checked?'text':'password'};
status();setInterval(status,5000);
</script></html>)WIFIHTML";

void wifiLoadSaved() {
  wifiPrefs.begin("ozara-wifi", false);
  wifiSavedSsid = wifiPrefs.getString("ssid", "");
  wifiSavedPass = wifiPrefs.getString("pass", "");
  wifiPrefs.end();
}

void wifiStore(const String& ssid, const String& pass) {
  wifiPrefs.begin("ozara-wifi", false);
  wifiPrefs.putString("ssid", ssid);
  wifiPrefs.putString("pass", pass);
  wifiPrefs.end();
  wifiSavedSsid = ssid;
  wifiSavedPass = pass;
}

// Called once at startup. Non-blocking: the unit does not hang if the network
// is missing. The ESP32 keeps retrying on its own if the connection drops.
void wifiConnectSaved() {
  WiFi.setAutoReconnect(true);
  wifiLoadSaved();
  if (wifiSavedSsid.length() == 0) {
    Serial.println("WIFI: none saved. Join the unit's Wi-Fi and open http://192.168.4.1/wifi");
    return;
  }
  Serial.print("WIFI: connecting to saved network ");
  Serial.println(wifiSavedSsid);
  WiFi.begin(wifiSavedSsid.c_str(), wifiSavedPass.c_str());
}

String wifiJson(const String& s) {
  String o;
  o.reserve(s.length() + 8);
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"' || c == '\\') { o += '\\'; o += c; }
    else if ((unsigned char)c < 0x20) o += ' ';
    else o += c;
  }
  return o;
}

void serveWifiPage() {
  String page = FPSTR(WIFI_HTML);
  page.replace("__TOKEN__", webToken);
  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send(200, "text/html", page);
}

// GET ?start=1 begins a scan in the background; plain GET returns the result.
void serveWifiScan() {
  webServer.sendHeader("Cache-Control", "no-store");
  if (webServer.hasArg("start")) {
    if (WiFi.scanComplete() != WIFI_SCAN_RUNNING) {
      WiFi.scanDelete();
      WiFi.scanNetworks(true);          // async: does not block the unit
    }
    webServer.send(200, "application/json", "{\"scanning\":true}");
    return;
  }
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) {
    webServer.send(200, "application/json", "{\"scanning\":true}");
    return;
  }
  if (n < 0) {
    webServer.send(200, "application/json", "{\"scanning\":false,\"networks\":[]}");
    return;
  }
  String out = "{\"scanning\":false,\"networks\":[";
  bool first = true;
  int shown = 0;
  for (int i = 0; i < n && shown < 15; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;                       // hidden network
    bool weaker = false;                                    // keep one row per name, strongest signal
    for (int j = 0; j < n; j++) {
      if (j == i || WiFi.SSID(j) != ssid) continue;
      if (WiFi.RSSI(j) > WiFi.RSSI(i) || (WiFi.RSSI(j) == WiFi.RSSI(i) && j < i)) { weaker = true; break; }
    }
    if (weaker) continue;
    if (!first) out += ",";
    first = false;
    shown++;
    out += "{\"ssid\":\"" + wifiJson(ssid) + "\",\"rssi\":" + String(WiFi.RSSI(i));
    out += WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? ",\"secure\":false}" : ",\"secure\":true}";
  }
  out += "]}";
  WiFi.scanDelete();
  webServer.send(200, "application/json", out);
}

void serveWifiStatus() {
  bool connected = WiFi.status() == WL_CONNECTED;
  String out = "{\"saved\":\"" + wifiJson(wifiSavedSsid) + "\",\"connected\":";
  out += connected ? "true" : "false";
  if (connected) {
    out += ",\"rssi\":" + String(WiFi.RSSI());
    out += ",\"ip\":\"" + WiFi.localIP().toString() + "\"";
  }
  out += ",\"cloud\":";
  out += (lastFirebaseCode == 200 || lastFirebaseCode == 204) ? "true" : "false";
  out += "}";
  webServer.sendHeader("Cache-Control", "no-store");
  webServer.send(200, "application/json", out);
}

void serveWifiSave() {
  if (webServer.arg("token") != webToken) {
    webServer.send(403, "text/plain", "Invalid control token; reload this page");
    return;
  }
  String ssid = webServer.arg("ssid");
  String pass = webServer.arg("pass");
  ssid.trim();
  if (ssid.length() < 1 || ssid.length() > 32) {
    webServer.send(400, "text/plain", "Wi-Fi name must be 1 to 32 characters");
    return;
  }
  if (pass.length() != 0 && (pass.length() < 8 || pass.length() > 63)) {
    webServer.send(400, "text/plain", "Password must be 8 to 63 characters");
    return;
  }
  wifiStore(ssid, pass);
  webServer.send(200, "text/plain", "Saved");
  delay(150);                           // let the reply go out before the radio retunes
  WiFi.disconnect(false);               // drop the old network, keep the unit's own Wi-Fi
  WiFi.begin(wifiSavedSsid.c_str(), wifiSavedPass.c_str());
  Serial.print("WIFI: saved and connecting to ");
  Serial.println(wifiSavedSsid);
}

void serveWifiForget() {
  if (webServer.arg("token") != webToken) {
    webServer.send(403, "text/plain", "Invalid control token; reload this page");
    return;
  }
  wifiStore("", "");
  WiFi.disconnect(false);
  webServer.send(200, "text/plain", "Forgotten");
  Serial.println("WIFI: saved network forgotten");
}

void registerWifiRoutes() {
  webServer.on("/wifi", HTTP_GET, serveWifiPage);
  webServer.on("/api/wifi/scan", HTTP_GET, serveWifiScan);
  webServer.on("/api/wifi/status", HTTP_GET, serveWifiStatus);
  webServer.on("/api/wifi/save", HTTP_POST, serveWifiSave);
  webServer.on("/api/wifi/forget", HTTP_POST, serveWifiForget);
}
