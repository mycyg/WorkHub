import { WorkHubApiError } from "@workhub/api-client/client";
import type {
  ApplyMergeProposalCandidateRequest,
  BootstrapProjectRequest,
  CreateWorkItemRequest,
  MergeProposalRequest,
  NextQuestionRequest,
  ProposalConflict,
  UseEvidenceForTaskRequest
} from "@workhub/contracts";

import { cssEscape } from "./html.js";

export type ActionPayloadFailureReason = "field_value_required" | "intake_option_required" | "invalid_json";

export type ActionPayloadResult<T> =
  | { ok: true; payload?: T }
  | { ok: false; reason: ActionPayloadFailureReason };

function hrefPathname(href: string, origin = globalThis.location?.origin ?? "http://workhub.local") {
  return new URL(href, origin).pathname;
}

function hrefSearchParams(href: string, origin = globalThis.location?.origin ?? "http://workhub.local") {
  return new URL(href, origin).searchParams;
}

export function proposalActionFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/proposals\/([^/]+)\/(review|merge)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { proposalId: decodeURIComponent(match[1]), action: match[2] as "review" | "merge" };
}

// B-R9.6 UX 审计（skip-plan 假接线）：plan_review 卡「先不拆，单个 AI 跑」的 href 识别。
export function skipPlanProposalIdFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/proposals\/([^/]+)\/skip-plan$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function approvalRespondIdFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function mergeProposalCandidateApplyIdFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/merge-proposals\/([^/]+)\/apply$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function sessionNextQuestionIdFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/sessions\/([^/]+)\/next-question$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function createWorkItemActionFromHref(href: string) {
  return hrefPathname(href) === "/api/workitems";
}

export function bootstrapProjectActionFromHref(href: string) {
  return hrefPathname(href) === "/api/projects/bootstrap";
}

export function createNamedProjectActionFromHref(href: string) {
  return hrefPathname(href) === "/api/projects/bootstrap";
}

export function startAgentRunActionFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/workitems\/([^/]+)\/agent-runs$/u.exec(path);
  return match?.[1] ? { workItemId: decodeURIComponent(match[1]) } : undefined;
}

// WIRE-07：回放页「中止执行」按钮的 href 识别（POST /api/agent-runs/:id/abort）。
export function agentRunAbortIdFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/agent-runs\/([^/]+)\/abort$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function createTaskPlanActionFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/workitems\/([^/]+)\/task-plan$/u.exec(path);
  return match?.[1] ? { workItemId: decodeURIComponent(match[1]) } : undefined;
}

export function evidenceBindingWorkItemIdFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/workitems\/([^/]+)\/evidence-bindings$/u.exec(path);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export function acceptedDeliverableRestoreFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/workitems\/([^/]+)\/deliverables\/([^/]+)\/restore$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    workItemId: decodeURIComponent(match[1]),
    acceptedChangeId: decodeURIComponent(match[2])
  };
}

export function driveUploadFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/drive\/projects\/([^/]+)\/files$/u.exec(path);
  return match?.[1] ? { projectId: decodeURIComponent(match[1]) } : undefined;
}

export function driveItemMutationFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/drive\/projects\/([^/]+)\/items\/([^/]+)\/(delete|restore)$/u.exec(path);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    projectId: decodeURIComponent(match[1]),
    itemId: decodeURIComponent(match[2]),
    action: match[3] as "delete" | "restore"
  };
}

export function driveCommentDraftFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/drive\/projects\/([^/]+)\/comments\/([^/]+)\/draft$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    projectId: decodeURIComponent(match[1]),
    commentId: decodeURIComponent(match[2])
  };
}

export function driveDraftProposalFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/drive\/workitems\/([^/]+)\/proposal-draft$/u.exec(path);
  return match?.[1] ? { workItemId: decodeURIComponent(match[1]) } : undefined;
}

export function meetingInsightActionFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/meetings\/projects\/([^/]+)\/insights\/([^/]+)\/(draft|dismiss)$/u.exec(path);
  if (!match?.[1] || !match[2] || !match[3]) {
    return undefined;
  }
  return {
    projectId: decodeURIComponent(match[1]),
    insightId: decodeURIComponent(match[2]),
    action: match[3] as "draft" | "dismiss"
  };
}

export function meetingDraftProposalFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/meetings\/workitems\/([^/]+)\/proposal-draft$/u.exec(path);
  return match?.[1] ? { workItemId: decodeURIComponent(match[1]) } : undefined;
}

// SA-02 重新生成纪要。只有两段路径，与上面几条会议动作（projects/... / workitems/...）不会撞。
export function meetingReanalyzeFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/meetings\/([^/]+)\/analyze$/u.exec(path);
  return match?.[1] ? { meetingId: decodeURIComponent(match[1]) } : undefined;
}

