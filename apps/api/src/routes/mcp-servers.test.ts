import assert from "node:assert/strict";
import test from "node:test";

import { captureStdoutLines } from "@workhub/tools/test-support";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  CreateAuditLogInput,
  McpServerRepository,
  McpServerRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { McpServerActionResult, McpServerListVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createMcpServerService, McpServiceError } from "../services/mcp-servers.js";
import type { McpServerStatusSnapshot } from "../services/mcp-client.js";
import { buildSettingsPage } from "../pages/settings.js";
import { createMcpServerRoutes } from "./mcp-servers.js";

// R26 M3：MCP 服务器治理端点的端到端行为（真路由 + 真服务 + 内存仓储 + 假连接监督）。
// 钉的是治理语义，不是字段拼写：非管理员进不来、体检拒绝的每一类各有自己的码、
// 「连不上」是一条**记录**而不是一次失败的请求、每个写动作之后行真的被重读过、六个动作各落一条审计。
//
// 假连接监督刻意**照 M2 的真实行为写**：`reload()` 会经 `updateConnectionResult` 把结果写回行。
// 这一点是本文件最要紧的夹具决定——服务层「reload 一次、再把行读一遍」那一步如果被删掉，
// 只有这样写夹具的测试才会红（否则行永远停在登记时那个「还没验证过」的状态，断言也照样过）。

const now = new Date("2026-09-05T09:00:00.000Z");
const adminUserId = "70000000-0000-4000-8000-0000000000a1";
const memberUserId = "70000000-0000-4000-8000-0000000000b1";
const serverId = "33333333-3333-4333-8333-333333333333";
const GH_COMMAND = "/usr/local/bin/mcp-server-github";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r26-mcp-secret" });
}

// actor.workspaceId 来自认证解析（单租户下回退 defaultWorkspaceId）——夹具行必须落在同一个工作区里，
// 否则测的就不是治理语义而是「工作区围栏挡住了自己的夹具」。
const workspaceId = settings().auth.defaultWorkspaceId;

function user(isAdmin: boolean): UserAuthRow {
  return {
    id: isAdmin ? adminUserId : memberUserId,
    nickname: isAdmin ? "r26-admin" : "r26-member",
    cookieToken: isAdmin ? "cookie-admin" : "cookie-member",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    if (id === adminUserId) return user(true);
    if (id === memberUserId) return user(false);
    return null;
  }
  async findActiveByCookieToken(token: string) {
    if (token === "cookie-admin") return user(true);
    if (token === "cookie-member") return user(false);
    return null;
  }
  async findActiveByNickname() {
    return null;
  }
  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }
  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }
  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }
  async findActiveByTokenHashForUser() {
    return null;
  }
  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }
  async listByUser() {
    return [];
  }
  async touchLastSeen() {
    return null;
  }
  async revokeByIdForUser() {
    return null;
  }
  async revokeByTokenHash() {
    return null;
  }
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return { users: new MemoryUsers(), devices: new MemoryDevices(), settings: runtimeSettings, now: () => now };
}

function cookie(runtimeSettings: Settings, who: "admin" | "member" = "admin") {
  return generateSignedCookie(COOKIE_NAME, `cookie-${who}`, runtimeSettings.auth.cookieSecret);
}

function okReport() {
  return {
    verdict: "ok" as const,
    checks: [{ id: "server_name" as const, level: "pass" as const }],
    checked_at: now.toISOString()
  };
}

function row(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: serverId,
    workspaceId,
    serverName: "gh",
    displayName: null,
    transport: "stdio",
    command: GH_COMMAND,
    argsJson: ["--stdio"],
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
    precheckReport: okReport() as unknown as McpServerRow["precheckReport"],
    lastError: null,
    toolCount: 2,
    toolsJson: ["create_pull_request", "search_repositories"],
    installedBy: adminUserId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as McpServerRow;
}

