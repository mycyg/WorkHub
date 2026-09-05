import assert from "node:assert/strict";
import test from "node:test";

import { createMcpServerRepository } from "./repositories/mcp-servers.js";
import { mcpServers } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// R26 M0（MCP 客户端接入·阶段 0）：MCP 服务器清单仓储。用 query recorder 断言仓储真的把工作区围栏、
// stdio-only 与启停语义编译进 SQL——纯内存，无真 PG。最要紧的一条：**每个原语都必须带 workspace_id
// 谓词**，跨租户读写在 SQL 层就不成立。

const at = new Date("2026-09-05T09:00:00.000Z");
const workspaceId = "11111111-1111-4111-8111-111111111111";

function serverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId,
    serverName: "gh",
    displayName: null,
    transport: "stdio",
    command: "/usr/local/bin/mcp-server-github",
    argsJson: [],
    envJson: {},
    secretRefsJson: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" },
    cwd: null,
    url: null,
    authHeaderCt: null,
    authHeaderIv: null,
    authHeaderTag: null,
    toolCallTimeoutMs: 60000,
    enabled: true,
    status: "connected",
    trustLevel: "external_effect",
    precheckReport: { verdict: "ok", checks: [], checked_at: at.toISOString() },
    lastError: null,
    toolCount: 2,
    toolsJson: ["create_pull_request", "search_repositories"],
    installedBy: null,
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

test("listForWorkspace fences on workspace_id and orders oldest-first", async () => {
  const { db, queries } = createQueryRecorder([[serverRow()]]);
  const rows = await createMcpServerRepository(db).listForWorkspace(workspaceId);
  assert.equal(rows.length, 1);
  const select = queries.find((query) => query.operation === "select");
  assert.equal(select?.fromTable, mcpServers);
  assert.ok(queryReferences(select?.where, mcpServers.workspaceId), "list must be workspace-fenced");
  assert.ok(queryParamValues(select?.where).includes(workspaceId));
  assert.ok(queryReferences(select?.orderBy[0], mcpServers.createdAt), "list order must be stable across toggles");
});

test("listEnabledForWorkspace only picks enabled, non-disabled rows for connection supervision", async () => {
  const { db, queries } = createQueryRecorder([[serverRow()]]);
  await createMcpServerRepository(db).listEnabledForWorkspace(workspaceId);
  const select = queries.find((query) => query.operation === "select");
  const where = select?.where;
  assert.ok(queryReferences(where, mcpServers.workspaceId), "connection supervision must be workspace-fenced");
  assert.ok(queryReferences(where, mcpServers.enabled), "must filter on enabled");
  assert.ok(queryReferences(where, mcpServers.status), "must exclude disabled rows");
  assert.ok(queryParamValues(where).includes("disabled"));
});

test("findByServerName is workspace-fenced (server_name uniqueness is per-workspace)", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const found = await createMcpServerRepository(db).findByServerName(workspaceId, "gh");
  assert.equal(found, null);
  const select = queries.find((query) => query.operation === "select");
  assert.ok(queryReferences(select?.where, mcpServers.workspaceId));
  assert.ok(queryReferences(select?.where, mcpServers.serverName));
  assert.equal(select?.limit, 1);
});

test("create always pins transport to stdio and returns the inserted row", async () => {
  const { db, queries } = createQueryRecorder([[serverRow()]]);
  const row = await createMcpServerRepository(db).create({
    workspaceId,
    serverName: "gh",
    command: "/usr/local/bin/mcp-server-github",
    secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" },
    status: "connected",
    precheckReport: { verdict: "ok", checks: [], checked_at: at.toISOString() },
    toolCount: 2,
    now: at
  });
  assert.equal(row.serverName, "gh");
  const insert = queries.find((query) => query.operation === "insert");
  const values = insert?.valuesValue as Record<string, unknown>;
  // 阶段 0 结构性只走 stdio：即便调用方将来传别的值，仓储层也钉死这一列。
  assert.equal(values["transport"], "stdio");
  assert.equal(values["enabled"], true, "a freshly registered server defaults to enabled");
  // 默认 external_effect：新增服务器不假设它安全，必须管理员主动降级。
  assert.equal(values["trustLevel"], "external_effect");
  // 密钥只存指针，不存值——本表结构性存不进任何一份明文凭据。
  assert.deepEqual(values["secretRefsJson"], { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" });
  assert.equal(insert?.returningCalled, true);
});

test("create honors an explicit trust_level assertion when the admin lowers it", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ trustLevel: "read_only" })]]);
  await createMcpServerRepository(db).create({
    workspaceId,
    serverName: "fs-readonly",
    command: "/usr/local/bin/mcp-server-filesystem",
    trustLevel: "read_only",
    status: "connected",
    precheckReport: { verdict: "ok", checks: [], checked_at: at.toISOString() },
    now: at
  });
  const insert = queries.find((query) => query.operation === "insert");
  const values = insert?.valuesValue as Record<string, unknown>;
  assert.equal(values["trustLevel"], "read_only");
});

