// WarungAI — Firebase setup.
// Project: warungai-ria ("WarungAI Demo", Spark free) — switched 19 Nov
// ~03:40 WIB: project 1 (buildhybridai-ria) returns 403 "Gemini API free
// tier is not available for this project" on every AI call. Client config
// is public (shipped in the web app by design); it is NOT a secret.
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { initializeAppCheck, CustomProvider } from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
} from 'firebase/ai';

export const firebaseConfig = {
  apiKey: 'AIzaSyAlbvBdFAeMB885vyaIeAXMPF_uLz68xL8',
  authDomain: 'warungai-ria.firebaseapp.com',
  projectId: 'warungai-ria',
  storageBucket: 'warungai-ria.firebasestorage.app',
  messagingSenderId: '124521567072',
  appId: '1:124521567072:web:ef9dc9d56f0c4bed3fc405',
};

export const app = initializeApp(firebaseConfig);

// ---- App Check (debug provider) -------------------------------------------
// Firebase AI Logic enforces App Check. For this hackathon demo we use the
// debug provider (accepted in hackathon submissions): the SDK prints a
// debug token in the console; register it in the Firebase console under
// Security > App Check > Apps > Manage debug tokens.
// In debug mode the provider below is never called for attestation — the
// debug token exchange is used instead.
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
try {
  initializeAppCheck(app, {
    provider: new CustomProvider({
      getToken: async () => {
        throw new Error('App Check debug mode only — provider never called');
      },
    }),
    isTokenAutoRefreshEnabled: true,
  });
} catch (e) {
  console.warn('[WarungAI] App Check init failed (non-fatal):', e);
}

export const auth = getAuth(app);
export const db = getFirestore(app);

// Anonymous sign-in is best-effort: if the Anonymous provider is not
// enabled in the console yet, the app keeps working without a uid.
export async function ensureAnonAuth() {
  try {
    const cred = await signInAnonymously(auth);
    return { uid: cred.user.uid, error: null };
  } catch (e) {
    console.warn('[WarungAI] anonymous auth failed:', e.code || e.message);
    return { uid: null, error: e.code || String(e) };
  }
}

// ---- Firebase AI Logic — hybrid inference ---------------------------------
// Backend: Gemini Developer API (free). Routing goes through the SDK —
// the app never picks a backend itself.
const ai = getAI(app, { backend: new GoogleAIBackend() });

// Short replies / short descriptions: on-device first (Gemini Nano),
// cloud fallback is gemini-3.5-flash-lite. NOTE: with a hybrid `mode` set,
// the SDK IGNORES a top-level `model` (it warns and falls back to its
// default gemini-2.5-flash-lite, retired for new users) — the cloud model
// MUST go in `inCloudParams` (verified in @firebase/ai source, 19 Nov).
export const hybridModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  inCloudParams: { model: 'gemini-3.5-flash-lite' },
});

// Long marketing copy: cloud first, on-device fallback if offline.
export const cloudModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  inCloudParams: { model: 'gemini-3.5-flash-lite' },
});

let deviceModelInitStarted = false;

/**
 * Must be called after/on a user interaction and before the first
 * generateContent() call. Starts the Gemini Nano download if needed and
 * reports progress (0..1). Safe to call repeatedly; errors are swallowed
 * because PREFER_ON_DEVICE still falls back to cloud.
 */
export async function initDeviceModel(onProgress) {
  if (deviceModelInitStarted) return;
  deviceModelInitStarted = true;
  try {
    await hybridModel.initializeDeviceModel((p) => onProgress && onProgress(p));
  } catch (e) {
    console.warn('[WarungAI] initializeDeviceModel:', e.message || e);
  }
}

/** Raw Prompt API availability, for the honest status pill. */
export async function nanoAvailability() {
  try {
    if (!('LanguageModel' in window) || !window.LanguageModel?.availability) {
      return 'unsupported';
    }
    return await window.LanguageModel.availability();
  } catch {
    return 'unknown';
  }
}
