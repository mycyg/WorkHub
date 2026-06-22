// WorkHub 桌面 · Spotlight 能力内联视图契约。
// 每个能力（审批/澄清/看改动/网盘/项目/工作项/回放/成本/知识/团队/设置）实现一个 SpotlightCapabilityView，
// 渲到盒子内容区（ctx.body）。统一玻璃风（design-system 类名），复用 client.pages.* 数据加载器 + web-runtime
// 动作助手，**不**复用 gold-path 旧视觉、**不**走 hash 全屏壳。

import type { createApiClient } from "@workhub/api-client/client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

import type { CommandId } from "../command-palette.js";

export type SpotlightApiClient = ReturnType<typeof createApiClient>;

export type SpotlightViewContext = {
  client: SpotlightApiClient;
  locale: WorkHubLocale;
  // 盒子内容区：view 把自己的 HTML 渲进这里，可随 list→detail 自由重渲。
  body: HTMLElement;
  // 回到 launcher（能力网格）。盒子顶部面包屑「← 返回」与 ESC 都调它。
  back: () => void;
  // 顶部标题栏右侧的副标题（如「3 条待你拍板」/「项目 · 文件」），用于面包屑上下文。可随子状态更新。
  setSubtitle: (text: string) => void;
  // 内联轻提示（动作回执/错误）。在盒子内浮一条，不打断。
  toast: (message: string, tone?: "ok" | "error" | "info") => void;
  // 内容高度变化后请求重新测量并缩放原生窗口（盒子随内容生长/收缩）。
  requestResize: () => void;
  // 本能力视图的生命周期信号：离开能力时 abort。view 必须用它给 addEventListener 传 {signal}，
  // 否则监听器会随能力切换在 body 上累积（H1 泄漏）。
  signal: AbortSignal;
};

export type SpotlightCapabilityView = {
  id: CommandId;
  // 进入能力时调用。可异步（先渲 loading 骨架，再拉数据重渲）。返回的清理函数在离开能力时调用。
  mount: (ctx: SpotlightViewContext) => void | (() => void) | Promise<void | (() => void)>;
};

export type SpotlightCapabilityViewFactory = () => SpotlightCapabilityView;
