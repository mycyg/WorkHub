import type { CuuCard, CuuCardAction, CuuCardChip } from "@workhub/cuu";
import type { WorkHubApiClient } from "@workhub/api-client";

import { createDesktopShellEventBridge } from "./shell-events.js";

export type DesktopShellEventEnvelope = {
  payload: unknown;
};

export type DesktopShellUnlisten = () => void;

export type DesktopShellListen = (
  eventName: "push-event" | "sse-status",
  handler: (event: DesktopShellEventEnvelope) => void
) => DesktopShellUnlisten | Promise<DesktopShellUnlisten> | void | Promise<void>;

export type DesktopCuuNotice = {
  card: CuuCard;
  message: string;
  html: string;
};

export type DesktopShellCuuRuntime = {
  subscribed: boolean;
  dispose: () => Promise<void>;
};

export type DesktopCuuActionRequest =
  | {
      kind: "approval-response";
      approvalId: string;
      decision: "allow" | "deny";
      requiresReason: boolean;
    }
  | {
      kind: "session-next-question";
      sessionId: string;
    };

export type DesktopCuuActionResult = {
  message: string;
};

type DesktopShellGlobal = {
  __TAURI__?: {
    event?: {
      listen?: DesktopShellListen;
    };
  };
  __YQGL_MOCK_LISTEN__?: DesktopShellListen;
};

export const desktopCuuNoticeCss = [
  ".wh-cuu-card{display:grid;gap:10px;margin-top:10px;font-weight:650}",
  ".wh-cuu-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px}",
  ".wh-cuu-card-kicker{display:flex;align-items:center;gap:8px;color:var(--wh-app-muted);font-size:12px}",
  ".wh-cuu-card-paw{width:18px;height:18px;border-radius:50%;background:linear-gradient(135deg,#ffb169,#355cff);box-shadow:0 6px 16px rgba(53,92,255,.18)}",
  ".wh-cuu-card-state{font-size:11px;color:var(--wh-app-muted);font-weight:800}",
  ".wh-cuu-card-title{font-size:15px;line-height:1.35}",
  ".wh-cuu-card-message{margin:0;color:var(--wh-app-muted);font-size:13px;line-height:1.45;font-weight:600}",
  ".wh-cuu-card-chips,.wh-cuu-card-actions{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-cuu-chip{border:1px solid var(--wh-app-line);border-radius:999px;background:#fff;padding:5px 8px;font-size:12px;color:var(--wh-app-ink)}",
  ".wh-cuu-action{border:1px solid var(--wh-app-line);border-radius:8px;background:#fff;padding:8px 10px;color:var(--wh-app-ink);font-size:13px;text-decoration:none;font-weight:800}",
  ".wh-cuu-action[data-tone=primary]{background:var(--wh-app-blue);border-color:var(--wh-app-blue);color:#fff}",
  ".wh-cuu-action[data-tone=danger]{background:#fff4f3;border-color:rgba(238,107,95,.34);color:#b42318}"
].join("");

export function resolveDesktopShellListen(input: unknown = globalThis): DesktopShellListen | undefined {
  const target = input as DesktopShellGlobal;
  return target.__TAURI__?.event?.listen ?? target.__YQGL_MOCK_LISTEN__;
}

export async function bindDesktopShellCuuRuntime(input: {
  listen?: DesktopShellListen | undefined;
  notify: (notice: DesktopCuuNotice) => void;
  now?: () => Date;
}): Promise<DesktopShellCuuRuntime> {
  const listen = input.listen ?? resolveDesktopShellListen();
  if (!listen) {
    return {
      subscribed: false,
      async dispose() {}
    };
  }

  const bridge = createDesktopShellEventBridge({
    ...(input.now ? { now: input.now } : {}),
    onCuuCard(card) {
      input.notify({
        card,
        message: desktopCuuNoticeMessage(card),
        html: renderDesktopCuuNotice(card)
      });
    }
  });
  const unlisten: DesktopShellUnlisten[] = [];
  const pushUnlisten = await listen("push-event", (event) => {
    bridge.handlePushPayload(event.payload);
  });
  if (typeof pushUnlisten === "function") {
    unlisten.push(pushUnlisten);
  }
  const statusUnlisten = await listen("sse-status", (event) => {
    bridge.handleSseStatusPayload(event.payload);
  });
  if (typeof statusUnlisten === "function") {
    unlisten.push(statusUnlisten);
  }

  return {
    subscribed: true,
    async dispose() {
      for (const stop of unlisten.splice(0)) {
        stop();
      }
    }
  };
}

export function desktopCuuNoticeMessage(card: CuuCard) {
  return `Cuu：${card.title}`;
}

