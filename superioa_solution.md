# SuperiOA Solution

## Intelligent Operation Agent for Android and Web

**Document type:** Requirements analysis and implementation solution\
**Project:** SuperiOA\
**Status:** Proposed architecture and implementation roadmap\
**Primary target:** Android device, Chrome, and web applications

------------------------------------------------------------------------

## 1. Executive Summary

SuperiOA is a proposed universal operation agent that turns a user's
natural-language goal into a coordinated workflow across Android
applications, Chrome, and web applications.

The core design principle is to separate intelligence from execution:

-   **LLM layer:** Understands the goal, plans tasks, decomposes complex
    work, and proposes structured actions.
-   **SuperiOA orchestration layer:** Coordinates tasks, skills,
    retries, approvals, verification, and workflow memory.
-   **Android execution layer:** Performs supported UI operations
    through Android AccessibilityService and other permitted device
    capabilities.
-   **Applications and websites:** Perform the actual application work.
-   **Supabase:** Provides the configured backend services for identity,
    persistent data, and other project data needs.
-   **Text-to-Speech (TTS):** Reads responses and execution status
    aloud.
-   **Chrome/browser layer:** Enables supported workflows in websites
    and web applications.

SuperiOA should not create a separate AI brain for every app. It should
use one central coordination architecture with modular app skills. App
skills define application-specific interaction patterns and verification
rules; they are not independent AI agents.

The first release should prove a reliable, safe workflow on Android,
Chrome, and a small set of test applications before expanding to
thousands of workflows.

## 2. Goals and Non-Goals

### Goals

1.  Convert natural-language instructions into executable workflows.
2.  Coordinate tasks across Android apps and web applications.
3.  Keep UI actions local where possible to reduce API calls, latency,
    and cost.
4.  Use an LLM for planning and replanning rather than calling it for
    every tap or keystroke.
5.  Verify important actions and recover from failures.
6.  Store validated workflow memory with versioning and confidence
    information.
7.  Support spoken output through TTS.
8.  Integrate with the project's existing Supabase setup.
9.  Pause at authentication and sensitive-action checkpoints.
10. Keep the system modular so new skills can be added without building
    a new AI model for each application.

### Non-goals for the first version

-   Supporting every Android application or website.
-   Guaranteeing that every interface element can be controlled.
-   Bypassing CAPTCHA, OTP, biometrics, passwords, paywalls, or
    application security restrictions.
-   Performing irreversible or external actions without the required
    user approval.
-   Automatically modifying its own code or granting itself new
    permissions.
-   Assuming that every feature requires a separate third-party API.

## 3. Proposed System Architecture

``` text
User: Text or Voice
        |
        v
SuperiOA Android App
        |
        +--> Speech-to-Text (optional, for voice input)
        |
        v
Master Agent
        |
        v
LLM Coordinator / Provider Router
        |
        v
Task Orchestrator
        |
        +--> Research Sub-Agent
        +--> Content Sub-Agent
        +--> Creative Sub-Agent
        +--> Communication Sub-Agent
        +--> Publishing Sub-Agent
        |
        v
Pre-Sub-Agent / App or Web Skill
        |
        v
Action Plan Validator and Safety Gate
        |
        v
Universal Action Engine
        |
        +--> Android AccessibilityService
        +--> App Discovery / PackageManager
        +--> Chrome and Browser Interaction
        +--> UI Observation / OCR when required
        |
        v
Installed Apps / Websites / Web Apps
        |
        v
Result Verification and Recovery
        |
        +--> Local Workflow Memory
        +--> Supabase persistence where needed
        +--> TTS status or spoken result
```

### Architectural rule

**The LLM plans; SuperiOA coordinates; the local execution layer acts;
the target application performs the work; verification checks the
result.**

The exact agent hierarchy should be dynamic. Simple tasks may go
directly to a local workflow. Complex tasks can activate multiple
sub-agents and app skills.

## 4. Requirements Analysis

