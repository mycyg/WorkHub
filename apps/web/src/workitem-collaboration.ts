import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { WORK_ITEM_COMMENT_MAX_CHARS } from "@workhub/contracts";

// R23 P4（R20 P2A 端点上界面）：工作项「认领 / 指派 / 留言」三个动作的纯判定与文案层——
// POST /api/workitems/:id/{claim,assign,comments} 后端早已齐备，此前两端一个入口都没有。
// 与 settings-devices.ts 同一分工：值得单测的判定/人话化留在这里（无 DOM 依赖），
// apps/web/src/browser.ts 里只剩 DOM 拼装胶水（本仓库没有 jsdom，bind* 系列不单测）。

export type WorkItemCollaborationAction = "claim" | "assign" | "comment";

// 服务端错误码（work-item-assignment.ts / work-item-comments.ts / app.onError）到人话的映射。
// duck-type 读 `.code`（WorkHubApiError 的公开字段），不 import 运行时类——保持纯函数、单测无需
// 构造真实错误实例。未知错误一律兜底成「可重试」的通用文案，绝不把裸 Error.message 吐给用户。
export function humanizeWorkItemCollaborationError(
  error: unknown,
  action: WorkItemCollaborationAction,
  locale: WorkHubLocale
): string {
  const zh = locale === "zh-CN";
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "not_found") {
    return zh ? "没有找到这个事项，可能已经被删除了。" : "That item wasn't found — it may have been removed.";
  }
  if (code === "forbidden") {
    if (action === "claim") {
      return zh ? "你现在还不能认领这个事项。" : "You can't claim this item right now.";
    }
    if (action === "assign") {
      return zh ? "你没有权限指派这个事项。" : "You don't have permission to assign this item.";
    }
    return zh ? "你没有权限在这个事项下留言。" : "You don't have permission to comment on this item.";
  }
  if (code === "work_item_not_claimable") {
    return zh
      ? "这个事项已经被别人认领，或者已经不在可认领的状态了。"
      : "Someone else already claimed this item, or it's no longer claimable.";
  }
  if (code === "assignee_not_active") {
    return zh ? "选中的同事账号已停用，换一位再试。" : "That teammate's account is disabled — pick someone else.";
  }
  if (code === "assignee_not_member") {
    return zh ? "选中的同事不在这个工作区里。" : "That teammate isn't a member of this workspace.";
  }
  if (code === "work_item_workspace_missing") {
    return zh ? "这个事项还没有归属工作区，暂时不能改归属。" : "This item has no workspace yet, so ownership can't change.";
  }
  if (code === "assign_user_directory_unavailable") {
    return zh ? "成员名单暂时读不到，事项没有被指派。" : "The member directory is unavailable — nothing was assigned.";
  }
  if (code === "validation_error") {
    return zh ? "内容不符合要求，检查后再提交一次。" : "That input wasn't accepted — check it and submit again.";
  }
  if (action === "claim") {
    return zh ? "认领失败，稍后重试。" : "Couldn't claim it — try again later.";
  }
  if (action === "assign") {
    return zh ? "指派失败，稍后重试。" : "Couldn't assign it — try again later.";
  }
  return zh ? "留言没发出去，稍后重试。" : "Couldn't post the comment — try again later.";
}

export type CommentBodyCheck =
  | { ok: true; body: string }
  | { ok: false; message: string };

// 发留言前的本地校验：空白不算内容（服务端 trim().min(1) 同口径），超长先在本地拦下——
// 让用户在点提交之前就知道问题出在哪，而不是拿服务端 422 当交互反馈。
export function checkWorkItemCommentBody(raw: string, locale: WorkHubLocale): CommentBodyCheck {
  const zh = locale === "zh-CN";
  const body = raw.trim();
  if (!body) {
    return { ok: false, message: zh ? "先写点内容再发布。" : "Write something before posting." };
  }
  if (body.length > WORK_ITEM_COMMENT_MAX_CHARS) {
    return {
      ok: false,
      message: zh
        ? `留言最多 ${WORK_ITEM_COMMENT_MAX_CHARS} 个字，现在有 ${body.length} 个。`
        : `Comments are capped at ${WORK_ITEM_COMMENT_MAX_CHARS} characters; this one has ${body.length}.`
    };
  }
  return { ok: true, body };
}

// 指派提交前的本地校验：没选人就别发请求（服务端会 422，但那是一次白跑的往返）。
export function checkAssigneeSelection(userId: string, locale: WorkHubLocale): CommentBodyCheck {
  const zh = locale === "zh-CN";
  const trimmed = userId.trim();
  if (!trimmed) {
    return { ok: false, message: zh ? "先选一位同事再确认指派。" : "Pick a teammate before assigning." };
  }
  return { ok: true, body: trimmed };
}
