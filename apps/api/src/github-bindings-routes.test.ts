import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  GithubBindingRepository,
  GithubBindingRow,
  GithubBindingProjectRow,
  UpsertGithubBindingInput,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { createStructuredLogger } from "./logging.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { GithubHttpError, type GithubClient } from "./services/github-client.js";
import {
  createGithubBindingsService,
  type GithubBindingsService
} from "./services/github-bindings.js";
import { createSecretBox } from "./services/secret-box.js";

const now = new Date("2026-07-14T10:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000002";
const projectId = "14000000-0000-4000-8000-0000000000b1";
const ownerUserId = "14000000-0000-4000-8000-0000000000b2";
const pat = "ghp_route_secret_token_0123456789abcdef";
const keyBase64 = randomBytes(32).toString("base64");

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-gh-binding-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: ownerUserId,
    nickname: "r14-owner",
    cookieToken: "cookie-r14-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === ownerUserId ? user() : null;
  }
  async findActiveByCookieToken(token: string) {
    return token === "cookie-r14-owner" ? user() : null;
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
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-r14-owner", runtimeSettings.auth.cookieSecret);
}

function projectRow(overrides: Partial<GithubBindingProjectRow> = {}): GithubBindingProjectRow {
  return {
    id: projectId,
    workspaceId,
    name: "GH 集成",
    slug: "gh",
    description: null,
    ownerNickname: "r14-owner",
    ownerUserId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 0,
    isPersonal: false,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function bindingRowFrom(input: UpsertGithubBindingInput): GithubBindingRow {
  return {
    projectId: input.projectId,
    repoFullName: input.repoFullName,
    patCiphertext: input.patCiphertext,
    patIv: input.patIv,
    patAuthTag: input.patAuthTag,
    enabled: true,
    createdByUserId: input.actorUserId,
    commitsSince: null,
    issuesSince: null,
    etagJson: {},
    lastSyncedAt: null,
    lastError: null,
    lastErrorAt: null,
    createdAt: input.at ?? now,
    updatedAt: input.at ?? now
  };
}

type FakeRepositoryState = {
  project: GithubBindingProjectRow | null;
  binding: GithubBindingRow | null;
  ownerOk: boolean;
};

function fakeRepository(state: FakeRepositoryState) {
  const calls = {
    upsert: [] as UpsertGithubBindingInput[],
    deletes: 0,
    syncWrites: 0
  };
  const repository: GithubBindingRepository = {
    async findProjectWithBinding(id) {
      return state.project && id === state.project.id
        ? { project: state.project, binding: state.binding }
        : null;
    },
    async findBindingOwnerAccessRecord() {
      return state.ownerOk && state.project
        ? { project: state.project, binding: state.binding }
        : null;
    },
    async upsertBinding(input) {
      calls.upsert.push(input);
      const written = bindingRowFrom(input);
      state.binding = written;
      return written;
    },
    async deleteBinding() {
      calls.deletes += 1;
      const existed = state.binding !== null;
      state.binding = null;
      return existed;
    },
    async countActivitiesSince() {
      return 3;
    },
    async listRecentActivitiesByProject() {
      return [];
    },
    async listEnabledBindings() {
      return [];
    },
    async upsertActivity() {
      calls.syncWrites += 1;
    },
    async recordSyncSuccess() {
      calls.syncWrites += 1;
    },
    async recordSyncFailure() {
      calls.syncWrites += 1;
    }
  };
  return { repository, calls };
}

function fakeClient(behavior: { fail?: GithubHttpError }) {
  const seenPats: string[] = [];
  const client: Pick<GithubClient, "getRepo"> = {
    async getRepo(repoFullName, requestPat) {
      seenPats.push(requestPat);
      if (behavior.fail) {
        throw behavior.fail;
      }
      return {
        repo: { full_name: repoFullName, default_branch: "main", private: true },
        rateLimitRemaining: 4999
      };
    }
  };
  return { client, seenPats };
}

function captureLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: createStructuredLogger({ write: (line) => lines.push(line), now: () => now })
  };
}