export function renderDesktopCuuNotice(card: CuuCard) {
  const chips = (card.chips ?? []).slice(0, 3).map(renderChip).join("");
  const actions = card.actions.slice(0, 3).map(renderAction).join("");
  return `<section class="wh-cuu-card" data-cuu-card-id="${escapeHtml(card.id)}" data-cuu-state="${escapeHtml(card.state)}" role="status">
    <div class="wh-cuu-card-head">
      <div class="wh-cuu-card-kicker"><span class="wh-cuu-card-paw" aria-hidden="true"></span><span>Cuu</span></div>
      <span class="wh-cuu-card-state">${escapeHtml(labelForState(card.state))}</span>
    </div>
    <strong class="wh-cuu-card-title">${escapeHtml(card.title)}</strong>
    <p class="wh-cuu-card-message">${escapeHtml(card.message)}</p>
    ${chips ? `<div class="wh-cuu-card-chips">${chips}</div>` : ""}
    ${actions ? `<div class="wh-cuu-card-actions">${actions}</div>` : ""}
  </section>`;
}

export function resolveDesktopCuuAction(
  href: string,
  input: { actionId?: string | undefined; requiresReason?: boolean | undefined } = {}
): DesktopCuuActionRequest | undefined {
  const path = new URL(href, "https://workhub.local").pathname;
  const approvalMatch = /^\/api\/approvals\/([^/]+)\/respond$/u.exec(path);
  if (approvalMatch?.[1]) {
    return {
      kind: "approval-response",
      approvalId: decodeURIComponent(approvalMatch[1]),
      decision: approvalDecisionFromAction(input.actionId, input.requiresReason === true),
      requiresReason: input.requiresReason === true
    };
  }

  const sessionMatch = /^\/api\/sessions\/([^/]+)\/next-question$/u.exec(path);
  if (sessionMatch?.[1]) {
    return {
      kind: "session-next-question",
      sessionId: decodeURIComponent(sessionMatch[1])
    };
  }

  return undefined;
}

export async function submitDesktopCuuAction(input: {
  client: Pick<WorkHubApiClient, "respondApproval" | "nextQuestion">;
  action: DesktopCuuActionRequest;
  reasonMd?: string | undefined;
}): Promise<DesktopCuuActionResult> {
  if (input.action.kind === "approval-response") {
    if (input.action.decision === "deny" && !input.reasonMd?.trim()) {
      throw new Error("打回需要先选择一个原因。");
    }
    await input.client.respondApproval(input.action.approvalId, {
      decision: input.action.decision,
      ...(input.reasonMd ? { reason_md: input.reasonMd } : {}),
      remember: "once"
    });
    return {
      message: input.action.decision === "allow" ? "Cuu 已收到：这步已批准。" : "Cuu 已带着原因打回，会继续改。"
    };
  }

  const question = await input.client.nextQuestion(input.action.sessionId);
  return {
    message: `下一题：${question.title}`
  };
}

function renderChip(chip: CuuCardChip) {
  const text = chip.description ? `${chip.label} · ${chip.description}` : chip.label;
  return `<span class="wh-cuu-chip" data-chip-id="${escapeHtml(chip.id)}">${escapeHtml(text)}</span>`;
}

function renderAction(action: CuuCardAction) {
  if (!action.href) {
    return `<span class="wh-cuu-action" data-tone="${escapeHtml(action.tone)}">${escapeHtml(action.label)}</span>`;
  }
  return `<a class="wh-cuu-action" href="${escapeHtml(action.href)}" data-cuu-action-id="${escapeHtml(action.id)}" data-tone="${escapeHtml(action.tone)}" data-method="${escapeHtml(action.method ?? "GET")}" data-requires-reason="${action.requires_reason ? "true" : "false"}">${escapeHtml(action.label)}</a>`;
}

function approvalDecisionFromAction(actionId: string | undefined, requiresReason: boolean): "allow" | "deny" {
  const normalized = actionId?.toLowerCase() ?? "";
  if (requiresReason || ["deny", "reject", "request_changes", "changes", "revise"].includes(normalized)) {
    return "deny";
  }
  return "allow";
}

function labelForState(state: CuuCard["state"]) {
  switch (state) {
    case "idle":
      return "待命";
    case "thinking":
      return "思考中";
    case "asking_approval":
      return "等你点选";
    case "carrying_document":
      return "拿来变更";
    case "searching_evidence":
      return "找到证据";
    case "syncing_files":
      return "同步中";
    case "worried":
      return "需要留意";
    case "revision_requested":
      return "继续修改";
    case "celebrating":
      return "完成了";
    case "offline":
      return "离线";
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
