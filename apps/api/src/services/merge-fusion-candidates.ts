import { z } from "zod";

import type { DeliverableChangeManifest } from "@workhub/contracts";
import type { ProviderRegistry } from "@workhub/agent/providers";
import type {
  MergeProposalCandidate,
  MergeProposalCandidateSupplement,
  ProposalMergeConflict
} from "@workhub/db";

import { getDefaultProviderRegistry } from "./provider-registry.js";
import type { ProposalActor } from "./proposals.js";

const supportedFusionTargetKinds = new Set(["structured_record", "text_doc", "spec_doc"]);

const llmFusionCandidateSchema = z.object({
  conflict_key: z.string().min(1),
  rationale_md: z.string().min(1).max(4000),
  merged_value: z.record(z.string(), z.unknown()).optional(),
  recommend: z.boolean().default(false)
});

const llmFusionResponseSchema = z.object({
  candidates: z.array(llmFusionCandidateSchema).default([])
});

export type MergeFusionCandidateGeneratorInput = {
  proposalId: string;
  workItemId: string;
  proposalTitle: string;
  manifest: DeliverableChangeManifest;
  conflicts: ProposalMergeConflict[];
  actor?: ProposalActor;
};

export type MergeFusionCandidateGenerator = {
  generate: (input: MergeFusionCandidateGeneratorInput) => Promise<MergeProposalCandidateSupplement[]>;
};

function textFromContent(content: unknown[]) {
  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n")
    .trim();
}

function parseJsonObject(text: string) {
  const direct = text.trim();
  const fenced = direct.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim();
  return JSON.parse(fenced ?? direct) as unknown;
}

function hasConflictMarkers(value: unknown) {
  const text = JSON.stringify(value) ?? "";
  return text.includes("<<<<<<<")
    || text.includes("=======")
    || text.includes(">>>>>>>");
}

function changeSummary(manifest: DeliverableChangeManifest, conflict: ProposalMergeConflict) {
  const change = manifest.changes.find((item) => item.id === conflict.change_id);
  if (!change) {
    return undefined;
  }
  return {
    id: change.id,
    target_kind: change.target_kind,
    change_type: change.change_type,
    target_ref: change.target_ref,
    human_summary: change.human_summary,
    preview_ref: change.preview_ref
  };
}

function promptFor(input: MergeFusionCandidateGeneratorInput) {
  const conflicts = input.conflicts.map((conflict) => ({
    conflict_key: conflict.target_key,
    proposal_id: conflict.proposal_id,
    proposal_title: conflict.proposal_title,
    target_kind: conflict.target_kind,
    change_type: conflict.change_type,
    target_path: conflict.target_path,
    existing: {
      proposal_id: conflict.existing_proposal_id,
      change_id: conflict.existing_change_id,
      ref: conflict.existing_ref,
      sha256_after: conflict.existing_sha256_after
    },
    incoming: {
      change_id: conflict.change_id,
      version_before: conflict.incoming_version_before,
      sha256_before: conflict.incoming_sha256_before,
      sha256_after: conflict.incoming_sha256_after
    },
    change: changeSummary(input.manifest, conflict)
  }));

  return JSON.stringify({
    task: "Create optional AI fusion candidates for WorkHub merge conflicts.",
    rules: [
      "Return JSON only.",
      "Only create candidates for structured_record, text_doc, or spec_doc conflicts.",
      "Do not include git conflict markers.",
      "Do not decide for the user; provide rationale and a candidate value only.",
      "If content is insufficient, return no candidate for that conflict."
    ],
    output_schema: {
      candidates: [
        {
          conflict_key: "same as input conflict_key",
          rationale_md: "short human-readable reason",
          merged_value: { proposed_resolution_md: "or structured object" },
          recommend: true
        }
      ]
    },
    proposal: {
      proposal_id: input.proposalId,
      work_item_id: input.workItemId,
      title: input.proposalTitle,
      manifest_title: input.manifest.title
    },
    conflicts
  });
}

function candidateFor(input: {
  conflict: ProposalMergeConflict;
  rationaleMd: string;
  mergedValue?: Record<string, unknown>;
}): MergeProposalCandidate {
  return {
    option_key: "ai_fusion",
    target_kind: input.conflict.target_kind,
    rationale_md: input.rationaleMd,
    source: "llm",
    quality_gate: {
      status: "passed",
      checks: ["supported_target_kind", "json_schema", "no_git_conflict_markers"]
    },
    merged_value: input.mergedValue ?? {
      proposed_resolution_md: input.rationaleMd
    }
  };
}

export function createNoopMergeFusionCandidateGenerator(): MergeFusionCandidateGenerator {
  return {
    async generate() {
      return [];
    }
  };
}

export function createLlmMergeFusionCandidateGenerator(options: {
  registry?: ProviderRegistry;
} = {}): MergeFusionCandidateGenerator {
  const registry = options.registry ?? getDefaultProviderRegistry();
  return {
    async generate(input) {
      const eligibleConflicts = input.conflicts.filter((conflict) => supportedFusionTargetKinds.has(conflict.target_kind));
      if (eligibleConflicts.length === 0 || !registry.isConfigured()) {
        return [];
      }

      const client = registry.get({
        id: input.actor?.actor_user_id ?? input.proposalId,
        label: input.actor?.label ?? "proposal-merge-mediator",
        ...(input.actor?.actor_user_id ? { userId: input.actor.actor_user_id } : {}),
        workItemId: input.workItemId
      }, "review");
      const response = await client.messages.create({
        maxTokens: 1200,
        source: "review",
        system: "You are WorkHub's merge mediator. Return strict JSON only. Never include secrets or git conflict markers.",
        messages: [
          {
            role: "user",
            content: promptFor({
              ...input,
              conflicts: eligibleConflicts
            })
          }
        ]
      });
      const parsed = llmFusionResponseSchema.parse(parseJsonObject(textFromContent(response.content)));
      const byConflict = new Map(input.conflicts.map((conflict) => [conflict.target_key, conflict]));
      const supplements: MergeProposalCandidateSupplement[] = [];
      for (const raw of parsed.candidates) {
        const conflict = byConflict.get(raw.conflict_key);
        if (!conflict || !supportedFusionTargetKinds.has(conflict.target_kind)) {
          continue;
        }
        if (hasConflictMarkers(raw.rationale_md) || hasConflictMarkers(raw.merged_value)) {
          continue;
        }
        supplements.push({
          conflictKey: raw.conflict_key,
          candidates: [candidateFor({
            conflict,
            rationaleMd: raw.rationale_md,
            ...(raw.merged_value ? { mergedValue: raw.merged_value } : {})
          })],
          ...(raw.recommend ? { recommendedOptionKey: "ai_fusion" } : {})
        });
      }
      return supplements;
    }
  };
}

export async function safelyGenerateMergeFusionCandidates(
  generator: MergeFusionCandidateGenerator,
  input: MergeFusionCandidateGeneratorInput
) {
  try {
    return await generator.generate(input);
  } catch {
    return [];
  }
}
