# SuperiOA™ --- API Requirements & Integration List

**Project:** SuperiOA™ --- Intelligent Operation Agent\
**Owner:** PCMDK369™\
**Document:** `List.md`\
**Purpose:** Analyze the external APIs and native system capabilities
required before implementation.

------------------------------------------------------------------------

## 1. Executive Summary

SuperiOA™ is designed as one central intelligence and orchestration
system. The LLM plans tasks; SuperiOA validates and coordinates the
workflow; Android and Chrome perform the actual operations.

The project documentation establishes these core principles:

-   One central intelligence architecture, not a separate AI brain for
    every app.
-   The LLM returns structured instructions; the local execution layer
    performs actions.
-   Keep ordinary taps, typing, scrolling and verification local rather
    than calling the LLM for every action.
-   Save successful workflows and reuse them locally.
-   Pause for the user at CAPTCHA, OTP, password, biometric and
    security-confirmation checkpoints.
-   Use Android Accessibility/UI data first, with visual/OCR perception
    when necessary.

**Important:** Supabase, LLM, TTS and Chrome are stated by the project
owner as already present or planned. This document does not assume they
are fully implemented or tested; their integration status should be
verified in the code.

------------------------------------------------------------------------

## 2. API / Integration Inventory

Status meanings: - **Existing / stated:** User says it is present. -
**Core requirement:** Needed for the intended architecture, but may be
implemented locally rather than through a paid API. - **Planned:** User
says it will be included. - **Optional:** Add only when the feature
needs it. - **Verify:** Inspect the current repository before purchasing
or integrating anything.

  --------------------------------------------------------------------------------------------
  \#             API / Component        Priority            Status           Purpose
  -------------- ---------------------- ------------------- ---------------- -----------------
  1              Supabase               Core                Existing /       Authentication,
                                                            stated           cloud database
                                                                             and optional file
                                                                             storage

  2              LLM Engine Manager (5  Core                Required;        Primary LLM plus
                 engines)                                   implementation   four sequential
                                                            to verify        fallback engines

  3              TTS (Text-to-Speech)   Core for spoken     Planned          Read AI responses
                                        output                               aloud

  4              Chrome / Browser Skill Core for web tasks  Planned          Operate websites
                                                                             and web
                                                                             applications

  5              Android                Core                Required         Observe
                 AccessibilityService                                        accessible UI and
                                                                             perform supported
                                                                             UI actions

  6              Universal Action       Core                Required         Safely execute
                 Engine                                                      structured
                                                                             actions such as
                                                                             TAP, TYPE,
                                                                             SCROLL, BACK and
                                                                             VERIFY

  7              Master Agent / Task    Core                Required         Analyze intent,
                 Orchestrator                                                create plans,
                                                                             coordinate steps,
                                                                             recover from
                                                                             failures

  8              Local workflow memory  Core                Required         Save validated
                                                                             workflows and
                                                                             reduce repeated
                                                                             LLM calls

  9              STT (Speech-to-Text)   Feature-dependent   Verify           Convert voice
                                                                             commands into
                                                                             text

  10             OCR / screen           Feature-dependent   Optional /       Read text when
                 perception                                 likely useful    accessibility
                                                                             nodes do not
                                                                             expose enough
                                                                             information

  11             Web Search API         Feature-dependent   Optional         Retrieve current
                                                                             web information
                                                                             for research
                                                                             tasks

  12             Secure secret/config   Core                Required         Protect provider
                 management                                                  keys, endpoints
                                                                             and configuration

  13             Logging and usage/cost Core                Required         Track engine
                 monitoring                                                  failures,
                                                                             retries, latency
                                                                             and estimated
                                                                             usage

  14             Vision /               Feature-dependent   Optional         Understand
                 image-understanding                                         screenshots or
                 API                                                         images when local
                                                                             OCR is
                                                                             insufficient

  15             Image-generation API   Feature-dependent   Optional         Generate images
                                                                             only if image
                                                                             creation becomes
                                                                             a product feature

  16             Official app/service   Feature-dependent   Optional         More reliable
                 APIs                                                        integration for
                                                                             services that
                                                                             expose suitable
                                                                             official APIs

  17             Crash/error reporting  Optional            Optional         Diagnose crashes
                 service                                                     in production;
                                                                             can be added
                                                                             after MVP

  18             Push notifications /   Feature-dependent   Optional         Needed only if
                 background job service                                      remote
                                                                             notifications or
                                                                             server-side jobs
                                                                             are required
  --------------------------------------------------------------------------------------------

------------------------------------------------------------------------

## 3. Five-Engine LLM Failover Requirement

The five engines are **fallback providers for one logical LLM service**,
not five agents that all run for every request.

### Required behavior

