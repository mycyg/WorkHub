import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  CreateAuditLogInput,
  PluginRepository,
  PluginRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { PluginLoadReport } from "@workhub/plugin-host";
import type { PluginVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createPluginService, PluginServiceError } from "../services/plugins.js";
import type { PluginInspection } from "../services/plugin-compat.js";
import { buildSettingsPage } from "../pages/settings.js";
import { createPluginRoutes } from "./plugins.js";

// R24-P 阶段 1：插件治理端点的端到端行为（真路由 + 真服务 + 内存仓储 + 假宿主）。
// 这里钉的是治理语义：非管理员进不来、体检拒装的三类各有自己的码、装不上是一条**记录**
// 而不是一次失败、启停真的让宿主按新清单热重载、四个动作各落一条审计。

const now = new Date("2026-09-05T09:00:00.000Z");
const adminUserId = "70000000-0000-4000-8000-0000000000a1";
const memberUserId = "70000000-0000-4000-8000-0000000000b1";
const pluginId = "22222222-2222-4222-8222-222222222222";
const ECHO_PATH = "/srv/plugins/dsh-plugin-echo";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r24-plugins-secret" });
}

// actor.workspaceId 来自认证解析（单租户下回退 defaultWorkspaceId）——夹具行必须落在同一个工作区里，
// 否则测的就不是治理语义而是「工作区围栏挡住了自己的夹具」。
const workspaceId = settings().auth.defaultWorkspaceId;

