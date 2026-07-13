// WorkHub 桌面 · R12 批7:Cuu 气泡深链 href 的构造/解析 + 派活问询气泡话术。纯函数，不碰 window/Tauri
// invoke——那部分(真正发起 open_workbench)拆在同目录的 cuu-bubble-open.ts。
//
// 为什么要拆开两个文件:apps/api/src/qa/cuu-r3-launcher-harness.ts 出于 QA 目的直接从
// apps/desktop-webview 跨包 import 了 desktop-cuu-runtime.ts 的若干符号，这条既有的跨包边界意味着
// desktop-cuu-runtime.ts 的整条 import 链都会被 apps/api 的 tsconfig(lib 只有 ES2022，没有 DOM)重新
// typecheck 一遍。desktop-cuu-runtime.ts 需要本文件的 buildWorkbenchDeepLinkHref/buildDispatchAskBubbleCopy
// 来渲染派活问询卡，但完全不需要 cuu-bubble-open.ts 里那个要用到 `window.localStorage`(经
// pending-deep-link.ts 的 stashPendingWorkbenchDeepLink)的 openWorkbenchRouteFromPet——那个只有
// pet-surface.ts(从不被 apps/api 引用)的点击处理器用得到。混在一个文件里会让 window 引用顺着
// desktop-cuu-runtime.ts → apps/api 的 import 图传染进去，在 apps/api 的 Node-only tsconfig 下报
// "Cannot find name 'window'"——这不是本批引入的架构问题(那条跨包 QA import 本来就在)，但拆分是本批
// 范围内、不碰 apps/api 就能做到的干净修法。

import type { WorkHubLocale } from "@workhub/contracts";

export const WORKBENCH_DEEP_LINK_ROUTE_PREFIX = "/workbench";

// 段本身不允许再带路径分隔符/查询/hash——和 open_workbench 的 Rust 侧段校验同一条底线
// (main.rs: id.contains('/') || '\\' || '?' || '#' 一律拒绝),前端这层提前挡掉，避免拼出一个
// Rust 侧会直接 Err 掉的深链。
const UNSAFE_ID_SEGMENT = /[/\\?#]/u;

export type WorkbenchDeepLinkRouteTarget = {
  projectId: string;
  conversationId?: string;
};

// 铸一个气泡 action 的 href——固定 /workbench/<projectId>[/<conversationId>] 形状，和 00 §1 文档里
// 记录的 `workhub://workbench/<projectId>/<conversationId>` 深链同构，只是用相对路径(不是自定义协议)：
// 相对路径能被 pet-surface.ts 既有的 href 安全解析套路(new URL(href, "tauri://localhost"))正确识别为
// "站内"链接，不会被当成外部地址拦下。
export function buildWorkbenchDeepLinkHref(target: WorkbenchDeepLinkRouteTarget): string {
  const segments = [WORKBENCH_DEEP_LINK_ROUTE_PREFIX, encodeURIComponent(target.projectId)];
  if (target.conversationId) {
    segments.push(encodeURIComponent(target.conversationId));
  }
  return segments.join("/");
}

// 从一个 <a href> 属性值里识别出「这是一条工作台深链」——安全解析套路照抄 pet-surface.ts 的
// desktopPetMainRouteFromHref:只认相对路径 / tauri://localhost / http(s)://localhost 三种"站内"形式，
// 外部地址一律拒绝识别（不给任何跳转钓鱼 href 可乘之机）。
export function parseWorkbenchDeepLinkHref(href: string | null | undefined): WorkbenchDeepLinkRouteTarget | undefined {
  const raw = href?.trim();
  if (!raw || raw.startsWith("#") || /^javascript:/iu.test(raw)) {
    return undefined;
  }
  let pathname: string;
  try {
    const parsed = new URL(raw, "tauri://localhost");
    const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(raw);
    const isRelative = !hasScheme || raw.startsWith("/");
    const isTauriLocal = parsed.protocol === "tauri:" && (!parsed.hostname || parsed.hostname === "localhost");
    const isWorkHubLocal =
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "workhub.local");
    if (!isRelative && !isTauriLocal && !isWorkHubLocal) {
      return undefined;
    }
    pathname = parsed.pathname;
  } catch {
    return undefined;
  }

  const match = /^\/workbench\/([^/]+)(?:\/([^/]+))?\/?$/u.exec(pathname);
  if (!match?.[1]) {
    return undefined;
  }
  const projectId = safeDecodeIdSegment(match[1]);
  if (!projectId) {
    return undefined;
  }
  const conversationId = match[2] ? safeDecodeIdSegment(match[2]) : undefined;
  return conversationId ? { projectId, conversationId } : { projectId };
}

function safeDecodeIdSegment(segment: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return undefined;
  }
  if (!decoded || UNSAFE_ID_SEGMENT.test(decoded)) {
    return undefined;
  }
  return decoded;
}

// ── 被派活告知气泡话术 ────────────────────────────────────────────────────────────────
// 对应真实事件:apps/api/src/workers/conversation-observer.ts 的 dispatchExecuteItem 在
// dispatchPolicy==="ask" 时创建的 notification(type="action_card_item.dispatch_ask", 见
// r12-desktop-workbench 批3汇报)。这是"问询"通知(先问要不要接,不是"已经开工了")——话术照实况写
// 成问句，不写成既成事实；语气延续仓库既有 Cuu 一等成员人格(00 §0:"Cuu 人格唯一"),二次元基调但
// 不用 emoji(用户偏好),不用颜文字(不在本批范围内新造视觉规范)。
export function buildDispatchAskBubbleCopy(input: {
  locale: WorkHubLocale;
  taskTitle: string;
  projectLabel?: string;
}): { title: string; message: string } {
  const taskTitle = input.taskTitle.trim() || (input.locale === "en-US" ? "a new task" : "一件新工作");
  if (input.locale === "en-US") {
    return {
      title: "A task might come my way",
      message: input.projectLabel
        ? `Over in "${input.projectLabel}", the discussion turned up something for me: ${taskTitle} — want me to take it on?`
        : `The discussion turned up something for me: ${taskTitle} — want me to take it on?`
    };
  }
  return {
    title: "有个活儿想派给我",
    message: input.projectLabel
      ? `「${input.projectLabel}」的讨论里聊出一件事想派给我：${taskTitle}——要不要我接下来喵？`
      : `讨论里聊出一件事想派给我：${taskTitle}——要不要我接下来喵？`
  };
}
