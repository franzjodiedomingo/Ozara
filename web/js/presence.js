// js/presence.js — is the ESP32 still alive?
//
// The unit writes a server timestamp (live.ts / status.lastSeen) on every push,
// so the value changes every ~5 s while it is online. This watches for that
// change. Elapsed time is measured only with this browser's own clock, so a
// wrong phone/PC clock can't cause a false "offline".
//
//   "checking": just opened the page, waiting to see whether the value changes
//   "online":   the value changed within staleMs
//   "offline":  no change for staleMs (or no data at all after checkMs)

export function createPresence({ staleMs = 20000, checkMs = 12000 } = {}) {
  const startedAt = Date.now();
  let lastValue;
  let lastChangeAt = 0;
  let seenAny = false;
  let confirmed = false;

  return {
    observe(value) {
      if (value === undefined || value === null) return;
      if (!seenAny) {
        seenAny = true;
        lastValue = value;
        lastChangeAt = Date.now();
        return;
      }
      if (value !== lastValue) {
        lastValue = value;
        lastChangeAt = Date.now();
        confirmed = true;
      }
    },
    state() {
      const now = Date.now();
      if (confirmed) return now - lastChangeAt <= staleMs ? "online" : "offline";
      return now - startedAt < checkMs ? "checking" : "offline";
    }
  };
}
