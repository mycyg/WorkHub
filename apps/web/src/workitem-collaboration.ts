import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { WORK_ITEM_COMMENT_MAX_CHARS } from "@workhub/contracts";

import { webT } from "./locales.js";

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
    return webT(locale, "thatItemWasnTFoundIt");
  }
  if (code === "forbidden") {
    if (action === "claim") {
      return webT(locale, "youCanTClaimThisItem");
    }
    if (action === "assign") {
      return webT(locale, "youDonTHavePermissionTo6");
    }
    return webT(locale, "youDonTHavePermissionTo7");
  }
  if (code === "work_item_not_claimable") {
    return webT(locale, "someoneElseAlreadyClaimedThisItem");
  }
  if (code === "assignee_not_active") {
    return webT(locale, "thatTeammateSAccountIsDisabled");
  }
  if (code === "assignee_not_member") {
    return webT(locale, "thatTeammateIsnTAMember");
  }
  if (code === "work_item_workspace_missing") {
    return webT(locale, "thisItemHasNoWorkspaceYet");
  }
  if (code === "assign_user_directory_unavailable") {
    return webT(locale, "theMemberDirectoryIsUnavailableNothing");
  }
  if (code === "validation_error") {
    return webT(locale, "thatInputWasnTAcceptedCheck");
  }
  if (action === "claim") {
    return webT(locale, "couldnTClaimItTryAgain");
  }
  if (action === "assign") {
    return webT(locale, "couldnTAssignItTryAgain");
  }
  return webT(locale, "couldnTPostTheCommentTry");
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
    return { ok: false, message: webT(locale, "writeSomethingBeforePosting") };
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
    return { ok: false, message: webT(locale, "pickATeammateBeforeAssigning") };
  }
  return { ok: true, body: trimmed };
}
