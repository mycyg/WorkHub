import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import {
  createCuuController,
  type CuuCard,
  type CuuController,
  type CuuControllerDecision,
  type CuuControllerSnapshot
} from "@workhub/cuu";
import {
  classifyGoldPathHref,
  renderGoldPathAppShell,
  renderGoldPathBootDocument,
  renderGoldPathSurface,
  resolveGoldPathPageKey,
  type GoldPathAppShell
} from "@workhub/ui/gold-path";

import {
  bindDesktopShellCuuRuntime,
  createDesktopCuuDemoScript,
  createDesktopShellScriptedListener,
  desktopCuuNoticeMessage,
  desktopCuuNoticeCss,
  renderDesktopCuuNotice,
  resolveDesktopCuuAction,
  resolveDesktopShellListen,
  submitDesktopCuuAction,
  type DesktopCuuActionRequest
} from "./desktop-cuu-runtime.js";
import {
  bindCuuPreferencePanel,
  desktopCuuPreferenceCss,
  loadCuuPreferences
} from "./cuu-preferences.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
let noticeTimer: number | undefined;

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
}

function showNotice(
  shellRoot: HTMLElement,
  message: string,
  extraHtml?: string,
  timeoutMs = 4600,
  onTimeout?: () => void
) {
  const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
  if (!notice) {
    return;
  }
  if (noticeTimer !== undefined) {
    window.clearTimeout(noticeTimer);
    noticeTimer = undefined;
  }
  notice.textContent = message;
  if (extraHtml) {
    notice.insertAdjacentHTML("beforeend", extraHtml);
  }
  notice.hidden = false;
  if (timeoutMs > 0) {
    noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
      noticeTimer = undefined;
      onTimeout?.();
    }, timeoutMs);
  }
}

function ensureCuuQueueBadge(shellRoot: HTMLElement) {
  const existing = shellRoot.querySelector<HTMLButtonElement>("[data-cuu-queue-badge]");
  if (existing) {
    return existing;
  }
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "wh-cuu-queue-badge";
  badge.dataset.cuuQueueBadge = "true";
  badge.hidden = true;
  shellRoot.appendChild(badge);
  return badge;
}

function updateCuuQueueBadge(shellRoot: HTMLElement, snapshot: CuuControllerSnapshot) {
  const badge = ensureCuuQueueBadge(shellRoot);
  const total = snapshot.queue.length + snapshot.badge_count;
  if (total <= 0) {
    badge.hidden = true;
    badge.innerHTML = "";
    return;
  }
  const label = snapshot.queue.length > 0
    ? `排队 ${snapshot.queue.length} 条，收起 ${snapshot.badge_count} 条`
    : `收起 ${snapshot.badge_count} 条`;
  badge.innerHTML = `<span class="wh-cuu-queue-count">${total}</span><span class="wh-cuu-queue-text">${escapeHtml(label)}</span>`;
  badge.title = `Cuu ${label}`;
  badge.hidden = false;
}

function bindCuuQueueBadge(shellRoot: HTMLElement, controller: CuuController) {
  const badge = ensureCuuQueueBadge(shellRoot);
  badge.addEventListener("click", () => {
    const activeCard = controller.snapshot().active_card;
    if (activeCard) {
      showCuuCard(shellRoot, controller, activeCard);
      updateCuuQueueBadge(shellRoot, controller.snapshot());
      return;
    }
    const next = controller.dismiss();
    updateCuuQueueBadge(shellRoot, next.snapshot);
    if (next.card && (next.outcome === "show" || next.outcome === "replace")) {
      showCuuCard(shellRoot, controller, next.card, next);
    }
  });
}

function showCuuCard(
  shellRoot: HTMLElement,
  controller: CuuController,
  card: CuuCard,
  decision?: CuuControllerDecision
) {
  showNotice(
    shellRoot,
    desktopCuuNoticeMessage(card),
    renderDesktopCuuNotice(card),
    decision?.presentation.timeout_ms ?? cuuNoticeTimeoutMs(card),
    () => {
      const next = controller.dismiss(card.id);
      updateCuuQueueBadge(shellRoot, next.snapshot);
      if (next.card && (next.outcome === "show" || next.outcome === "replace")) {
        showCuuCard(shellRoot, controller, next.card, next);
      }
    }
  );
}

