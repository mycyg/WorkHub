import { createApiClient, WorkHubApiError } from "@workhub/api-client/client";
import {
  classifyGoldPathHref,
  renderGoldPathAppShell,
  renderGoldPathBootDocument,
  renderGoldPathSurface,
  resolveGoldPathPageKey,
  type GoldPathAppShell
} from "@workhub/ui/gold-path";

const root = document.getElementById("root");

function clientToken() {
  return window.localStorage.getItem("workhub_client_token") ?? window.localStorage.getItem("yqgl_client_token") ?? undefined;
}

function showNotice(shellRoot: HTMLElement, message: string, extraHtml?: string) {
  const notice = shellRoot.querySelector<HTMLElement>("[data-wh-app-notice]");
  if (!notice) {
    return;
  }
  notice.textContent = message;
  if (extraHtml) {
    notice.insertAdjacentHTML("beforeend", extraHtml);
  }
  notice.hidden = false;
  window.setTimeout(() => {
    notice.hidden = true;
  }, 4600);
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

function bindGoldPathNavigation(shellRoot: HTMLElement, shell: GoldPathAppShell) {
  const activateFromHash = () => {
    const hashRoute = window.location.hash.slice(1) || "/";
    const pageKey = resolveGoldPathPageKey(shell.routeMap, hashRoute);
    if (pageKey) {
      setActivePage(shellRoot, shell, pageKey);
    }
  };

  shellRoot.addEventListener("click", (event) => {
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
      if (action.requiresReason) {
        showNotice(
          shellRoot,
          "桌宠端会要求先点选打回原因，再把理由交给 Agent。",
          '<div class="wh-app-action-row"><button type="button">证据不足</button><button type="button">范围太大</button><button type="button">交付格式要改</button></div>'
        );
      } else {
        showNotice(shellRoot, "桌宠端会把采纳动作交给 daemon，并等待 merge/通知/审计事件。");
      }
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
    root.innerHTML = `<style>${shell.css}</style>${shell.html}`;
    bindGoldPathNavigation(root, shell);
  } catch (error) {
    root.innerHTML = renderGoldPathBootDocument({
      title: "daemon 还没连上",
      message: error instanceof Error ? error.message : "请先启动 WorkHub API daemon，再刷新桌面 webview。",
      tone: "error"
    });
  }
}

void boot();
