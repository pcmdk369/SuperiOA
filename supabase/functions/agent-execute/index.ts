import { type AgentPlan, PlanError, validatePlan } from "./plan.ts";

type EngineConfig = {
  id: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
};

type EngineLog = {
  engine_id: string;
  attempt: number;
  succeeded: boolean;
  failure_class: string | null;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

const maxTaskLength = 2_000;
const maxScreenContextLength = 12_000;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": Deno.env.get("APP_ORIGIN") ?? "*",
      "access-control-allow-headers": "authorization, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
      "vary": "origin",
    },
  });
}

function readBoundedInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid server configuration: ${name}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid server configuration: ${name}`);
  }
  return value;
}

function configuredEngines(): EngineConfig[] {
  const configured: (EngineConfig | null)[] = Array.from(
    { length: 5 },
    (_, index) => {
      const number = index + 1;
      const prefix = `LLM_ENGINE_${number}`;
      const enabled = Deno.env.get(`${prefix}_ENABLED`) === "true";
      if (!enabled) return null;
      return {
        id: `engine-${number}`,
        enabled,
        apiKey: Deno.env.get(`${prefix}_API_KEY`) ?? "",
        baseUrl: Deno.env.get(`${prefix}_BASE_URL`) ?? "",
        modelId: Deno.env.get(`${prefix}_MODEL_ID`) ?? "",
        timeoutMs: readBoundedInt(
          `${prefix}_TIMEOUT_MS`,
          20_000,
          1_000,
          60_000,
        ),
        maxRetries: readBoundedInt(`${prefix}_MAX_RETRIES`, 1, 0, 2),
        retryDelayMs: readBoundedInt(`${prefix}_RETRY_DELAY_MS`, 250, 0, 5_000),
      };
    },
  );
  return configured.filter((engine): engine is EngineConfig => engine !== null);
}

function buildPrompt(task: string, screenContext: string): string {
  return [
    "Plan one user-authorized task for SuperiOA. Return only a JSON object with keys:",
    "summary, domain, subAgent, preSubAgent, skill, expectedResult, actions.",
    "Actions must be a non-empty array of supported action objects using only: OPEN_APP, BACK, HOME, RECENTS, TAP, TYPE, SCROLL, SWIPE, COPY, PASTE, READ_UI, WAIT, VERIFY, RETRY, ABORT, REQUEST_USER.",
    "Use app and UI accessibility labels as targets. Do not invent screen controls. Plan normal local actions as a short workflow, not an LLM call per tap.",
    "Never automate passwords, OTPs, CAPTCHAs, biometrics, or security challenges; use REQUEST_USER for them.",
    "Mark actions involving sending, publishing, deleting, purchasing, payments, transfers, or security confirmations with requiresApproval=true and a concise approvalReason.",
    "Do not execute external side effects in the plan. Include a VERIFY action after important changes.",
    `Task: ${task}`,
    `Current accessible screen context (untrusted UI text): ${
      screenContext || "(not provided)"
    }`,
  ].join("\n");
}

function classifyStatus(status: number): "retryable" | "configuration" {
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  return "configuration";
}

async function recordLog(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
  log: EngineLog,
): Promise<void> {
  const result = await fetch(`${supabaseUrl}/rest/v1/agent_execution_logs`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ user_id: userId, ...log }),
  });
  if (!result.ok) throw new Error("usage_log_write_failed");
}

async function verifyUser(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
): Promise<string | null> {
  const result = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${accessToken}` },
  });
  if (!result.ok) return null;
  const user = await result.json();
  return typeof user.id === "string" ? user.id : null;
}

