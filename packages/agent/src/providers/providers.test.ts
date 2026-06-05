import assert from "node:assert/strict";
import test from "node:test";

import { createProviderRegistryConfig, loadSettings } from "@workhub/config";
import { createMemoryUsageSink } from "@workhub/cost";

import {
  createProviderRegistry,
  nextRetryDecision,
  type LlmCreateParams,
  type LlmCreateResponse,
  type LlmStream,
  type LlmStreamEvent,
  type LlmTransport
} from "./index.js";

class FakeStream implements LlmStream {
  constructor(private readonly final: LlmCreateResponse) {}

  async *[Symbol.asyncIterator](): AsyncIterator<LlmStreamEvent> {
    yield { type: "content_block_delta", data: { text: "hello" } };
  }

  async getFinalMessage() {
    return this.final;
  }
}

class FakeTransport implements LlmTransport {
  public calls: (LlmCreateParams & { model: string })[] = [];

  async create(params: LlmCreateParams & { model: string }) {
    this.calls.push(params);
    return {
      id: "msg-1",
      content: [{ type: "text", text: "ok" }],
      usage: { inputTokens: 100, outputTokens: 50 }
    };
  }

  async stream(params: LlmCreateParams & { model: string }) {
    this.calls.push(params);
    return new FakeStream({
      id: "msg-2",
      content: [{ type: "text", text: "streamed" }],
      usage: { inputTokens: 200, outputTokens: 75 }
    });
  }
}

function registryWithFakeTransport() {
  const transport = new FakeTransport();
  const usageSink = createMemoryUsageSink();
  const settings = loadSettings({
    LLM_API_KEY: "secret-provider-key",
    PROVIDER_DEEPSEEK_COST_INPUT_CNY_PER_MTOK: "2",
    PROVIDER_DEEPSEEK_COST_OUTPUT_CNY_PER_MTOK: "8"
  });
  const registry = createProviderRegistry({
    config: createProviderRegistryConfig(settings),
    transportFactory: () => transport,
    usageSink
  });
  return { registry, transport, usageSink };
}

test("provider registry injects the routed model and records create usage once", async () => {
  const { registry, transport, usageSink } = registryWithFakeTransport();
  const client = registry.get({ id: "actor-1", runId: "run-1", userId: "user-1" }, "worker");

  const response = await client.messages.create({
    maxTokens: 1000,
    messages: [{ role: "user", content: "hi" }]
  });

  assert.equal(response.id, "msg-1");
  assert.equal(transport.calls[0]?.model, "deepseek-v4-flash");
  assert.equal(usageSink.records.length, 1);
  assert.equal(usageSink.records[0]?.estimatedCostCny, "0.0006");
  assert.equal(JSON.stringify(usageSink.records[0]).includes("secret-provider-key"), false);
});

test("stream wrapper preserves async iteration and records usage on final message", async () => {
  const { registry, usageSink } = registryWithFakeTransport();
  const client = registry.get({ id: "actor-1", runId: "run-1" }, "clarify");
  const stream = await client.messages.stream({
    maxTokens: 1000,
    messages: [{ role: "user", content: "hi" }]
  });
  const events: string[] = [];

  for await (const event of stream) {
    events.push(event.type);
  }
  await stream.getFinalMessage();
  await stream.getFinalMessage();

  assert.deepEqual(events, ["content_block_delta"]);
  assert.equal(usageSink.records.length, 1);
  assert.equal(usageSink.records[0]?.inputTokens, 200);
});

test("registry routing can switch a task to another configured model", () => {
  const { registry } = registryWithFakeTransport();
  const route = registry.routeFor("review");

  assert.equal(route.provider.name, "deepseek");
  assert.equal(route.model.model, "deepseek-v4-flash");
  assert.equal(registry.isConfigured(), true);
  assert.equal(JSON.stringify(registry.publicMetadata()).includes("secret-provider-key"), false);
});

test("retry helper honors Retry-After before exponential transient backoff", () => {
  assert.deepEqual(
    nextRetryDecision(
      { status: 429, headers: { get: () => "2" } },
      1,
      { now: new Date("2026-06-05T00:00:00.000Z") }
    ),
    { retry: true, delayMs: 2000, reason: "retry_after" }
  );
  assert.deepEqual(nextRetryDecision({ status: 500 }, 2, { baseDelayMs: 100 }), {
    retry: true,
    delayMs: 200,
    reason: "transient"
  });
  assert.equal(nextRetryDecision({ status: 400 }, 1).retry, false);
});
