import { consumePlanRateLimit } from "./rate-limit.ts";

Deno.test("atomically checks the authenticated user's planning quota", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json(true);
  };
  try {
    const allowed = await consumePlanRateLimit(
      "https://project.supabase.co",
      "service-role-key",
      "verified-user-id",
    );
    if (!allowed) throw new Error("A permitted request was rate-limited.");
    if (
      requestUrl !==
        "https://project.supabase.co/rest/v1/rpc/consume_agent_plan_rate_limit" ||
      requestInit?.method !== "POST" ||
      JSON.parse(String(requestInit.body)).p_user_id !== "verified-user-id"
    ) {
      throw new Error("The quota check was not scoped to the verified user.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("fails closed when the planning quota is exhausted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(false);
  try {
    const allowed = await consumePlanRateLimit(
      "https://project.supabase.co",
      "service-role-key",
      "verified-user-id",
    );
    if (allowed) throw new Error("An exhausted quota was accepted.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("rejects unavailable or malformed rate-limit responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 503 });
    let rejected = false;
    try {
      await consumePlanRateLimit(
        "https://project.supabase.co",
        "service-role-key",
        "verified-user-id",
      );
    } catch (failure) {
      rejected = failure instanceof Error &&
        failure.message === "rate_limit_check_failed";
    }
    if (!rejected) throw new Error("A failed rate-limit check was accepted.");

    globalThis.fetch = async () => Response.json("yes");
    rejected = false;
    try {
      await consumePlanRateLimit(
        "https://project.supabase.co",
        "service-role-key",
        "verified-user-id",
      );
    } catch (failure) {
      rejected = failure instanceof Error &&
        failure.message === "rate_limit_check_failed";
    }
    if (!rejected) {
      throw new Error("A malformed rate-limit response was accepted.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