### 4.1 Core requirements

  -----------------------------------------------------------------------
  Component               Responsibility          External API required?
  ----------------------- ----------------------- -----------------------
  Android application     Main user interface,    No
                          task input, status,     
                          settings                

  Master Agent            Interpret intent and    Usually uses the LLM
                          define the overall goal layer

  LLM Coordinator         Planning, reasoning,    Yes, for a hosted LLM
                          decomposition,          
                          replanning              

  Provider Router         Select configured LLM   Uses configured
                          provider and handle     provider APIs
                          failover                

  Task Orchestrator       Sequence tasks, manage  No separate API
                          dependencies, retries,  required
                          and completion          

  Sub-agent modules       Handle logical task     Not necessarily; can be
                          domains                 software modules using
                                                  the shared LLM

  App/Web Skills          Define UI patterns,     Usually no separate API
                          workflows, selectors,   
                          and verification rules  

  Universal Action Engine Validate and execute    No external API
                          structured actions      required

  AccessibilityService    Observe and operate     Android platform
                          supported Android UI    capability
                          elements                

  App Discovery           Identify installed      Android PackageManager
                          packages and launchable 
                          activities              

  Chrome/browser skill    Operate supported web   Browser or web
                          workflows               interaction mechanism;
                                                  API depends on
                                                  implementation

  Workflow memory         Save successful         Local storage; Supabase
                          workflows and metadata  can provide shared
                                                  persistence

  Supabase integration    Authentication and      Supabase project
                          persistent backend data credentials and
                          as configured           client/API

  TTS                     Speak responses and     Android TTS may need no
                          status                  external API; cloud TTS
                                                  requires a provider API

  Speech-to-Text          Convert voice input     Optional;
                          into text               Android/device
                                                  capability or a
                                                  provider API

  OCR/vision              Interpret interfaces    Optional; local OCR or
                          that expose             a configured vision API
                          insufficient            
                          accessibility data      

  Logging and monitoring  Record failures,        Local logs or backend
                          latency, usage, and     telemetry
                          safety events           

  Testing                 Validate actions and    No external API
                          workflows on emulators  required
                          and real devices        
  -----------------------------------------------------------------------

### 4.2 Existing services and assumptions

The project context indicates that Supabase, an LLM, TTS, and Chrome are
already present or planned. The implementation should first inspect the
current repository and configuration to determine what is actually
implemented, what is configured, and what is only planned.

Do not create duplicate integrations before auditing the existing code.

The source architecture names Kimi K3 as a proposed central LLM. Keep
the provider configurable so the application can use the currently
configured model and, if explicitly configured, additional providers
with sequential failover. Do not assume that a particular provider,
model identifier, endpoint, or API feature is available until its
configuration and current documentation have been verified.

## 5. API and Integration Inventory

### 5.1 Required or likely integrations

#### A. LLM API

**Purpose** - Interpret the user's request. - Produce a structured
plan. - Decompose complex tasks. - Resolve planning uncertainty. -
Replan after verified failures.

**Expected interface** - A backend or coordinator method such as
`planTask(task, context)`. - Structured JSON output conforming to a
defined schema. - Timeouts, bounded retries, error classification, and
usage tracking. - Optional provider routing and sequential failover when
multiple providers are configured.

**Important design decision** Do not call the LLM for every `TAP`,
`TYPE`, or `SCROLL`. Request a workflow plan, execute safe local
actions, and call the LLM again only when replanning is necessary.

**Secret handling** Keep hosted LLM API keys in a trusted backend or
protected secret store. Do not embed privileged provider keys in a
publicly distributed Android APK or frontend code.

#### B. Supabase

Use the existing Supabase project rather than creating a second backend
without a reason.

Potential services, enabled only as required: - **Supabase Auth:** User
identity and session management, if the application uses
Supabase-managed authentication. - **Postgres Database:** User
preferences, task metadata, workflow records, execution summaries, and
configuration metadata. - **Storage:** Optional storage for
user-authorized files, exports, or workflow artifacts. - **Edge
Functions:** Optional trusted server-side endpoints for coordinating LLM
calls, protecting provider keys, enforcing quotas, and validating
requests. - **Realtime:** Optional status updates if the user interface
needs live backend synchronization.

These are candidate integrations, not proof that each service is already
enabled. Inspect the existing Supabase schema, policies, functions, and
authentication setup before changing anything.

