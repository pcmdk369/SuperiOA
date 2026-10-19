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
  assert.equal(validateAgentPlan(validPlan), validPlan);
});

test("rejects unsupported or oversized plans", () => {
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: [{ ...validPlan.actions[0], action: "RUN_SHELL" }] }));
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: Array(51).fill(validPlan.actions[0]) }));
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: [{ ...validPlan.actions[0], action: "BACK" }] }));
});

test("requires an approval reason for explicitly gated actions", () => {
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], action: "TAP", target: "Send", requiresApproval: true }],
  }));
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], action: "TYPE", target: "Password", text: "secret" }, ...validPlan.actions.slice(1)],
  }));
});

test("requires recommendation type, explanation, and agent routing for every action", () => {
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], recommendationType: "EXECUTE" }, validPlan.actions[1]],
  }), /recommendation/);
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], recommendation: "" }, validPlan.actions[1]],
  }), /recommendation/);
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ ...validPlan.actions[0], skill: "" }, validPlan.actions[1]],
  }), /attribution/);
});

test("refuses insecure Supabase endpoints", () => {
  const client = new AgentClient();
  assert.throws(() => client.saveSettings("http://supabase.example", "public-key"), /HTTPS/);
});

test("requires an authenticated session before planning", async () => {
  const client = new AgentClient();
  await assert.rejects(client.plan("Open Chrome"), /Sign in/);
});

test("checks Supabase Auth without requiring a user session", async () => {
  const client = new AgentClient();
  client.settings = {
    supabaseUrl: "https://project.supabase.co",
    anonKey: "public-key",
  };
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response("{}", { status: 200 });
  };
  try {
    assert.deepEqual(await client.checkConnections(), { supabase: true, backend: null });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://project.supabase.co/auth/v1/settings");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checks authenticated backend status without invoking an LLM", async () => {
  const client = new AgentClient();
  client.settings = {
    supabaseUrl: "https://project.supabase.co",
    anonKey: "public-key",
  };
  client.accessToken = "session-token";
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return new Response("{}", { status: 200 });
    return Response.json({
      status: "ready",
      databaseAvailable: true,
      enabledEngineSlots: 2,
      configuredEngineSlots: 1,
    });
  };
  try {
    const result = await client.checkConnections();
    assert.equal(result.supabase, true);
    assert.equal(result.backend.configuredEngineSlots, 1);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, "https://project.supabase.co/functions/v1/agent-execute");
    assert.deepEqual(JSON.parse(requests[1].options.body), { mode: "status" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects malformed backend health responses", async () => {
  const client = new AgentClient();
  client.settings = {
    supabaseUrl: "https://project.supabase.co",
    anonKey: "public-key",
  };
  client.accessToken = "session-token";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({});
  try {
    await assert.rejects(client.checkConnections(), /invalid health status/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
