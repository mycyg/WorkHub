import assert from "node:assert/strict";
import test from "node:test";

import {
  cuuStates,
  eventTypes,
  type AgentRunLiveVM,
  type BudgetNotice,
  type EvidenceBubble,
  type ProposalConflict,
  type ProposalDetailVM,
  type QuestionCard,
  type ReplayTraceVM,
  type SessionVM,
  type WorkItemDetailVM,
  type WorkHubEvent
} from "@workhub/contracts";

import {
  allCuuMotionHints,
  cardFromBudgetNotice,
  cardFromAttentionItem,
  cardFromEvent,
  cardFromEvidenceBubble,
  cardFromProposalDetail,
  cardFromProposalConflict,
  cardsFromProposalConflicts,
  cardFromQuestionCard,
  cardFromReplayTrace,
  cardFromSessionVm,
  cardFromAgentRunLive,
  cardFromWorkItemDetail
} from "./index.js";

const ts = "2026-06-05T01:00:00.000Z";
const workItemId = "10000000-0000-4000-8000-000000000001";

const budgetNotice: BudgetNotice = {
  code: "budget_exhausted",
  severity: "critical",
  message: "本次任务预算已经用完，Cuu 需要你选择下一步。",
  scope: { kind: "workitem", workitem_id: workItemId },
  usage_ratio: 1.04,
  recommended_action: "pause",
  options: [
    { id: "pause", label: "先暂停", action_href: `/api/workitems/${workItemId}/pause` },
    { id: "downgrade_model", label: "降级模型继续", action_href: `/api/workitems/${workItemId}/downgrade` }
  ],
  action_href: `/dashboard/cost?workItemId=${workItemId}`
};

function agentRunLive(status: AgentRunLiveVM["status"] = "running"): AgentRunLiveVM {
  const runId = "40000000-0000-4000-8000-000000000025";
  return {
    run: {
      id: runId,
      work_item_id: workItemId,
      mode: "worker",
      actor: "human",
      status,
      model: "deepseek-v4-flash",
      turns_used: 1,
      max_turns: 15,
      token_in: 10,
      token_out: 20,
      created_at: ts,
      updated_at: ts
    },
    run_id: runId,
    work_item_id: workItemId,
    title: "生成客户周报模板",
    status,
    budget: { max_steps: 15, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
    budget_decision: {
      decision_id: "decision-run",
      allowed: status !== "budget_exhausted",
      model_route: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" }
    },
    usage: { steps_used: 1, token_in: 10, token_out: 20, estimated_cost_cny: "0.003" },
    trace: [],
    stream_href: `/api/push/stream/run/${runId}`,
    replay_href: `/api/agent-runs/${runId}/replay`
  };
}

test("Cuu motion hints cover every contract state", () => {
  const hints = allCuuMotionHints();

  assert.deepEqual(
    hints.map((hint) => hint.state).sort(),
    [...cuuStates].sort()
  );
  assert.equal(hints.every((hint) => hint.reduced_motion_fallback.includes("Cuu")), true);
});

test("question cards stay option-first and keep free text collapsed", () => {
  const question: QuestionCard = {
    id: "question-1",
    session_id: "session-1",
    work_item_id: "work-1",
    title: "这次周报偏向哪种口吻？",
    body: "选一个方向即可。",
    input_mode: "single_choice",
    options: [
      { id: "brief", label: "简洁版", description: "适合快速同步。", risk_hint: "low" },
      { id: "detail", label: "详细版", description: "会展开更多证据。" }
    ],
    recommended_option_ids: ["brief"],
    free_text: {
      enabled: true,
      collapsed_by_default: true,
      placeholder: "确实需要时再补一句。",
      max_length: 120
    },
    progress: [
      { key: "goal", label: "目标", state: "done" },
      { key: "tone", label: "口吻", state: "active" }
    ],
    evidence_refs: [],
    submit: { method: "POST", href: "/api/sessions/session-1/next-question" }
  };

  const card = cardFromQuestionCard(question);

  assert.equal(card.kind, "question");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.input?.option_first, true);
  assert.equal(card.input?.free_text_collapsed_by_default, true);
  assert.equal(card.chips?.find((chip) => chip.id === "brief")?.recommended, true);
  assert.equal(card.actions[0]?.href, "/api/sessions/session-1/next-question");

  const english = cardFromQuestionCard({ ...question, body: undefined }, { locale: "en-US" });
  assert.equal(english.message, "Pick one option and Cuu will keep going.");
  assert.equal(english.actions[0]?.label, "Confirm option");
});

