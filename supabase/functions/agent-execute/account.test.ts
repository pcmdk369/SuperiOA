import { deleteSupabaseUser } from "./account.ts";

Deno.test("sends the user ID to the Supabase admin endpoint with service authorization", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(null, { status: 204 });
  };
  try {
    await deleteSupabaseUser(
      "https://project.supabase.co",
      "service-role-key",
      "user/id",
    );
    if (
      requestUrl !== "https://project.supabase.co/auth/v1/admin/users/user%2Fid"
    ) {
      throw new Error(
        "The deletion request did not safely encode the user ID.",
      );
    }
    if (
      requestInit?.method !== "DELETE" ||
      new Headers(requestInit.headers).get("authorization") !==
        "Bearer service-role-key"
    ) {
      throw new Error("The admin deletion request was not authenticated.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("reports a failed user deletion without treating it as successful", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 403 });
  try {
    let rejected = false;
    try {
      await deleteSupabaseUser(
        "https://project.supabase.co",
        "service-role-key",
        "user-id",
      );
    } catch (failure) {
      rejected = failure instanceof Error &&
        failure.message === "account_deletion_failed";
    }
    if (!rejected) {
      throw new Error("A failed deletion was treated as successful.");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
