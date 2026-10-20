# SuperiOA

SuperiOA is a voice-first Android and Web intelligent operation agent. One coordinator plans a user request; the local Android Accessibility layer executes validated actions; verification and local workflow memory decide whether a routine can be safely reused. The LLM does not handle individual taps or keystrokes.

The implementation follows the supplied project architecture and the 34-domain Android capability catalog. Catalog entries remain reference scope, not promises that every app action works. Android UI access depends on the target app exposing accessible nodes. The Web App is a voice-enabled plan preview: browsers do not allow a page to control unrelated cross-origin sites or Android apps.

## Implemented

- Android voice input through the installed speech-recognition service and spoken output through Android Text-to-Speech.
- Android Supabase Auth sign-in and a trusted Edge Function planner. The Web app uses a Render-hosted admin-login service and same-origin authenticated API; Supabase credentials and access tokens are server-side only for Web.
- Five sequential, independently configured OpenAI Chat Completions-compatible LLM slots with per-engine key, base URL, model ID, timeout, retry count, and retry delay. Provider credentials are read only by the Edge Function.
- Strict action-plan schema validation, sequential fallback, bounded retries, safe usage/error logs, and per-user Row Level Security for engine logs.
- Per-action recommendation plans with executable action types, coordinator/agent/sub-agent/skill attribution, and complete ordered steps added when needed for the requested result.
- Android AccessibilityService actions for app launch, HTTPS browser URL launch, Back/Home/Recents, accessible-node tap/type, scroll, swipe, clipboard, wait, and visible-text verification. The service is disabled until the user enables it in Android Settings.
- A task plan preview before execution, explicit approval before every screen tap, user-only authentication/security checkpoints, and a stop control. Tap approval is enforced locally and does not rely on planner-supplied flags or labels. Failed actions stop the workflow; side effects are not blindly retried.
- Android-only workflow memory: successful, verified routines are versioned, scored, scoped to the starting app, and reused locally when confidence and context match.
- Responsive Web App with browser speech recognition/synthesis where supported, Admin Login limited to the two approved accounts, authenticated task planning, safe plan display, tab-memory-only drafts, and the supplied 34-domain reference catalog. No Supabase, backend, API URL, or key configuration form is exposed in the website.
- Supabase migration for user-scoped provider attempt/usage metadata and GitHub Actions jobs for Android tests/APK artifact, Web checks/build artifact, and Edge Function type-check/tests/format.
- Authenticated Android account deletion through the Edge Function. Deleting an account cascades its usage records and clears this app's local Android settings, task history, and workflows. Web drafts/activity are held in memory only and clear when the tab closes.
- Atomic, per-account Edge Function rate limiting: at most 5 planning requests per minute, enforced in Supabase before any LLM call and closed if the quota check is unavailable.

Supabase, provider credentials, Render deployment, Android Accessibility execution, and real-device behavior are **not configured or live-verified** in this checkout. Local tests exercise the two configured admin identities against a mocked Supabase service; live credentials and hosted services are required to verify production login.

## Requirements

- JDK 17 or newer.
- Gradle 9.1 or newer.
- Android SDK Platform 36 (Android Studio or command-line SDK tools).
- Node.js 22+ and npm.
- Deno 2+ for local Edge Function checks.
- Supabase CLI and a Supabase project for authenticated planning.

## Android build and run

From the repository root:

```sh
gradle :core:test
gradle :app:assembleDebug
```

The debug APK is produced at:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Install it on an Android 8.0+ device/emulator with:

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

In the app's **Settings** tab, enter the Supabase project URL and publishable/anon key, then sign in with an existing Supabase Auth user. Enable **SuperiOA action service** explicitly in Android Accessibility settings. To send accessible screen labels to the planner, first opt in using the Run screen checkbox; password/editable contents are excluded and authentication screens are not sent. Review the plan and tap **Review and run locally** before actions start.

Voice recognition is provided by the device's configured recognition service; availability, network use, and language support are device-dependent. Speech output uses Android Text-to-Speech. Neither needs a SuperiOA third-party voice API key.

## Render Web deployment

The Render web service runs the same-origin Node server in `server/index.js`, serves the generated `dist/` site, and proxies only authenticated planning/status requests to the trusted Supabase Edge Function. The browser receives no Supabase URL/key, Supabase access token, service-role key, password, or provider secret. The opaque admin session cookie is `HttpOnly`, `Secure` in production, `SameSite=Strict`, signed with its account-specific token key, and expires after eight hours. Session/token state is held in server memory; restarting or scaling to a separate instance requires a new sign-in. Configure one Render instance unless a shared server-side session store is added.