function service(input: {
  state?: FakeRepositoryState;
  clientFail?: GithubHttpError;
  secretBoxKey?: string | null;
  logLines?: string[];
}) {
  const state = input.state ?? { project: projectRow(), binding: null, ownerOk: true };
  const { repository, calls } = fakeRepository(state);
  const { client, seenPats } = fakeClient({ ...(input.clientFail ? { fail: input.clientFail } : {}) });
  const capture = captureLogger();
  if (input.logLines) {
    capture.lines.push = (...values: string[]) => {
      input.logLines!.push(...values);
      return input.logLines!.length;
    };
  }
  const built = createGithubBindingsService({
    repository,
    client,
    logger: capture.logger,
    now: () => now,
    ...(input.secretBoxKey === null
      ? {}
      : { secretBox: createSecretBox(input.secretBoxKey ?? keyBase64) })
  });
  return { service: built, calls, seenPats, state, logLines: capture.lines };
}

async function routeApp(runtimeSettings: Settings, githubBindings: GithubBindingsService) {
  const module = await import("./routes/github-bindings.js");
  assert.equal(typeof module.createGithubBindingRoutes, "function");
  const app = new Hono<AuthEnv>();
  app.route("/api", module.createGithubBindingRoutes({ auth: authDeps(runtimeSettings), githubBindings }));
  return app;
}

test("GH binding routes authenticate before any service work", async () => {
  const runtimeSettings = settings();
  const { service: svc } = service({});
  const app = await routeApp(runtimeSettings, svc);

  for (const [method, path] of [
    ["GET", `/api/projects/${projectId}/github-binding`],
    ["PUT", `/api/projects/${projectId}/github-binding`],
    ["DELETE", `/api/projects/${projectId}/github-binding`],
    ["POST", `/api/projects/${projectId}/github-binding/test`]
  ] as const) {
    const response = await app.request(path, { method });
    assert.equal(response.status, 401, `${method} ${path} must require auth`);
  }
});

test("GH binding invalid project UUIDs return the domain 404 without touching the service", async () => {
  const runtimeSettings = settings();
  const { service: svc, calls } = service({});
  const app = await routeApp(runtimeSettings, svc);
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const response = await app.request("/api/projects/not-a-uuid/github-binding", { headers });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "github_binding_project_not_found", message: "没有找到可访问的项目。" }
  });
  assert.equal(calls.upsert.length, 0);
});

test("GET binding status reports bound:false for a visible project without a binding", async () => {
  const runtimeSettings = settings();
  const { service: svc } = service({});
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { project_id: projectId, bound: false }
  });
});

test("PUT binding verifies the GitHub connection first and writes only ciphertext", async () => {
  const runtimeSettings = settings();
  const { service: svc, calls, seenPats } = service({});
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ repo_full_name: "octocat/Hello-World", personal_access_token: pat })
  });

  assert.equal(response.status, 201, "first bind must be a 201 create");
  const body = await response.json() as { ok: boolean; data: Record<string, unknown> };
  assert.equal(body.data.bound, true);
  assert.equal(body.data.repo_full_name, "octocat/Hello-World");
  assert.equal(body.data.activity_count_7d, 3);

  // 真连过 GitHub（收到的是明文 PAT），且先验证后落库。
  assert.deepEqual(seenPats, [pat]);
  assert.equal(calls.upsert.length, 1);
  const written = calls.upsert[0]!;
  // 落库的是密文三列：不含明文，且能用同一把钥匙解回原文（真加密，不是编码）。
  assert.equal(written.patCiphertext.toString("utf8").includes(pat), false);
  const box = createSecretBox(keyBase64);
  assert.equal(
    box.open({ ciphertext: written.patCiphertext, iv: written.patIv, authTag: written.patAuthTag }),
    pat
  );

  // 响应体全字段扫描：不含任何密钥关联字段名，也不含 PAT 明文（验收 6）。
  const serialized = JSON.stringify(body);
  for (const forbidden of ["pat_ciphertext", "pat_iv", "pat_auth_tag", "personal_access_token", pat]) {
    assert.equal(serialized.includes(forbidden), false, `response must not contain ${forbidden}`);
  }
});

test("PUT binding rebind responds 200 and resets state through the repository", async () => {
  const runtimeSettings = settings();
  const box = createSecretBox(keyBase64);
  const sealed = box.seal(pat);
  const existing: GithubBindingRow = {
    ...bindingRowFrom({
      workspaceId,
      projectId,
      actorUserId: ownerUserId,
      repoFullName: "octocat/old-repo",
      patCiphertext: sealed.ciphertext,
      patIv: sealed.iv,
      patAuthTag: sealed.authTag,
      at: now
    })
  };
  const { service: svc } = service({
    state: { project: projectRow(), binding: existing, ownerOk: true }
  });
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ repo_full_name: "octocat/new-repo", personal_access_token: pat })
  });

  assert.equal(response.status, 200, "rebind must be a 200 update");
  const body = await response.json() as { data: Record<string, unknown> };
  assert.equal(body.data.repo_full_name, "octocat/new-repo");
});

