import { AgentClient } from "./agent.js";

const storageKey = "superioa.web.tasks.v1";
const activityKey = "superioa.web.activity.v1";
const taskInput = document.querySelector("#task-input");
const planButton = document.querySelector("#plan-task");
const saveDraftButton = document.querySelector("#save-draft");
const voiceButton = document.querySelector("#voice-task");
const searchInput = document.querySelector("#task-search");
const skillSearch = document.querySelector("#skill-search");
const notice = document.querySelector("#composer-notice");
const connectionNotice = document.querySelector("#connection-notice");
const agentClient = new AgentClient();
let currentPlanRequest = null;
const skillCatalog = [
  { id: 1, name: "Device Power & Hardware", areas: ["Device"], description: "Power, lock state, charging, hardware controls, and device information." },
  { id: 2, name: "Android Navigation & System UI", areas: ["Device"], description: "Home, back, recents, notifications, quick settings, and system panels." },
  { id: 3, name: "Touch & Gesture", areas: ["Device"], description: "Taps, presses, swipes, scrolling, drag-and-drop, and touch controls." },
  { id: 4, name: "Keyboard & Text Editing", areas: ["Device"], description: "Text entry, selection, clipboard, cursor movement, and editing operations." },
  { id: 5, name: "App Installation & Management", areas: ["Device", "Browser & apps"], description: "Launching and managing apps, with operating-system confirmation kept in control." },
  { id: 6, name: "Notifications", areas: ["Device", "Communication"], description: "Read and manage notification surfaces and their available actions." },
  { id: 7, name: "Quick Settings & Connectivity", areas: ["Device"], description: "System connectivity panels and device-level toggles." },
  { id: 8, name: "Display, Sound & Accessibility Settings", areas: ["Device"], description: "Display preferences, audio controls, and accessibility configuration." },
  { id: 9, name: "Camera & Capture", areas: ["Device", "Media"], description: "Camera launch and capture flows that remain subject to visible user control." },
  { id: 10, name: "Gallery, Photos & Images", areas: ["Device", "Media"], description: "Browse, select, organize, and share local visual media." },
  { id: 11, name: "Video & Audio", areas: ["Media"], description: "Playback, recording, and media controls exposed by supported apps." },
  { id: 12, name: "Files & Folders", areas: ["Device", "Productivity"], description: "Browse local files, folders, document pickers, and file-transfer flows." },
  { id: 13, name: "Browser & Web", areas: ["Browser & apps"], description: "Browser navigation and accessible interactions with websites and web apps." },
  { id: 14, name: "Communication: Calls, SMS & Contacts", areas: ["Communication"], description: "Contact and communication workflows; sending or calling requires user confirmation." },
  { id: 15, name: "Email", areas: ["Communication", "Productivity"], description: "Email navigation and drafting, with send actions held for explicit approval." },
  { id: 16, name: "Social Media", areas: ["Browser & apps", "Media"], description: "Social app navigation and content preparation; publishing is not automatic." },
  { id: 17, name: "YouTube & Video Platforms", areas: ["Browser & apps", "Media"], description: "Video platform browsing, playback, and accessible creator workflows." },
  { id: 18, name: "Messaging Apps", areas: ["Communication", "Browser & apps"], description: "Messaging app navigation and draft preparation; sending stays approval-gated." },
  { id: 19, name: "AI Chat Apps", areas: ["Browser & apps"], description: "Navigate supported assistant apps without exposing private UI content by default." },
  { id: 20, name: "Canva & Creative Apps", areas: ["Browser & apps", "Media"], description: "Creative-tool navigation, editing flows, and export preparation." },
  { id: 21, name: "Maps & Location", areas: ["Productivity", "Privacy"], description: "Map search and navigation surfaces; location access remains permissioned." },
  { id: 22, name: "Calendar, Clock & Tasks", areas: ["Productivity"], description: "Calendar, reminder, timer, and task-management workflows." },
  { id: 23, name: "Notes & Documents", areas: ["Productivity"], description: "Create, edit, review, and organize notes and document workflows." },
  { id: 24, name: "Security, Accounts & Privacy", areas: ["Privacy"], description: "Security and account surfaces. Passwords, OTPs, biometrics, and challenges stay user-only." },
  { id: 25, name: "Browser Accounts & Forms", areas: ["Browser & apps", "Privacy"], description: "Accessible web forms and account pages; authentication checkpoints are never bypassed." },
  { id: 26, name: "Shopping & Payments (User-Level)", areas: ["Privacy", "Browser & apps"], description: "Shopping flows may be prepared, but purchases and payment confirmation require the user." },
  { id: 27, name: "Music & Podcasts", areas: ["Media"], description: "Browse audio libraries and use supported playback controls." },
  { id: 28, name: "System Files, Backup & Sharing", areas: ["Device", "Privacy"], description: "System file and sharing workflows with destructive or sensitive steps gated." },
  { id: 29, name: "Multitasking & Cross-App Workflows", areas: ["Productivity", "Browser & apps"], description: "Coordinate app transitions and verified handoffs across a single task." },
  { id: 30, name: "Device Maintenance & Recovery", areas: ["Device"], description: "Device status and recovery workflows that respect Android system safeguards." },
  { id: 31, name: "Cross-Object User Actions", areas: ["Productivity"], description: "General actions applied to user-selected objects across supported contexts." },
  { id: 32, name: "App-Specific Manual Actions", areas: ["Browser & apps"], description: "Reusable app-specific interaction patterns; each target still needs validation." },
  { id: 33, name: "Granular UI Object Actions", areas: ["Productivity", "Device"], description: "Fine-grained operations on accessible interface objects, where exposed." },
  { id: 34, name: "Contextual UI Actions", areas: ["Productivity", "Device"], description: "Actions selected from current screen context, subject to confidence and safety checks." },
];
let selectedSkillArea = "All";

