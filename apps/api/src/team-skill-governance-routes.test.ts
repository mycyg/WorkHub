import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { ClientDeviceAuthRow, ClientDeviceRepository, UserAuthRow, UserRepository } from "@workhub/db";

import { httpErrorCodeFor } from "./http-error-codes.js";
import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createTeamSkillGovernanceRoutes } from "./routes/team-skill-governance.js";
import {
  TeamSkillGovernanceServiceError,
  type TeamSkillGovernanceService
} from "./services/team-skill-governance.js";

const now = new Date("2026-07-14T10:00:00.000Z");
const userId = "19000000-0000-4000-8000-000000000001";
const skillId = "19000000-0000-4000-8000-000000000101";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r14-mem-team-skill-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "管理员甲",
    cookieToken: "cookie-skill-admin",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: true,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }
  async findActiveByCookieToken(token: string) {
    return token === "cookie-skill-admin" ? user() : null;
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

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-skill-admin", runtimeSettings.auth.cookieSecret);
}

function itemVm() {
  return {
    skill_key: "quarterly-report",
    name: "季度报告",
    when_to_use: "写季度报告时",
    version: 4,
    source_kind: "distilled" as const,
    created_by_kind: "human" as const,
    sample_count: 0,
    updated_at: now.toISOString(),
    id: skillId,
    content_md: "---\nname: 季度报告\nwhen_to_use: 写季度报告时\n---\n\n## 套路\n\n先列大纲。",
    status: "active" as const
  };
}

function service(overrides: Partial<TeamSkillGovernanceService> = {}): TeamSkillGovernanceService {
  return {
    async listSkills() {
      return { generated_at: now.toISOString(), skills: [itemVm()] };
    },
    async getSkill() {
      return itemVm();
    },
    async patchSkill() {
      return itemVm();
    },
    async deactivateSkill() {
      return { deprecated: true };
    },
    async curateNow() {
      return { started: true, curation: { enabled: true, running: true, last_run_at: null } };
    },
    ...overrides
  };
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof TeamSkillGovernanceServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    return c.json({ ok: false, error: { code: "internal_error", message: "internal" } }, 500);
  });
  return app;
}

async function routeApp(runtimeSettings: Settings, svc: TeamSkillGovernanceService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createTeamSkillGovernanceRoutes({ auth: authDeps(runtimeSettings), service: svc }));
  return app;
}

const validOps = [{ op: "modify_section" as const, section: "套路", content_md: "先列大纲，再逐段填充。" }];

test("all five endpoints require authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async listSkills() {
      throw new Error("anonymous must not reach the service");
    }
  }));
  assert.equal((await app.request("/api/team-skills/manage")).status, 401);
  assert.equal((await app.request(`/api/team-skills/manage/${skillId}`)).status, 401);
  assert.equal((await app.request(`/api/team-skills/manage/${skillId}`, { method: "PATCH", body: "{}" })).status, 401);
  assert.equal((await app.request(`/api/team-skills/manage/${skillId}/deactivate`, { method: "POST", body: "{}" })).status, 401);
  // R23 SA-06：手动触发一轮自学同样在认证之前就被挡下——它会真的花钱打 LLM。
  assert.equal((await app.request("/api/team-skills/curate-now", { method: "POST" })).status, 401);
});

test("non-uuid :id resolves to 404 before touching the service", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service({
    async getSkill() {
      throw new Error("must not reach the service for a malformed id");
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };
  assert.equal((await app.request("/api/team-skills/manage/not-a-uuid", { headers })).status, 404);
});

test("GET list and detail return the management view", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings) };

  const list = await app.request("/api/team-skills/manage", { headers });
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { ok: true, data: { generated_at: now.toISOString(), skills: [itemVm()] } });

  const detail = await app.request(`/api/team-skills/manage/${skillId}`, { headers });
  assert.equal(detail.status, 200);
  assert.deepEqual(await detail.json(), { ok: true, data: itemVm() });
});

