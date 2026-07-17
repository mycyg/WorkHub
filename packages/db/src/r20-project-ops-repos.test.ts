import assert from "node:assert/strict";
import test from "node:test";

import { createProjectRepository } from "./repositories/projects.js";
import { createWorkItemAssignmentRepository } from "./repositories/work-item-assignments.js";
import { createCommentRepository, COMMENTS_FOR_WORK_ITEM_LIMIT } from "./repositories/comments.js";
import {
  createWorkspaceAuditLogRepository,
  WORKSPACE_AUDIT_LOGS_MAX_LIMIT
} from "./repositories/audit.js";
import { auditLogs, comments, projects, workItemAssignments } from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences
} from "./test-query-recorder.js";

const at = new Date("2026-07-15T00:00:00.000Z");

// R20 P2A（R19-19 项目归档）：archiveProject 只写 archived=true 且 CAS 只命中活跃/未删行。
test("archiveProject soft-sets archived under an active-project CAS guard", async () => {
  const row = { id: "proj-1", archived: true } as unknown;
  const { db, queries } = createQueryRecorder([[row]]);
  const repo = createProjectRepository(db);

  const result = await repo.archiveProject({ projectId: "proj-1", now: at });

  assert.equal(result, row);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, projects);
  assert.equal(query?.returningCalled, true);
  // CAS：WHERE 引用 archived + deletedAt（只命中未归档、未软删的行）。
  assert.ok(queryReferences(query?.where, projects.id));
  assert.ok(queryReferences(query?.where, projects.archived));
  assert.ok(queryReferences(query?.where, projects.deletedAt));
  assert.ok(queryParamValues(query?.where).includes("proj-1"));
});

test("archiveProject returns null when the CAS guard matches no active row", async () => {
  const { db } = createQueryRecorder([[]]);
  const repo = createProjectRepository(db);
  assert.equal(await repo.archiveProject({ projectId: "proj-x", now: at }), null);
});

// R20 P2A（R19-19 软删）：softDeleteProject 写 deletedAt + deletedByNickname，CAS 只命中未软删的行。
test("softDeleteProject tombstones under a not-deleted CAS guard and records the deleter", async () => {
  const row = { id: "proj-1", deletedAt: at } as unknown;
  const { db, queries } = createQueryRecorder([[row]]);
  const repo = createProjectRepository(db);

  const result = await repo.softDeleteProject({ projectId: "proj-1", deletedByNickname: "admin", now: at });

  assert.equal(result, row);
  const [query] = queries;
  assert.equal(query?.operation, "update");
  assert.equal(query?.targetTable, projects);
  assert.ok(queryReferences(query?.where, projects.deletedAt));
  assert.ok(queryParamValues(query?.where).includes("proj-1"));
});

// R20 P2A（R19-18 指派）：assignWorkItem upsert，onConflict 目标是 (workItemId, userId) 唯一索引。
test("assignWorkItem upserts on the (work_item, user) unique index", async () => {
  const row = {
    id: "assign-1",
    workItemId: "wi-1",
    userId: "u-2",
    role: "collaborator",
    assignedByUserId: "u-1"
  } as unknown;
  const { db, queries } = createQueryRecorder([[row]]);
  const repo = createWorkItemAssignmentRepository(db);

  const result = await repo.assignWorkItem({
    workItemId: "wi-1",
    userId: "u-2",
    role: "collaborator",
    assignedByUserId: "u-1",
    at
  });

  assert.equal(result, row);
  const [query] = queries;
  assert.equal(query?.operation, "insert");
  assert.equal(query?.targetTable, workItemAssignments);
  assert.equal(query?.returningCalled, true);
  const conflict = query?.onConflict as { target?: unknown[]; set?: Record<string, unknown> } | undefined;
  assert.deepEqual(conflict?.target, [workItemAssignments.workItemId, workItemAssignments.userId]);
  assert.ok(conflict?.set && "role" in conflict.set);
});

// R20 P2A（R19-22 评论）：读按 createdAt 升序 + 上限；写 INSERT ... RETURNING。
test("listCommentsForWorkItem reads the thread ascending with a bounded default limit", async () => {
  const rows = [{ id: "c-1" }, { id: "c-2" }] as unknown[];
  const { db, queries } = createQueryRecorder([rows]);
  const repo = createCommentRepository(db);

  const result = await repo.listCommentsForWorkItem("wi-1");

  assert.deepEqual(result, rows);
  const [query] = queries;
  assert.equal(query?.fromTable, comments);
  assert.ok(queryReferences(query?.where, comments.workItemId));
  assert.ok(queryParamValues(query?.where).includes("wi-1"));
  assert.equal(query?.limit, COMMENTS_FOR_WORK_ITEM_LIMIT);
  assert.ok((query?.orderBy.length ?? 0) > 0);
});

test("insertComment writes a comment row and returns it", async () => {
  const row = { id: "c-1", workItemId: "wi-1", authorNickname: "ann", body: "hi" } as unknown;
  const { db, queries } = createQueryRecorder([[row]]);
  const repo = createCommentRepository(db);

  const result = await repo.insertComment({ workItemId: "wi-1", authorNickname: "ann", body: "hi", at });

  assert.equal(result, row);
  const [query] = queries;
  assert.equal(query?.operation, "insert");
  assert.equal(query?.targetTable, comments);
  assert.equal(query?.returningCalled, true);
});

// R20 P2A（R19-21 工作区审计）：按 workspace 过滤 + 可选过滤 + 时间倒序 + 分页（limit/offset）。
test("listAuditLogsForWorkspace filters by workspace, applies filters, and paginates newest-first", async () => {
  const rows = [{ id: "a-1" }] as unknown[];
  const { db, queries } = createQueryRecorder([rows]);
  const repo = createWorkspaceAuditLogRepository(db);

  const from = new Date("2026-07-01T00:00:00.000Z");
  const to = new Date("2026-07-15T00:00:00.000Z");
  const result = await repo.listAuditLogsForWorkspace({
    workspaceId: "ws-1",
    actorUserId: "u-9",
    action: "snapshot.reverted",
    from,
    to,
    limit: 25,
    offset: 50
  });

  assert.deepEqual(result, rows);
  const [query] = queries;
  assert.equal(query?.fromTable, auditLogs);
  assert.ok(queryReferences(query?.where, auditLogs.workspaceId));
  assert.ok(queryReferences(query?.where, auditLogs.actorUserId));
  assert.ok(queryReferences(query?.where, auditLogs.action));
  assert.ok(queryReferences(query?.where, auditLogs.createdAt));
  assert.ok(queryParamValues(query?.where).includes("ws-1"));
  assert.ok(queryParamValues(query?.where).includes("u-9"));
  assert.ok(queryParamValues(query?.where).includes("snapshot.reverted"));
  assert.equal(query?.limit, 25);
  assert.equal(query?.offset, 50);
  assert.ok((query?.orderBy.length ?? 0) > 0);
});

test("listAuditLogsForWorkspace clamps limit to the max and defaults offset to 0", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repo = createWorkspaceAuditLogRepository(db);

  await repo.listAuditLogsForWorkspace({ workspaceId: "ws-1", limit: 999 });

  const [query] = queries;
  assert.equal(query?.limit, WORKSPACE_AUDIT_LOGS_MAX_LIMIT);
  assert.equal(query?.offset, 0);
  // 只按 workspace 过滤时 WHERE 不应引用 actor/action/createdAt。
  assert.ok(!queryReferences(query?.where, auditLogs.actorUserId));
  assert.ok(!queryReferences(query?.where, auditLogs.action));
});
