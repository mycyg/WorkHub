import type { WorkHubLocale } from "@workhub/ui/gold-path";

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
    return zh ? "确认归档？再点一次" : "Archive — click again";
  }
  return zh ? "确认删除？再点一次" : "Delete — click again";
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
    return zh
      ? "没有找到这个项目，可能刚刚已经被别人归档或删除了。"
      : "That project wasn't found — someone may have just archived or deleted it.";
  }
  if (code === "project_forbidden" || code === "forbidden") {
    return zh
      ? "只有管理员或项目负责人能做这件事。"
      : "Only admins or the project owner can do that.";
  }
  if (action === "archive") {
    return zh ? "归档失败，稍后重试。" : "Couldn't archive it — try again later.";
  }
  return zh ? "删除失败，稍后重试。" : "Couldn't delete it — try again later.";
}
