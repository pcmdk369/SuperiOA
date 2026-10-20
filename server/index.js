import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const allowedEmails = [
  "superintelligentcore@gmail.com",
  "support.pcmdkai@gmail.com",
];
const cookieName = "superioa_session";
const sessionDurationMs = 8 * 60 * 60 * 1_000;
const loginWindowMs = 15 * 60 * 1_000;
const loginAttemptLimit = 5;
const agentWindowMs = 60 * 1_000;
const agentRequestLimit = 30;
const maxRequestBytes = 8_192;
const distDirectory = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    const dummy = Buffer.alloc(leftBuffer.length);
    timingSafeEqual(leftBuffer, dummy);
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function getConfiguration(env) {
  const appOrigin = env.APP_ORIGIN;
  let origin;
  try {
    origin = new URL(appOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be an absolute origin.");
  }
  if (
    origin.origin !== appOrigin ||
    (origin.protocol !== "https:" &&
      !(env.NODE_ENV !== "production" && origin.protocol === "http:"))
  ) {
    throw new Error("APP_ORIGIN must not include a path or query.");
  }

  const supabaseUrl = env.SUPABASE_URL;
  let supabase;
  try {
    supabase = new URL(supabaseUrl);
  } catch {
    throw new Error("SUPABASE_URL must be an absolute URL.");
  }
  if (
    !["https:", "http:"].includes(supabase.protocol) ||
    (supabase.protocol !== "https:" && supabase.hostname !== "localhost") ||
    supabase.username || supabase.password || supabase.pathname !== "/" ||
    supabase.search || supabase.hash
  ) {
    throw new Error("SUPABASE_URL must use HTTPS.");
  }

  const anonKey = env.SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!anonKey) throw new Error("A Supabase anon or publishable key is required.");

  const accounts = allowedEmails.map((email, index) => {
    const slot = index + 1;
    const configuredEmail = env[`AUTH_LOGIN_${slot}_MAIL`]?.trim().toLowerCase();
    const password = env[`AUTH_${slot}_PASSWORD`];
    const tokenKey = env[`AUTH_TOKEN_${slot}_KEY`];
    if (configuredEmail !== email) {
      throw new Error(`AUTH_LOGIN_${slot}_MAIL must match the approved admin account.`);
    }
    if (!password || password.length < 12) {
      throw new Error(`AUTH_${slot}_PASSWORD must contain at least 12 characters.`);
    }
    if (!tokenKey || Buffer.byteLength(tokenKey) < 32) {
      throw new Error(`AUTH_TOKEN_${slot}_KEY must contain at least 32 bytes.`);
    }
    return { email, password, tokenKey };
  });

  return {
    appOrigin,
    supabaseUrl: supabase.origin,
    anonKey,
    accounts,
  };
}

function readCookie(request, name) {
  const header = request.headers.cookie || "";
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) {
      return entry.slice(separator + 1).trim();
    }
  }
  return "";
}

function clientAddress(request) {
  return request.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    request.socket.remoteAddress || "unknown";
}

