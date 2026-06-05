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

function makeUsageRecord(route: ProviderRoute, actor: LlmActor | undefined, response: LlmCreateResponse, source: LlmCreateParams["source"]): UsageRecord {
  const usage = usageFromResponse(response);
  const input: BuildUsageRecordInput = {
    provider: route.provider.name,
    model: route.model.model,
    task: route.task,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    source: source ?? "agent_step",
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
  if (actor?.userId) {
    input.userId = actor.userId;
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
    private readonly source: LlmCreateParams["source"]
  ) {}

  [Symbol.asyncIterator](): AsyncIterator<LlmStreamEvent> {
    return this.inner[Symbol.asyncIterator]();
  }

  async getFinalMessage() {
    const final = await this.inner.getFinalMessage();
    if (!this.usageRecord) {
      this.usageRecord = makeUsageRecord(this.route, this.actor, final, this.source);
      await this.sink.recordUsage(this.usageRecord);
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
      const usageRecord = makeUsageRecord(this.route, this.actor, response, params.source);
      await this.usageSink.recordUsage(usageRecord);
      return { ...response, usageRecord };
    },
    stream: async (params: LlmCreateParams) => {
      const stream = await this.transport.stream({ ...params, model: this.model });
      return new MeasuredStream(stream, this.route, this.actor, this.usageSink, params.source);
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