/** 内存仓储——真服务跑在它上面，工作区谓词由 SQL 层的单测（packages/db）另行覆盖。 */
function memoryRepository(seed: McpServerRow[] = []) {
  const rows = [...seed];
  function indexOf(scope: string, id: string) {
    return rows.findIndex((entry) => entry.workspaceId === scope && entry.id === id);
  }
  const repository: McpServerRepository = {
    async listForWorkspace(scope) {
      return rows.filter((entry) => entry.workspaceId === scope);
    },
    async listEnabledForWorkspace(scope) {
      return rows.filter((entry) => entry.workspaceId === scope && entry.enabled && entry.status !== "disabled");
    },
    async findById(scope, id) {
      return rows.find((entry) => entry.workspaceId === scope && entry.id === id) ?? null;
    },
    async findByServerName(scope, serverName) {
      return rows.find((entry) => entry.workspaceId === scope && entry.serverName === serverName) ?? null;
    },
    async create(input) {
      const created = row({
        id: input.id ?? serverId,
        workspaceId: input.workspaceId,
        serverName: input.serverName,
        displayName: input.displayName ?? null,
        command: input.command,
        argsJson: input.args ?? [],
        envJson: input.env ?? {},
        secretRefsJson: input.secretRefs ?? {},
        cwd: input.cwd ?? null,
        toolCallTimeoutMs: input.toolCallTimeoutMs ?? 60000,
        enabled: input.enabled ?? true,
        status: input.status,
        trustLevel: input.trustLevel ?? "external_effect",
        precheckReport: input.precheckReport as unknown as McpServerRow["precheckReport"],
        lastError: input.lastError ?? null,
        toolCount: input.toolCount ?? 0,
        toolsJson: input.tools ?? null,
        installedBy: input.installedBy ?? null
      });
      rows.push(created);
      return created;
    },
    async updateConnectionResult(input) {
      const index = indexOf(input.workspaceId, input.id);
      if (index < 0) return null;
      const next = {
        ...rows[index]!,
        status: input.status,
        toolCount: input.toolCount,
        toolsJson: input.tools ?? null,
        lastError: input.lastError ?? null
      };
      rows[index] = next;
      return next;
    },
    async updateSettings(input) {
      const index = indexOf(input.workspaceId, input.id);
      if (index < 0) return null;
      const next = {
        ...rows[index]!,
        ...(input.trustLevel === undefined ? {} : { trustLevel: input.trustLevel }),
        ...(input.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: input.toolCallTimeoutMs }),
        ...(input.env === undefined ? {} : { envJson: input.env }),
        ...(input.secretRefs === undefined ? {} : { secretRefsJson: input.secretRefs })
      };
      rows[index] = next;
      return next;
    },
    async setEnabled(input) {
      const index = indexOf(input.workspaceId, input.id);
      if (index < 0) return null;
      const next = {
        ...rows[index]!,
        enabled: input.enabled,
        // M0 的诚实状态：重新启用不等于「已验证连接」，真实结果由紧随其后的试连接修正。
        status: input.enabled ? ("connect_failed" as const) : ("disabled" as const)
      };
      rows[index] = next;
      return next;
    },
    async remove(scope, id) {
      const index = indexOf(scope, id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    }
  };
  return { repository, rows };
}

type ConnectOutcome = { ok: true; toolCount: number; tools: string[] } | { ok: false; error: string };

type Harness = {
  app: Hono<AuthEnv>;
  audits: CreateAuditLogInput[];
  reloads: (string | undefined)[];
  rows: McpServerRow[];
  runtimeSettings: Settings;
};

