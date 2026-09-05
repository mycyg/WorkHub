import type { WorkHubLocale } from "@workhub/contracts";
import { approvalRespondIdFromHref } from "@workhub/web-runtime";

export type DelegateUserOption = {
  id: string;
  nickname: string;
  is_admin: boolean;
};

type OptionLike = {
  value: string;
  textContent: string | null;
};

export function buildDelegateOptionNodes<T extends OptionLike>(
  createOption: () => T,
  users: readonly DelegateUserOption[],
  locale: WorkHubLocale
): T[] {
  return users.map((user) => {
    const option = createOption();
    option.value = user.id;
    option.textContent = `${user.nickname}${user.is_admin
      ? locale === "en-US" ? " (admin)" : "（管理员）"
      : ""}`;
    return option;
  });
}

export function buildDelegateStatusOption<T extends OptionLike>(
  createOption: () => T,
  message: string
): T {
  const option = createOption();
  option.value = "";
  option.textContent = message;
  return option;
}

// R23 F-04：一个转交选人器要提交到哪个 href。两种来源：
// ① 决策卡上的选人器自带 href（服务端在卡片动作里给的 /api/approvals/:id/delegate 或
//    /api/escalations/:id/delegate）——升级转交只有这一条路；
// ② 审批工作台右侧的动作面板是整页共享的一份选人器，没有固定 href，按当前选中的审批行的
//    「回应」href 推导出审批 id。
// 两者都没有就返回 undefined——调用方据此提示「先选一条」，而不是发一个打不通的请求。
export function delegatePickerHref(input: {
  pickerHref?: string | null | undefined;
  selectedApprovalRespondHref?: string | null | undefined;
}): string | undefined {
  const own = input.pickerHref?.trim();
  if (own) {
    return own;
  }
  const approvalId = approvalRespondIdFromHref(input.selectedApprovalRespondHref?.trim() ?? "");
  return approvalId ? `/api/approvals/${encodeURIComponent(approvalId)}/delegate` : undefined;
}
