import { getDefaultStructuredLogger } from "../logging.js";
import type { AgentRunConversationSystemMessagePoster, AgentRunQueueRecord } from "../workers/agent-runner.js";

// R13 批 S2（Cuu 异步化与进度可视，run 终态 PM 汇报）：一个带 source_conversation_id 的 run 到达终态时，
// 往那条会话里 post 一条 system_event，让 Cuu 以「项目经理例行同步」的口吻主动汇报——节点到了主动说，
// 不等人问（00 文档「Cuu 角色总纲」）。这个模块只挂进 apps/api/src/workers/agent-runner.ts 现有的
// AgentRunSettledHook 组合链（见该文件 getDefaultAgentRunQueue 里 runSettled 的挂接点），不改动
// agent-runner.ts 的执行逻辑本身。
//
// —— 终态 → 播报覆盖矩阵（本模块的唯一权威实现，报告里会原样引用这张表）——
//
// | run 终态   | 谁已经播报过           | 这个模块要不要再发 |
// |-----------|-----------------------|-------------------|
// | succeeded | 批 4b postDeliverableSystemMessage（proposal_opened / proposal_auto_merged，
// |           | 在 notifyRunSettled 之前已经 post 过「已生成变更申请，等待人工确认后采纳」/
// |           | 「已自动采纳 · 全托管」）——语义上就是「XX 干完了，提议在等审」        | 不发（避免重复播报） |
// | failed    | 没有任何人播报过（openProposalFromManifest 见 result.status!=='succeeded'
// |           | 直接短路，批 4b 完全不碰这条终态）                                     | 发 |
// | escalated | 同 failed——批 4b 同样短路不发                                         | 发 |
// | cancelled | 没有人播报过，但这是发起中止的人自己刚做的动作——PM 不需要转头汇报对方
// |           | 刚做完的事，这不是"异步、没人盯着"的场景                              | 不发（设计取舍，非遗漏） |
//
// 已知空白（不在本批范围内，见汇报「没做/存疑」）：succeeded 但因为 requireDeliverable=false /
// proposalSink 未接 / manifest 缺失而没有真正开出提议的边缘情况——run.status 仍是 "succeeded"，
// 却没有任何播报。要精确识别这种情况需要查这条会话里是否已经有一条 proposal_opened/auto_merged
// 消息（DB 读），但这批范围围栏不包含 packages/db 的仓库改动，所以本模块保守地把所有 succeeded
// 一律当作"已被批 4b 覆盖"处理，不额外发消息。

export type RunSettledReportOutcome = "failed" | "escalated";

export type RunSettledReportContent = {
  event: "run_settled_report";
  run_id: string;
  work_item_id: string;
  outcome: RunSettledReportOutcome;
  title: string;
  reason: string | null;
};

const FAILURE_REASON_MAX_LENGTH = 160;

// run 的最后一条 phase==='final' trace（finalizeExecutedRun / 执行循环的 catch 块都会在落终态前补一条，
// 见 agent-runner.ts）通常就是失败/升级原因最好的来源。这里只做"取最后一条、收成单行、封顶长度"——
// 纯函数，不猜测、不编造：trace 里没有可用文本就诚实返回 null，调用方据此走"具体原因还在整理"这句
// 兜底文案，不硬凑一个假原因（04 §4 铁律 3 的延伸）。
export function extractRunOutcomeReason(
  trace: ReadonlyArray<{ phase: string; output_excerpt?: string }>
): string | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const step = trace[i];
    if (step && step.phase === "final" && step.output_excerpt) {
      const singleLine = step.output_excerpt.replace(/\s+/gu, " ").trim();
      if (singleLine) {
        return singleLine.length > FAILURE_REASON_MAX_LENGTH
          ? `${singleLine.slice(0, FAILURE_REASON_MAX_LENGTH)}…`
          : singleLine;
      }
    }
  }
  return null;
}

// 终态 → 播报内容——undefined 代表"这个终态本模块不发"（见模块顶部矩阵：succeeded 已被批 4b 覆盖，
// cancelled/queued/running 都不该在这里触发播报）。
export function buildRunSettledReportContent(
  run: Pick<AgentRunQueueRecord, "run_id" | "work_item_id" | "title" | "status" | "trace">
): RunSettledReportContent | undefined {
  if (run.status !== "failed" && run.status !== "escalated") {
    return undefined;
  }
  return {
    event: "run_settled_report",
    run_id: run.run_id,
    work_item_id: run.work_item_id,
    outcome: run.status,
    title: run.title,
    reason: extractRunOutcomeReason(run.trace)
  };
}

export type RunConversationReportDeps = {
  postSystemMessage: AgentRunConversationSystemMessagePoster;
  now?: () => Date;
};

// 挂进 AgentRunSettledHook 组合链的那一环——best-effort：找不到会话来源 / 没有配置 poster / 发布失败
// 都只告警，绝不抛错。这条汇报是锦上添花，绝不能因为它失败就把一次已经真实结束的 run 判成"结算失败"、
// 触发 agent-runner.ts 里 agent_run_settled_hook_failed 的重试路径——那条路径是为 task-plan 结算这种
// "必须成功"的写路径设计的（见 services/task-dispatcher.ts 的 handleRunSettled），PM 汇报不是，跟批 4b
// postDeliverableSystemMessage 的取舍完全一致。
export function createRunConversationReportHook(deps: RunConversationReportDeps) {
  const now = deps.now ?? (() => new Date());
  return async function reportRunSettledToConversation(run: AgentRunQueueRecord): Promise<void> {
    if (!run.source_conversation_id || !run.workspace_id) {
      return;
    }
    const content = buildRunSettledReportContent(run);
    if (!content) {
      return;
    }
    try {
      await deps.postSystemMessage({
        workspaceId: run.workspace_id,
        conversationId: run.source_conversation_id,
        content,
        at: now()
      });
    } catch (error) {
      getDefaultStructuredLogger().warn("agent_run_conversation_report_failed", {
        error,
        runId: run.run_id,
        outcome: content.outcome
      });
    }
  };
}
