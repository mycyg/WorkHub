import assert from "node:assert/strict";
import test from "node:test";

import type { UserProfileRepository, UserProfileRow } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";

const now = new Date("2026-07-13T10:00:00.000Z");
const userId = "16000000-0000-4000-8000-000000000001";
const workspaceId = "16000000-0000-4000-8000-000000000002";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    label: "张三",
    userId,
    isAdmin: false,
    orgId: "16000000-0000-4000-8000-000000000003",
    workspaceId,
    ...overrides
  };
}

function profileRow(overrides: Partial<UserProfileRow> = {}): UserProfileRow {
  return {
    id: "16000000-0000-4000-8000-000000000004",
    userId,
    bioMd: "做过三个交付项目",
    skillsText: null,
    skillTags: ["react", "typescript"],
    availabilityPref: {},
    onboardedAt: null,
    title: "前端负责人",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

type RepositoryOptions = {
  findByUserId?: UserProfileRepository["findByUserId"];
  upsert?: UserProfileRepository["upsert"];
};

function repository(options: RepositoryOptions = {}) {
  const finds: unknown[] = [];
  const writes: unknown[] = [];
  const repo: UserProfileRepository = {
    async findByUserId(id) {
      finds.push(id);
      if (options.findByUserId) {
        return options.findByUserId(id);
      }
      return null;
    },
    async upsert(input) {
      writes.push(input);
      if (options.upsert) {
        return options.upsert(input);
      }
      return profileRow({
        title: input.patch.title !== undefined ? input.patch.title : profileRow().title,
        bioMd: input.patch.bioMd !== undefined ? input.patch.bioMd : profileRow().bioMd,
        skillTags: input.patch.skillTags !== undefined ? [...input.patch.skillTags] : profileRow().skillTags,
        updatedAt: input.at ?? now
      });
    },
    async listCandidatesForProject() {
      return [];
    }
  };
  return { repo, finds, writes };
}

async function serviceModule() {
  const module = await import("./services/user-profile.js").catch(() => null);
  assert.ok(module, "missing user-profile service module");
  assert.equal(typeof module.createUserProfileService, "function", "missing createUserProfileService export");
  return module;
}

test("GET /me/profile returns nickname from the actor and honest nulls for a never-onboarded user", async () => {
  const module = await serviceModule();
  const db = repository({ findByUserId: async () => null });
  const service = module.createUserProfileService({ repository: db.repo, now: () => now });

  const result = await service.getMyProfile({ actor: actor() });

  assert.deepEqual(result, {
    user_id: userId,
    nickname: "张三",
    title: null,
    bio_md: null,
    skill_tags: [],
    onboarded_at: null
  });
  assert.deepEqual(db.finds, [userId]);
});

test("GET /me/profile maps a stored profile row", async () => {
  const module = await serviceModule();
  const db = repository({ findByUserId: async () => profileRow() });
  const service = module.createUserProfileService({ repository: db.repo, now: () => now });

  const result = await service.getMyProfile({ actor: actor() });

  assert.equal(result.title, "前端负责人");
  assert.equal(result.bio_md, "做过三个交付项目");
  assert.deepEqual(result.skill_tags, ["react", "typescript"]);
});

test("PATCH /me/profile forwards only the fields present in the payload", async () => {
  const module = await serviceModule();
  const db = repository();
  const service = module.createUserProfileService({ repository: db.repo, now: () => now });

  await service.patchMyProfile({ actor: actor(), payload: { title: "后端负责人" } });

  assert.equal(db.writes.length, 1);
  const write = db.writes[0] as Parameters<UserProfileRepository["upsert"]>[0];
  assert.deepEqual(write, { userId, patch: { title: "后端负责人" }, at: now });
});

test("PATCH /me/profile allows explicitly clearing title/bio_md via null", async () => {
  const module = await serviceModule();
  const db = repository();
  const service = module.createUserProfileService({ repository: db.repo, now: () => now });

  await service.patchMyProfile({ actor: actor(), payload: { title: null, bio_md: null } });

  const write = db.writes[0] as Parameters<UserProfileRepository["upsert"]>[0];
  assert.deepEqual(write.patch, { title: null, bioMd: null });
});

test("profile access requires a human actor with a userId; other actors are rejected before touching the repository", async () => {
  const module = await serviceModule();
  const db = repository();
  const service = module.createUserProfileService({ repository: db.repo, now: () => now });
  const { userId: _humanUserId, ...actorWithoutUserId } = actor();

  for (const invalidActor of [
    { ...actorWithoutUserId, kind: "system" as const },
    actor({ userId: "   " })
  ]) {
    await assert.rejects(
      service.getMyProfile({ actor: invalidActor }),
      (error: unknown) => error instanceof module.UserProfileServiceError
        && error.status === 403
        && error.code === "user_profile_access_denied"
    );
    await assert.rejects(
      service.patchMyProfile({ actor: invalidActor, payload: { title: "x" } }),
      (error: unknown) => error instanceof module.UserProfileServiceError && error.status === 403
    );
  }
  assert.deepEqual(db.finds, []);
  assert.deepEqual(db.writes, []);
});

test("a malformed written-row response surfaces as InternalContractError instead of a fabricated success", async () => {
  const module = await serviceModule();
  const db = repository({ upsert: async () => profileRow({ title: "x".repeat(200) }) });
  const service = module.createUserProfileService({ repository: db.repo, now: () => now });

  await assert.rejects(
    service.patchMyProfile({ actor: actor(), payload: { title: "y" } }),
    (error: unknown) => error instanceof InternalContractError
  );
});

test("repository failures on read/write propagate unmodified", async () => {
  const module = await serviceModule();
  const sentinel = new Error("profile database unavailable");
  const failing = repository({ findByUserId: async () => { throw sentinel; } });
  const service = module.createUserProfileService({ repository: failing.repo, now: () => now });

  await assert.rejects(service.getMyProfile({ actor: actor() }), (error: unknown) => error === sentinel);
});