test("PUT binding with a rejected PAT returns 422 and never writes a row", async () => {
  const runtimeSettings = settings();
  const { service: svc, calls } = service({ clientFail: new GithubHttpError(401, "GitHub returned HTTP 401") });
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ repo_full_name: "octocat/Hello-World", personal_access_token: pat })
  });

  assert.equal(response.status, 422);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "github_binding_connection_failed");
  assert.equal(body.error.message.includes("PAT 无效或已过期"), true);
  assert.equal(body.error.message.includes(pat), false);
  assert.equal(calls.upsert.length, 0, "failed verification must not write any row");
});

test("PUT/DELETE/test are owner-only: a visible non-owner member gets 403", async () => {
  const runtimeSettings = settings();
  const { service: svc, calls } = service({
    state: {
      project: projectRow({ ownerUserId: "14000000-0000-4000-8000-0000000000c9" }),
      binding: null,
      ownerOk: false
    }
  });
  const app = await routeApp(runtimeSettings, svc);
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const put = await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ repo_full_name: "octocat/Hello-World", personal_access_token: pat })
  });
  const remove = await app.request(`/api/projects/${projectId}/github-binding`, { method: "DELETE", headers });
  const probe = await app.request(`/api/projects/${projectId}/github-binding/test`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  for (const response of [put, remove, probe]) {
    assert.equal(response.status, 403);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "github_binding_owner_required");
  }
  // 同工作区成员仍可读状态（读比写松，canViewProjectDrive 口径）。
  const get = await app.request(`/api/projects/${projectId}/github-binding`, { headers });
  assert.equal(get.status, 200);
  assert.equal(calls.upsert.length, 0);
  assert.equal(calls.deletes, 0);
});

test("unknown project stays a 404 for every verb (existence hiding)", async () => {
  const runtimeSettings = settings();
  const { service: svc } = service({ state: { project: null, binding: null, ownerOk: false } });
  const app = await routeApp(runtimeSettings, svc);
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  for (const [method, path, body] of [
    ["GET", `/api/projects/${projectId}/github-binding`, undefined],
    ["PUT", `/api/projects/${projectId}/github-binding`, JSON.stringify({ repo_full_name: "a/b", personal_access_token: pat })],
    ["DELETE", `/api/projects/${projectId}/github-binding`, undefined],
    ["POST", `/api/projects/${projectId}/github-binding/test`, "{}"]
  ] as const) {
    const response = await app.request(path, { method, headers, ...(body ? { body } : {}) });
    assert.equal(response.status, 404, `${method} must 404 on an unknown project`);
  }
});

test("DELETE binding responds 204 and physically removes the row", async () => {
  const runtimeSettings = settings();
  const box = createSecretBox(keyBase64);
  const sealed = box.seal(pat);
  const state: FakeRepositoryState = {
    project: projectRow(),
    binding: bindingRowFrom({
      workspaceId,
      projectId,
      actorUserId: ownerUserId,
      repoFullName: "octocat/Hello-World",
      patCiphertext: sealed.ciphertext,
      patIv: sealed.iv,
      patAuthTag: sealed.authTag,
      at: now
    }),
    ownerOk: true
  };
  const { service: svc, calls } = service({ state });
  const app = await routeApp(runtimeSettings, svc);
  const headers = { Cookie: await cookie(runtimeSettings) };

  const response = await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "DELETE",
    headers
  });
  assert.equal(response.status, 204);
  assert.equal(calls.deletes, 1);
  assert.equal(state.binding, null);

  // 已解绑后再删：404（幂等语义按「没有可删的绑定」诚实报告）。
  const again = await app.request(`/api/projects/${projectId}/github-binding`, { method: "DELETE", headers });
  assert.equal(again.status, 404);
});

