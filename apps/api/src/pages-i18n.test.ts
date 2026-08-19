import assert from "node:assert/strict";
import test from "node:test";

import { deliverableManifestFixtures } from "@workhub/contracts";
import { loadSettings } from "@workhub/config";
import { toApprovalAttentionItem } from "@workhub/permissions";

import { buildAttentionHomePage } from "./pages/attention.js";
import { buildCostDashboardPage } from "./pages/cost.js";
import { buildP05GoldPathSurfacePage } from "./pages/gold-path.js";
import { buildProposalDetailPage } from "./pages/proposals.js";
import { buildReplayTracePage } from "./pages/replay.js";
import { buildSettingsPage } from "./pages/settings.js";
import { createInMemoryWorkItemService } from "./services/work-items.js";
import type { StoredProposal } from "./services/proposals.js";
import type { AgentRunQueueRecord } from "./workers/agent-runner.js";

const at = "2026-06-11T09:00:00.000Z";
const userId = "10000000-0000-4000-8000-000000000010";
const workItemId = "10000000-0000-4000-8000-000000000020";
const runId = "10000000-0000-4000-8000-000000000030";

function runRecord(
  partial: Partial<AgentRunQueueRecord> = {},
  options: { withoutHandoff?: boolean } = {}
): AgentRunQueueRecord {
  const record: AgentRunQueueRecord = {
    run_id: runId,
    work_item_id: workItemId,
    actor_id: userId,
    mode: "worker",
    status: "running",
    title: "Regional launch review",
    budget: {
      max_steps: 10,
      total_timeout_s: 300,
      max_tokens: 100,
      max_cost_cny: "1"
    },
    budget_decision: {
      decision_id: "decision-1",
      allowed: true,
      model_route: {
        provider: "openai",
        model: "test-model",
        reason: "default"
      }
    },
    usage: {
      steps_used: 2,
      token_in: 80,
      token_out: 10,
      estimated_cost_cny: "0.5"
    },
    trace: [
      {
        id: "step-1",
        step_no: 1,
        phase: "tool_result",
        output_excerpt: "Seeded run step",
        created_at: at
      }
    ],
    handoff: {
      done: ["kept source text"],
      remaining: ["human review"],
      next_steps: ["approve or request changes"],
      blockers: [],
      artifacts: [],
      budget_hit: "none"
    },
    created_at: at,
    updated_at: at,
    ...partial
  };
  if (options.withoutHandoff) {
    delete record.handoff;
  }
  return record;
}

