const settingsKey = "superioa.web.connection.v1";
const supportedActions = new Set([
  "OPEN_APP", "BACK", "HOME", "RECENTS", "TAP", "TYPE", "SCROLL", "SWIPE",
  "COPY", "PASTE", "READ_UI", "WAIT", "VERIFY", "RETRY", "ABORT", "REQUEST_USER",
]);

export function validateAgentPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("The planner returned an invalid plan.");
  }
  for (const field of ["summary", "domain", "subAgent", "skill", "expectedResult"]) {
    if (typeof plan[field] !== "string" || !plan[field].trim() || plan[field].length > 300) {
      throw new Error("The planner returned an incomplete plan.");
    }
  }
  if (plan.preSubAgent !== undefined && plan.preSubAgent !== null &&
    (typeof plan.preSubAgent !== "string" || plan.preSubAgent.length > 120)) {
    throw new Error("The planner returned an invalid plan route.");
  }
  if (!Array.isArray(plan.actions) || plan.actions.length < 1 || plan.actions.length > 50) {
    throw new Error("The planner returned an invalid action list.");
  }
  const targetRequired = new Set(["OPEN_APP", "TAP", "TYPE", "SCROLL", "SWIPE", "VERIFY"]);
  const textRequired = new Set(["TYPE", "REQUEST_USER"]);
  for (const action of plan.actions) {
    if (!action || typeof action !== "object" || !supportedActions.has(action.action)) {
      throw new Error("The planner returned an unsupported action.");
    }
    if (targetRequired.has(action.action) && (typeof action.target !== "string" || !action.target.trim())) {
      throw new Error("The planner returned an action without a target.");
    }
    if (!targetRequired.has(action.action) && action.target !== undefined) {
      throw new Error("The planner returned an unexpected action target.");
    }
    if (textRequired.has(action.action) && (typeof action.text !== "string" || !action.text.trim())) {
      throw new Error("The planner returned an action without required text.");
    }
    if (!textRequired.has(action.action) && action.text !== undefined) {
      throw new Error("The planner returned unexpected action text.");
    }
    if (typeof action.target === "string" && action.target.length > 200) {
      throw new Error("The planner returned an oversized action target.");
    }
    if (typeof action.text === "string" && action.text.length > 2_000) {
      throw new Error("The planner returned oversized action text.");
    }
    if (action.requiresApproval !== undefined && typeof action.requiresApproval !== "boolean") {
      throw new Error("The planner returned an invalid approval flag.");
    }
    if (action.approvalReason !== undefined && typeof action.approvalReason !== "string") {
      throw new Error("The planner returned an invalid approval reason.");
    }
    if (action.requiresApproval && (!action.approvalReason || !action.approvalReason.trim())) {
      throw new Error("The planner returned an action without an approval reason.");
    }
    if (!action.requiresApproval && action.approvalReason !== undefined) {
      throw new Error("The planner returned an unexpected approval reason.");
    }
    if (action.timeoutMs !== undefined &&
      (!Number.isInteger(action.timeoutMs) || action.timeoutMs < 1 || action.timeoutMs > 30_000)) {
      throw new Error("The planner returned an invalid action timeout.");
    }
    if (action.action === "TYPE" &&
      /\b(password|passcode|otp|one[- ]time code|captcha|biometric|fingerprint|face id|security code)\b/i.test(action.target)) {
      throw new Error("The planner cannot automate authentication or security checkpoints.");
    }
  }
  if (!plan.actions.some((action) => action.action === "VERIFY")) {
    throw new Error("The planner did not include a verification step.");
  }
  return plan;
}

export class AgentClient {
  constructor() {
    this.accessToken = null;
    this.settings = this.readSettings();
  }

  readSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem(settingsKey) || "{}");
      return {
        supabaseUrl: typeof settings.supabaseUrl === "string" ? settings.supabaseUrl.replace(/\/+$/, "") : "",
        anonKey: typeof settings.anonKey === "string" ? settings.anonKey : "",
      };
    } catch {
      return { supabaseUrl: "", anonKey: "" };
    }
  }

  saveSettings(supabaseUrl, anonKey) {
    const normalizedUrl = supabaseUrl.trim().replace(/\/+$/, "");
    let parsed;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      throw new Error("Enter a valid Supabase project URL.");
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("Supabase must use HTTPS.");
    }
    if (!anonKey.trim()) throw new Error("Enter the Supabase publishable/anon key.");
    this.settings = { supabaseUrl: normalizedUrl, anonKey: anonKey.trim() };
    localStorage.setItem(settingsKey, JSON.stringify(this.settings));
  }

  async signIn(email, password) {
    const { supabaseUrl, anonKey } = this.settings;
    if (!supabaseUrl || !anonKey) throw new Error("Save your Supabase URL and public key first.");
    let result;
    try {
      result = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error("Could not reach Supabase Auth. Check the URL and your connection.");
    }
    const body = await result.json().catch(() => ({}));
    if (!result.ok || typeof body.access_token !== "string") {
      throw new Error(result.status === 400 || result.status === 401
        ? "Sign-in failed. Check the email and password."
        : "Supabase sign-in is unavailable. Check the project configuration.");
    }
    this.accessToken = body.access_token;
  }

  signOut() {
    this.accessToken = null;
  }

  get isSignedIn() {
    return this.accessToken !== null;
  }

  async plan(task, { signal } = {}) {
    const { supabaseUrl, anonKey } = this.settings;
    if (!this.accessToken) throw new Error("Sign in to Supabase before asking SuperiOA to plan.");
    let result;
    try {
      result = await fetch(`${supabaseUrl}/functions/v1/agent-execute`, {
        method: "POST",
        signal,
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ task, screenContext: "", mode: "plan" }),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error("Could not reach the SuperiOA backend. Check your network and Edge Function deployment.");
    }
    const body = await result.json().catch(() => ({}));
    if (!result.ok) {
      if (result.status === 401) this.signOut();
      const messages = {
        authentication_required: "Sign in to Supabase before asking SuperiOA to plan.",
        invalid_session: "Your session expired. Sign in again.",
        no_llm_engines_configured: "No LLM engine is configured on the trusted backend.",
        all_llm_engines_failed: "All configured LLM engines failed. Check their server-side configuration and retry.",
        usage_logging_unavailable: "Usage logging is unavailable. The plan was not returned.",
        backend_not_configured: "The SuperiOA backend is not configured yet.",
      };
      throw new Error(messages[body.error] || "The SuperiOA backend rejected the planning request.");
    }
    return {
      plan: validateAgentPlan(body.plan),
      engineId: typeof body.engineId === "string" ? body.engineId : "unknown",
    };
  }
}
