import assert from "node:assert/strict";
import test from "node:test";

import type { CommentRow, WorkItemAccessRow } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import { WorkItemServiceError } from "./services/work-items.js";
import {
  createWorkItemCommentService,
  type WorkItemCommentServiceDependencies
} from "./services/work-item-comments.js";

const now = new Date("2026-07-15T00:00:00.000Z");
const workspaceId = "00000000-0000-4000-8000-000000000002";
const submitterId = "62000000-0000-4000-8000-000000000001";
const memberId = "62000000-0000-4000-8000-000000000009";
const workItemId = "62000000-0000-4000-8000-0000000000cc";

function actor(overrides: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: memberId,
    label: "member",
    userId: memberId,
    isAdmin: false,
    orgId: "00000000-0000-4000-8000-000000000001",
    workspaceId,
    ...overrides
  };
}

function accessRow(overrides: Partial<WorkItemAccessRow> = {}): WorkItemAccessRow {
  return {
    id: workItemId,
    code: "WI-1",
    title: "任务",
    // 非私有态：同工作区成员可见可评。
    status: "ai_working",
    submitterUserId: submitterId,
    claimedByUserId: null,
    workspaceId,
    project: { archived: false, deletedAt: null, ownerUserId: submitterId, workspaceId, orgId: null, name: "项目" },
    assignments: [],
    ...overrides
  };
}

function commentRow(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: "c-1",
    workItemId,
    authorNickname: "member",
    body: "hello",
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as CommentRow;
}

function service(config: { row?: WorkItemAccessRow | null; existing?: CommentRow[] } = {}) {
  const inserted: Array<{ workItemId: string; authorNickname: string; body: string }> = [];
  const svc = createWorkItemCommentService({
    workItems: {
      async findWorkItemAccessRecord() {
        return config.row === undefined ? accessRow() : config.row;
      }
    },
    comments: {
      async listCommentsForWorkItem() {
        return config.existing ?? [commentRow({ id: "c-1", body: "first" }), commentRow({ id: "c-2", body: "second" })];
      },
      async insertComment(input) {
        inserted.push({ workItemId: input.workItemId, authorNickname: input.authorNickname, body: input.body });
        return commentRow({ authorNickname: input.authorNickname, body: input.body });
      }
    },
    now: () => now
  } satisfies WorkItemCommentServiceDependencies);
  return { svc, inserted };
}

test("list: a workspace member reads the thread of a visible work item", async () => {
  const { svc } = service();
  const result = await svc.list({ workItemId, actor: actor() });
  assert.equal(result.work_item_id, workItemId);
  assert.equal(result.comments.length, 2);
  assert.equal(result.comments[0]?.body, "first");
});

test("create: comment is stored with the current actor's nickname, not a client-supplied one", async () => {
  const { svc, inserted } = service();
  const result = await svc.create({ workItemId, payload: { body: "  looks good  " }, actor: actor({ label: "真名" }) });
  assert.equal(result.author_nickname, "真名");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.authorNickname, "真名");
  assert.equal(inserted[0]?.body, "  looks good  ");
});

test("create: reads back what was posted (GET reflects POST)", async () => {
  // 先 create 再 list：把新评论也纳入 existing，验证读到写入的内容。
  const store: CommentRow[] = [];
  const svc = createWorkItemCommentService({
    workItems: { async findWorkItemAccessRecord() { return accessRow(); } },
    comments: {
      async listCommentsForWorkItem() { return [...store]; },
      async insertComment(input) {
        const row = commentRow({ id: `c-${store.length + 1}`, authorNickname: input.authorNickname, body: input.body });
        store.push(row);
        return row;
      }
    },
    now: () => now
  });
  await svc.create({ workItemId, payload: { body: "从 POST 写入" }, actor: actor() });
  const listed = await svc.list({ workItemId, actor: actor() });
  assert.equal(listed.comments.length, 1);
  assert.equal(listed.comments[0]?.body, "从 POST 写入");
});

test("list: a non-member cannot see a private work item's comments (403)", async () => {
  // 私有态(spec_ready) + actor 非提交人/指派人/管理员 → 不可见。
  const { svc } = service({ row: accessRow({ status: "spec_ready" }) });
  await assert.rejects(
    () => svc.list({ workItemId, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 403
  );
});

test("create: forbidden on a private work item for a non-participant", async () => {
  const { svc, inserted } = service({ row: accessRow({ status: "spec_ready" }) });
  await assert.rejects(
    () => svc.create({ workItemId, payload: { body: "x" }, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 403
  );
  assert.deepEqual(inserted, []);
});

test("list: missing work item maps to 404", async () => {
  const { svc } = service({ row: null });
  await assert.rejects(
    () => svc.list({ workItemId, actor: actor() }),
    (error: unknown) => error instanceof WorkItemServiceError && error.status === 404
  );
});
