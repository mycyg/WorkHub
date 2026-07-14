import assert from "node:assert/strict";
import test from "node:test";

import {
  githubActivityKindSchema,
  githubBindingRequestSchema,
  githubBindingStatusVmSchema,
  githubTestConnectionRequestSchema,
  githubTestConnectionResultSchema
} from "./index.js";

test("R14 批 GH: binding request requires owner/repo shape and a plausible PAT length", () => {
  const ok = githubBindingRequestSchema.parse({
    repo_full_name: "octocat/Hello-World",
    personal_access_token: "ghp_0123456789abcdefghij"
  });
  assert.equal(ok.repo_full_name, "octocat/Hello-World");

  // 缺 owner 段 / 带空格 / 三段路径都不是合法 owner/repo。
  for (const bad of ["Hello-World", "owner/", "/repo", "a b/c", "owner/repo/extra"]) {
    assert.throws(() => githubBindingRequestSchema.parse({
      repo_full_name: bad,
      personal_access_token: "ghp_0123456789abcdefghij"
    }));
  }
  // 过短 PAT 被拒（min 20）。
  assert.throws(() => githubBindingRequestSchema.parse({
    repo_full_name: "octocat/Hello-World",
    personal_access_token: "short"
  }));
  // strict：多余字段（含试图夹带的别名）被拒。
  assert.throws(() => githubBindingRequestSchema.parse({
    repo_full_name: "octocat/Hello-World",
    personal_access_token: "ghp_0123456789abcdefghij",
    pat_ciphertext: "sneaky"
  }));
});

test("R14 批 GH: test-connection request allows an empty body and an optional temporary PAT", () => {
  assert.deepEqual(githubTestConnectionRequestSchema.parse({}), {});
  const withPat = githubTestConnectionRequestSchema.parse({
    personal_access_token: "ghp_0123456789abcdefghij",
    repo_full_name: "octocat/Hello-World"
  });
  assert.equal(withPat.repo_full_name, "octocat/Hello-World");
  assert.throws(() => githubTestConnectionRequestSchema.parse({ unexpected: true }));
});

test("R14 批 GH: binding status VM has no token-shaped field at all (structural exclusion)", () => {
  // 该 schema 的键集合里绝不含任何 token 关联字段——不是脱敏，是结构上就不存在。
  const shape = Object.keys(githubBindingStatusVmSchema.shape);
  for (const forbidden of [
    "personal_access_token",
    "pat",
    "pat_ciphertext",
    "pat_iv",
    "pat_auth_tag",
    "token",
    "access_token"
  ]) {
    assert.equal(shape.includes(forbidden), false, `status VM must not expose ${forbidden}`);
  }

  // 未绑定形态：bound=false，其余字段可缺省，parse 通过。
  const unbound = githubBindingStatusVmSchema.parse({
    project_id: "14000000-0000-4000-8000-000000000004",
    bound: false
  });
  assert.equal(unbound.bound, false);
  assert.equal(unbound.repo_full_name, undefined);

  // 即使调用方误传一个 token 字段，parse 后的对象也不会带出它（zod strip 默认剔除未知键）。
  const parsed = githubBindingStatusVmSchema.parse({
    project_id: "14000000-0000-4000-8000-000000000004",
    bound: true,
    repo_full_name: "octocat/Hello-World",
    personal_access_token: "ghp_should_be_dropped"
  }) as Record<string, unknown>;
  assert.equal("personal_access_token" in parsed, false);
});

test("R14 批 GH: test-connection result models failure as a normal value, not an exception", () => {
  const failure = githubTestConnectionResultSchema.parse({ ok: false, error: "PAT 无效或已过期" });
  assert.equal(failure.ok, false);
  assert.equal(failure.error, "PAT 无效或已过期");
  const success = githubTestConnectionResultSchema.parse({
    ok: true,
    repo_full_name: "octocat/Hello-World",
    repo_default_branch: "main",
    repo_private: false
  });
  assert.equal(success.repo_default_branch, "main");
});

test("R14 批 GH: activity kind enum is exactly the three signal kinds", () => {
  assert.deepEqual(githubActivityKindSchema.options, ["commit", "issue", "pull_request"]);
});
