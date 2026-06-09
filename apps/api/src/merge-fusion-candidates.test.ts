import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderRegistry } from "@workhub/agent/providers";
import { deliverableManifestFixtures, type DeliverableChangeManifest } from "@workhub/contracts";
import type { ProposalMergeConflict } from "@workhub/db";

import { createLlmMergeFusionCandidateGenerator } from "./services/merge-fusion-candidates.js";

function manifest(): DeliverableChangeManifest {
  const fixture = deliverableManifestFixtures[0];
  if (!fixture) {
    throw new Error("missing fixture");
  }
  return {
    ...structuredClone(fixture),
    changes: [
      {
        ...fixture.changes[0]!,
        target_kind: "text_doc"
      }
    ]
  };
}

function conflict(targetKind: ProposalMergeConflict["target_kind"] = "text_doc"): ProposalMergeConflict {
  return {
    proposal_id: "92000000-0000-4000-8000-000000000001",
    work_item_id: "92000000-0000-4000-8000-000000000002",
    proposal_title: "客户周报草稿",
    target_key: "delivery:/outputs/report.md",
    change_id: manifest().changes[0]!.id,
    target_kind: targetKind,
    change_type: "updated",
    existing_proposal_id: "92000000-0000-4000-8000-000000000003",
    existing_change_id: "92000000-0000-4000-8000-000000000004",
    target_path: "/outputs/report.md",
    existing_ref: "v1",
    incoming_version_before: "v0"
  };
}

function fakeRegistry(responseText: string, onUserContent?: (content: string) => void) {
  return {
    isConfigured() {
      return true;
    },
    get() {
      return {
        messages: {
          async create(input: { messages: Array<{ content: string }> }) {
            onUserContent?.(input.messages[0]?.content ?? "");
            return {
              id: "msg-fusion",
              content: [{ type: "text", text: responseText }],
              usage: { inputTokens: 10, outputTokens: 5 }
            };
          }
        }
      };
    }
  } as unknown as ProviderRegistry;
}

test("LLM merge mediator turns strict JSON into an ai_fusion candidate", async () => {
  const generator = createLlmMergeFusionCandidateGenerator({
    registry: fakeRegistry(JSON.stringify({
      candidates: [
        {
          conflict_key: "delivery:/outputs/report.md",
          rationale_md: "融合正式版结论和这次新增证据，保留审计口径。",
          merged_value: { proposed_resolution_md: "正式结论 + 新增证据说明" },
          recommend: true
        }
      ]
    }))
  });

  const result = await generator.generate({
    proposalId: "92000000-0000-4000-8000-000000000001",
    workItemId: "92000000-0000-4000-8000-000000000002",
    proposalTitle: "客户周报草稿",
    manifest: manifest(),
    conflicts: [conflict()],
    actor: { actor_kind: "human", actor_user_id: "92000000-0000-4000-8000-000000000005" }
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.recommendedOptionKey, "ai_fusion");
  assert.equal(result[0]?.candidates[0]?.option_key, "ai_fusion");
  assert.equal(result[0]?.candidates[0]?.source, "llm");
  assert.equal(result[0]?.candidates[0]?.quality_gate?.status, "passed");
});

test("LLM merge mediator accepts rationale-only candidates", async () => {
  const generator = createLlmMergeFusionCandidateGenerator({
    registry: fakeRegistry(JSON.stringify({
      candidates: [
        {
          conflict_key: "delivery:/outputs/report.md",
          rationale_md: "先保留正式结论，再补入这次新增证据。",
          recommend: false
        }
      ]
    }))
  });

  const result = await generator.generate({
    proposalId: "92000000-0000-4000-8000-000000000001",
    workItemId: "92000000-0000-4000-8000-000000000002",
    proposalTitle: "客户周报草稿",
    manifest: manifest(),
    conflicts: [conflict()]
  });

  assert.equal(result.length, 1);
  assert.equal(result[0]?.recommendedOptionKey, undefined);
  assert.equal(
    result[0]?.candidates[0]?.merged_value?.proposed_resolution_md,
    "先保留正式结论，再补入这次新增证据。"
  );
});

test("LLM merge mediator skips unsupported conflict families before calling the model", async () => {
  let called = false;
  const registry = {
    isConfigured() {
      return true;
    },
    get() {
      called = true;
      return {
        messages: {
          async create() {
            throw new Error("should not call");
          }
        }
      };
    }
  } as unknown as ProviderRegistry;
  const generator = createLlmMergeFusionCandidateGenerator({ registry });

  const result = await generator.generate({
    proposalId: "92000000-0000-4000-8000-000000000001",
    workItemId: "92000000-0000-4000-8000-000000000002",
    proposalTitle: "客户周报草稿",
    manifest: manifest(),
    conflicts: [conflict("binary_doc")]
  });

  assert.equal(result.length, 0);
  assert.equal(called, false);
});

test("LLM merge mediator prompt includes real text content contexts", async () => {
  let prompt = "";
  const generator = createLlmMergeFusionCandidateGenerator({
    registry: fakeRegistry(JSON.stringify({
      candidates: [
        {
          conflict_key: "delivery:/outputs/report.md",
          rationale_md: "把正式版结论和来稿证据合并成同一段。",
          merged_value: { proposed_resolution_md: "融合后的正文" },
          recommend: true
        }
      ]
    }), (content) => {
      prompt = content;
    })
  });

  await generator.generate({
    proposalId: "92000000-0000-4000-8000-000000000001",
    workItemId: "92000000-0000-4000-8000-000000000002",
    proposalTitle: "客户周报草稿",
    manifest: manifest(),
    conflicts: [conflict()],
    contentContexts: {
      "delivery:/outputs/report.md": {
        conflict_key: "delivery:/outputs/report.md",
        target_kind: "text_doc",
        target_path: "/outputs/report.md",
        current: {
          text: "正式版已有结论。",
          bytes: 24,
          truncated: false,
          ref: "v2",
          sha256: "a".repeat(64)
        },
        incoming: {
          text: "这次新增证据。",
          bytes: 21,
          truncated: false,
          sha256: "b".repeat(64)
        },
        base: {
          text: "分叉时的旧结论。",
          bytes: 24,
          truncated: false,
          ref: "v1"
        }
      }
    }
  });

  const parsed = JSON.parse(prompt) as {
    conflicts: Array<{
      content_context?: {
        current?: { text?: string };
        incoming?: { text?: string };
        base?: { text?: string };
      };
    }>;
  };
  assert.equal(parsed.conflicts[0]?.content_context?.current?.text, "正式版已有结论。");
  assert.equal(parsed.conflicts[0]?.content_context?.incoming?.text, "这次新增证据。");
  assert.equal(parsed.conflicts[0]?.content_context?.base?.text, "分叉时的旧结论。");
});