**Security requirements** - Use Row Level Security (RLS) for user-owned
records. - Never expose the Supabase service-role key in the Android app
or browser client. - Keep secrets in server-side environment variables
or a managed secret store. - Validate authorization on the server, not
only in the UI. - Store only the data needed for the feature and define
retention rules for sensitive logs.

#### C. Android AccessibilityService

**Purpose** - Observe accessible UI nodes and window changes. - Perform
supported gestures and global actions. - Resolve visible targets and
execute permitted UI actions. - Report action outcomes to the Universal
Action Engine.

This is an Android platform capability, not a third-party web API. It
requires an Android implementation, a declared service, appropriate
configuration, and explicit user enablement in device settings. Actual
capabilities vary by Android version and target application.

Use accessibility only for legitimate user-directed assistance. Do not
attempt to evade platform safeguards or access data the user has not
authorized.

#### D. Chrome and Web Interaction

**Purpose** - Navigate to permitted websites. - Interact with supported
web forms and web applications. - Transfer information between supported
applications and websites.

Choose and implement a clear browser strategy, such as Android UI
interaction, a controlled browser environment, or supported website APIs
where available. These approaches are not interchangeable, and the
correct choice depends on the existing implementation.

A Chrome installation alone does not automatically grant reliable access
to every website. Sites may change their layouts, require sign-in, block
automation, or expose limited accessibility information.

#### E. Text-to-Speech

**Purpose** - Read the assistant's response aloud. - Announce task
progress, approval requests, pauses, and completion.

Prefer the device's Android TextToSpeech capability for a simple first
release if its voice quality and language support are sufficient. Use a
cloud TTS provider only if a specific quality, voice, or language
requirement justifies the extra API, network dependency, cost, and
privacy considerations.

TTS is separate from speech recognition. Voice input requires an
additional speech-to-text capability if the device's available
functionality does not meet the requirements.

### 5.2 Optional integrations

  -----------------------------------------------------------------------
  Integration             Add it when             Notes
  ----------------------- ----------------------- -----------------------
  Speech-to-Text (STT)    Users need voice        Can be device-based or
                          commands                cloud-based

  OCR                     Accessibility nodes are Prefer local OCR where
                          insufficient            practical

  Vision-capable model    Visual reasoning cannot Send only necessary,
                          be handled locally      authorized screen
                                                  information

  Push notifications      Users need background   Requires a notification
                          completion alerts       strategy and possibly a
                                                  push service

  Analytics/telemetry     Operational reliability Minimize personal and
                          must be measured        screen-content data

  Website-specific APIs   A website offers an     Prefer official APIs
                          appropriate supported   over fragile UI
                          API                     automation when
                                                  suitable
  -----------------------------------------------------------------------

### 5.3 What does not automatically require an API

The following can generally be implemented as local application logic: -
Task orchestration. - Sub-agent and pre-sub-agent modules. - Action
validation. - Retry and abort logic. - Workflow versioning. - Local
execution queues. - App-skill definitions. - Local workflow memory. - UI
state checks. - Safety checkpoints. - Basic device TTS, if supported by
Android. - Android app discovery through PackageManager.

## 6. Universal Action Engine

The Universal Action Engine converts validated structured instructions
into actual operations.

### Initial action catalogue

-   `OPEN_APP`
-   `TAP`
-   `TYPE`
-   `SCROLL`
-   `SWIPE`
-   `COPY`
-   `PASTE`
-   `BACK`
-   `HOME`
-   `RECENTS`
-   `READ_UI`
-   `WAIT`
-   `VERIFY`
-   `RETRY`
-   `ABORT`
-   `REQUEST_USER`

Every action should have a validated schema, a timeout, a result status,
and a safe failure path.

### Example action

``` json
{
  "action": "TYPE",
  "target": {
    "type": "accessibility_label",
    "value": "Search"
  },
  "text": "Find information about the requested topic",
  "timeout_ms": 5000
}
```

This is an illustrative contract. The actual schema should be defined
once in code and used consistently by the planner, validator, executor,
tests, and skills.

### Action execution lifecycle

1.  Receive the proposed action.
2.  Validate the action name and required fields.
3.  Check permissions, user authorization, and safety rules.
4.  Inspect the current UI state.
5.  Resolve the target using accessibility information or an approved
    fallback.
