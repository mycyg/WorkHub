/**
 * `pnpm qa:r1-pg-plugin-smoke` —— R24-P 阶段 1（插件治理）的**真 PostgreSQL** 验收门。
 *
 * 阶段 1 的 Agent Note 明写了一条遗留：治理这一层此前只被内存仓储的单测覆盖过，
 * 「迁移 0072 + 真库的唯一索引/CHECK/外键 + 宿主按 DB 清单热重载」这条链从没在真 PG 上跑过。
 * 这个脚本就是那条链，跑在 `qa:r1-pg-smoke` 的**同一个容器、同一份 env** 上（verify.yml
 * 的 r1-pg-smoke job 里追加一步），起库/种子/鉴权/错误信封全部复用 `r1-pg-harness.ts`。
 *
 * 断言清单（任一条不成立即非零退出）：
 *  1. 迁移 0072 真的建出了 `plugins` 表（列 / 唯一索引 / CHECK / 外键逐条核对）——
 *     这是「全新库直接到 0072」这条路径在 CI 上的证据；
 *  2. 空清单：`GET /api/plugins` 回 `plugins: []`、`bootstrap_path_count: 0`
 *     （不设 `WORKHUB_PLUGIN_PATHS` 时清单里不该凭空多出引导路径）；
 *  3. 非管理员四个端点全 403 `plugin_admin_required`（治理面是管理员门，不是客户端自己猜身份）；
 *  4. 体检拒装的三类各打一次，各自的错误码不许混：假目录 → `plugin_manifest_unreadable`、
 *     有 `dsh.client` → `plugin_client_surface_unsupported`、有安装期脚本 → `plugin_install_scripts_refused`；
 *  5. 装 echo 夹具（本机绝对路径）→ 201、`status='installed'`、`load_report.ok` 且 `tool_count=1`；
 *     同一目录再装一次 → 409 `plugin_already_installed`（真库唯一索引这条路，不是应用层记性好）；
 *  6. **工具注册表的可观测点**：`pluginHost.toolSpecs({ workspaceId })` —— 这正是 agent-runner 的
 *     `defaultPluginToolsProvider` 走的那一条，所以它出现/消失就等于「这次执行有没有这个工具」。
 *     装完 → 有；停用 → 没有；再启用 → 又有（每一步都真的重启了宿主子进程并重新握手）；
 *  7. 移除 → 清单空、工具消失、再对这个 id 动手是 404 `plugin_not_found`；
 *  8. 四个写动作各落**恰好一条**审计（installed / enabled / disabled / removed），
 *     都带工作区、操作者、插件名与来源路径。
 *
 * 不需要任何 LLM key：这条门一次模型请求都不发（治理面本来就与模型无关；插件工具真的被 Cuu
 * 调起来那一条在 `pnpm qa:plugin-smoke`，那条用假 provider + 内存仓储）。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "@workhub/config";
import {
  createAuditLogRepository,
  createClientDeviceRepository,
  createDatabaseClient,
  createPluginRepository,
  createUserRepository,
  runMigrations,
  type WorkHubDatabaseClient
} from "@workhub/db";
import type { PluginListVM, PluginVM } from "@workhub/contracts";
import { Hono } from "hono";

import type { AuthDependencies, AuthEnv } from "../middleware/auth.js";
import { createPluginRoutes } from "../routes/plugins.js";
import { createPluginHostClient, createRegistryPluginPathSource } from "../services/plugin-host-client.js";
import { createPluginService } from "../services/plugins.js";
import {
  assertNotProduction,
  ensureDefaultSeed,
  seedAdminHeaders,
  signedCookieFor,
  withErrors,
  type SmokeAuthHeaders
} from "./r1-pg-harness.js";

const ECHO_PLUGIN_ID = "dsh-plugin-echo";
const ECHO_TOOL_ID = "plugin__dsh-plugin-echo__echo";

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function line(label: string, value: unknown) {
  console.log(`  ${label.padEnd(38, " ")} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function readJson<T>(response: Response): Promise<Envelope<T>> {
  return (await response.json()) as Envelope<T>;
}

/** 断言一次请求是被**这个**错误码拒的——错误码是两端 UI 出人话的依据，混了就等于文案错了。 */
async function expectError(response: Response, status: number, code: string, label: string) {
  const body = await readJson<never>(response);
  assert.equal(
    response.status,
    status,
    `${label}：期望 ${status}，实际 ${response.status} ${JSON.stringify(body)}`
  );
  assert.equal(body.ok, false, `${label}：错误信封的 ok 应为 false`);
  assert.equal(body.error?.code, code, `${label}：期望错误码 ${code}，实际 ${body.error?.code}`);
}