test("session VMs become option-first Cuu question cards", () => {
  const session: SessionVM = {
    session_id: "10000000-0000-4000-8000-000000000011",
    work_item_id: workItemId,
    topic: "生成客户周报模板",
    stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000011",
    next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000011/next-question",
    question: {
      id: "question-1",
      title: "这次周报偏向哪种口吻？",
      body: "选一个方向即可。",
      input_mode: "single_choice",
      options: [
        { id: "brief", label: "简洁版", description: "适合快速同步。" },
        { id: "detail", label: "详细版", description: "会展开更多证据。" }
      ],
      recommended_option_ids: ["brief"],
      free_text: {
        enabled: true,
        collapsed_by_default: true,
        placeholder: "确实需要时再补一句。"
      },
      progress: [{ key: "tone", label: "口吻", state: "active" }],
      evidence_refs: [],
      submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000011/next-question" }
    }
  };

  const card = cardFromSessionVm(session);

  assert.equal(card.id, session.session_id);
  assert.equal(card.kind, "question");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.payload_ref?.entity_type, "session");
  assert.equal(card.payload_ref?.href, session.next_question_href);
  assert.equal(card.source?.work_item_id, workItemId);
  assert.equal(card.input?.option_first, true);
  assert.equal(card.chips?.find((chip) => chip.id === "brief")?.recommended, true);
});

test("proposal detail becomes a PR-like Cuu deliverable card", () => {
  const proposal: ProposalDetailVM = {
    proposal_id: "proposal-1",
    work_item_id: "work-1",
    title: "周报草稿变更申请",
    status: "opened",
    manifest: {
      version: 0,
      proposal_id: "proposal-1",
      work_item_id: "work-1",
      title: "周报草稿变更申请",
      summary_md: "新增一份周报草稿，并附上证据与回滚说明。",
      author: { actor_kind: "ai", label: "Cuu" },
      base: { created_at: ts },
      changes: [
        {
          id: "change-1",
          target_kind: "text_doc",
          target_ref: { entity_type: "drive_item", path: "docs/weekly-report.md" },
          change_type: "generated",
          human_summary: "新增 weekly-report.md"
        }
      ],
      checks: [{ id: "scope", label: "file-only 范围", status: "passed", detail: "未触碰外部发送。" }],
      evidence_refs: [
        {
          id: "evidence-1",
          source_type: "work_item",
          source_id: "work-1",
          title: "原始需求",
          confidence_hint: "found"
        }
      ],
      risk: { level: "low", human_label: "低风险，可回滚", reversible: true },
      rollback: { available: true, description: "删除生成草稿即可回滚。" },
      review: { suggested_decision: "needs_human", reason_required_on_reject: true }
    },
    evidence_refs: [],
    review_actions: {
      approve: { id: "approve", label: "批准", method: "POST", href: "/api/proposals/proposal-1/review" },
      request_changes: {
        id: "request_changes",
        label: "要求修改",
        method: "POST",
        href: "/api/proposals/proposal-1/review",
        requires_reason: true
      },
      merge: { id: "merge", label: "合入", method: "POST", href: "/api/proposals/proposal-1/merge" }
    },
    comments: []
  };

  const card = cardFromProposalDetail(proposal);

  assert.equal(card.kind, "proposal");
  assert.equal(card.state, "carrying_document");
  assert.equal(card.actions.find((action) => action.id === "request_changes")?.requires_reason, true);
  assert.equal(card.sections?.some((section) => section.title === "风险与回滚"), true);
  assert.equal(card.chips?.[0]?.label, "docs/weekly-report.md");
  assert.equal(card.evidence_refs?.[0]?.title, "原始需求");

  const english = cardFromProposalDetail(proposal, { locale: "en-US" });
  assert.equal(english.sections?.some((section) => section.title === "Risk and rollback"), true);
  assert.equal(english.sections?.some((section) => section.lines.includes("Rollback available")), true);
});

