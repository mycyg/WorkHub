import assert from "node:assert/strict";
import test from "node:test";

import {
  mcpPrecheckCheckIdSchema,
  mcpPrecheckReportSchema,
  mcpServerStatusSchema,
  mcpServerSummaryVmSchema,
  mcpServerTrustLevelSchema,
  mcpServerVmSchema,
  mcpTransportSchema
} from "./index.js";

// R26 M0（MCP 客户端接入·阶段 0）：治理契约。这些断言钉的是治理红线，不是字段拼写。

const checkedAt = "2026-09-05T09:00:00.000Z";

function precheckReport(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "ok",
    checks: [{ id: "server_name", level: "pass" }],
    checked_at: checkedAt,
    ...overrides
  };
}

function serverVm(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    server_name: "gh",
    transport: "stdio",
    command: "/usr/local/bin/mcp-server-github",
    args: [],
    env: {},
    secret_refs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" },
    tool_call_timeout_ms: 60000,
    enabled: true,
    status: "connected",
    trust_level: "external_effect",
    precheck_report: precheckReport(),
    tool_count: 2,
    created_at: checkedAt,
    updated_at: checkedAt,
    ...overrides
  };
}

test("phase 0 transport is stdio only — the literal leaves no room for a caller to smuggle in http", () => {
  assert.equal(mcpTransportSchema.parse("stdio"), "stdio");
  // HTTP 引入出网治理与密钥落库两件全新的事，值得单独一批；阶段 0 结构性不给它一个可表达的值。
  for (const refused of ["http", "https", "sse", "streamable_http"]) {
    assert.equal(mcpTransportSchema.safeParse(refused).success, false, `${refused} must not be accepted yet`);
  }
});

test("server status covers connected / connect_failed / disabled and nothing else", () => {
  for (const status of ["connected", "connect_failed", "disabled"]) {
    assert.equal(mcpServerStatusSchema.parse(status), status);
  }
  // 没有 plugins 的 'installed' —— MCP 是有状态长连接，登记后立刻按新清单连接一次。
  assert.equal(mcpServerStatusSchema.safeParse("installed").success, false);
  assert.equal(mcpServerStatusSchema.safeParse("crashed").success, false);
});

test("trust level is exactly the two-value admin-assertion ceiling — read_only and external_effect, nothing wider", () => {
  for (const level of ["read_only", "external_effect"]) {
    assert.equal(mcpServerTrustLevelSchema.parse(level), level);
  }
  // 没有第三档：最终风险 = 管理员断言 AND 服务器自述，词表只需要「上限在哪」两个值。
  assert.equal(mcpServerTrustLevelSchema.safeParse("write").success, false);
  assert.equal(mcpServerTrustLevelSchema.safeParse("none").success, false);
  assert.equal(mcpServerTrustLevelSchema.safeParse("full_trust").success, false);
});

test("an unknown precheck check id is refused (the id set is a shared contract, not free text)", () => {
  for (const id of [
    "server_name",
    "command_resolvable",
    "remote_exec_launcher",
    "args_shape",
    "env_credential_shaped",
    "env_overrides_base",
    "secret_refs_present"
  ]) {
    assert.equal(mcpPrecheckCheckIdSchema.parse(id), id);
  }
  assert.equal(mcpPrecheckCheckIdSchema.safeParse("vibes").success, false);
});

test("a precheck report records every check with a verdict level", () => {
  const report = mcpPrecheckReportSchema.parse(
    precheckReport({
      verdict: "blocked",
      checks: [
        { id: "remote_exec_launcher", level: "block", detail: "command resolves to npx" },
        { id: "command_resolvable", level: "pass" }
      ]
    })
  );
  assert.equal(report.verdict, "blocked");
  assert.equal(report.checks[0]?.level, "block");
});

test("the server VM always carries a precheck report; secret_refs never carries a value, only a pointer", () => {
  const vm = mcpServerVmSchema.parse(serverVm());
  assert.equal(vm.precheck_report.verdict, "ok");
  assert.equal(vm.secret_refs["GITHUB_TOKEN"], "WORKHUB_MCP_SECRET_GITHUB");
  // 引用的服务端变量名不是密钥值本身——契约层不会因为字符串长得像密钥就拒绝，
  // 因为它存的是变量名（不落库明文密钥是应用层 + DB 层的责任，不是这里）。
  const { precheck_report: _dropped, ...withoutPrecheck } = serverVm();
  assert.equal(mcpServerVmSchema.safeParse(withoutPrecheck).success, false, "every record must carry its health check");
});

test("server_name is bounded to the same alphabet the tool-name namespace depends on", () => {
  assert.equal(mcpServerVmSchema.safeParse(serverVm({ server_name: "github tools" })).success, false, "spaces are not allowed");
  assert.equal(
    mcpServerVmSchema.safeParse(serverVm({ server_name: "a".repeat(33) })).success,
    false,
    "over the 32-char budget the mcp__<name>__ prefix eats into the 64-char tool id budget"
  );
  assert.equal(mcpServerVmSchema.parse(serverVm({ server_name: "gh-search_2" })).server_name, "gh-search_2");
});

test("tool_call_timeout_ms is bounded to [1000, 300000] — matches the mcp_servers_timeout_ck constraint", () => {
  assert.equal(mcpServerVmSchema.safeParse(serverVm({ tool_call_timeout_ms: 999 })).success, false);
  assert.equal(mcpServerVmSchema.safeParse(serverVm({ tool_call_timeout_ms: 300001 })).success, false);
  assert.equal(mcpServerVmSchema.parse(serverVm({ tool_call_timeout_ms: 1000 })).tool_call_timeout_ms, 1000);
  assert.equal(mcpServerVmSchema.parse(serverVm({ tool_call_timeout_ms: 300000 })).tool_call_timeout_ms, 300000);
});

test("the web-facing summary row never carries command, args, env, secret_refs or cwd", () => {
  const summary = mcpServerSummaryVmSchema.parse({
    id: "22222222-2222-4222-8222-222222222222",
    server_name: "gh",
    transport: "stdio",
    enabled: true,
    status: "connected",
    trust_level: "external_effect",
    tool_count: 2,
    precheck_verdict: "ok"
  });
  // 这些是这台服务器上的宿主机事实与潜在凭据指针——网页只读列表不需要它们，契约层就不给它们位置。
  for (const hostFact of ["command", "args", "env", "secret_refs", "cwd"]) {
    assert.equal(hostFact in summary, false, `summary VM must not carry ${hostFact}`);
  }
  assert.equal(
    mcpServerSummaryVmSchema.safeParse({
      id: "22222222-2222-4222-8222-222222222222",
      server_name: "gh",
      transport: "stdio",
      enabled: true,
      status: "connected",
      trust_level: "external_effect",
      tool_count: 2,
      precheck_verdict: "sure-why-not"
    }).success,
    false
  );
});
