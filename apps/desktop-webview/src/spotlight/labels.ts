// 桌面 Spotlight 视图共用的枚举→本地化标签（避免给用户直接渲染 in_progress / urgent / running 等裸枚举）。
// 文案与 web 端 packages/ui i18n 同口径；约定签名 (value, zh) 与各 view 既有 helper 一致。

function pick(map: Record<string, [string, string]>, value: string, zh: boolean): string {
  const entry = map[value];
  return entry ? (zh ? entry[0] : entry[1]) : value;
}

const workItemStatusMap: Record<string, [string, string]> = {
  intake: ["接收中", "Intake"],
  ai_clarifying: ["澄清中", "Clarifying"],
  spec_ready: ["待派活", "Ready to run"],
  in_progress: ["进行中", "In progress"],
  in_review: ["待审阅", "In review"],
  delivery_ready: ["待交付", "Delivery ready"],
  accepted: ["已采纳", "Accepted"],
  done: ["已完成", "Done"],
  cancelled: ["已取消", "Cancelled"]
};

const workItemPriorityMap: Record<string, [string, string]> = {
  low: ["低", "Low"],
  normal: ["普通", "Normal"],
  high: ["高", "High"],
  urgent: ["紧急", "Urgent"]
};

const agentRunStatusMap: Record<string, [string, string]> = {
  queued: ["排队中", "Queued"],
  running: ["执行中", "Running"],
  succeeded: ["已完成", "Succeeded"],
  failed: ["失败", "Failed"],
  escalated: ["已升级", "Escalated"],
  budget_exhausted: ["预算已用尽", "Budget exhausted"],
  cancelled: ["已取消", "Cancelled"]
};

export function workItemStatusLabel(status: string, zh: boolean): string {
  return pick(workItemStatusMap, status, zh);
}

export function workItemPriorityLabel(priority: string, zh: boolean): string {
  return pick(workItemPriorityMap, priority, zh);
}

export function agentRunStatusLabel(status: string, zh: boolean): string {
  return pick(agentRunStatusMap, status, zh);
}
