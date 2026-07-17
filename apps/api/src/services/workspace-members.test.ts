import assert from "node:assert/strict";
import test from "node:test";

import type { MembershipRole, WorkspaceMembershipRepository, WorkspaceMembershipRow } from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import {
  WorkspaceMemberServiceError,
  createWorkspaceMemberService,
  type WorkspaceMemberMutationRepos,
  type WorkspaceMemberMutationTx
} from "./workspace-members.js";

const now = new Date("2026-07-16T09:00:00.000Z");
const workspaceId = "70000000-0000-4000-8000-000000000001";
const adminUserId = "70000000-0000-4000-8000-0000000000a1";
const ownerUserId = "70000000-0000-4000-8000-0000000000a2";
const memberUserId = "70000000-0000-4000-8000-0000000000b1";
const secondMemberUserId = "70000000-0000-4000-8000-0000000000b2";

function membershipRow(overrides: Partial<WorkspaceMembershipRow> & { userId: string; role: MembershipRole }): WorkspaceMembershipRow {
  return {
    id: `71000000-0000-4000-8000-${overrides.userId.slice(-12)}`,
    workspaceId,
    defaultWorkspace: true,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

// 极简内存花名册——支持权限矩阵所需的四个读写方法。
function memberships(rows: WorkspaceMembershipRow[]): WorkspaceMembershipRepository {
  const store = rows.map((row) => ({ ...row }));
  const notNeeded = (name: string) => async () => {
    throw new Error(`${name} not expected`);
  };
  return {
    listForUser: notNeeded("listForUser") as never,
    findSoftDeletedForUserWorkspace: notNeeded("findSoftDeletedForUserWorkspace") as never,
    resolveDefaultWorkspace: notNeeded("resolveDefaultWorkspace") as never,
    resolveDefaultTenant: notNeeded("resolveDefaultTenant") as never,
    create: notNeeded("create") as never,
    async findActiveForUserWorkspace(userId, ws) {
      return store.find((row) => row.userId === userId && row.workspaceId === ws && row.deletedAt === null) ?? null;
    },
    async listActiveByWorkspace(ws) {
      return store.filter((row) => row.workspaceId === ws && row.deletedAt === null);
    },
    async listActiveWithNicknameByWorkspace(ws) {
      return store
        .filter((row) => row.workspaceId === ws && row.deletedAt === null)
        .map((row) => ({
          userId: row.userId,
          nickname: `user-${row.userId.slice(-4)}`,
          role: row.role,
          joinedAt: row.createdAt
        }));
    },
    async softDelete(id, at) {
      const row = store.find((candidate) => candidate.id === id && candidate.deletedAt === null);
      if (!row) {
        return null;
      }
      row.deletedAt = at;
      row.updatedAt = at;
      return row;
    },
    async updateRole(id, role, at) {
      const row = store.find((candidate) => candidate.id === id && candidate.deletedAt === null);
      if (!row) {
        return null;
      }
      row.role = role;
      row.updatedAt = at;
      return row;
    }
  } as WorkspaceMembershipRepository;
}

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: adminUserId,
    label: "admin",
    userId: adminUserId,
    isAdmin: true,
    orgId: "70000000-0000-4000-8000-0000000000ff",
    workspaceId,
    ...overrides
  };
}

