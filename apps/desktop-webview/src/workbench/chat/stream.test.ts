import assert from "node:assert/strict";
import { test } from "node:test";

import {
  computeHeartbeatWatchdogMs,
  computeReconnectDelayMs,
  connectConversationStream,
  DEFAULT_HEARTBEAT_WATCHDOG_MULTIPLIER,
  DEFAULT_SERVER_HEARTBEAT_MS,
  isHeartbeatWatchdogExpired,
  parseConversationSseFrame,
  type ConversationStreamEvent,
  type ConversationStreamStatus
} from "./stream.js";

function tick(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sseStream(input: { frames?: string[]; endNaturally?: boolean; signal?: AbortSignal | undefined }): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = input.frames ?? [];
  let index = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      input.signal?.addEventListener("abort", () => {
        try {
          controller.error(new DOMException("aborted", "AbortError"));
        } catch {
          // stream already closed/errored — nothing to do.
        }
      });
    },
    pull(controller) {
      if (index < frames.length) {
        controller.enqueue(encoder.encode(frames[index]!));
        index += 1;
        return;
      }
      if (input.endNaturally) {
        controller.close();
      }
      // else stays idle (simulates a live, quiet connection) until aborted.
    }
  });
}

function okResponse(body: ReadableStream<Uint8Array>): Response {
  return { ok: true, status: 200, body } as unknown as Response;
}

function httpErrorResponse(status: number): Response {
  return { ok: false, status, body: null } as unknown as Response;
}

test("computeReconnectDelayMs grows exponentially with no jitter and caps at maxMs", () => {
  const opts = { baseMs: 100, maxMs: 1000, random: () => 0 };
  assert.equal(computeReconnectDelayMs(1, opts), 100);
  assert.equal(computeReconnectDelayMs(2, opts), 200);
  assert.equal(computeReconnectDelayMs(3, opts), 400);
  assert.equal(computeReconnectDelayMs(4, opts), 800);
  assert.equal(computeReconnectDelayMs(10, opts), 1000);
});

test("computeReconnectDelayMs jitter only ever adds delay and never exceeds maxMs", () => {
  const opts = { baseMs: 100, maxMs: 1000, random: () => 1 };
  assert.equal(computeReconnectDelayMs(1, opts), 120);
  assert.equal(computeReconnectDelayMs(10, opts), 1000);
});

test("computeReconnectDelayMs uses sane defaults when no options are given", () => {
  const delay = computeReconnectDelayMs(1, { random: () => 0 });
  assert.equal(delay, 500);
});

// —— R13 H1：心跳看门狗 —— //

test("computeHeartbeatWatchdogMs defaults to 2.5x the server's 30s heartbeat interval", () => {
  assert.equal(DEFAULT_SERVER_HEARTBEAT_MS, 30_000);
  assert.equal(DEFAULT_HEARTBEAT_WATCHDOG_MULTIPLIER, 2.5);
  assert.equal(computeHeartbeatWatchdogMs(), 75_000);
});

test("computeHeartbeatWatchdogMs multiplies whatever heartbeat/multiplier it's given", () => {
  assert.equal(computeHeartbeatWatchdogMs(10_000, 2), 20_000);
  assert.equal(computeHeartbeatWatchdogMs(4, 2.5), 10);
});

test("isHeartbeatWatchdogExpired is false while inside the window and true once it's reached", () => {
  assert.equal(isHeartbeatWatchdogExpired({ lastFrameAtMs: 1_000, nowMs: 1_000, watchdogMs: 20 }), false);
  assert.equal(isHeartbeatWatchdogExpired({ lastFrameAtMs: 1_000, nowMs: 1_019, watchdogMs: 20 }), false);
  assert.equal(isHeartbeatWatchdogExpired({ lastFrameAtMs: 1_000, nowMs: 1_020, watchdogMs: 20 }), true);
  assert.equal(isHeartbeatWatchdogExpired({ lastFrameAtMs: 1_000, nowMs: 5_000, watchdogMs: 20 }), true);
});

test("parseConversationSseFrame extracts the event name and joined data lines", () => {
  assert.deepEqual(parseConversationSseFrame('event: conversation.message.created\ndata: {"a":1}'), {
    event: "conversation.message.created",
    data: '{"a":1}'
  });
});

