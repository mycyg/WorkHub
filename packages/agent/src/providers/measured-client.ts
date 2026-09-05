import {
  buildUsageRecord,
  noopUsageSink,
  type BuildUsageRecordInput,
  type UsageRecord,
  type UsageSink
} from "@workhub/cost";

import type {
  LlmActor,
  LlmCreateParams,
  LlmCreateResponse,
  LlmStream,
  LlmStreamEvent,
  LlmTransport,
  ProviderRoute,
  TaskClass
} from "./types.js";

export type MeasuredLlmClientOptions = {
  route: ProviderRoute;
  transport: LlmTransport;
  actor?: LlmActor;
  usageSink?: UsageSink;
};

function usageFromResponse(response: LlmCreateResponse) {
  return response.usage ?? { inputTokens: 0, outputTokens: 0 };
}

// 用量记账是尽力而为：sink（通常是 DB 写）抛错不应让一次已成功的模型调用失败、从而拖垮整个 run。
// 记账失败大声告警、继续返回响应（可用性优先于一次瞬时记账的完整性）。
//
// CORE-08：但「尽力而为」不等于「静默欠计」——此前只 console.warn，预算/审计欠计无人知晓，
// 闸门被系统性放宽。现在失败时：1) 打结构化 error 日志（可检索/告警）；2) 累加进程内失败计数
// （usageRecordFailureCount，供指标导出/测试断言欠计发生过）。
let usageRecordFailures = 0;

/** 进程内「用量记账失败」累计次数——每次 recordUsage 抛错 +1。欠计观测指标（测试亦可断言）。 */
export function usageRecordFailureCount() {
  return usageRecordFailures;
}

async function recordUsageSafely(sink: UsageSink, record: UsageRecord) {
  try {
    await sink.recordUsage(record);
  } catch (error) {
    usageRecordFailures += 1;
    console.error(JSON.stringify({
      level: "error",
      event: "usage_record_failed",
      detail: "WorkHub usage sink failed; run continues without this usage record (budget/audit undercounted)",
      provider: record.provider,
      model: record.model,
      task: record.task,
      source: record.source,
      ...(record.runId ? { runId: record.runId } : {}),
      ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}),
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

function makeUsageRecord(route: ProviderRoute, actor: LlmActor | undefined, response: LlmCreateResponse, source: LlmCreateParams["source"], seq: LlmCreateParams["seq"]): UsageRecord {
  const usage = usageFromResponse(response);
  const input: BuildUsageRecordInput = {
    provider: route.provider.name,
    model: route.model.model,
    task: route.task,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    source: source ?? "agent_step",
    ...(seq !== undefined ? { seq } : {}),
    costTier: {
      inputCnyPerMtok: route.model.costInputCnyPerMtok,
      outputCnyPerMtok: route.model.costOutputCnyPerMtok
    }
  };
  if (actor?.id) {
    input.actorId = actor.id;
  }
  if (actor?.runId) {
    input.runId = actor.runId;
  }
  if (actor?.workItemId) {
    input.workItemId = actor.workItemId;
  }
  if (actor?.taskPlanId) {
    input.taskPlanId = actor.taskPlanId;
  }
  if (actor?.objectiveId) {
    input.objectiveId = actor.objectiveId;
  }
  if (actor?.userId) {
    input.userId = actor.userId;
  }
  if (actor?.workspaceId) {
    input.workspaceId = actor.workspaceId;
  }
  return buildUsageRecord(input);
}

class MeasuredStream implements LlmStream {
  private usageRecord: UsageRecord | undefined;

  constructor(
    private readonly inner: LlmStream,
    private readonly route: ProviderRoute,
    private readonly actor: LlmActor | undefined,
    private readonly sink: UsageSink,
    private readonly source: LlmCreateParams["source"],
    private readonly seq: LlmCreateParams["seq"]
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<LlmStreamEvent> {
    return this.inner[Symbol.asyncIterator]();
  }

  async getFinalMessage() {
    const final = await this.inner.getFinalMessage();
    if (!this.usageRecord) {
      this.usageRecord = makeUsageRecord(this.route, this.actor, final, this.source, this.seq);
      await recordUsageSafely(this.sink, this.usageRecord);
    }
    return { ...final, usageRecord: this.usageRecord };
  }
}

export class MeasuredLlmClient {
  public readonly provider: string;
  public readonly model: string;
  public readonly task: TaskClass;

  public readonly messages = {
    create: async (params: LlmCreateParams) => {
      const response = await this.transport.create({ ...params, model: this.model });
      const usageRecord = makeUsageRecord(this.route, this.actor, response, params.source, params.seq);
      await recordUsageSafely(this.usageSink, usageRecord);
      return { ...response, usageRecord };
    },
    stream: async (params: LlmCreateParams) => {
      const stream = await this.transport.stream({ ...params, model: this.model });
      return new MeasuredStream(stream, this.route, this.actor, this.usageSink, params.source, params.seq);
    }
  };

  constructor(private readonly options: MeasuredLlmClientOptions) {
    this.provider = options.route.provider.name;
    this.model = options.route.model.model;
    this.task = options.route.task;
  }

  private get route() {
    return this.options.route;
  }

  private get transport() {
    return this.options.transport;
  }

  private get actor() {
    return this.options.actor;
  }

  private get usageSink() {
    return this.options.usageSink ?? noopUsageSink;
  }
}