1. Create two confirmed Supabase Auth users whose email addresses are exactly `superintelligentcore@gmail.com` and `support.pcmdkai@gmail.com`. Set each user's Supabase Auth password to the corresponding Render `AUTH_1_PASSWORD` or `AUTH_2_PASSWORD`. Disable self-service signup in the hosted Supabase Auth settings; `supabase/config.toml` also disables signup for local Supabase projects.
2. Deploy this repository with the included [render.yaml](./render.yaml) Blueprint, or create a Node web service with build command `npm ci && npm run build`, start command `npm start`, and health check `/api/session`.
3. Set these **Render Environment Variables** (the Blueprint generates the two session keys and fixes the email allowlist):

   | Variable | Value |
   | --- | --- |
   | `APP_ORIGIN` | Exact HTTPS origin of the Render service, with no trailing slash or path. |
   | `SUPABASE_URL` | Supabase project URL, `https://<project-ref>.supabase.co`. |
   | `SUPABASE_ANON_KEY` | Supabase anon key, or set `SUPABASE_PUBLISHABLE_KEY` instead. |
   | `AUTH_LOGIN_1_MAIL` | `superintelligentcore@gmail.com` (fixed allowlist). |
   | `AUTH_LOGIN_2_MAIL` | `support.pcmdkai@gmail.com` (fixed allowlist). |
   | `AUTH_1_PASSWORD` | Strong unique password for the first admin; must match that Supabase Auth user's password. |
   | `AUTH_2_PASSWORD` | Different strong unique password for the second admin; must match that Supabase Auth user's password. |
   | `AUTH_TOKEN_1_KEY` | Random secret of at least 32 bytes, unique to admin 1. |
   | `AUTH_TOKEN_2_KEY` | A different random secret of at least 32 bytes, unique to admin 2. |

   Set `APP_ORIGIN` after Render assigns the service URL. Never put real passwords or signing keys in this repository or in the frontend. Rotate keys/passwords through Render and Supabase if exposed.
4. Configure `APP_ORIGIN` and the five `LLM_ENGINE_n_*` variable groups in the Supabase Edge Function's secret store because the existing trusted planner and LLM integration execute there. Supabase itself injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` into the function. Do not put the service-role key in Render or the browser; this Render service does not need it. To deploy, create a separate local Edge Function secrets file containing only `APP_ORIGIN` and the intended `LLM_ENGINE_*` values, then run:

   ```sh
   supabase link --project-ref <project-ref>
   supabase db push
   supabase secrets set --env-file <edge-function-secrets-file>
   supabase functions deploy agent-execute
   ```

   Supabase-reserved `SUPABASE_*` variables are not set with `supabase secrets set`. Keep the secrets file untracked and delete it after deployment. Configure at least one LLM slot with `ENABLED=true`, an API key, HTTPS base URL, and model ID. The current adapter requires an OpenAI Chat Completions-compatible endpoint.
5. After deploying both services, open the Render URL and verify login for each admin, rejection of incorrect passwords, and planning/status access only with an authenticated session. The website has no account creation, Supabase settings, API URL, or key entry controls.

## Supabase and LLM setup

