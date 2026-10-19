import { validatePlan } from "./plan.ts";

const validPlan = {
  summary: "Search for project updates",
  domain: "Browser & Web",
  subAgent: "Research",
  preSubAgent: "Chrome",
  skill: "Chrome",
  expectedResult: "Search results are shown",
  actions: [
    { action: "OPEN_APP", target: "Chrome" },
    { action: "VERIFY", target: "Search results" },
  ],
};

Deno.test("accepts an action plan with verification", () => {
  const plan = validatePlan(validPlan);
  if (plan.actions.length !== 2 || plan.actions[0].timeoutMs !== 5_000) {
    throw new Error(
      "The validated plan did not preserve the expected defaults.",
    );
  }
});

Deno.test("rejects unsupported or unverified action plans", () => {
  for (
    const actions of [
      [{ action: "RUN_SHELL" }],
      [{ action: "BACK" }],
      Array(51).fill({ action: "BACK" }),
    ]
  ) {
    let rejected = false;
    try {
      validatePlan({ ...validPlan, actions });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("An invalid action plan was accepted.");
  }
});

Deno.test("requires user approval for sensitive actions", () => {
  const plan = validatePlan({
    ...validPlan,
    actions: [
      { action: "TAP", target: "Send" },
      { action: "VERIFY", target: "Message sent" },
    ],
  });
  if (!plan.actions[0].requiresApproval || !plan.actions[0].approvalReason) {
    throw new Error("The sensitive action was not approval-gated.");
  }
});

Deno.test("never plans automated password entry", () => {
  let rejected = false;
  try {
    validatePlan({
      ...validPlan,
      actions: [
        { action: "TYPE", target: "Password", text: "secret" },
        validPlan.actions[1],
      ],
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("A password-entry action was accepted.");
});