test('parseConversationSseFrame defaults to "message" when no event: line is present', () => {
  assert.deepEqual(parseConversationSseFrame("data: hello"), { event: "message", data: "hello" });
});

test("parseConversationSseFrame ignores comment-only frames (heartbeat pings)", () => {
  assert.equal(parseConversationSseFrame(": ping"), undefined);
});

test("parseConversationSseFrame ignores blank frames", () => {
  assert.equal(parseConversationSseFrame("   \n  "), undefined);
});

test("parseConversationSseFrame joins multi-line data with newlines", () => {
  assert.deepEqual(parseConversationSseFrame("data: line1\ndata: line2"), { event: "message", data: "line1\nline2" });
});

test("connectConversationStream sends the client token header and dispatches parsed JSON events in order", async () => {
  const events: ConversationStreamEvent[] = [];
  const statuses: ConversationStreamStatus[] = [];
  const seenHeaders: Headers[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    seenHeaders.push(init?.headers as Headers);
    return okResponse(
      sseStream({
        frames: [
          'event: connected\ndata: {"topic":"conversation:c1"}\n\n' +
            'event: conversation.message.created\ndata: {"id":"m1"}\n\n'
        ],
        signal: init?.signal as AbortSignal | undefined
      })
    );
  }) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/api/push/stream/conversation/c1",
    getClientToken: () => "tok-123",
    onEvent: (event) => events.push(event),
    onStatus: (status) => statuses.push(status),
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  await tick();
  handle.close();
  await tick();

  assert.deepEqual(events, [
    { type: "connected", data: { topic: "conversation:c1" } },
    { type: "conversation.message.created", data: { id: "m1" } }
  ]);
  assert.ok(statuses.some((s) => s.state === "open"));
  assert.equal(statuses[statuses.length - 1]!.state, "closed");
  const headers = seenHeaders[0]!;
  assert.equal(headers.get("X-YQGL-Client-Token"), "tok-123");
  assert.equal(headers.get("X-WorkHub-Client-Token"), "tok-123");
});

test("connectConversationStream reconnects after the stream ends and calls onReconnected once the new connection opens", async () => {
  let call = 0;
  const opensAtCall: number[] = [];
  let reconnected = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    call += 1;
    if (call === 1) {
      return okResponse(
        sseStream({ frames: ["event: connected\ndata: {}\n\n"], endNaturally: true, signal: init?.signal as AbortSignal | undefined })
      );
    }
    return okResponse(sseStream({ signal: init?.signal as AbortSignal | undefined }));
  }) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/stream",
    getClientToken: () => undefined,
    onEvent: () => {},
    onStatus: (status) => {
      if (status.state === "open") {
        opensAtCall.push(call);
      }
    },
    onReconnected: () => {
      reconnected += 1;
    },
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  await tick(60);
  handle.close();

  assert.deepEqual(opensAtCall, [1, 2]);
  assert.equal(reconnected, 1);
});

test("connectConversationStream schedules a reconnect on an HTTP error response instead of throwing out", async () => {
  let call = 0;
  const statuses: ConversationStreamStatus[] = [];
  const fetchImpl = (async () => {
    call += 1;
    if (call === 1) {
      return httpErrorResponse(500);
    }
    return okResponse(sseStream({}));
  }) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/stream",
    getClientToken: () => undefined,
    onEvent: () => {},
    onStatus: (status) => statuses.push(status),
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  await tick(60);
  handle.close();

  assert.ok(statuses.some((s) => s.state === "reconnect_scheduled"));
  assert.ok(statuses.some((s) => s.state === "open"));
  assert.equal(call, 2);
});

test("connectConversationStream falls back to a malformed-JSON-safe raw string for non-JSON data payloads", async () => {
  const events: ConversationStreamEvent[] = [];
  const fetchImpl = (async () =>
    okResponse(sseStream({ frames: ["event: conversation.presence.typing\ndata: not-json\n\n"] }))) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/stream",
    getClientToken: () => undefined,
    onEvent: (event) => events.push(event),
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  await tick();
  handle.close();

  assert.deepEqual(events, [{ type: "conversation.presence.typing", data: "not-json" }]);
});

