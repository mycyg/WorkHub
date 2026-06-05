import assert from "node:assert/strict";
import test from "node:test";

import { createProviderRegistryConfig, loadSettings } from "@workhub/config";
import { createMemoryUsageSink } from "@workhub/cost";

import {
  createAnthropicCompatibleTransport,
  createDefaultProviderRegistry,
  createProviderRegistry,
  LlmHttpError,
  nextRetryDecision,
  type LlmCreateParams,
  type LlmCreateResponse,
  type LlmStream,
  type LlmStreamEvent,
  type LlmTransport
} from "./index.js";

type FetchCall = {
  url: string;
  init: RequestInit;
};

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

test("default registry can replace the usage sink after construction", async () => {
  const transport = new FakeTransport();
  const firstSink = createMemoryUsageSink();
  const secondSink = createMemoryUsageSink();
  const registry = createDefaultProviderRegistry(() => transport);
  registry.setUsageSink(firstSink);
  await registry.get({ id: "actor-1" }, "assistant").messages.create({
    maxTokens: 1000,
    messages: [{ role: "user", content: "first" }]
  });
  registry.setUsageSink(secondSink);
  await registry.get({ id: "actor-1" }, "assistant").messages.create({
    maxTokens: 1000,
    messages: [{ role: "user", content: "second" }]
  });

  assert.equal(firstSink.records.length, 1);
  assert.equal(secondSink.records.length, 1);
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

test("anthropic-compatible transport maps create requests and normalizes usage", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        id: "msg-http-1",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 12, output_tokens: 4 },
        stop_reason: "end_turn"
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const transport = createAnthropicCompatibleTransport(
    {
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "secret-provider-key",
      defaultModelId: "default",
      models: {}
    },
    { fetchImpl }
  );

  const response = await transport.create({
    model: "deepseek-v4-flash",
    maxTokens: 128,
    system: "Be useful.",
    messages: [{ role: "user", content: "hi" }]
  });

  assert.equal(calls[0]?.url, "https://api.deepseek.com/anthropic/v1/messages");
  const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.max_tokens, 128);
  assert.equal(body.stream, false);
  assert.equal((calls[0]?.init.headers as Record<string, string>)["x-api-key"], "secret-provider-key");
  assert.equal(response.usage?.inputTokens, 12);
  assert.equal(response.usage?.outputTokens, 4);
  assert.equal(response.stopReason, "end_turn");
});

test("anthropic-compatible stream preserves events and builds final usage", async () => {
  const streamText = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-stream-1","usage":{"input_tokens":20,"output_tokens":0}}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
    'event: message_stop\ndata: {"type":"message_stop"}'
  ].join("\n\n");
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(streamText));
          controller.close();
        }
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } }
    );
  const transport = createAnthropicCompatibleTransport(
    {
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "secret-provider-key",
      defaultModelId: "default",
      models: {}
    },
    { fetchImpl }
  );

  const stream = await transport.stream({
    model: "deepseek-v4-flash",
    maxTokens: 128,
    messages: [{ role: "user", content: "hi" }]
  });
  const events: string[] = [];
  for await (const event of stream) {
    events.push(event.type);
  }
  const final = await stream.getFinalMessage();

  assert.deepEqual(events, [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "message_delta",
    "message_stop"
  ]);
  assert.equal(final.id, "msg-stream-1");
  assert.deepEqual(final.content, [{ type: "text", text: "hello" }]);
  assert.equal(final.usage?.inputTokens, 20);
  assert.equal(final.usage?.outputTokens, 5);
  assert.equal(final.stopReason, "end_turn");
});

test("anthropic-compatible transport throws retryable http errors without leaking keys", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("rate limited", {
      status: 429,
      headers: { "retry-after": "1" }
    });
  const transport = createAnthropicCompatibleTransport(
    {
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/anthropic",
      apiKey: "secret-provider-key",
      defaultModelId: "default",
      models: {}
    },
    { fetchImpl }
  );

  await assert.rejects(
    () =>
      transport.create({
        model: "deepseek-v4-flash",
        maxTokens: 128,
        messages: [{ role: "user", content: "hi" }]
      }),
    (error) => {
      assert.equal(error instanceof LlmHttpError, true);
      const httpError = error as LlmHttpError;
      assert.equal(httpError.status, 429);
      assert.equal(httpError.headers.get("retry-after"), "1");
      assert.equal(JSON.stringify(httpError).includes("secret-provider-key"), false);
      return true;
    }
  );
});
