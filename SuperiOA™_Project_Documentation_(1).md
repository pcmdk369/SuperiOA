# SuperiOA™ — Intelligent Operation Agent: Project Documentation

Oct 4, 2026 · @Super Intelligent Core

SuperiOA™ is a proposed Universal Intelligent Operation Agent that lets one central intelligence layer plan a task while Android and the web execute it across installed apps.

## 1. Document Control

This document is version 1.0 of the official SuperiOA™ project documentation, issued by PCMDK369™.

| Item | Detail |
| --- | --- |
| Project | SuperiOA™ (Intelligent Operation Agent) |
| Project by | PCMDK369™ |
| Documentation version | 1.0 |
| Status of the concept | Proposed architecture, pre-development |
| Platforms | Android and Web |
| Copyright | © 2026 PCMDK369™ |
| Contact | support.pcmdkai@gmail.com |

## 2. Overview

SuperiOA™ turns a natural-language instruction into an executable workflow and carries it out across installed Android apps, Chrome and web applications.

The core idea: one central intelligence layer understands and plans the whole task, while the installed apps, Chrome and Android's local execution layer do the actual work. SuperiOA™ treats a multi-app request as a single task, not as unrelated commands.

**Example request:** "Get information on this topic from a chat assistant, place it into a Canva design, save the design and prepare it for posting on Instagram."

SuperiOA™ is not a separate AI for each app. It is one unified operation layer that links different applications into one workflow.

## 3. Purpose, Scope and Design Principles

The purpose of SuperiOA™ is to operate available applications on a user's behalf in a coordinated way, not to make one AI the owner of every application.

**Scope**

- Operating installed Android apps through the Android UI layer
- Operating websites and web applications through Chrome
- Cross-app workflows: reading, copying, pasting, editing, saving, sharing and uploading
- Reusing validated workflows to reduce repeated planning

**Design principles**

- **AI and execution are separate.** The AI understands, plans, reasons, decomposes tasks, decides, replans and coordinates. Android executes: opening apps, tapping, typing, scrolling, copying, pasting and selecting files.
- **No separate AI agent per app.** An app skill is a specialization layer, not an AI.
- **Strategic intelligence calls.** Plan once, then execute many actions locally. A call to the LLM is not made for every tap, type or scroll.
- **Dynamic UI understanding.** The system asks which actions are valid on the current screen, instead of choosing from a fixed list of thousands of predefined actions.
- **Safe learning.** Learned workflows carry versions and confidence scores, and unreliable ones are disabled.
- **User control.** Security checkpoints always pause for the user.

## 4. System Architecture

Requests flow top-down from the user through a central planner to a local execution layer, so the AI never touches the screen directly.

&#91;embedded content: SuperiOA architecture · 8 layers, planning vs. execution\]

The Master Agent and everything below it down to the skills plan the work; from the Universal Action Engine down, Android executes it.

The hierarchy is dynamic. Not every task activates every level: a simple task can go straight to the Universal Action Engine, while a large task is divided into Sub-Agents and Pre-Sub-Agents.

The responsibility split is:

- **LLM (for example Kimi K3):** think, plan and coordinate.
- **SuperiOA™:** orchestrate, remember and verify.
- **Android:** execute.
- **Apps and web apps:** perform the actual application work.

## 5. Core Components

Four planning-side components sit above the execution layer, and none of them needs to be a separate AI brain.

| Component | Role |
| --- | --- |
| Master Agent | Highest-level coordinator: understands intent, defines the overall goal, classifies the task and estimates complexity, selects Sub-Agents, monitors the workflow, handles failures and verifies the final result. |
| Sub-Agent | Handles one domain of a large task, such as Research, Content, Design or Publishing. |
| Pre-Sub-Agent | Handles specialized work inside a Sub-Agent, such as Canva, Image or Export work within the Design Sub-Agent. |
| App Skill | A specialization layer for one app or category. It defines UI patterns, known workflows, selectors, recovery strategies and verification rules. It is not an AI agent. |

Sub-Agents and Pre-Sub-Agents are logical planning and execution modules. Hierarchy grows with the workload.

