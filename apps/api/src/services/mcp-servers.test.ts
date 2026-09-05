import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { CreateAuditLogInput, McpServerRepository, McpServerRow } from "@workhub/db";
import { McpSessionError } from "@workhub/mcp-client/stdio";

import type { AuthActor } from "../middleware/auth.js";
import {
  createMcpServerService,
  describeMcpSessionFailure,
  McpServiceError,
  resolveMcpCommandOnDisk,
  serverNameRiskTokens,
  toMcpServerVm
} from "./mcp-servers.js";

// R26 M3：治理服务里那几件不经过 HTTP 也必须成立的事——警告级体检照样能添加、名字里的高风险词、
// 命令存在性怎么查、会话失败原因怎么变成人话。端到端的治理语义在 routes/mcp-servers.test.ts。

const now = new Date("2026-09-05T09:00:00.000Z");
const workspaceId = "11111111-1111-4111-8111-111111111111";
const adminUserId = "70000000-0000-4000-8000-0000000000a1";
const serverId = "33333333-3333-4333-8333-333333333333";

const admin: AuthActor = {
  kind: "human",
  id: adminUserId,
  label: "r26-admin",
  userId: adminUserId,
  isAdmin: true,
  orgId: "00000000-0000-4000-8000-000000000001",
  workspaceId
};

function row(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: serverId,
    workspaceId,
    serverName: "gh",
    displayName: null,
    transport: "stdio",
    command: "/usr/local/bin/mcp-server-github",
    argsJson: [],
    envJson: {},
    secretRefsJson: {},
    cwd: null,
    url: null,
    authHeaderCt: null,
    authHeaderIv: null,
    authHeaderTag: null,
    toolCallTimeoutMs: 60000,
    enabled: true,
    status: "connected",
    trustLevel: "external_effect",
    precheckReport: {
      verdict: "ok",
      checks: [{ id: "server_name", level: "pass" }],
      checked_at: now.toISOString()
    } as unknown as McpServerRow["precheckReport"],
    lastError: null,
    toolCount: 0,
    toolsJson: null,
    installedBy: adminUserId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as McpServerRow;
}

/** 只实现 `add` 这条路真的会走到的原语；其余故意抛错，走到了就是测试写歪了。 */
function addOnlyRepository() {
  const rows: McpServerRow[] = [];
  const repository: McpServerRepository = {
    async listForWorkspace() {
      return rows;
    },
    async listEnabledForWorkspace() {
      return rows.filter((entry) => entry.enabled);
    },
    async findById(_scope, id) {
      return rows.find((entry) => entry.id === id) ?? null;
    },
    async findByServerName(_scope, serverName) {
      return rows.find((entry) => entry.serverName === serverName) ?? null;
    },
    async create(input) {
      const created = row({
        workspaceId: input.workspaceId,
        serverName: input.serverName,
        command: input.command,
        secretRefsJson: input.secretRefs ?? {},
        enabled: input.enabled ?? true,
        status: input.status,
        precheckReport: input.precheckReport as unknown as McpServerRow["precheckReport"],
        toolCount: 0
      });
      rows.push(created);
      return created;
    },
    async updateConnectionResult() {
      return rows[0] ?? null;
    },
    async updateSettings() {
      throw new Error("not needed");
    },
    async setEnabled() {
      throw new Error("not needed");
    },
    async remove() {
      throw new Error("not needed");
    }
  };
  return { repository, rows };
}

function service(options: { envSource?: Record<string, string | undefined> } = {}) {
  const audits: CreateAuditLogInput[] = [];
  const { repository, rows } = addOnlyRepository();
  const instance = createMcpServerService({
    repository,
    auditLog: {
      async createAuditLog(input) {
        audits.push(input);
        return { id: "audit-1", ...input } as never;
      }
    },
    client: { status: () => [], reload: async () => [] },
    resolveCommand: async () => ({ found: true, executable: true, resolvedPath: "/usr/local/bin/mcp-server-github" }),
    envSource: options.envSource ?? { PATH: "/usr/bin" },
    now: () => now
  });
  return { instance, audits, rows };
}

test("警告级体检照样能添加，警告原样保留在记录上", async () => {
  // 引用的服务端变量还没配置只 warn 不 block：管理员完全可能先把服务器填好、再去改部署环境重启。
  // spawn 的时候仍然是 fail-closed 的（buildMcpChildEnv 直接抛错）——允许你先填，不代表凭据缺着也能起。
  const { instance, audits, rows } = service({ envSource: { PATH: "/usr/bin" } });
  const result = await instance.add({
    actor: admin,
    request: {
      server_name: "gh",
      command: "/usr/local/bin/mcp-server-github",
      secret_refs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" }
    }
  });
  assert.equal(result.server.precheck_report.verdict, "warn");
  const warned = result.server.precheck_report.checks.find((check) => check.level === "warn");
  assert.equal(warned?.id, "secret_refs_present");
  assert.equal(rows.length, 1);
  assert.equal(audits[0]?.action, "mcp_server.added");
  assert.equal(audits[0]?.detailJson?.["precheck_verdict"], "warn");
});

