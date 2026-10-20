const supportedActions = new Set([
  "OPEN_APP", "OPEN_URL", "BACK", "HOME", "RECENTS", "TAP", "TYPE", "SCROLL", "SWIPE",
  "COPY", "PASTE", "READ_UI", "WAIT", "VERIFY", "RETRY", "ABORT", "REQUEST_USER",
]);

export function validateAgentPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("The planner returned an invalid plan.");
  }
  for (const field of ["summary", "domain", "agent", "subAgent", "skill", "expectedResult"]) {
    if (typeof plan[field] !== "string" || !plan[field].trim() || plan[field].length > 300) {
      throw new Error("The planner returned an incomplete plan.");
    }
  }
  for (const field of ["agent", "subAgent", "skill"]) {
    if (plan[field].length > 120) throw new Error("The planner returned an invalid plan route.");
  }
  if (plan.preSubAgent !== undefined && plan.preSubAgent !== null &&
    (typeof plan.preSubAgent !== "string" || plan.preSubAgent.length > 120)) {
    throw new Error("The planner returned an invalid plan route.");
  }
  if (!Array.isArray(plan.actions) || plan.actions.length < 1 || plan.actions.length > 50) {
    throw new Error("The planner returned an invalid action list.");
  }
  const targetRequired = new Set(["OPEN_APP", "OPEN_URL", "TAP", "TYPE", "SCROLL", "SWIPE", "VERIFY"]);
  const textRequired = new Set(["TYPE", "REQUEST_USER"]);
  for (const action of plan.actions) {
    if (!action || typeof action !== "object" || !supportedActions.has(action.action)) {
      throw new Error("The planner returned an unsupported action.");
    }
    if (action.recommendationType !== "RECOMMENDATION") {
      throw new Error("Every planned action must be a recommendation.");
    }
    if (typeof action.recommendation !== "string" || !action.recommendation.trim() || action.recommendation.length > 300) {
      throw new Error("The planner returned an action without a valid recommendation.");
    }
    for (const field of ["agent", "subAgent", "skill"]) {
      if (typeof action[field] !== "string" || !action[field].trim() || action[field].length > 120) {
        throw new Error("The planner returned an action without valid agent, sub-agent, and skill attribution.");
      }
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
    if (action.approvalReason !== undefined &&
      (typeof action.approvalReason !== "string" || action.approvalReason.length > 200)) {
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
  return {
    ...plan,
    actions: plan.actions.map((action) => action.action === "TAP"
      ? {
        ...action,
        requiresApproval: true,
        approvalReason: "Confirm this screen action before it runs.",
      }
      : action),
  };
}

export class AgentClient {
  constructor() {
    this.email = null;
  }

  async request(path, body, { signal } = {}) {
    let result;
    try {
      result = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error("Could not reach the SuperiOA service. Check your connection.");
    }
    const response = await result.json().catch(() => ({}));
    if (!result.ok) {
      if (result.status === 401 && path !== "/api/login") this.email = null;
      const messages = {
        invalid_credentials: "Admin sign-in failed. Check the email and password.",
        login_rate_limited: "Too many sign-in attempts. Wait 15 minutes and try again.",
        authentication_required: "Sign in with an admin account before requesting a plan.",
        session_expired: "Your session expired. Sign in again.",
        agent_rate_limited: "Too many requests. Wait a minute and try again.",
        no_llm_engines_configured: "No LLM engine is configured on the trusted backend.",
        plan_rate_limit_exceeded: "Too many planning requests. Wait one minute and try again.",
        rate_limit_unavailable: "The request limit could not be checked. Planning is temporarily unavailable.",
        all_llm_engines_failed: "All configured LLM engines failed. Check their server-side configuration and retry.",
        usage_logging_unavailable: "Usage logging is unavailable. The plan was not returned.",
        backend_not_configured: "The SuperiOA backend is not configured yet.",
        server_not_configured: "The SuperiOA service is not configured yet.",
      };
      throw new Error(messages[response.error] || "The SuperiOA service rejected the request.");
    }
    return response;
  }

  async signIn(email, password) {
    const result = await this.request("/api/login", { email, password });
    if (typeof result.email !== "string") throw new Error("The service returned an invalid sign-in response.");
    this.email = result.email;
  }

  async restoreSession() {
    const result = await this.request("/api/session");
    this.email = result.authenticated && typeof result.email === "string" ? result.email : null;
    return this.email;
  }

  async signOut() {
    try {
      await this.request("/api/logout", {});
    } finally {
      this.email = null;
    }
  }

  get isSignedIn() {
    return this.email !== null;
  }

  async checkConnections() {
    if (!this.isSignedIn) throw new Error("Sign in with an admin account to check service status.");
    return this.request("/api/agent-execute", { mode: "status" });
  }

  async plan(task, { signal } = {}) {
    if (!this.isSignedIn) throw new Error("Sign in with an admin account before requesting a plan.");
    const body = await this.request("/api/agent-execute", { task }, { signal });
    return {
      plan: validateAgentPlan(body.plan),
      engineId: typeof body.engineId === "string" ? body.engineId : "unknown",
    };
  }
}
