import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionItem } from "@workhub/contracts";

import { buildAttentionHomePage } from "./pages/attention.js";

const createdAt = "2026-07-03T00:00:00.000Z";

function attentionItem(kind: AttentionItem["kind"], index: number): AttentionItem {
  const idSuffix = index.toString(16).padStart(12, "0");
  const sourceEntityType: AttentionItem["source_ref"]["entity_type"] =
    kind === "escalation"
      ? "escalation_event"
      : kind === "budget"
        ? "budget_notice"
        : kind === "plan_review" || kind === "proposal_review"
          ? "proposal"
          : "notification";
  return {
    id: `91000000-0000-4000-8000-${idSuffix}`,
    kind,
    priority: kind === "escalation" ? "urgent" : kind === "budget" ? "high" : "normal",
    source_ref: {
      entity_type: sourceEntityType,
      entity_id: `92000000-0000-4000-8000-${idSuffix}`
    },
    title: `${kind} ${index}`,
    summary_text: `${kind} summary ${index}`,
    actions: [{
      id: "open",
      label: "查看",
      style: "secondary",
      method: "GET",
      href: "/attention"
    }],
    created_at: createdAt
  };
}

test("attention home sorts R9 decision cards before choosing the primary card", () => {
  const proposal = attentionItem("proposal_review", 1);
  const plan = attentionItem("plan_review", 2);
  const budget = attentionItem("budget", 3);
  const escalation = attentionItem("escalation", 4);
  const syncConflict = attentionItem("sync_conflict", 5);

  const page = buildAttentionHomePage({
    queue: [proposal, plan, budget, escalation, syncConflict],
    locale: "zh-CN"
  });

  assert.equal(page.primary?.id, escalation.id);
  assert.deepEqual(page.queue.map((item) => item.id), [
    escalation.id,
    budget.id,
    syncConflict.id,
    plan.id,
    proposal.id
  ]);
});
