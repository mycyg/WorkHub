// WorkHub 桌面 · 主区群聊的 SSE 客户端——手写 fetch+ReadableStream，不用浏览器原生 EventSource
// （EventSource 加不了 X-YQGL-Client-Token 头，桌面端鉴权靠这个头，不是 cookie；同样的取舍已经在
// apps/desktop-webview/src/desktop-cuu-runtime.ts 的 DesktopCuuFetchEventSource 里做过一次，这里为
// 会话流单独写一份而不是复用那个私有类——那个类不导出、且没有本模块需要的"断线指数退避重连+重连后
// 用最高 seq 补缺口"语义，重新组合会比硬塞进去更清楚）。
//
// 协议约定见 apps/api/src/sse/stream.ts：broker 不存回放日志，`connected` 帧固定 resume_mode:"fresh"——
// 断线期间漏掉的事件不能靠 Last-Event-ID 重放（服务端也没实现），只能在重连成功后用
// GET /conversations/:id/messages?afterSeq=<本地已知最高 seq> 主动补一次缺口（onReconnected 回调，
// view.ts 消费）。typing 事件不参与这个 reconcile——它是 3s 瞬态信号，错过了就错过了。

export type ConversationStreamEvent = {
  type: string;
  data: unknown;
};

export type ConversationStreamStatus =
  | { state: "connecting" }
  | { state: "open" }
  | { state: "reconnect_scheduled"; attempt: number; delayMs: number }
  | { state: "closed" };

export type ConversationStreamHandle = {
  close: () => void;
};

export type ConnectConversationStreamInput = {
  url: string;
  getClientToken: () => string | undefined;
  onEvent: (event: ConversationStreamEvent) => void;
  onStatus?: (status: ConversationStreamStatus) => void;
  // 重连成功（新连接的响应头拿到、开始读 body）之后调用一次——不是"收到第一条真实事件"才算，
  // 因为断线期间可能确实没有新消息，reconcile 请求本身就该无条件发一次去确认"没有缺口"。
  onReconnected?: () => void;
  fetchImpl?: typeof fetch;
  random?: () => number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 15_000;

// 指数退避 + 抖动（照 04 §0 参考规范总纲「重试可见：指数退避+抖动」）：抖动只加不减，避免多个客户端
// 同时断线时在同一时刻扎堆重连（thundering herd）。纯函数，random 可注入，方便确定性单测。
export function computeReconnectDelayMs(
  attempt: number,
  input: { baseMs?: number | undefined; maxMs?: number | undefined; random?: (() => number) | undefined } = {}
): number {
  const baseMs = input.baseMs ?? DEFAULT_BASE_DELAY_MS;
  const maxMs = input.maxMs ?? DEFAULT_MAX_DELAY_MS;
  const random = input.random ?? Math.random;
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(maxMs, exponential);
  const jitter = capped * 0.2 * random();
  return Math.round(Math.min(maxMs, capped + jitter));
}

export function parseConversationSseFrame(frame: string): { event: string; data: string } | undefined {
  const trimmed = frame.trim();
  if (!trimmed || trimmed.startsWith(":")) {
    return undefined;
  }
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  return { event, data: dataLines.join("\n") };
}

function jsonOrRawString(data: string): unknown {
  if (!data) {
    return undefined;
  }
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

function resolveFetchImpl(fetchImpl: typeof fetch | undefined): typeof fetch | undefined {
  if (fetchImpl) {
    return fetchImpl;
  }
  return typeof fetch === "function" ? fetch : undefined;
}

export function connectConversationStream(input: ConnectConversationStreamInput): ConversationStreamHandle {
  let closed = false;
  let attempt = 0;
  let controller: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  const emitStatus = (status: ConversationStreamStatus) => input.onStatus?.(status);

  const resolvedFetch = resolveFetchImpl(input.fetchImpl);
  if (!resolvedFetch) {
    emitStatus({ state: "closed" });
    return {
      close() {
        // 已经是终态，close() 是安全的 no-op。
      }
    };
  }
  // 重新绑定成一个 TS 能确认非 undefined 的引用——上面的 guard 是外层函数作用域的窄化，闭包
  // （下面的 openOnce）捕获的是这个新绑定，而不是原始的 `resolvedFetch | undefined` 表达式。
  const fetchImpl: typeof fetch = resolvedFetch;

  function flushBuffer(buffer: string): string {
    let remaining = buffer.replace(/\r\n|\r/gu, "\n");
    for (;;) {
      const boundary = remaining.indexOf("\n\n");
      if (boundary < 0) {
        return remaining;
      }
      const rawFrame = remaining.slice(0, boundary);
      remaining = remaining.slice(boundary + 2);
      const parsed = parseConversationSseFrame(rawFrame);
      if (parsed) {
        input.onEvent({ type: parsed.event, data: jsonOrRawString(parsed.data) });
      }
    }
  }

  async function openOnce(): Promise<void> {
    emitStatus({ state: "connecting" });
    const activeController = new AbortController();
    controller = activeController;
    const token = input.getClientToken();
    const headers = new Headers({ Accept: "text/event-stream" });
    if (token) {
      headers.set("X-WorkHub-Client-Token", token);
      headers.set("X-YQGL-Client-Token", token);
    }
    const response = await fetchImpl(input.url, {
      headers,
      credentials: "same-origin",
      signal: activeController.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`conversation_stream_http_${response.status}`);
    }
    emitStatus({ state: "open" });
    const wasReconnect = attempt > 0;
    attempt = 0;
    if (wasReconnect) {
      input.onReconnected?.();
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const result = await reader.read();
      if (closed) {
        return;
      }
      if (result.done) {
        break;
      }
      buffer += decoder.decode(result.value, { stream: true });
      buffer = flushBuffer(buffer);
    }
  }

  function scheduleReconnect(): void {
    if (closed) {
      return;
    }
    attempt += 1;
    const delayMs = computeReconnectDelayMs(attempt, {
      baseMs: input.baseDelayMs,
      maxMs: input.maxDelayMs,
      random: input.random
    });
    emitStatus({ state: "reconnect_scheduled", attempt, delayMs });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void runLoop();
    }, delayMs);
  }

  async function runLoop(): Promise<void> {
    if (closed) {
      return;
    }
    try {
      await openOnce();
    } catch {
      // 网络错误 / 非 2xx / abort（正常 close() 也会让 reader.read() 或 fetch 以 AbortError 收尾）——
      // 统一走重连调度；closed 时 scheduleReconnect 自己会 no-op。
    }
    if (closed) {
      return;
    }
    scheduleReconnect();
  }

  void runLoop();

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      controller?.abort();
      emitStatus({ state: "closed" });
    }
  };
}