function cuuNoticeTimeoutMs(card: CuuCard) {
  return card.priority === "urgent" || card.state === "asking_approval" ? 12000 : 7200;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function setActivePage(shellRoot: HTMLElement, shell: GoldPathAppShell, pageKey: string) {
  for (const panel of shellRoot.querySelectorAll<HTMLElement>("[data-wh-panel]")) {
    panel.hidden = panel.dataset.whPanel !== pageKey;
  }
  for (const link of shellRoot.querySelectorAll<HTMLAnchorElement>("[data-wh-page-key]")) {
    link.setAttribute("aria-current", link.dataset.whPageKey === pageKey ? "page" : "false");
  }
  const route = Object.entries(shell.routeMap).find(([, key]) => key === pageKey)?.[0];
  if (route && window.location.hash !== `#${route}`) {
    window.history.replaceState(null, "", `#${route}`);
  }
}

function proposalActionFromHref(href: string) {
  const path = new URL(href, window.location.origin).pathname;
  const match = /^\/api\/proposals\/([^/]+)\/(review|merge)$/u.exec(path);
  if (!match?.[1] || !match[2]) {
    return undefined;
  }
  return { proposalId: decodeURIComponent(match[1]), action: match[2] as "review" | "merge" };
}

function reviewReasonButtons() {
  return '<div class="wh-app-action-row"><button type="button" data-review-reason="证据不足">证据不足</button><button type="button" data-review-reason="范围太大">范围太大</button><button type="button" data-review-reason="交付格式要改">交付格式要改</button></div>';
}

function actionMessage(error: unknown) {
  return error instanceof Error ? error.message : "动作提交失败，请稍后再试。";
}

function cuuDemoMode() {
  const value = new URLSearchParams(window.location.search).get("cuuDemo");
  if (value === "1" || value === "true") {
    return "on";
  }
  if (value === "offline") {
    return "offline";
  }
  return "off";
}

function handleCuuActionResult(
  shellRoot: HTMLElement,
  controller: CuuController,
  result: { message: string; card?: CuuCard }
) {
  if (!result.card) {
    showNotice(shellRoot, result.message);
    return;
  }
  const decision = controller.enqueue(result.card);
  updateCuuQueueBadge(shellRoot, decision.snapshot);
  if (decision.card && (decision.outcome === "show" || decision.outcome === "replace")) {
    showCuuCard(shellRoot, controller, decision.card, decision);
    return;
  }
  showNotice(shellRoot, result.message);
}

function bindGoldPathNavigation(
  shellRoot: HTMLElement,
  shell: GoldPathAppShell,
  client: BrowserApiClient,
  cuuController: CuuController
) {
  let pendingReviewHref: string | undefined;
  let pendingCuuAction: DesktopCuuActionRequest | undefined;

  const activateFromHash = () => {
    const hashRoute = window.location.hash.slice(1) || "/";
    const pageKey = resolveGoldPathPageKey(shell.routeMap, hashRoute);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
    }
  };

  shellRoot.addEventListener("click", async (event) => {
    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-reason]") : null;
    if (reasonButton && pendingCuuAction) {
      try {
        const result = await submitDesktopCuuAction({
          client,
          action: pendingCuuAction,
          reasonMd: reasonButton.dataset.reviewReason ?? "需要调整"
        });
        pendingCuuAction = undefined;
        handleCuuActionResult(shellRoot, cuuController, result);
      } catch (error) {
        showNotice(shellRoot, actionMessage(error));
      }
      return;
    }
    if (reasonButton && pendingReviewHref) {
      const proposalAction = proposalActionFromHref(pendingReviewHref);
      if (proposalAction?.action === "review") {
        try {
          const result = await client.reviewProposal(proposalAction.proposalId, {
            decision: "request_changes",
            reason_md: reasonButton.dataset.reviewReason ?? "需要调整",
            remember: "once"
          });
          showNotice(shellRoot, result.attention.summary_text);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error));
        }
      }
      return;
    }

    const option = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-option-id]") : null;
    if (option) {
      showNotice(shellRoot, `已选择「${option.querySelector("strong")?.textContent ?? option.dataset.optionId}」，Cuu 会继续推进。`);
      return;
    }

    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!anchor) {
      return;
    }
    const href = anchor.getAttribute("href") ?? "";
    const cuuAction = resolveDesktopCuuAction(href, {
      actionId: anchor.dataset.cuuActionId,
      requiresReason: anchor.dataset.requiresReason === "true"
    });
    if (cuuAction) {
      event.preventDefault();
      if (cuuAction.kind === "approval-response" && cuuAction.requiresReason && cuuAction.decision === "deny") {
        pendingCuuAction = cuuAction;
        showNotice(shellRoot, "先点一个打回原因，Cuu 会带着它继续改。", reviewReasonButtons());
        return;
      }
      try {
        const result = await submitDesktopCuuAction({ client, action: cuuAction });
        handleCuuActionResult(shellRoot, cuuController, result);
      } catch (error) {
        showNotice(shellRoot, actionMessage(error));
      }
      return;
    }
    const action = classifyGoldPathHref(shell.routeMap, href, {
      requiresReason: anchor.dataset.requiresReason === "true",
      method: anchor.dataset.method
    });
    if (action.kind === "navigate") {
      event.preventDefault();
      setActivePage(shellRoot, shell, action.pageKey);
      return;
    }
    if (action.kind === "api-action") {
      event.preventDefault();
      const proposalAction = proposalActionFromHref(href);
      if (proposalAction?.action === "review") {
        if (action.requiresReason) {
          pendingReviewHref = href;
          showNotice(shellRoot, "先点一个打回原因，Cuu 会把它放进下一轮修改。", reviewReasonButtons());
          return;
        }
        try {
          const review = await client.reviewProposal(proposalAction.proposalId, { decision: "approve", remember: "once" });
          const merge = await client.mergeProposal(proposalAction.proposalId);
          showNotice(shellRoot, `${review.attention.summary_text} ${merge.attention.summary_text}`);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error));
        }
        return;
      }
      if (proposalAction?.action === "merge") {
        try {
          const merge = await client.mergeProposal(proposalAction.proposalId);
          showNotice(shellRoot, merge.attention.summary_text);
        } catch (error) {
          showNotice(shellRoot, actionMessage(error));
        }
        return;
      }
      showNotice(shellRoot, "这个动作还在等待对应服务接线。");
    }
  });

  window.addEventListener("hashchange", activateFromHash);
  activateFromHash();
}

