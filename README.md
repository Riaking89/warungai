# WarungAI — Asisten Jualan Warung 🛍️

**#BuildHybridAI 2026 (Devpost / Firebase) — Web (Chrome)**

WarungAI is an AI shop assistant for small Indonesian sellers (warung / UMKM).
It drafts replies to customer chat messages and writes product descriptions
and social-media captions — using the shop's real product data.

## Why hybrid?

- **Instant chat replies & short descriptions run on-device** (Gemini Nano via
  the Chrome Prompt API): fast, private, free, and they keep working offline.
- **Long marketing captions run in the cloud** (Gemini Flash): more creative
  power for the heavy work.
- The routing is done by **Firebase AI Logic's Hybrid Inference SDK**
  (`InferenceMode.PREFER_ON_DEVICE` for replies/descriptions,
  `PREFER_IN_CLOUD` for long captions). The app never picks a backend itself.
- Every AI answer shows a badge with the backend that actually answered it,
  taken from `response.inferenceSource` reported by the SDK:
  `On-device · Gemini Nano` or `Cloud · Gemini Flash`.

## Features

- Product catalogue (name, price, stock) stored in Firestore, with a local
  fallback when Firestore is not reachable.
- 💬 **Balas chat** — one-click draft replies to customer messages, grounded
  in the shop's real products (including "stok habis" handling).
- ✨ **Deskripsi & caption** — short descriptions on-device, long
  Instagram/TikTok captions in the cloud.
- 🕘 Draft history with backend badge + latency per answer.
- Honest status bar: online/offline, Gemini Nano availability + download
  progress, Firestore and auth state.

## Tech

Vite + React + Firebase JS SDK v12 (App, Auth anonymous, Firestore,
App Check debug provider, AI Logic). No paid services. Firebase project is on
the Spark (free) plan.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Notes:
- On-device inference needs Chrome Desktop 139+ with the Prompt API flag
  (`chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`) and the
  Gemini Nano model downloaded (the app's "Aktifkan AI di perangkat" button
  starts the download). Until Nano is ready, the SDK falls back to cloud.
- Firebase AI Logic must be enabled in the Firebase console
  (AI Logic → Get started, Gemini Developer API), and the App Check debug
  token printed in the browser console must be registered
  (Security → App Check → Apps → Manage debug tokens).
- Firestore database + rules (`firestore.rules`) and Anonymous auth must be
  enabled in the console; without them the app stores data locally and says
  so in the status bar.

## Build

```bash
npm run build    # outputs to dist/
```

## License

MIT — see [LICENSE](LICENSE).
