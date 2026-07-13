import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { ActionCardItemStatus, ActionCardRepository } from "@workhub/db";
import type { AgentRunQueueRecord, AgentRunQueueStatus } from "../workers/agent-runner.js";

// R13（execute 类 action_card_items.status 永远停在 running）：run 到达终态时，把它挂回去的行动卡
// 条目状态一起回写。这个模块只挂进 apps/api/src/workers/agent-runner.ts 现有的 AgentRunSettledHook
// 组合链（见该文件 getDefaultAgentRunQueue 里 runSettled 的挂接点），不改动 agent-runner.ts 的执行逻辑
// 本身——照 services/run-conversation-report.ts 的同款取舍（best-effort、绝不抛错、可注入 now()）。
//
// —— run 终态 → action_card_items.status 映射（本模块唯一权威实现）——
//
// | run 终态   | item 目标状态 | 说明                                   |
// |-----------|--------------|----------------------------------------|
// | succeeded | done         | 干完了                                  |
// | failed    | escalated    | 需要人接手看一眼                        |
// | escalated | escalated    | run 自己判自己升级，同样需要人接手       |
// | cancelled | undone       | 中止 = 撤销；见下方"已知风险"            |
//
// 所有写入都固定 fromStatuses:["running"]——只结算"正在跑"的条目，不碰已经被决策/撤销/上一次
// 结算处理过的条目。packages/db 的 transitionItemStatus 本来就是 CAS 语义（见该文件），这里直接复用、
// 不新增写面。CAS 落空（返回 null）在这里永远不是错误——条目已经不是 running 了（被别的动作抢先动过），
// 这是幂等 no-op，不记噪音日志。
//
// —— 已知风险（发现于本批实现，不在本批范围内修复，详见 r12-desktop-workbench/reports/
// r13-fix-item-settlement.md）——
//
// apps/api/src/services/action-cards.ts 的 undo()：先 `await agentRuns.abort(item.runId, ...)`，
// 而 abort()（agent-runner.ts）内部会 `await notifyRunSettled(cancelled)` 之后才 return —— 也就是说
// 本模块对 cancelled 状态的 CAS 写入，会在 undo() 走到它自己那句
// `transitionItemStatus({ fromStatuses: ["running"], toStatus: "undone" })` 之前就已经执行完毕。
// 首次手动撤销时，本模块的 CAS 会赢（条目当时确实还是 running），undo() 自己随后的写入 CAS 落空
// 返回 null，而 undo() 把"落空"当错误处理，会抛 409 "已经过了可撤销的窗口" 给发起撤销的人——即便
// 数据实际已经正确落到 undone。修复需要改 undo()（不在本批范围围栏内），已写进汇报，等待人裁决。

export function actionCardItemStatusForRunStatus(status: AgentRunQueueStatus): ActionCardItemStatus | undefined {
  switch (status) {
    case "succeeded":
      return "done";
    case "failed":
      return "escalated";
    case "escalated":
      return "escalated";
    case "cancelled":
      return "undone";
    case "queued":
    case "running":
      // 非终态：settled hook 理论上不会用这两个状态调用本模块；防御性返回 undefined，不猜测。
      return undefined;
    default:
      return undefined;
  }
}

export const ACTION_CARD_RUN_SETTLEMENT_SOURCE_STATUSES: ActionCardItemStatus[] = ["running"];

export type ActionCardRunSettlementDeps = {
  actionCards: Pick<ActionCardRepository, "transitionItemStatus">;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
};

// 挂进 AgentRunSettledHook 组合链的一环——best-effort：没有会话血缘（source_action_card_item_id）、
// 非终态、缺 workspace_id、CAS 落空，都只是安静地跳过；只有仓库调用本身抛错才告警，且绝不外泄，
// 跟 services/run-conversation-report.ts 对 postSystemMessage 失败的取舍完全一致——这条状态回写
// 不能因为自己失败就把一次已经真实结束的 run 判成"结算失败"，触发 agent-runner.ts 里
// agent_run_settled_hook_failed 的重试路径（那条路径是给 task-dispatcher 那种"必须成功"的写路径
// 设计的，见 services/task-dispatcher.ts 的 handleRunSettled）。
export function createActionCardRunSettlementHook(deps: ActionCardRunSettlementDeps) {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  return async function settleActionCardItemForRun(run: AgentRunQueueRecord): Promise<void> {
    if (!run.source_action_card_item_id) {
      return;
    }
    const toStatus = actionCardItemStatusForRunStatus(run.status);
    if (!toStatus) {
      return;
    }
    if (!run.workspace_id) {
      logger.warn("action_card_run_settlement_missing_workspace", {
        runId: run.run_id,
        itemId: run.source_action_card_item_id,
        runStatus: run.status
      });
      return;
    }
    try {
      await deps.actionCards.transitionItemStatus({
        itemId: run.source_action_card_item_id,
        workspaceId: run.workspace_id,
        fromStatuses: ACTION_CARD_RUN_SETTLEMENT_SOURCE_STATUSES,
        toStatus,
        at: now()
      });
      // 返回 null（CAS 落空）：条目已经不是 running 了（decide/undo/上一次结算已经动过它）——
      // 幂等 no-op，不是失败，见模块顶部"已知风险"对 cancelled 场景的说明；不额外记录，避免把
      // 正常的幂等 no-op 刷成日志噪音。
    } catch (error) {
      logger.warn("action_card_run_settlement_failed", {
        runId: run.run_id,
        itemId: run.source_action_card_item_id,
        runStatus: run.status,
        toStatus,
        error
      });
    }
  };
}
