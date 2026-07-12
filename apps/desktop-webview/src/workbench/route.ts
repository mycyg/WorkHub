// WorkHub 桌面 · 工作台深链路由解析（纯函数，无 DOM/Tauri 依赖，便于单测）。
//
// Rust 侧（client-tauri/src-tauri/src/deep_link.rs）把 workhub://workbench[/projectId[/conversationId]]
// 解析成 { route: "/workbench[/projectId[/conversationId]]", windowControl: { label: "workbench", ... } }，
// 再通过全局 Tauri 事件 "deep-link" 广播给所有已挂监听器的窗口（含本工作台窗口自身）。这里只做两件事：
// 1) 校验/解析事件 payload 的形状（parseWorkbenchDeepLinkPlan）；
// 2) 把 route 字符串拆成 { projectId?, conversationId? }（parseWorkbenchRoute）。
// 段内容不在这里做 uuid 形状校验——Rust 侧已拒绝路径穿越/不安全片段，存在性与访问权限最终由
// GET /api/pages/workbench/:projectId 服务端 fail-closed 裁决（02 §3 踩雷）。

export type WorkbenchRouteContext = {
  projectId?: string;
  conversationId?: string;
};

export type WorkbenchWindowControlAction = "show" | "hide" | "toggle" | "focus" | "show_and_focus";

export type WorkbenchWindowControlPlan = {
  label: string;
  action: WorkbenchWindowControlAction;
  source: string;
  focus: boolean;
  reason: string;
  route?: string;
};

export type WorkbenchDeepLinkPlan = {
  rawUrl: string;
  scheme: string;
  route: string;
  windowControl: WorkbenchWindowControlPlan;
};

// route 是 "/workbench"、"/workbench/<projectId>" 或 "/workbench/<projectId>/<conversationId>" 之一才有意义；
// 其它字符串（Rust 侧发给主窗的 /workitems/... 等）一律返回 undefined，调用方据此忽略。
export function parseWorkbenchRoute(route: string): WorkbenchRouteContext | undefined {
  const trimmed = route.trim();
  if (trimmed !== "/workbench" && !trimmed.startsWith("/workbench/")) {
    return undefined;
  }
  const rest = trimmed.slice("/workbench".length).replace(/^\/+/u, "");
  if (!rest) {
    return {};
  }
  const segments = rest.split("/").filter((segment) => segment.length > 0);
  const [projectId, conversationId] = segments;
  if (!projectId) {
    return {};
  }
  return conversationId ? { projectId, conversationId } : { projectId };
}

export function isWorkbenchWindowControlPlan(plan: WorkbenchDeepLinkPlan): boolean {
  return plan.windowControl.label === "workbench";
}

export function parseWorkbenchDeepLinkPlan(input: unknown): WorkbenchDeepLinkPlan | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  const rawUrl = stringField(record, "rawUrl");
  const scheme = stringField(record, "scheme");
  const route = stringField(record, "route");
  const windowControl = parseWindowControlPlan(record.windowControl);
  if (!rawUrl || !scheme || !route || !windowControl) {
    return undefined;
  }
  return { rawUrl, scheme, route, windowControl };
}

function parseWindowControlPlan(input: unknown): WorkbenchWindowControlPlan | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  const label = stringField(record, "label");
  const action = stringField(record, "action");
  const source = stringField(record, "source");
  const focus = record.focus;
  const reason = stringField(record, "reason");
  if (!label || !isWindowControlAction(action) || !source || typeof focus !== "boolean" || !reason) {
    return undefined;
  }
  const route = stringField(record, "route");
  return {
    label,
    action,
    source,
    focus,
    reason,
    ...(route ? { route } : {})
  };
}

function isWindowControlAction(value: string | undefined): value is WorkbenchWindowControlAction {
  return value === "show" || value === "hide" || value === "toggle" || value === "focus" || value === "show_and_focus";
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}
