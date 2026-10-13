// ESP32 ozone cabinet - TEST VERSION.
// All automatic stages: 20s. Adjustable total treatment: 60-300s.
// Keep the real ozone generator disconnected for sequence testing.
// Purging cannot be cancelled. Test times do not verify ozone clearance.
#include <Wire.h>
#include "Adafruit_BME680.h"
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
// TEST firmware only; normal-duration firmware and mode-entry keys are deferred.

Adafruit_SH1106G display(128, 64, &Wire, -1);
Adafruit_BME680 bme;
#define MQ136_PIN 34
#define MQ137_PIN 35
#define BTN_START 13
#define BTN_MINUS 14
#define BTN_PLUS 25
#define OZONE_FAN_PIN 26
#define CARBON_FAN_PIN 27
#define SENSOR_FAN_PIN 32
#define OZONE_GEN_PIN 33
#define BUZZER_PIN 23
const bool BUZZER_ACTIVE_HIGH = true;

const char UI_MODE_LABEL[]="TEST";
const unsigned long TEST_PHASE_MS = 20000UL;
const unsigned long WARMUP_MS = TEST_PHASE_MS;
const unsigned long FAN_PRERUN_MS = TEST_PHASE_MS;
const unsigned long SAMPLE_WINDOW_MS = TEST_PHASE_MS;
const unsigned long SOAK_TIME_MS = TEST_PHASE_MS;
const unsigned long PRE_TREATMENT_DELAY_MS = TEST_PHASE_MS;
const unsigned long PURGE_TIME_MS = TEST_PHASE_MS;
const unsigned long SAMPLE_INTERVAL_MS = 3000UL;
const unsigned long SENSOR_TIMEOUT_MS = 2000UL;
const unsigned long LIVE_INTERVAL_MS = 2000UL;
const unsigned long READING_STALE_MS = 6000UL;
unsigned long lastLiveRequestAt = 0, lastReadingAt = 0;
float liveGasKOhm = 0;
int liveMQ136 = 0, liveMQ137 = 0;
bool liveReadingValid = false;
float liveTemperatureC=0, liveHumidityRH=0;
bool detailedView=false, minusViewHandled=false;
unsigned long minusHeldSince=0;
const unsigned long VIEW_HOLD_MS=1000;
const long MIN_TIME_S = 60, MAX_TIME_S = 300, TIME_STEP_S = 30;
const float PULSE_ON_MIN_S = 5, PULSE_ON_MAX_S = 15;
const float PULSE_OFF_MIN_S = 15, PULSE_OFF_MAX_S = 30;
const float BME_MAX_EXPECTED = 10, MQ136_MAX_EXPECTED = 300;
const float MQ137_MAX_EXPECTED = 300;
const float BME_WEIGHT = 0.34, MQ136_WEIGHT = 0.33, MQ137_WEIGHT = 0.33;
const unsigned long DEBOUNCE_MS = 50;
const unsigned long TAP_LIMIT_MS = 750;
const unsigned long HOLD_SCREEN_DELAY_MS = 1000;
const unsigned long CANCEL_HOLD_MS = 6000;
const unsigned long START_CONFIRM_MS = 3000;
const unsigned long DISPLAY_REFRESH_MS = 100;
const unsigned long ANIMATION_STEP_MS = 350;
const unsigned long CONFIRM_SCREEN_MS = 1200;
const unsigned long LIMIT_NOTICE_MS = 1200;
const unsigned long CLICK_MS = 120, SHORT_BEEP_MS = 250;
const unsigned long BEEP_GAP_MS = 120;
const unsigned long FAST_BEEP_MS = 120, FAST_GAP_MS = 120;
const unsigned long READY_BEEP_MS = 80, READY_GAP_MS = 80;
const unsigned long LONG_BEEP_MS = 1000;
const unsigned long BIRTHDAY_REPEAT_PAUSE_MS = 1000;
const unsigned long BIRTHDAY_NOTE_GAP_MS = 100, BIRTHDAY_PHRASE_GAP_MS = 250;
// Active buzzer: fixed-pitch Happy Birthday rhythm, not pitched notes.
const unsigned long BIRTHDAY_LENGTHS[] = {
  120,120,240,240,240,480, 120,120,240,240,240,480,
  120,120,240,240,240,240,480, 120,120,240,240,240,480
};
const unsigned int BIRTHDAY_COUNT = sizeof(BIRTHDAY_LENGTHS) / sizeof(BIRTHDAY_LENGTHS[0]);

enum State {
  WARMUP, IDLE, BASELINE_FAN_PRERUN, BASELINE_SAMPLING,
  WAIT_FOR_CLOTHES, SOAKING, CLOTHES_FAN_PRERUN, CLOTHES_SAMPLING,
  TIME_CHOICE, AUTO_CONFIRM, SUGGEST, START_COUNTDOWN, RUNNING_PULSE, RUNNING_DISPERSE,
  PURGING, DONE, RESULTS, SENSOR_ERROR
};
enum SoundPriority { CLICK_SOUND, EVENT_SOUND, HOLD_SOUND, CONFIRM_SOUND };
enum BirthdayPart { BIRTHDAY_SOUND, BIRTHDAY_GAP, BIRTHDAY_PAUSE };
struct BeepPattern {
  unsigned int count;
  unsigned long onMs, offMs;
  SoundPriority priority;
};
State state = WARMUP;
unsigned long phaseStartTime = 0, ozoneOverallStart = 0, ozonePhaseMs = 0;
long lastCueSecond = -1, selectedTimeS = 60, suggestedTimeS = 60;
long lastStartHoldSecond=-1;
unsigned int resultsPage=0;
bool treatmentBegan=false;
unsigned long actualTreatmentMs=0, finishedCycleMs=0;
float pulseOnS = 10, pulseOffS = 20, combinedScore = 0;
float baseline[3] = {0,0,0}, clothes[3] = {0,0,0}, deltas[3] = {0,0,0};
float sampleSums[3] = {0,0,0};
unsigned int sampleCount = 0;
unsigned long lastSampleTime = 0, sensorStartedAt = 0;
bool sensorReadingPending = false, sensorNeedsReset = false;
State sensorReadingState = IDLE;
const char* sensorErrorText = "Check the BME680";
bool ozoneIsOn = false, completionAlarmAcknowledged = false;
bool cycleAborted = false, readyAnnouncement = false;

const int BUTTON_PINS[3] = {BTN_START, BTN_MINUS, BTN_PLUS};
const char* BUTTON_NAMES[3] = {"OK", "-", "+"};
bool rawButton[3] = {HIGH,HIGH,HIGH}, stableButton[3] = {HIGH,HIGH,HIGH};
bool buttonPress[3] = {false,false,false}, buttonRelease[3] = {false,false,false};
unsigned long changedAt[3] = {0,0,0};
bool plusTracking = false, plusHoldHandled = false, cancelHoldActive = false;
bool cancelIsAbort = false, minusTracking = false, minusSuppressed = false;
State plusTapState = IDLE, minusTapState = IDLE;
unsigned long plusHeldSince = 0;
long lastHoldCue = 0;
bool startTracking = false, startHoldActive = false, startConsumed = false;
State startTapState = IDLE;
unsigned long startHeldSince = 0;
// One section runs until the next required user interaction.
unsigned long sectionStartedAt = 0, sectionDurationMs = WARMUP_MS;
unsigned long abortProgressStartedAt = 0;
bool abortProgress = false;
int abortProgressBase = 0;

