// R23 F-04（升级转交选人 UI）：两类「转交」动作（审批 /api/approvals/:id/delegate、升级
// /api/escalations/:id/delegate）共用一套 href 分类 + 提交分发。此前只有审批转交在 web 接了线，
// 升级转交三端都在把动作剥掉（isUnsupportedWebAction / isUnsupportedDesktopAction /
// stripUnsupportedPetActions），SDK 的 delegateEscalation 零调用。
//
// 放在 web-runtime 是因为 web 主窗与桌面聚焦盒都要同一份分发：谁去调哪个 SDK 方法只能有一处答案，
// 否则两端会在「approvals 也能转交吗」这类问题上分叉。

import type { WorkHubLocale } from "@workhub/contracts";

import { hrefPathname } from "./action-payload.js";

export type DelegateTarget =
  | { kind: "approval"; id: string }
  | { kind: "escalation"; id: string };

// 只认这两条精确路径——不要用 /\/delegate$/ 泛匹配，免得将来别的资源加了 delegate 端点后被静默
// 路由到错误的 SDK 方法。
export function delegateTargetFromHref(href: string): DelegateTarget | undefined {
  const path = hrefPathname(href);
  const approval = /^\/api\/approvals\/([^/]+)\/delegate$/u.exec(path);
  if (approval?.[1]) {
    return { kind: "approval", id: decodeURIComponent(approval[1]) };
  }
  const escalation = /^\/api\/escalations\/([^/]+)\/delegate$/u.exec(path);
  if (escalation?.[1]) {
    return { kind: "escalation", id: decodeURIComponent(escalation[1]) };
  }
  return undefined;
}

export function isDelegateActionHref(href: string): boolean {
  return delegateTargetFromHref(href) !== undefined;
}

// 只要求两个方法（而不是整个 WorkHubApiClient），让单测能喂最小假实现，也让调用方不必持有全量客户端。
// options 逐字对齐 SDK 的 PageRequestOptions（`locale?: WorkHubLocale`，不带 `| undefined`）——仓库开了
// exactOptionalPropertyTypes，写宽一点真客户端就不再结构上满足这个契约。
export type DelegateActionClient = {
  delegateApproval: (id: string, payload: { to_user_id: string }) => Promise<unknown>;
  delegateEscalation: (
    id: string,
    payload: { to_user_id: string },
    options?: { locale?: WorkHubLocale }
  ) => Promise<unknown>;
};

// 提交一次转交。href 不是转交动作时返回 undefined（调用方据此继续往下分类），与
// resolveWebMemoryConflictAction 的「不认就让开」范式一致。
export function submitDelegateAction(
  client: DelegateActionClient,
  href: string,
  toUserId: string,
  options?: { locale?: WorkHubLocale }
): Promise<unknown> | undefined {
  const target = delegateTargetFromHref(href);
  if (!target || !toUserId) {
    return undefined;
  }
  if (target.kind === "approval") {
    // 审批转交端点不吃 locale 查询参数（响应里的 attention 文案由服务端按请求头定），保持与
    // 既有 delegateApproval 调用一致。
    return client.delegateApproval(target.id, { to_user_id: toUserId });
  }
  return client.delegateEscalation(target.id, { to_user_id: toUserId }, options);
}

// 转交结果里的人话摘要（服务端 attention.summary_text）。两端 toast/提示都读它，读不到再回落本地文案。
export function delegateResultSummaryText(result: unknown): string | undefined {
  if (result && typeof result === "object" && "attention" in result) {
    const attention = (result as { attention?: { summary_text?: unknown } }).attention;
    if (attention && typeof attention.summary_text === "string") {
      return attention.summary_text;
    }
  }
  return undefined;
}