test("proposal conflicts become option-first Cuu cards with merge payloads", () => {
  const conflict: ProposalConflict = {
    id: "conflict-weekly-report",
    work_item_id: workItemId,
    proposal_id: "10000000-0000-4000-8000-000000000301",
    merge_proposal_id: "10000000-0000-4000-8000-000000000309",
    change_id: "10000000-0000-4000-8000-000000000302",
    target_key: "drive_item:docs/weekly-report.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/weekly-report.md",
    headline: "weekly-report.md 已经被另一份变更更新",
    summary_text: "正式版和这次版本都改了同一个文档，先选保留正式版还是采纳这次版本。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000311",
      change_id: "10000000-0000-4000-8000-000000000312",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
    recommended_option_id: "keep_current",
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "保留已正式采纳的版本。",
        recommended: true,
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: "/api/proposals/10000000-0000-4000-8000-000000000301/merge",
          request_json: { conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "采纳这次版本",
        summary_text: "用这次版本覆盖正式版。",
        action: {
          id: "accept_incoming",
          label: "采纳这次版本",
          method: "POST",
          href: "/api/proposals/10000000-0000-4000-8000-000000000301/merge",
          request_json: {
            conflict_resolution: { accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"] }
          }
        }
      },
      {
        id: "ai_fusion",
        label: "采用 AI 融合稿",
        summary_text: "AI 已生成融合稿，点击后写入正式交付物。",
        action: {
          id: "apply_ai_fusion",
          label: "采用 AI 融合稿",
          method: "POST",
          href: "/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply",
          request_json: { confirm: true }
        }
      }
    ]
  };

  const card = cardFromProposalConflict(conflict);
  const english = cardFromProposalConflict(conflict, { locale: "en-US" });

  assert.equal(card.kind, "proposal");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.payload_ref?.entity_type, "proposal_conflict");
  assert.equal(card.actions.find((action) => action.id === "keep_current")?.tone, "primary");
  assert.equal(card.actions.find((action) => action.id === "accept_incoming")?.tone, "danger");
  assert.deepEqual(card.actions.find((action) => action.id === "accept_incoming")?.payload, {
    conflict_resolution: { accept_incoming_target_keys: ["drive_item:docs/weekly-report.md"] }
  });
  assert.equal(card.actions.find((action) => action.id === "ai_fusion")?.label, "采用 AI 融合稿");
  assert.equal(
    card.actions.find((action) => action.id === "ai_fusion")?.href,
    "/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply"
  );
  assert.deepEqual(card.actions.find((action) => action.id === "ai_fusion")?.payload, { confirm: true });
  assert.equal(card.actions.some((action) => action.id === "open_proposal"), true);
  assert.equal(cardsFromProposalConflicts([conflict]).length, 1);
  assert.equal(english.title, "Change conflict");
  assert.equal(english.actions.find((action) => action.id === "keep_current")?.label, "Keep current");
  assert.equal(english.actions.find((action) => action.id === "ai_fusion")?.label, "Use AI fusion draft");
});