async function boot() {
  if (!root) {
    return;
  }
  root.innerHTML = renderGoldPathBootDocument({
    title: "正在打开 WorkHub Desktop",
    message: "连接 daemon，读取同一份 P0.5 Gold Path 页面 VM。"
  });

  try {
    const client = createApiClient({
      baseUrl: "",
      getClientToken: clientToken
    });
    let surfaceVm;
    try {
      surfaceVm = await client.pages.goldPath();
    } catch (error) {
      if (!(error instanceof WorkHubApiError) || error.code !== "not_identified") {
        throw error;
      }
      await client.identify({ nickname: "Cuu Desktop Preview" });
      surfaceVm = await client.pages.goldPath();
    }
    const rendered = renderGoldPathSurface(surfaceVm, "desktop");
    const shell = renderGoldPathAppShell(rendered, {
      appName: "WorkHub Desktop",
      surfaceLabel: "Tauri Webview P0.5",
      apiBaseLabel: "device-token aware client"
    });
    root.innerHTML = `<style>${shell.css}${desktopCuuNoticeCss}${desktopCuuPreferenceCss}</style>${shell.html}`;
    const cuuController = createCuuController({ preferences: loadCuuPreferences() });
    bindGoldPathNavigation(root, shell, client, cuuController);
    const cuuDecisions = new Map<string, CuuControllerDecision>();
    bindCuuQueueBadge(root, cuuController);
    bindCuuPreferencePanel(root, cuuController, {
      onChange(snapshot) {
        updateCuuQueueBadge(root, snapshot);
      }
    });
    const realShellListen = resolveDesktopShellListen();
    const demoMode = cuuDemoMode();
    const demoListener =
      !realShellListen && demoMode !== "off"
        ? createDesktopShellScriptedListener(createDesktopCuuDemoScript(surfaceVm, {
            includeOfflineStatus: demoMode === "offline"
          }))
        : undefined;
    void bindDesktopShellCuuRuntime({
      listen: realShellListen ?? demoListener?.listen,
      controller: cuuController,
      onDecision(decision) {
        if (decision.card) {
          cuuDecisions.set(decision.card.id, decision);
        }
        updateCuuQueueBadge(root, decision.snapshot);
      },
      notify(notice) {
        showCuuCard(root, cuuController, notice.card, cuuDecisions.get(notice.card.id));
      }
    }).then((runtime) => {
      if (runtime.subscribed && demoListener) {
        showNotice(root, "Cuu 事件预览已开启。", undefined, 2400);
        demoListener.start();
      }
    });
  } catch (error) {
    root.innerHTML = renderGoldPathBootDocument({
      title: "daemon 还没连上",
      message: error instanceof Error ? error.message : "请先启动 WorkHub API daemon，再刷新桌面 webview。",
      tone: "error"
    });
  }
}

void boot();
