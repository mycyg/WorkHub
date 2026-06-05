import type { LlmCreateParams, LlmCreateResponse, LlmStream, LlmStreamEvent, LlmTransport } from "./types.js";
import type { LlmProviderConfig } from "@workhub/config";

export type AnthropicCompatibleTransportOptions = {
  fetchImpl?: typeof fetch;
  anthropicVersion?: string;
};

type SseEvent = {
  event?: string;
  data?: unknown;
};

export class LlmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly headers: Headers,
    public readonly body: string
  ) {
    super(`LLM provider returned HTTP ${status}`);
  }
}

function messagesEndpoint(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/u, "");
  if (trimmed.endsWith("/v1/messages")) {
    return trimmed;
  }
  return `${trimmed}/v1/messages`;
}

function requestBody(params: LlmCreateParams & { model: string }, stream: boolean) {
  const body: Record<string, unknown> = {
    model: params.model,
    max_tokens: params.maxTokens,
    messages: params.messages,
    stream
  };
  if (params.system) {
    body.system = params.system;
  }
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
  }
  return body;
}

function parseUsage(raw: unknown) {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const inputTokens = value.input_tokens ?? value.inputTokens;
  const outputTokens = value.output_tokens ?? value.outputTokens;
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") {
    return undefined;
  }
  return {
    inputTokens: typeof inputTokens === "number" ? inputTokens : 0,
    outputTokens: typeof outputTokens === "number" ? outputTokens : 0
  };
}

function normalizeResponse(raw: unknown): LlmCreateResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("LLM provider returned a non-object response");
  }
  const value = raw as Record<string, unknown>;
  const response: LlmCreateResponse = {
    id: typeof value.id === "string" ? value.id : "msg-unknown",
    content: Array.isArray(value.content) ? value.content : []
  };
  const usage = parseUsage(value.usage);
  if (usage) {
    response.usage = usage;
  }
  const stopReason = value.stop_reason ?? value.stopReason;
  if (typeof stopReason === "string") {
    response.stopReason = stopReason;
  }
  return response;
}

function headers(provider: LlmProviderConfig, anthropicVersion: string) {
  return {
    "content-type": "application/json",
    "x-api-key": provider.apiKey,
    "anthropic-version": anthropicVersion
  };
}

async function assertOk(response: Response) {
  if (response.ok) {
    return;
  }
  throw new LlmHttpError(response.status, response.headers, await response.text());
}

async function* parseSseBody(body: NonNullable<Response["body"]>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    buffer += decoder.decode(read.value, { stream: true });
    const parts = buffer.split(/\r?\n\r?\n/u);
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSsePart(part);
      if (event) {
        yield event;
      }
    }
  }

  buffer += decoder.decode();
  const final = parseSsePart(buffer);
  if (final) {
    yield final;
  }
}

function parseSsePart(part: string): SseEvent | undefined {
  const eventLines = part
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0 && !line.startsWith(":"));
  if (eventLines.length === 0) {
    return undefined;
  }

  let event: string | undefined;
  const dataLines: string[] = [];
  for (const line of eventLines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  const dataText = dataLines.join("\n");
  if (dataText === "[DONE]") {
    return undefined;
  }

  const output: SseEvent = {};
  if (event) {
    output.event = event;
  }
  if (dataText.length > 0) {
    try {
      output.data = JSON.parse(dataText) as unknown;
    } catch {
      output.data = dataText;
    }
  }
  return output;
}

function eventType(event: SseEvent) {
  if (event.data && typeof event.data === "object") {
    const type = (event.data as Record<string, unknown>).type;
    if (typeof type === "string") {
      return type;
    }
  }
  if (event.event) {
    return event.event;
  }
  return "message";
}

function assignUsage(target: { inputTokens: number; outputTokens: number }, raw: unknown) {
  const usage = parseUsage(raw);
  if (!usage) {
    return;
  }
  target.inputTokens = Math.max(target.inputTokens, usage.inputTokens);
  target.outputTokens = Math.max(target.outputTokens, usage.outputTokens);
}

function mergeDeltaIntoBlock(block: Record<string, unknown>, delta: Record<string, unknown>) {
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    block.text = `${typeof block.text === "string" ? block.text : ""}${delta.text}`;
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    block.thinking = `${typeof block.thinking === "string" ? block.thinking : ""}${delta.thinking}`;
  }
  if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
    block.partial_json = `${typeof block.partial_json === "string" ? block.partial_json : ""}${delta.partial_json}`;
  }
}

