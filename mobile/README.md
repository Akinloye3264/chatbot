# JAY AI mobile

## Image generation

Select **Create image** above the composer, describe the image (up to 2,048 characters), and send. Select **Chat** to return to questions and file uploads. This mode creates images from text; it does not edit attached photos. Generated images are saved in the app's document storage on phones and their references are kept in chat history. The browser preview stores image data in browser storage.

The backend needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (with Workers AI access) in `backend/.env` locally, or in the Render service environment. Never put these credentials in mobile `EXPO_PUBLIC_*` variables. The backend calls Cloudflare's FLUX.1 Schnell model with four steps through `POST /api/images`. `/health` reports `imageGeneration: true` when both variables are present; this flag does not verify token permissions or quota.

Deploy the updated backend and rebuild/reload the mobile app to use this feature. Quota, configuration, and service failures restore the prompt for retry. Run `npm test --workspace backend` at the repository root for mocked endpoint tests, and `npm run test:ui` in `mobile` for image display, persistence, and retry coverage. A real phone generation remains necessary to verify native file storage and production credentials.

A native React Native / Expo app for Android and iOS, connected to `https://chatbot-kr7o.onrender.com`. This is a separate app, not a WebView wrapper. Its dependencies are isolated from the existing React web frontend.

## Included

- Phone and tablet layouts, portrait and landscape, safe areas, scalable text, and keyboard-aware composition.
- Streaming replies, formatted paragraphs/lists/code and clickable source links instead of raw Markdown emphasis.
- New chats, device-local history, delete, stop, and retry with the draft and files restored.
- Multiple documents, photo library selection, and camera capture with permission handling. Phone photos are normalized to JPEG.
- Up to 10 attachments, 5 MB per file and 20 MB combined. File bytes are not stored in chat history.
- Connection settings with a health check; the Render URL is already the default.
- Android APK sharing profile and iOS production/TestFlight build profile.

## Run and check

Requires Node 22.13 or newer. From this folder:

```powershell
npm.cmd ci
npm.cmd start
npm.cmd run check
npm.cmd test
npm.cmd run export:native
```

Use a matching Expo Go installation for a development preview, or make an EAS build. The APK build below is standalone and does not require Expo Go or a running development computer. Android 7+ and iOS 16.4+ are supported by this Expo SDK. Local iOS compilation requires macOS/Xcode; EAS can compile iOS in the cloud from Windows.

The public backend URL can be set with `EXPO_PUBLIC_API_URL` in a local `.env` before bundling, or changed in Connection settings. Release apps require HTTPS. Never place Groq keys in `EXPO_PUBLIC_*` variables or the app.

## Backend deployment

Deploy the updated `backend` source to the existing Render service. Set `GROQ_API_KEY` and `GROQ_API_KEY2` in Render's Environment panel; editing a local `.env` does not update Render. `/health` should report `configuredKeys: 2`, `webAccess: true`, and a vision model after deployment.

The default `GROQ_MODEL=groq/compound` uses Groq's latest Compound version for website reading, web search, and available built-in tools. The backend uses `GROQ_VISION_MODEL=qwen/qwen3.6-27b` to describe camera/photos, then includes that description in the conversation. Change this to another supported Groq vision model if needed; `off` restores OCR-only image handling. Image analysis adds API requests. Inaccessible/private/login-required links may not be readable. Scanned PDF pages are not OCR-processed; use photos of those pages instead.

Chat history is saved on each device, but model conversation context currently lives in backend memory and resets when Render restarts. There is no account sync. This version has no voice conversations, image generation, or video analysis. The existing backend has no user authentication, so add access control before broad public distribution.

## Android: install from a link or Google Drive

No Google Play account is required to share an APK directly. On this Windows computer, the installed JDK and Android SDK also allow a local build without an Expo account:

```powershell
npm.cmd run build:android:local
```

This creates `artifacts/JAY-AI-android.apk` for ARM64 phones/tablets and x86-64 emulators. It generates and reuses a private signing key under `.credentials/`. Back up that folder privately: you need the same key to install future updates over this app. Never share the signing folder; share only the APK. The local build regenerates the ignored `android/` directory, so keep custom native changes in config/plugins or the build script.

For subsequent JavaScript-only changes, `npm.cmd run build:android:local -- --skip-prebuild` retains native build caches. Run the full command again after changing native dependencies or `app.json`.

For cloud builds instead, use an Expo account:

```powershell
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest init
npm.cmd run build:android
```

`eas init` links the app to your Expo project and writes its project ID. If you already installed a locally signed APK, import its signing credentials into EAS before making updates. The `preview` profile produces a signed APK. Download it from the EAS build page and share that link or upload the APK to your Drive. On Android, open the download and allow installation from that browser/Drive app when Android asks.

## iPhone: install through TestFlight

You need an Expo account, Apple Developer Program membership, and an App Store Connect app record for `com.akinloye.jayai` (or your chosen unique identifier). Sign in through the official CLI prompts; do not paste account passwords into chat.

```powershell
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest init
npm.cmd run build:ios
npx.cmd eas-cli@latest submit --platform ios --profile production --latest
```

In App Store Connect, complete the TestFlight details and create a tester group/invitation link. External testers may require Apple's beta review. Install Apple's TestFlight app on the iPhone and open the invitation link. A raw IPA placed in Drive is not a general iPhone installer. For a few registered devices, EAS `preview` builds can alternatively use ad hoc provisioning.

Before distributing, confirm the final app name, icon, and bundle identifiers in `app.json`. Builds and account enrollment may incur provider fees; check your account before starting them.

## Validation and device checks

`npm test` covers fragmented streaming, UTF-8, malformed responses, upload boundaries, MIME fallback, URL handling, and saved history. `npm run export:native` checks that both native JS bundles and assets can be generated; this is not a signed APK/IPA or a physical-device test.

`npm run test:ui` checks four responsive viewport sizes plus reply formatting, source links, persistence, retry, and connection settings in a browser preview of the React Native UI. Install its browser with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing Chromium executable. This browser preview is a test aid; phone camera and native keyboard behavior still need native testing.

To run the optional live backend smoke test from the repository root (uses configured Groq keys and a few small API requests):

```powershell
npm.cmd run build --workspace backend
node backend/tests/mobile-live.mjs
```

Before sharing a release, test on an Android phone and an iPhone: keyboard visibility, portrait/landscape, large text, chat history after relaunch, denied camera permission, capture a photo, choose multiple files, retry after a connection loss, and open a source link. Test a tablet or split-screen layout too.

References: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [APK/internal distribution](https://docs.expo.dev/build/internal-distribution/), [TestFlight](https://docs.expo.dev/submit/testflight/), [Groq built-in tools](https://console.groq.com/docs/compound/built-in-tools), [Groq vision](https://console.groq.com/docs/vision).
