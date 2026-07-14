// R12 批 4b · 模式五档第 5 档「全托管 · AI 审」红线单测。
//
// 现行为收紧记录（诚实审计，不是我改的断言——这几条断言此前不存在，是本批新写的）：
// 收紧前，createAgentRunConfidenceRecorder() 在生产环境（apps/api/src/workers/agent-runner.ts 的
// getDefaultAgentRunQueue）从不传 autoMergeAllowed，评估函数据此永远把 auto_merge 降级成
// human_spotcheck——换句话说线上此前从未真正自动合并过一次。本批把「要不要允许自动合并」从一个
// 静态开关，改成逐 run 现查 assignee（run.actor_id）此刻的 user_ai_profiles.default_mode：
// mode===5 才置真，mode<5（含默认档 3）一律 false。这是收紧/精确化，不是放宽——原来更保守
// （从不自动合并），现在只是在 mode===5 的用户显式选择「全托管」时才放行，其余场景行为不变。
//
// 「高风险类别永远升级给人」这条红线的真正实现在 apps/api/src/services/human-reserved-guard.ts
// （legal/finance/identity/publish/external 分类，工具调用时机拦截，工作项 human_reserved 标记）——
// 它运作在完全独立的更早阶段（run 成功产出交付物之前），本批完全没有touch 这层，其既有覆盖见
// apps/api/src/agent-runs.test.ts 里 "agent run enqueue opens user_forbidden escalation for
// human-reserved worker work"（本批修改后该测试仍然全绿，见汇报）。置信度矩阵自身的
// riskLevel==="high" 分支（dimensions.external/monetary/domain_gate）在当前 AgentLoopResult 契约下
// 对成功态 run 永远算不出 "high"（riskDimensionsFor 只按 hasSnapshot/status 打分，三个高风险维度
// 恒为 0——这是既有代码的既有事实，不是本批引入的）,所以这里不构造一个人为达不到的场景，改用
// 真实可达的「grade===low 强制升级」验证 mode===5 不能凌驾于置信度矩阵自身的裁决之上（见下方
// 用例三）——这就是本批唯一能动、也确实动了的裁决点上的红线。
import assert from "node:assert/strict";
import test from "node:test";

import type { AgentLoopResult } from "@workhub/agent";
import type { AiDecisionRepository, AiSettingsRepository, AuditLogRepository } from "@workhub/db";

import {
  createAgentRunConfidenceRecorder,
  createAgentRunUserAiModeResolver
} from "./agent-run-confidence.js";
import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

const workItemId = "50000000-0000-4000-8000-000000000001";
const runId = "40000000-0000-4000-8000-000000000001";
const actorUserId = "30000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";

function fakeDecisions() {
  const confidenceRows: Record<string, unknown>[] = [];
  const escalationRows: Record<string, unknown>[] = [];
  const decisions = {
    async createConfidenceRecord(input: Parameters<AiDecisionRepository["createConfidenceRecord"]>[0]) {
      const row = { id: `confidence-${confidenceRows.length + 1}`, ...input };
      confidenceRows.push(row);
      return row as unknown as Awaited<ReturnType<AiDecisionRepository["createConfidenceRecord"]>>;
    },
    async listConfidenceRecordsForWorkItem() {
      return [];
    },
    async findConfidenceRecordForAgentRun() {
      return null;
    },
    async createEscalationEvent(input: Parameters<AiDecisionRepository["createEscalationEvent"]>[0]) {
      const row = { id: `escalation-${escalationRows.length + 1}`, ...input };
      escalationRows.push(row);
      return row as unknown as Awaited<ReturnType<AiDecisionRepository["createEscalationEvent"]>>;
    },
    async listEscalationEventsForWorkItem() {
      return [];
    },
    async findEscalationById() {
      return null;
    }
  } as unknown as AiDecisionRepository;
  return { decisions, confidenceRows, escalationRows };
}

function fakeAuditLogs() {
  const rows: Record<string, unknown>[] = [];
  const auditLogs = {
    async createAuditLog(input: Parameters<AuditLogRepository["createAuditLog"]>[0]) {
      const row = { id: `audit-${rows.length + 1}`, ...input };
      rows.push(row);
      return row as unknown as Awaited<ReturnType<AuditLogRepository["createAuditLog"]>>;
    },
    async listAuditLogsForEntity() {
      return [];
    },
    async listAuditLogsForWorkItem() {
      return [];
    },
    async markAuditLogUndone() {
      return null;
    }
  } as unknown as AuditLogRepository;
  return { auditLogs, rows };
}

