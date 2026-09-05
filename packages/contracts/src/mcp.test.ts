import assert from "node:assert/strict";
import test from "node:test";

import {
  addMcpServerRequestSchema,
  mcpPrecheckCheckIdSchema,
  mcpPrecheckReportSchema,
  mcpServerActionResultSchema,
  mcpServerConnectionVmSchema,
  mcpServerErrorCodeSchema,
  mcpServerListVmSchema,
  mcpServerStatusSchema,
  mcpServerSummaryVmSchema,
  mcpServerTrustLevelSchema,
  mcpServerVmSchema,
  mcpTransportSchema,
  updateMcpServerRequestSchema
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
    "secret_ref_scope",
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

// —— R26 M8（稳定错误码）：连不上的原因有码可依 —— //

test("M8 the failure code enum covers all eight session reasons plus the no-reason fallback", () => {
  // 这九条是两端界面唯一允许 switch 的东西。少一条，桌面端/网页端就只能回去解析英文诊断串；
  // 多一条没人认识的，界面会掉进 default 分支说一句笼统的话——所以整份词表在契约层钉死。
  assert.deepEqual(mcpServerErrorCodeSchema.options, [
    "mcp_spawn_failed",
    "mcp_handshake_timeout",
    "mcp_protocol_version_unsupported",
    "mcp_protocol_error",
    "mcp_server_error",
    "mcp_call_timeout",
    "mcp_not_running",
    "mcp_exited",
    "mcp_connect_failed"
  ]);
  assert.equal(mcpServerErrorCodeSchema.safeParse("mcp_admin_required").success, false, "治理面的 HTTP 错误码不属于这张表");
});

test("M8 last_error_code is optional on all three read shapes and rejects free text", () => {
  // 可选是刻意的：行上存的是诊断文本，表里没有存码的列，重启 API 之后码就没了。
  // 缺席 = 「这个进程说不出这一次的原因」，不是「没出过错」。
  assert.equal(mcpServerVmSchema.parse(serverVm()).last_error_code, undefined);
  assert.equal(
    mcpServerVmSchema.parse(serverVm({ last_error: "spawn ENOENT", last_error_code: "mcp_spawn_failed" })).last_error_code,
    "mcp_spawn_failed"
  );
  // 自由文本进不了这个字段——它存在的全部意义就是「界面不必解析自由文本」。
  assert.equal(mcpServerVmSchema.safeParse(serverVm({ last_error_code: "spawn ENOENT" })).success, false);

  const connection = mcpServerConnectionVmSchema.parse({
    live: false,
    tool_count: 0,
    last_error: "handshake timed out after 10000ms",
    last_error_code: "mcp_handshake_timeout"
  });
  assert.equal(connection.last_error_code, "mcp_handshake_timeout");
  assert.equal(mcpServerConnectionVmSchema.parse({ live: true, tool_count: 3 }).last_error_code, undefined);

  const summary = mcpServerSummaryVmSchema.parse({
    id: "22222222-2222-4222-8222-222222222222",
    server_name: "gh",
    transport: "stdio",
    enabled: true,
    status: "connect_failed",
    trust_level: "external_effect",
    tool_count: 0,
    precheck_verdict: "ok",
    last_error_code: "mcp_exited"
  });
  assert.equal(summary.last_error_code, "mcp_exited");
  // 码不带宿主机信息，所以网页只读行收得下它；诊断文本仍然结构性没有位置。
  assert.equal("last_error" in summary, false);
});

// —— R26 M3（治理服务与端点）：请求与响应契约 —— //

test("M3 add request is strict — an unknown field is a 422, never a silently dropped setting", () => {
  const accepted = addMcpServerRequestSchema.parse({
    server_name: "gh",
    command: "/usr/local/bin/mcp-server-github",
    args: ["--stdio"],
    secret_refs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" }
  });
  assert.equal(accepted.server_name, "gh");
  // transport / url / status 全是服务端事实，不是调用方能提的——多一个字段就拒。
  for (const smuggled of [
    { transport: "http" },
    { url: "https://example.invalid/mcp" },
    { status: "connected" },
    { tool_count: 99 }
  ]) {
    assert.equal(
      addMcpServerRequestSchema.safeParse({
        server_name: "gh",
        command: "/usr/local/bin/mcp-server-github",
        ...smuggled
      }).success,
      false,
      `${JSON.stringify(smuggled)} must not be accepted`
    );
  }
});

test("M3 add request keeps the name shape check in the health report, not in the schema", () => {
  // 形状不合的名字要走到体检那一条 `server_name` 检查上去，才能拿到 mcp_server_name_invalid
  // 这个**专属**的码；在契约层挡掉只会得到一个通用 validation_error，UI 说不出为什么。
  assert.equal(addMcpServerRequestSchema.safeParse({ server_name: "gh search", command: "x" }).success, true);
  assert.equal(addMcpServerRequestSchema.safeParse({ server_name: "a".repeat(33), command: "x" }).success, true);
  // 但空名字与超长串仍然在契约层就拒——那不是「名字不合规」，那是请求本身不成立。
  assert.equal(addMcpServerRequestSchema.safeParse({ server_name: "", command: "x" }).success, false);
  assert.equal(addMcpServerRequestSchema.safeParse({ server_name: "a".repeat(201), command: "x" }).success, false);
});

test("M3 update request refuses to rename a server or repoint its command", () => {
  assert.equal(updateMcpServerRequestSchema.parse({ trust_level: "read_only" }).trust_level, "read_only");
  // 改名 = 模型可见工具名整体换一批（历史审计还挂在旧名下）；改命令 = 指向另一个可执行文件。
  // 两者都要走「移除再添加」，好让体检与审计重新跑一遍完整流程。
  for (const refused of [{ server_name: "gh2" }, { command: "/usr/bin/other" }, { enabled: false }]) {
    assert.equal(updateMcpServerRequestSchema.safeParse(refused).success, false, JSON.stringify(refused));
  }
});

test("M3 empty update is refused — a silent 200 would read as 'saved'", () => {
  assert.equal(updateMcpServerRequestSchema.safeParse({}).success, false);
});

test("M3 update keeps the same timeout bounds as the column check", () => {
  assert.equal(updateMcpServerRequestSchema.safeParse({ tool_call_timeout_ms: 999 }).success, false);
  assert.equal(updateMcpServerRequestSchema.safeParse({ tool_call_timeout_ms: 300001 }).success, false);
  assert.equal(updateMcpServerRequestSchema.parse({ tool_call_timeout_ms: 1000 }).tool_call_timeout_ms, 1000);
});

test("M3 action result keeps 'this row says' and 'this process sees' as two separate facts", () => {
  const result = mcpServerActionResultSchema.parse({
    server: serverVm(),
    // 空闲回收把子进程收掉之后 live=false 而 status 仍是 connected——这不是矛盾，
    // 下一次用到它会重新握手。两件事挤进一个字段，设置页就只能说错话。
    connection: { live: false, tool_count: 2, tool_ids: ["mcp__gh__create_pull_request"] },
    risk_tokens: []
  });
  assert.equal(result.server.status, "connected");
  assert.equal(result.connection?.live, false);
  // 停用的服务器本进程不给它连，故连接事实可以整体缺席（不是 live:false 那种「连过但没活着」）。
  assert.equal(mcpServerActionResultSchema.parse({ server: serverVm(), risk_tokens: [] }).connection, undefined);
});

test("M3 action result carries the server name's high-risk words so the form can say it up front", () => {
  const result = mcpServerActionResultSchema.parse({
    server: serverVm({ server_name: "finance" }),
    risk_tokens: ["finance"]
  });
  // 一台叫 finance 的服务器，它的每个工具都会被归到财务类，每次调用都停下来转人。
  assert.deepEqual(result.risk_tokens, ["finance"]);
});

test("M3 list response exposes secret reference names only — never their values", () => {
  const list = mcpServerListVmSchema.parse({
    servers: [serverVm()],
    connections: { "22222222-2222-4222-8222-222222222222": { live: true, tool_count: 2 } },
    secret_ref_env_prefix: "WORKHUB_MCP_SECRET_",
    available_secret_refs: ["WORKHUB_MCP_SECRET_GITHUB"]
  });
  assert.deepEqual(list.available_secret_refs, ["WORKHUB_MCP_SECRET_GITHUB"]);
  // 值的位置在契约里根本不存在：这一列是「服务端有哪些变量名可以引用」，不是变量的内容。
  assert.equal(
    mcpServerListVmSchema.safeParse({
      servers: [],
      connections: {},
      secret_ref_env_prefix: "WORKHUB_MCP_SECRET_",
      available_secret_refs: [{ name: "WORKHUB_MCP_SECRET_GITHUB", value: "ghp_live" }]
    }).success,
    false
  );
});