function harness(
  options: {
    seed?: McpServerRow[];
    outcome?: ConnectOutcome;
    resolveCommand?: () => Promise<{ found: boolean; executable: boolean; resolvedPath?: string }>;
    envSource?: Record<string, string | undefined>;
    reloadThrows?: () => never;
  } = {}
): Harness {
  const runtimeSettings = settings();
  const audits: CreateAuditLogInput[] = [];
  const reloads: (string | undefined)[] = [];
  const { repository, rows } = memoryRepository(options.seed ?? []);
  const outcome = options.outcome ?? { ok: true as const, toolCount: 2, tools: ["echo", "write_note"] };

  const service = createMcpServerService({
    repository,
    auditLog: {
      async createAuditLog(input) {
        audits.push(input);
        return { id: "audit-1", ...input } as never;
      }
    },
    client: {
      status: (scope) =>
        rows
          .filter((entry) => entry.workspaceId === scope && entry.enabled && entry.status !== "disabled")
          .map<McpServerStatusSnapshot>((entry) => ({
            id: entry.id,
            serverName: entry.serverName,
            status: entry.status === "connected" ? "connected" : "connect_failed",
            toolCount: entry.toolCount,
            live: entry.status === "connected",
            ...(entry.lastError ? { lastError: entry.lastError } : {}),
            toolIds: (entry.toolsJson ?? []).map((name: string) => `mcp__${entry.serverName}__${name}`)
          })),
      // 照 M2 的真实行为：重新握手之后把结果**写回行**，一台连不上不让整次动作失败。
      reload: async (scope) => {
        reloads.push(scope);
        options.reloadThrows?.();
        const snapshots: McpServerStatusSnapshot[] = [];
        for (const entry of await repository.listEnabledForWorkspace(scope ?? "")) {
          const updated = await repository.updateConnectionResult({
            workspaceId: entry.workspaceId,
            id: entry.id,
            status: outcome.ok ? "connected" : "connect_failed",
            toolCount: outcome.ok ? outcome.toolCount : 0,
            tools: outcome.ok ? outcome.tools : null,
            lastError: outcome.ok ? null : outcome.error
          });
          snapshots.push({
            id: entry.id,
            serverName: entry.serverName,
            status: outcome.ok ? "connected" : "connect_failed",
            toolCount: updated?.toolCount ?? 0,
            live: outcome.ok,
            ...(outcome.ok ? {} : { lastError: outcome.error }),
            toolIds: outcome.ok ? outcome.tools.map((name) => `mcp__${entry.serverName}__${name}`) : []
          });
        }
        return snapshots;
      }
    },
    resolveCommand:
      options.resolveCommand ?? (async () => ({ found: true, executable: true, resolvedPath: GH_COMMAND })),
    envSource: options.envSource ?? { PATH: "/usr/bin", WORKHUB_MCP_SECRET_GITHUB: "not-read-by-this-layer" },
    now: () => now
  });

  const app = new Hono<AuthEnv>();
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof McpServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "not_found", message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  app.route("/api", createMcpServerRoutes({ auth: authDeps(runtimeSettings), service }));
  return { app, audits, reloads, rows, runtimeSettings };
}

async function errorCode(response: Response) {
  return (await errorBody(response)).code;
}

/** 一次读完：`Response` 的 body 只能消费一次，码与消息要一起断言时必须走这条。 */
async function errorBody(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

function addBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ server_name: "gh", command: GH_COMMAND, args: ["--stdio"], ...overrides });
}

test("匿名请求在进服务之前就被拦下（清单也不例外——里面是这台机器上的命令与路径）", async () => {
  const { app } = harness();
  for (const [method, path] of [
    ["GET", "/api/mcp-servers"],
    ["POST", "/api/mcp-servers"],
    ["POST", `/api/mcp-servers/${serverId}/enable`],
    ["POST", `/api/mcp-servers/${serverId}/disable`],
    ["POST", `/api/mcp-servers/${serverId}/reload`],
    ["PATCH", `/api/mcp-servers/${serverId}`],
    ["DELETE", `/api/mcp-servers/${serverId}`]
  ] as const) {
    const response = await app.request(path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("非管理员一律 403——添加一台 MCP 服务器是在这台机器上多起一个长期存在的子进程", async () => {
  const { app, runtimeSettings } = harness({ seed: [row()] });
  const headers = { Cookie: await cookie(runtimeSettings, "member") };
  const list = await app.request("/api/mcp-servers", { headers });
  assert.equal(list.status, 403);
  assert.equal(await errorCode(list), "mcp_admin_required");

  for (const [method, path] of [
    ["POST", "/api/mcp-servers"],
    ["POST", `/api/mcp-servers/${serverId}/enable`],
    ["POST", `/api/mcp-servers/${serverId}/reload`],
    ["DELETE", `/api/mcp-servers/${serverId}`]
  ] as const) {
    const response = await app.request(path, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      ...(method === "POST" && path === "/api/mcp-servers" ? { body: addBody() } : {})
    });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
});

test("清单带上连接事实与「可以引用哪些服务端密钥变量」，好让添加表单不必猜", async () => {
  const { app, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request("/api/mcp-servers", { headers: { Cookie: await cookie(runtimeSettings) } });
  assert.equal(response.status, 200);
  const body = await data<McpServerListVM>(response);
  assert.equal(body.servers.length, 1);
  assert.equal(body.servers[0]?.command, GH_COMMAND);
  assert.equal(body.connections[serverId]?.live, true);
  assert.equal(body.secret_ref_env_prefix, "WORKHUB_MCP_SECRET_");
  // 只有名字，没有值——值从来不离开 API 进程自己的环境。
  assert.deepEqual(body.available_secret_refs, ["WORKHUB_MCP_SECRET_GITHUB"]);
  assert.equal(JSON.stringify(body).includes("not-read-by-this-layer"), false);
});

test("添加：体检通过 → 登记 → 握手一次 → 201 带回真实的工具数与审计", async () => {
  const { app, audits, reloads, runtimeSettings } = harness();
  const response = await app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: addBody()
  });
  assert.equal(response.status, 201);
  const result = await data<McpServerActionResult>(response);
  // 登记那一刻行上是「还没验证过」；这里读到 connected，说明服务真的在 reload 之后重读了行。
  assert.equal(result.server.status, "connected");
  assert.equal(result.server.tool_count, 2);
  assert.deepEqual(result.server.tools, ["echo", "write_note"]);
  assert.equal(result.connection?.live, true);
  assert.deepEqual(result.connection?.tool_ids, ["mcp__gh__echo", "mcp__gh__write_note"]);
  assert.equal(result.server.precheck_report.verdict, "ok");
  assert.deepEqual(reloads, [workspaceId], "登记之后按新清单握手一次");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "mcp_server.added");
  assert.equal(audits[0]?.entityType, "mcp_server");
  assert.equal(audits[0]?.detailJson?.["server_name"], "gh");
  assert.deepEqual(audits[0]?.detailJson?.["secret_ref_keys"], []);
});

test("添加：连不上是一条记录，不是一次失败的请求——原因留在行上", async () => {
  const { app, runtimeSettings } = harness({
    outcome: { ok: false, error: "handshake did not complete within 20000ms" }
  });
  const response = await app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: addBody()
  });
  assert.equal(response.status, 201);
  const result = await data<McpServerActionResult>(response);
  assert.equal(result.server.status, "connect_failed");
  assert.equal(result.server.tool_count, 0);
  assert.match(result.server.last_error ?? "", /handshake did not complete/u);
  assert.equal(result.connection?.live, false);
});

