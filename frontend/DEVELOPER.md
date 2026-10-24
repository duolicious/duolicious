# Developer Guide

This guide helps you get the Duolicious frontend running locally fast, run tests, and ship high‑quality pull requests.

---

## Quickstart

```bash
# 1) Install dependencies (also applies the repo's patches)
npm install

# 2) Run the app (pick one)
npm run web        # Web (recommended for first-time contributors)
npm run android    # Android (emulator or device required)
npm run ios        # iOS (macOS + Xcode required)
```

Optional: if you hit OpenSSL errors on some Node setups or file watch limits on Linux, see Troubleshooting below.

---

## Prerequisites

- Node.js and npm (LTS recommended)
- Git
- For native:
  - Android: Android Studio + SDK, an emulator or device
  - iOS: macOS with Xcode installed
- For end‑to‑end tests: Playwright browsers
  - Install once: `npx playwright install --with-deps`

You do not need to install the Expo CLI globally; commands are run via npm scripts or `npx`.

---

## Scripts you’ll use

- `npm run web` – start the app in the browser
- `npm run android` – run on Android
- `npm run ios` – run on iOS
- `npm test` – run unit tests (Jest)
- `npm run typecheck` – TypeScript type checks
- `npm run lint` – ESLint

---

## Environment configuration

Runtime configuration is provided to the app through Expo `extra` values (see `app.config.ts`) and read in `env/env.tsx`. Sensible localhost defaults exist for development, so you can usually skip this section. If you want to point the app at different backends, set these environment variables before running the app:

- `DUO_STATUS_URL` – status service base URL
- `DUO_API_URL` – API base URL
- `DUO_CHAT_URL` – websocket chat URL
- `DUO_IMAGES_URL` – images CDN/base URL
- `DUO_AUDIO_URL` – audio CDN/base URL
- `DUO_PARTNER_URL` – partner portal URL
- `DUO_INVITE_URL` – invite landing page URL
- `DUO_WEB_VERSION` – web build/version identifier
- `DUO_KLIPY_API_KEY` – Klipy API key for GIFs
- `NOTIFICATION_ICON_URL` – desktop notification icon URL
- `NOTIFICATION_SOUND_URL` – desktop notification sound URL

### Use the production backend (optional)
```bash
export DUO_STATUS_URL=https://status.duolicious.app
export DUO_API_URL=https://api.duolicious.app
export DUO_CHAT_URL=wss://api.duolicious.app/chat
export DUO_IMAGES_URL=https://user-images.duolicious.app
export DUO_AUDIO_URL=https://user-audio.duolicious.app
export DUO_PARTNER_URL=${DUO_PARTNER_URL:-https://partner.duolicious.app}
```

### Use a local/docker backend (optional)
```bash
export DUO_STATUS_URL=http://localhost:8080
export DUO_API_URL=http://localhost:5000
export DUO_CHAT_URL=ws://localhost:5000/chat
export DUO_IMAGES_URL=http://localhost:9090/s3-mock-bucket
export DUO_AUDIO_URL=http://localhost:9090/s3-mock-audio-bucket
export DUO_PARTNER_URL=${DUO_PARTNER_URL:-https://partner.duolicious.app}
```

---

## Testing and quality

### Unit tests (Jest)
```bash
npm test
```

### Type checks (TypeScript)
```bash
npm run typecheck
```

### Linting (ESLint)
```bash
npm run lint
# Optional auto-fix
npx eslint . --fix
```

### End‑to‑end tests (Playwright)
First‑time setup:
```bash
npx playwright install --with-deps
```
The tests drive the app against the real backend. Start a fresh copy of the backend's test stack first, with its rate limits switched off (from `backend/`):
```bash
mkdir -p test/input
for f in enable-mocking disable-ip-rate-limit disable-account-rate-limit; do echo 1 > test/input/$f; done
docker compose -f docker-compose.test.yml up -d --build api status s3mock smtp redis
```
The `seed` project fills the database with a fixed cast of members (it needs `psql` on your `PATH`), and `screens.spec.ts` and `onboarding.spec.ts` compare each screen against the PNGs in `playwright-tests/*-snapshots/`, on desktop and phone layouts. Screenshots render differently between machines, so the committed PNGs come from CI: when a screen changes on purpose, download the failed job's `playwright-report-…` artifact and copy each `test-results/**/<name>-actual.png` over the matching snapshot. New screens write their first PNG into `playwright-tests/*-snapshots/` in the same artifact.

Run tests and capture traces:
```bash
npx playwright test --trace on
```
Open a saved trace (example):
```bash
npx playwright show-trace -b firefox playwright-report/data/*.zip
```
Record a new test:
```bash
npx playwright codegen http://localhost:8081
```
GitHub Actions will run Jest, Playwright, type checks, and ESLint on pull requests. Aim for green checks locally before opening a PR.

---

## Troubleshooting

- OpenSSL error on some Node versions:
  ```bash
  export NODE_OPTIONS=--openssl-legacy-provider
  ```
- Linux file watcher limits (large projects):
  ```bash
  echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p
  ```
- Expo cache hiccups (rare):
  ```bash
  npx expo start -c
  ```

---

## Building the Android APK

Add this to `.credentials.json`:

```json
{
  "android": {
    "keystore": {
      "keystorePath": "/path/to/duolicious.keystore",
      "keystorePassword": "REPLACE-WITH-KEYSTORE-PASSWORD",
      "keyAlias": "duolicious",
      "keyPassword": "REPLACE-WITH-KEY-PASSWORD"
    }
  }
}
```

Then to build a production release:

```bash
./build-apk.sh
```

Or to build an APK for local development:

```bash
./build-apk.sh --profile preview
```

If you want to install the APK:

```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

---

## Building the iOS App

```bash
./build-ipa.sh
```

To generate an ad-hoc ipa file:

```bash
./build-ipa.sh --profile preview
```

---

## Sending Duolicious to Tim Apple

```bash
xcrun altool --upload-app -t ios -u "email@exmaple.com" -p "password" -f /path/to/duolicious-frontend/build-1720942386773.ipa
```
