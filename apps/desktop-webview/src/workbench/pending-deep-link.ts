// WorkHub 桌面 · 工作台深链冷启动竞态的前端侧兜底（批 1 遗留，见
// r12-desktop-workbench/reports/batch-1-frontend.md「深链冷启动的潜在丢事件竞态」与
// r12-desktop-workbench/reports/integration-wave-1.md 待办 #5：「批2 接 SSE/store 时一并处理」）。
//
// 根因（client-tauri/src-tauri/src/main.rs `handle_deep_link_url`）：Rust 侧
// `create_workbench_window_if_missing` 只保证原生窗口对象已创建（`WebviewWindowBuilder::build()`
// 返回），并不等待 webview 真正把 workbench.html 的 JS 跑到订阅 "deep-link" 事件那一步——随后立刻
// `app.emit("deep-link", plan)`。冷启动（窗口此前不存在）时，这次 emit 几乎总是在前端订阅之前发生，
// Tauri 的事件总线不做重放，事件就丢了。这段代码在 client-tauri/**（本批禁止改动），只能在前端侧补。
//
// 前端侧能覆盖的场景：本 App 自己发起的「打开工作台」（Spotlight 入口 workbench-open.ts 调用
// invoke("open_workbench", ...)）——这条路径上，发起 invoke 的窗口（Spotlight/主窗）和目标窗口
// （workbench）在同一个 Tauri 应用里共享同一个 webview 数据源（devUrl 或 tauri://localhost 单一
// origin，见 tauri.conf.json 的三个 windows 都只是不同 path），因此 localStorage 是跨窗口共享的。
// 于是：发起 invoke 之前，先把目标写进 localStorage（同步、零 IPC 往返，不存在竞态）；workbench 窗口
// boot() 时读一次、命中就消费并立即清除（一次性令牌，不参与后续 reconcile）。
//
// 覆盖不到的场景（诚实说明）：应用完全没启动时，操作系统直接用 workhub:// URL 唤起
// （用户点了系统级的深链，不经过本 App 自己的 Spotlight UI）——这条路径没有"发起窗口"能提前写
// localStorage。MRG-23 已在 Rust 侧补上「窗口就绪后按 label 认领暂存的最后一条 deep-link」
// （main.rs handle_deep_link_plan 暂存 + take_pending_deep_link 认领，workbench boot 的
// applyReplayedShellDeepLink 消费）——本 stash 机制仍保留，覆盖「本 App 自己发起」路径（同步、零 IPC）。

const PENDING_DEEP_LINK_STORAGE_KEY = "workhub_workbench_pending_deep_link";
// 冷启动路径：invoke → 原生窗口创建 → webview 加载 → boot() 跑到 consume 这一步，正常应在几百毫秒内
// 完成。给足 15s 余量（覆盖较慢的机器/首次冷启动），过期的残留条目视为无效——避免窗口长期隐藏复用
// （Rust 侧 create:false）时，一条很久以前写入但从未被消费的陈旧 stash 在某次不相关的重新打开里被
// 误当成"这次"的目标而错误选中项目。

export const PENDING_WORKBENCH_DEEP_LINK_TTL_MS = 15_000;

export type PendingWorkbenchDeepLinkTarget = {
  projectId: string;
  conversationId?: string;
  // R17-G5 #30：搜索命中会话消息时，deep_link 带的 seq——工作台打开会话后据此定位滚动 + 高亮那条消息。
  // 只在带 conversationId 时有意义（seq 是某个会话内的消息序号）。
  seq?: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function safeStorage(storage: StorageLike | undefined): StorageLike | undefined {
  try {
    // 隐私模式/配额已满等场景 localStorage 访问本身会抛错——降级为「没有兜底」而不是崩溃。
    return storage ?? window.localStorage;
  } catch {
    return undefined;
  }
}

// 发起打开工作台（本 App 内，如 Spotlight「打开工作台」）之前调用：把目标同步写进 localStorage。
export function stashPendingWorkbenchDeepLink(
  target: PendingWorkbenchDeepLinkTarget,
  input: { storage?: StorageLike; now?: () => number } = {}
): void {
  const storage = safeStorage(input.storage);
  if (!storage || !target.projectId) {
    return;
  }
  const now = input.now ?? Date.now;
  const payload = JSON.stringify({
    projectId: target.projectId,
    ...(target.conversationId ? { conversationId: target.conversationId } : {}),
    // seq 只在有会话上下文时才有意义，随会话一起写；无会话就不带。
    ...(target.conversationId && typeof target.seq === "number" ? { seq: target.seq } : {}),
    stashedAt: now()
  });
  try {
    storage.setItem(PENDING_DEEP_LINK_STORAGE_KEY, payload);
  } catch {
    // 写入失败（配额/隐私模式）：没有兜底，冷启动竞态照旧存在——不是本函数能挽救的，静默降级。
  }
}

// workbench 窗口 boot() 时调用一次：命中就消费（立即清除，一次性令牌，不重放）。
// 过期/损坏/没有 projectId 的条目一律当作没有 stash——都会被清除，不留污染下一次判断的残留。
export function consumePendingWorkbenchDeepLink(
  input: { storage?: StorageLike; now?: () => number } = {}
): PendingWorkbenchDeepLinkTarget | undefined {
  const storage = safeStorage(input.storage);
  if (!storage) {
    return undefined;
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_DEEP_LINK_STORAGE_KEY);
  } catch {
    return undefined;
  }
  if (!raw) {
    return undefined;
  }
  try {
    storage.removeItem(PENDING_DEEP_LINK_STORAGE_KEY);
  } catch {
    // 移除失败也继续往下走——宁可这条 stash 被重复读到（下次仍会因 TTL/内容校验被过滤），
    // 也不要因为清理失败就假装没读到过它。
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const projectId = typeof record.projectId === "string" ? record.projectId : undefined;
  const stashedAt = typeof record.stashedAt === "number" ? record.stashedAt : undefined;
  if (!projectId || stashedAt === undefined) {
    return undefined;
  }
  const now = input.now ?? Date.now;
  if (now() - stashedAt > PENDING_WORKBENCH_DEEP_LINK_TTL_MS) {
    return undefined;
  }
  const conversationId = typeof record.conversationId === "string" ? record.conversationId : undefined;
  if (!conversationId) {
    return { projectId };
  }
  // seq 仅在同时有会话时透传，且必须是非负整数（消息序号）；不合法就只回到会话级、不带定位。
  const seq =
    typeof record.seq === "number" && Number.isInteger(record.seq) && record.seq >= 0 ? record.seq : undefined;
  return seq !== undefined ? { projectId, conversationId, seq } : { projectId, conversationId };
}