test("添加：名字形状不合是 mcp_server_name_invalid，被占用是 mcp_server_name_taken——两个不同的码", async () => {
  const invalid = harness();
  const invalidResponse = await invalid.app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(invalid.runtimeSettings), "Content-Type": "application/json" },
    body: addBody({ server_name: "gh search" })
  });
  assert.equal(invalidResponse.status, 422);
  assert.equal(await errorCode(invalidResponse), "mcp_server_name_invalid");
  assert.equal(invalid.audits.length, 0, "拒绝的服务器不该在审计里留下「添加过」的痕迹");

  const taken = harness({ seed: [row()] });
  const takenResponse = await taken.app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(taken.runtimeSettings), "Content-Type": "application/json" },
    body: addBody({ server_name: "gh" })
  });
  // 409 而不是 422：这是一次和现有清单的冲突，改个名就能过（同 plugin_already_installed 的先例）。
  assert.equal(takenResponse.status, 409);
  assert.equal(await errorCode(takenResponse), "mcp_server_name_taken");
});

test("添加：npx 这类「现下现跑」的启动器拒装，文案教人先在本机装好", async () => {
  const { app, audits, runtimeSettings } = harness();
  for (const [command, args] of [
    ["npx", ["-y", "@modelcontextprotocol/server-github"]],
    ["/usr/local/bin/pnpm", ["dlx", "some-mcp-server"]],
    ["uvx", ["mcp-server-git"]]
  ] as const) {
    const response = await app.request("/api/mcp-servers", {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: addBody({ server_name: "gh", command, args })
    });
    assert.equal(response.status, 422, command);
    assert.equal(await errorCode(response), "mcp_remote_exec_refused", command);
  }
  assert.equal(audits.length, 0);
});

test("添加：密钥引用只能指向服务端上带前缀的变量，否则它就是读任意环境变量的原语", async () => {
  const { app, runtimeSettings } = harness();
  const response = await app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: addBody({ secret_refs: { GITHUB_TOKEN: "LLM_API_KEY" } })
  });
  assert.equal(response.status, 422);
  const refusal = await errorBody(response);
  assert.equal(refusal.code, "mcp_secret_ref_out_of_scope");
  // 文案要说清「该指向什么」，而不是复述那个被拒的变量名。
  assert.match(refusal.message, /WORKHUB_MCP_SECRET_/u);
  assert.equal(refusal.message.includes("LLM_API_KEY"), false);
});