function cookieHeader(value, secure, maxAge) {
  return [
    `${cookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(secure ? ["Secure"] : []),
    `Max-Age=${maxAge}`,
  ].join("; ");
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

function apiError(response, status, error) {
  jsonResponse(response, status, { error });
}

function sanitizeFunctionResponse(status, text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: 502, body: { error: "backend_invalid_response" } };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: 502, body: { error: "backend_invalid_response" } };
  }
  if (status >= 400) {
    const safeBody = {};
    const knownErrors = new Set([
      "invalid_json",
      "invalid_request",
      "authentication_required",
      "invalid_session",
      "backend_not_configured",
      "engine_configuration_invalid",
      "account_deletion_failed",
      "plan_rate_limit_exceeded",
      "rate_limit_unavailable",
      "invalid_request_size",
      "no_llm_engines_configured",
      "usage_logging_unavailable",
      "all_llm_engines_failed",
    ]);
    if (knownErrors.has(body.error)) safeBody.error = body.error;
    if (typeof body.requestId === "string") safeBody.requestId = body.requestId.slice(0, 100);
    if (typeof body.retryable === "boolean") safeBody.retryable = body.retryable;
    return { status, body: safeBody.error ? safeBody : { error: "backend_request_failed" } };
  }
  if (body.status === "ready" || body.status === "degraded") {
    if (
      typeof body.databaseAvailable !== "boolean" ||
      !Number.isInteger(body.enabledEngineSlots) ||
      !Number.isInteger(body.configuredEngineSlots)
    ) {
      return { status: 502, body: { error: "backend_invalid_response" } };
    }
    return {
      status: 200,
      body: {
        status: body.status,
        databaseAvailable: body.databaseAvailable,
        enabledEngineSlots: body.enabledEngineSlots,
        configuredEngineSlots: body.configuredEngineSlots,
      },
    };
  }
  if (
    body.plan && typeof body.plan === "object" &&
    typeof body.engineId === "string" &&
    typeof body.taskId === "string"
  ) {
    const plan = body.plan;
    const requiredPlanFields = [
      "summary", "domain", "agent", "subAgent", "skill", "expectedResult",
    ];
    if (
      requiredPlanFields.some((field) =>
        typeof plan[field] !== "string" || plan[field].length > 300
      ) ||
      !Array.isArray(plan.actions) || plan.actions.length < 1 ||
      plan.actions.length > 50
    ) {
      return { status: 502, body: { error: "backend_invalid_response" } };
    }
    const allowedActionFields = [
      "recommendationType", "recommendation", "agent", "subAgent", "skill",
      "action", "target", "text", "timeoutMs", "requiresApproval",
      "approvalReason",
    ];
    const actions = plan.actions.map((action) => {
      if (!action || typeof action !== "object" || Array.isArray(action)) return null;
      return Object.fromEntries(
        allowedActionFields
          .filter((field) => Object.hasOwn(action, field))
          .map((field) => [field, action[field]]),
      );
    });
    if (actions.some((action) => action === null)) {
      return { status: 502, body: { error: "backend_invalid_response" } };
    }
    const safePlan = Object.fromEntries(
      [...requiredPlanFields, "preSubAgent"]
        .filter((field) => Object.hasOwn(plan, field))
        .map((field) => [field, plan[field]]),
    );
    return {
      status: 200,
      body: {
        plan: { ...safePlan, actions },
        engineId: body.engineId.slice(0, 100),
        taskId: body.taskId.slice(0, 100),
      },
    };
  }
  return { status: 502, body: { error: "backend_invalid_response" } };
}

export function createServer({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const sessions = new Map();
  const loginAttempts = new Map();
  const agentAttempts = new Map();
  const secureCookies = env.NODE_ENV === "production";

  function cleanExpired() {
    const timestamp = now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= timestamp) sessions.delete(id);
    }
    for (const [key, attempts] of loginAttempts) {
      if (timestamp - attempts.startedAt >= loginWindowMs) loginAttempts.delete(key);
    }
    for (const [key, attempts] of agentAttempts) {
      if (timestamp - attempts.startedAt >= agentWindowMs) agentAttempts.delete(key);
    }
  }

  function consumeLimit(store, key, limit, windowMs) {
    const timestamp = now();
    let record = store.get(key);
    if (!record || timestamp - record.startedAt >= windowMs) {
      record = { startedAt: timestamp, count: 0 };
      store.set(key, record);
    }
    record.count += 1;
    return record.count <= limit;
  }

  function readSession(request, configuration) {
    const value = readCookie(request, cookieName);
    const [id, signature, extra] = value.split(".");
    if (!id || !signature || extra !== undefined) return null;
    const session = sessions.get(id);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(id);
      return null;
    }
    const account = configuration.accounts.find((item) => item.email === session.email);
    if (!account) return null;
    const expected = createHmac("sha256", account.tokenKey).update(id).digest("base64url");
    if (!safeEqual(signature, expected)) return null;
    return session;
  }

  function requireOrigin(request, configuration) {
    return request.headers.origin === configuration.appOrigin;
  }

  async function login(request, response, configuration) {
    const address = clientAddress(request);
    if (!consumeLimit(loginAttempts, address, loginAttemptLimit, loginWindowMs)) {
      return apiError(response, 429, "login_rate_limited");
    }
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return apiError(response, error.message === "request_too_large" ? 413 : 400, error.message);
    }
    if (
      !body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.email !== "string" || typeof body.password !== "string" ||
      body.email.length > 254 || body.password.length > 256
    ) {
      return apiError(response, 400, "invalid_request");
    }
    const email = body.email.trim().toLowerCase();
    const account = configuration.accounts.find((item) => item.email === email);
    if (!account || !safeEqual(body.password, account.password)) {
      return apiError(response, 401, "invalid_credentials");
    }

    let authResponse;
    try {
      authResponse = await fetchImpl(
        `${configuration.supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            apikey: configuration.anonKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ email, password: account.password }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      return apiError(response, 503, "authentication_service_unavailable");
    }
    const authBody = await authResponse.json().catch(() => null);
    if (
      !authResponse.ok || !authBody ||
      typeof authBody.access_token !== "string" ||
      typeof authBody.refresh_token !== "string" ||
      typeof authBody.user?.email !== "string" ||
      authBody.user.email.toLowerCase() !== account.email
    ) {
      return apiError(response, 401, "invalid_credentials");
    }

    const id = randomBytes(32).toString("base64url");
    const signature = createHmac("sha256", account.tokenKey).update(id).digest("base64url");
    const expiresAt = now() + sessionDurationMs;
    const expiresIn = Number(authBody.expires_in);
    sessions.set(id, {
      email: account.email,
      accessToken: authBody.access_token,
      refreshToken: authBody.refresh_token,
      tokenExpiresAt: now() + (Number.isSafeInteger(expiresIn) ? Math.min(Math.max(60, expiresIn), 86_400) : 3_600) * 1_000,
      expiresAt,
    });
    cleanExpired();
    response.setHeader("set-cookie", cookieHeader(`${id}.${signature}`, secureCookies, sessionDurationMs / 1_000));
    return jsonResponse(response, 200, { email: account.email });
  }

  async function refreshSession(session, configuration) {
    if (session.tokenExpiresAt > now() + 60_000) return true;
    let result;
    try {
      result = await fetchImpl(
        `${configuration.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: {
            apikey: configuration.anonKey,
            "content-type": "application/json",
          },
          body: JSON.stringify({ refresh_token: session.refreshToken }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      return false;
    }
    const body = await result.json().catch(() => null);
    if (
      !result.ok || !body ||
      typeof body.access_token !== "string" ||
      typeof body.refresh_token !== "string"
    ) {
      return false;
    }
    session.accessToken = body.access_token;
    session.refreshToken = body.refresh_token;
    const expiresIn = Number(body.expires_in);
    session.tokenExpiresAt = now() + (Number.isSafeInteger(expiresIn) ? Math.min(Math.max(60, expiresIn), 86_400) : 3_600) * 1_000;
    return true;
  }

  async function proxyAgent(request, response, configuration, session) {
    const address = clientAddress(request);
    const limitKey = `${address}:${session.email}`;
    if (!consumeLimit(agentAttempts, limitKey, agentRequestLimit, agentWindowMs)) {
      return apiError(response, 429, "agent_rate_limited");
    }
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return apiError(response, error.message === "request_too_large" ? 413 : 400, error.message);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError(response, 400, "invalid_request");
    }
    const mode = body.mode === "status" ? "status" : "plan";
    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (mode === "plan" && (!task || task.length > 2_000)) {
      return apiError(response, 400, "invalid_request_size");
    }
    if (!(await refreshSession(session, configuration))) {
      for (const [id, current] of sessions) {
        if (current === session) sessions.delete(id);
      }
      return apiError(response, 401, "session_expired");
    }

    let upstream;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      upstream = await fetchImpl(
        `${configuration.supabaseUrl}/functions/v1/agent-execute`,
        {
          method: "POST",
          headers: {
            apikey: configuration.anonKey,
            authorization: `Bearer ${session.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(mode === "status"
            ? { mode: "status" }
            : { mode: "plan", task, screenContext: "" }),
          signal: controller.signal,
        },
      );
    } catch {
      clearTimeout(timeout);
      if (response.destroyed) return;
      return apiError(response, 503, "planning_service_unavailable");
    }
    clearTimeout(timeout);
    const text = await upstream.text();
    const sanitized = sanitizeFunctionResponse(upstream.status, text);
    return jsonResponse(response, sanitized.status, sanitized.body);
  }

  const server = createHttpServer(async (request, response) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("permissions-policy", "camera=(), geolocation=(), payment=()");
    response.setHeader(
      "content-security-policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
    );
    if (secureCookies) {
      response.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }

    const url = new URL(request.url || "/", "http://localhost");
    const apiPath = url.pathname.startsWith("/api/");
    if (apiPath) {
      response.setHeader("cache-control", "no-store");
      let configuration;
      try {
        configuration = getConfiguration(env);
      } catch {
        console.error("server_configuration_invalid");
        return apiError(response, 503, "server_not_configured");
      }

      if (request.method === "GET" && url.pathname === "/api/session") {
        const session = readSession(request, configuration);
        return jsonResponse(response, 200, {
          authenticated: Boolean(session),
          ...(session ? { email: session.email } : {}),
        });
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "GET, POST");
        return apiError(response, 405, "method_not_allowed");
      }
      if (!requireOrigin(request, configuration)) {
        return apiError(response, 403, "origin_not_allowed");
      }
      if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
        return apiError(response, 415, "unsupported_media_type");
      }
      if (url.pathname === "/api/login") return await login(request, response, configuration);
      if (url.pathname === "/api/logout") {
        const session = readSession(request, configuration);
        if (session) {
          try {
            const revokeResponse = await fetchImpl(
              `${configuration.supabaseUrl}/auth/v1/logout`,
              {
                method: "POST",
                headers: {
                  apikey: configuration.anonKey,
                  authorization: `Bearer ${session.accessToken}`,
                },
                signal: AbortSignal.timeout(5_000),
              },
            );
            if (!revokeResponse.ok) console.error("supabase_session_revoke_failed");
          } catch {
            console.error("supabase_session_revoke_failed");
          }
          for (const [id, item] of sessions) {
            if (item === session) sessions.delete(id);
          }
        }
        response.setHeader("set-cookie", cookieHeader("", secureCookies, 0));
        return jsonResponse(response, 200, { signedOut: true });
      }
      if (url.pathname === "/api/agent-execute") {
        const session = readSession(request, configuration);
        if (!session) return apiError(response, 401, "authentication_required");
        return await proxyAgent(request, response, configuration, session);
      }
      return apiError(response, 404, "not_found");
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      return apiError(response, 405, "method_not_allowed");
    }
    let requestedPath;
    try {
      requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    } catch {
      return apiError(response, 400, "invalid_path");
    }
    const filePath = resolve(distDirectory, `.${requestedPath}`);
    if (!filePath.startsWith(`${distDirectory}${sep}`)) {
      return apiError(response, 404, "not_found");
    }
    try {
      const stream = createReadStream(filePath);
      stream.on("error", () => {
        if (!response.headersSent) apiError(response, 404, "not_found");
        else response.destroy();
      });
      response.setHeader("content-type", contentTypes[extname(filePath)] || "application/octet-stream");
      response.setHeader("cache-control", extname(filePath) === ".html" ? "no-cache" : "public, max-age=300");
      if (request.method === "HEAD") {
        response.end();
        stream.destroy();
      } else {
        stream.pipe(response);
      }
    } catch {
      return apiError(response, 404, "not_found");
    }
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createServer();
  const port = Number(process.env.PORT) || 10000;
  server.listen(port, "0.0.0.0", () => {
    console.info(`SuperiOA web service listening on ${port}`);
  });
}
