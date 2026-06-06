import assert from "node:assert/strict";
import test from "node:test";

import {
  cuuStates,
  eventTypes,
  type AgentRunLiveVM,
  type BudgetNotice,
  type ProposalDetailVM,
  type QuestionCard,
  type SessionVM,
  type WorkItemDetailVM,
  type WorkHubEvent
} from "@workhub/contracts";

import {
  allCuuMotionHints,
  assertValidCuuSpriteManifest,
  cardFromBudgetNotice,
  cardFromAttentionItem,
  cardFromEvent,
  cardFromProposalDetail,
  cardFromQuestionCard,
  cardFromSessionVm,
  cardFromAgentRunLive,
  cardFromWorkItemDetail,
  cuuSpriteClipForMotion,
  defaultCuuSpriteManifest,
  validateCuuSpriteManifest
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

test("Cuu motion hints cover every contract state", () => {
  const hints = allCuuMotionHints();

  assert.deepEqual(
    hints.map((hint) => hint.state).sort(),
    [...cuuStates].sort()
  );
  assert.equal(hints.every((hint) => hint.reduced_motion_fallback.includes("Cuu")), true);
});

test("default Cuu sprite manifest covers every motion hint", () => {
  const hints = allCuuMotionHints();

  assert.deepEqual(validateCuuSpriteManifest(defaultCuuSpriteManifest), []);
  assert.doesNotThrow(() => assertValidCuuSpriteManifest(defaultCuuSpriteManifest));
  for (const hint of hints) {
    const clip = cuuSpriteClipForMotion(hint, defaultCuuSpriteManifest);
    assert.equal(clip.state, hint.sprite_state);
    assert.equal(clip.loop, hint.loop);
    assert.ok(clip.frames.length >= 1);
    assert.equal(clip.frames.some((frame) => frame.id === clip.reduced_motion_frame_id), true);
  }
});

test("sprite manifest validation reports missing clips before Cuu runtime drifts", () => {
  const broken = {
    ...defaultCuuSpriteManifest,
    clips: {
      ...defaultCuuSpriteManifest.clips,
      asking_approval_bounce: {
        ...defaultCuuSpriteManifest.clips.asking_approval_bounce,
        frames: [],
        reduced_motion_frame_id: "missing-frame"
      }
    }
  };

  const issues = validateCuuSpriteManifest(broken);

  assert.equal(issues.some((issue) => issue.path === "clips.asking_approval_bounce.frames"), true);
  assert.equal(issues.some((issue) => issue.path === "clips.asking_approval_bounce.reduced_motion_frame_id"), true);
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
});
