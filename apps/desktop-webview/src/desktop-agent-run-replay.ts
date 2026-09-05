// WorkHub 桌面 · agent-run 回放的取数/渲染/撤销薄接线。
//
// F-06（一键回滚桌面挂载）：这三个函数原来活在 apps/desktop-webview/src/main.ts（一个只剩类型/常量转发、
// 没有任何真实外壳调用它的死 barrel），全仓只有 main.test.ts 引用——README 承诺的「一键回滚」端点/契约/
// 渲染/binder 全齐，唯独没有真实 UI 调用这条链路，点了等于没做。main.ts 正被作为死码整体移除，这里把
// 实现原样搬出来单独成一个小模块，并在 spotlight/views/replay.ts 里真正调用 bindDesktopAgentRunReplayRevert
// （renderDesktopAgentRunReplay 一并搬来保持完整对称——它渲的是独立整页视觉，桌面 Spotlight 回放视图另有
// 自己的玻璃化 trace + 快照区实现，不直接用这个整页渲染器，但保留它作为可复用的完整回放页出口）。
import type { WorkHubApiClient } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { bindReplayRevertActions, renderAgentRunReplay, type ReplayRevertRoot } from "@workhub/ui/replay";

export function loadDesktopAgentRunReplay(client: WorkHubApiClient, runId: string) {
  return client.replayAgentRun(runId);
}

export async function renderDesktopAgentRunReplay(client: WorkHubApiClient, runId: string, locale?: WorkHubLocale) {
  return renderAgentRunReplay(await loadDesktopAgentRunReplay(client, runId), "desktop", locale ? { locale } : undefined);
}

// R20 DSK-UX（R19-3）：桌面壳挂上 replay 的 HTML 后调这里，给「撤销此次改动」按钮接真回调——桌面本就是
// 本地客户端，可直接执行 POST /api/agent-runs/:id/revert（snapshot_id 走 body）。web 端不接这条、由既有
// data-requires-desktop 拦截渲成「需在桌面端操作」。二次确认 + 刷新都在 @workhub/ui 的 bindReplayRevertActions
// 里，这里只做「传 client + 回调」的薄接线。缺 revertAgentRun（旧 client）则安静退化成 no-op。
export function bindDesktopAgentRunReplayRevert(
  root: ReplayRevertRoot,
  client: WorkHubApiClient,
  options?: { onReverted?: (info: { runId: string; snapshotId: string }) => void }
): () => void {
  const revert = client.revertAgentRun;
  if (!revert) {
    return () => {};
  }
  return bindReplayRevertActions(root, {
    revert: (runId, payload) => revert(runId, payload),
    ...(options?.onReverted ? { onReverted: options.onReverted } : {})
  });
}
