import type { CommandId } from "./command-palette.js";
import { parseDesktopShellNavigatePayload } from "./shell-events.js";
import type { SpotlightHandle } from "./spotlight/controller.js";
import { capabilityForShellRoute, entityIdFromShellRoute } from "./spotlight/state.js";
import type { SpotlightTarget } from "./spotlight/view-context.js";

export type DesktopSpotlightProjectContextSaver = (route: string) => unknown;

export type DesktopSpotlightShellNavigationResult =
  | { kind: "open"; route: string; capability: CommandId; target: SpotlightTarget }
  | { kind: "home"; route: string }
  | { kind: "ignored"; reason: "unparsable" | "window-control" | "unmapped"; route?: string };

// 壳层「只是把主窗显示出来」的窗口控制原因（window_controls.rs 的 control_plan reason）。
// 这类事件从不该改变盒子当前打开的能力，见下方 S3-#6 注释。
const WINDOW_CONTROL_ONLY_REASONS = new Set(["show-main", "hide-main"]);

// 壳层 navigate 事件（托盘「打开收件箱/设置」、workhub:// 深链、系统通知、桌宠卡片链接）→ 聚焦盒动作。
//
// S3-#6 根因的 webview 半边：这里过去把「认不出的路由」一律当成 `spotlight.reset()`，是一个**破坏性
// 默认值**——盒子里正开着的能力（设置/审批/网盘草稿）会被一条与用户意图无关的事件洗成 idle 搜索条。
// 配合 Rust 侧 `show_main_window` 计划带的根路径 `/`（「显示窗口」被当成「导航到根」广播出来），
// macOS 上「深链/托盘点一下 → 应用激活 → RunEvent::Reopen → navigate `/` → 复位」这条竞态就把
// 深链刚打开的能力立刻洗掉了，肉眼看就是「深链只把 app 拉到前台、盒子复位成 idle 条」。
//
// 现在的契约只有三条，且默认不破坏现场：
// 1. 路由能映射到能力 → 打开它（带上实体 id）；
// 2. 路由是根路径 `/` → 回 launcher 主页（唯一一条显式的复位语义，壳层不再为「显示窗口」发它）；
// 3. 其余（解析不出、纯窗口控制原因、映射不到能力的路由如 /workbench/... 、/me）→ **什么都不做**。
export function handleDesktopSpotlightShellNavigate(
  payload: unknown,
  input: {
    spotlight: Pick<SpotlightHandle, "openCapability" | "reset">;
    saveProjectContextFromRoute?: DesktopSpotlightProjectContextSaver | undefined;
  }
): DesktopSpotlightShellNavigationResult {
  const parsed = parseDesktopShellNavigatePayload(payload);
  if (!parsed) {
    return { kind: "ignored", reason: "unparsable" };
  }

  // 兜底（防御旧壳层/未来新增计划）：带着「显示/隐藏窗口」原因的事件不是导航请求，一律不动盒子。
  if (parsed.reason && WINDOW_CONTROL_ONLY_REASONS.has(parsed.reason)) {
    return { kind: "ignored", reason: "window-control", route: parsed.route };
  }

  input.saveProjectContextFromRoute?.(parsed.route);

  const capability = capabilityForShellRoute(parsed.route);
  if (capability) {
    const id = entityIdFromShellRoute(parsed.route);
    const target = id ? { id, route: parsed.route } : { route: parsed.route };
    input.spotlight.openCapability(capability, target);
    return { kind: "open", route: parsed.route, capability, target };
  }

  if (parsed.route === "/") {
    input.spotlight.reset();
    return { kind: "home", route: parsed.route };
  }

  return { kind: "ignored", reason: "unmapped", route: parsed.route };
}
