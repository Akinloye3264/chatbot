# Validation record

Checked September 11–12, 2026.

- Backend and web frontend: TypeScript checks and production builds passed.
- Mobile: TypeScript checks passed; six unit tests passed for streaming chunk boundaries/UTF-8, upload limits, MIME detection, URL validation, and saved history.
- Android and iOS Hermes bundles exported successfully.
- Six Playwright checks passed: 320×568, 390×844, 844×390, and 1024×768 layouts; formatted replies/source links/history/retry; connection settings. These run the React Native browser preview, not native iOS.
- Live local-backend tests passed using synthetic inputs: two uploaded text files larger than the former 100 KB body limit, a website question with a source link, a red image without OCR text, and invalid upload rejection.
- The live Render health check was reachable but reported one configured API key. Backend changes still need deployment to that service.
- A signed Android release APK was built, its signature verified, and it installed/launched in the isolated Android emulator.
- Native camera permission, camera launch, capture, and return of a JPEG attachment were observed. The emulator showed ANR warnings while native compilation was also running; final checks should run without competing compilation.
- A native keyboard-overlap issue was found and fixed by enabling Android height-based keyboard avoidance. The corrected APK is being rebuilt for verification.

An iOS signed binary, physical-device checks, and TestFlight distribution remain pending Apple/Expo account setup. Voice conversations, image generation, and video analysis are not implemented.
