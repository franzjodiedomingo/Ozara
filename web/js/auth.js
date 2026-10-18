// js/auth.js
// Sign in / create account / Google sign-in for login.html (Firebase Authentication).

import { auth } from "../firebase-config.js";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const googleProvider = new GoogleAuthProvider();

const form = document.getElementById("loginForm");
const errorBox = document.getElementById("formError");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmField = document.getElementById("confirmField");
const confirmInput = document.getElementById("confirmPassword");
const pwHint = document.getElementById("pwHint");
const rememberBox = document.getElementById("remember");
const forgotLink = document.getElementById("forgotLink");
const googleBtn = document.getElementById("googleBtn");
const submitBtn = document.getElementById("submitBtn");
const submitBtnText = document.getElementById("submitBtnText");
const switchLink = document.getElementById("switchLink");
const switchPrompt = document.getElementById("switchPrompt");
const formTitle = document.getElementById("formTitle");
const formSub = document.getElementById("formSub");
const togglePw = document.getElementById("togglePw");
const toggleConfirmPw = document.getElementById("toggleConfirmPw");

let mode = "signin"; // "signin" | "signup"

function showMessage(message, ok = false) {
  errorBox.textContent = message;
  errorBox.classList.toggle("ok", ok);
  errorBox.classList.add("show");
}

function clearMessage() {
  errorBox.classList.remove("show", "ok");
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  googleBtn.disabled = busy;
  if (submitBtnText) {
    if (busy) {
      submitBtnText.dataset.origText = submitBtnText.textContent;
      submitBtnText.textContent = mode === "signup" ? "Creating account..." : "Signing in...";
    } else if (submitBtnText.dataset.origText) {
      submitBtnText.textContent = submitBtnText.dataset.origText;
    }
  }
}

// Runs an auth action. By default goes to the dashboard after; pass
// redirect: false when the caller handles what happens next itself
// (used by account creation, which signs the user back out instead).
async function run(action, { redirect = true } = {}) {
  setBusy(true);
  try {
    await action();
    if (redirect) window.location.href = "home.html";
  } catch (err) {
    showMessage(friendlyError(err.code));
  } finally {
    setBusy(false);
  }
}

function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  formTitle.textContent = signup ? "Create account" : "Welcome back!";
  formSub.textContent = signup ? "Sign up for your Ozara account" : "Sign in to your Ozara account";
  
  if (submitBtnText) {
    submitBtnText.textContent = signup ? "Create account" : "Sign in";
  } else {
    submitBtn.textContent = signup ? "Create account" : "Sign in";
  }
  
  switchPrompt.textContent = signup ? "Already have an account?" : "Don't have an account?";
  switchLink.textContent = signup ? "Sign in" : "Create one";
  forgotLink.style.display = signup ? "none" : "";
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  confirmField.hidden = !signup;
  confirmInput.required = signup;
  pwHint.hidden = !signup;
  if (!signup) {
    confirmInput.value = "";
    pwHint.classList.remove("warn");
  }
  document.title = signup ? "Ozara — Create account" : "Ozara — Sign in";
  clearMessage();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  clearMessage();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage("Enter your email and password.");
    return;
  }

  if (mode === "signup") {
    const confirm = confirmInput.value;
    const strengthError = checkPasswordStrength(password);
    if (strengthError) {
      pwHint.classList.add("warn");
      showMessage(strengthError);
      return;
    }
    pwHint.classList.remove("warn");
    if (password !== confirm) {
      showMessage("Passwords don't match.");
      return;
    }
    // Create the account, then sign straight back out and drop the user
    // into the Sign in form. Making them log in again with the password
    // they just chose confirms the account really was created.
    run(
      async () => {
        await createUserWithEmailAndPassword(auth, email, password);
        await signOut(auth);
      },
      { redirect: false }
    ).then(() => {
      if (!errorBox.classList.contains("show")) {
        setMode("signin");
        emailInput.value = email;
        passwordInput.value = "";
        showMessage("Account created! Sign in with your new password to continue.", true);
        passwordInput.focus();
      }
    });
    return;
  }

  run(async () => {
    await setPersistence(
      auth,
      rememberBox.checked ? browserLocalPersistence : browserSessionPersistence
    );
    await signInWithEmailAndPassword(auth, email, password);
  });
});

googleBtn.addEventListener("click", () => {
  clearMessage();
  run(async () => {
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);
  });
});

forgotLink.addEventListener("click", async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();

  if (!email) {
    showMessage('Enter your email above first, then click "Forgot password?".');
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showMessage("Password reset link sent to " + email + ".", true);
  } catch (err) {
    showMessage(friendlyError(err.code));
  }
});

switchLink.addEventListener("click", (e) => {
  e.preventDefault();
  setMode(mode === "signin" ? "signup" : "signin");
});

togglePw.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  togglePw.classList.toggle("on", show);
  togglePw.setAttribute("aria-pressed", String(show));
  togglePw.setAttribute("aria-label", show ? "Hide password" : "Show password");
});

if (toggleConfirmPw) {
  toggleConfirmPw.addEventListener("click", () => {
    const show = confirmInput.type === "password";
    confirmInput.type = show ? "text" : "password";
    toggleConfirmPw.classList.toggle("on", show);
    toggleConfirmPw.setAttribute("aria-pressed", String(show));
    toggleConfirmPw.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
}

// Standard password policy: 8+ chars, upper, lower, number, symbol.
function checkPasswordStrength(password) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(password)) return "Password needs at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Password needs at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Password needs at least one number.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Password needs at least one symbol (e.g. ! @ # $).";
  return null;
}

function friendlyError(code) {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "That email already has an account. Try signing in instead.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 8 characters with upper and lower case letters, a number, and a symbol.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a bit.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in was cancelled.";
    case "auth/network-request-failed":
      return "Network problem. Check your connection and try again.";
    case "auth/operation-not-allowed":
      return "This sign-in method isn't enabled in Firebase yet.";
    default:
      return "Something went wrong. Please try again.";
  }
}