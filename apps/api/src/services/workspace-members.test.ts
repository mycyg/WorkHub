import assert from "node:assert/strict";
import test from "node:test";

import type { MembershipRole, WorkspaceMembershipRepository, WorkspaceMembershipRow } from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import {
  WorkspaceMemberServiceError,
  createWorkspaceMemberService
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
    resolveDefaultWorkspace: notNeeded("resolveDefaultWorkspace") as never,
    resolveDefaultTenant: notNeeded("resolveDefaultTenant") as never,
    create: notNeeded("create") as never,
    async findActiveForUserWorkspace(userId, ws) {
      return store.find((row) => row.userId === userId && row.workspaceId === ws && row.deletedAt === null) ?? null;
    },
    async listActiveByWorkspace(ws) {
      return store.filter((row) => row.workspaceId === ws && row.deletedAt === null);
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