export function notificationActionFromHref(href: string) {
  const path = hrefPathname(href);
  if (path === "/api/notifications/read-all") {
    return { action: "mark_all_read" as const };
  }
  const match = /^\/api\/notifications\/([^/]+)\/(read|dismiss|complete|snooze)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    notificationId: decodeURIComponent(match[1]),
    action: match[2] as "read" | "dismiss" | "complete" | "snooze"
  };
}

// B-R9.6 §3.1：军团面板「暂停/恢复派发」按钮的 href 识别。
export function taskPlanDispatchActionFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/task-plans\/([^/]+)\/(pause|resume)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    planId: decodeURIComponent(match[1]),
    action: match[2] as "pause" | "resume"
  };
}

export function escalationActionFromHref(href: string) {
  const path = hrefPathname(href);
  const budgetMatch = /^\/api\/escalations\/([^/]+)\/budget-actions\/([^/]+)$/u.exec(path);
  if (budgetMatch?.[1] && budgetMatch[2]) {
    return {
      escalationId: decodeURIComponent(budgetMatch[1]),
      action: "budget" as const,
      budgetActionId: decodeURIComponent(budgetMatch[2])
    };
  }
  const match = /^\/api\/escalations\/([^/]+)\/(resolve|delegate)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return {
    escalationId: decodeURIComponent(match[1]),
    action: match[2] as "resolve" | "delegate"
  };
}

export function memoryConflictActionFromHref(href: string) {
  const path = hrefPathname(href);
  const match = /^\/api\/memory-conflicts\/([^/]+)\/resolve\/(keep_current|accept_incoming|merge_both|edit_memory|discard_both)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  const expectedUpdatedAt = hrefSearchParams(href).get("expected_updated_at") ?? undefined;
  if (!expectedUpdatedAt) {
    return undefined;
  }
  return {
    conflictId: decodeURIComponent(match[1]),
    resolution: match[2] as "keep_current" | "accept_incoming" | "merge_both" | "edit_memory" | "discard_both",
    expectedUpdatedAt
  };
}

export function actionHrefFromElement(element: HTMLElement) {
  if (element instanceof HTMLAnchorElement) {
    return element.getAttribute("href") ?? "";
  }
  return element.dataset.actionHref ?? element.dataset.href ?? "";
}

export function isNativeResourceLink(element: HTMLElement) {
  const method = element.dataset.method?.toUpperCase();
  return element.dataset.nativeResourceLink === "true" && method !== "POST" && method !== "PUT" && method !== "DELETE";
}

export function replaceCustomFieldPlaceholder(value: unknown, customValue: string): unknown {
  if (value === "__WORKHUB_CUSTOM_FIELD_VALUE__") {
    return customValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceCustomFieldPlaceholder(item, customValue));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceCustomFieldPlaceholder(item, customValue)])
    );
  }
  return value;
}

export function hasCustomFieldPlaceholder(value: unknown): boolean {
  if (value === "__WORKHUB_CUSTOM_FIELD_VALUE__") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasCustomFieldPlaceholder);
  }
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.values(value).some(hasCustomFieldPlaceholder)
  );
}

export function customFieldValueForElement(element: HTMLElement) {
  const field = element.dataset.structuredField;
  if (!field) {
    return "";
  }
  const row = element.closest<HTMLElement>("[data-proposal-structured-field-editor-row]");
  const input = row?.querySelector<HTMLTextAreaElement>(`[data-structured-field-custom-input="${cssEscape(field)}"]`);
  return input?.value.trim() ?? "";
}