function readList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

let tasks = readList(storageKey).filter((task) => task && typeof task.id === "string" && typeof task.text === "string");
let activity = readList(activityKey).filter((entry) => entry && typeof entry.text === "string");

function save() {
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  localStorage.setItem(activityKey, JSON.stringify(activity.slice(0, 40)));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function addActivity(text) {
  activity.unshift({ text, createdAt: Date.now() });
  activity = activity.slice(0, 40);
}

function taskMarkup(task) {
  return `<article class="task-row">
    <span class="task-leading" aria-hidden="true">↗</span>
    <div class="task-copy"><strong title="${escapeHtml(task.text)}">${escapeHtml(task.text)}</strong><small>Added ${relativeTime(task.createdAt)} · This browser</small></div>
    <span class="status-tag draft">Draft</span>
    <button class="delete-task" data-delete="${escapeHtml(task.id)}" aria-label="Remove task: ${escapeHtml(task.text)}" title="Remove draft">×</button>
  </article>`;
}

function renderTasks() {
  const overviewTasks = tasks.slice(0, 4);
  document.querySelector("#overview-task-list").innerHTML = overviewTasks.map(taskMarkup).join("");
  document.querySelector("#full-task-list").innerHTML = tasks
    .filter((task) => task.text.toLowerCase().includes((searchInput?.value || "").trim().toLowerCase()))
    .map(taskMarkup).join("");
  document.querySelector("#overview-empty").hidden = tasks.length > 0;
  const visibleCount = document.querySelectorAll("#full-task-list .task-row").length;
  document.querySelector("#tasks-empty").hidden = visibleCount > 0;
  document.querySelector("#task-count").textContent = String(tasks.length);
  document.querySelector("#nav-count").textContent = String(tasks.length);
  document.querySelector("#all-task-count").textContent = `${tasks.length} ${tasks.length === 1 ? "draft" : "drafts"}`;
}

function renderActivity() {
  const list = document.querySelector("#activity-list");
  list.innerHTML = activity.map((entry) => `<article class="activity-entry">
    <span class="activity-dot" aria-hidden="true"></span>
    <div><p>${escapeHtml(entry.text)}</p><time>${relativeTime(entry.createdAt)}</time></div>
  </article>`).join("");
  document.querySelector("#activity-empty").hidden = activity.length > 0;
}

function renderSkills() {
  const query = skillSearch.value.trim().toLowerCase();
  const matching = skillCatalog.filter((skill) => {
    const matchesArea = selectedSkillArea === "All" || skill.areas.includes(selectedSkillArea);
    const matchesSearch = `${skill.name} ${skill.description} ${skill.areas.join(" ")}`.toLowerCase().includes(query);
    return matchesArea && matchesSearch;
  });
  document.querySelector("#skill-grid").innerHTML = matching.map((skill) => `
    <article class="skill-card">
      <div class="skill-card-top"><span class="skill-number">${String(skill.id).padStart(2, "0")}</span><span class="status-tag neutral">Catalog only</span></div>
      <h2>${escapeHtml(skill.name)}</h2>
      <p>${escapeHtml(skill.description)}</p>
      <div class="skill-card-bottom"><span class="skill-area">${skill.areas.map(escapeHtml).join(" · ")}</span><span class="skill-unavailable" aria-label="Not executable">Not connected</span></div>
    </article>`).join("");
  document.querySelector("#skill-result-count").textContent = `${matching.length} ${matching.length === 1 ? "skill domain" : "skill domains"}`;
  document.querySelector("#skills-empty").hidden = matching.length > 0;
}

function render() {
  renderTasks();
  renderActivity();
  renderSkills();
}

function setView(name) {
  const views = ["overview", "tasks", "skills", "workflows", "activity", "integrations"];
  if (!views.includes(name)) return;
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === `view-${name}`;
    view.classList.toggle("active-view", active);
    view.hidden = !active;
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    const active = item.dataset.view === name;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  const labels = { overview: "Overview", tasks: "Task queue", skills: "Skills", workflows: "Workflows", activity: "Activity", integrations: "Integrations" };
  document.querySelector("#breadcrumb-current").textContent = labels[name];
}

function createTask() {
  const text = taskInput.value.trim();
  if (!text) return;
  const task = { id: crypto.randomUUID(), text, createdAt: Date.now() };
  tasks.unshift(task);
  addActivity(`Saved draft: ${text}`);
  save();
  render();
  taskInput.value = "";
  taskInput.dispatchEvent(new Event("input", { bubbles: true }));
  notice.textContent = "Draft saved locally. It has not been sent to an AI provider or executed.";
  taskInput.focus();
}

function renderPlan(plan, engineId) {
  const result = document.querySelector("#plan-result");
  const actions = plan.actions.map((action) => {
    const description = [action.action, action.target, action.text].filter(Boolean).join(" · ");
    const approval = action.requiresApproval
      ? `<p class="approval-note">User approval required: ${escapeHtml(action.approvalReason)}</p>`
      : "";
    return `<li class="recommended-action">
      <span class="recommendation-badge">Recommended · ${escapeHtml(action.action)}</span>
      <strong>${escapeHtml(action.recommendation)}</strong>
      <p class="action-execution">Execution step: ${escapeHtml(description)}</p>
      <p class="action-route">Agent: ${escapeHtml(action.agent)} · Sub-agent: ${escapeHtml(action.subAgent)} · Skill: ${escapeHtml(action.skill)}</p>
      ${approval}
    </li>`;
  }).join("");
  const hasApproval = plan.actions.some((action) => action.requiresApproval);
  result.innerHTML = `<p class="mono-label">PLAN PREVIEW · ${escapeHtml(engineId)}</p>
    <h2>${escapeHtml(plan.summary)}</h2>
    <p>Route: ${escapeHtml(plan.domain)} → ${escapeHtml(plan.agent)} → ${escapeHtml(plan.subAgent)}${plan.preSubAgent ? ` → ${escapeHtml(plan.preSubAgent)}` : ""} → ${escapeHtml(plan.skill)}</p>
    <p>Expected result: ${escapeHtml(plan.expectedResult)}</p>
    <p class="preview-note">Every step is a recommendation. Review the complete workflow before execution; extra steps are included when needed to meet the expected result.</p>
    <ol>${actions}</ol>
    ${hasApproval ? '<p class="approval-note">One or more steps require explicit user approval before any execution.</p>' : ""}
    <p class="preview-note">This web app creates a plan preview only. Browser security does not let this page operate other websites or Android apps. Use the Android app for explicitly enabled local Accessibility actions.</p>`;
  result.hidden = false;
}

function speak(text) {
  if (!document.querySelector("#voice-output").checked) return;
  if (!("speechSynthesis" in window)) {
    notice.textContent = "This browser does not provide speech output. The plan is available as text.";
    return;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

async function planTask() {
  const task = taskInput.value.trim();
  if (!task) return;
  currentPlanRequest = new AbortController();
  planButton.disabled = true;
  voiceButton.disabled = true;
  document.querySelector("#cancel-plan").hidden = false;
  notice.textContent = "Planning with the authenticated SuperiOA backend…";
  document.querySelector("#plan-result").hidden = true;
  try {
    const { plan, engineId } = await agentClient.plan(task, { signal: currentPlanRequest.signal });
    renderPlan(plan, engineId);
    notice.textContent = "Plan ready. No device or browser actions have been executed.";
    speak(`${plan.summary}. ${plan.actions.length} steps planned. ${plan.expectedResult}`);
    addActivity(`Planned task: ${plan.summary}`);
    save();
    renderActivity();
  } catch (error) {
    if (error?.name === "AbortError") {
      notice.textContent = "Planning canceled. No actions were executed.";
    } else {
      notice.textContent = error instanceof Error ? error.message : "Planning failed.";
    }
  } finally {
    currentPlanRequest = null;
    document.querySelector("#cancel-plan").hidden = true;
    planButton.disabled = !taskInput.value.trim();
    voiceButton.disabled = false;
  }
}

function updateIntegrationStatus() {
  const configured = Boolean(agentClient.settings.supabaseUrl && agentClient.settings.anonKey);
  document.querySelector("#supabase-status").textContent = configured ? "Configured" : "Offline";
  document.querySelector("#supabase-status").className = `status-tag ${configured ? "ready" : "neutral"}`;
  document.querySelector("#supabase-status-text").textContent = configured
    ? "Public project settings saved"
    : "Not connected";
  document.querySelector("#llm-status-text").textContent = configured
    ? (agentClient.isSignedIn ? "Authenticated; test backend readiness" : "Sign in to check backend readiness")
    : "Configure Supabase Auth";
  document.querySelector("#llm-status").textContent = agentClient.isSignedIn ? "Auth only" : "Offline";
  document.querySelector("#llm-status").className = `status-tag ${agentClient.isSignedIn ? "neutral" : "offline"}`;
  document.querySelector("#supabase-url").value = agentClient.settings.supabaseUrl;
  document.querySelector("#supabase-anon-key").value = agentClient.settings.anonKey;
}

function startVoiceTask() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    notice.textContent = "Speech recognition is not supported in this browser. Type your task instead.";
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;
  voiceButton.disabled = true;
  notice.textContent = "Listening. Speak your task now.";
  recognition.onresult = (event) => {
    taskInput.value = event.results[0][0].transcript;
    taskInput.dispatchEvent(new Event("input", { bubbles: true }));
    planTask();
  };
  recognition.onerror = (event) => {
    notice.textContent = event.error === "not-allowed"
      ? "Microphone access was denied. Allow it in browser settings or type your task."
      : `Speech recognition failed (${event.error}). You can type your task instead.`;
    voiceButton.disabled = false;
  };
  recognition.onend = () => { voiceButton.disabled = false; };
  try {
    recognition.start();
  } catch {
    voiceButton.disabled = false;
    notice.textContent = "Could not start speech recognition. Type your task instead.";
  }
}

function deleteTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task) return;
  tasks = tasks.filter((item) => item.id !== id);
  addActivity(`Removed draft: ${task.text}`);
  save();
  render();
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) setView(viewButton.dataset.view);
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) deleteTask(deleteButton.dataset.delete);
});

