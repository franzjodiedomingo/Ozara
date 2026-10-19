// functions/index.js
// Cloud Functions act as your "server" in this stack — use them for anything
// that shouldn't run in the browser (privileged writes, cleanup jobs, etc.).
//
// Deploy with: firebase deploy --only functions
// Requires: npm install firebase-functions firebase-admin  (inside /functions)

const { onValueCreated } = require("firebase-functions/v2/database");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

/**
 * Runs automatically whenever the user's Firebase Auth account is created
 * would normally go here via the Auth trigger, but since email/password
 * accounts are provisioned manually for Ozara (no self-signup), this
 * function instead lets an already-authenticated admin create a new
 * teammate's profile record after they're added in the Firebase Console.
 *
 * Call from the frontend with:
 *   const createProfile = httpsCallable(functions, "createUserProfile");
 *   await createProfile({ uid, name, role });
 */
exports.createUserProfile = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const { uid, name, role } = request.data;
  if (!uid || !name) {
    throw new HttpsError("invalid-argument", "uid and name are required.");
  }

  await db.ref(`users/${uid}`).set({
    name,
    role: role || "member",
    createdAt: admin.database.ServerValue.TIMESTAMP
  });

  return { success: true };
});

/**
 * Flags a sensor reading if ozone output looks abnormally high, e.g. for a
 * dashboard alert badge. Runs automatically whenever the ESP32 pushes a new
 * reading to /devices/{deviceId}/readings/{readingId}.
 */
exports.checkOzoneReading = onValueCreated(
  "/devices/{deviceId}/readings/{readingId}",
  async (event) => {
    const reading = event.data.val();
    const OZONE_SAFE_LIMIT_PPM = 0.1; // adjust to your device's calibrated threshold

    if (reading.ozone_ppm > OZONE_SAFE_LIMIT_PPM) {
      await db.ref(`devices/${event.params.deviceId}/alerts`).push({
        message: `Ozone reading ${reading.ozone_ppm} ppm exceeded safe limit`,
        readingId: event.params.readingId,
        timestamp: admin.database.ServerValue.TIMESTAMP
      });
    }
  }
);
