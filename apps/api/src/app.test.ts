import assert from "node:assert/strict";
import test from "node:test";

import app from "./app.js";

interface HealthBody {
  ok: true;
  service: string;
  runtime: string;
}

interface ErrorBody {
  ok: false;
  error: {
    code: string;
  };
}

test("GET /api/health returns the daemon health payload", async () => {
  const response = await app.request("/api/health");

  assert.equal(response.status, 200);
  const body = (await response.json()) as HealthBody;
  assert.equal(body.ok, true);
  assert.equal(body.service, "workhub-api");
  assert.equal(body.runtime, "node");
});

test("CORS preflight allows the desktop client token headers (cross-origin desktop fetch)", async () => {
  const response = await app.request("/api/sessions", {
    method: "OPTIONS",
    headers: {
      Origin: "http://tauri.localhost",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-yqgl-client-token, x-workhub-client-token, content-type"
    }
  });

  assert.equal(response.status, 204);
  const allowHeaders = (response.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
  // 桌面 webview 每个认证请求都带这两个令牌头；预检必须放行，否则跨源桌面写请求全被浏览器拦掉。
  assert.ok(allowHeaders.includes("x-yqgl-client-token"));
  assert.ok(allowHeaders.includes("x-workhub-client-token"));
});

test("GET /api/openapi.json exposes the headless daemon contract seed", async () => {
  const response = await app.request("/api/openapi.json");

  assert.equal(response.status, 200);
  const body = await response.json() as { openapi: string; paths: Record<string, unknown> };
  assert.equal(body.openapi, "3.1.0");
  assert.equal(Boolean(body.paths["/api/pages/attention"]), true);
  assert.equal(Boolean(body.paths["/api/pages/drive"]), true);
  assert.equal(Boolean(body.paths["/api/pages/meetings"]), true);
  assert.equal(Boolean(body.paths["/api/drive/projects/{projectId}/files"]), true);
  assert.equal(Boolean(body.paths["/api/drive/projects/{projectId}/items/{itemId}/delete"]), true);
  assert.equal(Boolean(body.paths["/api/drive/projects/{projectId}/items/{itemId}/restore"]), true);
  assert.equal(Boolean(body.paths["/api/drive/projects/{projectId}/comments/{commentId}/draft"]), true);
  assert.equal(Boolean(body.paths["/api/drive/workitems/{workItemId}/proposal-draft"]), true);
  assert.equal(Boolean(body.paths["/api/meetings/projects/{projectId}/insights/{insightId}/draft"]), true);
  assert.equal(Boolean(body.paths["/api/meetings/projects/{projectId}/insights/{insightId}/dismiss"]), true);
  assert.equal(Boolean(body.paths["/api/meetings/workitems/{workItemId}/proposal-draft"]), true);
  assert.equal(Boolean(body.paths["/api/cost/usage"]), true);
  assert.equal(Boolean(body.paths["/api/cost/policies"]), true);
  assert.equal(Boolean(body.paths["/api/cost/policies/{scope}/{id}"]), true);
  assert.equal(Boolean(body.paths["/api/workitems/{id}/proposals"]), true);
  assert.equal(Boolean(body.paths["/api/workitems/{id}/conflicts"]), true);
  assert.equal(Boolean(body.paths["/api/workitems/{id}/deliverables/{acceptedChangeId}/download"]), true);
  assert.equal(Boolean(body.paths["/api/workitems/{id}/deliverables/{acceptedChangeId}/preview"]), true);
  assert.equal(Boolean(body.paths["/api/workitems/{id}/deliverables/{acceptedChangeId}/restore"]), true);
  assert.equal(Boolean(body.paths["/api/proposals/{id}"]), true);
});

test("unknown endpoints use the shared error shape", async () => {
  const response = await app.request("/missing");

  assert.equal(response.status, 404);
  const body = (await response.json()) as ErrorBody;
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "not_found");
});
