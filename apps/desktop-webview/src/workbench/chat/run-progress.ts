// WorkHub 桌面 · R13 批 S2（Cuu 异步化与进度可视）：行动卡 execute 条目的「阶段流进度行」——纯函数部分。
//
// 数据源：该会话的军团面板端点（GET /conversations/:id/army，见 ../army/api.ts 的
// fetchConversationArmyPanel，批 P1 已经挂好、这批只是第二个消费方）返回的 run 卡片——每张卡带
// status（AgentRunStatus）与 recent_step（{phase,...} | null，phase 是 AgentStepPhase：
// think/tool_call/tool_result/final）。行动卡条目通过 source_action_card_item_id 关联到具体是哪张卡。
//
// 阶段推断只吃这两个字段，映射规则（00 §「异步心智模型」定的四段：认领→干活→产出→提议）：
//  - queued（run 已建但还没跑第一步）→ 认领
//  - running + phase ∈ {think,tool_call,tool_result} 或还没有任何步骤（phase=null）→ 干活
//  - running + phase = final（正在攒最终产物）→ 产出
//  - succeeded → 提议（批 4b 的 postDeliverableSystemMessage 已经在这个时点往会话里发过
//    proposal_opened/proposal_auto_merged 播报，这里只是把"提议"标成这个条目当前所处的可见阶段）
//  - failed / escalated → 终态，不再是"阶段"而是需要独立视觉的结局
//  - cancelled 或任何未来契约新增的状态/phase 组合 → undefined，调用方据此保留既有的"进行中"纯文字，
//    不替用户编一个不存在的进度故事（04 §4 铁律 3 的延伸）。

export type ActionCardRunProgressStage = "claim" | "work" | "produce" | "propose";
export type ActionCardRunProgressTerminal = "done" | "failed" | "escalated";

export type ActionCardRunProgress =
  | { kind: "stage"; stage: ActionCardRunProgressStage }
  | { kind: "terminal"; terminal: ActionCardRunProgressTerminal };

export const ACTION_CARD_RUN_PROGRESS_STAGES: readonly ActionCardRunProgressStage[] = [
  "claim",
  "work",
  "produce",
  "propose"
];

const WORKING_STEP_PHASES = new Set<string>(["think", "tool_call", "tool_result"]);

export function inferActionCardRunProgress(input: {
  runStatus: string;
  recentStepPhase: string | null;
}): ActionCardRunProgress | undefined {
  switch (input.runStatus) {
    case "queued":
      return { kind: "stage", stage: "claim" };
    case "running":
      if (input.recentStepPhase === "final") {
        return { kind: "stage", stage: "produce" };
      }
      if (input.recentStepPhase === null || WORKING_STEP_PHASES.has(input.recentStepPhase)) {
        return { kind: "stage", stage: "work" };
      }
      // 契约以后新增 step phase 时不瞎猜属于哪一段。
      return undefined;
    case "succeeded":
      return { kind: "stage", stage: "propose" };
    case "failed":
      return { kind: "terminal", terminal: "failed" };
    case "escalated":
      return { kind: "terminal", terminal: "escalated" };
    default:
      // cancelled 等——数据没给出足够信心映射到四段流程里的哪一段，诚实地什么都不返回。
      return undefined;
  }
}

// 从该会话军团面板返回的 run 列表里，找到这条行动卡条目对应的那一张 run 卡并推断进度——找不到匹配的
// run（还没有关联到执行、或者面板还没拉回来）时不猜，返回 undefined。
export function actionCardItemRunProgressFromRuns(
  itemId: string,
  runs: ReadonlyArray<{
    source_action_card_item_id: string | null;
    status: string;
    recent_step: { phase: string } | null;
  }>
): ActionCardRunProgress | undefined {
  const run = runs.find((candidate) => candidate.source_action_card_item_id === itemId);
  if (!run) {
    return undefined;
  }
  return inferActionCardRunProgress({ runStatus: run.status, recentStepPhase: run.recent_step?.phase ?? null });
}

// —— 节流重取判定 —— //
//
// 触发源：conversation.action_card.updated 事件（不新造 SSE，见批次范围）。真正的定时器/网络调用在
// view.ts；这里只管"现在能不能发一次请求"的判定，以及"如果现在不能发，应该在什么时刻补发一次"，两个
// 都是纯函数、可以脱离 DOM/网络单测。

export const ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS = 10_000;

// undefined 的 lastFetchAtMs 代表"这个会话还从没拉过一次"——第一次触发应该立即放行，不必等满一个窗口。
export function shouldRefetchActionCardRunProgressNow(lastFetchAtMs: number | undefined, nowMs: number): boolean {
  if (lastFetchAtMs === undefined) {
    return true;
  }
  return nowMs - lastFetchAtMs >= ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS;
}

// 窗口内触发但还不满 10 秒——不是丢弃这次触发，而是安排一次"窗口结束时刻"的收尾重取，否则一串密集的
// action_card.updated 事件全部落在同一个节流窗口内时，进度会一直停在上一次快照，窗口结束后也没有人
// 再补一次。lastFetchAtMs 在这个分支必然已定义（尚未拉过第一次时 shouldRefetchActionCardRunProgressNow
// 总是 true，调用方不会走到这里）。
export function nextAllowedActionCardRunProgressFetchAtMs(lastFetchAtMs: number): number {
  return lastFetchAtMs + ACTION_CARD_RUN_PROGRESS_MIN_REFETCH_INTERVAL_MS;
}
