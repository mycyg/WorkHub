// WorkHub 桌面 · Spotlight 状态机（纯逻辑，高度可单测）。
// 苹果聚焦搜索式「会生长的盒子」：launcher（能力网格/搜索）↔ capability（某能力内联打开）。
// 关键不变量：选中能力**只改这里的状态**，绝不碰 window.location.hash（旧的全屏壳路由已废弃）。
// 能力内部的 list→detail 子状态由各能力 view 自己管，不在这里——这里只管顶层「在哪一屏」。

import type { CommandId } from "../command-palette.js";
import { matchCommands, type CommandMatch } from "../command-palette.js";

export type SpotlightMode =
  | { kind: "launcher" }
  | { kind: "capability"; id: CommandId };

export type SpotlightState = {
  mode: SpotlightMode;
  query: string;
};

export type SpotlightAction =
  | { type: "setQuery"; query: string }
  | { type: "openCapability"; id: CommandId }
  | { type: "back" }
  | { type: "reset" };

export function initialSpotlightState(): SpotlightState {
  return { mode: { kind: "launcher" }, query: "" };
}

// 纯 reducer。无副作用、无 DOM、无 hash——选能力只是把 mode 切到 capability。
export function spotlightReducer(state: SpotlightState, action: SpotlightAction): SpotlightState {
  switch (action.type) {
    case "setQuery":
      // 输入只在 launcher 屏过滤能力网格；能力内联屏不改顶层 query（各 view 自己处理输入）。
      if (state.mode.kind !== "launcher") {
        return state;
      }
      return { ...state, query: action.query };
    case "openCapability":
      return { mode: { kind: "capability", id: action.id }, query: state.query };
    case "back":
      // 回退到 launcher 并清空查询（回到干净的能力网格）。
      return { mode: { kind: "launcher" }, query: "" };
    case "reset":
      return initialSpotlightState();
    default:
      return state;
  }
}

export function isLauncher(state: SpotlightState): boolean {
  return state.mode.kind === "launcher";
}

export function openCapabilityId(state: SpotlightState): CommandId | undefined {
  return state.mode.kind === "capability" ? state.mode.id : undefined;
}

// launcher 屏当前应展示的能力（空查询=全部默认序；有查询=模糊匹配排序）。复用命令面板匹配器。
export function launcherMatches(state: SpotlightState, locale: string | undefined): CommandMatch[] {
  return matchCommands(state.query, locale);
}

// 回车直达：launcher 屏下当前最优匹配的能力 id（无匹配则 undefined）。
export function topMatchId(state: SpotlightState, locale: string | undefined): CommandId | undefined {
  if (state.mode.kind !== "launcher") {
    return undefined;
  }
  return launcherMatches(state, locale)[0]?.command.id;
}

// 壳层 navigate 路由(托盘 /inbox·/settings、深链、桌宠 focusMainRoute 触发 main 窗 emit "navigate") → 能力。
// 前缀匹配，故 /workitems/123 也归到 workitem；回 "/" 或无匹配则返回 undefined（控制器据此回 launcher）。
const SHELL_ROUTE_CAPABILITIES: ReadonlyArray<readonly [string, CommandId]> = [
  ["/inbox", "approvals"],
  ["/approvals", "approvals"],
  ["/intake", "intake"],
  ["/proposals", "proposals"],
  ["/workitems", "workitem"],
  ["/agent-runs", "replay"],
  ["/replay", "replay"],
  ["/drive", "drive"],
  ["/projects", "projects"],
  ["/knowledge", "knowledge"],
  ["/team", "team"],
  ["/dashboard/cost", "cost"],
  ["/cost", "cost"],
  ["/settings", "settings"]
];

export function capabilityForShellRoute(route: string): CommandId | undefined {
  const path = (route.split(/[?#]/u)[0] ?? route).replace(/\/+$/u, "") || "/";
  if (path === "/") {
    return undefined;
  }
  for (const [prefix, id] of SHELL_ROUTE_CAPABILITIES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return id;
    }
  }
  return undefined;
}

// 从壳层路由抽出目标实体 id（深链/托盘/桌宠 navigate 用）：/workitems/abc → "abc"、/proposals/xyz → "xyz"。
// 优先取前缀后的首段路径 id；无路径 id 时回退查询参数 id/project_id（如 /drive?project_id=p → "p"）。
// rank13：openCapability 据此让 workitem/proposals/replay 直接打开该项，而非永远落到列表。
export function entityIdFromShellRoute(route: string): string | undefined {
  const path = (route.split(/[?#]/u)[0] ?? route).replace(/\/+$/u, "") || "/";
  for (const [prefix] of SHELL_ROUTE_CAPABILITIES) {
    if (path.startsWith(`${prefix}/`)) {
      const seg = path.slice(prefix.length + 1).split("/")[0];
      if (seg) {
        return decodeURIComponent(seg);
      }
    }
  }
  const query = route.split("?")[1]?.split("#")[0];
  if (query) {
    const params = new URLSearchParams(query);
    const q = params.get("id") ?? params.get("project_id") ?? params.get("m") ?? params.get("run_id");
    if (q) {
      return q;
    }
  }
  return undefined;
}
