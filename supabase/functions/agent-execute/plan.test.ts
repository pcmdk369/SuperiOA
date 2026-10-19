import { validatePlan } from "./plan.ts";

const validPlan = {
  summary: "Search for project updates",
  domain: "Browser & Web",
  agent: "SuperiOA Coordinator",
  subAgent: "Research",
  preSubAgent: "Chrome",
  skill: "Chrome",
  expectedResult: "Search results are shown",
  actions: [
    {
      recommendationType: "RECOMMENDATION",
      recommendation:
        "Open Chrome to search for the requested project updates.",
      agent: "SuperiOA Coordinator",
      subAgent: "Browser Research",
      skill: "App Navigation",
      action: "OPEN_APP",
      target: "Chrome",
    },
    {
      recommendationType: "RECOMMENDATION",
      recommendation: "Confirm that project search results are visible.",
      agent: "SuperiOA Coordinator",
      subAgent: "Browser Research",
      skill: "Visible Result Verification",
      action: "VERIFY",
      target: "Search results",
    },
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
      [{ ...validPlan.actions[0], action: "RUN_SHELL" }],
      [{ ...validPlan.actions[0], action: "BACK" }],
      Array(51).fill(validPlan.actions[0]),
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
      { ...validPlan.actions[0], action: "TAP", target: "Send" },
      { ...validPlan.actions[1], target: "Message sent" },
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
        {
          ...validPlan.actions[0],
          action: "TYPE",
          target: "Password",
          text: "secret",
        },
        validPlan.actions[1],
      ],
    });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("A password-entry action was accepted.");
});

Deno.test("requires recommendation metadata and routing on every action", () => {
  for (
    const invalidAction of [
      { ...validPlan.actions[0], recommendationType: "EXECUTE" },
      { ...validPlan.actions[0], recommendation: "" },
      { ...validPlan.actions[0], skill: "" },
    ]
  ) {
    let rejected = false;
    try {
      validatePlan({
        ...validPlan,
        actions: [invalidAction, validPlan.actions[1]],
      });
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(
        "An action without complete recommendation metadata was accepted.",
      );
    }
  }
});
