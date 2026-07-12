import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import * as dbExports from "./index.js";
import {
  acceptedDeliverableChanges,
  branches,
  orgs,
  projectDriveItems,
  projectDriveVersions,
  projects,
  proposals,
  taskPlans,
  users,
  workItemAssignments,
  workItems,
  workspaceMemberships,
  workspaces
} from "./schema/index.js";
import * as schema from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  queryTextFragments,
  type RecordedQuery
} from "./test-query-recorder.js";
import type { WorkHubDb } from "./client.js";
import type { WorkbenchMemberPage } from "./repositories/workbench.js";

const workspaceId = "81000000-0000-4000-8000-000000000001";
const projectId = "81000000-0000-4000-8000-000000000002";
const viewerUserId = "81000000-0000-4000-8000-000000000003";
const ownerUserId = "81000000-0000-4000-8000-000000000004";
const driveItemId = "81000000-0000-4000-8000-000000000005";
const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function fixtureId(sequence: number) {
  return `86000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

type WorkbenchRepositoryLike = {
  findWorkbenchAccess(input: {
    workspaceId: string;
    viewerUserId: string;
    projectId: string;
  }): Promise<unknown>;
  listWorkspaceMembers(input: {
    workspaceId: string;
    viewerUserId: string;
    projectOwnerUserId: string | null;
    limit: number;
  }): Promise<unknown>;
  countVisibleActivePlans(input: {
    workspaceId: string;
    projectId: string;
    viewerUserId: string;
    isAdmin: boolean;
  }): Promise<number>;
  listRecentVisibleFiles(input: {
    workspaceId: string;
    projectId: string;
    viewerUserId: string;
    isAdmin: boolean;
    limit: number;
  }): Promise<unknown>;
};

function repository(db: WorkHubDb): WorkbenchRepositoryLike {
  const factory = (dbExports as Record<string, unknown>).createWorkbenchRepository;
  assert.equal(typeof factory, "function", "missing createWorkbenchRepository export");
  return (factory as (database: WorkHubDb) => WorkbenchRepositoryLike)(db);
}

function selectionKeys(query: RecordedQuery | undefined) {
  return Object.keys((query?.selection ?? {}) as Record<string, unknown>).sort();
}

test("R12 workbench access is an active user+membership+workspace+project SQL fence", async () => {
  const row = {
    project: {
      id: projectId,
      workspaceId,
      name: "星尘短剧",
      slug: "stardust",
      description: null,
      ownerNickname: "阿曼",
      ownerUserId
    },
    membershipRole: "member"
  };
  const { db, queries } = createQueryRecorder([[row]]);

  const result = await repository(db).findWorkbenchAccess({ workspaceId, viewerUserId, projectId });

  assert.deepEqual(result, row);
  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workspaces],
    ["inner", workspaceMemberships],
    ["inner", users]
  ]);
  assert.equal(query?.limit, 1);
  for (const column of [
    projects.id,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    workspaces.id,
    workspaces.deletedAt,
    workspaceMemberships.workspaceId,
    workspaceMemberships.userId,
    workspaceMemberships.deletedAt,
    users.id,
    users.deletedAt
  ]) {
    assert.equal(queryReferences(query?.where, column), true, `access query missing ${String(column)}`);
  }
  const params = queryParamValues(query?.where);
  assert.ok(params.includes(workspaceId));
  assert.ok(params.includes(projectId));
  assert.ok(params.includes(viewerUserId));
});

test("R12 workspace-member slice uses one exact window total and keeps self first", async () => {
  const memberRows = Array.from({ length: 100 }, (_, index) => ({
    userId: `81000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
    nickname: `成员 ${index + 1}`,
    membershipRole: index === 1 ? "owner" : "member",
    isProjectOwner: index === 1,
    isSelf: index === 0,
    total: 137
  }));
  memberRows[0] = {
    userId: viewerUserId,
    nickname: "张三",
    membershipRole: "member",
    isProjectOwner: false,
    isSelf: true,
    total: 137
  };
  memberRows[1] = {
    userId: ownerUserId,
    nickname: "阿曼",
    membershipRole: "owner",
    isProjectOwner: true,
    isSelf: false,
    total: 137
  };
  const { db, queries } = createQueryRecorder([memberRows]);

  const result = await repository(db).listWorkspaceMembers({
    workspaceId,
    viewerUserId,
    projectOwnerUserId: ownerUserId,
    limit: 100
  }) as {
    total: number;
    returned: number;
    capped: boolean;
    items: Array<{ userId: string; isSelf: boolean }>;
  };

  assert.equal(result.total, 137);
  assert.equal(result.returned, 100);
  assert.equal(result.capped, true);
  assert.equal(result.items.length, 100);
  assert.equal(result.items[0]?.userId, viewerUserId);
  assert.equal(result.items[0]?.isSelf, true);
  assert.equal(result.items[1]?.userId, ownerUserId);
  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.equal(query?.fromTable, workspaceMemberships);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [["inner", users]]);
  assert.equal(query?.limit, 100, "window-count member page must not pretend limit+1 is an exact total");
  assert.ok(query?.orderBy.length >= 3, "member page needs self/owner/name/id stable ordering");
  assert.deepEqual(selectionKeys(query), [
    "isProjectOwner",
    "isSelf",
    "membershipRole",
    "nickname",
    "total",
    "userId"
  ]);
  assert.match(queryTextFragments(query?.selection).join(" "), /count\s*\(\s*\*\s*\)\s*over/iu);
  assert.match(queryTextFragments(query?.where).join(" "), /exists/iu, "member read needs an active-viewer guard");
  for (const column of [
    workspaceMemberships.workspaceId,
    workspaceMemberships.deletedAt,
    users.deletedAt
  ]) {
    assert.equal(queryReferences(query?.where, column), true, `member query missing ${String(column)}`);
  }
});