test("Page VM builders localize generated English copy without translating user/source text", () => {
  const attention = buildAttentionHomePage({
    locale: "en-US",
    backgroundRuns: [runRecord({}, { withoutHandoff: true })]
  });
  assert.equal(attention.background_runs[0]?.preview_text, "AI is working on this item.");
  assert.equal(attention.background_runs[0]?.title, "Regional launch review");

  const settings = loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
  const cost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId,
    locale: "en-US",
    generatedAt: new Date(at),
    ledgerEntries: []
  });
  assert.equal(cost.budget[0]?.scope_label, "My AI budget today");
  assert.equal(cost.budget[1]?.scope_label, "Team AI budget today");
  const monthCost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId,
    locale: "en-US",
    generatedAt: new Date(at),
    budgetUsages: [
      {
        scope: { kind: "team", teamId: settings.auth.defaultWorkspaceId },
        scopeLabel: "团队 AI 预算",
        policyId: "pcost-team-month-v0",
        period: "month",
        periodStart: at,
        periodEnd: at,
        tokenIn: 1,
        tokenOut: 2,
        totalTokens: 3,
        maxTokens: 100,
        remainingTokens: 97,
        estimatedCostCny: "0.1",
        maxCostCny: "1",
        remainingCostCny: "0.9",
        warningRatio: 0.1,
        status: "ok"
      }
    ],
    ledgerEntries: []
  });
  assert.equal(monthCost.budget[0]?.scope_label, "Team AI budget this month");
  const customCost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId,
    locale: "en-US",
    generatedAt: new Date(at),
    budgetUsages: [
      {
        scope: { kind: "team", teamId: "10000000-0000-4000-8000-000000000030" },
        scopeLabel: "Marketing Team",
        policyId: "custom-team",
        period: "day",
        periodStart: at,
        periodEnd: at,
        tokenIn: 1,
        tokenOut: 2,
        totalTokens: 3,
        maxTokens: 100,
        remainingTokens: 97,
        estimatedCostCny: "0.1",
        maxCostCny: "1",
        remainingCostCny: "0.9",
        warningRatio: 0.1,
        status: "ok"
      }
    ],
    ledgerEntries: []
  });
  assert.equal(customCost.budget[0]?.scope_label, "Marketing Team");
  const costWithNotice = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId,
    locale: "en-US",
    generatedAt: new Date(at),
    budgetNotices: [
      {
        code: "budget_exhausted",
        severity: "critical",
        message: "AI 预算已经用完，先暂停新的自动执行。",
        scope: { kind: "objective", objectiveId: "10000000-0000-4000-8000-000000000060" },
        usageRatio: 1,
        recommendedAction: "add_budget",
        options: [
          { id: "add_budget", label: "追加预算继续", actionHref: "/dashboard/cost?objectiveId=10000000-0000-4000-8000-000000000060" },
          { id: "finish_current_output", label: "就用现有产出收尾", actionHref: "/workitems/demo" },
          { id: "close_scope", label: "整体收工", actionHref: "/workitems/demo" },
          { id: "downgrade_model", label: "降级模型继续", actionHref: "/dashboard/cost" },
          { id: "ask_admin", label: "找管理员", actionHref: "/dashboard/cost" }
        ],
        actionHref: "/dashboard/cost?objectiveId=10000000-0000-4000-8000-000000000060"
      }
    ],
    ledgerEntries: []
  });
  assert.deepEqual(costWithNotice.notices[0]?.options?.map((option) => option.label), [
    "Add budget and continue",
    "Finish with current output",
    "Close scope",
    "Use a cheaper model",
    "Ask an admin"
  ]);

  const settingsPage = buildSettingsPage({
    settings,
    readiness: {
      ready: true,
      checks: { database: { ok: true }, broker: { ok: true } }
    },
    locale: "en-US",
    generatedAt: new Date(at)
  });
  assert.equal(settingsPage.locale, "en-US");
  assert.equal(settingsPage.runtime.runtime_status, "ready");
  assert.equal(settingsPage.llm_runtime.default_model, "deepseek-v4-flash");
  assert.equal(settingsPage.llm_runtime.api_key_configured, false);
  assert.equal(settingsPage.language.preference_locale, "en-US");
  assert.equal(settingsPage.language.preference_source, "request");
  assert.equal(settingsPage.language.preference_synced, true);
  assert.equal(settingsPage.language.update_href, "/api/auth/preferences");
  const blockedBaseUrl = "https://api." + "deepseek.com";
  assert.equal(JSON.stringify(settingsPage).includes(blockedBaseUrl), false);
  assert.equal(JSON.stringify(settingsPage).includes("sk-"), false);
  assert.equal(settingsPage.device.pet_model_settings_in_web, false);
  assert.equal(settingsPage.device.restore_requires_desktop, true);
  assert.equal(settingsPage.device.web_local_actions_enabled, false);

  const proposal = buildProposalDetailPage({
    id: "10000000-0000-4000-8000-000000000040",
    work_item_id: workItemId,
    title: "Keep original proposal title",
    status: "reviewed",
    diff_manifest: deliverableManifestFixtures[0]!,
    reviews: [
      {
        id: "10000000-0000-4000-8000-000000000041",
        reviewer_kind: "human",
        reason_md: "Keep this reviewer note untranslated.",
        created_at: at
      }
    ]
  } as StoredProposal, "en-US");
  assert.equal(proposal.review_actions.request_changes.label, "Request changes with a reason");
  assert.equal(proposal.review_actions.merge?.label, "Merge deliverable");
  assert.equal(proposal.comments[0]?.author_label, "Owner");
  assert.equal(proposal.comments[0]?.body, "Keep this reviewer note untranslated.");

  const replay = buildReplayTracePage({ run: runRecord({ handoff: { ...runRecord().handoff!, done: ["kept source text", "second source text"] } }), locale: "en-US" });
  assert.equal(replay.run.handoff_md?.includes("Done: kept source text; second source text"), true);
  assert.equal(replay.run.handoff_md?.includes("Remaining: human review"), true);
  assert.equal(replay.cost?.me.scope_label, "My current AI run budget");
  assert.equal(replay.cost?.active_notices[0]?.message, "This AI run is close to its budget.");
  assert.equal(replay.steps.length, 1);
});

