import assert from "node:assert/strict";
import test from "node:test";

import app from "./app.js";

/**
 * R5.12 常驻 fail-closed 路由门：除显式公开白名单外，任何已注册 API 路由在未鉴权时
 * 必须返回 401/403。新路由若漏接鉴权中间件，本测试即红——多用户 pilot 形态的安全底线。
 */

// 公开路由白名单（逐条理由）：
// - GET /                  应用外壳/API banner（无用户数据）
// - GET /api/health        存活探针
// - GET /openapi.json, /api/openapi.json  契约种子（无用户数据）
// - POST /api/auth/identify 注册/登入入口本身
// - GET /api/auth/me       未识别时返回 null（不泄漏数据）
// - GET /api/pages/gold-path P0.5 demo fixture 模板（无真实用户数据；退役计划见 R4 审查 P0-3）
const PUBLIC_ROUTES = new Set<string>([
  "GET /",
  "GET /api/health",
  "GET /openapi.json",
  "GET /api/openapi.json",
  "POST /api/auth/identify",
  "GET /api/auth/me",
  "GET /api/pages/gold-path"
]);

function registeredRoutes() {
  const routes = (app as unknown as { routes: Array<{ method: string; path: string }> }).routes;
  const seen = new Set<string>();
  const unique: Array<{ method: string; path: string }> = [];
  for (const route of routes) {
    if (route.method === "ALL") {
      continue;
    }
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({ method: route.method, path: route.path });
  }
  return unique;
}

function concretePath(path: string) {
  return path.replace(/:[A-Za-z]+/gu, "00000000-0000-4000-8000-000000000001");
}

test("every non-public route fails closed (401/403) without authentication", async () => {
  const routes = registeredRoutes();
  assert.equal(routes.length > 40, true, "route inventory looks too small — probe wiring broke");

  const leaks: string[] = [];
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (PUBLIC_ROUTES.has(key)) {
      continue;
    }
    const response = await app.request(concretePath(route.path), { method: route.method });
    if (response.status !== 401 && response.status !== 403) {
      leaks.push(`${key} -> ${response.status}`);
    }
  }

  assert.deepEqual(leaks, [], `unauthenticated routes must fail closed; leaks: ${leaks.join(", ")}`);
});

test("the public whitelist only contains routes that actually exist", async () => {
  const registered = new Set(registeredRoutes().map((route) => `${route.method} ${route.path}`));
  const stale = [...PUBLIC_ROUTES].filter((entry) => !registered.has(entry));
  assert.deepEqual(stale, [], `public whitelist has stale entries: ${stale.join(", ")}`);
});
