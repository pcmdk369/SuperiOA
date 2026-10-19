# SuperiOA

SuperiOA is an Android task-orchestration project. The repository currently contains a native Compose task desk and a JVM-tested action-plan validation core. The app saves task drafts locally; it does not yet connect to an LLM, execute Android UI actions, or sync to Supabase.

The repository also includes a browser-based task desk in `web/`. It stores drafts and activity in the current browser only; it is not connected to the Android app or a backend. Its Skills view lists all 34 domains in the supplied capability catalog, but these entries are reference scope, not implemented automation.

## Build

Requirements: Android Studio with Android SDK 36, JDK 17 or newer, and Gradle 9.1 or newer. From the repository root:

```sh
gradle :app:assembleDebug
gradle :core:test
```

Install the debug APK from `app/build/outputs/apk/debug/` on an Android 8.0+ device or emulator. The current container has Java 25 and Gradle 9.7.1 but no Android SDK, so an APK build cannot be verified here.

## Web task desk

Open `web/index.html` directly in a browser, or serve it from the repository root with:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173/web/`. Drafts remain in that browser's local storage. The site is a local workspace only: planning providers, Android execution, and cloud sync are not connected.

## Current behavior

- Run: save a task draft to on-device preferences. Saving does not execute it.
- History: view locally saved task drafts.
- Settings: view which integrations are still unconfigured.
- Core: validate supported action names, required fields, payload bounds, timeouts, and plan size before a future executor accepts a plan.

## Security and integrations

Do not embed provider API keys in the Android app. Configure future LLM access through an authenticated trusted backend; add provider credentials only to its secret store. Accessibility-based execution must be implemented with user disclosure, explicit enablement, bounded actions, and approval checkpoints for sensitive operations. Supabase, voice, browser control, and remote sync are not connected in this initial slice.

See [List.md](List.md) and [SuperiOA™_Project_Documentation_(1).md](SuperiOA%E2%84%A2_Project_Documentation_(1).md) for the source requirements.