function agentRun(partial: Partial<AgentRunQueueRecord> = {}): AgentRunQueueRecord {
  return {
    run_id: runId,
    workspace_id: workspaceId,
    work_item_id: workItemId,
    actor_id: actorUserId,
    mode: "worker",
    status: "running",
    title: "R12 批 4b 全托管档 run",
    budget: { max_steps: 15, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
    budget_decision: {
      decision_id: "batch-4b-budget",
      allowed: true,
      model_route: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" }
    },
    usage: { steps_used: 1, token_in: 100, token_out: 20, estimated_cost_cny: "0.01" },
    trace: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial
  };
}

// 高置信+低风险+manifest 齐全的成功结果——唯一变量是 review.grade。
function succeededResult(reviewGrade: 1 | 2 | 3 | 4 | 5): AgentLoopResult {
  return {
    status: "succeeded",
    reason: "交付完成",
    control: "stop",
    usage: { stepsUsed: 1, secondsUsed: 1, tokenIn: 100, tokenOut: 20, totalTokens: 120, estimatedCostCny: "0.01" },
    steps: [
      {
        index: 1,
        assistant: [{ type: "text", text: "done" }],
        toolCalls: [],
        toolResults: [],
        control: "stop",
        snapshotId: "60000000-0000-4000-8000-000000000001",
        startedAt: "2026-07-12T00:00:00.000Z",
        endedAt: "2026-07-12T00:00:01.000Z"
      }
    ],
    manifest: {
      version: 0,
      work_item_id: workItemId,
      title: "交付物",
      summary_md: "生成了可审阅的交付物。",
      author: { actor_kind: "ai", label: "AI 工人" },
      base: { snapshot_id: "60000000-0000-4000-8000-000000000001", branch_head_ref: "head" },
      changes: [
        {
          id: "71000000-0000-4000-8000-000000000001",
          target_kind: "text_doc",
          target_ref: { entity_type: "external", path: "/outputs/result.md" },
          change_type: "created",
          human_summary: "新增结果文档"
        }
      ],
      checks: [],
      evidence_refs: [],
      risk: { level: "low", human_label: "可回滚", reversible: true },
      rollback: { available: true, snapshot_id: "60000000-0000-4000-8000-000000000001", description: "可还原到执行前" },
      review: { reason_required_on_reject: true }
    },
    review: {
      source: "llm_review",
      grade: reviewGrade,
      rationale: reviewGrade === 5 ? "可直接采纳" : "还需要看一眼",
      model: "deepseek-v4-flash"
    }
  };
}

test("R12 批 4b 红线 1/3：mode < 5 时即便评审给了 grade 5，也只降级为 human_spotcheck（开提议等人审），不自动合并", async () => {
  const { decisions } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    // 默认档 3（未定制过 AI 偏好的常见情形）——不是刻意挑的边界值，就是 DEFAULT_USER_AI_PROFILE。
    modeResolver: async () => 3
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(5),
    proposalWillOpen: true
  });

  assert.equal(recorded.verdict, "human_spotcheck");
});

test("R12 批 4b 红线 2/3：mode === 5 且评审给了 grade 5 时自动合并（全托管 · AI 审）", async () => {
  const { decisions } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    modeResolver: async () => 5
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(5),
    proposalWillOpen: true
  });

  assert.equal(recorded.verdict, "auto_merge");
});

test("R12 批 4b 红线 3/3：mode === 5 不能凌驾置信度矩阵自身的裁决——AI 自评低分（grade 1）时仍然升级人审，不会被全托管模式强行合并", async () => {
  const { decisions } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    modeResolver: async () => 5
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(1),
    proposalWillOpen: true
  });

  assert.equal(recorded.verdict, "escalate");
});

test("显式传入 autoMergeAllowed 时是硬覆盖，完全跳过 modeResolver（组织级开关/测试专用路径不变）", async () => {
  const { decisions } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  let modeResolverCalls = 0;
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    autoMergeAllowed: true,
    modeResolver: async () => {
      modeResolverCalls += 1;
      return 1;
    }
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(5),
    proposalWillOpen: true
  });

  assert.equal(recorded.verdict, "auto_merge");
  assert.equal(modeResolverCalls, 0);
});

