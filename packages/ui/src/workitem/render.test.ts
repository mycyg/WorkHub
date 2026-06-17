import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";

import { renderWorkItemDetail } from "./render.js";

test("work item renderer keeps the page focused on status, trace, evidence, and next actions", () => {
  const fixture = createP05GoldPathFixture();
  const rendered = renderWorkItemDetail(fixture.workItemDetail, "web");

  assert.equal(rendered.surface, "web");
  assert.equal(rendered.workItemId, fixture.workItem.id);
  assert.equal(rendered.cuuState, "carrying_document");
  assert.equal(rendered.traceCount >= 5, true);
  // findings[#low-F3]：trace 步骤 phase 本地化（思考/调用工具/...），不再把原始英文 token 渲染给 zh-CN 用户。
  assert.equal(rendered.html.includes("思考"), true);
  assert.equal(/<strong>(?:think|tool_call|tool_result|final)<\/strong>/u.test(rendered.html), false);
  assert.equal(rendered.evidenceCount, 3);
  assert.equal(rendered.html.includes("AI 实时执行"), true);
  assert.equal(rendered.html.includes("验收清单"), true);
  assert.equal(rendered.primaryHrefs.includes(`/proposals/${fixture.proposalDetail.proposal_id}`), true);
});

test("work item renderer supports the just-created AI-working state before a proposal exists", () => {
  const fixture = createP05GoldPathFixture();
  const { latest_proposal: _latestProposal, ...detailWithoutProposal } = fixture.workItemDetail;
  const justCreated = {
    ...detailWithoutProposal,
    workitem: {
      ...fixture.workItemDetail.workitem,
      status: "ai_working" as const
    },
    agent_trace_preview: fixture.replay.steps.slice(0, 2)
  };
  const rendered = renderWorkItemDetail(justCreated, "desktop");

  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.cuuState, "thinking");
  assert.equal(rendered.html.includes("我开始处理了"), true);
  assert.equal(rendered.primaryHrefs.includes(`/agent-runs/${fixture.replay.run.id}/replay`), true);
});

test("work item renderer localizes fixed labels and hides raw status in English", () => {
  const fixture = createP05GoldPathFixture();
  const { latest_proposal: _latestProposal, ...detailWithoutProposal } = fixture.workItemDetail;
  const justCreated = {
    ...detailWithoutProposal,
    workitem: {
      ...fixture.workItemDetail.workitem,
      status: "ai_working" as const
    },
    agent_trace_preview: []
  };
  const rendered = renderWorkItemDetail(justCreated, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("Live AI work"), true);
  assert.equal(rendered.html.includes("Acceptance checklist"), true);
  assert.equal(rendered.html.includes("AI working"), true);
  assert.equal(rendered.html.includes("ai_working"), false);
  assert.equal(rendered.html.includes("AI has started"), true);
  assert.equal(rendered.html.includes("AI 会先读证据"), false);
});