1.  Send the request to Engine 1.
2.  If it fails for a retryable reason, attempt Engine 2.
3.  Continue sequentially through Engines 3, 4 and 5.
4.  If all engines fail, return a clear error and offer retry.
5.  Record which engine succeeded and why earlier attempts failed.
6.  Keep provider settings separate: `API_KEY`, `BASE_URL`, `MODEL_ID`,
    enabled state and timeout.
7.  Use a shared request/response adapter where providers support
    compatible formats; keep provider-specific adapters where they do
    not.
8.  Validate the response schema before passing actions to the Universal
    Action Engine.
9.  Do not automatically repeat an external side effect just because an
    LLM request timed out. Verify task state first when possible.
10. Never expose API keys in logs, client-visible errors, screenshots or
    source control.

### Suggested configuration names

``` env
LLM_ENGINE_1_API_KEY=
LLM_ENGINE_1_BASE_URL=
LLM_ENGINE_1_MODEL_ID=

LLM_ENGINE_2_API_KEY=
LLM_ENGINE_2_BASE_URL=
LLM_ENGINE_2_MODEL_ID=

LLM_ENGINE_3_API_KEY=
LLM_ENGINE_3_BASE_URL=
LLM_ENGINE_3_MODEL_ID=

LLM_ENGINE_4_API_KEY=
LLM_ENGINE_4_BASE_URL=
LLM_ENGINE_4_MODEL_ID=

LLM_ENGINE_5_API_KEY=
LLM_ENGINE_5_BASE_URL=
LLM_ENGINE_5_MODEL_ID=
```

These names are a proposed configuration convention, not a claim that
the current application already reads them. Do not commit real secrets
to Git. If the Android APK calls providers directly, keys embedded in
the APK can be extracted; prefer a secure backend proxy for long-lived
provider secrets where feasible.

### Failover conditions

Usually retry/fail over for network errors, timeouts, provider outages,
rate limits and selected server errors. Treat invalid keys, invalid
model IDs and malformed requests as configuration errors: log them
safely and mark the engine unhealthy rather than retrying indefinitely.
Add bounded retries and backoff to prevent loops and unexpected costs.

------------------------------------------------------------------------

## 4. Supabase --- What It Should Handle

If Supabase is already connected, reuse it rather than adding a second
cloud database without a reason.

Potential responsibilities: - User authentication and sessions. -
Cloud-synced preferences, if required. - Task history and task status,
if cloud history is desired. - Usage metadata and non-secret
diagnostics. - Optional file storage for user-approved artifacts.

Keep local workflow memory in Room/SQLite or another appropriate
on-device store when it should work offline or stay on the device. Do
not store provider API keys as ordinary client-readable database rows.
Configure Row Level Security (RLS) for user data and validate
permissions server-side.

**Verify:** Supabase project URL, public client key, auth setup,
database schema, RLS policies and whether the current app uses Supabase
Auth, Database or Storage.

------------------------------------------------------------------------

## 5. TTS and STT --- Voice Requirements

### TTS

TTS converts an AI response into spoken audio. The project may use
Android's native TextToSpeech first, or a cloud TTS provider if
higher-quality voices are required.

Before choosing a paid TTS API, verify: - Required languages and voice
quality. - Streaming versus complete-audio playback. - Per-character or
per-minute pricing. - Data retention and privacy terms. - Fallback
behavior when the network is unavailable.

### STT

STT is needed only if SuperiOA accepts voice commands. Android's native
speech recognition may be sufficient for the first version; a cloud STT
API is optional for additional language, accuracy or streaming needs.

**Design note:** TTS and STT are separate capabilities. Having TTS does
not automatically provide voice input.

------------------------------------------------------------------------

## 6. Chrome and Web Search Are Different

**Chrome / Browser Skill** performs browser operations such as opening
URLs, switching tabs, reading accessible page content, filling forms and
verifying results where supported.

A **Web Search API** discovers search results and current information.
It is optional if the MVP only performs user-directed browsing, but
useful for research tasks that need search results.

Do not assume Chrome automatically provides a stable programmatic
browser-control API. Choose and test the actual browser execution
approach in the Android implementation. Respect website terms,
authentication boundaries and user confirmation for consequential
actions.

------------------------------------------------------------------------

## 7. Android Capabilities That Usually Do Not Need a Third-Party API

These are local Android/system capabilities or app modules, not external
paid API subscriptions:

-   `AccessibilityService` --- accessible UI events and supported UI
    interaction.
-   `PackageManager` --- discover installed apps and package
    information.
-   Android Intents --- launch apps and supported system actions.
-   Room / SQLite --- local workflow memory and task state.
-   DataStore --- local preferences.
-   Android `TextToSpeech` --- local speech output, subject to installed
    voice support.
-   Android speech-recognition facilities --- voice input where
    available.