async function expectOk<T>(response: Response, status: number, label: string): Promise<T> {
  const body = await readJson<T>(response);
  assert.equal(response.status, status, `${label}：期望 ${status}，实际 ${response.status} ${JSON.stringify(body)}`);
  assert.equal(body.ok, true, `${label}：期望 ok=true，实际 ${JSON.stringify(body)}`);
  assert.ok(body.data, `${label}：响应没有 data`);
  return body.data;
}

/**
 * 迁移 0072 在真库上的落地形状。这不是「重复一遍 SQL 文件」——它证明的是
 * **journal 整链跑完之后**这张表确实在（含唯一索引与三条 CHECK），
 * 而不是某条更晚的迁移把它改没了。
 */
async function assertPluginsSchema(pool: WorkHubDatabaseClient["pool"]) {
  const table = await pool.query<{ t: string | null }>("select to_regclass('public.plugins')::text as t");
  assert.equal(table.rows[0]?.t, "plugins", "迁移 0072 没有建出 plugins 表——真库上这条链断了");

  const columns = await pool.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name = 'plugins' order by ordinal_position"
  );
  const columnNames = columns.rows.map((row) => row.column_name);
  assert.deepEqual(
    columnNames,
    [
      "id",
      "workspace_id",
      "name",
      "version",
      "source_kind",
      "source_path",
      "enabled",
      "status",
      "compat_report",
      "load_report",
      "tool_count",
      "installed_by",
      "created_at",
      "updated_at"
    ],
    "plugins 表的列与 0072 迁移不一致"
  );

  const indexes = await pool.query<{ indexname: string }>(
    "select indexname from pg_indexes where tablename = 'plugins' order by indexname"
  );
  const indexNames = indexes.rows.map((row) => row.indexname);
  assert.deepEqual(
    indexNames,
    ["plugins_pkey", "plugins_workspace_created_idx", "plugins_workspace_enabled_idx", "plugins_workspace_source_path_uq"],
    "plugins 表的索引与 0072 迁移不一致"
  );

  const constraints = await pool.query<{ conname: string }>(
    "select conname from pg_constraint where conrelid = to_regclass('public.plugins') order by conname"
  );
  const constraintNames = constraints.rows.map((row) => row.conname);
  assert.deepEqual(
    constraintNames,
    [
      "plugins_installed_by_fkey",
      "plugins_pkey",
      "plugins_source_kind_ck",
      "plugins_status_ck",
      "plugins_tool_count_ck",
      "plugins_workspace_id_fkey"
    ],
    "plugins 表的约束与 0072 迁移不一致（source_kind / status / tool_count 三条 CHECK 必须都在）"
  );
  line("0072 plugins 表", { columns: columnNames.length, indexes: indexNames.length, constraints: constraintNames.length });
}

