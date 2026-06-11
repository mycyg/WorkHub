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
  const customCost = buildCostDashboardPage({
    settings,
    isAdmin: true,
    userId,
    locale: "en-US",
    generatedAt: new Date(at),
    budgetUsages: [
      {
        scope: { kind: "team", teamId: "marketing-team" },
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

  const settingsPage = buildSettingsPage({ settings, locale: "en-US", generatedAt: new Date(at) });
  assert.equal(settingsPage.locale, "en-US");
  assert.equal(settingsPage.llm_runtime.default_model, "deepseek-v4-flash");
  assert.equal(settingsPage.llm_runtime.api_key_configured, false);
  const blockedBaseUrl = "https://api." + "deepseek.com";
  assert.equal(JSON.stringify(settingsPage).includes(blockedBaseUrl), false);
  assert.equal(JSON.stringify(settingsPage).includes("sk-"), false);
  assert.equal(settingsPage.device.pet_model_settings_in_web, false);

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
  assert.equal(proposal.review_actions.merge?.label, "Accept into the official version");
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
  assert.equal(session.question.title, "Which delivery path should this use first?");
  assert.equal(session.question.options[0]?.label, "Document / plan draft");
  assert.equal(session.question.body, "Keep this user text untranslated.");
});