test("PATCH forwards ops, base_version, and rationale_md to the service", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = await routeApp(runtimeSettings, service({
    async patchSkill(input) {
      seen.push({ ops: input.ops, baseVersion: input.baseVersion, rationaleMd: input.rationaleMd });
      return itemVm();
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const res = await app.request(`/api/team-skills/manage/${skillId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ops: validOps, base_version: 3, rationale_md: "补齐校对步骤" })
  });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ ops: validOps, baseVersion: 3, rationaleMd: "补齐校对步骤" }]);
});

test("PATCH structural violations (too many ops, non-positive base_version) are 422", async () => {
  const runtimeSettings = settings();
  const app = await routeApp(runtimeSettings, service());
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const tooMany = await app.request(`/api/team-skills/manage/${skillId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ops: [validOps[0], validOps[0], validOps[0], validOps[0]], base_version: 3 })
  });
  const badBase = await app.request(`/api/team-skills/manage/${skillId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ ops: validOps, base_version: 0 })
  });
  assert.equal(tooMany.status, 422);
  assert.equal(badBase.status, 422);
});

test("admin-gate, base-version-conflict, and rejected-patch service errors map to 403/409/400", async () => {
  const runtimeSettings = settings();
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };
  const body = JSON.stringify({ ops: validOps, base_version: 3 });

  const denied = await routeApp(runtimeSettings, service({
    async patchSkill() {
      throw new TeamSkillGovernanceServiceError(403, "team_skill_admin_required", "仅管理员");
    }
  }));
  const deniedRes = await denied.request(`/api/team-skills/manage/${skillId}`, { method: "PATCH", headers, body });
  assert.equal(deniedRes.status, 403);
  assert.deepEqual(await deniedRes.json(), { ok: false, error: { code: "team_skill_admin_required", message: "仅管理员" } });

  const conflict = await routeApp(runtimeSettings, service({
    async patchSkill() {
      throw new TeamSkillGovernanceServiceError(409, "team_skill_base_version_conflict", "版本冲突");
    }
  }));
  assert.equal((await conflict.request(`/api/team-skills/manage/${skillId}`, { method: "PATCH", headers, body })).status, 409);

  const rejected = await routeApp(runtimeSettings, service({
    async patchSkill() {
      throw new TeamSkillGovernanceServiceError(400, "team_skill_edit_injection_phrasing", "含注入");
    }
  }));
  assert.equal((await rejected.request(`/api/team-skills/manage/${skillId}`, { method: "PATCH", headers, body })).status, 400);
});

test("POST deactivate forwards an optional reason and returns the receipt", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = await routeApp(runtimeSettings, service({
    async deactivateSkill(input) {
      seen.push(input.reason);
      return { deprecated: true };
    }
  }));
  const headers = { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" };

  const withReason = await app.request(`/api/team-skills/manage/${skillId}/deactivate`, { method: "POST", headers, body: JSON.stringify({ reason: "口径已过时" }) });
  assert.equal(withReason.status, 200);
  assert.deepEqual(await withReason.json(), { ok: true, data: { deprecated: true } });

  await app.request(`/api/team-skills/manage/${skillId}/deactivate`, { method: "POST", headers, body: "{}" });
  assert.deepEqual(seen, ["口径已过时", undefined]);
});

// R23 SA-06：手动触发一轮「AI 自学团队技能」。鉴权/防抖/未启用全在服务层，这里钉的是路由这一层：
// 认证之后照直转发、成功回 202（这一轮在后台跑，不是同步跑完的 200），服务层的错误码原样透出。
test("R23 SA-06 POST curate-now forwards the actor and answers 202 while the round runs in the background", async () => {
  const runtimeSettings = settings();
  const seen: string[] = [];
  const app = await routeApp(runtimeSettings, service({
    async curateNow(input) {
      seen.push(input.actor.userId ?? "");
      return { started: true, curation: { enabled: true, running: true, last_run_at: "2026-07-13T02:00:00.000Z" } };
    }
  }));
  const res = await app.request("/api/team-skills/curate-now", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), {
    ok: true,
    data: { started: true, curation: { enabled: true, running: true, last_run_at: "2026-07-13T02:00:00.000Z" } }
  });
  assert.deepEqual(seen, [userId]);
});

test("R23 SA-06 curate-now surfaces the service's refusal codes verbatim (admin gate / debounce / not enabled)", async () => {
  const runtimeSettings = settings();
  const headers = { Cookie: await cookie(runtimeSettings) };
  const cases: Array<[TeamSkillGovernanceServiceError, number, string]> = [
    [new TeamSkillGovernanceServiceError(403, "team_skill_admin_required", "仅管理员"), 403, "team_skill_admin_required"],
    [new TeamSkillGovernanceServiceError(409, "team_skill_curation_in_progress", "正在进行"), 409, "team_skill_curation_in_progress"],
    [new TeamSkillGovernanceServiceError(409, "team_skill_curation_disabled", "已关闭"), 409, "team_skill_curation_disabled"],
    [new TeamSkillGovernanceServiceError(503, "ai_provider_not_configured", "没配密钥"), 503, "ai_provider_not_configured"]
  ];
  for (const [error, status, code] of cases) {
    const app = await routeApp(runtimeSettings, service({
      async curateNow() {
        throw error;
      }
    }));
    const res = await app.request("/api/team-skills/curate-now", { method: "POST", headers });
    assert.equal(res.status, status);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, code);
  }
});