/** 造两个「体检就该拒」的临时插件目录。都不含任何可执行代码——体检层也从不执行它们。 */
async function makeRejectedFixtures(root: string) {
  const clientSurface = path.join(root, "dsh-plugin-theme");
  await mkdir(clientSurface, { recursive: true });
  await writeFile(
    path.join(clientSurface, "package.json"),
    `${JSON.stringify(
      {
        name: "dsh-plugin-theme",
        version: "0.1.0",
        private: true,
        dsh: { client: "./client.js", bundle: { patch: "./cordis.patch.yml" } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const installScripts = path.join(root, "dsh-plugin-prepare");
  await mkdir(installScripts, { recursive: true });
  await writeFile(
    path.join(installScripts, "package.json"),
    `${JSON.stringify(
      {
        name: "dsh-plugin-prepare",
        version: "0.1.0",
        private: true,
        scripts: { prepare: "node ./setup.js" },
        dsh: { bundle: { patch: "./cordis.patch.yml" } }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { clientSurface, installScripts, missing: path.join(root, "not-a-real-plugin-dir") };
}

async function main() {
  const settings = loadSettings(process.env);
  assertNotProduction(settings, "R1 PG plugin governance smoke");
  // 引导路径必须是空的：这条门要证明「清单来自 DB」，env 里还塞着插件就分不清是谁贡献的工具。
  assert.equal(
    (process.env.WORKHUB_PLUGIN_PATHS ?? "").trim(),
    "",
    "这条门要求不设 WORKHUB_PLUGIN_PATHS——插件清单必须只来自 plugins 表"
  );

  console.log("WorkHub R1 PG 插件治理冒烟 —— 真 PostgreSQL，插件装得进来、管得住");
  console.log("");

  await runMigrations(settings);
  const client = createDatabaseClient(settings);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "workhub-r26-plugin-fixtures-"));
  const workspaceId = settings.auth.defaultWorkspaceId;
  const echoPath = path.join(repoRoot(), "packages", "plugin-host", "qa", "fixtures", ECHO_PLUGIN_ID);

  const pluginRepository = createPluginRepository(client.db);
  const pluginHost = createPluginHostClient({
    // 产线口径：清单来自 plugins 表（引导路径为空），宿主按工作区各起一个子进程。
    pluginPathSource: createRegistryPluginPathSource({ bootstrapPaths: [], repository: pluginRepository }),
    auditLogs: false,
    handshakeTimeoutMs: 30_000
  });

  try {
    const db = client.db;
    console.log("[1/8] 核对迁移 0072 在真库上的落地形状");
    await assertPluginsSchema(client.pool);
    await ensureDefaultSeed(db);
    // 同一个库上复跑：先清掉上一轮留下的行，否则「空清单」这条断言测的是别人的残留。
    await client.pool.query("delete from plugins where workspace_id = $1", [workspaceId]);

    const userRepo = createUserRepository(db);
    const deviceRepo = createClientDeviceRepository(db);
    const auditRepo = createAuditLogRepository(db);
    const auth: AuthDependencies = { users: userRepo, devices: deviceRepo, settings };

    const admin = await seedAdminHeaders(settings, userRepo);
    // 非管理员：真库里造一个普通成员（不是把 actor 手工捏出来——要过的就是真的认证解析）。
    const memberToken = randomUUID();
    const member = await userRepo.getOrCreateActiveByNickname("r26-plugin-member", memberToken);
    await userRepo.rotateCookieToken(member.user.id, memberToken);
    const memberHeaders: SmokeAuthHeaders = await signedCookieFor(settings, memberToken);

    const service = createPluginService({
      repository: pluginRepository,
      auditLog: auditRepo,
      host: pluginHost
    });
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createPluginRoutes({ auth, service }));

    console.log("");
    console.log("[2/8] 空清单：装之前什么都没有，也没有环境变量来的引导路径");
    const emptyList = await expectOk<PluginListVM>(
      await app.request("/api/plugins", { headers: admin.headers }),
      200,
      "空清单"
    );
    line("plugins", emptyList.plugins);
    line("bootstrap_path_count", emptyList.bootstrap_path_count);
    line("host_dsh_tools_version", emptyList.host_dsh_tools_version ?? "(读不出)");
    assert.deepEqual(emptyList.plugins, [], "还没装任何插件，清单就该是空的");
    assert.equal(emptyList.bootstrap_path_count, 0, "没设 WORKHUB_PLUGIN_PATHS，引导路径条数必须是 0");
    assert.ok(emptyList.host_dsh_tools_version, "清单该带上宿主捆绑的 dsh-tools 版本（安装页据此解释兼容性）");

    console.log("");
    console.log("[3/8] 非管理员：四个端点全 403");
    const someId = randomUUID();
    for (const [label, request] of [
      ["GET /api/plugins", app.request("/api/plugins", { headers: memberHeaders })],
      [
        "POST /api/plugins",
        app.request("/api/plugins", {
          method: "POST",
          headers: memberHeaders,
          body: JSON.stringify({ source_path: echoPath })
        })
      ],
      [
        "POST /api/plugins/:id/enable",
        app.request(`/api/plugins/${someId}/enable`, { method: "POST", headers: memberHeaders })
      ],
      ["DELETE /api/plugins/:id", app.request(`/api/plugins/${someId}`, { method: "DELETE", headers: memberHeaders })]
    ] as Array<[string, Promise<Response>]>) {
      await expectError(await request, 403, "plugin_admin_required", `非管理员 ${label}`);
      line(label, "403 plugin_admin_required");
    }

    console.log("");
    console.log("[4/8] 体检拒装的三类各打一次，错误码不许混");
    const rejected = await makeRejectedFixtures(fixtureRoot);
    const rejections: Array<[string, string, string]> = [
      [rejected.missing, "plugin_manifest_unreadable", "假目录"],
      [rejected.clientSurface, "plugin_client_surface_unsupported", "界面/主题类（有 dsh.client）"],
      [rejected.installScripts, "plugin_install_scripts_refused", "带安装期脚本"]
    ];
    for (const [sourcePath, code, label] of rejections) {
      const response = await app.request("/api/plugins", {
        method: "POST",
        headers: admin.headers,
        body: JSON.stringify({ source_path: sourcePath })
      });
      await expectError(response, 422, code, `拒装 ${label}`);
      line(label, `422 ${code}`);
    }
    const rejectedRows = await client.pool.query<{ n: number }>(
      "select count(*)::int as n from plugins where workspace_id = $1",
      [workspaceId]
    );
    assert.equal(rejectedRows.rows[0]?.n ?? -1, 0, "被体检拒掉的插件不该在 plugins 表里留下任何一行");

    console.log("");
    console.log("[5/8] 装 echo 夹具（本机绝对路径）→ 登记 + 试加载");
    const installed = await expectOk<PluginVM>(
      await app.request("/api/plugins", {
        method: "POST",
        headers: admin.headers,
        body: JSON.stringify({ source_path: echoPath })
      }),
      201,
      "安装 echo 夹具"
    );
    line("id / name / version", `${installed.id} / ${installed.name} / ${installed.version ?? "(无)"}`);
    line("status / enabled", `${installed.status} / ${installed.enabled}`);
    line("compat_report.verdict", installed.compat_report.verdict);
    line("load_report", installed.load_report ?? "(无)");
    assert.equal(installed.name, ECHO_PLUGIN_ID);
    assert.equal(installed.source_kind, "local_path");
    assert.equal(installed.source_path, echoPath, "source_path 必须是安装时给的那个绝对路径");
    assert.equal(installed.status, "installed", `试加载没成功：${JSON.stringify(installed.load_report)}`);
    assert.equal(installed.enabled, true);
    assert.equal(installed.tool_count, 1, "echo 夹具应当贡献恰好一个工具");
    assert.equal(installed.load_report?.ok, true);
    assert.equal(installed.load_report?.tool_count, 1);
    assert.equal(installed.load_report?.prompt_section_count, 1);
    assert.equal(installed.installed_by, admin.id, "installed_by 应当指向真的装它的那个管理员");

    // 真库唯一索引这条路：同一个工作区同一个目录只能有一条记录。
    await expectError(
      await app.request("/api/plugins", {
        method: "POST",
        headers: admin.headers,
        body: JSON.stringify({ source_path: echoPath })
      }),
      409,
      "plugin_already_installed",
      "重复安装同一个目录"
    );
    line("重复安装", "409 plugin_already_installed");

    console.log("");
    console.log("[6/8] 工具注册表的可观测点：宿主热重载后这个工作区真的多了一个工具");
    // toolSpecs 就是 agent-runner 的 defaultPluginToolsProvider 走的那一条——
    // 它返回什么，这次执行里模型就能看到什么。
    const afterInstall = await pluginHost.toolSpecs({ workspaceId });
    line("toolSpecs（装完）", afterInstall.map((spec) => spec.id));
    assert.equal(afterInstall.length, 1, "装完之后这个工作区应当恰好多出一个插件工具");
    const spec = afterInstall[0]!;
    assert.equal(spec.id, ECHO_TOOL_ID);
    assert.equal(spec.sideEffect, "external_effect", "插件工具一律按最高风险对待（阶段 0 保守口径）");
    assert.equal(spec.minScope, `plugin:${ECHO_PLUGIN_ID}:external_effect`);
    const reports = await pluginHost.loadReports(workspaceId);
    line("宿主加载报告", reports);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.ok, true);

    // 另一个工作区不该看见它——插件是工作区级治理对象，围栏在 SQL 谓词里。
    const otherWorkspaceSpecs = await pluginHost.toolSpecs({ workspaceId: randomUUID() });
    line("toolSpecs（另一个工作区）", otherWorkspaceSpecs.map((entry) => entry.id));
    assert.deepEqual(otherWorkspaceSpecs, [], "别的工作区不该看到这个插件的工具");

    console.log("");
    console.log("[7/8] 停用 → 工具消失；重新启用 → 工具回来；移除 → 404");
    const disabled = await expectOk<PluginVM>(
      await app.request(`/api/plugins/${installed.id}/disable`, { method: "POST", headers: admin.headers }),
      200,
      "停用"
    );
    assert.equal(disabled.status, "disabled");
    assert.equal(disabled.enabled, false);
    const afterDisable = await pluginHost.toolSpecs({ workspaceId });
    line("toolSpecs（停用后）", afterDisable.map((entry) => entry.id));
    assert.deepEqual(afterDisable, [], "停用之后插件工具不该再出现在任何一次执行里");
    assert.deepEqual(
      await pluginRepository.listEnabledForWorkspace(workspaceId),
      [],
      "停用之后宿主装配清单里不该还有这一行"
    );

    const reenabled = await expectOk<PluginVM>(
      await app.request(`/api/plugins/${installed.id}/enable`, { method: "POST", headers: admin.headers }),
      200,
      "重新启用"
    );
    assert.equal(reenabled.status, "installed", `重新试加载没成功：${JSON.stringify(reenabled.load_report)}`);
    assert.equal(reenabled.enabled, true);
    assert.equal(reenabled.tool_count, 1);
    const afterEnable = await pluginHost.toolSpecs({ workspaceId });
    line("toolSpecs（重新启用后）", afterEnable.map((entry) => entry.id));
    assert.equal(afterEnable.length, 1, "重新启用之后插件工具应当回到注册表里");
    assert.equal(afterEnable[0]?.id, ECHO_TOOL_ID);

    const removed = await expectOk<{ removed: true }>(
      await app.request(`/api/plugins/${installed.id}`, { method: "DELETE", headers: admin.headers }),
      200,
      "移除"
    );
    assert.deepEqual(removed, { removed: true });
    const afterRemove = await expectOk<PluginListVM>(
      await app.request("/api/plugins", { headers: admin.headers }),
      200,
      "移除后的清单"
    );
    assert.deepEqual(afterRemove.plugins, [], "移除之后清单应当空了");
    assert.deepEqual(await pluginHost.toolSpecs({ workspaceId }), [], "移除之后插件工具也该消失");
    for (const [label, request] of [
      ["DELETE 同一个 id", app.request(`/api/plugins/${installed.id}`, { method: "DELETE", headers: admin.headers })],
      [
        "POST enable 同一个 id",
        app.request(`/api/plugins/${installed.id}/enable`, { method: "POST", headers: admin.headers })
      ]
    ] as Array<[string, Promise<Response>]>) {
      await expectError(await request, 404, "plugin_not_found", `移除之后 ${label}`);
      line(label, "404 plugin_not_found");
    }
    // 非 uuid 形状按「没有这个插件」处理，不把「这不是个 uuid」当成对外语义。
    await expectError(
      await app.request("/api/plugins/not-a-uuid", { method: "DELETE", headers: admin.headers }),
      404,
      "http_error",
      "非法 id 形状"
    );

    console.log("");
    console.log("[8/8] 四个写动作各落一条审计");
    const auditRows = await auditRepo.listAuditLogsForEntity("plugin", installed.id, { limit: 50 });
    const actions = auditRows.map((row) => row.action).sort();
    line("审计动作", actions);
    assert.deepEqual(
      actions,
      ["plugin.disabled", "plugin.enabled", "plugin.installed", "plugin.removed"],
      "四个写动作应当各落恰好一条审计（安装/启用/停用/移除）"
    );
    for (const row of auditRows) {
      const detail = (row.detailJson ?? {}) as Record<string, unknown>;
      assert.equal(row.entityType, "plugin");
      assert.equal(row.entityId, installed.id);
      assert.equal(row.actorKind, "human", `${row.action} 的审计应当记成人类动作`);
      assert.equal(row.actorUserId, admin.id, `${row.action} 的审计应当指向真的动手的那个管理员`);
      assert.equal(row.workspaceId, workspaceId, `${row.action} 的审计应当带上工作区`);
      assert.equal(detail["plugin_name"], ECHO_PLUGIN_ID, `${row.action} 的审计 detail 缺插件名`);
      assert.equal(detail["source_path"], echoPath, `${row.action} 的审计 detail 缺来源路径`);
      assert.equal(detail["source_kind"], "local_path");
    }
    const installedAudit = auditRows.find((row) => row.action === "plugin.installed");
    const installedDetail = (installedAudit?.detailJson ?? {}) as Record<string, unknown>;
    line("plugin.installed detail", installedDetail);
    assert.equal(installedDetail["compat_verdict"], installed.compat_report.verdict);
    assert.equal(installedDetail["load_ok"], true);

    console.log("");
    console.log("R1 PG 插件治理冒烟通过：0072 在真库上落地，清单/启停/移除全链走通，工具注册表随之增减，四个动作各有审计。");
  } finally {
    await pluginHost.close();
    await rm(fixtureRoot, { recursive: true, force: true });
    await client.close();
  }
}

main().catch((error) => {
  console.error("");
  console.error("R1 PG 插件治理冒烟失败：");
  console.error(error);
  process.exit(1);
});