test("modeResolver 抛错时 fail-closed（不自动合并，即便评审是 grade 5）", async () => {
  const { decisions } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    modeResolver: async () => {
      throw new Error("ai-settings repository unavailable");
    }
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(5),
    proposalWillOpen: true
  });

  assert.equal(recorded.verdict, "human_spotcheck");
});

// ── createAgentRunUserAiModeResolver（默认实现）单测 ──────────────────────────────────────

test("createAgentRunUserAiModeResolver：没有 workspaceId 时回落默认档（不查仓库）", async () => {
  let calls = 0;
  const resolver = createAgentRunUserAiModeResolver({
    aiSettings: {
      async findUserProfileAccessRecord() {
        calls += 1;
        return { membershipRole: "member", profile: null };
      }
    }
  });

  const mode = await resolver({ userId: actorUserId });

  assert.equal(mode, 3);
  assert.equal(calls, 0);
});

test("createAgentRunUserAiModeResolver：有效成员资格但从未定制档位时回落默认档 3", async () => {
  const resolver = createAgentRunUserAiModeResolver({
    aiSettings: {
      async findUserProfileAccessRecord() {
        return { membershipRole: "member", profile: null };
      }
    }
  });

  const mode = await resolver({ workspaceId, userId: actorUserId });

  assert.equal(mode, 3);
});

test("createAgentRunUserAiModeResolver：读到自定义档位时如实返回", async () => {
  const resolver = createAgentRunUserAiModeResolver({
    aiSettings: {
      async findUserProfileAccessRecord() {
        return {
          membershipRole: "member",
          profile: { defaultMode: 5 } as unknown as NonNullable<
            Awaited<ReturnType<AiSettingsRepository["findUserProfileAccessRecord"]>>
          >["profile"]
        };
      }
    }
  });

  const mode = await resolver({ workspaceId, userId: actorUserId });

  assert.equal(mode, 5);
});

test("createAgentRunUserAiModeResolver：仓库查询失败时 fail-closed 回落默认档 3", async () => {
  const resolver = createAgentRunUserAiModeResolver({
    aiSettings: {
      async findUserProfileAccessRecord() {
        throw new Error("db unavailable");
      }
    }
  });

  const mode = await resolver({ workspaceId, userId: actorUserId });

  assert.equal(mode, 3);
});

// R14 GAP-2 补测：findings[H9] 把「开升级事件」和「工作项真的推进 escalated」接在一起
// （agent-run-confidence.ts 244-250 行），但本文件此前没有任何用例直接调用过
// transitionWorkItemStatus 这个缝隙——只在 agent-runs.test.ts 里跟 agent-runner 的其余流程
// 混在一起间接跑过。这里补两条隔离用例：正常路径真的转 escalated；状态迁移失败时
// 升级创建本身不能被拖垮（best-effort）。
test("R14 GAP-2：置信度记录器开出升级事件时，真的调用 transitionWorkItemStatus 把工作项推进 escalated（无可审阅提议）", async () => {
  const { decisions, escalationRows } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  const transitions: Array<{ workItemId: string; to: string }> = [];
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    autoMergeAllowed: false,
    transitionWorkItemStatus: async (input) => {
      transitions.push({ workItemId: input.workItemId, to: input.to });
    }
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(1),
    proposalWillOpen: false
  });

  assert.equal(recorded.verdict, "escalate");
  assert.equal(escalationRows.length, 1, "an escalation event must be opened");
  assert.deepEqual(transitions, [{ workItemId, to: "escalated" }]);
});

test("R14 GAP-2：工单已到终态导致状态迁移落空（reject）时，升级创建本身依旧成功（best-effort，不许被状态迁移拖垮）", async () => {
  const { decisions, escalationRows } = fakeDecisions();
  const { auditLogs } = fakeAuditLogs();
  const recorder = createAgentRunConfidenceRecorder({
    decisions,
    auditLogs,
    autoMergeAllowed: false,
    transitionWorkItemStatus: async () => {
      throw new Error("work item already cancelled — no legal predecessor for escalated");
    }
  });

  const recorded = await recorder({
    run: agentRun(),
    result: succeededResult(1),
    proposalWillOpen: false
  });

  assert.equal(recorded.verdict, "escalate");
  assert.equal(escalationRows.length, 1);
  assert.ok(recorded.escalationId, "escalation must still be reported even though the status transition failed");
});
