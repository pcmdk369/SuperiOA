import assert from "node:assert/strict";
import test from "node:test";
import { AgentClient, validateAgentPlan } from "./agent.js";

const validPlan = {
  summary: "Open Chrome and search for a project update",
  domain: "Browser & Web",
  agent: "SuperiOA Coordinator",
  subAgent: "Research",
  preSubAgent: "Chrome",
  skill: "Chrome",
  expectedResult: "Search results are visible",
  actions: [
    {
      recommendationType: "RECOMMENDATION",
      recommendation: "Open Chrome to search for the requested project update.",
      agent: "SuperiOA Coordinator",
      subAgent: "Browser Research",
      skill: "App Navigation",
      action: "OPEN_APP",
      target: "Chrome",
      timeoutMs: 5_000,
    },
    {
      recommendationType: "RECOMMENDATION",
      recommendation: "Verify the project search results are visible.",
      agent: "SuperiOA Coordinator",
      subAgent: "Browser Research",
      skill: "Visible Result Verification",
      action: "VERIFY",
      target: "Search results",
      timeoutMs: 5_000,
    },
  ],
};

test("accepts a structured plan from the coordinator", () => {
  assert.deepEqual(validateAgentPlan(validPlan), validPlan);
});

test("requires approval for taps regardless of the UI label", () => {
  const plan = validateAgentPlan({
    ...validPlan,
    actions: [
      { ...validPlan.actions[0], action: "TAP", target: "Place order" },
      validPlan.actions[1],
    ],
  });
  assert.equal(plan.actions[0].requiresApproval, true);
  assert.equal(plan.actions[0].approvalReason, "Confirm this screen action before it runs.");
});

test("rejects unsupported, incomplete, or oversized plans", () => {
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: [{ ...validPlan.actions[0], action: "RUN_SHELL" }] }));
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: Array(51).fill(validPlan.actions[0]) }));
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: [{ ...validPlan.actions[0], action: "BACK" }] }));
});

test("rejects missing approval reasons and authentication automation", () => {
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], action: "TAP", target: "Send", requiresApproval: true },
      validPlan.actions[1]],
  }));
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], action: "TYPE", target: "Password", text: "secret" },
      validPlan.actions[1]],
  }));
});

test("requires a signed-in admin before planning", async () => {
  const client = new AgentClient();
  await assert.rejects(client.plan("Open Chrome"), /admin account/);
});

test("uses same-origin server login and never stores a Supabase token in the client", async () => {
  const client = new AgentClient();
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ email: "superintelligentcore@gmail.com" });
  };
  try {
    await client.signIn("superintelligentcore@gmail.com", "test-password");
    assert.equal(request.url, "/api/login");
    assert.equal(request.options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(request.options.body), {
      email: "superintelligentcore@gmail.com",
      password: "test-password",
    });
    assert.equal(client.email, "superintelligentcore@gmail.com");
    assert.equal("accessToken" in client, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restores a server session and uses the protected same-origin planning API", async () => {
  const client = new AgentClient();
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/session") {
      return Response.json({ authenticated: true, email: "support.pcmdkai@gmail.com" });
    }
    return Response.json({ plan: validPlan, engineId: "engine-1", taskId: "task-1" });
  };
  try {
    assert.equal(await client.restoreSession(), "support.pcmdkai@gmail.com");
    const result = await client.plan("Open Chrome");
    assert.equal(result.engineId, "engine-1");
    assert.deepEqual(requests.map((item) => item.url), ["/api/session", "/api/agent-execute"]);
    assert.equal(requests[1].options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(requests[1].options.body), { task: "Open Chrome" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports invalid credentials and planning rate limits without exposing backend details", async () => {
  const client = new AgentClient();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "invalid_credentials" }, { status: 401 });
  try {
    await assert.rejects(client.signIn("someone@example.com", "wrong"), /Admin sign-in failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
  client.email = "superintelligentcore@gmail.com";
  globalThis.fetch = async () => Response.json({ error: "plan_rate_limit_exceeded" }, { status: 429 });
  try {
    await assert.rejects(client.plan("Open Chrome"), /Too many planning requests/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