-   Local OCR library --- possible alternative to a cloud OCR API.
-   Universal Action Engine --- project code that validates and executes
    allowed actions.
-   Task Orchestrator --- project code that tracks task steps, retries
    and verification.

Capabilities depend on Android version, device manufacturer, permissions
and the target app's UI/accessibility support. Accessibility must not be
used to bypass CAPTCHA, OTP, biometrics or other security checks; pause
and ask the user to complete them.

------------------------------------------------------------------------

## 8. Optional APIs --- Add Only When the Feature Requires Them

  -----------------------------------------------------------------------
  Feature                 Possible integration    When to add
  ----------------------- ----------------------- -----------------------
  Current web research    Web Search API          When users ask for
                                                  fresh facts or
                                                  search-based research

  Screen text recognition Local OCR or cloud OCR  When accessibility data
                                                  is insufficient

  Image understanding     Vision-capable          When screenshot/image
                          model/API               reasoning is required

  Image generation        Image-generation        When the product must
                          provider                create new images

  Cloud artifact storage  Supabase Storage        When files must sync
                                                  across devices or be
                                                  shared

  Official service        Service-specific        When an app/site has a
  actions                 official API            suitable supported API
                                                  and permission

  Crash monitoring        Crash reporting service When testing expands
                                                  beyond the developer's
                                                  device

  Remote/background jobs  Backend worker/queue    When tasks must
                                                  continue while the app
                                                  is closed or require
                                                  server-side processing
  -----------------------------------------------------------------------

Do not add every optional provider at once. Each external integration
adds cost, credentials, failure modes and privacy considerations.

------------------------------------------------------------------------

## 9. Recommended MVP Requirements

For the first working release, prioritize:

1.  One working LLM provider and the shared LLM adapter.
2.  Five-engine configuration and sequential failover.
3.  Master Agent and Task Orchestrator.
4.  Strict JSON action schema and validation.
5.  Android AccessibilityService and a small set of Universal Action
    Engine actions.
6.  Chrome/browser skill for a limited, testable workflow.
7.  Local workflow memory and success/failure verification.
8.  Supabase integration only for the cloud functions actually needed.
9.  TTS output; add STT if voice commands are in scope.
10. Safety checkpoints, stop/cancel control and secure secret handling.
11. Structured logs for engine status, retries, task results and
    estimated usage.
12. Tests on a physical Android device as well as an emulator where
    practical.

The project documentation identifies UI diversity, UI changes,
accessibility limitations, security checkpoints, Android restrictions
and action reliability as major challenges. Therefore, reliable local
execution and verification should receive at least as much attention as
API integration.

------------------------------------------------------------------------

## 10. Repository Audit Checklist --- Before Buying or Adding APIs

-   [ ] Inspect the current code to confirm Supabase integration and
    features.
-   [ ] Locate existing `LLM_API_KEY`, `LLM_URL_KEY`, provider/model
    settings and request code.
-   [ ] Confirm whether the current code supports one LLM or multiple
    providers.
-   [ ] Confirm whether TTS is native Android TTS or an external API.
-   [ ] Confirm how Chrome/browser actions are executed.
-   [ ] Confirm whether AccessibilityService is implemented and enabled
    through user consent.
-   [ ] Confirm local workflow storage and task verification.
-   [ ] Check whether voice input/STT is required.
-   [ ] Check whether OCR or vision is actually needed by test
    workflows.
-   [ ] Check that secrets are not hard-coded or committed.
-   [ ] Check Supabase RLS and authentication policies.
-   [ ] Add API providers only after the corresponding feature and
    failure behavior are defined.

------------------------------------------------------------------------

## 11. Decisions Still Needed

1.  Which five LLM providers/models will be configured? Provider
    availability, model IDs, request formats and pricing must be
    verified at implementation time.
2.  Which TTS option is intended: Android native TTS or a cloud voice
    API?
3.  Will SuperiOA support voice input in the MVP, requiring STT?
4.  Is web search required, or is Chrome browsing sufficient for the
    first version?
5.  Does the app need cloud task history, or should workflow memory
    remain local?
6.  Will long-running tasks execute only while the Android app is open,
    or is a backend worker required?

------------------------------------------------------------------------

## 12. Source Basis and Scope

This list is based on the provided SuperiOA project documentation and
the owner's stated setup (Supabase, LLM, TTS and Chrome). The project
document proposes Kotlin + Jetpack Compose, AccessibilityService,
PackageManager, Room/SQLite, DataStore, HTTPS, JSON, a central LLM
coordinator, workflow memory and a safety system.

The documents describe a proposed architecture, not proof that each
component is already implemented. Current repository code and provider
documentation must be inspected before treating an integration as
complete or selecting exact model IDs/endpoints.
