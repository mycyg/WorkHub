import type { UsageRecord, UsageSink, UsageSource } from "./types.js";

export type CostTier = {
  inputCnyPerMtok: number;
  outputCnyPerMtok: number;
};

export type BuildUsageRecordInput = {
  runId?: string;
  workItemId?: string;
  userId?: string;
  provider: string;
  model: string;
  task: string;
  actorId?: string;
  inputTokens: number;
  outputTokens: number;
  source?: UsageSource;
  costTier: CostTier;
  createdAt?: Date;
};

export const noopUsageSink: UsageSink = {
  recordUsage() {
    return undefined;
  }
};

export function estimateCostCny(tokens: { inputTokens: number; outputTokens: number }, tier: CostTier): string {
  const cost =
    (tokens.inputTokens * tier.inputCnyPerMtok + tokens.outputTokens * tier.outputCnyPerMtok) / 1_000_000;
  return cost.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") || "0";
}

export function buildUsageRecord(input: BuildUsageRecordInput): UsageRecord {
  const record: UsageRecord = {
    provider: input.provider,
    model: input.model,
    task: input.task,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    estimatedCostCny: estimateCostCny(input, input.costTier),
    source: input.source ?? "agent_step",
    createdAt: (input.createdAt ?? new Date()).toISOString()
  };
  if (input.runId) {
    record.runId = input.runId;
  }
  if (input.workItemId) {
    record.workItemId = input.workItemId;
  }
  if (input.userId) {
    record.userId = input.userId;
  }
  if (input.actorId) {
    record.actorId = input.actorId;
  }
  return record;
}

export function createMemoryUsageSink(initial: UsageRecord[] = []) {
  const records = [...initial];
  const sink: UsageSink & { records: readonly UsageRecord[] } = {
    get records() {
      return records;
    },
    recordUsage(record) {
      records.push(record);
    }
  };
  return sink;
}
