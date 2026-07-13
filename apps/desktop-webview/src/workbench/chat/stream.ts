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
  // R13 H1（自审 backlog 项1）：心跳看门狗——服务端 heartbeatMs（apps/api/src/sse/stream.ts 默认
  // 30_000ms，无路由覆盖，走 ": ping" 注释帧）与看门狗倍率，都可注入以便测试用更短的窗口。
  heartbeatMs?: number;
  heartbeatWatchdogMultiplier?: number;
  // 测试用可注入时钟；生产默认 Date.now。
  now?: () => number;
};

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 15_000;
// 服务端心跳默认间隔——见 apps/api/src/sse/stream.ts 的 `heartbeatMs = options.heartbeatMs ?? 30000`
// （本仓库目前没有任何路由覆盖这个默认值，见 grep 结果：只有 qa 冒烟脚本会传自定义值）。
export const DEFAULT_SERVER_HEARTBEAT_MS = 30_000;
// N=2.5×心跳间隔——规划里定的倍率（r13-workbench-refinement/00-plan.md 批 H1），留够两次心跳的抖动
// 余量再判定为"半开连接"，不会被单次心跳延迟误伤。
export const DEFAULT_HEARTBEAT_WATCHDOG_MULTIPLIER = 2.5;

// 纯函数——看门狗窗口时长，不碰时钟/定时器，方便直接断言。
export function computeHeartbeatWatchdogMs(
  heartbeatMs: number = DEFAULT_SERVER_HEARTBEAT_MS,
  multiplier: number = DEFAULT_HEARTBEAT_WATCHDOG_MULTIPLIER
): number {
  return heartbeatMs * multiplier;
}

// 纯函数——给定"最后一次收到任意帧（含心跳注释帧）的时刻"和"现在"，判定看门狗窗口是否已经过期。
// 定时器只是"到点了调一下这个函数复核"的壳（见 connectConversationStream 里的 armWatchdog/
// checkWatchdog），真正的判定逻辑在这里，可以脱离 setTimeout 直接单测。
export function isHeartbeatWatchdogExpired(input: { lastFrameAtMs: number; nowMs: number; watchdogMs: number }): boolean {
  return input.nowMs - input.lastFrameAtMs >= input.watchdogMs;
}

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

  // R13 H1（自审 backlog 项1）：心跳看门狗——TCP 半开时 reader.read() 可能永久挂起而不 resolve/
  // 不抛错，UI 却仍然显示"已连接"（服务端早就收不到、也发不出任何东西了）。这里在连接一打开、以及
  // 此后每收到一帧（含心跳注释帧本身，见 flushBuffer 里的 noteFrameReceived 调用——那种帧从不到达
  // input.onEvent，但一样证明连接活着）时，重置一个 N=heartbeatMs×multiplier 的计时器；到点还没
  // 收到任何新帧就主动 abort 当前连接，走 runLoop 既有的 catch→scheduleReconnect 路径，不需要
  // 额外分支。定时器只是"到点了拿纯函数复核一下"的壳，真正的判定在 isHeartbeatWatchdogExpired。
  const watchdogMs = computeHeartbeatWatchdogMs(input.heartbeatMs, input.heartbeatWatchdogMultiplier);
  const nowFn = input.now ?? Date.now;
  let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
  let lastFrameAtMs = 0;

  function clearWatchdog(): void {
    if (watchdogTimer !== undefined) {
      clearTimeout(watchdogTimer);
      watchdogTimer = undefined;
    }
  }

  function armWatchdog(): void {
    clearWatchdog();
    watchdogTimer = setTimeout(checkWatchdog, watchdogMs);
  }

  function checkWatchdog(): void {
    watchdogTimer = undefined;
    if (closed) {
      return;
    }
    if (isHeartbeatWatchdogExpired({ lastFrameAtMs, nowMs: nowFn(), watchdogMs })) {
      // controller 在这一刻永远指向"当前这次" openOnce 的 activeController——openOnce 的
      // try/finally 保证每次读循环结束（无论正常/异常）都会 clearWatchdog，所以这个定时器不可能
      // 活过它所属的那次连接、去误伤后续重连出来的新连接。
      controller?.abort();
      return;
    }
    armWatchdog(); // 罕见：系统调度抖动导致定时器提前触发，纯函数复核后没到点就重新武装一整轮。
  }

  function noteFrameReceived(): void {
    lastFrameAtMs = nowFn();
    armWatchdog();
  }

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
      // 任何帧都算"连接还活着"——心跳注释帧（parsed 为 undefined）尤其重要，它才是看门狗真正
      // 要盯的信号：真实事件稀疏时,靠心跳撑住不误判半开连接。
      noteFrameReceived();
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
    // 看门狗的武装/拆除都收在这个 try/finally 里——保证读循环无论怎么结束（自然 done、抛错、
    // 被自己 abort）都会清掉定时器，绝不会有一个属于"上一次连接"的计时器活到下一次 openOnce。
    try {
      noteFrameReceived(); // 连接一打开就当作收到一帧,开始计时(服务端可能要等到第一次心跳才发东西)。
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
    } finally {
      clearWatchdog();
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
      clearWatchdog();
      controller?.abort();
      emitStatus({ state: "closed" });
    }
  };
}
