import assert from "node:assert/strict";
import test from "node:test";

import { buildPluginHostEnv, isDeniedPluginHostEnvKey, parsePluginPaths, PLUGIN_HOST_ENV_ALLOWLIST } from "./env.js";

test("子进程 env 只拿白名单里的键，凭据一个都不透传", () => {
  const env = buildPluginHostEnv({
    source: {
      PATH: "/usr/bin",
      HOME: "/home/x",
      DATABASE_URL: "postgresql://u:p@h/db",
      REDIS_URL: "redis://h",
      LLM_API_KEY: "sk-real",
      DEEPSEEK_API_KEY: "sk-real-2",
      COOKIE_SECRET: "cookie",
      ADMIN_CLAIM_SECRET: "admin",
      SOME_TOKEN: "t"
    },
    pluginPaths: ["/opt/plugins/a"]
  });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "PATH", "WORKHUB_PLUGIN_HOST_ENTRY", "WORKHUB_PLUGIN_PATHS"]);
  assert.equal(env.WORKHUB_PLUGIN_PATHS, "/opt/plugins/a");
  for (const key of ["DATABASE_URL", "REDIS_URL", "LLM_API_KEY", "DEEPSEEK_API_KEY", "COOKIE_SECRET", "ADMIN_CLAIM_SECRET", "SOME_TOKEN"]) {
    assert.equal(env[key], undefined, `${key} 不该出现在插件宿主 env 里`);
  }
});

test("env 里没有 NODE_OPTIONS（不继承宿主的 --require/--import 注入）", () => {
  const env = buildPluginHostEnv({
    source: { PATH: "/usr/bin", NODE_OPTIONS: "--require ./evil.js" },
    pluginPaths: []
  });
  assert.equal(env.NODE_OPTIONS, undefined);
});

test("插件配置不许塞凭据形状的键，也不许顶掉宿主键", () => {
  assert.throws(
    () => buildPluginHostEnv({ source: {}, pluginPaths: [], pluginConfigEnv: { MY_API_KEY: "x" } }),
    /credential-shaped/u
  );
  assert.throws(
    () => buildPluginHostEnv({ source: {}, pluginPaths: [], pluginConfigEnv: { PATH: "/evil" } }),
    /override a host env key/u
  );
});

test("插件配置里的普通键会被带上", () => {
  const env = buildPluginHostEnv({ source: {}, pluginPaths: [], pluginConfigEnv: { FINANCE_LOCALE: "zh-CN" } });
  assert.equal(env.FINANCE_LOCALE, "zh-CN");
});

test("黑名单认凭据形状的键（大小写无关）", () => {
  assert.equal(isDeniedPluginHostEnvKey("database_url"), true);
  assert.equal(isDeniedPluginHostEnvKey("anything_api_key"), true);
  assert.equal(isDeniedPluginHostEnvKey("MY_PRIVATE_KEY"), true);
  assert.equal(isDeniedPluginHostEnvKey("LANG"), false);
});

test("白名单本身不含任何被黑名单命中的键", () => {
  for (const key of PLUGIN_HOST_ENV_ALLOWLIST) {
    assert.equal(isDeniedPluginHostEnvKey(key), false, `白名单里的 ${key} 命中了黑名单`);
  }
});

test("插件路径只认本地路径：npm 包名 / git url / tarball url 一律拒绝", () => {
  assert.deepEqual(parsePluginPaths("/opt/a, ./b ,../c"), ["/opt/a", "./b", "../c"]);
  assert.deepEqual(parsePluginPaths(undefined), []);
  assert.deepEqual(parsePluginPaths(""), []);
  assert.throws(() => parsePluginPaths("dsh-plugin-finance-data"), /bare specifier/u);
  assert.throws(() => parsePluginPaths("github:user/repo"), /only accepts local paths/u);
  assert.throws(() => parsePluginPaths("https://example.com/p.tgz"), /only accepts local paths/u);
  assert.throws(() => parsePluginPaths("file:./p"), /only accepts local paths/u);
});