test("work item detail becomes a lightweight Cuu task card", () => {
  const detail = {
    workitem: {
      id: workItemId,
      code: "CSW-1",
      project_id: "10000000-0000-4000-8000-000000000002",
      title: "生成客户周报模板",
      status: "ai_working",
      summary_md: "Cuu 已开始读取会议和网盘证据。"
    },
    acceptance: [{ title: "输出必须绑定证据", status: "open" }],
    agent_trace_preview: [
      {
        agent_run_id: "10000000-0000-4000-8000-000000000003",
        step_no: 1,
        phase: "think",
        output_excerpt: "已按风险优先口径开始处理。"
      }
    ],
    evidence_refs: [
      {
        id: "10000000-0000-4000-8000-000000000004",
        source_type: "meeting",
        source_id: "meeting-weekly-sync",
        title: "上次周会纪要"
      }
    ]
  } as unknown as WorkItemDetailVM;

  const card = cardFromWorkItemDetail(detail);

  assert.equal(card.kind, "trace");
  assert.equal(card.state, "thinking");
  assert.equal(card.payload_ref?.entity_type, "workitem");
  assert.equal(card.actions.some((action) => action.href === `/agent-runs/${detail.agent_trace_preview[0]?.agent_run_id}/replay`), true);
  assert.equal(card.evidence_refs?.[0]?.title, "上次周会纪要");
});

test("findings: acceptance items with non-string title/status fall back instead of rendering [object Object]", () => {
  const detail = {
    workitem: {
      id: "10000000-0000-4000-8000-000000000002",
      code: "CSW-2",
      project_id: "10000000-0000-4000-8000-000000000002",
      title: "坏数据验收项",
      status: "ai_working",
      summary_md: "验收项含非字符串字段。"
    },
    // z.unknown() 允许任意值——模拟坏数据：title 是对象、status 是数字。
    acceptance: [{ title: { nested: true }, status: 5 }],
    agent_trace_preview: [],
    evidence_refs: []
  } as unknown as WorkItemDetailVM;

  const card = cardFromWorkItemDetail(detail);
  const line = card.sections?.find((section) => section.id === "acceptance")?.lines[0] ?? "";
  assert.equal(line.includes("[object Object]"), false);
  assert.equal(line.includes(": 5"), false);
  assert.equal(line.endsWith(": open"), true);
});

test("evidence bubbles preserve task binding POST actions", () => {
  const bubble: EvidenceBubble = {
    id: "00000000-0000-4000-8000-000000000302",
    query_text: "客户成功周报模板",
    summary_text: "找到了会议纪要和网盘表格。",
    evidence_refs: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        source_type: "meeting",
        source_id: "weekly-sync",
        title: "上次周会纪要",
        confidence_hint: "found"
      }
    ],
    actions: [
      {
        id: "use_for_current_task",
        label: "用这些证据继续",
        method: "POST",
        href: `/api/workitems/${workItemId}/evidence-bindings`
      }
    ]
  };

  const card = cardFromEvidenceBubble(bubble);

  assert.equal(card.kind, "evidence");
  assert.equal(card.actions[0]?.tone, "primary");
  assert.equal(card.actions[0]?.method, "POST");
  assert.equal(card.actions[0]?.href, `/api/workitems/${workItemId}/evidence-bindings`);
  assert.equal(card.evidence_refs?.length, 1);
});