test("close() before the connection settles reports closed and never schedules a reconnect", async () => {
  const statuses: ConversationStreamStatus[] = [];
  let fetchCalls = 0;
  const fetchImpl = (async () => {
    fetchCalls += 1;
    // Never resolves within the test window — simulates closing mid-connect.
    return new Promise<Response>(() => {});
  }) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/stream",
    getClientToken: () => undefined,
    onEvent: () => {},
    onStatus: (status) => statuses.push(status),
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  handle.close();
  await tick();

  assert.equal(fetchCalls, 1);
  assert.deepEqual(statuses.map((s) => s.state), ["connecting", "closed"]);
});

test("when neither an injected fetch nor a global fetch exists, the stream reports closed and close() is a safe no-op", () => {
  const globals = globalThis as typeof globalThis & { fetch?: typeof fetch };
  const originalFetch = globals.fetch;
  const statuses: ConversationStreamStatus[] = [];
  try {
    // @ts-expect-error deliberately removing fetch to exercise the "no transport available" fallback.
    globals.fetch = undefined;
    const handle = connectConversationStream({
      url: "http://x/stream",
      getClientToken: () => undefined,
      onEvent: () => {},
      onStatus: (status) => statuses.push(status)
    });
    assert.deepEqual(statuses, [{ state: "closed" }]);
    assert.doesNotThrow(() => handle.close());
  } finally {
    globals.fetch = originalFetch;
  }
});

// —— R13 H1：心跳看门狗接线（真实小间隔计时器，跟本文件其它重连测试同一套 tick() 风格，
// 不引入 node:test 的 mock.timers——这个 workspace 里没有任何先例用过它，真实小 ms 值更贴合既有约定） —— //

test("connectConversationStream aborts and reconnects a connection that never sends a single frame (not even a heartbeat)", async () => {
  let fetchCalls = 0;
  const opensAtCall: number[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    fetchCalls += 1;
    // Stays open forever but never enqueues anything — simulates a half-open TCP connection where
    // reader.read() would hang indefinitely without the watchdog stepping in.
    return okResponse(sseStream({ signal: init?.signal as AbortSignal | undefined }));
  }) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/stream",
    getClientToken: () => undefined,
    onEvent: () => {},
    onStatus: (status) => {
      if (status.state === "open") {
        opensAtCall.push(fetchCalls);
      }
    },
    heartbeatMs: 10,
    heartbeatWatchdogMultiplier: 2, // watchdogMs = 20ms
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  await tick(120);
  handle.close();

  assert.ok(fetchCalls >= 2, `expected the watchdog to force at least one reconnect, saw ${fetchCalls} fetch call(s)`);
  assert.deepEqual(opensAtCall.slice(0, 2), [1, 2]);
});

test("connectConversationStream's heartbeat watchdog is reset by comment-only ping frames, not just real events", async () => {
  const events: ConversationStreamEvent[] = [];
  let fetchCalls = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    fetchCalls += 1;
    const encoder = new TextEncoder();
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    return okResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          // Faster than the 20ms watchdog window below — steady heartbeat pings should keep the
          // connection alive indefinitely even though they never reach onEvent (see
          // parseConversationSseFrame's "ignores comment-only frames" behavior).
          pingTimer = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              clearInterval(pingTimer);
            }
          }, 8);
          init?.signal?.addEventListener("abort", () => {
            clearInterval(pingTimer);
            try {
              controller.error(new DOMException("aborted", "AbortError"));
            } catch {
              // stream already closed/errored — nothing to do.
            }
          });
        }
      })
    );
  }) as typeof fetch;

  const handle = connectConversationStream({
    url: "http://x/stream",
    getClientToken: () => undefined,
    onEvent: (event) => events.push(event),
    heartbeatMs: 10,
    heartbeatWatchdogMultiplier: 2, // watchdogMs = 20ms
    baseDelayMs: 0,
    maxDelayMs: 0,
    random: () => 0,
    fetchImpl
  });

  await tick(100);
  handle.close();

  assert.equal(fetchCalls, 1, "steady pings faster than the watchdog window must keep the single connection alive with no forced reconnect");
  assert.deepEqual(events, []);
});
