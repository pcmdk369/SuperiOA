import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createServer } from "./index.js";

function testEnvironment() {
  return {
    NODE_ENV: "production",
    APP_ORIGIN: "https://superioa.example",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "public-anon-test-key",
    AUTH_LOGIN_1_MAIL: "superintelligentcore@gmail.com",
    AUTH_LOGIN_2_MAIL: "support.pcmdkai@gmail.com",
    AUTH_1_PASSWORD: "admin-password-one-for-tests",
    AUTH_2_PASSWORD: "admin-password-two-for-tests",
    AUTH_TOKEN_1_KEY: "first-session-signing-key-32-bytes-minimum",
    AUTH_TOKEN_2_KEY: "second-session-signing-key-32-bytes-minimum",
  };
}

async function startTestServer(fetchImpl) {
  const env = testEnvironment();
  const server = createServer({ env, fetchImpl });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    origin: env.APP_ORIGIN,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function jsonRequest(baseUrl, route, body, cookie, origin = baseUrl) {
  return fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const accountCases = [
  {
    email: "superintelligentcore@gmail.com",
    password: "admin-password-one-for-tests",
  },
  {
    email: "support.pcmdkai@gmail.com",
    password: "admin-password-two-for-tests",
  },
];

for (const account of accountCases) {
  test(`authorizes configured admin ${account.email} with a protected session`, async (context) => {
    const upstreamRequests = [];
    const service = await startTestServer(async (url, options) => {
      upstreamRequests.push({ url, options });
      return Response.json({
        access_token: "supabase-access-token",
        refresh_token: "supabase-refresh-token",
        expires_in: 3600,
        user: { email: account.email },
      });
    });
    context.after(service.close);

    const response = await jsonRequest(service.baseUrl, "/api/login", account, undefined, service.origin);
    assert.equal(response.status, 200);
    const responseText = await response.text();
    assert.deepEqual(JSON.parse(responseText), { email: account.email });
    const sessionCookie = response.headers.get("set-cookie");
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /Secure/);
    assert.match(sessionCookie, /SameSite=Strict/);
    assert.equal(upstreamRequests.length, 1);
    assert.equal(upstreamRequests[0].options.headers.apikey, "public-anon-test-key");
    assert.deepEqual(JSON.parse(upstreamRequests[0].options.body), account);
    assert.equal(responseText.includes("supabase-access-token"), false);
    assert.equal(sessionCookie.includes("supabase-access-token"), false);
    assert.equal(sessionCookie.includes(account.password), false);
  });
}

test("rejects invalid accounts and passwords without contacting Supabase", async (context) => {
  let upstreamCalls = 0;
  const service = await startTestServer(async () => {
    upstreamCalls += 1;
    return Response.json({});
  });
  context.after(service.close);

  for (const credentials of [
    { email: "someone@example.com", password: "admin-password-one-for-tests" },
    { email: accountCases[0].email, password: "wrong-password" },
  ]) {
    const response = await jsonRequest(service.baseUrl, "/api/login", credentials, undefined, service.origin);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "invalid_credentials" });
  }
  assert.equal(upstreamCalls, 0);
});

test("rate-limits repeated admin sign-in attempts", async (context) => {
  const service = await startTestServer(async () => {
    throw new Error("Invalid credentials must not reach Supabase.");
  });
  context.after(service.close);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await jsonRequest(
      service.baseUrl,
      "/api/login",
      { email: accountCases[0].email, password: "incorrect-password" },
      undefined,
      service.origin,
    );
    assert.equal(response.status, 401);
  }
  const limited = await jsonRequest(
    service.baseUrl,
    "/api/login",
    { email: accountCases[0].email, password: "incorrect-password" },
    undefined,
    service.origin,
  );
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { error: "login_rate_limited" });
});

