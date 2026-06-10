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
  assert.equal(zh.includes("正在加载真实数据"), true);
  assert.equal(en.includes("Loading real data"), true);
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

test("route state css keeps long text within frames", () => {
  assert.match(routeStateCss, /\.wh-route-state-card\{[^}]*min-width:0;max-width:100%;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(routeStateCss, /\.wh-route-state-row\{[^}]*grid-template-columns:160px repeat\(4,minmax\(0,1fr\)\)/u);
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
  assert.equal(forbidden.includes("需要项目负责人授权"), true);
  assert.equal(forbidden.includes("你没有权限查看"), true);
});
