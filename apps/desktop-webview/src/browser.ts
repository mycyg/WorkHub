import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import {
  classifyGoldPathHref,
  renderGoldPathAppShell,
  renderGoldPathBootDocument,
  renderGoldPathSurface,
  resolveGoldPathPageKey,
  type GoldPathAppShell
} from "@workhub/ui/gold-path";

import { bindDesktopShellCuuRuntime, desktopCuuNoticeCss } from "./desktop-cuu-runtime.js";

const root = document.getElementById("root");
type BrowserApiClient = ReturnType<typeof createApiClient>;
let noticeTimer: number | undefined;

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
}

function showNotice(shellRoot: HTMLElement, message: string, extraHtml?: string, timeoutMs = 4600) {
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
    }, timeoutMs);
  }
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

function bindGoldPathNavigation(shellRoot: HTMLElement, shell: GoldPathAppShell, client: BrowserApiClient) {
  let pendingReviewHref: string | undefined;

  const activateFromHash = () => {
    const hashRoute = window.location.hash.slice(1) || "/";
    const pageKey = resolveGoldPathPageKey(shell.routeMap, hashRoute);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
    }
  };

  shellRoot.addEventListener("click", async (event) => {
    const reasonButton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-review-reason]") : null;
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
    root.innerHTML = `<style>${shell.css}${desktopCuuNoticeCss}</style>${shell.html}`;
    bindGoldPathNavigation(root, shell, client);
    void bindDesktopShellCuuRuntime({
      notify(notice) {
        const timeoutMs = notice.card.priority === "urgent" || notice.card.state === "asking_approval" ? 12000 : 7200;
        showNotice(root, notice.message, notice.html, timeoutMs);
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
