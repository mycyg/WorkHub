import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Hono } from "hono";

import { attachWebStatic } from "./app.js";
import { createStructuredLogger } from "./logging.js";

async function tempDist() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workhub-web-dist-"));
  await writeFile(path.join(dir, "index.html"), "<!doctype html><div id=\"root\">onboarding</div>", "utf8");
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "assets", "app.js"), "console.log(1)", "utf8");
  return dir;
}

test("attachWebStatic serves the SPA with fallback and keeps /api passthrough", async () => {
  const dist = await tempDist();
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true }));
  const lines: string[] = [];
  const logger = createStructuredLogger({ write: (line) => lines.push(line) });
  assert.equal(attachWebStatic(app, dist, logger), true);

  const index = await app.request("/");
  assert.equal(index.status, 200);
  assert.equal((await index.text()).includes("onboarding"), true);

  const deepLink = await app.request("/approvals");
  assert.equal(deepLink.status, 200);
  assert.equal((await deepLink.text()).includes("onboarding"), true);

  const asset = await app.request("/assets/app.js");
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");

  const api = await app.request("/api/health");
  assert.equal(api.status, 200);
  assert.equal((await api.json() as { ok: boolean }).ok, true);

  const traversal = await app.request("/..%2f..%2fetc%2fpasswd");
  assert.equal(traversal.status, 200);
  assert.equal((await traversal.text()).includes("onboarding"), true);

  assert.equal(lines.some((line) => JSON.parse(line).event === "web_static_attached"), true);
});

test("attachWebStatic fails closed when dist dir is missing", async () => {
  const app = new Hono();
  const lines: string[] = [];
  const logger = createStructuredLogger({ write: (line) => lines.push(line) });
  assert.equal(attachWebStatic(app, "/nonexistent-dist-dir", logger), false);
  assert.equal(lines.some((line) => JSON.parse(line).event === "web_dist_missing"), true);
});

test("structured logger emits parseable json lines and pretty mode", () => {
  const lines: string[] = [];
  const json = createStructuredLogger({ write: (line) => lines.push(line), now: () => new Date("2026-06-12T00:00:00.000Z") });
  json.info("http_request", { method: "GET", path: "/", status: 200, duration_ms: 12 });
  json.error("unhandled_error", { error: new Error("boom") });
  const first = JSON.parse(lines[0]!);
  assert.equal(first.event, "http_request");
  assert.equal(first.status, 200);
  assert.equal(first.service, "workhub-api");
  const second = JSON.parse(lines[1]!);
  assert.equal(second.level, "error");
  assert.equal(second.error.message, "boom");

  const prettyLines: string[] = [];
  const pretty = createStructuredLogger({ format: "pretty", write: (line) => prettyLines.push(line) });
  pretty.warn("server_stopping", { exit_code: 130 });
  assert.equal(prettyLines[0]?.includes("WARN"), true);
  assert.equal(prettyLines[0]?.includes("exit_code=130"), true);
});

test("attachWebStatic makes the real app root serve the SPA instead of the API banner", async () => {
  const dist = await tempDist();
  const { app: realApp } = await import("./app.js");
  // Hono 路由器在首个请求后冻结；与生产一致，先挂载再请求。
  attachWebStatic(realApp, dist, createStructuredLogger({ write: () => undefined }));

  const root = await realApp.request("/");
  assert.equal(root.headers.get("content-type")?.includes("text/html"), true);
  assert.equal((await root.text()).includes("onboarding"), true);

  const deepLink = await realApp.request("/calendar");
  assert.equal((await deepLink.text()).includes("onboarding"), true);

  const health = await realApp.request("/api/health");
  assert.equal((await health.json() as { ok: boolean }).ok, true);
});
