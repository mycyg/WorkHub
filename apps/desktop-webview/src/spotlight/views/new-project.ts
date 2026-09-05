// WorkHub 桌面 · Spotlight「新建项目」能力内联视图。
//
// 严重 #8（R24 S3 走查）：此前这个入口是假的——registry.ts 把 new_project 映到
// createWorkbenchOpenView(..., {bare:true})，那个 view 只 invoke("open_workbench", {}) 打开一个
// *空* 工作台窗口，用户得自己在那边再找「新建项目」瓦片走真正的创建流程；本视图改成盒子内联的真表单：
// 填名字 → POST bootstrapProject（真建库） → 建好后 invoke("open_workbench", {projectId}) 直接
// 打开这个新项目的工作台窗口 → resetShell() 把聚焦盒收回 idle 条（不留 720x671 展开态压在工作台上，
// 同 M-04 的 resetShell 修复）。
//
// 复用 workbench-open.ts 的两处既有机制：resolveDesktopTauriInvoke（无 Tauri 桥的浏览器预览诚实降级）
// + stashPendingWorkbenchDeepLink（冷启动深链竞态兜底，见该文件顶部注释）。

import { WorkHubApiError } from "@workhub/api-client";
import { escapeHtml } from "@workhub/web-runtime";

import { resolveDesktopTauriInvoke } from "../../desktop-window-controls.js";
import { stashPendingWorkbenchDeepLink } from "../../workbench/pending-deep-link.js";
import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

type NewProjectState = {
  name: string;
  submitting: boolean;
  error?: string | undefined;
};

// L-03（R24 S3 走查）：占位符此前含一个真实公司名——公开仓库里不该留客户真名，换成中性示例。
// 与 workbench/rail.ts 里工作台自己的新建项目弹窗（同一份产品语义的另一处入口）保持同一个示例名。
const PROJECT_NAME_PLACEHOLDER_ZH = "项目名，如：产品路线图";
const PROJECT_NAME_PLACEHOLDER_EN = "Project name, e.g. Product roadmap";

export function newProjectHtml(zh: boolean, state: NewProjectState): string {
  const disabled = state.submitting ? " disabled" : "";
  const submitDisabled = state.submitting || !state.name.trim() ? " disabled" : "";
  return `<div class="wh-spot-intake">
    <h3 class="wh-spot-intake-title">${zh ? "新建项目" : "New project"}</h3>
    <p class="wh-spot-intake-body">${zh ? "自动配好群聊、网盘和 Cuu，建好即可用。" : "Sets up a team chat, drive, and Cuu — ready as soon as it's created."}</p>
    <input
      type="text"
      class="wh-spot-freetext wh-spot-freetext--line"
      data-new-project-name
      maxlength="128"
      placeholder="${escapeHtml(zh ? PROJECT_NAME_PLACEHOLDER_ZH : PROJECT_NAME_PLACEHOLDER_EN)}"
      value="${escapeHtml(state.name)}"
      ${disabled}
    />
    ${state.error ? `<p class="wh-spot-row-sub" style="color:var(--ds-danger);white-space:normal">${escapeHtml(state.error)}</p>` : ""}
    <div class="wh-spot-intake-actions">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-new-project-submit${submitDisabled}>${
        state.submitting ? (zh ? "创建中…" : "Creating…") : zh ? "创建项目" : "Create project"
      }</button>
    </div>
  </div>`;
}

export function createNewProjectView(): SpotlightCapabilityView {
  return {
    id: "new_project",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { body, client } = ctx;
      let disposed = false;
      let state: NewProjectState = { name: "", submitting: false };

      const render = () => {
        if (disposed) return;
        body.innerHTML = newProjectHtml(zh, state);
        ctx.requestResize();
      };

      const focusInput = () => {
        body.querySelector<HTMLInputElement>("[data-new-project-name]")?.focus();
      };

      ctx.setSubtitle(zh ? "新建项目" : "New project");
      render();
      focusInput();

      const syncSubmitEnabled = () => {
        const btn = body.querySelector<HTMLButtonElement>("[data-new-project-submit]");
        if (btn) {
          btn.disabled = state.submitting || !state.name.trim();
        }
      };

      const submit = async () => {
        if (state.submitting) return;
        const trimmed = state.name.trim();
        if (!trimmed) {
          state.error = zh ? "先给项目起个名字" : "Give the project a name first";
          render();
          focusInput();
          return;
        }
        state.submitting = true;
        state.error = undefined;
        render();
        try {
          const created = await client.bootstrapProject({ name: trimmed });
          if (disposed) return;
          ctx.onActionSettled?.();
          // 建好即打开它的工作台窗口——用户点「新建项目」要的是能立刻开始干活，不是回到一个空网格。
          const invoke = resolveDesktopTauriInvoke();
          if (invoke) {
            stashPendingWorkbenchDeepLink({ projectId: created.project.id });
            try {
              await Promise.resolve(invoke("open_workbench", { projectId: created.project.id }));
            } catch {
              // 项目已经建好了；只是没能打开工作台窗口——不倒回「创建失败」的状态，用户可以自己去
              // 「打开工作台」能力找到这个新项目。
            }
          }
          if (disposed) return;
          ctx.toast(
            zh ? `项目已创建：${created.project.name}` : `Project created: ${created.project.name}`,
            "ok"
          );
          // S-05 修复的另一半（M-04 根因）：resetShell 现在真正收回 idle 条，不再展开成压住工作台的
          // 全高网格——见 controller.ts 里 resetShell 改接 resetLauncher() 的改动。
          ctx.resetShell?.();
        } catch (error) {
          if (disposed) return;
          state.submitting = false;
          state.error =
            error instanceof WorkHubApiError && error.message
              ? error.message
              : zh
                ? "创建失败，请重试"
                : "Couldn't create the project — retry";
          render();
          focusInput();
        }
      };

      body.addEventListener(
        "click",
        (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          if (target.closest("[data-new-project-submit]")) {
            void submit();
          }
        },
        { signal: ctx.signal }
      );

      body.addEventListener(
        "input",
        (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.matches("[data-new-project-name]")) {
            state.name = (target as HTMLInputElement).value;
            // 只同步按钮可用态，不整体重渲（保住输入焦点/光标位置）。
            syncSubmitEnabled();
          }
        },
        { signal: ctx.signal }
      );

      return () => {
        disposed = true;
      };
    }
  };
}