test("R12 workbench repository rejects member and recent-file limits before querying", async () => {
  const { db, queries } = createQueryRecorder();
  const repo = repository(db);

  for (const limit of [0, 101]) {
    await assert.rejects(
      repo.listWorkspaceMembers({ workspaceId, viewerUserId, projectOwnerUserId: ownerUserId, limit }),
      { name: "WorkbenchRepositoryInputError" }
    );
  }
  for (const limit of [0, 6]) {
    await assert.rejects(
      repo.listRecentVisibleFiles({ workspaceId, projectId, viewerUserId, isAdmin: false, limit }),
      { name: "WorkbenchRepositoryInputError" }
    );
  }
  assert.equal(queries.length, 0);
});

test("R12 workbench repository fails fast on lossy or malformed aggregate counts", async () => {
  const malformedMember = createQueryRecorder([[
    {
      userId: viewerUserId,
      nickname: "张三",
      membershipRole: "member",
      isProjectOwner: false,
      isSelf: true,
      total: "9007199254740992"
    }
  ]]);
  await assert.rejects(
    repository(malformedMember.db).listWorkspaceMembers({
      workspaceId,
      viewerUserId,
      projectOwnerUserId: ownerUserId,
      limit: 100
    }),
    { name: "WorkbenchRepositoryInvariantError" }
  );

  const malformedPlanCount = createQueryRecorder([[{ value: "4.5" }]]);
  await assert.rejects(
    repository(malformedPlanCount.db).countVisibleActivePlans({
      workspaceId,
      projectId,
      viewerUserId,
      isAdmin: false
    }),
    { name: "WorkbenchRepositoryInvariantError" }
  );
});

test("R12 project army count reuses the active-plan SSOT and applies visibility with EXISTS", async () => {
  assert.deepEqual((dbExports as Record<string, unknown>).DASHBOARD_PLAN_STATUSES, [
    "proposed",
    "approved",
    "dispatching",
    "paused"
  ]);
  const { db, queries } = createQueryRecorder([[{ value: "4" }]]);

  const count = await repository(db).countVisibleActivePlans({
    workspaceId,
    projectId,
    viewerUserId,
    isAdmin: false
  });

  assert.equal(count, 4);
  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.equal(query?.fromTable, taskPlans);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", workItems],
    ["inner", projects],
    ["inner", workspaces]
  ]);
  assert.equal(query?.joins.some((join) => join.table === workItemAssignments), false, "assignments must not multiply plan rows");
  for (const column of [
    taskPlans.workspaceId,
    taskPlans.status,
    workItems.workspaceId,
    workItems.projectId,
    workItems.deletedAt,
    workItems.status,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    workspaces.deletedAt
  ]) {
    assert.equal(queryReferences(query?.where, column), true, `army count missing ${String(column)}`);
  }
  const params = queryParamValues(query?.where);
  for (const value of [workspaceId, projectId, viewerUserId, "proposed", "approved", "dispatching", "paused"]) {
    assert.ok(params.includes(value), `army count missing predicate value ${value}`);
  }
  assert.match(queryTextFragments(query?.where).join(" "), /exists/iu);
});