const unsigned int SOUND_QUEUE_SIZE = 16;
BeepPattern soundQueue[SOUND_QUEUE_SIZE];
unsigned int queueHead = 0, queueTail = 0, queueCount = 0, beepsLeft = 0;
unsigned long beepOnMs = 0, beepOffMs = 0, buzzerChangedAt = 0;
SoundPriority activePriority = CLICK_SOUND;
bool buzzerIsOn = false, completionReminder = false, birthdayStarted = false;
unsigned int birthdayIndex = 0;
BirthdayPart birthdayPart = BIRTHDAY_SOUND;

bool confirmationVisible = false, limitNoticeVisible = false, displayDirty = true;
unsigned long confirmationStartedAt = 0, limitNoticeStartedAt = 0, lastDisplayAt = 0;
const char* confirmationTitle = "Cancelled";
const char* confirmationDetail = "Returning to Ready";
const char* limitNoticeText = "Minimum time";

const char* stateName(State s) {
  switch (s) {
    case WARMUP: return "WARMUP";
    case IDLE: return "READY";
    case BASELINE_FAN_PRERUN: return "BASELINE_CIRCULATION";
    case BASELINE_SAMPLING: return "BASELINE_SAMPLING";
    case WAIT_FOR_CLOTHES: return "LOAD_CLOTHES";
    case SOAKING: return "ODOR_BUILDUP";
    case CLOTHES_FAN_PRERUN: return "CLOTHES_CIRCULATION";
    case CLOTHES_SAMPLING: return "CLOTHES_SAMPLING";
    case TIME_CHOICE: return "TIME_CHOICE";
    case AUTO_CONFIRM: return "CONFIRM_SUGGESTED";
    case SUGGEST: return "SELECT_MANUAL_TIME";
    case START_COUNTDOWN: return "START_COUNTDOWN";
    case RUNNING_PULSE: return "OZONE_PULSES";
    case RUNNING_DISPERSE: return "AIR_CIRCULATION";
    case PURGING: return "PURGING";
    case DONE: return "COMPLETE";
    case RESULTS: return "RESULTS";
    case SENSOR_ERROR: return "SENSOR_FAULT";
  }
  return "UNKNOWN";
}
void relayOn(int pin) { digitalWrite(pin, LOW); }
void relayOff(int pin) { digitalWrite(pin, HIGH); }
void setBuzzer(bool on) {
  digitalWrite(BUZZER_PIN, on == BUZZER_ACTIVE_HIGH ? HIGH : LOW);
  buzzerIsOn = on;
}
void clearSounds() {
  queueHead = queueTail = queueCount = beepsLeft = 0;
  birthdayStarted = false;
  birthdayIndex = 0;
  activePriority = CLICK_SOUND;
  setBuzzer(false);
  buzzerChangedAt = millis() - BEEP_GAP_MS;
}
void silenceBuzzer() { clearSounds(); completionReminder = false; }
bool soundBusy() { return beepsLeft > 0 || queueCount > 0; }
void queueSound(unsigned int count, unsigned long onMs, unsigned long offMs,
                const char* label, SoundPriority priority = EVENT_SOUND) {
  if (!count || (cancelHoldActive && priority < HOLD_SOUND)) return;
  // Clicks are immediate feedback, never a delayed backlog.
  if (priority == CLICK_SOUND && (soundBusy() || readyAnnouncement)) return;
  if (priority > activePriority && (beepsLeft > 0 || birthdayStarted)) clearSounds();
  if (birthdayStarted) clearSounds();
  if (queueCount == SOUND_QUEUE_SIZE) {
    Serial.println("SOUND: Queue full"); return;
  }
  soundQueue[queueTail] = {count,onMs,offMs,priority};
  queueTail = (queueTail + 1) % SOUND_QUEUE_SIZE;
  queueCount++;
  Serial.print("SOUND: "); Serial.println(label);
}
void buttonClick() { queueSound(1,CLICK_MS,BEEP_GAP_MS,"Button click",CLICK_SOUND); }
void countdownBeep(bool hold = false) {
  queueSound(1,SHORT_BEEP_MS,BEEP_GAP_MS,
             hold ? "Hold countdown" : "3-2-1 countdown",hold ? HOLD_SOUND : EVENT_SOUND);
}
void phaseStarted(const char* label) { queueSound(3,FAST_BEEP_MS,FAST_GAP_MS,label); }
void interactionCue(const char* label) { queueSound(2,FAST_BEEP_MS,FAST_GAP_MS,label); }
void cancelConfirmed() {
  queueSound(5,FAST_BEEP_MS,FAST_GAP_MS,"Cancel/abort confirmed",CONFIRM_SOUND);
}
void updateBuzzer() {
  unsigned long now = millis();
  if (beepsLeft > 0) {
    if (buzzerIsOn && now - buzzerChangedAt >= beepOnMs) {
      setBuzzer(false); beepsLeft--; buzzerChangedAt = now;
    } else if (!buzzerIsOn && now - buzzerChangedAt >= beepOffMs) {
      setBuzzer(true); buzzerChangedAt = now;
    }
    return;
  }
  if (queueCount > 0) {
    if (now - buzzerChangedAt < BEEP_GAP_MS) return;
    BeepPattern next = soundQueue[queueHead];
    queueHead = (queueHead + 1) % SOUND_QUEUE_SIZE; queueCount--;
    beepsLeft = next.count; beepOnMs = next.onMs; beepOffMs = next.offMs;
    activePriority = next.priority;
    setBuzzer(true); buzzerChangedAt = now; return;
  }
  if (completionReminder && !cancelHoldActive) {
    if (!birthdayStarted) {
      if (now - buzzerChangedAt < BEEP_GAP_MS) return;
      birthdayStarted = true; birthdayIndex = 0; birthdayPart = BIRTHDAY_SOUND;
      setBuzzer(true); buzzerChangedAt = now;
    } else if (birthdayPart == BIRTHDAY_SOUND &&
               now - buzzerChangedAt >= BIRTHDAY_LENGTHS[birthdayIndex]) {
      setBuzzer(false); birthdayPart = BIRTHDAY_GAP; buzzerChangedAt = now;
    } else if (birthdayPart == BIRTHDAY_GAP) {
      bool phraseEnd = birthdayIndex == 5 || birthdayIndex == 11 || birthdayIndex == 18 || birthdayIndex == 24;
      unsigned long gap = phraseEnd ? BIRTHDAY_PHRASE_GAP_MS : BIRTHDAY_NOTE_GAP_MS;
      if (now - buzzerChangedAt >= gap) {
        birthdayIndex++; buzzerChangedAt = now;
        if (birthdayIndex >= BIRTHDAY_COUNT) birthdayPart = BIRTHDAY_PAUSE;
        else { birthdayPart = BIRTHDAY_SOUND; setBuzzer(true); }
      }
    } else if (birthdayPart == BIRTHDAY_PAUSE && now - buzzerChangedAt >= BIRTHDAY_REPEAT_PAUSE_MS) {
      birthdayIndex = 0; birthdayPart = BIRTHDAY_SOUND;
      setBuzzer(true); buzzerChangedAt = now;
    }
  }
}
void setGenerator(bool on, bool announce = false) {
  if (on == ozoneIsOn) return;
  if (on) relayOn(OZONE_GEN_PIN); else relayOff(OZONE_GEN_PIN);
  ozoneIsOn = on; displayDirty = true;
  Serial.print("GENERATOR: "); Serial.println(on ? "ON" : "OFF");
  if (announce) queueSound(1,on ? LONG_BEEP_MS : SHORT_BEEP_MS,BEEP_GAP_MS,
                          on ? "Generator ON" : "Generator OFF");
}
void allOutputsOff() {
  setGenerator(false);
  relayOff(OZONE_GEN_PIN); relayOff(OZONE_FAN_PIN);
  relayOff(CARBON_FAN_PIN); relayOff(SENSOR_FAN_PIN);
}
int sectionProgressWidth() {
  unsigned long elapsed = millis() - (abortProgress ? abortProgressStartedAt : sectionStartedAt);
  unsigned long duration = abortProgress ? PURGE_TIME_MS : sectionDurationMs;
  if (elapsed > duration) elapsed = duration;
  int base = abortProgress ? abortProgressBase : 0;
  return base + (duration ? (int)(elapsed * (126UL-base) / duration) : 126-base);
}
void beginSection(unsigned long duration) {
  sectionStartedAt = millis(); sectionDurationMs = duration; abortProgress = false;
}
// Entry actions happen once. Drawing never changes outputs or schedules sounds.
void enterState(State next, bool announce = true) {
  state = next; phaseStartTime = millis(); lastCueSecond = -1;
  startHoldActive = false;
  if (next == WARMUP) beginSection(WARMUP_MS);
  if (next == BASELINE_FAN_PRERUN) beginSection(FAN_PRERUN_MS + SAMPLE_WINDOW_MS);
  if (next == SOAKING) beginSection(SOAK_TIME_MS + FAN_PRERUN_MS + SAMPLE_WINDOW_MS);
  if (next == START_COUNTDOWN) beginSection(PRE_TREATMENT_DELAY_MS + selectedTimeS*1000UL + PURGE_TIME_MS);
  displayDirty = true; limitNoticeVisible = false;
  Serial.print("STATE: "); Serial.println(stateName(next));
  switch (next) {
    case WARMUP: case IDLE: case SENSOR_ERROR: allOutputsOff(); break;
    case BASELINE_FAN_PRERUN: case CLOTHES_FAN_PRERUN:
      relayOn(SENSOR_FAN_PIN);
      if (next == CLOTHES_FAN_PRERUN && announce) interactionCue("Odor buildup complete");
      break;
    case BASELINE_SAMPLING: case CLOTHES_SAMPLING:
      sampleSums[0] = sampleSums[1] = sampleSums[2] = 0;
      sampleCount = 0; lastSampleTime = millis() - SAMPLE_INTERVAL_MS;
      break;
    case WAIT_FOR_CLOTHES: case TIME_CHOICE:
      relayOff(SENSOR_FAN_PIN);
      if (announce) interactionCue("Sampling complete");
      break;
    case START_COUNTDOWN: allOutputsOff(); break;
    case RUNNING_PULSE:
      treatmentBegan=true;
      ozoneOverallStart = millis(); relayOn(OZONE_FAN_PIN);
      setGenerator(true,announce); break;
    case RUNNING_DISPERSE:
      setGenerator(false); // Phase triple replaces the separate OFF cue.
      if (announce) phaseStarted("Air circulation started");
      break;
    case PURGING:
      actualTreatmentMs=treatmentBegan ? millis()-ozoneOverallStart : 0;
      if(actualTreatmentMs>selectedTimeS*1000UL) actualTreatmentMs=selectedTimeS*1000UL;
      setGenerator(false); relayOff(OZONE_FAN_PIN); relayOff(SENSOR_FAN_PIN);
      relayOn(CARBON_FAN_PIN);
      if (announce) phaseStarted("Purging started");
      break;
    case DONE:
      finishedCycleMs=millis()-sectionStartedAt;resultsPage=0;
      allOutputsOff(); completionAlarmAcknowledged = false;
      completionReminder = true; birthdayStarted = false;
      Serial.println("ACTION: Completion alarm started"); break;
    default: break;
  }
}
bool samplingStage(State s) { return s == BASELINE_SAMPLING || s == CLOTHES_SAMPLING; }
bool abortStage(State s) {
  return s == START_COUNTDOWN || s == RUNNING_PULSE || s == RUNNING_DISPERSE;
}
void configureSensor() {
  bme.setTemperatureOversampling(BME680_OS_8X); bme.setHumidityOversampling(BME680_OS_2X);
  bme.setPressureOversampling(BME680_OS_4X); bme.setIIRFilterSize(BME680_FILTER_SIZE_3);
  bme.setGasHeater(320,150);
}
void sensorFault(const char* reason) {
  liveReadingValid = false;
  sensorReadingPending = false; sensorNeedsReset = true; sensorErrorText = reason;
  Serial.print("FAULT: "); Serial.println(reason);
  silenceBuzzer(); enterState(SENSOR_ERROR);
  interactionCue("Sensor fault");
}
void startBaseline() {
  if (sensorNeedsReset) {
    if (!bme.begin(0x76)) { sensorFault("Sensor not found"); return; }
    configureSensor(); sensorNeedsReset = false;
  }
  allOutputsOff(); silenceBuzzer();
  completionAlarmAcknowledged = cycleAborted = false;
  enterState(BASELINE_FAN_PRERUN);
}
void doSampling() {
  if (sensorReadingPending || millis() - lastSampleTime < SAMPLE_INTERVAL_MS) return;
  if (sensorNeedsReset) {sensorFault("Sensor needs retry");return;}
  lastSampleTime = millis();
  if (bme.beginReading() == 0) { sensorFault("Reading did not start"); return; }
  sensorReadingPending = true; sensorReadingState = state; sensorStartedAt = millis();
}
void serviceSensorReading() {
  if (!sensorReadingPending) return;
  int remainingMs = bme.remainingReadingMillis();
  bool owned = state == sensorReadingState && samplingStage(state);
  if (remainingMs > 0) {
    if (millis() - sensorStartedAt >= SENSOR_TIMEOUT_MS) {
      liveReadingValid = false;
      sensorReadingPending = false; sensorNeedsReset = true;
      if (owned) sensorFault("Sensor timed out");
      else Serial.println("FAULT: Old conversion timed out; current phase continues");
    }
    return;
  }
  sensorReadingPending = false;
  if (remainingMs < 0) {
    liveReadingValid=false;
    if (owned) sensorFault("Reading unavailable");
    return;
  }
  bool success = bme.endReading();
  if (!success) {
    liveReadingValid=false;
    if (owned) sensorFault("Sensor read failed");
    return;
  }
  // Cache for the one-line display; only owned samples enter the averages.
  liveGasKOhm=bme.gas_resistance/1000.0f;
  liveTemperatureC=bme.temperature;liveHumidityRH=bme.humidity;
  liveMQ136=analogRead(MQ136_PIN);liveMQ137=analogRead(MQ137_PIN);
  lastReadingAt=millis();liveReadingValid=true;
  if (!owned) return; // Discard from averages after a phase change.

  if (millis() - phaseStartTime >= SAMPLE_WINDOW_MS) return;
  sampleSums[0] += liveGasKOhm;
  sampleSums[1] += liveMQ136;sampleSums[2] += liveMQ137;sampleCount++;
}
// Display-only conversions outside sampling never contribute to scoring.
void updateLiveReadings() {
  if (samplingStage(state) || state==SENSOR_ERROR || sensorNeedsReset ||
      sensorReadingPending || millis()-lastLiveRequestAt<LIVE_INTERVAL_MS) return;
  lastLiveRequestAt=millis();
  if (bme.beginReading()==0) {liveReadingValid=false;return;}
  sensorReadingPending=true;sensorReadingState=state;sensorStartedAt=millis();
}
float mapFloat(float value, float low, float high) {
  return low + constrain(value,0.0f,1.0f) * (high-low);
}
void calculateSuggestion() {
  deltas[0] = baseline[0]-clothes[0]; deltas[1] = clothes[1]-baseline[1]; deltas[2] = clothes[2]-baseline[2];
  for (int i=0;i<3;i++) if (deltas[i]<0) deltas[i]=0;
  combinedScore = BME_WEIGHT * constrain(deltas[0]/BME_MAX_EXPECTED,0.0f,1.0f)
    + MQ136_WEIGHT * constrain(deltas[1]/MQ136_MAX_EXPECTED,0.0f,1.0f)
    + MQ137_WEIGHT * constrain(deltas[2]/MQ137_MAX_EXPECTED,0.0f,1.0f);
  suggestedTimeS = MIN_TIME_S + (long)(combinedScore * (MAX_TIME_S-MIN_TIME_S));
  selectedTimeS = suggestedTimeS;
}
long remainingSeconds(unsigned long duration, unsigned long start) {
  unsigned long elapsed = millis()-start;
  return elapsed >= duration ? 0 : (duration-elapsed+999UL)/1000UL;
}
void final321(long left) {
  if (left == lastCueSecond) return;
  lastCueSecond = left;
  if (left >= 1 && left <= 3) countdownBeep();
}
void adjustTime(int direction) {
  long proposed = direction > 0
    ? (selectedTimeS/TIME_STEP_S + 1)*TIME_STEP_S
    : ((selectedTimeS-1)/TIME_STEP_S)*TIME_STEP_S;
  // Treat the recommendation as an extra stop within either 30s step.
  if (direction > 0 && selectedTimeS < suggestedTimeS && proposed >= suggestedTimeS)
    proposed = suggestedTimeS;
  if (direction < 0 && selectedTimeS > suggestedTimeS && proposed <= suggestedTimeS)
    proposed = suggestedTimeS;
  if (proposed < MIN_TIME_S || proposed > MAX_TIME_S) {
    limitNoticeText = direction < 0 ? "Minimum time" : "Maximum time";
    limitNoticeVisible = true; limitNoticeStartedAt = millis();
  }
  selectedTimeS = constrain(proposed,MIN_TIME_S,MAX_TIME_S); displayDirty = true;
  Serial.print("TIME: Selected seconds = "); Serial.println(selectedTimeS);
}
void rejectPurgeCancel() {
  if (cancelHoldActive) clearSounds();
  cancelHoldActive = false; plusTracking = false;
  plusHoldHandled = stableButton[2] == LOW;
  minusTracking = false;
  confirmationTitle = "Purge cannot stop";
  confirmationDetail = "Purging continues...";
  confirmationVisible = true; confirmationStartedAt = millis(); displayDirty = true;
  Serial.println("ACTION: Cancel blocked; purge continues");
}
void confirmCancel() {
  // Defensive guard: no caller can cancel, restart, or skip an active purge.
  if (state == PURGING) { rejectPurgeCancel(); return; }
  cancelHoldActive = false; startHoldActive = false; startTracking = false;
  silenceBuzzer();
  if (cancelIsAbort) {
    cycleAborted = true;
    if (state != DONE) {
      abortProgressBase = sectionProgressWidth();
      abortProgressStartedAt = millis(); abortProgress = true;
      enterState(PURGING,false);
      confirmationTitle = "Aborted"; confirmationDetail = "Purging now";
      Serial.println("ACTION: Abort; purging started");
    } else {
      confirmationTitle = "Cycle ended"; confirmationDetail = "Purge timer finished";
    }
  } else {
    sampleCount = 0;
    for (int i=0;i<3;i++) sampleSums[i]=baseline[i]=clothes[i]=deltas[i]=0;
    combinedScore = 0; selectedTimeS = suggestedTimeS = MIN_TIME_S;
    completionAlarmAcknowledged = cycleAborted = false;
    enterState(IDLE,false);
    confirmationTitle = "Cancelled"; confirmationDetail = "Returning to Ready";
    Serial.println("ACTION: Cancel; returning to Ready");
  }
  confirmationVisible = true; confirmationStartedAt = millis(); displayDirty = true;
  cancelConfirmed();
}
// Website buttons feed the same debounced controller as physical buttons.
extern int webButtonIndex;
bool physicalButtonActive();
void expireWebButton();
void updateButtons() {
  unsigned long now=millis();
  for (int i=0;i<3;i++) {
    buttonPress[i]=buttonRelease[i]=false;
    bool reading=digitalRead(BUTTON_PINS[i]);
    if (webButtonIndex == i && !physicalButtonActive()) reading=LOW;
    if (reading!=rawButton[i]) {rawButton[i]=reading;changedAt[i]=now;}
    if (now-changedAt[i]>=DEBOUNCE_MS && reading!=stableButton[i]) {
      stableButton[i]=reading;buttonPress[i]=reading==LOW;buttonRelease[i]=reading==HIGH;
      Serial.print("BUTTON: ");Serial.print(BUTTON_NAMES[i]);Serial.println(reading==LOW ? " pressed" : " released");
    }
  }
}
void beginCountdown() {
  ozonePhaseMs = (selectedTimeS/2)*1000UL;
  pulseOnS = mapFloat(combinedScore,PULSE_ON_MIN_S,PULSE_ON_MAX_S);
  pulseOffS = mapFloat(combinedScore,PULSE_OFF_MAX_S,PULSE_OFF_MIN_S);
  treatmentBegan=false;actualTreatmentMs=finishedCycleMs=0;
  silenceBuzzer(); enterState(START_COUNTDOWN); buttonClick();
}
// Return to the first user step without restarting the ESP32.
void returnToReady() {
  allOutputsOff();silenceBuzzer();
  for(int i=0;i<3;i++) sampleSums[i]=baseline[i]=clothes[i]=deltas[i]=0;
  sampleCount=0;combinedScore=0;selectedTimeS=suggestedTimeS=MIN_TIME_S;
  completionAlarmAcknowledged=cycleAborted=readyAnnouncement=false;
  detailedView=false;resultsPage=0;treatmentBegan=false;
  actualTreatmentMs=finishedCycleMs=0;
  enterState(IDLE,false);Serial.println("ACTION: Ready for new cycle");
}
// Ordinary taps act on release. Confirmation acts after a continuous 3s hold.
void handleButtons() {
  unsigned long now=millis();
  if (stableButton[0] == HIGH && startConsumed) {
    startConsumed = false; startTracking = false; startHoldActive = false;
  }
  if (startHoldActive && (buttonPress[1] || buttonPress[2])) {
    clearSounds();startHoldActive = false; startTracking = false; startConsumed = true; displayDirty = true;
  }
  if (state == PURGING && (buttonPress[2] || plusTracking)) {
    rejectPurgeCancel(); return;
  }
  if (readyAnnouncement || confirmationVisible) {
    if (stableButton[2]==HIGH) { plusTracking=false;plusHoldHandled=false; }
    minusTracking=false; startTracking=false; startHoldActive=false;
    if (stableButton[0] == LOW) startConsumed=true;
    return;
  }
  if (plusHoldHandled) {
    // No other button can act until PLUS is released after confirmation.
    if (stableButton[2]==HIGH) {plusTracking=false;plusHoldHandled=false;}
    minusTracking=false; return;
  }
  if (buttonPress[2] && state!=WARMUP && state!=DONE && state!=RESULTS) {
    plusTracking=true;plusHeldSince=now;lastHoldCue=0;plusTapState=state;
    cancelIsAbort=abortStage(state);
    minusTracking=false;minusSuppressed=stableButton[1]==LOW;
  }
  if (plusTracking) {
    if (abortStage(state)) cancelIsAbort=true;
    unsigned long held=now-plusHeldSince;
    if (buttonRelease[2]) {
      bool tap=held<TAP_LIMIT_MS;
      if (cancelHoldActive) {clearSounds();displayDirty=true;}
      cancelHoldActive=false;plusTracking=false;
      if (tap) {
        if (state==SUGGEST && plusTapState==SUGGEST) adjustTime(1);
        buttonClick();
      }
      return;
    }
    if (held>=HOLD_SCREEN_DELAY_MS && !cancelHoldActive) {
      clearSounds();cancelHoldActive=true;displayDirty=true;
    }
    long elapsed=held/1000UL;
    if (elapsed>=1 && elapsed<=5 && elapsed!=lastHoldCue) {
      lastHoldCue=elapsed;countdownBeep(true);displayDirty=true;
    }
    if (held>=CANCEL_HOLD_MS) {plusHoldHandled=true;confirmCancel();}
    return;
  }
  if(minusTracking && stableButton[1]==LOW && !minusSuppressed &&
     !minusViewHandled && state==minusTapState && now-minusHeldSince>=VIEW_HOLD_MS) {
    if(state==RESULTS) resultsPage=(resultsPage+1)%2;
    else if(state!=DONE) detailedView=!detailedView;
    minusViewHandled=true;displayDirty=true;buttonClick();
    Serial.println(detailedView ? "VIEW: Detailed" : "VIEW: Main");
  }
  if(buttonRelease[1] && minusViewHandled) {
    minusViewHandled=false;minusTracking=false;
  }
  if (buttonRelease[1] && minusSuppressed) {minusSuppressed=false;minusTracking=false;}
  else if (buttonRelease[1] && minusTracking) {
    minusTracking=false;
    if (state==SUGGEST && minusTapState==SUGGEST) adjustTime(-1);
    else if (state==TIME_CHOICE && minusTapState==TIME_CHOICE) {
      selectedTimeS=suggestedTimeS; enterState(SUGGEST,false);
    } else if (state==AUTO_CONFIRM && minusTapState==AUTO_CONFIRM) {
      enterState(TIME_CHOICE,false);
    }
    else if(state==RESULTS && minusTapState==RESULTS) {resultsPage=(resultsPage+1)%2;displayDirty=true;}
    else if(state!=DONE && state==minusTapState) {
      detailedView=!detailedView;displayDirty=true;
      Serial.println(detailedView ? "VIEW: Detailed" : "VIEW: Main");
    }
    buttonClick();
  }
  if (buttonPress[1] && !minusSuppressed) {
    minusTracking=true;minusTapState=state;minusHeldSince=now;minusViewHandled=false;
  }
  if (buttonPress[2] && (state==DONE || state==RESULTS || state==WARMUP)) buttonClick();
  if (startConsumed) return;
  if (buttonPress[0]) {
    startTracking=true; startTapState=state; startHeldSince=now;
    if (state==SUGGEST || state==AUTO_CONFIRM || state==RESULTS) {
      startHoldActive=true;displayDirty=true;
      clearSounds();lastStartHoldSecond=3;countdownBeep(true);
    }
  }
  if (startHoldActive) {
    if (buttonRelease[0]) {
      clearSounds();startHoldActive=false; startTracking=false; displayDirty=true; return;
    }
    long holdLeft=remainingSeconds(START_CONFIRM_MS,startHeldSince);
    if(holdLeft>=1 && holdLeft<=3 && holdLeft!=lastStartHoldSecond) {
      lastStartHoldSecond=holdLeft;countdownBeep(true);displayDirty=true;
    }
    if (now-startHeldSince>=START_CONFIRM_MS) {
      startHoldActive=false; startTracking=false; startConsumed=true;
      if(state==RESULTS) returnToReady();else beginCountdown();
    }
    return;
  }
  if (!buttonRelease[0] || !startTracking) return;
  startTracking=false;
  if (state!=startTapState) return;
  if (state==IDLE || state==SENSOR_ERROR) {startBaseline();buttonClick();}
  else if (state==WAIT_FOR_CLOTHES) {enterState(SOAKING);buttonClick();}
  else if (state==TIME_CHOICE) {
    selectedTimeS=suggestedTimeS; enterState(AUTO_CONFIRM,false); buttonClick();
  } else if (state==DONE) {
    silenceBuzzer();completionAlarmAcknowledged=true;resultsPage=0;
    enterState(RESULTS,false);buttonClick();
    Serial.println("ACTION: Completion confirmed; results opened");
  } else buttonClick();
}
void updateCycle() {
  unsigned long now=millis(), elapsed=now-phaseStartTime;
  switch (state) {
    case WARMUP:
      if (elapsed>=WARMUP_MS) {
        enterState(IDLE);readyAnnouncement=true;
        queueSound(1,SHORT_BEEP_MS,BEEP_GAP_MS,"Warm-up complete");
        queueSound(3,READY_BEEP_MS,READY_GAP_MS,"Ready announcement");
      }
      break;
    case BASELINE_FAN_PRERUN: case CLOTHES_FAN_PRERUN:
      if (elapsed>=FAN_PRERUN_MS) enterState(state==BASELINE_FAN_PRERUN ? BASELINE_SAMPLING : CLOTHES_SAMPLING);
      break;
    case BASELINE_SAMPLING: case CLOTHES_SAMPLING:
      final321(remainingSeconds(SAMPLE_WINDOW_MS,phaseStartTime));
      if (elapsed>=SAMPLE_WINDOW_MS) {
        if (!sampleCount) {sensorFault("No valid samples");break;}
        bool isBaseline=state==BASELINE_SAMPLING;
        for(int i=0;i<3;i++) {
          if(isBaseline) baseline[i]=sampleSums[i]/sampleCount;
          else clothes[i]=sampleSums[i]/sampleCount;
        }
        if(isBaseline) enterState(WAIT_FOR_CLOTHES);
        else {calculateSuggestion();enterState(TIME_CHOICE);}
      } else doSampling();
      break;
    case SOAKING:
      final321(remainingSeconds(SOAK_TIME_MS,phaseStartTime));
      if(elapsed>=SOAK_TIME_MS) enterState(CLOTHES_FAN_PRERUN);
      break;
    case START_COUNTDOWN:
      final321(remainingSeconds(PRE_TREATMENT_DELAY_MS,phaseStartTime));
      if(elapsed>=PRE_TREATMENT_DELAY_MS) enterState(RUNNING_PULSE);
      break;
    case RUNNING_PULSE: {
      unsigned long overall=now-ozoneOverallStart;
      if(overall>=ozonePhaseMs) {enterState(RUNNING_DISPERSE);break;}
      unsigned long period=(unsigned long)((pulseOnS+pulseOffS)*1000);
      setGenerator(overall%period < (unsigned long)(pulseOnS*1000),true);
      break;
    }
    case RUNNING_DISPERSE: {
      long left=remainingSeconds(selectedTimeS*1000UL,ozoneOverallStart);
      if (left!=lastCueSecond) {
        lastCueSecond=left;
        if (left==15 || left==13 || left==11)
          queueSound(1,LONG_BEEP_MS,BEEP_GAP_MS,"Treatment interval cue");
        else if (left>=1 && left<=3) countdownBeep();
      }
      if(now-ozoneOverallStart>=selectedTimeS*1000UL) enterState(PURGING);
      break;
    }
    case PURGING: {
      long left=remainingSeconds(PURGE_TIME_MS,phaseStartTime);
      if(left!=lastCueSecond) {
        lastCueSecond=left;
        if(left>=1 && left<=3) countdownBeep();
      }
      if(elapsed>=PURGE_TIME_MS) enterState(DONE);
      break;
    }
    default: break;
  }
}
void printTime(long seconds, bool clockFormat=true) {
  if (!clockFormat) {display.print(seconds);display.print("s");return;}
  char text[32];snprintf(text,sizeof(text),"%02ld:%02ld",seconds/60,seconds%60);display.print(text);
}
void animatedTitle(const char* title) {
  display.print(title);
  unsigned int dots=(millis()/ANIMATION_STEP_MS)%3+1;
  for(unsigned int i=0;i<dots;i++) display.print(".");
}
// One sensor row: B = BME680 gas resistance (kOhm),
// S = MQ136 raw ADC, A = MQ137 raw ADC. These are not ppm readings.
bool readingsFresh() {
  return liveReadingValid && millis()-lastReadingAt<=READING_STALE_MS;
}
// Tiny outlined labels keep all three readings on one row.
void drawBadge(int x,int y,const char* label) {
  int width=6*strlen(label)+6;
  display.drawRoundRect(x,y-1,width,9,2,SH110X_WHITE);
  display.setCursor(x+3,y);display.print(label);
}
void drawSensorLine() {
  display.setTextSize(1);
  drawBadge(0,45,"B");drawBadge(44,45,"S");drawBadge(86,45,"A");
  display.setCursor(13,45);
  if(readingsFresh()) {
    display.print((long)constrain(liveGasKOhm,0.0f,9999.0f));display.print("k");
  } else display.print("--");
  display.setCursor(57,45);
  if(readingsFresh()) display.print(constrain(liveMQ136,0,4095));else display.print("--");
  display.setCursor(99,45);
  if(readingsFresh()) display.print(constrain(liveMQ137,0,4095));else display.print("--");
}
void drawProgress(int percent) {
  percent=constrain(percent,0,100);
  display.drawRect(0,59,96,5,SH110X_WHITE);
  int width=percent*94/100;
  if(width>0) display.fillRect(1,60,width,3,SH110X_WHITE);
  char text[5];snprintf(text,sizeof(text),"%d%%",percent);
  display.setCursor(128-6*(int)strlen(text),56);display.print(text);
}
void progressBar(unsigned long duration, unsigned long start) {
  unsigned long elapsed=millis()-start;
  if(elapsed>duration) elapsed=duration;
  drawProgress(duration ? (int)(elapsed*100UL/duration) : 100);
}
void screenTitle(const char* title) {
  display.setTextSize(1);display.setCursor(0,0);display.print(title);
  display.setCursor(104,0);display.print(UI_MODE_LABEL);
}
void screenTime(long seconds, bool clockFormat=true) {
  display.setTextSize(2);display.setCursor(0,13);printTime(seconds,clockFormat);
  display.setTextSize(1);
}
void screenStatus(const char* text) {
  display.setCursor(0,32);display.print(text);
}
void screenAction(const char* text) {
  if(strncmp(text,"OK: ",4)==0) {
    drawBadge(0,56,"OK");display.setCursor(24,56);display.print(text+4);
  } else {display.setCursor(0,56);display.print(text);}
}
void drawTimer(const char* title, unsigned long duration, unsigned long start,
               const char* detail, bool total=false) {
  screenTitle(title);screenTime(remainingSeconds(duration,start),total);
  screenStatus(detail);
  drawProgress((sectionProgressWidth()*100+63)/126);
}
const char* panelPhase() {
  switch(state) {
    case WARMUP:return "Warmup";
    case IDLE:return "Ready";
    case BASELINE_FAN_PRERUN:case BASELINE_SAMPLING:return "Baseline";
    case WAIT_FOR_CLOTHES:return "Load clothes";
    case SOAKING:case CLOTHES_FAN_PRERUN:case CLOTHES_SAMPLING:return "Clothes check";
    case TIME_CHOICE:case AUTO_CONFIRM:case SUGGEST:return "Set time";
    case START_COUNTDOWN:return "Countdown";
    case RUNNING_PULSE:return "Ozone treatment";
    case RUNNING_DISPERSE:return "Circulation";
    case PURGING:return "Purging";
    case DONE:return "Complete";
    case RESULTS:return "Results";
    default:return "Sensor fault";
  }
}
long panelTimeLeft() {
  switch(state) {
    case WARMUP:return remainingSeconds(WARMUP_MS,phaseStartTime);
    case BASELINE_FAN_PRERUN:case CLOTHES_FAN_PRERUN:
      return remainingSeconds(FAN_PRERUN_MS,phaseStartTime);
    case BASELINE_SAMPLING:case CLOTHES_SAMPLING:
      return remainingSeconds(SAMPLE_WINDOW_MS,phaseStartTime);
    case SOAKING:return remainingSeconds(SOAK_TIME_MS,phaseStartTime);
    case START_COUNTDOWN:return remainingSeconds(PRE_TREATMENT_DELAY_MS,phaseStartTime);
    case RUNNING_PULSE:case RUNNING_DISPERSE:
      return remainingSeconds(selectedTimeS*1000UL,ozoneOverallStart);
    case PURGING:return remainingSeconds(PURGE_TIME_MS,phaseStartTime);
    case DONE:return 0;
    default:return -1;
  }
}
void drawDetailedView() {
  screenTitle(panelPhase());
  char line[24];bool fresh=readingsFresh();
  display.setCursor(0,12);
  if(fresh) {snprintf(line,sizeof(line),"BME: %.1fkOhm",liveGasKOhm);display.print(line);}
  else display.print("BME: --");
  display.setCursor(0,24);display.print("MQ136: ");
  if(fresh) display.print(liveMQ136);else display.print("--");display.print(" ADC");
  display.setCursor(0,36);display.print("MQ137: ");
  if(fresh) display.print(liveMQ137);else display.print("--");display.print(" ADC");
  display.setCursor(0,46);
  if(fresh) {
    snprintf(line,sizeof(line),"T:%.1fC RH:%.0f%%",liveTemperatureC,liveHumidityRH);
    display.print(line);
  } else display.print("Readings unavailable");
  long left=panelTimeLeft();
  if(state==DONE) {
    screenAction(completionAlarmAcknowledged ? "OK: New cycle" : "OK: Confirm");
  } else if(state==SENSOR_ERROR) {
    screenAction("OK: Retry");
  } else if(left>=0) {
    display.drawRect(0,59,90,5,SH110X_WHITE);
    int width=sectionProgressWidth()*88/126;
    if(width>0) display.fillRect(1,60,width,3,SH110X_WHITE);
    display.setCursor(98,56);printTime(left);
  } else {
    display.setCursor(0,56);display.print("Waiting");
    display.setCursor(98,56);display.print("--:--");
  }
}
void drawCompletion() {
  screenTitle("Cycle finished");
  // A large check draws in two stages, then a small pulse marks completion.
  unsigned long elapsed=millis()-phaseStartTime;
  display.drawCircle(64,26,14,SH110X_WHITE);
  display.drawLine(55,26,61,32,SH110X_WHITE);
  display.drawLine(55,27,61,33,SH110X_WHITE);
  if(elapsed>=250) {
    display.drawLine(61,32,74,19,SH110X_WHITE);
    display.drawLine(61,33,74,20,SH110X_WHITE);
  }
  if(elapsed>=500 && (elapsed/700)%2==0) display.drawCircle(64,26,16,SH110X_WHITE);
  display.setCursor(22,45);display.print("Purge complete");
  screenAction("OK: View results");
}
void drawCircularHold() {
  screenTitle("Return to Ready");
  unsigned long held=millis()-startHeldSince;
  if(held>START_CONFIRM_MS) held=START_CONFIRM_MS;
  const int cx=64,cy=29,r=17;
  display.drawCircle(cx,cy,r,SH110X_WHITE);
  // Dot segments fill clockwise from twelve o'clock; no blocking animation.
  int segments=held*36UL/START_CONFIRM_MS;
  for(int i=0;i<segments;i++) {
    float a=(-90.0f+i*10.0f)*3.14159265f/180.0f;
    display.fillCircle(cx+(int)lroundf(14*cosf(a)),cy+(int)lroundf(14*sinf(a)),1,SH110X_WHITE);
  }
  display.setTextSize(2);display.setCursor(59,22);
  display.print(remainingSeconds(START_CONFIRM_MS,startHeldSince));
  display.setTextSize(1);display.setCursor(0,55);display.print("Release OK to cancel");
}
void drawResultValue(int x,int y,float value,bool gas) {
  char text[12];
  if(gas && value>=9999.95f) snprintf(text,sizeof(text),">9999");
  else if(gas) snprintf(text,sizeof(text),"%.1f",value);
  else snprintf(text,sizeof(text),"%.0f",value);
  display.setCursor(x,y);display.print(text);
}
void drawResults() {
  screenTitle(resultsPage==0 ? "Results 1/2" : "Results 2/2");
  if(resultsPage==0) {
    // Both rows are PRE-treatment samples, not an odor-removal measurement.
    display.setCursor(0,11);display.print("Pre");
    display.setCursor(30,11);display.print("B(k)");
    display.setCursor(70,11);display.print("S");
    display.setCursor(102,11);display.print("A");
    display.setCursor(0,22);display.print("Base");
    display.setCursor(0,33);display.print("Clth");
    for(int i=0;i<3;i++) {
      int x=i==0 ? 30 : i==1 ? 70 : 102;
      drawResultValue(x,22,baseline[i],i==0);drawResultValue(x,33,clothes[i],i==0);
    }
    char text[24];snprintf(text,sizeof(text),"Score %.0f%%  -: Next",combinedScore*100);
    display.setCursor(0,45);display.print(text);
  } else {
    display.setCursor(0,12);display.print("Planned: ");printTime(selectedTimeS);
    display.setCursor(0,23);display.print("Actual:  ");printTime(actualTreatmentMs/1000UL);
    display.setCursor(0,34);display.print("Cycle:   ");printTime(finishedCycleMs/1000UL);
    display.setCursor(0,45);display.print(cycleAborted ? "Aborted; -: Previous" : "Complete; -: Previous");
  }
  screenAction("OK: Hold 3s to Ready");
}
// Single rendering path; compact badges and exclusive hold/confirmation overlays.
void renderDisplay() {
  unsigned long now=millis();
  if(!displayDirty && now-lastDisplayAt<DISPLAY_REFRESH_MS) return;
  displayDirty=false;lastDisplayAt=now;
  display.clearDisplay();display.setTextSize(1);display.setTextWrap(false);
  if(cancelHoldActive) {
    screenTitle("");display.setCursor(0,0);animatedTitle(cancelIsAbort ? "Aborting" : "Cancelling");
    screenTime(remainingSeconds(CANCEL_HOLD_MS,plusHeldSince),false);
    screenStatus("Release + to resume");
    progressBar(CANCEL_HOLD_MS-HOLD_SCREEN_DELAY_MS,plusHeldSince+HOLD_SCREEN_DELAY_MS);
  } else if(startHoldActive && state==RESULTS) {
    drawCircularHold();
  } else if(startHoldActive) {
    screenTitle("");display.setCursor(0,0);animatedTitle("Confirm start");
    screenTime(remainingSeconds(START_CONFIRM_MS,startHeldSince),false);
    screenStatus("Hold OK to confirm");
    progressBar(START_CONFIRM_MS,startHeldSince);
  } else if(confirmationVisible) {
    screenTitle(confirmationTitle);
    display.setCursor(0,15);display.print(confirmationDetail);
    screenStatus("Release +");
  } else if(state==DONE) {
    drawCompletion();
  } else if(state==RESULTS) {
    drawResults();
  } else if(detailedView) {
    drawDetailedView();
  } else {
    switch(state) {
      case WARMUP:
        drawTimer("Sensor warmup",WARMUP_MS,phaseStartTime,"Please wait...");break;
      case IDLE:
        screenTitle("Ready");
        display.setCursor(0,16);display.print("Empty; close the door");
        screenAction(readyAnnouncement ? "Getting ready..." : "OK: Sample air");break;
      case BASELINE_FAN_PRERUN:
        drawTimer("Baseline air",FAN_PRERUN_MS,phaseStartTime,"Empty cabinet");break;
      case CLOTHES_FAN_PRERUN:
        drawTimer("Clothes air",FAN_PRERUN_MS,phaseStartTime,"Clothes loaded");break;
      case BASELINE_SAMPLING: case CLOTHES_SAMPLING:
        drawTimer(state==BASELINE_SAMPLING ? "Baseline sample" : "Clothes sample",
                  SAMPLE_WINDOW_MS,phaseStartTime,"Reading...");break;
      case WAIT_FOR_CLOTHES:
        screenTitle("Load clothes");
        display.setCursor(0,16);display.print("Close door to proceed");
        screenAction("OK: Continue");break;
      case SOAKING:
        drawTimer("Odor buildup",SOAK_TIME_MS,phaseStartTime,"Odor collecting...");break;
      case TIME_CHOICE:
        screenTitle("Choose duration");screenTime(suggestedTimeS);
        drawBadge(0,32,"OK");display.setCursor(24,32);display.print("Use");
        drawBadge(60,32,"-");display.setCursor(76,32);display.print("Manual");break;
      case AUTO_CONFIRM:
        screenTitle("Suggested time");screenTime(selectedTimeS);
        drawBadge(0,32,"OK");display.setCursor(24,32);display.print("Hold 3s");
        drawBadge(74,32,"-");display.setCursor(90,32);display.print("Back");break;
      case SUGGEST:
        screenTitle(limitNoticeVisible ? limitNoticeText : "Manual duration");
        screenTime(selectedTimeS);
        if(selectedTimeS==suggestedTimeS) {
          display.setCursor(74,19);display.print("Suggested");
        } else {
          display.setCursor(74,13);display.print("Rec");
          display.setCursor(74,23);printTime(suggestedTimeS);
        }
        drawBadge(0,32,"-");drawBadge(16,32,"+");
        display.setCursor(32,32);display.print("Set");
        drawBadge(56,32,"OK");display.setCursor(80,32);display.print("Hold 3s");break;
      case START_COUNTDOWN:
        drawTimer("Start countdown",PRE_TREATMENT_DELAY_MS,phaseStartTime,"Hold + 6s: Abort");break;
      case RUNNING_PULSE:
        drawTimer("Ozone treatment",selectedTimeS*1000UL,ozoneOverallStart,
                  ozoneIsOn ? "Generator ON" : "Generator OFF",true);break;
      case RUNNING_DISPERSE:
        drawTimer("Air circulation",selectedTimeS*1000UL,ozoneOverallStart,"Generator OFF",true);break;
      case PURGING:
        drawTimer("Purging",PURGE_TIME_MS,phaseStartTime,"Cannot cancel purge");break;
      case DONE: case RESULTS: break; // Drawn above the normal panels.
      case SENSOR_ERROR:
        screenTitle("Sensor fault");
        display.setCursor(0,15);display.print(sensorErrorText);
        screenStatus("Check sensor wiring");screenAction("OK: Retry");break;
    }
  }
  if(state!=DONE && state!=RESULTS &&
     (!detailedView || cancelHoldActive || startHoldActive || confirmationVisible)) drawSensorLine();
  display.display();
}
#include "web_server.h"
#include "firebase_sync.h"

