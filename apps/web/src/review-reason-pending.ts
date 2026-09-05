// UI-01：提议打回（pendingReviewHref）与审批打回（pendingApprovalId）两组挂起态此前各自赋值、互不
// 清空，理由卡按钮一路 if 往下走——一次点击可同时触发 reviewProposal(request_changes) 与
// respondApproval(deny) 两个审计动作。状态收敛到这个模块：两个武装入口互清，消费侧 resolve 出
// 互斥的 discriminated union，从结构上保证一次点击只落一个动作（confirm-button.ts 同款
// 「抽成可被单测覆盖的纯编排单元」先例）。

export type PendingSendBackState = {
  reviewHref?: string | undefined;
  reviewActionId?: string | undefined;
  approvalId?: string | undefined;
  approvalActionId?: string | undefined;
};

export type PendingSendBackTarget =
  | { kind: "proposal"; href: string; actionId: string }
  | { kind: "approval"; approvalId: string; actionId: string };

export function createPendingSendBackState(): PendingSendBackState {
  return {};
}

// 提议打回挂起——互清审批打回。
export function armProposalSendBack(state: PendingSendBackState, href: string, actionId: string): void {
  state.approvalId = undefined;
  state.approvalActionId = undefined;
  state.reviewHref = href;
  state.reviewActionId = actionId;
}

// 审批打回挂起——互清提议打回。
export function armApprovalSendBack(state: PendingSendBackState, approvalId: string, actionId: string): void {
  state.reviewHref = undefined;
  state.reviewActionId = undefined;
  state.approvalId = approvalId;
  state.approvalActionId = actionId;
}

export function clearPendingSendBack(state: PendingSendBackState): void {
  state.reviewHref = undefined;
  state.reviewActionId = undefined;
  state.approvalId = undefined;
  state.approvalActionId = undefined;
}

export function pendingSendBackActive(state: PendingSendBackState): boolean {
  return Boolean(state.reviewHref || state.approvalId);
}

// 消费侧（理由卡按钮）只认 resolve 出的互斥目标——即使状态被异常写成双挂，也只取其一，绝不双发。
export function resolvePendingSendBack(state: PendingSendBackState): PendingSendBackTarget | undefined {
  if (state.reviewHref) {
    return { kind: "proposal", href: state.reviewHref, actionId: state.reviewActionId ?? "request_changes" };
  }
  if (state.approvalId) {
    return { kind: "approval", approvalId: state.approvalId, actionId: state.approvalActionId ?? "deny" };
  }
  return undefined;
}

// UI-11：预设理由按钮 vs 文本框残留草稿——此前 `customReason || preset` 让残留草稿静默盖过用户
// 刚点的预设理由按钮（实际提交的不是他点的那条）。草稿非空且未经二次确认即拦下（调用方给武装式
// 提示：再点一次=确认用手写理由，或清空文本框用预设）；已确认则显式以手写理由提交，不替他删字。
export function resolveSendBackReasonMd(
  presetReason: string,
  customDraft: string | undefined,
  draftUseConfirmed = false
): { ok: true; reasonMd: string } | { ok: false; reason: "custom_draft_blocks_preset" } {
  const draft = customDraft?.trim() ?? "";
  if (draft.length > 0) {
    return draftUseConfirmed
      ? { ok: true, reasonMd: draft }
      : { ok: false, reason: "custom_draft_blocks_preset" };
  }
  return { ok: true, reasonMd: presetReason };
}

// UI-12：审批打回理由草稿 Map（R10-P1-2 按事项隔离引入）此前只增不减——已处理的审批条目常驻
// 内存。审批处理成功（通过/打回/批量通过）后调 settle 清掉对应条目。
export type ApprovalReasonDrafts = Map<string, string>;

export function createApprovalReasonDrafts(): ApprovalReasonDrafts {
  return new Map<string, string>();
}

export function settleApprovalReasonDrafts(drafts: ApprovalReasonDrafts, ...approvalIds: (string | undefined)[]): void {
  for (const id of approvalIds) {
    if (id) {
      drafts.delete(id);
    }
  }
}