6.  Execute the action.
7.  Observe the resulting state.
8.  Verify the expected outcome.
9.  Record a structured result.
10. Retry safely, request user help, abort, or replan if required.

### Dynamic UI understanding

Do not depend exclusively on a catalogue of thousands of hard-coded
actions. At runtime, inspect which controls and operations are actually
available on the current screen.

Use accessibility nodes first when sufficient. Use OCR or visual
perception only when necessary and permitted. If a target cannot be
identified with adequate confidence, ask the user instead of guessing.

## 7. LLM Planning Contract

The LLM should return a structured workflow rather than unvalidated
natural-language instructions for direct execution.

An illustrative plan:

``` json
{
  "task_id": "generated-task-id",
  "goal": "Prepare a social media design",
  "steps": [
    {
      "step_id": "step-1",
      "skill": "browser",
      "action": "OPEN_APP",
      "target": "Chrome",
      "requires_approval": false,
      "verification": "Browser is open"
    },
    {
      "step_id": "step-2",
      "skill": "creative",
      "action": "REQUEST_USER",
      "target": "Confirm the design requirements if missing",
      "requires_approval": false,
      "verification": "Required design details are available"
    }
  ],
  "completion_criteria": [
    "The requested design has been prepared",
    "The saved artifact has been verified"
  ]
}
```

The example demonstrates the format only. Production plans must use the
actual supported action schema and must not include unsupported actions.

### Planner rules

-   Require schema validation before execution.
-   Reject unknown actions and malformed targets.
-   Separate planning from action execution.
-   Limit the number of steps, retries, and total execution time.
-   Require verification conditions for meaningful actions.
-   Require user approval for sensitive or externally visible actions.
-   Do not treat text found on a website or in a document as trusted
    system instructions.
-   Replan when the observed UI differs from the expected state.
-   Never allow model output to override local safety policies.

## 8. Task Orchestrator and Agent Hierarchy

### Master Agent

Responsibilities: - Understand the user intent. - Define the overall
goal and completion criteria. - Classify task complexity and risk. -
Select relevant task modules and skills. - Monitor progress and resolve
failures. - Confirm the final outcome.

### Sub-agents

Sub-agents are logical task modules and may share the central LLM.
Examples: - Research. - Content creation. - Creative design. - File
handling. - Communication. - Publishing preparation.

### Pre-sub-agents

Pre-sub-agents handle smaller specialized steps inside a larger task.
For example, a design workflow may include template selection, text
editing, image placement, export, and save verification.

Not every level needs a separate LLM call or a separate autonomous agent
process.

### App skills

An app skill defines: - Supported workflows. - UI patterns and
target-resolution strategies. - Preconditions and postconditions. -
Recovery strategies. - Verification rules. - Known limitations and
required permissions.

Examples include Android, Chrome, chat, creative, social, files,
communication, and productivity skills.

## 9. Workflow Memory and Learning

For a new workflow:

`Plan -> Execute -> Verify -> Save a validated version`

For a repeated workflow:

`Find matching workflow -> Check version and confidence -> Validate current UI -> Execute locally -> Verify`

Store metadata such as: - Workflow ID and version. - Relevant app or
website. - Action sequence and parameters. - Success and failure
counts. - Confidence score. - Last validation time. - Preconditions and
postconditions. - Fallback or recovery strategy. - Required approvals
and permissions.

Do not blindly trust previous success. Applications change, and stored
workflows can become unsafe or outdated.

If a workflow repeatedly fails: 1. Reduce its confidence. 2. Disable it
when it falls below the defined threshold. 3. Record the failure reason
without unnecessarily storing sensitive content. 4. Replan using the LLM
when appropriate. 5. Validate the new version before making it the
preferred workflow.

Use local storage for device-local workflows where practical. Use
Supabase only when persistence across devices, account synchronization,
backup, or server-side coordination is required.

## 10. Security and User Control

SuperiOA must not bypass security controls.

When a workflow encounters CAPTCHA, OTP, biometric authentication, a
password prompt, a permission dialog, or another protected checkpoint:

`Detect -> Pause -> Explain -> Request User Action -> Resume After Confirmation`

### Approval policy

Require explicit confirmation for actions such as: - Sending a message
or email. - Publishing content. - Making a purchase or financial
transaction. - Deleting or overwriting important files. - Changing
account security settings. - Sharing sensitive information. - Any action
whose impact is unclear or difficult to reverse.

Where practical, allow the user to review the final content before
submission or publication.

### Additional safeguards

-   Provide a visible stop or abort control.
-   Keep an execution log with action status and timestamps.
-   Avoid storing passwords, OTP values, payment details, or unnecessary
    screen content.
-   Protect backend credentials.
-   Use least-privilege permissions.
-   Validate user ownership and access rights on backend requests.
-   Add request quotas, rate limits, timeouts, and bounded retries.
-   Make failures visible rather than silently reporting success.
-   Ensure the user can understand when the agent is operating another
    app.

## 11. Suggested Backend API Contract

The source architecture proposes a single endpoint such as
`POST /agent/execute`. Keep a small API surface initially and expand
only when needed.

### Example request

``` http
POST /agent/execute
Content-Type: application/json
Authorization: Bearer <user-session-token>
```

``` json
{
  "task": "Prepare a social media design",
  "mode": "execute",
  "client": {
    "platform": "android",
    "app_version": "0.1"
  }
}
```

### Example response

``` json
{
  "task_id": "generated-task-id",
  "status": "planned",
  "requires_user_approval": false,
  "plan": [],
  "message": "The task plan is ready for validation."
}
```

These examples are conceptual contracts, not deployed endpoints. The
repository's current backend, authentication method, and existing
schemas must be checked before implementation.

### Recommended endpoint responsibilities

-   Authenticate and authorize the user.
-   Validate request fields.
-   Apply rate limits and quotas.
-   Call the configured LLM through a trusted server-side component.
-   Validate the returned plan.
-   Return a task identifier and structured plan or execution status.
-   Record minimal operational metadata.
-   Never expose provider secrets to the client.

If the Android app executes UI actions locally, the backend should not
pretend it has direct control of the device. The client should report
execution results through an authenticated, validated status mechanism
if backend synchronization is required.

## 12. Proposed Technology Stack

Based on the project concept:

-   **Android application:** Kotlin and Jetpack Compose.
-   **UI automation:** Android AccessibilityService.
-   **App discovery:** Android PackageManager.
-   **Local data:** Room or SQLite, with DataStore for lightweight
    preferences.
-   **Backend:** The existing Supabase project, using only the services
    required.
-   **LLM:** The currently configured provider; Kimi K3 is the proposed
    coordinator in the source concept.
-   **Provider routing:** Optional configurable sequential failover
    across explicitly configured LLM providers.
-   **Data format:** Validated JSON contracts.
-   **Network:** HTTPS.
-   **Browser:** Chrome and a defined browser interaction strategy.
-   **Voice output:** Android TextToSpeech or the project's configured
    TTS provider.
-   **Optional voice input:** Device or cloud STT.
-   **Optional visual perception:** Local OCR and/or a configured vision
    service.
-   **Testing:** Unit tests, integration tests, Android emulator tests,
    and physical-device tests.

The exact library versions, API endpoints, environment variables, and
provider-specific request formats must be verified against the existing
project and current provider documentation.

## 13. Suggested Project Structure

``` text
superioa/
├── app/
│   └── src/
│       ├── main/
│       │   ├── java/.../
│       │   │   ├── ui/
│       │   │   ├── accessibility/
│       │   │   ├── controller/
│       │   │   ├── perception/
│       │   │   ├── actions/
│       │   │   ├── apps/
│       │   │   ├── browser/
│       │   │   ├── workflow/
│       │   │   ├── memory/
│       │   │   ├── safety/
│       │   │   ├── speech/
│       │   │   └── network/
│       │   └── AndroidManifest.xml
├── core/
│   ├── models/
│   ├── planner/
│   ├── orchestrator/
│   ├── validation/
│   └── providers/
├── skills/
│   ├── android/
│   ├── browser/
│   ├── chat/
│   ├── creative/
│   ├── social/
│   ├── files/
│   └── productivity/
├── backend/
│   ├── functions/
│   ├── migrations/
│   └── policies/
├── tests/
└── docs/
```