void setup() {
  Serial.begin(115200);
  Serial.println("MODE: TEST - automatic stages are 20 seconds");
  for(int i=0;i<3;i++) pinMode(BUTTON_PINS[i],INPUT_PULLUP);
  const int outputs[4]={OZONE_FAN_PIN,CARBON_FAN_PIN,SENSOR_FAN_PIN,OZONE_GEN_PIN};
  for(int i=0;i<4;i++) {digitalWrite(outputs[i],HIGH);pinMode(outputs[i],OUTPUT);}
  digitalWrite(BUZZER_PIN,BUZZER_ACTIVE_HIGH ? LOW : HIGH);pinMode(BUZZER_PIN,OUTPUT);
  allOutputsOff();silenceBuzzer();Wire.begin();
  if(!display.begin(0x3C,true)) {Serial.println("FAULT: OLED not found");while(1);}
  display.setTextColor(SH110X_WHITE);
  startWebsite();
  if(!bme.begin(0x76)) {sensorFault("Sensor not found");renderDisplay();return;}
  configureSensor();enterState(WARMUP);
}
void loop() {
  expireWebButton();
  updateBuzzer();updateButtons();
  unsigned long now=millis();
  if(confirmationVisible && now-confirmationStartedAt>=CONFIRM_SCREEN_MS) {
    confirmationVisible=false;displayDirty=true;
  }
  if(limitNoticeVisible && now-limitNoticeStartedAt>=LIMIT_NOTICE_MS) {
    limitNoticeVisible=false;displayDirty=true;
  }
  if(readyAnnouncement && !soundBusy()) {readyAnnouncement=false;displayDirty=true;}
  handleButtons();serviceSensorReading();updateCycle();updateLiveReadings();updateBuzzer();
  renderDisplay();updateBuzzer();
  recordReading();
  if(webStarted) webServer.handleClient();
  if(webStarted) pushToFirebase();
  expireWebButton();
}