import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("website exposes only Admin Login and no provider or backend configuration controls", async () => {
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const [app, client] = await Promise.all([
    readFile(new URL("./app.js", import.meta.url), "utf8"),
    readFile(new URL("./agent.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="admin-login-title">Admin Login/);
  assert.match(html, /id="auth-email"[^>]*type="email"/);
  assert.match(html, /id="auth-password"[^>]*type="password"/);
  assert.doesNotMatch(html, /sign.?up|create account|supabase-url|supabase-anon-key|type="url"|api.?key|service.?role|secret.?key/i);
  assert.doesNotMatch(`${html}\n${app}\n${client}`, /https:\/\/[a-z0-9-]+\.supabase\.co|\/auth\/v1\/|\/functions\/v1\/|SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY)/i);
  assert.doesNotMatch(client, /localStorage|accessToken|refreshToken/);
});
