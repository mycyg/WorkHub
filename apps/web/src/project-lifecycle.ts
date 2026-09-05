import type { WorkHubLocale } from "@workhub/ui/gold-path";

import { webT } from "./locales.js";

// R23 P4（R20 P2A 端点上界面）：项目归档 / 删除两个破坏性动作的纯文案与判定层。
// POST /api/projects/:id/{archive,delete} 后端早已齐备（project-ops.ts，管理员/项目所有者门），
// 此前 web 只有一枚「已归档」徽标、没有任何动作入口。DOM 交互（两段式确认、状态回显）在
// apps/web/src/browser.ts 的 bindProjectLifecyclePanel 里；这里只放值得单测的部分。

export type ProjectLifecycleAction = "archive" | "delete";

// 两段式确认的第二段文案（armConfirmButton 的 confirmLabel）——必须明确说出这一下点下去会发生什么，
// 不能只写「确认？」。
export function projectLifecycleConfirmLabel(
  action: ProjectLifecycleAction,
  locale: WorkHubLocale
): string {
  const zh = locale === "zh-CN";
  if (action === "archive") {
    return webT(locale, "archiveClickAgain");
  }
  return webT(locale, "deleteClickAgain");
}

export function projectLifecycleSuccessMessage(
  action: ProjectLifecycleAction,
  projectName: string,
  locale: WorkHubLocale
): string {
  const zh = locale === "zh-CN";
  const name = projectName.trim();
  if (action === "archive") {
    return zh
      ? `已归档${name ? `「${name}」` : ""}，它不会再出现在团队项目列表里。`
      : `Archived${name ? ` “${name}”` : ""} — it no longer shows in the team project list.`;
  }
  return zh
    ? `已删除${name ? `「${name}」` : ""}，它已从团队项目列表下架。`
    : `Deleted${name ? ` “${name}”` : ""} — it's been taken down from the team project list.`;
}

// 服务端错误码（ProjectServiceError，经 app.onError 映射）到人话。duck-type 读 `.code`，
// 未知错误兜底成通用重试文案——绝不静默吞掉一次失败的破坏性动作。
export function humanizeProjectLifecycleError(
  error: unknown,
  action: ProjectLifecycleAction,
  locale: WorkHubLocale
): string {
  const zh = locale === "zh-CN";
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "project_not_found") {
    return webT(locale, "thatProjectWasnTFoundSomeone");
  }
  if (code === "project_forbidden" || code === "forbidden") {
    return webT(locale, "onlyAdminsOrTheProjectOwner");
  }
  if (action === "archive") {
    return webT(locale, "couldnTArchiveItTryAgain");
  }
  return webT(locale, "couldnTDeleteItTryAgain");
}
