import assert from "node:assert/strict";
import test from "node:test";

import {
  r4RouteStateKinds,
  r4WebRouteKeys,
  renderRouteStateCard,
  renderRouteStateMatrix,
  routeStateCss
} from "./route-state.js";

test("route state matrix covers every R4 web route and every required state", () => {
  const zh = renderRouteStateMatrix({ locale: "zh-CN" });
  const en = renderRouteStateMatrix({ locale: "en-US" });

  for (const routeKey of r4WebRouteKeys) {
    assert.equal(zh.includes(`data-route-key="${routeKey}"`), true);
    assert.equal(en.includes(`data-route-key="${routeKey}"`), true);
  }
  for (const state of r4RouteStateKinds) {
    assert.equal(zh.includes(`data-route-state="${state}"`), true);
    assert.equal(en.includes(`data-route-state="${state}"`), true);
  }
  assert.equal(zh.includes("正在加载"), true);
  assert.equal(zh.includes("真实数据"), false);
  assert.equal(en.includes("Loading"), true);
  assert.equal(en.includes("real data"), false);
  assert.equal(zh.includes("你没有权限查看"), true);
  assert.equal(en.includes("You do not have access"), true);
});

test("route state copy stays serious and does not leak pet or default board language", () => {
  const matrix = `${renderRouteStateMatrix({ locale: "zh-CN" })}${renderRouteStateMatrix({ locale: "en-US" })}`;

  assert.equal(matrix.includes("Cuu"), false);
  assert.equal(matrix.includes("wh-cuu"), false);
  assert.equal(matrix.includes("data-cuu"), false);
  assert.equal(matrix.toLowerCase().includes("kanban"), false);
});

test("R9.7 route state agent dashboard label uses the canonical AI team name", () => {
  const en = renderRouteStateMatrix({ locale: "en-US", routeKeys: ["agents"], states: ["loading"] });
  const zh = renderRouteStateMatrix({ locale: "zh-CN", routeKeys: ["agents"], states: ["loading"] });

  assert.equal(en.includes("AI teams"), true);
  assert.equal(en.includes("Agent Army"), false);
  assert.equal(zh.includes("AI 小组"), true);
  assert.equal(zh.includes("军团"), false);
});

test("route state css keeps long text within frames", () => {
  assert.match(routeStateCss, /\.wh-route-state-card\{[^}]*min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(routeStateCss, /\.wh-route-state-row\{[^}]*grid-template-columns:160px repeat\(5,minmax\(0,1fr\)\)/u);
  assert.match(routeStateCss, /@media \(max-width:980px\)/u);
});

test("route state card carries trace and owner context without exposing private content", () => {
  const error = renderRouteStateCard({
    routeKey: "proposal",
    state: "error",
    locale: "en-US",
    traceId: "trace_id=route-state-test"
  });
  const forbidden = renderRouteStateCard({
    routeKey: "approvals",
    state: "forbidden",
    locale: "zh-CN",
    ownerLabel: "需要项目负责人授权"
  });

  assert.equal(error.includes("trace_id=route-state-test"), true);
  assert.equal(error.includes("This page failed to load"), true);
  // A2-06：没有 traceId 时不再兜底渲内部轮次代号，整条 footer 消失。
  const errorWithoutTrace = renderRouteStateCard({ routeKey: "proposal", state: "error", locale: "en-US" });
  assert.equal(errorWithoutTrace.includes("r4-web-route-state"), false);
  assert.equal(errorWithoutTrace.includes("data-route-state-trace"), false);
  assert.equal(forbidden.includes("需要项目负责人授权"), true);
  assert.equal(forbidden.includes("你没有权限查看"), true);
});

test("route state loading actions retry the concrete route instead of a path template", () => {
  const html = renderRouteStateCard({
    routeKey: "intake",
    state: "loading",
    locale: "en-US",
    route: "/intake/real-session-id"
  });

  assert.equal(html.includes('href="/intake/real-session-id"'), true);
  assert.equal(html.includes('href="/intake/:sessionId"'), false);
});
