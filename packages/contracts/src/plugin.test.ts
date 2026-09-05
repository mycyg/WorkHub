import assert from "node:assert/strict";
import test from "node:test";

import {
  installPluginRequestSchema,
  pluginCompatReportSchema,
  pluginListVmSchema,
  pluginSourceKindSchema,
  pluginStatusSchema,
  pluginVmSchema
} from "./index.js";

// R24-P 阶段 1：插件治理契约。这些断言钉的是治理红线，不是字段拼写。

const checkedAt = "2026-09-05T09:00:00.000Z";

function compatReport(overrides: Record<string, unknown> = {}) {
  return {
    verdict: "ok",
    checks: [{ id: "manifest", level: "pass" }],
    checked_at: checkedAt,
    ...overrides
  };
}

test("the only accepted install source is a local path", () => {
  assert.equal(pluginSourceKindSchema.parse("local_path"), "local_path");
  // npm 包名 / git url / tarball 会在安装期跑包自己的 prepare/postinstall——那是任何沙箱之外的
  // 任意代码执行，所以契约层就不给它们一个可表达的值。
  for (const refused of ["npm", "git", "tarball", "url"]) {
    assert.equal(pluginSourceKindSchema.safeParse(refused).success, false, `${refused} must not be installable`);
  }
});

test("plugin status covers installed / load_failed / disabled and nothing else", () => {
  for (const status of ["installed", "load_failed", "disabled"]) {
    assert.equal(pluginStatusSchema.parse(status), status);
  }
  assert.equal(pluginStatusSchema.safeParse("crashed").success, false);
});

test("the install request is strict — a stray field is a contract violation, not a silent drop", () => {
  assert.deepEqual(installPluginRequestSchema.parse({ source_path: "/srv/plugins/echo" }), {
    source_path: "/srv/plugins/echo"
  });
  assert.equal(
    installPluginRequestSchema.safeParse({ source_path: "/srv/plugins/echo", source_kind: "npm" }).success,
    false,
    "a caller must not be able to smuggle in another source kind"
  );
  assert.equal(installPluginRequestSchema.safeParse({ source_path: "" }).success, false);
});

test("a compatibility report records every check with a verdict level", () => {
  const report = pluginCompatReportSchema.parse(
    compatReport({
      verdict: "blocked",
      checks: [
        { id: "client_surface", level: "block", detail: "declares dsh.client" },
        { id: "install_scripts", level: "pass" }
      ],
      manifest_name: "dsh-plugin-theme",
      peer_dsh_tools_range: "^0.1.0-rc.6",
      host_dsh_tools_version: "0.1.0-rc.8"
    })
  );
  assert.equal(report.verdict, "blocked");
  assert.equal(report.checks[0]?.level, "block");
  // 两个版本都摆出来，用户自己能判断「这插件是对着哪个版本发的」。
  assert.equal(report.peer_dsh_tools_range, "^0.1.0-rc.6");
  assert.equal(report.host_dsh_tools_version, "0.1.0-rc.8");
});

test("an unknown compatibility check id is refused (the id set is a shared contract, not free text)", () => {
  assert.equal(
    pluginCompatReportSchema.safeParse(compatReport({ checks: [{ id: "vibes", level: "pass" }] })).success,
    false
  );
});

test("the plugin VM always carries a compatibility report; the load report is optional", () => {
  const base = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "dsh-plugin-echo",
    source_kind: "local_path",
    source_path: "/srv/plugins/dsh-plugin-echo",
    enabled: true,
    status: "installed",
    tool_count: 1,
    compat_report: compatReport(),
    created_at: checkedAt,
    updated_at: checkedAt
  };
  const vm = pluginVmSchema.parse(base);
  assert.equal(vm.load_report, undefined, "a plugin登记后未试加载时没有加载报告，不编一个出来");
  const withLoad = pluginVmSchema.parse({
    ...base,
    status: "load_failed",
    tool_count: 0,
    load_report: { ok: false, tool_count: 0, prompt_section_count: 0, error: "boom", loaded_at: checkedAt }
  });
  assert.equal(withLoad.load_report?.error, "boom", "加载失败的原因必须留下来，不能只在日志里一闪而过");
  const { compat_report: _dropped, ...withoutCompat } = base;
  assert.equal(pluginVmSchema.safeParse(withoutCompat).success, false, "every record must carry its health check");
});

test("the list VM reports how many bootstrap paths are still coming from the environment", () => {
  const list = pluginListVmSchema.parse({
    plugins: [],
    host_dsh_tools_version: "0.1.0-rc.8",
    bootstrap_path_count: 2
  });
  assert.equal(list.bootstrap_path_count, 2);
  assert.equal(pluginListVmSchema.safeParse({ plugins: [], bootstrap_path_count: -1 }).success, false);
});
