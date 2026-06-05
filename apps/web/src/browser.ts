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
          "打回必须说明原因。P0.5 页面壳先展示原因选项，真实提交由审批服务后续接线。",
          '<div class="wh-app-action-row"><button type="button">证据不足</button><button type="button">口吻要改</button><button type="button">范围太大</button></div>'
        );
      } else {
        showNotice(shellRoot, "已记录采纳动作。真实 merge、通知和审计状态会由后端流程落地。");
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
    title: "正在打开 WorkHub",
    message: "连接 API daemon，读取 P0.5 Gold Path 页面 VM。"
  });

  try {
    const client = createApiClient({ baseUrl: "" });
    let surfaceVm;
    try {
      surfaceVm = await client.pages.goldPath();
    } catch (error) {
      if (!(error instanceof WorkHubApiError) || error.code !== "not_identified") {
        throw error;
      }
      await client.identify({ nickname: "P0.5 Reviewer" });
      surfaceVm = await client.pages.goldPath();
    }
    const rendered = renderGoldPathSurface(surfaceVm, "web");
    const shell = renderGoldPathAppShell(rendered, {
      appName: "WorkHub",
      surfaceLabel: "Web P0.5",
      apiBaseLabel: "/api/pages/gold-path"
    });
    root.innerHTML = `<style>${shell.css}</style>${shell.html}`;
    bindGoldPathNavigation(root, shell);
  } catch (error) {
    root.innerHTML = renderGoldPathBootDocument({
      title: "API daemon 还没连上",
      message: error instanceof Error ? error.message : "请先启动 WorkHub API daemon，再刷新这个页面。",
      tone: "error"
    });
  }
}

void boot();