function user(isAdmin: boolean): UserAuthRow {
  return {
    id: isAdmin ? adminUserId : memberUserId,
    nickname: isAdmin ? "r24-admin" : "r24-member",
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

function okReport(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "ok" as const,
    checks: [{ id: "manifest" as const, level: "pass" as const }],
    checked_at: now.toISOString(),
    ...overrides
  };
}

function row(overrides: Partial<PluginRow> = {}): PluginRow {
  return {
    id: pluginId,
    workspaceId,
    name: "dsh-plugin-echo",
    version: "0.1.0",
    sourceKind: "local_path",
    sourcePath: ECHO_PATH,
    enabled: true,
    status: "installed",
    trustLevel: "external_effect",
    compatReport: okReport() as unknown as PluginRow["compatReport"],
    loadReport: null,
    toolCount: 1,
    installedBy: adminUserId,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as PluginRow;
}

/** 内存仓储——真服务跑在它上面，工作区谓词由 SQL 层的单测（packages/db）另行覆盖。 */
function memoryRepository(seed: PluginRow[] = []) {
  const rows = [...seed];
  const repository: PluginRepository = {
    async listForWorkspace(workspaceId) {
      return rows.filter((entry) => entry.workspaceId === workspaceId);
    },
    async listEnabledForWorkspace(workspaceId) {
      return rows.filter(
        (entry) =>
          entry.workspaceId === workspaceId && entry.enabled && entry.status !== "disabled" && entry.status !== "crashed"
      );
    },
    async findById(workspaceId, id) {
      return rows.find((entry) => entry.workspaceId === workspaceId && entry.id === id) ?? null;
    },
    async findBySourcePath(workspaceId, sourcePath) {
      return rows.find((entry) => entry.workspaceId === workspaceId && entry.sourcePath === sourcePath) ?? null;
    },
    async create(input) {
      const created = row({
        id: input.id ?? pluginId,
        workspaceId: input.workspaceId,
        name: input.name,
        version: input.version ?? null,
        sourcePath: input.sourcePath,
        status: input.status,
        trustLevel: input.trustLevel ?? "external_effect",
        enabled: input.enabled ?? true,
        compatReport: input.compatReport as unknown as PluginRow["compatReport"],
        toolCount: input.toolCount ?? 0,
        installedBy: input.installedBy ?? null
      });
      rows.push(created);
      return created;
    },
    async updateLoadResult(input) {
      const index = rows.findIndex((entry) => entry.workspaceId === input.workspaceId && entry.id === input.id);
      if (index < 0) return null;
      const next = {
        ...rows[index]!,
        status: input.status,
        toolCount: input.toolCount,
        loadReport: input.loadReport as unknown as PluginRow["loadReport"]
      };
      rows[index] = next;
      return next;
    },
    async setEnabled(input) {
      const index = rows.findIndex((entry) => entry.workspaceId === input.workspaceId && entry.id === input.id);
      if (index < 0) return null;
      const next = {
        ...rows[index]!,
        enabled: input.enabled,
        status: input.enabled ? ("installed" as const) : ("disabled" as const)
      };
      rows[index] = next;
      return next;
    },
    async setTrustLevel(input) {
      const index = rows.findIndex((entry) => entry.workspaceId === input.workspaceId && entry.id === input.id);
      if (index < 0) return null;
      const next = { ...rows[index]!, trustLevel: input.trustLevel };
      rows[index] = next;
      return next;
    },
    async markCrashed(input) {
      const index = rows.findIndex(
        (entry) => entry.workspaceId === input.workspaceId && entry.sourcePath === input.sourcePath
      );
      if (index < 0) return null;
      const next = {
        ...rows[index]!,
        status: "crashed" as const,
        toolCount: 0,
        loadReport: input.loadReport as unknown as PluginRow["loadReport"]
      };
      rows[index] = next;
      return next;
    },
    async remove(workspaceId, id) {
      const index = rows.findIndex((entry) => entry.workspaceId === workspaceId && entry.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    }
  };
  return { repository, rows };
}

type Harness = {
  app: Hono<AuthEnv>;
  audits: CreateAuditLogInput[];
  reloads: (string | undefined)[];
  runtimeSettings: Settings;
};

function harness(options: {
  seed?: PluginRow[];
  inspect?: (sourcePath: string) => Promise<PluginInspection>;
  loadReports?: PluginLoadReport[];
} = {}): Harness {
  const runtimeSettings = settings();
  const audits: CreateAuditLogInput[] = [];
  const reloads: (string | undefined)[] = [];
  const { repository } = memoryRepository(options.seed ?? []);
  const service = createPluginService({
    repository,
    auditLog: {
      async createAuditLog(input) {
        audits.push(input);
        return { id: "audit-1", ...input } as never;
      }
    },
    host: {
      async reload(workspaceId) {
        reloads.push(workspaceId);
        return options.loadReports ?? [];
      },
      bootstrapPathCount: () => 1
    },
    inspect:
      options.inspect ??
      (async (sourcePath) => ({
        sourcePath,
        name: "dsh-plugin-echo",
        version: "0.1.0",
        report: okReport()
      })),
    hostDshToolsVersion: "0.1.0-rc.8",
    now: () => now
  });

  const app = new Hono<AuthEnv>();
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof PluginServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "unauthorized", message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  app.route("/api", createPluginRoutes({ auth: authDeps(runtimeSettings), service }));
  return { app, audits, reloads, runtimeSettings };
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

async function data<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

test("匿名请求在进服务之前就被拦下（列表也不例外——路径是这台服务器上的目录）", async () => {
  const { app } = harness();
  for (const [method, path] of [
    ["GET", "/api/plugins"],
    ["POST", "/api/plugins"],
    ["POST", `/api/plugins/${pluginId}/enable`],
    ["POST", `/api/plugins/${pluginId}/disable`],
    ["DELETE", `/api/plugins/${pluginId}`]
  ] as const) {
    const response = await app.request(path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("非管理员一律 403——装插件是往这台服务器上引入第三方代码", async () => {
  const { app, runtimeSettings } = harness({ seed: [row()] });
  const headers = { Cookie: await cookie(runtimeSettings, "member") };
  const list = await app.request("/api/plugins", { headers });
  assert.equal(list.status, 403);
  assert.equal(await errorCode(list), "plugin_admin_required");

  const install = await app.request("/api/plugins", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: ECHO_PATH })
  });
  assert.equal(install.status, 403);
});

test("列表带上宿主捆绑版本与「还有几条来自环境变量」，好解释为什么某个插件可能装不上", async () => {
  const { app, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request("/api/plugins", { headers: { Cookie: await cookie(runtimeSettings) } });
  assert.equal(response.status, 200);
  const body = await data<{ plugins: PluginVM[]; host_dsh_tools_version?: string; bootstrap_path_count: number }>(
    response
  );
  assert.equal(body.plugins.length, 1);
  assert.equal(body.plugins[0]?.source_path, ECHO_PATH);
  assert.equal(body.host_dsh_tools_version, "0.1.0-rc.8");
  assert.equal(body.bootstrap_path_count, 1);
});

test("安装：体检通过 → 登记 → 试加载 → 201 带回工具数与审计", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({
    loadReports: [
      { pluginId: "dsh-plugin-echo", path: ECHO_PATH, ok: true, toolCount: 2, promptSectionCount: 1 }
    ]
  });
  const response = await app.request("/api/plugins", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: ECHO_PATH })
  });
  assert.equal(response.status, 201);
  const plugin = await data<PluginVM>(response);
  assert.equal(plugin.status, "installed");
  assert.equal(plugin.tool_count, 2);
  assert.equal(plugin.load_report?.ok, true);
  assert.equal(plugin.compat_report.verdict, "ok");
  assert.deepEqual(reloads, [workspaceId], "登记之后让宿主按新清单重新握手");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.action, "plugin.installed");
  assert.equal(audits[0]?.entityType, "plugin");
  assert.equal(audits[0]?.detailJson?.["source_path"], ECHO_PATH);
});

test("安装：宿主装不上是一条 load_failed 记录，不是一次失败的请求——原因留在 load_report 里", async () => {
  const { app, runtimeSettings } = harness({
    loadReports: [
      {
        pluginId: "dsh-plugin-finance-data",
        path: ECHO_PATH,
        ok: false,
        toolCount: 0,
        promptSectionCount: 0,
        error: "unsupported JSON schema: parameters.targets.additionalProperties"
      }
    ]
  });
  const response = await app.request("/api/plugins", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: ECHO_PATH })
  });
  assert.equal(response.status, 201);
  const plugin = await data<PluginVM>(response);
  assert.equal(plugin.status, "load_failed");
  assert.equal(plugin.tool_count, 0);
  assert.match(plugin.load_report?.error ?? "", /unsupported JSON schema/u);
});