test("R12 recent visible files are filtered in SQL with safe projection and no scan cap", async () => {
  const updatedAt = new Date("2026-07-12T08:30:00.000Z");
  const { db, queries } = createQueryRecorder([[
    { id: driveItemId, name: "brief.docx", updatedAt }
  ]]);

  const rows = await repository(db).listRecentVisibleFiles({
    workspaceId,
    projectId,
    viewerUserId,
    isAdmin: false,
    limit: 5
  });

  assert.deepEqual(rows, [{ id: driveItemId, name: "brief.docx", updatedAt }]);
  assert.equal(queries.length, 1);
  const query = queries[0];
  assert.equal(query?.fromTable, projectDriveItems);
  assert.deepEqual(selectionKeys(query), ["id", "name", "updatedAt"]);
  assert.equal(query?.limit, 5);
  assert.equal(query?.orderBy.length, 2);
  assert.deepEqual(query?.joins.map((join) => [join.kind, join.table]), [
    ["inner", projectDriveVersions],
    ["inner", projects],
    ["inner", workspaces]
  ]);
  const currentVersionJoin = query?.joins[0];
  assert.equal(currentVersionJoin?.kind, "inner");
  assert.equal(currentVersionJoin?.table, projectDriveVersions);
  for (const column of [
    projectDriveVersions.id,
    projectDriveVersions.itemId,
    projectDriveItems.currentVersionId,
    projectDriveItems.id
  ]) {
    assert.equal(
      queryReferences(currentVersionJoin?.on, column),
      true,
      `recent-file current-version join missing ${String(column)}`
    );
  }
  for (const column of [
    projectDriveItems.projectId,
    projectDriveItems.kind,
    projectDriveItems.currentVersionId,
    projectDriveItems.deletedAt,
    projects.workspaceId,
    projects.archived,
    projects.deletedAt,
    workspaces.deletedAt,
    acceptedDeliverableChanges.driveItemId,
    acceptedDeliverableChanges.driveVersionId,
    acceptedDeliverableChanges.supersededAt,
    workItems.id,
    workItems.workspaceId,
    workItems.projectId,
    workItems.deletedAt,
    workItems.status,
    workItemAssignments.workItemId,
    workItemAssignments.userId
  ]) {
    assert.equal(queryReferences(query?.where, column), true, `recent-file query missing ${String(column)}`);
  }
  const whereText = queryTextFragments(query?.where).join(" ");
  assert.match(whereText, /not\s+exists/iu);
  assert.match(whereText, /exists/iu);
  const params = queryParamValues(query?.where);
  for (const value of [workspaceId, projectId, viewerUserId, "file"]) {
    assert.ok(params.includes(value), `recent-file query missing predicate value ${value}`);
  }
});