test("live agent runs become immediate Cuu trace cards before SSE catches up", () => {
  const live = {
    run: {
      id: "40000000-0000-4000-8000-000000000025",
      work_item_id: workItemId,
      mode: "worker",
      actor: "human",
      status: "running",
      model: "deepseek-v4-flash",
      turns_used: 1,
      max_turns: 15,
      token_in: 10,
      token_out: 20,
      created_at: ts,
      updated_at: ts
    },
    run_id: "40000000-0000-4000-8000-000000000025",
    work_item_id: workItemId,
    title: "生成客户周报模板",
    status: "running",
    budget: { max_steps: 15, total_timeout_s: 300, max_tokens: 120000, max_cost_cny: "5" },
    budget_decision: {
      decision_id: "decision-run",
      allowed: true,
      model_route: { provider: "deepseek", model: "deepseek-v4-flash", reason: "default" }
    },
    usage: { steps_used: 1, token_in: 10, token_out: 20, estimated_cost_cny: "0.003" },
    trace: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        agent_run_id: "40000000-0000-4000-8000-000000000025",
        step_no: 1,
        phase: "think",
        input_json: {},
        output_excerpt: "Cuu 正在读取项目文档。",
        created_at: ts
      }
    ],
    stream_href: "/api/push/stream/run/40000000-0000-4000-8000-000000000025",
    replay_href: "/api/agent-runs/40000000-0000-4000-8000-000000000025/replay"
  } satisfies AgentRunLiveVM;

  const card = cardFromAgentRunLive(live);
  const doneCard = cardFromAgentRunLive({
    ...live,
    run: { ...live.run, status: "succeeded" },
    status: "succeeded"
  });

  assert.equal(card.kind, "trace");
  assert.equal(card.state, "thinking");
  assert.equal(card.payload_ref?.entity_type, "agent_run");
  assert.equal(card.actions.some((action) => action.id === "abort_agent_run"), true);
  assert.equal(doneCard.kind, "completion");
  assert.equal(doneCard.state, "celebrating");
  assert.equal(doneCard.actions.some((action) => action.id === "abort_agent_run"), false);
});

test("budget-exhausted live agent runs use budget Cuu cards", () => {
  const card = cardFromAgentRunLive(agentRunLive("budget_exhausted"), { locale: "en-US" });

  assert.equal(card.kind, "budget");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.title, "Budget exhausted");
  assert.equal(card.message, "This task reached its budget limit and needs your decision.");
  assert.equal(card.actions.find((action) => action.id === "view_replay")?.tone, "primary");
  assert.equal(card.actions.some((action) => action.id === "abort_agent_run"), false);
});

test("replay cost cards localize remaining budget labels", () => {
  const usage = {
    scope: { kind: "user" as const, user_id: "10000000-0000-4000-8000-000000000101" },
    scope_label: "Personal budget",
    policy_id: "policy-user-day",
    period: "day" as const,
    period_start: ts,
    period_end: ts,
    token_in: 10,
    token_out: 20,
    total_tokens: 30,
    max_tokens: 1000,
    remaining_tokens: 970,
    estimated_cost_cny: "0.003",
    max_cost_cny: "5",
    remaining_cost_cny: "4.997",
    warning_ratio: 0.8,
    status: "ok" as const
  };
  const replay: ReplayTraceVM = {
    run: agentRunLive("succeeded").run,
    steps: [],
    evidence_refs: [],
    snapshots: [],
    audit_logs: [],
    accepted_deliverables: [],
    merge_timeline: [],
    cost: {
      me: usage,
      scopes: [usage],
      active_notices: [],
      generated_at: ts
    }
  };

  const card = cardFromReplayTrace(replay, { locale: "en-US" });
  const costLines = card.sections?.find((section) => section.id === "cost")?.lines.join(" ") ?? "";

  assert.match(costLines, /¥4\.997 remaining/u);
  assert.doesNotMatch(costLines, /剩余/u);
});