This is a proposed logical structure. Adapt it to the repository's
current framework and directory layout rather than moving or duplicating
working code unnecessarily.

## 14. MVP Scope: Version 0.1

The first version should prove the complete architecture using a small
set of controlled workflows.

### MVP components

-   Android app and task input.
-   AccessibilityService with explicit user enablement.
-   Universal Action Engine.
-   Master Agent and Task Orchestrator.
-   Configured LLM planning integration.
-   Local workflow memory.
-   Chrome interaction for selected supported flows.
-   Existing Supabase integration where required.
-   TTS for status and results.
-   Safety checkpoints and a visible stop control.
-   Structured logging and verification.

### Initial action set

`OPEN_APP`, `TAP`, `TYPE`, `SCROLL`, `BACK`, `COPY`, `PASTE`, `READ_UI`,
`WAIT`, and `VERIFY`.

### MVP acceptance criteria

The MVP is ready for broader testing when: 1. A user can submit a
natural-language task. 2. The system produces a schema-valid plan. 3.
Invalid actions are rejected before execution. 4. The local executor can
perform supported actions on a test workflow. 5. Important action
results are verified. 6. A failed action leads to a bounded retry, a
user request, an abort, or a replanning step. 7. Security checkpoints
pause execution. 8. A successful workflow can be saved and later
revalidated. 9. The user can stop a running workflow. 10. API failures
and missing configuration are reported clearly. 11. No privileged API
key is embedded in the distributed client. 12. The system does not claim
success when verification fails.

## 15. Implementation Roadmap

### Phase 1: Repository and configuration audit

-   Inspect the current project structure and identify the actual
    application framework.
-   Locate existing Supabase, LLM, TTS, and browser integrations.
-   Check environment-variable names without exposing secret values.
-   Identify duplicate or unfinished integrations.
-   Document what works, what is partially implemented, and what is
    missing.
-   Preserve working code and existing data structures unless a change
    is justified.

**Deliverable:** An accurate inventory of existing components and
missing requirements.

### Phase 2: Core Android execution

-   Implement or verify AccessibilityService setup.
-   Add installed-app discovery.
-   Implement UI observation and target resolution.
-   Implement the initial action catalogue.
-   Add action validation, timeouts, stop control, and structured
    results.
-   Test each action on a controlled app and device.

**Deliverable:** A reliable local action engine for supported
operations.

### Phase 3: LLM planning and orchestration

-   Define the JSON plan schema.
-   Connect the configured LLM through the existing secure integration.
-   Implement task decomposition and validation.
-   Add bounded retries and replanning.
-   Add provider failover only for providers that are actually
    configured and tested.

**Deliverable:** Natural-language task to validated workflow conversion.

### Phase 4: Supabase and workflow memory

-   Audit existing tables, policies, and functions.
-   Implement only the required data persistence.
-   Apply RLS and server-side authorization.
-   Store workflow versions and operational metadata.
-   Keep sensitive device execution data local unless synchronization is
    necessary.

**Deliverable:** Secure persistence and workflow history.

### Phase 5: Chrome, TTS, and app skills

-   Implement a defined Chrome interaction approach.
-   Add one or two app skills with explicit preconditions and
    verification.
-   Integrate TTS for status and final results.
-   Add STT or OCR only if needed for the selected workflows.

**Deliverable:** One end-to-end cross-app workflow.

### Phase 6: Testing and controlled expansion

-   Test UI changes, missing permissions, network failure, and app
    crashes.
-   Test security checkpoints and approval flows.
-   Measure success rate, latency, API usage, and recovery behavior.
-   Expand to new skills only after existing workflows meet acceptance
    criteria.

**Deliverable:** A tested MVP and a prioritized expansion plan.

## 16. Testing Strategy

### Unit tests

-   Action schema validation.
-   Plan validation.
-   Permission and approval policy.
-   Retry limits.
-   Workflow version selection.
-   Provider error classification.

### Integration tests

-   LLM request and response parsing.
-   Supabase authorization and persistence.
-   TTS output path.
-   Browser skill state transitions.
-   Execution-result reporting.

