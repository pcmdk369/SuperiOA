export async function consumePlanRateLimit(
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<boolean> {
  const result = await fetch(
    `${supabaseUrl}/rest/v1/rpc/consume_agent_plan_rate_limit`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_user_id: userId }),
    },
  );
  if (!result.ok) throw new Error("rate_limit_check_failed");
  const allowed: unknown = await result.json();
  if (typeof allowed !== "boolean") {
    throw new Error("rate_limit_check_failed");
  }
  return allowed;
}
