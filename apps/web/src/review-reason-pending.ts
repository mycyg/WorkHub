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
