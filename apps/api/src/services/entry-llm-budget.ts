import { settings as runtimeSettings, type Settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";
import type { WorkHubLocale } from "@workhub/contracts";

import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";

// API-04：入口澄清/计划 LLM 调用（POST /workitems、/sessions/:id/next-question、/workitems/:id/task-plan）
// 的预算软闸——与 conversation-reply-judge.ts 的 checkReplyJudgeBudget 同款：这些入口本身也是计费
// LLM 调用，调用前查一次团队维度已用量快照做门槛判断，不参与并发原子预留互斥（同款已知缺口，
// 理由同 checkTurnBudget/checkReplyJudgeBudget）。返回 false 时由各调用方抛自己域的错误（429 人话文案）。
export async function checkEntryLlmBudget(input: {
  workspaceId?: string | undefined;
  policyStore?: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore?: Pick<CostLedgerStore, "usageSnapshots">;
  settings?: Settings;
  now?: Date;
}): Promise<boolean> {
  // 没有租户维度就没有可比的已用量口径——放行（与 reply judge 只对真 workspace 判定同口径）。
  if (!input.workspaceId) {
    return true;
  }
  const settings = input.settings ?? runtimeSettings;
  const now = input.now ?? new Date();
  const ledgerStore = input.ledgerStore ?? getDefaultCostLedgerStore();
  const policyStore = input.policyStore ?? getDefaultBudgetPolicyStore();
  const usage = await ledgerStore.usageSnapshots({ teamId: input.workspaceId }, { now });
  const decision = decideRunBudget({
    settings,
    scopeIds: { teamId: input.workspaceId },
    policies: await policyStore.listPolicies(settings),
    usage,
    now
  });
  return decision.allowed;
}

export function entryLlmBudgetExceededMessage(locale: WorkHubLocale = "zh-CN"): string {
  return locale === "en-US"
    ? "This team's AI budget for the current period is used up. Top up or raise the budget, then retry."
    : "团队本期 AI 预算已用完，请追加或上调预算后再试。";
}