test("添加：凭据形状的环境变量拒装并点名是哪个键；命令找不到也各有自己的码", async () => {
  const credentialShaped = harness();
  const credentialResponse = await credentialShaped.app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(credentialShaped.runtimeSettings), "Content-Type": "application/json" },
    body: addBody({ env: { GITHUB_TOKEN: "ghp_live" } })
  });
  assert.equal(credentialResponse.status, 422);
  const credentialRefusal = await errorBody(credentialResponse);
  assert.equal(credentialRefusal.code, "mcp_env_credential_shaped");
  assert.match(credentialRefusal.message, /GITHUB_TOKEN/u);
  // 值绝不回显——错误消息会进日志、进截图、进工单。
  assert.equal(credentialRefusal.message.includes("ghp_live"), false);

  const missing = harness({ resolveCommand: async () => ({ found: false, executable: false }) });
  const missingResponse = await missing.app.request("/api/mcp-servers", {
    method: "POST",
    headers: { Cookie: await cookie(missing.runtimeSettings), "Content-Type": "application/json" },
    body: addBody()
  });
  assert.equal(missingResponse.status, 422);
  const missingRefusal = await errorBody(missingResponse);
  assert.equal(missingRefusal.code, "mcp_command_not_found");
  assert.match(missingRefusal.message, new RegExp(GH_COMMAND, "u"));
});

test("添加：请求体多带一个字段是 422，不静默忽略（不能借道 transport 走 http，也不能自己填状态）", async () => {
  const { app, runtimeSettings } = harness();
  for (const smuggled of [{ transport: "http" }, { status: "connected" }, { tool_count: 99 }]) {
    const response = await app.request("/api/mcp-servers", {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: addBody(smuggled)
    });
    assert.equal(response.status, 422, JSON.stringify(smuggled));
    assert.equal(await errorCode(response), "validation_error");
  }
});

test("停用：子进程收掉、工具从此不出现在任何一次执行里，落一条审计", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request(`/api/mcp-servers/${serverId}/disable`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const result = await data<McpServerActionResult>(response);
  assert.equal(result.server.enabled, false);
  assert.equal(result.server.status, "disabled");
  // 停用的服务器本进程不给它连，所以没有连接事实可报——不是 live:false 那种「连过但没活着」。
  assert.equal(result.connection, undefined);
  assert.deepEqual(reloads, [workspaceId]);
  assert.equal(audits[0]?.action, "mcp_server.disabled");
});

test("启用：仓储把状态落回「还没验证过」，紧接着的一次握手把它修正成真相", async () => {
  const { app, audits, rows, runtimeSettings } = harness({
    seed: [row({ enabled: false, status: "disabled", toolCount: 0, toolsJson: null })]
  });
  const response = await app.request(`/api/mcp-servers/${serverId}/enable`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const result = await data<McpServerActionResult>(response);
  assert.equal(result.server.enabled, true);
  assert.equal(result.server.status, "connected", "少了那次重读，这里会是 connect_failed");
  assert.equal(result.server.tool_count, 2);
  assert.equal(rows[0]?.status, "connected");
  assert.equal(audits[0]?.action, "mcp_server.enabled");
});

test("重复停用是幂等的：不重连、不再刷一条审计", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({
    seed: [row({ enabled: false, status: "disabled" })]
  });
  const response = await app.request(`/api/mcp-servers/${serverId}/disable`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(reloads, []);
  assert.equal(audits.length, 0);
});

test("改配置：信任级别落到行上，并且立刻重连——否则页面显示新值、跑着的进程用旧值", async () => {
  const { app, audits, reloads, rows, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request(`/api/mcp-servers/${serverId}`, {
    method: "PATCH",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ trust_level: "read_only", tool_call_timeout_ms: 15000 })
  });
  assert.equal(response.status, 200);
  const result = await data<McpServerActionResult>(response);
  assert.equal(result.server.trust_level, "read_only");
  assert.equal(result.server.tool_call_timeout_ms, 15000);
  assert.equal(rows[0]?.trustLevel, "read_only");
  assert.deepEqual(reloads, [workspaceId]);
  assert.equal(audits[0]?.action, "mcp_server.updated");
  assert.deepEqual(audits[0]?.detailJson?.["changed"], ["tool_call_timeout_ms", "trust_level"]);
});

