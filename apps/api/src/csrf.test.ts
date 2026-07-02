import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Settings } from "@workhub/config";

import { createSameOriginGuardMiddleware } from "./middleware/csrf.js";
import { LOCAL_CLIENT_HEADER } from "./middleware/auth.js";

function appWithGuard(corsAllowOrigins: string[] = ["https://app.example"]) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ ok: false }, error.status);
    }
    throw error;
  });
  app.use("/api/*", createSameOriginGuardMiddleware(() => ({ auth: { corsAllowOrigins } }) as unknown as Settings));
  app.post("/api/thing", (c) => c.json({ ok: true }));
  app.get("/api/thing", (c) => c.json({ ok: true }));
  return app;
}

test("findings[8] same-origin guard blocks a cross-site cookie POST (no token header)", async () => {
  const app = appWithGuard();
  const res = await app.request("/api/thing", {
    method: "POST",
    headers: { "Sec-Fetch-Site": "cross-site" }
  });
  assert.equal(res.status, 403);
});

test("findings[8] same-origin guard blocks a foreign-Origin POST without Sec-Fetch-Site", async () => {
  const app = appWithGuard(["https://app.example"]);
  const res = await app.request("/api/thing", {
    method: "POST",
    headers: { Origin: "https://evil.example" }
  });
  assert.equal(res.status, 403);
});

test("findings[8] same-origin guard allows same-origin, token-header, headerless, and allowlisted POSTs", async () => {
  const app = appWithGuard();
  const sameOrigin = await app.request("/api/thing", {
    method: "POST",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });
  assert.equal(sameOrigin.status, 200);

  // 桌面 token header → 免疫 CSRF，放行（真正鉴权另行把关）。
  const tokenClient = await app.request("/api/thing", {
    method: "POST",
    headers: { [LOCAL_CLIENT_HEADER]: "dev-token", "Sec-Fetch-Site": "cross-site" }
  });
  assert.equal(tokenClient.status, 200);

  const brandedTokenClient = await app.request("/api/thing", {
    method: "POST",
    headers: { "X-WorkHub-Client-Token": "dev-token", "Sec-Fetch-Site": "cross-site" }
  });
  assert.equal(brandedTokenClient.status, 200);

  // 非浏览器/服务端：两者都不带 → 放行（cookie/token 鉴权仍把关）。
  const headerless = await app.request("/api/thing", { method: "POST" });
  assert.equal(headerless.status, 200);

  // 白名单内的 Origin 放行。
  const allowed = await app.request("/api/thing", {
    method: "POST",
    headers: { Origin: "https://app.example" }
  });
  assert.equal(allowed.status, 200);
});

test("findings[8] same-origin guard never blocks safe methods (GET) even cross-site", async () => {
  const app = appWithGuard();
  const res = await app.request("/api/thing", {
    method: "GET",
    headers: { "Sec-Fetch-Site": "cross-site" }
  });
  assert.equal(res.status, 200);
});