test("rejects cross-origin login and unauthenticated protected API requests", async (context) => {
  const service = await startTestServer(async () => {
    throw new Error("Untrusted request must not reach the upstream service.");
  });
  context.after(service.close);

  const login = await fetch(`${service.baseUrl}/api/login`, {
    method: "POST",
    headers: { origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify(accountCases[0]),
  });
  assert.equal(login.status, 403);

  const protectedResponse = await jsonRequest(service.baseUrl, "/api/agent-execute", { mode: "status" }, undefined, service.origin);
  assert.equal(protectedResponse.status, 401);
  assert.deepEqual(await protectedResponse.json(), { error: "authentication_required" });
});

test("sanitizes upstream responses and preserves only the allowed admin session", async (context) => {
  let authenticationCount = 0;
  const service = await startTestServer(async (url, options) => {
    if (url.includes("/auth/v1/token")) {
      authenticationCount += 1;
      return Response.json({
        access_token: "server-held-access-token",
        refresh_token: "server-held-refresh-token",
        expires_in: 3600,
        user: { email: accountCases[0].email },
      });
    }
    assert.match(options.headers.authorization, /^Bearer server-held-access-token$/);
    return Response.json({
      status: "ready",
      databaseAvailable: true,
      enabledEngineSlots: 2,
      configuredEngineSlots: 2,
      service_role_key: "must-not-leak",
    });
  });
  context.after(service.close);

  const login = await jsonRequest(service.baseUrl, "/api/login", accountCases[0], undefined, service.origin);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const session = await fetch(`${service.baseUrl}/api/session`, { headers: { cookie } });
  assert.deepEqual(await session.json(), {
    authenticated: true,
    email: accountCases[0].email,
  });

  const status = await jsonRequest(service.baseUrl, "/api/agent-execute", { mode: "status" }, cookie, service.origin);
  assert.equal(status.status, 200);
  const statusText = await status.text();
  assert.equal(statusText.includes("must-not-leak"), false);
  assert.deepEqual(JSON.parse(statusText), {
    status: "ready",
    databaseAvailable: true,
    enabledEngineSlots: 2,
    configuredEngineSlots: 2,
  });

  const logout = await jsonRequest(service.baseUrl, "/api/logout", {}, cookie, service.origin);
  assert.deepEqual(await logout.json(), { signedOut: true });
  const expiredSession = await fetch(`${service.baseUrl}/api/session`, {
    headers: { cookie: logout.headers.get("set-cookie").split(";")[0] },
  });
  assert.deepEqual(await expiredSession.json(), { authenticated: false });
  assert.equal(authenticationCount, 1);
});

test("forwards only validated task input and strips unapproved plan fields", async (context) => {
  let functionPayload;
  const service = await startTestServer(async (url, options) => {
    if (url.includes("/auth/v1/token")) {
      return Response.json({
        access_token: "server-held-access-token",
        refresh_token: "server-held-refresh-token",
        expires_in: 3600,
        user: { email: accountCases[0].email },
      });
    }
    functionPayload = JSON.parse(options.body);
    return Response.json({
      plan: {
        summary: "Search safely",
        domain: "Browser & Web",
        agent: "Coordinator",
        subAgent: "Research",
        preSubAgent: null,
        skill: "Search",
        expectedResult: "Results are visible",
        provider_secret: "must-not-leak",
        actions: [{
          recommendationType: "RECOMMENDATION",
          recommendation: "Open the browser.",
          agent: "Coordinator",
          subAgent: "Research",
          skill: "Navigation",
          action: "OPEN_APP",
          target: "Browser",
          provider_secret: "must-not-leak",
        }],
      },
      engineId: "engine-1",
      taskId: "task-1",
    });
  });
  context.after(service.close);

  const login = await jsonRequest(service.baseUrl, "/api/login", accountCases[0], undefined, service.origin);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const response = await jsonRequest(
    service.baseUrl,
    "/api/agent-execute",
    { task: "Search for release notes", screenContext: "ignore this field" },
    cookie,
    service.origin,
  );
  const responseText = await response.text();
  assert.equal(response.status, 200);
  assert.equal(responseText.includes("provider_secret"), false);
  assert.equal(JSON.parse(responseText).plan.summary, "Search safely");
  assert.deepEqual(functionPayload, {
    mode: "plan",
    task: "Search for release notes",
    screenContext: "",
  });
});