**Skill categories:** android, browser, chat, creative, social, files, communication and productivity. Example skills: Canva Skill, Chrome Skill, Chat Skill, Instagram Skill, YouTube Skill and File Skill.

**Chrome as a gateway.** Through one browser skill, SuperiOA™ can reach many websites and web applications, so one Chrome app is not one capability.

## 6. Universal Action Engine

The Universal Action Engine is the most important local component: it converts AI instructions into real Android operations.

The LLM returns only structured instructions. The Android execution layer performs the typing, tapping and scrolling.

| Action group | Actions |
| --- | --- |
| Navigation | OPEN\_APP, BACK, HOME, RECENTS |
| Interaction | TAP, TYPE, SCROLL, SWIPE |
| Clipboard | COPY, PASTE |
| Observation | READ\_UI, WAIT, VERIFY |
| Control | RETRY, ABORT, REQUEST\_USER |

**Example instruction (JSON):**

```json
{ "action": "TYPE", "target": "search_field", "text": "Bitcoin latest news" }
```

As capabilities, SuperiOA™ can open and leave apps, long press, clear text, select, search, navigate menus, switch tabs, fill forms, edit text, choose files, run upload and download flows, share content, handle notifications and transfer data between apps. These work when the target app exposes enough UI information through Android Accessibility.

## 7. Android Accessibility Layer and UI Understanding

The Android execution foundation is AccessibilityService, but no single perception method is enough, so SuperiOA™ combines several.

AccessibilityService receives UI events and, in supported configurations, provides active-window information, global actions and gestures. Not every app exposes the same accessibility information, so the system uses layered strategies:

1. **Accessibility nodes:** read the UI state, resolve the target, then act.
2. **Visual and OCR perception:** used when accessibility data is insufficient.

**Dynamic UI understanding.** An action catalogue is useful, but at runtime the system asks one question: which operations are valid on the current screen and in the current app state? This keeps the architecture flexible when an app changes.

## 8. Workflow Memory and Safe Learning

Successful workflows are saved locally so repeated tasks need little or no LLM planning.

- **First run:** new task → LLM planning → execution → success → save workflow.
- **Later runs:** same or similar task → local memory → known workflow → local execution.

The system never modifies itself blindly. Each learned workflow stores:

| Metadata | Purpose |
| --- | --- |
| Workflow ID and version | Identify and track revisions |
| App and actions | Define what the workflow does |
| Success rate and confidence | Measure reliability |
| Last validation | Show when it last worked |
| Fallback | Define what to do on failure |

If a workflow fails repeatedly, its confidence drops, it is disabled, the LLM replans and a new version is created. Bad learning therefore never becomes permanent.

**Scale principle.** 5,000 local UI actions do not mean 5,000 LLM calls. For example, 5,000 local actions can be grouped into about 20 workflows built from about 50 planning calls. Keep action execution local and keep intelligence calls strategic.

## 9. Security and User Control

SuperiOA™ never bypasses security mechanisms; it pauses and hands control to the user.

When the screen shows a CAPTCHA, OTP, biometric prompt, password or security confirmation, the agent detects the checkpoint and pauses. The user completes it manually, and the agent then continues.

Security-related development steps include approval handling, a stop control and authentication checkpoint handling. The REQUEST\_USER and ABORT actions in the Universal Action Engine support this behavior.

## 10. Technology Stack, Structure and Development Setup

The proposed stack is a native Kotlin Android app with a JSON-based planning link to an external LLM.

| Area | Technology |
| --- | --- |
| Android app | Kotlin + Jetpack Compose |
| IDE | Android Studio |
| UI automation | AccessibilityService |
| App discovery | PackageManager |
| Local storage | Room / SQLite + DataStore |
| Network | HTTPS |
| LLM coordinator | Kimi K3 API |
| Data format | JSON |
| Browser layer | Chrome / web interaction layer |
| Testing | Emulator + physical device |

**Proposed project structure**

```text
superioa/
├── app/   (ui, accessibility, controller, perception, actions,
│           apps, browser, workflow, memory, safety, network)
├── core/  (models, planner, orchestrator, validation)
├── skills/ (android, browser, chat, creative, social, productivity)
├── tests/
└── docs/
```

**Development setup steps**