### Device tests

-   AccessibilityService disabled or revoked.
-   UI nodes missing or labels changed.
-   App switches unexpectedly.
-   Device locked or screen unavailable.
-   Network disconnected.
-   LLM provider timeout or quota exceeded.
-   User stops the workflow.
-   OTP, CAPTCHA, biometric, or password checkpoint appears.

### Reliability principle

A successful tool call is not necessarily a successful user task. Verify
the target application's resulting state before marking a step complete.

## 17. Main Technical Risks

1.  **UI diversity:** Applications expose different interface
    structures.
2.  **UI changes:** App updates can invalidate selectors and saved
    workflows.
3.  **Accessibility limitations:** Some controls are not accessible.
4.  **Visual uncertainty:** OCR and image interpretation can be
    imperfect.
5.  **Android restrictions:** Capabilities vary by OS version and device
    manufacturer.
6.  **Security checkpoints:** Protected actions may require direct user
    participation.
7.  **Provider reliability:** LLM APIs may fail, rate-limit, or change.
8.  **Cost and latency:** Unnecessary model calls increase both.
9.  **Workflow safety:** An incorrect action can cause an unintended
    external effect.
10. **Data privacy:** Screen content and task history may contain
    sensitive information.

Mitigate these risks with local execution, state observation,
validation, explicit approvals, bounded retries, minimal data retention,
and realistic device testing.

## 18. Final Design Principles

-   One central intelligence architecture; many modular skills.
-   Plan in batches; execute supported actions locally.
-   Observe the current screen instead of relying only on hard-coded
    action lists.
-   Verify meaningful results.
-   Replan when actual state differs from expected state.
-   Keep provider keys out of the client.
-   Reuse the existing Supabase and service integrations after auditing
    them.
-   Treat TTS, STT, OCR, and vision as separate capabilities with
    separate requirements.
-   Pause for authentication and sensitive-action checkpoints.
-   Never bypass security controls.
-   Never report success without evidence.
-   Expand capability through validated skills and workflows, not by
    creating a separate AI model for every application.

## 19. Final Definition

**SuperiOA --- Intelligent Operation Agent** is a proposed Android and
web operation platform that converts user goals into coordinated
workflows and executes supported operations through installed
applications, Chrome, and web applications.

Its architecture combines a Master Agent, Task Orchestrator, optional
Sub-Agent and Pre-Sub-Agent modules, application skills, a validated
Universal Action Engine, local workflow memory, and secure backend
services.

The central LLM provides planning and coordination. SuperiOA manages
execution flow, memory, safety, and verification. Android and browser
execution layers interact with the target environment, while the target
applications perform the actual work.

The objective is not to make one AI model the owner of every
application. It is to create a unified, safe, and verifiable system that
can coordinate available applications on the user's behalf.

------------------------------------------------------------------------

## 20. Before Implementation: Required Repository Audit

Before changing code, produce a short audit table with these columns:

  -------------------------------------------------------------------------------------
  Area                   Existing         Configuration   Verified       Missing work
                         implementation   present?        working?       
  ---------------------- ---------------- --------------- -------------- --------------
  Android app            To inspect       To inspect      To test        To determine

  AccessibilityService   To inspect       To inspect      To test on     To determine
                                                          device         

  LLM integration        To inspect       To inspect      To test        To determine

  LLM provider failover  To inspect       To inspect      To test        To determine

  Supabase               To inspect       To inspect      To test        To determine
                                                          policies and   
                                                          requests       

  TTS                    To inspect       To inspect      To test on     To determine
                                                          device         

  Chrome/browser skill   To inspect       To inspect      To test a      To determine
                                                          supported flow 

  Workflow memory        To inspect       To inspect      To test        To determine
                                                          persistence    

  Safety and approvals   To inspect       To inspect      To test        To determine
                                                          checkpoints    

  Tests and monitoring   To inspect       To inspect      To run         To determine
  -------------------------------------------------------------------------------------

Do not mark a component as complete merely because a dependency, API key
name, or configuration file exists. Verify its behavior through code
inspection and tests. Do not print or include secret values in the audit
output.