test("安装：宿主根本没报到这条插件时如实记 load_failed，不假装装上了", async () => {
  const { app, runtimeSettings } = harness({ loadReports: [] });
  const response = await app.request("/api/plugins", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: ECHO_PATH })
  });
  const plugin = await data<PluginVM>(response);
  assert.equal(plugin.status, "load_failed");
  assert.equal(plugin.load_report?.ok, false);
});

test("安装：体检拒装的三类各有自己的错误码，UI 据此出人话", async () => {
  const cases = [
    { check: "manifest", code: "plugin_manifest_unreadable" },
    { check: "client_surface", code: "plugin_client_surface_unsupported" },
    { check: "install_scripts", code: "plugin_install_scripts_refused" }
  ] as const;
  for (const { check, code } of cases) {
    const { app, audits, runtimeSettings } = harness({
      inspect: async (sourcePath) => ({
        sourcePath,
        name: "blocked",
        report: {
          verdict: "blocked",
          checks: [{ id: check, level: "block", detail: "why" }],
          checked_at: now.toISOString()
        }
      })
    });
    const response = await app.request("/api/plugins", {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: JSON.stringify({ source_path: "/srv/plugins/blocked" })
    });
    assert.equal(response.status, 422, check);
    assert.equal(await errorCode(response), code);
    assert.equal(audits.length, 0, "拒装的插件不该在审计里留下「装过」的痕迹");
  }
});

test("安装：警告级体检结论照样装得进来，警告原样保留在记录上", async () => {
  const { app, runtimeSettings } = harness({
    inspect: async (sourcePath) => ({
      sourcePath,
      name: "dsh-plugin-finance-data",
      report: {
        verdict: "warn",
        checks: [{ id: "dsh_tools_peer", level: "warn", detail: "wants ^0.2.0, host bundles 0.1.0-rc.8" }],
        checked_at: now.toISOString(),
        peer_dsh_tools_range: "^0.2.0",
        host_dsh_tools_version: "0.1.0-rc.8"
      }
    }),
    loadReports: [{ pluginId: "x", path: "/srv/plugins/fin", ok: true, toolCount: 1, promptSectionCount: 0 }]
  });
  const response = await app.request("/api/plugins", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: "/srv/plugins/fin" })
  });
  assert.equal(response.status, 201);
  const plugin = await data<PluginVM>(response);
  assert.equal(plugin.compat_report.verdict, "warn");
  assert.equal(plugin.compat_report.peer_dsh_tools_range, "^0.2.0");
});

test("安装：同一个目录装第二次是 409，不是两条各自启停的记录", async () => {
  const { app, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request("/api/plugins", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: ECHO_PATH })
  });
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "plugin_already_installed");
});