test("PUT and stored-PAT test respond 503 fail-closed when the encryption key is unconfigured", async () => {
  const runtimeSettings = settings();
  const { service: svc, calls } = service({ secretBoxKey: null });
  const app = await routeApp(runtimeSettings, svc);
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const put = await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ repo_full_name: "octocat/Hello-World", personal_access_token: pat })
  });

  assert.equal(put.status, 503);
  const body = await put.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "github_binding_encryption_unconfigured");
  assert.equal(body.error.message.includes("GITHUB_TOKEN_ENC_KEY"), true);
  assert.equal(calls.upsert.length, 0, "fail-closed must never fall back to plaintext storage");

  // 读状态不触碰 PAT，不受密钥缺失影响。
  const get = await app.request(`/api/projects/${projectId}/github-binding`, { headers });
  assert.equal(get.status, 200);
});

test("test endpoint verifies a temporary PAT without persisting it", async () => {
  const runtimeSettings = settings();
  const { service: svc, calls, seenPats } = service({});
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding/test`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ personal_access_token: pat, repo_full_name: "octocat/Hello-World" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { ok: true, repo_full_name: "octocat/Hello-World", repo_default_branch: "main", repo_private: true }
  });
  assert.deepEqual(seenPats, [pat]);
  assert.equal(calls.upsert.length, 0, "temporary PAT must not be persisted");
  assert.equal(calls.syncWrites, 0, "test connection must not touch sync watermarks");
});

test("test endpoint with an empty body decrypts the stored PAT and probes with it", async () => {
  const runtimeSettings = settings();
  const box = createSecretBox(keyBase64);
  const sealed = box.seal(pat);
  const { service: svc, seenPats, calls } = service({
    state: {
      project: projectRow(),
      binding: bindingRowFrom({
        workspaceId,
        projectId,
        actorUserId: ownerUserId,
        repoFullName: "octocat/Hello-World",
        patCiphertext: sealed.ciphertext,
        patIv: sealed.iv,
        patAuthTag: sealed.authTag,
        at: now
      }),
      ownerOk: true
    }
  });
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding/test`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { ok: boolean } };
  assert.equal(body.data.ok, true);
  // 存的密文被解回明文去探测——解密正确性经由收到的 PAT 值验证。
  assert.deepEqual(seenPats, [pat]);
  assert.equal(calls.syncWrites, 0);
});

test("test endpoint reports a connection failure as ok:false with a human reason, not an HTTP error", async () => {
  const runtimeSettings = settings();
  const { service: svc } = service({ clientFail: new GithubHttpError(404, "GitHub returned HTTP 404") });
  const app = await routeApp(runtimeSettings, svc);

  const response = await app.request(`/api/projects/${projectId}/github-binding/test`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ personal_access_token: pat, repo_full_name: "octocat/missing" })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: { ok: false, error: "仓库不存在或无访问权限" }
  });
});

test("structured logs across bind/test/delete never contain the PAT or its ciphertext", async () => {
  const runtimeSettings = settings();
  const logLines: string[] = [];
  const { service: svc } = service({ logLines });
  const app = await routeApp(runtimeSettings, svc);
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ repo_full_name: "octocat/Hello-World", personal_access_token: pat })
  });
  await app.request(`/api/projects/${projectId}/github-binding/test`, {
    method: "POST",
    headers,
    body: JSON.stringify({ personal_access_token: pat, repo_full_name: "octocat/Hello-World" })
  });
  await app.request(`/api/projects/${projectId}/github-binding`, { method: "DELETE", headers });

  assert.ok(logLines.length > 0, "binding lifecycle must emit structured log events");
  for (const line of logLines) {
    assert.equal(line.includes(pat), false, "log line must not contain the PAT");
    for (const forbidden of ["personal_access_token", "patCiphertext", "pat_ciphertext", "authTag"]) {
      assert.equal(line.includes(forbidden), false, `log line must not contain ${forbidden}`);
    }
  }
});

test("failed verification logs the human reason only, never the token", async () => {
  const runtimeSettings = settings();
  const logLines: string[] = [];
  const { service: svc } = service({
    clientFail: new GithubHttpError(401, "GitHub returned HTTP 401"),
    logLines
  });
  const app = await routeApp(runtimeSettings, svc);

  await app.request(`/api/projects/${projectId}/github-binding`, {
    method: "PUT",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ repo_full_name: "octocat/Hello-World", personal_access_token: pat })
  });

  const failureLine = logLines.find((line) => line.includes("github_binding_connection_check_failed"));
  assert.ok(failureLine, "verification failure must be logged");
  assert.equal(failureLine.includes(pat), false);
});
