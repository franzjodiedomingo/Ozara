Portable Odor-Removal Unit - local web dashboard (TEST VERSION)

1. Extract the ZIP; keep all files in the portable_odor_unit_integrated folder.
2. Open portable_odor_unit_integrated.ino in Arduino IDE.
3. dashboard.h and web_server.h appear as separate tabs.
4. Select your ESP32 board and port and use your existing Adafruit libraries.
   WiFi and WebServer come with the ESP32 Arduino board package.
5. Change AP_PASSWORD in web_server.h (at least 8 characters).
6. Upload the sketch. All three code files compile and upload together.
7. Connect your phone/laptop to OdorRemovalUnit. Default password: ChangeMe4826
8. Open http://192.168.4.1 (or the address printed in Serial Monitor at 115200).
   If your phone warns of no internet, choose to stay connected.

Edit dashboard.h in Arduino IDE or VS Code for website appearance.
Edit web_server.h for Wi-Fi, data endpoints, button leases and CSV exports.
Edit portable_odor_unit_integrated.ino for sensor, button, display and treatment logic.
Re-upload after changes; no separate HTML upload or web hosting is required.

The web buttons mirror the physical buttons: taps act on release, OK holds
confirm after 3 seconds, plus holds cancel/abort after 6 seconds. During an
active purge, cancellation remains blocked. Physical buttons have priority.
Browser holds expire if renewals stop. Commanded outputs are not measured
feedback from fans/relays. Raw MQ values and BME680 resistance are not ppm.

The most recent 600 readings are stored in a RAM ring buffer; oldest records
are overwritten. Reboot or power loss erases the buffer. Download CSV before
powering off. Timestamps are seconds since boot, not calendar date/time.
Persistent storage such as microSD has not been added.

Original test timings are retained. Keep the real ozone generator disconnected
for sequence testing. The short test purge does not verify ozone clearance.
Validation: JavaScript syntax, mocked dashboard rendering, and native C++
compilation with mocked Arduino/Adafruit/Wi-Fi APIs passed. Simulated full cycle,
remote taps/holds, lost hold lease, abort-to-purge, purge cancellation blocking,
results navigation, return-to-Ready, and CSV ring-buffer checks passed.
Actual ESP32 board compilation, upload, and hardware operation remain unverified. Test Wi-Fi controls, disconnect during a hold,
physical controls, mandatory purge and CSV exports on your hardware.

Integrated with uploaded newtest.ino (October 8, 2026). All pins, test times,
local display screens, scoring, and existing cycle logic are retained.
Completion: OK tap opens Results; hold OK 3 seconds returns to Ready.
The web UI shows pre-treatment averages, actual treatment/cycle duration,
temperature/humidity, and abort status. CSV now includes temperature/humidity.
Remote button requests are serialized; short taps are held long enough for
debouncing. Lost remote ownership cancels pending gestures.
No production-duration mode, cloud storage, or new sensor calibration added.
