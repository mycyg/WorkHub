import assert from "node:assert/strict";
import test from "node:test";

import {
  MCP_CHILD_ENV_ALLOWLIST,
  MCP_SECRET_REF_ENV_PREFIX,
  buildMcpChildEnv,
  isDeniedPluginHostEnvKey,
  resolveMcpSecretRefs
} from "./env.js";

const hostEnv = {
  PATH: "/usr/bin",
  HOME: "/home/x",
  LANG: "en_US.UTF-8",
  DATABASE_URL: "postgresql://u:p@h/db",
  REDIS_URL: "redis://h",
  LLM_API_KEY: "sk-real",
  COOKIE_SECRET: "cookie",
  ADMIN_CLAIM_SECRET: "admin",
  GITHUB_TOKEN: "ghp-real",
  MY_COMPANY_PAT: "pat-real",
  NODE_OPTIONS: "--require ./evil.js",
  WORKHUB_MCP_SECRET_GITHUB: "ghp-for-mcp"
};

test("子进程只拿白名单里的键，凭据一个都不透传", () => {
  const env = buildMcpChildEnv({ source: hostEnv });
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "PATH"]);
  for (const key of [
    "DATABASE_URL",
    "REDIS_URL",
    "LLM_API_KEY",
    "COOKIE_SECRET",
    "ADMIN_CLAIM_SECRET",
    "GITHUB_TOKEN",
    "WORKHUB_MCP_SECRET_GITHUB"
  ]) {
    assert.equal(env[key], undefined, `${key} 不该出现在 MCP 子进程 env 里`);
  }
});

test("黑名单口径是白名单的兜底，不是替代——一个没被明确点名的凭据也拿不到", () => {
  // 参考实现用的是黑名单（过滤掉像凭据的键名、其余全透传），这条测试钉死我们没有沿用它：
  // `MY_COMPANY_PAT` 不像凭据、也不在白名单里，所以它不该出现。
  const env = buildMcpChildEnv({ source: hostEnv });
  assert.equal(env.MY_COMPANY_PAT, undefined);
  assert.equal(isDeniedPluginHostEnvKey("MY_COMPANY_PAT"), false);
});

test("env 里没有 NODE_OPTIONS（不继承宿主的 --require / --import 注入）", () => {
  assert.equal(buildMcpChildEnv({ source: hostEnv }).NODE_OPTIONS, undefined);
});

test("服务器配置里的普通键会被带上", () => {
  const env = buildMcpChildEnv({ source: hostEnv, serverEnv: { GITHUB_HOST: "github.example.com" } });
  assert.equal(env.GITHUB_HOST, "github.example.com");
});

test("服务器配置不许塞凭据形状的键，也不许顶掉基座键", () => {
  assert.throws(() => buildMcpChildEnv({ source: hostEnv, serverEnv: { GITHUB_TOKEN: "x" } }), /credential-shaped/u);
  assert.throws(() => buildMcpChildEnv({ source: hostEnv, serverEnv: { MY_SECRET: "x" } }), /credential-shaped/u);
  assert.throws(() => buildMcpChildEnv({ source: hostEnv, serverEnv: { PATH: "/evil" } }), /override a host env key/u);
  assert.throws(() => buildMcpChildEnv({ source: hostEnv, serverEnv: { "not a name": "x" } }), /valid environment/u);
});

test("引用式密钥：填的是指针，注进去的是值", () => {
  const env = buildMcpChildEnv({
    source: hostEnv,
    secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_GITHUB" }
  });
  assert.equal(env.GITHUB_TOKEN, "ghp-for-mcp");
  // 注意注进去的是 MCP 专用那份，不是 API 进程自己的 GITHUB_TOKEN。
  assert.notEqual(env.GITHUB_TOKEN, hostEnv.GITHUB_TOKEN);
});

test("引用的服务端变量不存在时 fail-closed，不拿空串起进程", () => {
  assert.throws(
    () => buildMcpChildEnv({ source: hostEnv, secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_MISSING" } }),
    /secret reference unusable/u
  );
  const resolution = resolveMcpSecretRefs({
    source: hostEnv,
    secretRefs: { GITHUB_TOKEN: "WORKHUB_MCP_SECRET_MISSING" }
  });
  assert.equal(resolution.ok, false);
  assert.deepEqual(resolution.ok === false ? resolution.problems : [], [
    { childKey: "GITHUB_TOKEN", sourceKey: "WORKHUB_MCP_SECRET_MISSING", reason: "missing" }
  ]);
});

test("空串等于没配", () => {
  const resolution = resolveMcpSecretRefs({
    source: { WORKHUB_MCP_SECRET_EMPTY: "" },
    secretRefs: { TOKEN: "WORKHUB_MCP_SECRET_EMPTY" }
  });
  assert.equal(resolution.ok, false);
  assert.equal(resolution.ok === false ? resolution.problems[0]?.reason : "", "missing");
});

test("引用只能指向 WORKHUB_MCP_SECRET_ 命名空间——否则它就是一个读任意环境变量的原语", () => {
  for (const sourceKey of ["COOKIE_SECRET", "DATABASE_URL", "LLM_API_KEY", "PATH", "GITHUB_TOKEN"]) {
    const resolution = resolveMcpSecretRefs({ source: hostEnv, secretRefs: { X_TOKEN: sourceKey } });
    assert.equal(resolution.ok, false, sourceKey);
    assert.equal(resolution.ok === false ? resolution.problems[0]?.reason : "", "out_of_scope", sourceKey);
  }
  assert.equal(MCP_SECRET_REF_ENV_PREFIX, "WORKHUB_MCP_SECRET_");
});

test("子进程变量名要合法，且不许顶掉基座键", () => {
  const bad = resolveMcpSecretRefs({
    source: hostEnv,
    secretRefs: { "9lives": "WORKHUB_MCP_SECRET_GITHUB", PATH: "WORKHUB_MCP_SECRET_GITHUB" }
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(
    bad.ok === false ? bad.problems.map((problem) => problem.reason).sort() : [],
    ["invalid_child_key", "overrides_base_key"]
  );
});

test("一次把所有问题都报出来，不是遇到第一条就停", () => {
  const resolution = resolveMcpSecretRefs({
    source: hostEnv,
    secretRefs: { A: "COOKIE_SECRET", B: "WORKHUB_MCP_SECRET_MISSING", C: "WORKHUB_MCP_SECRET_GITHUB" }
  });
  assert.equal(resolution.ok, false);
  assert.equal(resolution.ok === false ? resolution.problems.length : 0, 2);
});

test("引用式密钥撞上已经设过的键时抛错，不悄悄覆盖", () => {
  assert.throws(
    () =>
      buildMcpChildEnv({
        source: hostEnv,
        serverEnv: { GITHUB_HOST: "a" },
        secretRefs: { GITHUB_HOST: "WORKHUB_MCP_SECRET_GITHUB" }
      }),
    /collides with an env key/u
  );
});

test("白名单本身不含任何被凭据黑名单命中的键", () => {
  for (const key of MCP_CHILD_ENV_ALLOWLIST) {
    assert.equal(isDeniedPluginHostEnvKey(key), false, key);
  }
});

test("宿主没有的白名单键就是不给，不注空串", () => {
  const env = buildMcpChildEnv({ source: { PATH: "/usr/bin" } });
  assert.deepEqual(Object.keys(env), ["PATH"]);
});
