import type { WorkspaceAuditListVM } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

// R23 P4（R20 P2A 端点上界面）：工作区审计流（GET /api/workspace/audit，仅管理员）的分页判定与
// 人话化。服务端只回 { limit, offset, count }，没有 total——是否还有下一页只能按「这一页装满了没」
// 判断，翻页游标就是 offset + count。这套算术值得单测（差一位就会漏一条或死循环重复拉同一页），
// 故与 DOM 拼装（apps/web/src/browser.ts 的 bindSettingsWorkspaceAuditPanel）分开。

// 每页条数。契约上限是 200（WORKSPACE_AUDIT_MAX_LIMIT），一页 25 条够读又不至于一次糊一屏。
export const WORKSPACE_AUDIT_PAGE_SIZE = 25;

export type WorkspaceAuditPage = WorkspaceAuditListVM["page"];

// 装满一页就假定还有下一页（服务端不回 total）。最后一页恰好装满时会多请求一次、拿到空页收尾——
// 这是诚实的代价：宁可多问一次，也不能在还有记录时把「加载更多」藏掉。
export function hasMoreWorkspaceAuditPages(page: WorkspaceAuditPage): boolean {
  return page.count >= page.limit;
}

export function nextWorkspaceAuditOffset(page: WorkspaceAuditPage): number {
  return page.offset + page.count;
}

export function humanizeWorkspaceAuditError(error: unknown, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  const status = error && typeof error === "object" && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;
  if (code === "forbidden" || status === 403) {
    return zh
      ? "工作区审计只有管理员能看。"
      : "Workspace audit entries are visible to admins only.";
  }
  return zh ? "审计记录没加载出来，稍后重试。" : "Couldn't load audit entries — try again later.";
}