export function actionElementJsonPayload<T>(element: HTMLElement): ActionPayloadResult<T> {
  // M28：模板驱动（custom）动作优先读 requestJsonTemplate（始终含占位符），且**不**把物化结果写回
  // requestJson——否则 type=button 的 custom 按钮第二次点击会读到上次物化的值、丢掉用户改后的输入，
  // 用旧值解决字段冲突。accept_only/keep_current 等只有 requestJson（无 template），不受影响。
  const raw = element.dataset.requestJsonTemplate ?? element.dataset.requestJson;
  if (!raw) {
    return { ok: true };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (hasCustomFieldPlaceholder(parsed)) {
      const customValue = customFieldValueForElement(element);
      if (!customValue) {
        return { ok: false, reason: "field_value_required" };
      }
      const materialized = replaceCustomFieldPlaceholder(parsed, customValue);
      return { ok: true, payload: materialized as T };
    }
    return { ok: true, payload: parsed as T };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

export function actionElementMergePayload(element: HTMLElement): ActionPayloadResult<MergeProposalRequest> {
  return actionElementJsonPayload<MergeProposalRequest>(element);
}

export function actionElementApplyPayload(element: HTMLElement): ActionPayloadResult<ApplyMergeProposalCandidateRequest> {
  return actionElementJsonPayload<ApplyMergeProposalCandidateRequest>(element);
}

export function selectedIntakeOptionIds(scope: ParentNode) {
  return Array.from(scope.querySelectorAll<HTMLElement>("[data-intake-option-selected=\"true\"]"))
    .map((option) => option.dataset.intakeOptionId ?? option.dataset.optionId ?? "")
    .filter((value) => value.length > 0);
}

export function intakeFreeTextValue(scope: ParentNode) {
  const input = scope.querySelector<HTMLTextAreaElement>("[data-intake-free-text-input]");
  return input?.value.trim() ?? "";
}

export function updateIntakeActionPayloads(route: HTMLElement) {
  const selected = selectedIntakeOptionIds(route);
  const freeText = intakeFreeTextValue(route);
  route.dataset.r4IntakeSelectedCount = String(selected.length);
  route.dataset.r4IntakeFreeTextLength = String(freeText.length);
  for (const action of route.querySelectorAll<HTMLElement>("[data-intake-submit],[data-intake-create-workitem]")) {
    const base = actionElementJsonPayload<Record<string, unknown>>(action);
    const payload = base.ok && base.payload && typeof base.payload === "object" ? { ...base.payload } : {};
    payload["selected_option_ids"] = selected;
    if (freeText) {
      payload["free_text"] = freeText;
    } else {
      delete payload["free_text"];
    }
    if (action.dataset.intakeCreateWorkitem === "true") {
      payload["session_id"] = action.dataset.sessionId;
    }
    const raw = JSON.stringify(payload);
    action.dataset.requestJson = raw;
    action.setAttribute("data-request-json", raw);
  }
}

export function materializeIntakePayload<T>(element: HTMLElement): ActionPayloadResult<T> {
  const route = element.closest<HTMLElement>("[data-r4-route-component=\"intake\"]");
  if (!route) {
    return actionElementJsonPayload<T>(element);
  }
  updateIntakeActionPayloads(route);
  const selected = selectedIntakeOptionIds(route);
  const optionCount = Number.parseInt(route.dataset.r4IntakeOptionCount ?? "0", 10);
  // INT-4：自由文本是被主动邀请的答法(「也可以展开手动输入」)。只填了自由文本、没选项,也算有效答案——
  // 只有当选项和自由文本都为空时才拦。否则就成了"邀请你写,却又说没选项不让过"的死路。
  const freeText = intakeFreeTextValue(route);
  if (optionCount > 0 && selected.length === 0 && freeText.length === 0) {
    return { ok: false, reason: "intake_option_required" };
  }
  // 普通用户审查：0 选项的纯问答步（long_text）自由文本是唯一答法，空提交会让 AI 拿着空信息干活——
  // 一样拦下（提示先回答问题）。
  if (optionCount === 0 && selected.length === 0 && freeText.length === 0) {
    return { ok: false, reason: "intake_option_required" };
  }
  return actionElementJsonPayload<T>(element);
}

export function actionElementNextQuestionPayload(element: HTMLElement): ActionPayloadResult<NextQuestionRequest> {
  return materializeIntakePayload<NextQuestionRequest>(element);
}

export function actionElementCreateWorkItemPayload(element: HTMLElement): ActionPayloadResult<CreateWorkItemRequest> {
  return materializeIntakePayload<CreateWorkItemRequest>(element);
}

// R8 /projects「新建项目」：从 sibling 输入框读用户填的项目名，bootstrap 按 slug 派生唯一新建。
// 空名时 fail-closed（field_value_required），避免误复用试点项目。
// INT-03：显式带空 description——服务端对缺省 description 会回落到英文样板文案
// （"Pilot Day 0 project context created from…"），用户自建项目不该带它。本地化默认名/描述的
// 服务端侧收口（payload 全缺省时按 locale 出默认）属 apps/api 面，由对应批次处理。
export function actionElementCreateProjectPayload(element: HTMLElement): ActionPayloadResult<BootstrapProjectRequest> {
  const form = element.closest<HTMLElement>("[data-r8-project-create-form]");
  const scope: ParentNode = form ?? element.parentElement ?? element;
  const input = scope.querySelector<HTMLInputElement>("[data-r8-project-name-input]");
  const name = input?.value.trim() ?? "";
  if (!name) {
    return { ok: false, reason: "field_value_required" };
  }
  return { ok: true, payload: { name, description: "" } };
}

export function actionElementEvidenceBindingPayload(element: HTMLElement): ActionPayloadResult<UseEvidenceForTaskRequest> {
  return actionElementJsonPayload<UseEvidenceForTaskRequest>(element);
}

export function conflictsFromMergeError(error: unknown): ProposalConflict[] {
  if (!(error instanceof WorkHubApiError) || error.code !== "merge_conflict") {
    return [];
  }
  const candidates = [error.details];
  if (error.details && typeof error.details === "object" && !Array.isArray(error.details)) {
    const record = error.details as Record<string, unknown>;
    candidates.push(record.details);
    const nested = record.error;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      candidates.push((nested as Record<string, unknown>).details);
    }
  }
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const conflicts = (candidate as Record<string, unknown>).conflicts;
      if (Array.isArray(conflicts)) {
        return conflicts as ProposalConflict[];
      }
    }
  }
  return [];
}