test("removeMember lets a user-level admin soft-delete a plain member", async () => {
  const repo = memberships([
    membershipRow({ userId: adminUserId, role: "admin" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  const result = await service.removeMember({ actor: actor(), targetUserId: memberUserId });

  assert.deepEqual(result, { removed_user_id: memberUserId });
  assert.equal(await repo.findActiveForUserWorkspace(memberUserId, workspaceId), null);
});

test("removeMember lets a workspace owner (role, not user-admin) remove a member", async () => {
  const repo = memberships([
    membershipRow({ userId: ownerUserId, role: "owner" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  const result = await service.removeMember({
    actor: actor({ id: ownerUserId, userId: ownerUserId, isAdmin: false }),
    targetUserId: memberUserId
  });

  assert.deepEqual(result, { removed_user_id: memberUserId });
});

test("removeMember refuses a plain member (403) and never writes", async () => {
  const repo = memberships([
    membershipRow({ userId: memberUserId, role: "member" }),
    membershipRow({ userId: secondMemberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () =>
      service.removeMember({
        actor: actor({ id: memberUserId, userId: memberUserId, isAdmin: false }),
        targetUserId: secondMemberUserId
      }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 403 && error.code === "member_manage_forbidden"
  );
  assert.notEqual(await repo.findActiveForUserWorkspace(secondMemberUserId, workspaceId), null);
});

test("removeMember refuses a non-member actor with 403", async () => {
  const repo = memberships([membershipRow({ userId: memberUserId, role: "member" })]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () => service.removeMember({ actor: actor(), targetUserId: memberUserId }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 403 && error.code === "member_manage_forbidden"
  );
});

test("removeMember refuses removing yourself with 409", async () => {
  const repo = memberships([membershipRow({ userId: adminUserId, role: "admin" })]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () => service.removeMember({ actor: actor(), targetUserId: adminUserId }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 409 && error.code === "member_manage_self"
  );
});

test("removeMember 404s a target that is not an active member", async () => {
  const repo = memberships([membershipRow({ userId: adminUserId, role: "admin" })]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () => service.removeMember({ actor: actor(), targetUserId: memberUserId }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 404 && error.code === "member_not_found"
  );
});

test("removeMember refuses removing the last admin/owner with 409", async () => {
  // Acting manager qualifies via user-level isAdmin (membership role only "member"), so the sole owner is the
  // only privileged membership — removing them would orphan the workspace of managers → 409.
  const repo = memberships([
    membershipRow({ userId: adminUserId, role: "member" }),
    membershipRow({ userId: ownerUserId, role: "owner" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () => service.removeMember({ actor: actor(), targetUserId: ownerUserId }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 409 && error.code === "member_last_admin"
  );
  assert.notEqual(await repo.findActiveForUserWorkspace(ownerUserId, workspaceId), null);
});

test("updateMemberRole lets an admin promote a member to admin", async () => {
  const repo = memberships([
    membershipRow({ userId: adminUserId, role: "admin" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  const result = await service.updateMemberRole({ actor: actor(), targetUserId: memberUserId, role: "admin" });

  assert.deepEqual(result, { user_id: memberUserId, role: "admin" });
  const updated = await repo.findActiveForUserWorkspace(memberUserId, workspaceId);
  assert.equal(updated?.role, "admin");
});

test("updateMemberRole refuses demoting the last admin/owner with 409", async () => {
  const repo = memberships([
    membershipRow({ userId: ownerUserId, role: "owner" }),
    membershipRow({ userId: adminUserId, role: "admin" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });
  // Demote admin while an owner remains → allowed (still privileged left).
  await assert.doesNotReject(() => service.updateMemberRole({ actor: actor({ id: ownerUserId, userId: ownerUserId, isAdmin: false }), targetUserId: adminUserId, role: "member" }));

  // Now only the owner is privileged; a user-admin manager (membership role "member") demoting them is blocked.
  const soleRepo = memberships([
    membershipRow({ userId: adminUserId, role: "member" }),
    membershipRow({ userId: ownerUserId, role: "owner" })
  ]);
  const soleService = createWorkspaceMemberService({ memberships: soleRepo, now: () => now });
  await assert.rejects(
    () =>
      soleService.updateMemberRole({
        actor: actor({ isAdmin: true }),
        targetUserId: ownerUserId,
        role: "member"
      }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 409 && error.code === "member_last_admin"
  );
});

test("updateMemberRole refuses changing your own role with 409", async () => {
  const repo = memberships([membershipRow({ userId: adminUserId, role: "admin" })]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () => service.updateMemberRole({ actor: actor(), targetUserId: adminUserId, role: "member" }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 409 && error.code === "member_manage_self"
  );
});

test("listMembers returns the roster with roles, join times, and is_self, gated to managers", async () => {
  const repo = memberships([
    membershipRow({ userId: adminUserId, role: "admin" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  const result = await service.listMembers({ actor: actor() });

  assert.equal(result.members.length, 2);
  const self = result.members.find((m) => m.user_id === adminUserId);
  const other = result.members.find((m) => m.user_id === memberUserId);
  assert.equal(self?.is_self, true);
  assert.equal(self?.role, "admin");
  assert.equal(self?.joined_at, now.toISOString());
  assert.equal(other?.is_self, false);
  assert.equal(other?.role, "member");
});

test("listMembers rejects a non-manager with 403", async () => {
  const repo = memberships([
    membershipRow({ userId: adminUserId, role: "owner" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await assert.rejects(
    () => service.listMembers({ actor: actor({ id: memberUserId, userId: memberUserId, isAdmin: false }) }),
    (error: unknown) =>
      error instanceof WorkspaceMemberServiceError && error.status === 403 && error.code === "member_manage_forbidden"
  );
});

// ——— SEC-1（P1-09 · 最后管理员 TOCTOU）：并发移出的锁语义 ———
// 并发复现窗口：authz 门（findActive）瞬时（锁外先跑完），而计数/软删各带一跳宏任务延迟——两笔并发操作
// 的「计数」都会落在「软删生效」之前的窗口里读到旧值。这正是 TOCTOU：无锁时两笔都判定「还有 2 个管理员」
// 而都放行，把工作区变成零管理员。

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// 共享内存花名册（读瞬时、计数/软删带延迟）。返回底层 store 供断言最终不变量。
function concurrencyStore(rows: WorkspaceMembershipRow[]) {
  const store = rows.map((row) => ({ ...row }));
  const notNeeded = (name: string) => async () => {
    throw new Error(`${name} not expected`);
  };
  const repo = {
    listForUser: notNeeded("listForUser") as never,
    findSoftDeletedForUserWorkspace: notNeeded("findSoftDeletedForUserWorkspace") as never,
    resolveDefaultWorkspace: notNeeded("resolveDefaultWorkspace") as never,
    resolveDefaultTenant: notNeeded("resolveDefaultTenant") as never,
    create: notNeeded("create") as never,
    listActiveWithNicknameByWorkspace: notNeeded("listActiveWithNicknameByWorkspace") as never,
    // authz 门（assertManager）走这条——瞬时，两笔并发都在进入锁体前解析完各自的管理员身份。
    async findActiveForUserWorkspace(userId: string, ws: string) {
      return store.find((row) => row.userId === userId && row.workspaceId === ws && row.deletedAt === null) ?? null;
    },
    // 计数带延迟：拉开与软删之间的窗口，无锁时两笔都读到旧计数。
    async listActiveByWorkspace(ws: string) {
      await tick();
      return store.filter((row) => row.workspaceId === ws && row.deletedAt === null);
    },
    // 软删也带延迟：突变发生在读窗口之后。
    async softDelete(id: string, at: Date) {
      await tick();
      const row = store.find((candidate) => candidate.id === id && candidate.deletedAt === null);
      if (!row) {
        return null;
      }
      row.deletedAt = at;
      row.updatedAt = at;
      return row;
    },
    updateRole: notNeeded("updateRole") as never
  } as unknown as WorkspaceMembershipRepository;
  return { store, repo };
}

// 建模 workspace 级 advisory 锁 + 单事务：把每个 run 串行化（严格一次一个跑完再放行下一个），
// tx-bound 仓库即同一共享 store（假事务复用内存态）。
function serializingLock(repo: WorkspaceMemberMutationRepos["memberships"]): WorkspaceMemberMutationTx {
  let tail = Promise.resolve();
  return async (_workspaceId, run) => {
    const prior = tail;
    let release!: () => void;
    tail = new Promise((resolve) => (release = resolve));
    await prior;
    try {
      return await run({ memberships: repo });
    } finally {
      release();
    }
  };
}

function privilegedActiveCount(store: WorkspaceMembershipRow[]): number {
  return store.filter((row) => row.deletedAt === null && (row.role === "admin" || row.role === "owner")).length;
}

test("SEC-1: two admins concurrently removing each other — exactly one succeeds, workspace keeps >=1 admin (advisory-lock)", async () => {
  const { store, repo } = concurrencyStore([
    membershipRow({ userId: adminUserId, role: "owner" }),
    membershipRow({ userId: ownerUserId, role: "owner" })
  ]);
  const service = createWorkspaceMemberService({
    memberships: repo,
    withWorkspaceLock: serializingLock(repo),
    now: () => now
  });

  const results = await Promise.allSettled([
    service.removeMember({
      actor: actor({ id: adminUserId, userId: adminUserId, isAdmin: false }),
      targetUserId: ownerUserId
    }),
    service.removeMember({
      actor: actor({ id: ownerUserId, userId: ownerUserId, isAdmin: false }),
      targetUserId: adminUserId
    })
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one concurrent removal succeeds under the lock");
  assert.equal(rejected.length, 1, "the other is refused");
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(
    reason instanceof WorkspaceMemberServiceError && reason.status === 409 && reason.code === "member_last_admin",
    "the losing removal is refused as last-admin"
  );
  assert.equal(privilegedActiveCount(store), 1, "workspace always retains at least one admin");
});

test("SEC-1: removeMember revokes the removed user's sessions, active device tokens, and presence (P0-01)", async () => {
  const repo = memberships([
    membershipRow({ userId: adminUserId, role: "admin" }),
    membershipRow({ userId: memberUserId, role: "member" })
  ]);
  const devices = [
    { id: "dev-active", userId: memberUserId, revokedAt: null as Date | null },
    { id: "dev-already-revoked", userId: memberUserId, revokedAt: now as Date | null },
    { id: "dev-other-user", userId: adminUserId, revokedAt: null as Date | null }
  ];
  let revokedSessionsFor: string | null = null;
  const revokedDeviceIds: string[] = [];
  let forgottenUser: string | null = null;
  const service = createWorkspaceMemberService({
    memberships: repo,
    sessions: {
      async revokeAllForUser(userId: string) {
        revokedSessionsFor = userId;
        return 1;
      }
    },
    devices: {
      async listByUser(userId: string) {
        return devices.filter((row) => row.userId === userId) as never;
      },
      async revokeByIdForUser(deviceId: string, _userId: string, at: Date) {
        revokedDeviceIds.push(deviceId);
        const row = devices.find((candidate) => candidate.id === deviceId);
        if (row) {
          row.revokedAt = at;
        }
        return row as never;
      }
    },
    presence: {
      async forgetUser(userId: string) {
        forgottenUser = userId;
      }
    },
    now: () => now
  });

  const result = await service.removeMember({ actor: actor(), targetUserId: memberUserId });

  assert.deepEqual(result, { removed_user_id: memberUserId });
  assert.equal(revokedSessionsFor, memberUserId, "all sessions revoked for the removed user");
  assert.deepEqual(revokedDeviceIds, ["dev-active"], "only the removed user's still-active device tokens are revoked");
  assert.equal(forgottenUser, memberUserId, "presence cleared for the removed user");
  assert.equal(await repo.findActiveForUserWorkspace(memberUserId, workspaceId), null, "membership soft-deleted");
});

test("SEC-1: WITHOUT the advisory lock the same race orphans the workspace (proves the lock is load-bearing)", async () => {
  const { store, repo } = concurrencyStore([
    membershipRow({ userId: adminUserId, role: "owner" }),
    membershipRow({ userId: ownerUserId, role: "owner" })
  ]);
  // 不注入 withWorkspaceLock → 无锁顺序写（旧生产路径等价）。
  const service = createWorkspaceMemberService({ memberships: repo, now: () => now });

  await Promise.allSettled([
    service.removeMember({
      actor: actor({ id: adminUserId, userId: adminUserId, isAdmin: false }),
      targetUserId: ownerUserId
    }),
    service.removeMember({
      actor: actor({ id: ownerUserId, userId: ownerUserId, isAdmin: false }),
      targetUserId: adminUserId
    })
  ]);

  assert.equal(
    privilegedActiveCount(store),
    0,
    "no-lock TOCTOU: both removals slip through and orphan the workspace (this is the vulnerability the lock fixes)"
  );
});
