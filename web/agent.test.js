import assert from "node:assert/strict";
import test from "node:test";
import { AgentClient, validateAgentPlan } from "./agent.js";

const validPlan = {
  summary: "Open Chrome and search for a project update",
  domain: "Browser & Web",
  subAgent: "Research",
  preSubAgent: "Chrome",
  skill: "Chrome",
  expectedResult: "Search results are visible",
  actions: [
    { action: "OPEN_APP", target: "Chrome", timeoutMs: 5_000 },
    { action: "VERIFY", target: "Search results", timeoutMs: 5_000 },
  ],
};

test("accepts a structured plan from the coordinator", () => {
  assert.equal(validateAgentPlan(validPlan), validPlan);
});

test("rejects unsupported or oversized plans", () => {
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: [{ action: "RUN_SHELL" }] }));
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: Array(51).fill(validPlan.actions[0]) }));
  assert.throws(() => validateAgentPlan({ ...validPlan, actions: [{ action: "BACK" }] }));
});

test("requires an approval reason for explicitly gated actions", () => {
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ action: "TAP", target: "Send", requiresApproval: true }],
  }));
  assert.throws(() => validateAgentPlan({
    ...validPlan,
    actions: [{ action: "TYPE", target: "Password", text: "secret" }, ...validPlan.actions.slice(1)],
  }));
});

test("refuses insecure Supabase endpoints", () => {
  const client = new AgentClient();
  assert.throws(() => client.saveSettings("http://supabase.example", "public-key"), /HTTPS/);
});

test("requires an authenticated session before planning", async () => {
  const client = new AgentClient();
  await assert.rejects(client.plan("Open Chrome"), /Sign in/);
});