test("budget notices and budget events become actionable Cuu cards", () => {
  const card = cardFromBudgetNotice(budgetNotice, "budget-card");
  const attentionCard = cardFromAttentionItem({
    id: "30000000-0000-4000-8000-000000000009",
    kind: "budget",
    priority: "urgent",
    source_ref: { entity_type: "budget_notice", entity_id: "30000000-0000-4000-8000-000000000009" },
    title: "预算用完了",
    summary_text: budgetNotice.message,
    actions: [
      {
        id: "pause",
        label: "先暂停",
        style: "primary",
        method: "POST",
        href: `/api/workitems/${workItemId}/pause`
      }
    ],
    cuu_state: "asking_approval",
    created_at: ts
  });
  const event: WorkHubEvent<BudgetNotice> = {
    event_id: "event-budget",
    type: eventTypes.budgetExhausted,
    topic: "workitem:work-1",
    ts,
    preview_text: budgetNotice.message,
    data: budgetNotice
  };
  const eventCard = cardFromEvent(event);

  assert.equal(card.kind, "budget");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.actions[0]?.tone, "primary");
  assert.equal(attentionCard.kind, "budget");
  assert.equal(attentionCard.state, "asking_approval");
  assert.equal(eventCard.id, "event-budget");
  assert.equal(eventCard.kind, "budget");
  assert.equal(eventCard.actions[0]?.href, `/api/workitems/${workItemId}/pause`);

  const { options: _options, ...budgetNoticeWithoutOptions } = budgetNotice;
  const english = cardFromBudgetNotice(budgetNoticeWithoutOptions, "budget-card-en", { locale: "en-US" });
  assert.equal(english.title, "Budget exhausted");
  assert.equal(english.actions[0]?.label, "Handle budget");
  assert.equal(english.chips?.[0]?.label, "Task budget");
  assert.equal(english.chips?.[1]?.description, "Budget usage");
});

test("generic permission events still map through attention into Cuu approval cards", () => {
  const event: WorkHubEvent<unknown> = {
    event_id: "event-permission",
    type: eventTypes.permissionAsk,
    topic: "user:user-1",
    ts,
    preview_text: "Cuu 需要你批准这次 file-only 变更。",
    data: { approval_id: "approval-1" }
  };

  const card = cardFromEvent(event);

  assert.equal(card.kind, "approval");
  assert.equal(card.state, "asking_approval");
  assert.equal(card.title, "Cuu 需要你批准这次 file-only 变更。");
});

test("generic English events use localized fallback instead of Chinese attention defaults", () => {
  const card = cardFromEvent({
    event_id: "event-generic-en",
    type: eventTypes.notificationCreated,
    topic: "user:user-1",
    ts,
    data: {}
  }, { locale: "en-US" });

  assert.equal(card.kind, "bubble");
  assert.equal(card.title, "WorkHub update");
  assert.equal(card.message, "Cuu received a new status update.");
  assert.doesNotMatch(`${card.title} ${card.message}`, /[\u3400-\u9fff]/u);
});

test("agent run events become trace and completion cards for live Cuu updates", () => {
  const step: WorkHubEvent<unknown> = {
    event_id: "event-step",
    type: eventTypes.agentRunStep,
    topic: "run:run-1",
    ts,
    run_id: "run-1",
    preview_text: "Cuu 正在读取项目文档。",
    cuu_state: "thinking",
    data: { kind: "step", summary: "读取项目文档" }
  };
  const done: WorkHubEvent<unknown> = {
    event_id: "event-done",
    type: eventTypes.agentRunStep,
    topic: "run:run-1",
    ts,
    run_id: "run-1",
    preview_text: "Cuu 已经完成本次执行。",
    cuu_state: "celebrating",
    data: { kind: "done", status: "succeeded" }
  };

  const stepCard = cardFromEvent(step);
  const doneCard = cardFromEvent(done);

  assert.equal(stepCard.kind, "trace");
  assert.equal(stepCard.state, "thinking");
  assert.equal(stepCard.actions[0]?.href, "/agent-runs/run-1/replay");
  assert.equal(doneCard.kind, "completion");
  assert.equal(doneCard.state, "celebrating");
  assert.equal(doneCard.actions[0]?.tone, "primary");

  const { preview_text: _stepPreview, ...stepWithoutPreview } = step;
  const english = cardFromEvent(stepWithoutPreview, { locale: "en-US" });
  assert.equal(english.title, "Cuu is working");
  assert.equal(english.message, "读取项目文档");
  assert.equal(english.actions[0]?.label, "View replay");

  const englishFallback = cardFromEvent(
    { ...stepWithoutPreview, data: { kind: "step" } },
    { locale: "en-US" }
  );
  assert.equal(englishFallback.message, "Cuu is organizing the run progress.");
});
