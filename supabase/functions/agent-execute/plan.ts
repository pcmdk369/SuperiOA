export type Action = {
  recommendationType: "RECOMMENDATION";
  recommendation: string;
  agent: string;
  subAgent: string;
  skill: string;
  action: string;
  target?: string;
  text?: string;
  timeoutMs?: number;
  requiresApproval?: boolean;
  approvalReason?: string;
};

export type AgentPlan = {
  summary: string;
  domain: string;
  agent: string;
  subAgent: string;
  preSubAgent: string | null;
  skill: string;
  expectedResult: string;
  actions: Action[];
};

export class PlanError extends Error {}

const actionNames = new Set([
  "OPEN_APP",
  "BACK",
  "HOME",
  "RECENTS",
  "TAP",
  "TYPE",
  "SCROLL",
  "SWIPE",
  "COPY",
  "PASTE",
  "READ_UI",
  "WAIT",
  "VERIFY",
  "RETRY",
  "ABORT",
  "REQUEST_USER",
]);
const targetRequired = new Set([
  "OPEN_APP",
  "TAP",
  "TYPE",
  "SCROLL",
  "SWIPE",
  "VERIFY",
]);
const textRequired = new Set(["TYPE", "REQUEST_USER"]);
const maxRecommendationLength = 300;
const maxRouteLabelLength = 120;
const sensitiveContext =
  /\b(send|publish|post|delete|remove|purchase|buy|checkout|pay|payment|transfer|password|passcode|otp|captcha|biometric|security|confirm)\b/i;
const authenticationContext =
  /\b(password|passcode|otp|one[- ]time code|captcha|biometric|fingerprint|face id|security code)\b/i;

export function validatePlan(value: unknown): AgentPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlanError("invalid_plan");
  }
  const plan = value as Record<string, unknown>;
  const requiredLabels = [
    "summary",
    "domain",
    "agent",
    "subAgent",
    "skill",
    "expectedResult",
  ] as const;
  for (const label of requiredLabels) {
    if (
      typeof plan[label] !== "string" || !plan[label].trim() ||
      plan[label].length > 300
    ) {
      throw new PlanError("invalid_plan");
    }
  }
  for (const label of ["agent", "subAgent", "skill"] as const) {
    if (
      typeof plan[label] !== "string" || !plan[label].trim() ||
      plan[label].length > maxRouteLabelLength
    ) {
      throw new PlanError("invalid_plan_route");
    }
  }
  if (
    plan.preSubAgent !== null && plan.preSubAgent !== undefined &&
    (typeof plan.preSubAgent !== "string" || plan.preSubAgent.length > 120)
  ) {
    throw new PlanError("invalid_plan");
  }
  if (
    !Array.isArray(plan.actions) || plan.actions.length === 0 ||
    plan.actions.length > 50
  ) {
    throw new PlanError("invalid_plan");
  }

  const actions = plan.actions.map((candidate): Action => {
    if (
      !candidate || typeof candidate !== "object" || Array.isArray(candidate)
    ) {
      throw new PlanError("invalid_action");
    }
    const action = candidate as Record<string, unknown>;
    if (typeof action.action !== "string" || !actionNames.has(action.action)) {
      throw new PlanError("unsupported_action");
    }
    if (action.recommendationType !== "RECOMMENDATION") {
      throw new PlanError("action_must_be_recommended");
    }
    if (
      typeof action.recommendation !== "string" ||
      !action.recommendation.trim() ||
      action.recommendation.length > maxRecommendationLength
    ) {
      throw new PlanError("invalid_action_recommendation");
    }
    for (const label of ["agent", "subAgent", "skill"] as const) {
      if (
        typeof action[label] !== "string" || !action[label].trim() ||
        action[label].length > maxRouteLabelLength
      ) {
        throw new PlanError("invalid_action_route");
      }
    }
    if (
      targetRequired.has(action.action) &&
      (typeof action.target !== "string" || !action.target.trim())
    ) {
      throw new PlanError("missing_action_target");
    }
    if (
      action.target !== undefined &&
      (typeof action.target !== "string" || action.target.length > 200)
    ) {
      throw new PlanError("invalid_action_target");
    }
    if (
      textRequired.has(action.action) &&
      (typeof action.text !== "string" || !action.text.trim())
    ) {
      throw new PlanError("missing_action_text");
    }
    if (
      action.text !== undefined &&
      (typeof action.text !== "string" || action.text.length > 2_000)
    ) {
      throw new PlanError("invalid_action_text");
    }
    if (!textRequired.has(action.action) && action.text !== undefined) {
      throw new PlanError("unexpected_action_text");
    }
    if (!targetRequired.has(action.action) && action.target !== undefined) {
      throw new PlanError("unexpected_action_target");
    }
    const timeoutMs = action.timeoutMs ?? 5_000;
    if (
      typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 || timeoutMs > 30_000
    ) {
      throw new PlanError("invalid_action_timeout");
    }
    if (
      action.requiresApproval !== undefined &&
      typeof action.requiresApproval !== "boolean"
    ) {
      throw new PlanError("invalid_approval_flag");
    }
    if (
      action.approvalReason !== undefined &&
      (typeof action.approvalReason !== "string" ||
        action.approvalReason.length > 200)
    ) {
      throw new PlanError("invalid_approval_reason");
    }
    if (
      Boolean(action.requiresApproval) &&
      (typeof action.approvalReason !== "string" ||
        !action.approvalReason.trim())
    ) {
      throw new PlanError("missing_approval_reason");
    }
    if (!action.requiresApproval && action.approvalReason !== undefined) {
      throw new PlanError("unexpected_approval_reason");
    }
    if (
      action.action === "TYPE" &&
      authenticationContext.test(String(action.target))
    ) {
      throw new PlanError("manual_security_checkpoint_required");
    }

    const approved = Boolean(action.requiresApproval) ||
      sensitiveContext.test(
        `${String(action.target ?? "")} ${String(action.text ?? "")}`,
      );
    return {
      recommendationType: "RECOMMENDATION",
      recommendation: action.recommendation as string,
      agent: action.agent as string,
      subAgent: action.subAgent as string,
      skill: action.skill as string,
      action: action.action,
      ...(action.target === undefined
        ? {}
        : { target: action.target as string }),
      ...(action.text === undefined ? {} : { text: action.text as string }),
      timeoutMs,
      ...(approved
        ? {
          requiresApproval: true,
          approvalReason: typeof action.approvalReason === "string"
            ? action.approvalReason
            : "This action may affect a sensitive or external operation.",
        }
        : {}),
    };
  });
  if (!actions.some((action) => action.action === "VERIFY")) {
    throw new PlanError("missing_task_verification");
  }

  return {
    summary: plan.summary as string,
    domain: plan.domain as string,
    agent: plan.agent as string,
    subAgent: plan.subAgent as string,
    preSubAgent: (plan.preSubAgent as string | null | undefined) ?? null,
    skill: plan.skill as string,
    expectedResult: plan.expectedResult as string,
    actions,
  };
}