1. Create/configure a Supabase project and confirmed Auth users as described in [Render Web deployment](#render-web-deployment). The apps intentionally have no self-service account-creation flow.
2. Copy the template as a reference for Render and Edge Function environment variable names:

   ```sh
   cp .env.example .env
   ```

   Do not use the whole template as a Supabase secrets file: it also lists Render variables and Supabase-reserved names. Set the provider settings as secrets using the dedicated Edge Function secrets file described above. Supabase injects its reserved `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` values into Edge Functions; do not add those names to `supabase secrets set`.

3. Apply the database migration and deploy the function:

   ```sh
   supabase link --project-ref <project-ref>
   supabase db push
   supabase functions deploy agent-execute
   ```

   Before deployment, configure the dedicated Edge Function secret file as shown in the Render setup section. Supabase Edge Functions provide the reserved Supabase URL/key variables in the function environment. The migration gives users read access only to their own logs; the function uses the service-role key to write authenticated usage records and delete only the currently authenticated user's account.

4. Enter the project URL and public anon key only in Android settings. The website reads no project or provider configuration from the browser. Never place LLM keys or the service-role key in Gradle properties, browser code, GitHub artifacts, or source control. `.env` is ignored by Git; `.env.example` contains placeholders only. If any real secret was ever committed in repository history, rotate it immediately; removing it from the latest tree does not revoke it.

5. Configure Supabase Auth's provider-level protections before production: enforce a maximum of 5 sign-in attempts per IP per minute and 3 password-reset requests per hour, enable TLS for database connections, and use no default database credentials. SuperiOA does not implement its own password storage or login/reset endpoints; these controls must be set in the Supabase project. The project uses Supabase-hosted database/Auth endpoints over HTTPS.

On the website's **Admin Login** page, **Check service status** checks the authenticated Edge Function, usage-log table, and enabled LLM slot configuration. It does not send a prompt to an LLM provider; provider connectivity is only verified by a planning request, which may incur provider charges.

For local Edge Function checks:

```sh
deno check supabase/functions/agent-execute/index.ts
deno test supabase/functions/agent-execute/
deno fmt --check supabase/functions/agent-execute/
```

For local function serving, pass a file containing only custom Edge Function secrets (such as `APP_ORIGIN` and `LLM_ENGINE_*`) to `supabase functions serve --env-file <path>`. Do not include Render-only `AUTH_*` variables or Supabase-reserved `SUPABASE_*` variable names in that file.

The service requires a valid Supabase Auth bearer token. It returns generic error codes with a correlation ID and does not expose stack traces or provider response bodies. Responses include API security headers, and CORS permits only the configured exact `APP_ORIGIN`. The function returns a clear error if no provider is enabled, all providers fail, or usage logging is unavailable. Logs contain engine IDs, error classes, latency, and provider token counts when reported; they do not contain prompts, credentials, or raw provider errors.

## Privacy and account deletion

- Web admin email/password is submitted over HTTPS to the Render server, compared against the configured admin credential, and authenticated against Supabase Auth. Passwords and Supabase access/refresh tokens remain server-side and are not logged or returned to the browser. Android sign-in is handled directly by Supabase Auth.
- Task text and (only when explicitly opted in on Android) filtered accessible-screen labels are sent to the authenticated Edge Function and then to the configured LLM provider to produce a plan. Screen context excludes editable/password values and authentication screens. The Web planner sends task text only.
- Voice input uses the device/browser speech-recognition service; depending on that provider and its settings, audio or transcripts may be processed externally. Typed input is available as an alternative.
- Android stores verified task names, reusable plans, and public connection settings in app-private preferences; Android backup is disabled. The Web App does not persist task drafts, activity, connection settings, or auth tokens in browser storage; old saved draft keys are removed on load. The browser stores only the HttpOnly admin session cookie.
- Server usage rows contain user ID, engine/attempt status, error class, latency, and provider-reported token counts; they exclude task text and prompts. Row Level Security limits reads to the row owner. A separate, service-role-only rate-limit table tracks at most one timestamp/count record per user and cascades on account deletion.
- **Delete account and data** in Android Settings removes the authenticated Supabase user (and cascading usage/rate-limit rows) and clears SuperiOA's local history/workflows/settings. Account deletion requires an active authenticated session. It cannot delete prompts already retained by an external LLM or speech provider; provider retention/deletion policies must be checked separately.
- This project has no payments, file uploads, custom password database, custom password-reset flow, or user-role administration. Payment-webhook and upload validation controls are therefore not applicable.

Render serves the website and API from the same origin over HTTPS, with `Secure`, `HttpOnly`, `SameSite=Strict` cookies and security response headers. Configure Supabase Auth rate limits in the hosted project; those provider settings cannot be verified from this repository.

## Web build and deployment

```sh
npm ci
npm run lint
npm test
npm run build
```

Open the service at `APP_ORIGIN` after deploying it. `npm run build` creates the `dist/` assets served by the Node backend; do not deploy `dist/` to a static-only host because the Admin Login and protected API require `server/index.js`. For local development, copy `.env.example` to the ignored `.env`, replace the placeholders, then run `npm run build && npm run dev`. Browser speech recognition and speech synthesis vary by browser; text input remains available.

The Web App can authenticate and request a plan, but intentionally does not claim to operate other websites. Use Android's explicitly enabled Accessibility service for supported device UI actions.

## CI artifacts

`.github/workflows/ci.yml` runs on push, pull request, or manual dispatch:

- `:core:test` and `:app:assembleDebug`, then uploads `superioa-android-debug` from `app/build/outputs/apk/debug/*.apk`.
- Web lint/tests/build, then uploads `superioa-web-dist` from `dist/`.
- Deno type-check, plan schema tests, and formatting check for the Edge Function.

The Android workflow artifact is a debug APK, not a signed Play Store release. Release signing credentials and a real device/emulator test are still required before distribution.

## Verification and known blockers

Last checked locally in this workspace on 2026-10-20:

| Check | Result |
| --- | --- |
| `npm ci` | Passed; no runtime/dev packages to install. |
| `npm run lint` | Passed. |
| `npm test` | Passed: 16 Web, UI configuration, and Render authentication/API tests. The two admin logins use mocked Supabase Auth; live credentials are not configured in this checkout. |
| `npm run build` | Passed; generated `dist/`. |
| `gradle :core:test` | Passed; core Kotlin tests compiled and ran. |
| `deno check supabase/functions/agent-execute/index.ts` | Passed. |
| `deno test supabase/functions/agent-execute/` | Passed: 12 backend safety, deletion, and rate-limit tests. |
| `deno fmt --check supabase/functions/agent-execute/` | Passed. |
| `gradle :app:assembleDebug` | Blocked before Android compilation: no Android SDK configured (`ANDROID_HOME`/`local.properties` missing). |
| Latest GitHub Actions run (`6ac01c3`) | Web and Edge Function jobs passed; Android failed in `setup-android` before Gradle because the action default requested the removed `tools` SDK package. The workflow now specifies Android 36 SDK packages; the fix needs a new hosted run. |
| Render/Supabase deployment, live admin login, real provider calls, device Accessibility, STT/TTS | Not run; hosted credentials, provider services, and device approval are not available here. |

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), [List.md](List.md), [SuperiOA™_Project_Documentation_(1).md](SuperiOA%E2%84%A2_Project_Documentation_(1).md), and [superioa_solution.md](superioa_solution.md) for the source requirements and status mapping.
