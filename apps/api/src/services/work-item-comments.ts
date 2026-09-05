// R20 P2A（R19-22 工作项评论 · 纯后端）：GET/POST /api/workitems/:id/comments 的服务层。
// 通用 comments 表（work_item_id + author_nickname + body）全库此前零读写，这里补上读/写两口。
// 门＝canViewWorkItemRecord（能看见这个工作项的工作区成员就能读/评）——私有态（intake/ai_clarifying/
// spec_ready）仅提交人/指派人/管理员可见可评，非私有态同工作区成员皆可。author_nickname 取当前 actor
// 的展示名，不接受客户端伪造。复用 WorkItemServiceError（app.onError 已映射）。
import { canViewWorkItemRecord } from "@workhub/permissions";
import type { CreateWorkItemCommentRequest, WorkItemComment, WorkItemCommentsResult } from "@workhub/contracts";
import {
  createCommentRepository,
  createWorkItemRepository,
  getSharedDatabaseClient,
  type CommentRepository,
  type CommentRow,
  type WorkItemAccessRow,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { WorkItemServiceError } from "./work-items.js";
import { serviceT } from "./locales.js";

export type WorkItemCommentService = {
  list: (input: { workItemId: string; actor: AuthActor }) => Promise<WorkItemCommentsResult>;
  create: (input: {
    workItemId: string;
    payload: CreateWorkItemCommentRequest;
    actor: AuthActor;
  }) => Promise<WorkItemComment>;
};

export type WorkItemCommentServiceDependencies = {
  workItems: Pick<WorkItemDataRepository, "findWorkItemAccessRecord">;
  comments: CommentRepository;
  now?: () => Date;
};

function commentVm(row: CommentRow): WorkItemComment {
  return {
    id: row.id,
    work_item_id: row.workItemId,
    author_nickname: row.authorNickname,
    body: row.body,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

export function createWorkItemCommentService(
  deps: WorkItemCommentServiceDependencies
): WorkItemCommentService {
  const now = deps.now ?? (() => new Date());

  async function requireVisibleWorkItem(workItemId: string, actor: AuthActor): Promise<WorkItemAccessRow> {
    const row = await deps.workItems.findWorkItemAccessRecord(workItemId);
    if (!row) {
      throw new WorkItemServiceError(404, "not_found", serviceT("zh-CN", "taskCommentsNotFound"));
    }
    const allowed = canViewWorkItemRecord(
      row,
      { id: actor.userId ?? actor.id, isAdmin: actor.isAdmin },
      actor.workspaceId ? { workspaceId: actor.workspaceId } : undefined
    );
    if (!allowed) {
      throw new WorkItemServiceError(403, "forbidden", serviceT("zh-CN", "taskCommentsForbidden"));
    }
    return row;
  }

  return {
    async list({ workItemId, actor }) {
      await requireVisibleWorkItem(workItemId, actor);
      const rows = await deps.comments.listCommentsForWorkItem(workItemId);
      return { work_item_id: workItemId, comments: rows.map(commentVm) };
    },

    async create({ workItemId, payload, actor }) {
      await requireVisibleWorkItem(workItemId, actor);
      const row = await deps.comments.insertComment({
        workItemId,
        authorNickname: actor.label,
        body: payload.body,
        at: now()
      });
      return commentVm(row);
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: WorkItemCommentService | undefined;

export function getDefaultWorkItemCommentService(): WorkItemCommentService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createWorkItemCommentService({
      workItems: createWorkItemRepository(defaultDbClient.db),
      comments: createCommentRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