1. Create a Kotlin-based project in Android Studio.
2. Build SuperiOAAccessibilityService.
3. Implement app discovery with PackageManager.
4. Implement UI observation: read the accessible UI state.
5. Build the Action Engine: OPEN, TAP, TYPE, SCROLL, COPY, PASTE, BACK, WAIT, VERIFY.
6. Add local memory to save successful workflows.
7. Integrate Kimi K3 as the planning layer.
8. Build the Master Agent: user task to workflow conversion.
9. Add the Sub-Agent system and skills.
10. Add security: approval, stop and authentication checkpoint handling.
11. Test on a real Android device.

## 11. Execution Flow and Example Workflows

Every task starts at the Master Agent, which routes simple tasks to a local workflow and complex ones through the agent hierarchy.

**Execution flow**

1. The user gives a natural-language task.
2. The Master Agent analyzes it.
3. A simple task uses a local workflow. A complex task goes through Sub-Agent, Pre-Sub-Agent and App or Web Skill.
4. An action plan goes to the Universal Action Engine, then to Android or Web.
5. The actual app operation runs, followed by verification.
6. Success is saved to memory. Failure triggers recovery or replanning.

**Example A: single-app workflow.** Request: "Create a YouTube thumbnail in Canva."

Master Agent → Creative Sub-Agent → Canva Skill → OPEN\_CANVA → FIND\_TEMPLATE → SELECT\_TEMPLATE → EDIT\_TEXT → EDIT\_IMAGE → SAVE → VERIFY. The LLM supplies the workflow; the Android UI layer performs the editing in the Canva app.

**Example B: multi-app workflow.** Request: "Get information from a chat assistant, build a Canva design and prepare it for Instagram."

| Stage | Sub-Agent | Skill and actions |
| --- | --- | --- |
| 1 | Research | Chat Skill: READ, COPY |
| 2 | Design | Canva Skill: EDIT, SAVE |
| 3 | Publishing | Instagram Skill: PREPARE |
| 4 | Master Agent | VERIFY |

**Example API call**

```json
POST /agent/execute
{ "task": "Create a social media design", "mode": "execute" }
```

A single external LLM endpoint can sit in front of the full hierarchical agent architecture.

## 12. MVP, Scaling Roadmap and Technical Challenges

Version 0.1 aims to prove the architecture on a small scope, not to support thousands of apps.

**MVP v0.1 components:** Android app with AccessibilityService and the Universal Action Engine; Kimi K3, Master Agent and local memory; Chrome, a few test apps and the safety system. Core actions: OPEN\_APP, TAP, TYPE, SCROLL, BACK, COPY, PASTE, READ\_UI, WAIT, VERIFY.

**Scaling path:** v0.1 → Core Android → Browser → Chat apps → Creative apps → Social apps → Productivity apps → File apps → Communication → More web apps → Advanced workflow memory. Scaling mainly expands skills, UI handling and validated workflows, so a new AI model is not needed each time.

**Technical challenges**

| Challenge | Description |
| --- | --- |
| UI diversity | Every application has a different UI. |
| UI changes | App updates can move buttons and change layouts. |
| Accessibility limits | Not every UI element is accessible. |
| Visual understanding | Some situations need OCR or visual perception. |
| Security | OTP, CAPTCHA and biometrics can stop a workflow. |
| Android restrictions | Behavior differs across versions and manufacturers. |
| Reliability | Each action must be verified as successful or not. |

The hardest part of SuperiOA™ is not the LLM API but UI handling and reliable execution.

## 13. Legal Notice and Contact

**Definition.** SuperiOA™ — Intelligent Operation Agent is a concept for a universal Android and Web operation platform. It understands a user's natural-language goals, converts them into complex workflows and executes them in the real UI of installed applications, Chrome and web apps. This differs from a chatbot or a simple automation tool because one coordinated system operates available applications on the user's behalf.

**Copyright.** © 2026 PCMDK369™. All rights reserved. SuperiOA™ and PCMDK369™ are trademarks of PCMDK369™.

**Status.** This document describes a proposed architecture. Capabilities depend on the target application's accessibility exposure and on Android version and manufacturer behavior.

**Contact.** support.pcmdkai@gmail.com