test("改配置：改环境变量要重跑体检，凭据形状的键不能走 PATCH 这条后门进来", async () => {
  const { app, audits, rows, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request(`/api/mcp-servers/${serverId}`, {
    method: "PATCH",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ env: { GITHUB_TOKEN: "ghp_live" } })
  });
  assert.equal(response.status, 422);
  assert.equal(await errorCode(response), "mcp_env_credential_shaped");
  assert.deepEqual(rows[0]?.envJson, {}, "被拒的修改不能落在行上");
  assert.equal(audits.length, 0);
});

test("改配置：空请求体是 422——静默回一个 200 会被读成「已保存」", async () => {
  const { app, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request(`/api/mcp-servers/${serverId}`, {
    method: "PATCH",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{}"
  });
  assert.equal(response.status, 422);
});

test("测试连接：失败也是 200 的一条结论——用户问的就是「现在连得上吗」", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({
    seed: [row({ status: "connect_failed", toolCount: 0, lastError: "previous failure" })],
    outcome: { ok: false, error: "spawn ENOENT" }
  });
  const response = await app.request(`/api/mcp-servers/${serverId}/reload`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const result = await data<McpServerActionResult>(response);
  assert.equal(result.server.status, "connect_failed");
  assert.equal(result.server.last_error, "spawn ENOENT");
  assert.equal(result.connection?.live, false);
  assert.deepEqual(reloads, [workspaceId]);
  assert.equal(audits[0]?.action, "mcp_server.reloaded");
});

test("测试连接：整次重连炸了也不把一次已经生效的治理动作变成 500，人话原因照样带回来", async () => {
  const { app, runtimeSettings } = harness({
    seed: [row()],
    reloadThrows: () => {
      throw new Error("mcp client is closed");
    }
  });
  const response = await app.request(`/api/mcp-servers/${serverId}/reload`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const result = await data<McpServerActionResult>(response);
  assert.equal(result.connection?.live, false);
  assert.equal(typeof result.connection?.last_error, "string");
});

test("移除：204 且清单里没了；做过什么留在审计里，不留墓碑行", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({ seed: [row()] });
  const headers = { Cookie: await cookie(runtimeSettings) };
  const response = await app.request(`/api/mcp-servers/${serverId}`, { method: "DELETE", headers });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.deepEqual(reloads, [workspaceId]);
  assert.equal(audits[0]?.action, "mcp_server.removed");

  const list = await app.request("/api/mcp-servers", { headers });
  assert.equal((await data<McpServerListVM>(list)).servers.length, 0);

  const again = await app.request(`/api/mcp-servers/${serverId}`, { method: "DELETE", headers });
  assert.equal(again.status, 404);
  assert.equal(await errorCode(again), "mcp_server_not_found");
});

test("不存在的服务器是 404；不是 uuid 的 id 连服务都不进", async () => {
  const { app, runtimeSettings } = harness();
  const headers = { Cookie: await cookie(runtimeSettings) };
  for (const [method, path] of [
    ["POST", `/api/mcp-servers/${serverId}/enable`],
    ["POST", `/api/mcp-servers/${serverId}/reload`],
    ["DELETE", `/api/mcp-servers/${serverId}`]
  ] as const) {
    const response = await app.request(path, { method, headers });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(await errorCode(response), "mcp_server_not_found");
  }
  const malformed = await app.request("/api/mcp-servers/not-a-uuid", { method: "DELETE", headers });
  assert.equal(malformed.status, 404);
});

test("六个写动作各落一条审计，动作名与插件那一系不共用词表", async () => {
  const { app, audits, runtimeSettings } = harness();
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };
  await app.request("/api/mcp-servers", { method: "POST", headers, body: addBody() });
  await app.request(`/api/mcp-servers/${serverId}/disable`, { method: "POST", headers });
  await app.request(`/api/mcp-servers/${serverId}/enable`, { method: "POST", headers });
  await app.request(`/api/mcp-servers/${serverId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ trust_level: "read_only" })
  });
  await app.request(`/api/mcp-servers/${serverId}/reload`, { method: "POST", headers });
  await app.request(`/api/mcp-servers/${serverId}`, { method: "DELETE", headers });

  assert.deepEqual(
    audits.map((entry) => entry.action),
    [
      "mcp_server.added",
      "mcp_server.disabled",
      "mcp_server.enabled",
      "mcp_server.updated",
      "mcp_server.reloaded",
      "mcp_server.removed"
    ]
  );
  for (const entry of audits) {
    assert.equal(entry.entityType, "mcp_server");
    assert.equal(entry.actorUserId, adminUserId);
    assert.equal(entry.workspaceId, workspaceId);
    // 环境变量与密钥引用只记键名——值里可能有配置也可能有别人以为不敏感的东西。
    assert.ok(Array.isArray(entry.detailJson?.["env_keys"]));
    assert.ok(Array.isArray(entry.detailJson?.["secret_ref_keys"]));
  }
});

// —— 网页设置页的只读清单（同一道管理员门；网页不做添加/启停） —— //

// R27（与插件清单同一类事故）：command 这一列在库里可空（给将来的非 stdio 传输留的余地），读侧
// 又拿 `?? ""` 伪造了一个契约明令禁止的空串——一条这样的行此前让 GET /api/mcp-servers 整个 500，
// 设置页那一区跟着静默消失。契约不放宽（stdio 行的启动命令确实必填），坏行只丢自己。
test("R27 一条没有启动命令的 MCP 行只丢自己，清单照常返回并留下结构化 warn", async () => {
  const otherId = "33333333-3333-4333-8333-333333333399";
  const { app, runtimeSettings } = harness({
    seed: [
      row({ command: null as unknown as McpServerRow["command"] }),
      row({ id: otherId, serverName: "gl" })
    ]
  });
  const headers = { Cookie: await cookie(runtimeSettings) };

  // 捕获且透传（见 @workhub/tools/test-support）：整段替换 process.stdout.write 会吞掉报告器的 TAP 行。
  const { result: response, lines } = await captureStdoutLines(() => app.request("/api/mcp-servers", { headers }));

  assert.equal(response.status, 200);
  const listed = await data<McpServerListVM>(response);
  assert.deepEqual(listed.servers.map((server) => server.id), [otherId]);
  const warned = lines.some((line) => {
    try {
      const entry = JSON.parse(line) as { level?: string; event?: string; mcpServerId?: string };
      return entry.level === "warn"
        && entry.event === "mcp_server_row_dropped_unparsable"
        && entry.mcpServerId === serverId;
    } catch {
      return false;
    }
  });
  assert.equal(warned, true, "被丢掉的那一行要留给运维一条结构化 warn");
});

// R27：取数失败此前被路由的 `catch {}` 吞成「字段缺席」，而缺席恰恰是「非管理员，不该看」的信号。
test("R27 设置页 VM 用 failed_sections 标出「这次没取到」的 MCP 分区", () => {
  const runtimeSettings = settings();
  const readiness = { ready: true, checks: { database: { ok: true }, broker: { ok: true } } } as const;
  const failed = buildSettingsPage({
    settings: runtimeSettings,
    readiness,
    locale: "zh-CN",
    generatedAt: now,
    failedSections: ["mcp_servers"]
  });
  assert.equal(failed.mcp_servers, undefined);
  assert.deepEqual(failed.failed_sections, ["mcp_servers"]);
});

test("M8 设置页 VM 只在调用方真的填了清单时才带 mcp_servers；摘要里没有命令、参数、环境变量、密钥引用、工作目录", () => {
  const runtimeSettings = settings();
  const readiness = { ready: true, checks: { database: { ok: true }, broker: { ok: true } } } as const;
  const base = buildSettingsPage({ settings: runtimeSettings, readiness, locale: "zh-CN", generatedAt: now });
  // 非管理员：路由不取不填 → 字段结构性缺席（不是空数组，空数组会被读成「一台都没接」）。
  assert.equal(base.mcp_servers, undefined);

  const withServers = buildSettingsPage({
    settings: runtimeSettings,
    readiness,
    locale: "zh-CN",
    generatedAt: now,
    mcpServers: [
      {
        id: serverId,
        server_name: "gh",
        transport: "stdio",
        enabled: true,
        status: "connect_failed",
        trust_level: "external_effect",
        tool_count: 0,
        precheck_verdict: "ok",
        last_error_code: "mcp_handshake_timeout"
      }
    ]
  });
  assert.equal(withServers.mcp_servers?.length, 1);
  assert.equal(withServers.mcp_servers?.[0]?.last_error_code, "mcp_handshake_timeout");
  const summary = withServers.mcp_servers?.[0] ?? {};
  // 宿主机事实与潜在凭据指针结构性不进网页；诊断串（last_error）同理——它是命令路径与 stderr
  // 尾巴，只有**码**能上网页。
  for (const hostFact of ["command", "args", "env", "secret_refs", "cwd", "last_error"]) {
    assert.equal(hostFact in summary, false, `网页只读摘要不该带 ${hostFact}`);
  }
});