taskInput.addEventListener("input", () => {
  planButton.disabled = taskInput.value.trim().length === 0;
  saveDraftButton.disabled = taskInput.value.trim().length === 0;
  document.querySelector("#task-character-count").textContent = `${taskInput.value.length.toLocaleString()} / 2,000`;
  notice.textContent = "";
});
taskInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !planButton.disabled) planTask();
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    taskInput.value = button.dataset.prompt;
    taskInput.dispatchEvent(new Event("input", { bubbles: true }));
    taskInput.focus();
  });
});
planButton.addEventListener("click", planTask);
voiceButton.addEventListener("click", startVoiceTask);
saveDraftButton.addEventListener("click", createTask);
document.querySelector("#connection-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    agentClient.saveSettings(
      document.querySelector("#supabase-url").value,
      document.querySelector("#supabase-anon-key").value,
    );
    connectionNotice.textContent = "Supabase public project settings saved in this browser.";
    updateIntegrationStatus();
  } catch (error) {
    connectionNotice.textContent = error instanceof Error ? error.message : "Could not save Supabase settings.";
  }
});
document.querySelector("#test-connections").addEventListener("click", async () => {
  const button = document.querySelector("#test-connections");
  const health = document.querySelector("#connection-health");
  button.disabled = true;
  button.textContent = "Checking connections…";
  health.hidden = true;
  try {
    if (document.querySelector("#supabase-url").value !== agentClient.settings.supabaseUrl ||
      document.querySelector("#supabase-anon-key").value !== agentClient.settings.anonKey) {
      agentClient.saveSettings(
        document.querySelector("#supabase-url").value,
        document.querySelector("#supabase-anon-key").value,
      );
      updateIntegrationStatus();
    }
    const connections = await agentClient.checkConnections();
    const lines = [
      `<li><span>Supabase Auth</span><strong class="health-ready">Reachable</strong></li>`,
    ];
    if (!connections.backend) {
      lines.push(`<li><span>SuperiOA backend</span><strong class="health-pending">Sign in to check</strong></li>`);
      lines.push(`<li><span>LLM providers and usage database</span><strong class="health-pending">Backend check requires sign-in</strong></li>`);
    } else {
      const { databaseAvailable, enabledEngineSlots, configuredEngineSlots } = connections.backend;
      lines.push(`<li><span>SuperiOA backend</span><strong class="${connections.backend.status === "ready" ? "health-ready" : "health-pending"}">${connections.backend.status === "ready" ? "Reachable" : "Degraded"}</strong></li>`);
      lines.push(`<li><span>Usage database</span><strong class="${databaseAvailable ? "health-ready" : "health-error"}">${databaseAvailable ? "Available" : "Unavailable"}</strong></li>`);
      lines.push(`<li><span>LLM engine slots</span><strong class="${configuredEngineSlots > 0 ? "health-ready" : "health-pending"}">${configuredEngineSlots} configured · ${enabledEngineSlots} enabled</strong></li>`);
      lines.push(`<li class="health-footnote">Provider connectivity is not tested here; checking providers requires a planning request and may incur usage charges.</li>`);
    }
    health.innerHTML = `<p class="mono-label">CONNECTION CHECK</p><ul>${lines.join("")}</ul>`;
    health.hidden = false;
    connectionNotice.textContent = "Connection check complete. No provider request was sent.";
  } catch (error) {
    connectionNotice.textContent = error instanceof Error ? error.message : "Could not check API connections.";
  } finally {
    button.disabled = false;
    button.textContent = "Test API connections";
  }
});
document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#auth-email").value.trim();
  const passwordField = document.querySelector("#auth-password");
  const password = passwordField.value;
  document.querySelector("#sign-in").disabled = true;
  try {
    if (document.querySelector("#supabase-url").value !== agentClient.settings.supabaseUrl ||
      document.querySelector("#supabase-anon-key").value !== agentClient.settings.anonKey) {
      agentClient.saveSettings(
        document.querySelector("#supabase-url").value,
        document.querySelector("#supabase-anon-key").value,
      );
    }
    await agentClient.signIn(email, password);
    connectionNotice.textContent = `Signed in as ${email}. The session is held in memory for this page only.`;
    document.querySelector("#sign-out").hidden = false;
    updateIntegrationStatus();
  } catch (error) {
    connectionNotice.textContent = error instanceof Error ? error.message : "Sign-in failed.";
  } finally {
    passwordField.value = "";
    document.querySelector("#sign-in").disabled = false;
  }
});
document.querySelector("#sign-out").addEventListener("click", () => {
  agentClient.signOut();
  document.querySelector("#sign-out").hidden = true;
  document.querySelector("#llm-status").textContent = "Offline";
  document.querySelector("#llm-status").className = "status-tag offline";
  connectionNotice.textContent = "Signed out.";
  updateIntegrationStatus();
});
document.querySelector("#cancel-plan").addEventListener("click", () => currentPlanRequest?.abort());
searchInput.addEventListener("input", renderTasks);
skillSearch.addEventListener("input", renderSkills);
document.querySelectorAll("[data-skill-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedSkillArea = button.dataset.skillFilter;
    document.querySelectorAll("[data-skill-filter]").forEach((filter) => {
      const selected = filter === button;
      filter.classList.toggle("selected", selected);
      filter.setAttribute("aria-pressed", String(selected));
    });
    renderSkills();
  });
});

document.querySelector("#date-stamp").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short", month: "short", day: "numeric", year: "numeric",
});
updateIntegrationStatus();
render();