test("R12 workbench repository real PostgreSQL matrix", {
  skip: process.env.WORKHUB_R12_WORKBENCH_REAL_PG !== "1",
  timeout: 120_000
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the opt-in R12 workbench PostgreSQL matrix");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.match(
    databaseName,
    /^workhub_r12_0c4_[a-z0-9_]+$/u,
    "real-PG matrix refuses to write unless DATABASE_URL points at a dedicated workhub_r12_0c4_* scratch database"
  );

  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 10_000 });
  const db = drizzle(pool, { schema });
  try {
    await migrate(db, { migrationsFolder });

    const orgId = fixtureId(1);
    const realWorkspaceId = fixtureId(2);
    const realProjectId = fixtureId(3);
    const activeUserIds = Array.from({ length: 137 }, (_, index) => fixtureId(1_000 + index));
    const realViewerUserId = activeUserIds[0]!;
    const realOwnerUserId = activeUserIds[1]!;
    const inactiveMembershipUserId = fixtureId(1_150);
    const deletedUserId = fixtureId(1_151);
    const fixtureAt = new Date("2026-07-12T00:00:00.000Z");

    await db.insert(orgs).values({ id: orgId, name: "R12 PG Org", slug: "r12-pg-org", plan: "lan" });
    await db.insert(workspaces).values({
      id: realWorkspaceId,
      orgId,
      name: "R12 PG Workspace",
      slug: "r12-pg-workspace"
    });
    await db.insert(users).values([
      ...activeUserIds.map((id, index) => ({
        id,
        nickname: index === 0 ? "ZZ Viewer" : index === 1 ? "AA Owner" : `Member ${String(index).padStart(3, "0")}`,
        cookieToken: `r12-pg-active-${index}`,
        isAdmin: false
      })),
      {
        id: inactiveMembershipUserId,
        nickname: "Inactive Membership",
        cookieToken: "r12-pg-inactive-membership",
        isAdmin: false
      },
      {
        id: deletedUserId,
        nickname: "Deleted User",
        cookieToken: "r12-pg-deleted-user",
        isAdmin: false,
        deletedAt: fixtureAt
      }
    ]);
    await db.insert(workspaceMemberships).values([
      ...activeUserIds.map((userId, index) => ({
        id: fixtureId(2_000 + index),
        workspaceId: realWorkspaceId,
        userId,
        role: index === 1 ? "owner" : "member",
        defaultWorkspace: index === 0
      })),
      {
        id: fixtureId(2_150),
        workspaceId: realWorkspaceId,
        userId: inactiveMembershipUserId,
        role: "member",
        deletedAt: fixtureAt
      },
      {
        id: fixtureId(2_151),
        workspaceId: realWorkspaceId,
        userId: deletedUserId,
        role: "member"
      }
    ]);
    await db.insert(projects).values({
      id: realProjectId,
      workspaceId: realWorkspaceId,
      name: "R12 PostgreSQL Workbench",
      slug: "r12-pg-workbench",
      description: "Fresh PostgreSQL truth probe",
      ownerNickname: "AA Owner",
      ownerUserId: realOwnerUserId
    });

    const workItemIds = {
      public: fixtureId(3_001),
      submitter: fixtureId(3_002),
      claimant: fixtureId(3_003),
      assigned: fixtureId(3_004),
      stranger: fixtureId(3_005)
    };
    const workItemFixtures: Array<typeof workItems.$inferInsert> = [
      {
        id: workItemIds.public,
        code: "R12-PG-PUBLIC",
        projectId: realProjectId,
        workspaceId: realWorkspaceId,
        submitterUserId: realOwnerUserId,
        title: "Public plan source",
        status: "ai_working"
      },
      {
        id: workItemIds.submitter,
        code: "R12-PG-SUBMITTER",
        projectId: realProjectId,
        workspaceId: realWorkspaceId,
        submitterUserId: realViewerUserId,
        title: "Private submitter source",
        status: "intake"
      },
      {
        id: workItemIds.claimant,
        code: "R12-PG-CLAIMANT",
        projectId: realProjectId,
        workspaceId: realWorkspaceId,
        submitterUserId: realOwnerUserId,
        claimedByUserId: realViewerUserId,
        title: "Private claimant source",
        status: "ai_clarifying"
      },
      {
        id: workItemIds.assigned,
        code: "R12-PG-ASSIGNED",
        projectId: realProjectId,
        workspaceId: realWorkspaceId,
        submitterUserId: realOwnerUserId,
        title: "Private assignment source",
        status: "spec_ready"
      },
      {
        id: workItemIds.stranger,
        code: "R12-PG-STRANGER",
        projectId: realProjectId,
        workspaceId: realWorkspaceId,
        submitterUserId: realOwnerUserId,
        title: "Private stranger source",
        status: "intake"
      }
    ];
    await db.insert(workItems).values(workItemFixtures);
    await db.insert(workItemAssignments).values([
      {
        id: fixtureId(3_101),
        workItemId: workItemIds.assigned,
        userId: realViewerUserId,
        role: "assignee",
        assignedByUserId: realOwnerUserId
      },
      {
        id: fixtureId(3_102),
        workItemId: workItemIds.assigned,
        userId: activeUserIds[2]!,
        role: "reviewer",
        assignedByUserId: realOwnerUserId
      }
    ]);

    const planFixtures: Array<typeof taskPlans.$inferInsert> = [
      ...(["proposed", "approved", "dispatching", "paused", "draft", "done", "cancelled"] as const)
        .map((status, index) => ({
          id: fixtureId(4_000 + index),
          workItemId: workItemIds.public,
          workspaceId: realWorkspaceId,
          status,
          createdByUserId: realViewerUserId
        })),
      {
        id: fixtureId(4_100),
        workItemId: workItemIds.submitter,
        workspaceId: realWorkspaceId,
        status: "proposed",
        createdByUserId: realViewerUserId
      },
      {
        id: fixtureId(4_101),
        workItemId: workItemIds.claimant,
        workspaceId: realWorkspaceId,
        status: "approved",
        createdByUserId: realViewerUserId
      },
      {
        id: fixtureId(4_102),
        workItemId: workItemIds.assigned,
        workspaceId: realWorkspaceId,
        status: "paused",
        createdByUserId: realViewerUserId
      },
      {
        id: fixtureId(4_103),
        workItemId: workItemIds.stranger,
        workspaceId: realWorkspaceId,
        status: "dispatching",
        createdByUserId: realViewerUserId
      }
    ];
    await db.insert(taskPlans).values(planFixtures);

    const fileFixtures = [
      { key: "no-link", itemId: fixtureId(5_001), currentVersionId: fixtureId(5_101), updatedAt: "2026-07-12T10:06:00.000Z" },
      { key: "readable", itemId: fixtureId(5_002), currentVersionId: fixtureId(5_102), updatedAt: "2026-07-12T10:05:00.000Z" },
      { key: "all-unreadable", itemId: fixtureId(5_003), currentVersionId: fixtureId(5_103), updatedAt: "2026-07-12T10:04:00.000Z" },
      { key: "any-readable", itemId: fixtureId(5_004), currentVersionId: fixtureId(5_104), updatedAt: "2026-07-12T10:03:00.000Z" },
      { key: "legacy-null-project", itemId: fixtureId(5_005), currentVersionId: fixtureId(5_105), updatedAt: "2026-07-12T10:02:00.000Z" },
      { key: "old-version-link", itemId: fixtureId(5_006), currentVersionId: fixtureId(5_106), updatedAt: "2026-07-12T10:01:00.000Z" }
    ];
    const brokenFileFixtures = [
      { key: "broken-null-current", itemId: fixtureId(5_007), updatedAt: "2026-07-12T10:08:00.000Z" },
      { key: "broken-cross-item-current", itemId: fixtureId(5_008), updatedAt: "2026-07-12T10:07:00.000Z" }
    ];
    await db.insert(projectDriveItems).values([
      ...fileFixtures.map((file) => ({
        id: file.itemId,
        projectId: realProjectId,
        name: `${file.key}.md`,
        kind: "file" as const,
        createdByUserId: realViewerUserId,
        updatedAt: new Date(file.updatedAt)
      })),
      ...brokenFileFixtures.map((file) => ({
        id: file.itemId,
        projectId: realProjectId,
        name: `${file.key}.md`,
        kind: "file" as const,
        currentVersionId: null,
        createdByUserId: realViewerUserId,
        updatedAt: new Date(file.updatedAt)
      }))
    ]);
    const oldVersionId = fixtureId(5_199);
    await db.insert(projectDriveVersions).values([
      ...fileFixtures.map((file, index) => ({
        id: file.currentVersionId,
        itemId: file.itemId,
        versionNo: file.key === "old-version-link" ? 2 : 1,
        filename: `${file.key}.md`,
        mime: "text/markdown",
        sizeBytes: 100 + index,
        storagePath: `r12-pg/${file.key}.md`,
        createdByUserId: realViewerUserId
      })),
      {
        id: oldVersionId,
        itemId: fileFixtures[5]!.itemId,
        versionNo: 1,
        filename: "old-version-link-v1.md",
        mime: "text/markdown",
        sizeBytes: 99,
        storagePath: "r12-pg/old-version-link-v1.md",
        createdByUserId: realViewerUserId
      }
    ]);
    for (const file of fileFixtures) {
      await db.update(projectDriveItems)
        .set({ currentVersionId: file.currentVersionId })
        .where(eq(projectDriveItems.id, file.itemId));
    }
    await db.update(projectDriveItems)
      .set({ currentVersionId: fileFixtures[0]!.currentVersionId })
      .where(eq(projectDriveItems.id, brokenFileFixtures[1]!.itemId));

    const branchFixtures: Array<typeof branches.$inferInsert> = [
      { id: fixtureId(6_001), workItemId: workItemIds.public, actorKind: "human", actorUserId: realViewerUserId },
      { id: fixtureId(6_002), workItemId: workItemIds.stranger, actorKind: "human", actorUserId: realOwnerUserId },
      { id: fixtureId(6_003), workItemId: workItemIds.assigned, actorKind: "human", actorUserId: realViewerUserId }
    ];
    await db.insert(branches).values(branchFixtures);
    const proposalFixtures: Array<typeof proposals.$inferInsert> = branchFixtures.map((branch, index) => ({
      id: fixtureId(6_101 + index),
      workItemId: branch.workItemId,
      branchId: branch.id,
      round: 1,
      title: `R12 PG proposal ${index + 1}`,
      status: "opened",
      diffManifest: {} as never,
      openedByKind: "human",
      openedByUserId: realViewerUserId
    }));
    await db.insert(proposals).values(proposalFixtures);
    const acceptedFixtures: Array<typeof acceptedDeliverableChanges.$inferInsert> = [
      {
        id: fixtureId(6_201), workItemId: workItemIds.public, projectId: realProjectId,
        proposalId: proposalFixtures[0]!.id, changeId: fixtureId(6_301), targetKind: "binary_doc",
        targetEntityType: "drive_item", targetKey: "drive:r12-readable", changeType: "updated",
        driveItemId: fileFixtures[1]!.itemId, driveVersionId: fileFixtures[1]!.currentVersionId,
        manifestChangeJson: { files: ["readable.md"] } as never
      },
      {
        id: fixtureId(6_202), workItemId: workItemIds.stranger, projectId: realProjectId,
        proposalId: proposalFixtures[1]!.id, changeId: fixtureId(6_302), targetKind: "binary_doc",
        targetEntityType: "drive_item", targetKey: "drive:r12-all-unreadable", changeType: "updated",
        driveItemId: fileFixtures[2]!.itemId, driveVersionId: fileFixtures[2]!.currentVersionId,
        manifestChangeJson: { files: ["all-unreadable.md"] } as never
      },
      {
        id: fixtureId(6_203), workItemId: workItemIds.stranger, projectId: realProjectId,
        proposalId: proposalFixtures[1]!.id, changeId: fixtureId(6_303), targetKind: "binary_doc",
        targetEntityType: "drive_item", targetKey: "drive:r12-any-unreadable", changeType: "updated",
        driveItemId: fileFixtures[3]!.itemId, driveVersionId: fileFixtures[3]!.currentVersionId,
        manifestChangeJson: { files: ["any-readable.md"] } as never
      },
      {
        id: fixtureId(6_204), workItemId: workItemIds.assigned, projectId: realProjectId,
        proposalId: proposalFixtures[2]!.id, changeId: fixtureId(6_304), targetKind: "binary_doc",
        targetEntityType: "drive_item", targetKey: "drive:r12-any-readable", changeType: "updated",
        driveItemId: fileFixtures[3]!.itemId, driveVersionId: fileFixtures[3]!.currentVersionId,
        manifestChangeJson: { files: ["any-readable.md"] } as never
      },
      {
        id: fixtureId(6_205), workItemId: workItemIds.public, projectId: null,
        proposalId: proposalFixtures[0]!.id, changeId: fixtureId(6_305), targetKind: "binary_doc",
        targetEntityType: "drive_item", targetKey: "drive:r12-legacy", changeType: "updated",
        driveItemId: fileFixtures[4]!.itemId, driveVersionId: fileFixtures[4]!.currentVersionId,
        manifestChangeJson: { files: ["legacy-null-project.md"] } as never
      },
      {
        id: fixtureId(6_206), workItemId: workItemIds.public, projectId: realProjectId,
        proposalId: proposalFixtures[0]!.id, changeId: fixtureId(6_306), targetKind: "binary_doc",
        targetEntityType: "drive_item", targetKey: "drive:r12-old-version", changeType: "updated",
        driveItemId: fileFixtures[5]!.itemId, driveVersionId: oldVersionId,
        manifestChangeJson: { files: ["old-version-link-v1.md"] } as never
      }
    ];
    await db.insert(acceptedDeliverableChanges).values(acceptedFixtures);

    const realRepo = repository(db as WorkHubDb);
    const access = await realRepo.findWorkbenchAccess({
      workspaceId: realWorkspaceId,
      viewerUserId: realViewerUserId,
      projectId: realProjectId
    });
    assert.equal((access as { project?: { id?: string } } | null)?.project?.id, realProjectId);

    const memberPage = await realRepo.listWorkspaceMembers({
      workspaceId: realWorkspaceId,
      viewerUserId: realViewerUserId,
      projectOwnerUserId: realOwnerUserId,
      limit: 100
    }) as WorkbenchMemberPage;
    assert.equal(memberPage.total, 137);
    assert.equal(memberPage.returned, 100);
    assert.equal(memberPage.capped, true);
    assert.equal(memberPage.items.length, 100);
    assert.deepEqual(memberPage.items.slice(0, 2).map((member) => member.userId), [
      realViewerUserId,
      realOwnerUserId
    ]);
    assert.equal(memberPage.items[0]?.isSelf, true);
    assert.equal(memberPage.items[1]?.isProjectOwner, true);
    assert.equal(memberPage.items.some((member) => member.userId === inactiveMembershipUserId), false);
    assert.equal(memberPage.items.some((member) => member.userId === deletedUserId), false);

    assert.equal(await realRepo.countVisibleActivePlans({
      workspaceId: realWorkspaceId,
      projectId: realProjectId,
      viewerUserId: realViewerUserId,
      isAdmin: false
    }), 7, "active-state SSOT/private visibility/multi-assignment count drifted");
    assert.equal(await realRepo.countVisibleActivePlans({
      workspaceId: realWorkspaceId,
      projectId: realProjectId,
      viewerUserId: realViewerUserId,
      isAdmin: true
    }), 8, "admin should see the one private-stranger active plan without counting inactive statuses");

    const recentFiles = await realRepo.listRecentVisibleFiles({
      workspaceId: realWorkspaceId,
      projectId: realProjectId,
      viewerUserId: realViewerUserId,
      isAdmin: false,
      limit: 5
    }) as Array<{ id: string; name: string; updatedAt: Date }>;
    assert.deepEqual(recentFiles.map((file) => file.name), [
      "no-link.md",
      "readable.md",
      "any-readable.md",
      "legacy-null-project.md",
      "old-version-link.md"
    ]);
    assert.equal(recentFiles.some((file) => file.name === "all-unreadable.md"), false);
    assert.equal(recentFiles.some((file) => file.name === "broken-null-current.md"), false);
    assert.equal(recentFiles.some((file) => file.name === "broken-cross-item-current.md"), false);
    assert.deepEqual(Object.keys(recentFiles[0] ?? {}).sort(), ["id", "name", "updatedAt"]);

    await db.update(workspaces).set({ deletedAt: fixtureAt }).where(eq(workspaces.id, realWorkspaceId));
    assert.equal(await realRepo.findWorkbenchAccess({ workspaceId: realWorkspaceId, viewerUserId: realViewerUserId, projectId: realProjectId }), null);
    await db.update(workspaces).set({ deletedAt: null }).where(eq(workspaces.id, realWorkspaceId));
    await db.update(projects).set({ archived: true }).where(eq(projects.id, realProjectId));
    assert.equal(await realRepo.findWorkbenchAccess({ workspaceId: realWorkspaceId, viewerUserId: realViewerUserId, projectId: realProjectId }), null);
    await db.update(projects).set({ archived: false, deletedAt: fixtureAt }).where(eq(projects.id, realProjectId));
    assert.equal(await realRepo.findWorkbenchAccess({ workspaceId: realWorkspaceId, viewerUserId: realViewerUserId, projectId: realProjectId }), null);
    await db.update(projects).set({ deletedAt: null }).where(eq(projects.id, realProjectId));
    await db.update(workspaceMemberships)
      .set({ deletedAt: fixtureAt })
      .where(and(
        eq(workspaceMemberships.workspaceId, realWorkspaceId),
        eq(workspaceMemberships.userId, realViewerUserId)
      ));
    assert.equal(await realRepo.findWorkbenchAccess({ workspaceId: realWorkspaceId, viewerUserId: realViewerUserId, projectId: realProjectId }), null);
  } finally {
    await pool.end();
  }
});