test("安装：请求体多带一个字段是 422，不静默忽略（不能借道 source_kind 走非本地源）", async () => {
  const { app, runtimeSettings } = harness();
  const response = await app.request("/api/plugins", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ source_path: ECHO_PATH, source_kind: "npm" })
  });
  assert.equal(response.status, 422);
});

test("停用：工具从此不出现在任何一次执行里，宿主按新清单热重载，落一条审计", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({ seed: [row()] });
  const response = await app.request(`/api/plugins/${pluginId}/disable`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  const plugin = await data<PluginVM>(response);
  assert.equal(plugin.enabled, false);
  assert.equal(plugin.status, "disabled");
  assert.deepEqual(reloads, [workspaceId]);
  assert.equal(audits[0]?.action, "plugin.disabled");
});

test("启用：重新试加载，结果如实回填（可能仍然装不上）", async () => {
  const { app, audits, runtimeSettings } = harness({
    seed: [row({ enabled: false, status: "disabled", toolCount: 0 })],
    loadReports: [
      { pluginId: "dsh-plugin-echo", path: ECHO_PATH, ok: false, toolCount: 0, promptSectionCount: 0, error: "boom" }
    ]
  });
  const response = await app.request(`/api/plugins/${pluginId}/enable`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const plugin = await data<PluginVM>(response);
  assert.equal(plugin.enabled, true);
  assert.equal(plugin.status, "load_failed");
  assert.equal(plugin.load_report?.error, "boom");
  assert.equal(audits[0]?.action, "plugin.enabled");
});

test("重复停用是幂等的：不重启宿主、不再刷一条审计", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({
    seed: [row({ enabled: false, status: "disabled" })]
  });
  const response = await app.request(`/api/plugins/${pluginId}/disable`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(reloads, []);
  assert.equal(audits.length, 0);
});

test("移除：清单里没了，宿主重载，审计留一条（做过什么在 audit_logs 里，不留墓碑行）", async () => {
  const { app, audits, reloads, runtimeSettings } = harness({ seed: [row()] });
  const headers = { Cookie: await cookie(runtimeSettings) };
  const response = await app.request(`/api/plugins/${pluginId}`, { method: "DELETE", headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await data(response), { removed: true });
  assert.deepEqual(reloads, [workspaceId]);
  assert.equal(audits[0]?.action, "plugin.removed");

  const list = await app.request("/api/plugins", { headers });
  assert.equal((await data<{ plugins: PluginVM[] }>(list)).plugins.length, 0);
});

test("不存在的插件是 404；不是 uuid 的 id 连服务都不进", async () => {
  const { app, runtimeSettings } = harness();
  const headers = { Cookie: await cookie(runtimeSettings) };
  const missing = await app.request(`/api/plugins/${pluginId}/enable`, { method: "POST", headers });
  assert.equal(missing.status, 404);
  assert.equal(await errorCode(missing), "plugin_not_found");

  const malformed = await app.request("/api/plugins/not-a-uuid", { method: "DELETE", headers });
  assert.equal(malformed.status, 404);
});

// —— 网页设置页的只读清单（同一道管理员门；网页不做安装/启停） —— //

test("设置页 VM 只在调用方真的填了清单时才带 plugins；摘要里没有本机绝对路径", () => {
  const runtimeSettings = settings();
  const readiness = { ready: true, checks: { database: { ok: true }, broker: { ok: true } } } as const;
  const base = buildSettingsPage({ settings: runtimeSettings, readiness, locale: "zh-CN", generatedAt: now });
  // 非管理员：路由不取不填 → 字段结构性缺席（不是空数组，空数组会被读成「一个都没装」）。
  assert.equal(base.plugins, undefined);

  const withPlugins = buildSettingsPage({
    settings: runtimeSettings,
    readiness,
    locale: "zh-CN",
    generatedAt: now,
    plugins: [
      {
        id: pluginId,
        name: "dsh-plugin-echo",
        version: "0.1.0",
        enabled: true,
        status: "installed",
        trust_level: "external_effect",
        tool_count: 2,
        compat_verdict: "ok"
      }
    ]
  });
  assert.equal(withPlugins.plugins?.length, 1);
  assert.equal(JSON.stringify(withPlugins.plugins).includes("source_path"), false);
});