test("Page VM route builders localize remaining generated labels through locale", async () => {
  const surface = buildP05GoldPathSurfacePage("en-US");
  assert.equal(surface.page_vms.question.options[0]?.label, "Risk first");
  assert.equal(surface.page_vms.question.progress[0]?.label, "Intent");
  assert.equal(surface.page_vms.approvals.items[0]?.actions.some((action) => action.label === "Approve"), true);
  assert.equal(surface.page_vms.proposal.review_actions.request_changes.label, "Request changes with a reason");
  assert.equal(surface.page_vms.cost.budget.some((usage) => usage.scope_label === "My AI budget today"), true);

  const approval = toApprovalAttentionItem({
    id: "10000000-0000-4000-8000-000000000050",
    actionPattern: "tool.write_file",
    payloadJson: {
      ui: {
        summary_text: "保留这段审批摘要原文。",
        reason_text: "保留这段审批原因原文。"
      }
    },
    status: "pending",
    createdAt: at
  }, { locale: "en-US" });
  assert.equal(approval.actions[0]?.label, "Approve");
  assert.equal(approval.actions[1]?.label, "Request changes");
  assert.equal(approval.summary_text, "保留这段审批摘要原文。");

  const workItems = createInMemoryWorkItemService({ now: () => new Date(at), id: () => workItemId });
  const session = await workItems.createSession({
    actor: {
      id: userId,
      kind: "human",
      label: "Owner",
      isAdmin: true,
      orgId: "10000000-0000-4000-8000-000000000011",
      workspaceId: "10000000-0000-4000-8000-000000000012"
    },
    locale: "en-US",
    payload: { intent_text: "Keep this user text untranslated." }
  });
  assert.equal(session.question.title, "Confirm the acceptance rule for \"Keep this user text untranslated\"");
  assert.notEqual(session.question.title, "Which delivery path should this use first?");
  assert.notEqual(session.question.options[0]?.label, "Document / plan draft");
  assert.ok(session.question.body);
  const questionBody = session.question.body;
  assert.equal(questionBody.includes("Keep this user text untranslated."), true);
  assert.equal(questionBody.includes("No usable project file is visible yet"), true);
});

test("findings: an empty-string blocker falls back to localized copy instead of 500ing the inbox", () => {
  const attention = buildAttentionHomePage({
    locale: "en-US",
    backgroundRuns: [
      runRecord({
        handoff: { done: [], remaining: [], next_steps: [], blockers: [""], artifacts: [], budget_hit: "none" }
      })
    ]
  });
  // 空串 blocker 不再让 preview_text='' 撞 .min(1) → 回退到 running 文案。
  assert.equal(attention.background_runs[0]?.preview_text, "AI is working on this item.");

  // 第一个非空 blocker 仍被优先采用。
  const withBlocker = buildAttentionHomePage({
    locale: "en-US",
    backgroundRuns: [
      runRecord({
        handoff: { done: [], remaining: [], next_steps: [], blockers: ["", "budget exhausted"], artifacts: [], budget_hit: "none" }
      })
    ]
  });
  assert.equal(withBlocker.background_runs[0]?.preview_text, "budget exhausted");
});
