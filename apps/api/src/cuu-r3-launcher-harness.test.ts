import assert from "node:assert/strict";
import test from "node:test";

import { generateSignedCookie } from "hono/cookie";
import { settings } from "@workhub/config";

import { COOKIE_NAME } from "./middleware/auth.js";
import { createCuuR3SmokeApp, cuuR3SmokeClientToken, cuuR3SmokeOwner } from "./qa/cuu-r3-launcher-harness.js";

test("Cuu R3 smoke auth preserves QA locale for desktop main-window captures", async () => {
  const previousLocale = process.env.WORKHUB_CUU_QA_LOCALE;
  process.env.WORKHUB_CUU_QA_LOCALE = "en-US";
  try {
    const { app } = createCuuR3SmokeApp();
    const cookie = await generateSignedCookie(COOKIE_NAME, cuuR3SmokeOwner.cookieToken, settings.auth.cookieSecret);
    const headers = {
      Cookie: cookie,
      "X-WorkHub-Client-Token": cuuR3SmokeClientToken
    };

    const before = await app.request("/api/auth/me", { headers });
    assert.equal(before.status, 200);
    const beforeBody = await before.json() as { locale: string; preferences: { locale: string } };
    assert.equal(beforeBody.locale, "en-US");
    assert.equal(beforeBody.preferences.locale, "en-US");

    const updated = await app.request("/api/auth/preferences", {
      method: "PATCH",
      headers: {
        ...headers,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ locale: "zh-CN" })
    });
    assert.equal(updated.status, 200);

    const after = await app.request("/api/auth/me", { headers });
    const afterBody = await after.json() as { locale: string; preferences: { locale: string } };
    assert.equal(afterBody.locale, "zh-CN");
    assert.equal(afterBody.preferences.locale, "zh-CN");
  } finally {
    if (previousLocale === undefined) {
      delete process.env.WORKHUB_CUU_QA_LOCALE;
    } else {
      process.env.WORKHUB_CUU_QA_LOCALE = previousLocale;
    }
  }
});

test("Cuu R3 smoke app accepts approval responses used by real Tauri pet captures", async () => {
  const { app } = createCuuR3SmokeApp();
  const response = await app.request("/api/approvals/10000000-0000-4000-8000-000000000103/respond", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WorkHub-Client-Token": cuuR3SmokeClientToken
    },
    body: JSON.stringify({ decision: "allow", remember: "once" })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: { status: string; decision: string } };
  assert.equal(body.ok, true);
  assert.equal(body.data.status, "responded");
  assert.equal(body.data.decision, "allow");
});

test("Cuu R3 smoke app allows Tauri webview preflight for approval actions", async () => {
  const { app } = createCuuR3SmokeApp();
  const response = await app.request("/api/approvals/10000000-0000-4000-8000-000000000103/respond", {
    method: "OPTIONS",
    headers: {
      Origin: "tauri://localhost",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-workhub-client-token, content-type"
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "tauri://localhost");
  assert.match(response.headers.get("Access-Control-Allow-Headers") ?? "", /X-WorkHub-Client-Token/i);
});