function finalizeBlock(block: Record<string, unknown>) {
  const output = { ...block };
  if (output.type === "tool_use" && typeof output.partial_json === "string") {
    try {
      output.input = JSON.parse(output.partial_json) as unknown;
    } catch {
      output.input = output.partial_json;
    }
  }
  delete output.partial_json;
  return output;
}

class AnthropicCompatibleStream implements LlmStream {
  private readonly events: LlmStreamEvent[] = [];
  private readonly waiters: (() => void)[] = [];
  private readonly usage = { inputTokens: 0, outputTokens: 0 };
  private readonly contentBlocks = new Map<number, Record<string, unknown>>();
  private started = false;
  private done = false;
  private id = "msg-stream";
  private stopReason: string | undefined;
  private finalPromise: Promise<LlmCreateResponse> | undefined;

  constructor(private readonly body: NonNullable<Response["body"]>) {}

  [Symbol.asyncIterator](): AsyncIterator<LlmStreamEvent> {
    let index = 0;
    this.start();
    return {
      next: async () => {
        while (index >= this.events.length && !this.done) {
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
        const value = this.events[index];
        if (value) {
          index += 1;
          return { value, done: false };
        }
        return { value: undefined, done: true };
      }
    };
  }

  getFinalMessage() {
    return this.start();
  }

  private start() {
    if (!this.finalPromise) {
      this.finalPromise = this.consume();
    }
    return this.finalPromise;
  }

  private async consume(): Promise<LlmCreateResponse> {
    try {
      for await (const event of parseSseBody(this.body)) {
        this.applyEvent(event);
        const llmEvent: LlmStreamEvent = {
          type: eventType(event)
        };
        if (event.data !== undefined) {
          llmEvent.data = event.data;
        }
        this.events.push(llmEvent);
        this.flushWaiters();
      }
      return this.finalMessage();
    } finally {
      this.done = true;
      this.flushWaiters();
    }
  }

  private applyEvent(event: SseEvent) {
    const data = event.data;
    if (!data || typeof data !== "object") {
      return;
    }
    const value = data as Record<string, unknown>;
    const type = value.type ?? event.event;

    if (type === "message_start" && value.message && typeof value.message === "object") {
      const message = value.message as Record<string, unknown>;
      if (typeof message.id === "string") {
        this.id = message.id;
      }
      assignUsage(this.usage, message.usage);
      if (Array.isArray(message.content)) {
        message.content.forEach((block, index) => {
          if (block && typeof block === "object") {
            this.contentBlocks.set(index, { ...(block as Record<string, unknown>) });
          }
        });
      }
    }

    if (type === "content_block_start" && typeof value.index === "number" && value.content_block && typeof value.content_block === "object") {
      this.contentBlocks.set(value.index, { ...(value.content_block as Record<string, unknown>) });
    }

    if (type === "content_block_delta" && typeof value.index === "number" && value.delta && typeof value.delta === "object") {
      const block = this.contentBlocks.get(value.index) ?? {};
      mergeDeltaIntoBlock(block, value.delta as Record<string, unknown>);
      this.contentBlocks.set(value.index, block);
    }

    if (type === "message_delta") {
      assignUsage(this.usage, value.usage);
      if (value.delta && typeof value.delta === "object") {
        const delta = value.delta as Record<string, unknown>;
        if (typeof delta.stop_reason === "string") {
          this.stopReason = delta.stop_reason;
        }
      }
    }
  }

  private finalMessage() {
    const response: LlmCreateResponse = {
      id: this.id,
      content: [...this.contentBlocks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, block]) => finalizeBlock(block)),
      usage: this.usage
    };
    if (this.stopReason) {
      response.stopReason = this.stopReason;
    }
    return response;
  }

  private flushWaiters() {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }
}

export function createAnthropicCompatibleTransport(
  provider: LlmProviderConfig,
  options: AnthropicCompatibleTransportOptions = {}
): LlmTransport {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const anthropicVersion = options.anthropicVersion ?? "2023-06-01";

  return {
    async create(params) {
      const response = await fetchImpl(messagesEndpoint(provider.baseUrl), {
        method: "POST",
        headers: headers(provider, anthropicVersion),
        body: JSON.stringify(requestBody(params, false))
      });
      await assertOk(response);
      return normalizeResponse(await response.json());
    },

    async stream(params) {
      const response = await fetchImpl(messagesEndpoint(provider.baseUrl), {
        method: "POST",
        headers: headers(provider, anthropicVersion),
        body: JSON.stringify(requestBody(params, true))
      });
      await assertOk(response);
      if (!response.body) {
        throw new Error("LLM provider returned an empty stream body");
      }
      return new AnthropicCompatibleStream(response.body);
    }
  };
}
