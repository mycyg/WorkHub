import assert from "node:assert/strict";
import test from "node:test";

import { createP05GoldPathFixture } from "@workhub/agent/fixtures";
import type { ProposalConflict } from "@workhub/contracts";

import { renderProposalDetail } from "./render.js";

test("proposal renderer keeps the change package shape visible", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "web");

  assert.equal(rendered.proposalId, vm.proposal_id);
  assert.equal(rendered.workItemId, vm.work_item_id);
  assert.equal(rendered.changeCount, vm.manifest.changes.length);
  assert.equal(rendered.evidenceCount, vm.evidence_refs.length);
  assert.equal(rendered.conflictCount, 0);
  assert.equal(rendered.cuuState, "carrying_document");
  assert.equal(rendered.html.includes("交付物变更申请"), true);
  assert.equal(rendered.css.includes(".wh-proposal"), true);
  assert.equal(rendered.html.includes("这次改了什么"), true);
  assert.equal(rendered.html.includes("检查结果"), true);
  assert.equal(rendered.html.includes("回滚"), true);
  assert.equal(rendered.html.includes("data-requires-reason=\"true\""), true);
});

test("proposal renderer stays non-kanban and non-git while exposing deliverable kinds", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "desktop");

  assert.equal(rendered.surface, "desktop");
  assert.equal(rendered.html.includes("kanban"), false);
  assert.equal(rendered.html.includes("git"), false);
  assert.equal(rendered.html.includes("data-change-kind=\"text_doc\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"approve\""), true);
  assert.equal(rendered.html.includes("data-action-id=\"request_changes\""), true);
});

test("proposal renderer localizes fixed labels and visible enum labels in English", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const rendered = renderProposalDetail(vm, "web", { locale: "en-US" });

  assert.equal(rendered.html.includes("Deliverable change request"), true);
  assert.equal(rendered.html.includes("What changed"), true);
  assert.equal(rendered.html.includes("Check results"), true);
  assert.equal(rendered.html.includes("Text document"), true);
  assert.equal(rendered.html.includes("Generated"), true);
  assert.equal(rendered.html.includes("交付物变更申请"), false);
  assert.equal(rendered.html.includes("data-change-kind=\"text_doc\""), true);
});

test("proposal renderer exposes option-first conflict cards with merge payloads", () => {
  const vm = createP05GoldPathFixture().proposalDetail;
  const conflict: ProposalConflict = {
    id: "conflict-weekly-report",
    work_item_id: vm.work_item_id,
    proposal_id: vm.proposal_id,
    merge_proposal_id: "10000000-0000-4000-8000-000000000309",
    change_id: vm.manifest.changes[0]?.id ?? "change-1",
    target_key: "drive_item:docs/weekly-report.md",
    target_kind: "text_doc",
    change_type: "updated",
    target_path: "docs/weekly-report.md",
    headline: "weekly-report.md 已经被另一份变更更新",
    summary_text: "正式版和这次版本都改了同一个文档，先选保留正式版还是采纳这次版本。",
    existing: {
      proposal_id: "10000000-0000-4000-8000-000000000111",
      change_id: "10000000-0000-4000-8000-000000000112",
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
          href: `/api/proposals/${vm.proposal_id}/merge`,
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
          href: `/api/proposals/${vm.proposal_id}/merge`,
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

  const rendered = renderProposalDetail(vm, "web", { conflicts: [conflict] });
  const english = renderProposalDetail(vm, "web", { locale: "en-US", conflicts: [conflict] });

  assert.equal(rendered.conflictCount, 1);
  assert.equal(rendered.html.includes("data-proposal-conflicts=\"1\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"keep_current\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"accept_incoming\""), true);
  assert.equal(rendered.html.includes("data-conflict-option-id=\"ai_fusion\""), true);
  assert.equal(rendered.html.includes("采用 AI 融合稿"), true);
  assert.equal(rendered.html.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply"), true);
  assert.equal(rendered.html.includes("accept_incoming_target_keys"), true);
  assert.equal(rendered.actionHrefs.includes(`/api/proposals/${vm.proposal_id}/merge`), true);
  assert.equal(rendered.actionHrefs.includes("/api/merge-proposals/10000000-0000-4000-8000-000000000309/apply"), true);
  assert.equal(english.html.includes("Conflicting change detected"), true);
  assert.equal(english.html.includes("Keep current"), true);
  assert.equal(english.html.includes("Use this version"), true);
  assert.equal(english.html.includes("Use AI fusion draft"), true);
});