test("setEnabled(false) flips status to disabled in the same UPDATE", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ enabled: false, status: "disabled" })]]);
  const row = await createMcpServerRepository(db).setEnabled({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    enabled: false,
    now: at
  });
  assert.equal(row?.status, "disabled");
  const update = queries.find((query) => query.operation === "update");
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["enabled"], false);
  assert.equal(setValue["status"], "disabled");
  assert.ok(queryReferences(update?.where, mcpServers.workspaceId), "toggling must be workspace-fenced");
});

test("setEnabled(true) does not claim a verified connection — status falls back to connect_failed, not a stale 'connected'", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ status: "connect_failed" })]]);
  await createMcpServerRepository(db).setEnabled({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    enabled: true,
    now: at
  });
  const setValue = queries.find((query) => query.operation === "update")?.setValue as Record<string, unknown>;
  assert.equal(setValue["enabled"], true);
  // MCP 没有 plugins 那个中性的 'installed' 态；真实状态由紧随其后的 updateConnectionResult 再修正。
  assert.equal(setValue["status"], "connect_failed");
});

test("updateConnectionResult persists the discovered tool list alongside the status", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ status: "connected", toolCount: 2 })]]);
  const row = await createMcpServerRepository(db).updateConnectionResult({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    status: "connected",
    toolCount: 2,
    tools: ["echo", "write_note"],
    now: at
  });
  assert.equal(row?.status, "connected");
  const setValue = queries.find((query) => query.operation === "update")?.setValue as Record<string, unknown>;
  assert.equal(setValue["status"], "connected");
  assert.deepEqual(setValue["toolsJson"], ["echo", "write_note"]);
  assert.equal(setValue["lastError"], null, "a successful connection clears any previous error");
});

test("updateConnectionResult records a human-readable failure reason and is workspace-fenced", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ status: "connect_failed", toolCount: 0 })]]);
  const row = await createMcpServerRepository(db).updateConnectionResult({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    status: "connect_failed",
    toolCount: 0,
    lastError: "handshake timed out after 20s",
    now: at
  });
  assert.equal(row?.status, "connect_failed");
  const update = queries.find((query) => query.operation === "update");
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["lastError"], "handshake timed out after 20s");
  assert.ok(queryReferences(update?.where, mcpServers.workspaceId));
});

test("remove is workspace-fenced and reports whether a row was actually deleted", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const removed = await createMcpServerRepository(db).remove(workspaceId, "22222222-2222-4222-8222-222222222222");
  assert.equal(removed, false, "a miss must not report a deletion");
  const remove = queries.find((query) => query.operation === "delete");
  assert.equal(remove?.targetTable, mcpServers);
  assert.ok(queryReferences(remove?.where, mcpServers.workspaceId));
  assert.equal(remove?.returningCalled, true);
});

// —— R26 M3（治理端点）：改配置 —— //

test("updateSettings only writes the columns the caller actually passed", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ trustLevel: "read_only" })]]);
  const row = await createMcpServerRepository(db).updateSettings({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    trustLevel: "read_only",
    now: at
  });
  assert.equal(row?.trustLevel, "read_only");
  const update = queries.find((query) => query.operation === "update");
  const setValue = update?.setValue as Record<string, unknown>;
  assert.equal(setValue["trustLevel"], "read_only");
  // 一次只改信任级别的 PATCH 绝不能顺手把环境变量与密钥引用清空——`env`/`secretRefs` 是整份替换语义，
  // 分不清「没传」与「传了空对象」就会把一次改超时变成一次事故。
  assert.equal("envJson" in setValue, false, "an untouched env must not appear in the SET clause");
  assert.equal("secretRefsJson" in setValue, false, "untouched secret references must not appear in the SET clause");
  assert.ok(queryReferences(update?.where, mcpServers.workspaceId), "settings edits must be workspace-fenced");
  assert.ok(queryParamValues(update?.where).includes(workspaceId));
});

test("updateSettings can replace env and secret references wholesale, including with an empty map", async () => {
  const { db, queries } = createQueryRecorder([[serverRow({ envJson: {}, secretRefsJson: {} })]]);
  await createMcpServerRepository(db).updateSettings({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    env: {},
    secretRefs: {},
    toolCallTimeoutMs: 30000,
    now: at
  });
  const setValue = queries.find((query) => query.operation === "update")?.setValue as Record<string, unknown>;
  // 传了空对象就是「清空」——与「没传」是两件事，两者都要能表达。
  assert.deepEqual(setValue["envJson"], {});
  assert.deepEqual(setValue["secretRefsJson"], {});
  assert.equal(setValue["toolCallTimeoutMs"], 30000);
  // 启停与连接结果各有自己的入口，改配置这条路不碰它们。
  assert.equal("enabled" in setValue, false);
  assert.equal("status" in setValue, false);
});