test("同一份配置，服务端变量配上之后体检就干净了", async () => {
  const { instance } = service({ envSource: { PATH: "/usr/bin", WORKHUB_MCP_SECRET_GITHUB: "value" } });
  const result = await instance.add({
    actor: admin,
    request: {
      server_name: "gh",
      command: "/usr/local/bin/mcp-server-github",
      secret_refs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" }
    }
  });
  assert.equal(result.server.precheck_report.verdict, "ok");
});

test("非管理员在服务层就被拦下，不依赖路由记得加一道门", async () => {
  const { instance } = service();
  const member: AuthActor = { ...admin, isAdmin: false };
  await assert.rejects(
    () => instance.list({ actor: member }),
    (error: unknown) => error instanceof McpServiceError && error.status === 403 && error.code === "mcp_admin_required"
  );
  // 机器身份（非 human）同样不行——治理面只对着人开。
  await assert.rejects(
    () => instance.list({ actor: { ...admin, kind: "ai" } }),
    (error: unknown) => error instanceof McpServiceError && error.code === "mcp_admin_required"
  );
});

test("服务器名里的高风险词按人工保留门的真词表判，本文件不留副本", () => {
  // 一台叫 finance 的服务器，它的每个工具都会被归到财务类，每次调用都停下来转人。
  assert.deepEqual(serverNameRiskTokens("finance"), ["finance"]);
  assert.deepEqual(serverNameRiskTokens("publish"), ["publish"]);
  // 分词与那道门同口径：短横线/下划线/驼峰都切得开。
  assert.deepEqual(serverNameRiskTokens("acme-payments"), ["payments"]);
  assert.deepEqual(serverNameRiskTokens("legalDesk"), ["legal"]);
  // 正常的短名一个都不该命中——这条要是红了，说明词表被扩得太宽，日常服务器会被无差别升级。
  for (const harmless of ["gh", "fs", "db", "search", "notes"]) {
    assert.deepEqual(serverNameRiskTokens(harmless), [], harmless);
  }
});

test("命令存在性：绝对路径看那一个文件，裸名走 PATH，两条都只回结论", async () => {
  // 用当前这个 node 可执行文件当夹具：它一定存在、一定可执行，且不需要往磁盘上写任何东西。
  const absolute = await resolveMcpCommandOnDisk(process.execPath, {});
  assert.deepEqual(absolute, { found: true, executable: true, resolvedPath: process.execPath });

  const onPath = await resolveMcpCommandOnDisk(path.basename(process.execPath), {
    PATH: path.dirname(process.execPath)
  });
  assert.equal(onPath.found, true);
  assert.equal(onPath.executable, true);

  const missing = await resolveMcpCommandOnDisk(path.join(path.dirname(process.execPath), "definitely-not-here"), {});
  assert.deepEqual(missing, { found: false, executable: false });

  // PATH 是空的时候裸名找不到，而不是悄悄回落到进程 cwd。
  assert.deepEqual(await resolveMcpCommandOnDisk("mcp-server-github", { PATH: "" }), {
    found: false,
    executable: false
  });
  assert.deepEqual(await resolveMcpCommandOnDisk("   ", {}), { found: false, executable: false });
});

test("会话失败原因逐条有自己的码与人话，拿不到原因时回落到「连不上」", () => {
  const reasons = [
    ["spawn_failed", "mcp_spawn_failed"],
    ["handshake_timeout", "mcp_handshake_timeout"],
    ["protocol_version_unsupported", "mcp_protocol_version_unsupported"],
    ["protocol_error", "mcp_protocol_error"],
    ["server_error", "mcp_server_error"],
    ["call_timeout", "mcp_call_timeout"],
    ["not_running", "mcp_not_running"],
    ["exited", "mcp_exited"]
  ] as const;
  const seen = new Set<string>();
  for (const [reason, code] of reasons) {
    const described = describeMcpSessionFailure(new McpSessionError(reason, "raw english diagnostic"));
    assert.equal(described.code, code, reason);
    // 人话，不是把英文诊断原样转发——展示层按码出话正是为了不去解析它。
    assert.equal(described.message.includes("raw english diagnostic"), false, reason);
    assert.equal(seen.has(described.message), false, `${reason} must not reuse another reason's wording`);
    seen.add(described.message);
  }
  assert.equal(describeMcpSessionFailure(new Error("boom")).code, "mcp_connect_failed");
  assert.equal(describeMcpSessionFailure(undefined).code, "mcp_connect_failed");
});

test("行 → VM：缺席的可选字段是缺席，不是空串或空数组", () => {
  const vm = toMcpServerVm(row());
  assert.equal("display_name" in vm, false);
  assert.equal("cwd" in vm, false);
  assert.equal("last_error" in vm, false);
  // tools 缺席 = 「还没发现过工具」；空数组会被读成「连上了但一个工具都没有」，是两件事。
  assert.equal("tools" in vm, false);
  assert.deepEqual(toMcpServerVm(row({ toolsJson: ["echo"] })).tools, ["echo"]);
  assert.equal(toMcpServerVm(row({ lastError: "spawn ENOENT" })).last_error, "spawn ENOENT");
});
