import assert from "node:assert/strict";
import test from "node:test";

import { createPluginRepository } from "./repositories/plugins.js";
import { plugins } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

// R24-P 阶段 1（插件清单仓储）：用 query recorder 断言仓储真的把工作区围栏与启停语义编译进 SQL——
// 纯内存、无真 PG。最要紧的一条：**每个原语都必须带 workspace_id 谓词**，跨租户读写在 SQL 层就不成立。

const at = new Date("2026-09-05T09:00:00.000Z");
const workspaceId = "11111111-1111-4111-8111-111111111111";

function pluginRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspaceId,
    name: "dsh-plugin-echo",
    version: "0.1.0",
    sourceKind: "local_path",
    sourcePath: "/srv/plugins/dsh-plugin-echo",
    enabled: true,
    status: "installed",
    compatReport: {},
    loadReport: null,
    toolCount: 1,
    installedBy: null,
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

test("listForWorkspace fences on workspace_id and orders oldest-first", async () => {
  const { db, queries } = createQueryRecorder([[pluginRow()]]);
  const rows = await createPluginRepository(db).listForWorkspace(workspaceId);
  assert.equal(rows.length, 1);
  const select = queries.find((query) => query.operation === "select");
  assert.equal(select?.fromTable, plugins);
  assert.ok(queryReferences(select?.where, plugins.workspaceId), "list must be workspace-fenced");
  assert.ok(queryParamValues(select?.where).includes(workspaceId));
  assert.ok(queryReferences(select?.orderBy[0], plugins.createdAt), "list order must be stable across toggles");
});

test("listEnabledForWorkspace only picks enabled, non-disabled rows for the host", async () => {
  const { db, queries } = createQueryRecorder([[pluginRow()]]);
  await createPluginRepository(db).listEnabledForWorkspace(workspaceId);
  const select = queries.find((query) => query.operation === "select");
  const where = select?.where;
  assert.ok(queryReferences(where, plugins.workspaceId), "host assembly must be workspace-fenced");
  assert.ok(queryReferences(where, plugins.enabled), "host assembly must filter on enabled");
  assert.ok(queryReferences(where, plugins.status), "host assembly must exclude disabled rows");
  assert.ok(queryParamValues(where).includes("disabled"));
});

test("findBySourcePath is workspace-fenced (installing the same directory twice is a per-workspace conflict)", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const found = await createPluginRepository(db).findBySourcePath(workspaceId, "/srv/plugins/echo");
  assert.equal(found, null);
  const select = queries.find((query) => query.operation === "select");
  assert.ok(queryReferences(select?.where, plugins.workspaceId));
  assert.ok(queryReferences(select?.where, plugins.sourcePath));
  assert.equal(select?.limit, 1);
});

test("create always pins source_kind to local_path and returns the inserted row", async () => {
  const { db, queries } = createQueryRecorder([[pluginRow()]]);
  const row = await createPluginRepository(db).create({
    workspaceId,
    name: "dsh-plugin-echo",
    version: "0.1.0",
    sourcePath: "/srv/plugins/dsh-plugin-echo",
    status: "installed",
    compatReport: { verdict: "ok" },
    toolCount: 1,
    now: at
  });
  assert.equal(row.name, "dsh-plugin-echo");
  const insert = queries.find((query) => query.operation === "insert");
  const values = insert?.valuesValue as Record<string, unknown>;
  // 只允许本地目录：npm/git/tarball 会在安装期跑包自己的 prepare/postinstall（沙箱之外的任意代码执行）。
  assert.equal(values["sourceKind"], "local_path");
  assert.equal(values["enabled"], true, "a freshly installed plugin defaults to enabled");
  assert.equal(insert?.returningCalled, true);
});

test("setEnabled(false) flips the status to disabled in the same UPDATE", async () => {
  const { db, queries } = createQueryRecorder([[pluginRow({ enabled: false, status: "disabled" })]]);
  const row = await createPluginRepository(db).setEnabled({
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
  assert.ok(queryReferences(update?.where, plugins.workspaceId), "toggling must be workspace-fenced");
});

test("setEnabled(true) returns the row to 'installed' so the next load attempt can re-decide", async () => {
  const { db, queries } = createQueryRecorder([[pluginRow()]]);
  await createPluginRepository(db).setEnabled({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    enabled: true,
    now: at
  });
  const setValue = queries.find((query) => query.operation === "update")?.setValue as Record<string, unknown>;
  assert.equal(setValue["enabled"], true);
  assert.equal(setValue["status"], "installed");
});

test("updateLoadResult persists the host's load report alongside the status", async () => {
  const { db, queries } = createQueryRecorder([[pluginRow({ status: "load_failed", toolCount: 0 })]]);
  const row = await createPluginRepository(db).updateLoadResult({
    workspaceId,
    id: "22222222-2222-4222-8222-222222222222",
    status: "load_failed",
    toolCount: 0,
    loadReport: { ok: false, error: "unsupported JSON schema" },
    now: at
  });
  assert.equal(row?.status, "load_failed");
  const setValue = queries.find((query) => query.operation === "update")?.setValue as Record<string, unknown>;
  assert.equal(setValue["status"], "load_failed");
  assert.deepEqual(setValue["loadReport"], { ok: false, error: "unsupported JSON schema" });
});

test("remove is workspace-fenced and reports whether a row was actually deleted", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const removed = await createPluginRepository(db).remove(workspaceId, "22222222-2222-4222-8222-222222222222");
  assert.equal(removed, false, "a miss must not report a deletion");
  const remove = queries.find((query) => query.operation === "delete");
  assert.equal(remove?.targetTable, plugins);
  assert.ok(queryReferences(remove?.where, plugins.workspaceId));
  assert.equal(remove?.returningCalled, true);
});