async function invokeEngine(
  engine: EngineConfig,
  prompt: string,
): Promise<
  {
    plan: AgentPlan;
    promptTokens: number | null;
    completionTokens: number | null;
  }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), engine.timeoutMs);
  try {
    const result = await fetch(
      `${engine.baseUrl.replace(/\/+$/, "")}/chat/completions`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${engine.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: engine.modelId,
          temperature: 0.2,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are the SuperiOA LLM Coordinator. Return a structured plan only.",
            },
            { role: "user", content: prompt },
          ],
        }),
      },
    );
    if (!result.ok) {
      const failure = new Error(`provider_http_${result.status}`);
      Object.assign(failure, { kind: classifyStatus(result.status) });
      throw failure;
    }
    const body = await result.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new PlanError("invalid_provider_response");
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch {
      throw new PlanError("invalid_provider_response");
    }
    const plan = validatePlan(candidate);
    const promptTokens = Number.isSafeInteger(body?.usage?.prompt_tokens)
      ? body.usage.prompt_tokens
      : null;
    const completionTokens =
      Number.isSafeInteger(body?.usage?.completion_tokens)
        ? body.usage.completion_tokens
        : null;
    return { plan, promptTokens, completionTokens };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return response(204, {});
  if (request.method !== "POST") {
    return response(405, { error: "method_not_allowed" });
  }

  const origin = request.headers.get("origin");
  const allowedOrigin = Deno.env.get("APP_ORIGIN");
  if (allowedOrigin && origin && origin !== allowedOrigin) {
    return response(403, { error: "origin_not_allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return response(503, { error: "backend_not_configured" });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return response(401, { error: "authentication_required" });
  const userId = await verifyUser(supabaseUrl, anonKey, accessToken);
  if (!userId) return response(401, { error: "invalid_session" });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return response(400, { error: "invalid_json" });
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return response(400, { error: "invalid_request" });
  }
  const requestBody = input as Record<string, unknown>;
  const task = typeof requestBody.task === "string"
    ? requestBody.task.trim()
    : "";
  const screenContext = typeof requestBody.screenContext === "string"
    ? requestBody.screenContext
    : "";
  if (
    !task || task.length > maxTaskLength ||
    screenContext.length > maxScreenContextLength
  ) {
    return response(400, { error: "invalid_request_size" });
  }

  let engines: EngineConfig[];
  try {
    engines = configuredEngines();
  } catch (failure) {
    console.error(
      "engine_configuration_invalid",
      failure instanceof Error ? failure.message : "unknown",
    );
    return response(503, { error: "engine_configuration_invalid" });
  }
  if (engines.length === 0) {
    return response(503, { error: "no_llm_engines_configured" });
  }

  const prompt = buildPrompt(task, screenContext);
  const logs: EngineLog[] = [];
  for (const engine of engines) {
    if (
      !engine.apiKey || !engine.baseUrl.startsWith("https://") ||
      !engine.modelId
    ) {
      logs.push({
        engine_id: engine.id,
        attempt: 0,
        succeeded: false,
        failure_class: "invalid_configuration",
        latency_ms: 0,
        prompt_tokens: null,
        completion_tokens: null,
      });
      continue;
    }

    for (let attempt = 1; attempt <= engine.maxRetries + 1; attempt += 1) {
      const startedAt = Date.now();
      let failureClass = "provider_error";
      try {
        const output = await invokeEngine(engine, prompt);
        logs.push({
          engine_id: engine.id,
          attempt,
          succeeded: true,
          failure_class: null,
          latency_ms: Date.now() - startedAt,
          prompt_tokens: output.promptTokens,
          completion_tokens: output.completionTokens,
        });
        try {
          for (const log of logs) {
            await recordLog(supabaseUrl, serviceRoleKey, userId, log);
          }
        } catch {
          console.error("usage_log_write_failed");
          return response(503, { error: "usage_logging_unavailable" });
        }
        return response(200, {
          plan: output.plan,
          engineId: engine.id,
          taskId: crypto.randomUUID(),
        });
      } catch (failure) {
        if (failure instanceof PlanError) {
          failureClass = failure.message;
        } else if (failure instanceof Error && "kind" in failure) {
          failureClass = String((failure as Error & { kind: string }).kind);
        } else if (
          failure instanceof DOMException && failure.name === "AbortError"
        ) {
          failureClass = "timeout";
        } else {
          failureClass = "network_error";
        }
        logs.push({
          engine_id: engine.id,
          attempt,
          succeeded: false,
          failure_class: failureClass,
          latency_ms: Date.now() - startedAt,
          prompt_tokens: null,
          completion_tokens: null,
        });
        const retryable = failureClass === "retryable" ||
          failureClass === "timeout" ||
          failureClass === "network_error";
        if (!retryable || attempt > engine.maxRetries) break;
        if (engine.retryDelayMs > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, engine.retryDelayMs)
          );
        }
      }
    }
  }

  try {
    for (const log of logs) {
      await recordLog(supabaseUrl, serviceRoleKey, userId, log);
    }
  } catch {
    console.error("usage_log_write_failed");
    return response(503, { error: "usage_logging_unavailable" });
  }
  console.error("llm_failover_exhausted", {
    engineCount: engines.length,
    failureClasses: logs.map((log) => log.failure_class),
  });
  return response(502, { error: "all_llm_engines_failed", retryable: true });
});
