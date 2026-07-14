// WorkHub 桌面 · 工作台「项目设置」标签——imperative 挂载/事件绑定层（照 drive/view.ts 的分工：
// 纯渲染在 render.ts，这里只负责拉数据、绑 DOM 事件、维护标签内的瞬态状态）。
//
// 写路径纪律（同 spotlight/views/settings.ts 的 AI 分区）：开关类（观察者/安静时段开关/Granular/
// 星期 chips）即改即 PATCH + 乐观更新 + 失败回滚 + 温和的行内错误（不弹阻断式对话框）；数值/时间
// 输入（静默窗口秒数、安静时段起止）不能在每次击键都发 PATCH——静默窗口配显式「保存」按钮，
// 时间输入在 change（提交值）时发。Granular 每次全量重发四个 key 的显式布尔（PATCH 的
// granular_settings 是整列替换写，见 packages/db/src/repositories/ai-settings.ts 的
// governanceUpdateValues，只发一个 key 会把其余键的既有覆盖清空）。

import { WorkHubApiError } from "@workhub/api-client";
import type {
  AiGranularSettings,
  AiQuietHours,
  GithubBindingStatusVM,
  GithubTestConnectionRequest,
  GithubTestConnectionResult,
  PatchProjectAiGovernanceRequest,
  ProjectAiGovernanceVM
} from "@workhub/contracts";

import {
  deleteGithubBinding,
  fetchGithubBindingStatus,
  fetchProjectAiGovernance,
  patchProjectAiGovernance,
  putGithubBinding,
  testGithubBindingConnection,
  type ProjectSettingsApiClient
} from "./api.js";
import {
  PROJECT_GRANULAR_KEYS,
  hhmmToMinute,
  projectGranularEffective,
  renderGithubBindingSectionHtml,
  renderProjectSettingsErrorHtml,
  renderProjectSettingsHtml,
  renderProjectSettingsLoadingHtml,
  renderProjectSettingsOwnerOnlyHtml
} from "./render.js";

// R14 批 GH 解绑武装态自动复原时长——同 drive/side-panel.ts 版本回滚两段式确认的既有先例（5 秒）。
const GITHUB_UNBIND_ARM_TIMEOUT_MS = 5000;

type Locale = "zh-CN" | "en-US";

export type ProjectSettingsViewHandle = {
  dispose: () => void;
};

function localTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone.length > 0) {
      return zone;
    }
  } catch {
    // fall through to the fixed default below
  }
  return "Asia/Shanghai";
}

// 开启安静时段时的初始值：本地时区、22:00-08:00、每天——用户开了再细调，比开成一个空壳合理。
export function defaultEnabledQuietHours(timezone: string): Extract<AiQuietHours, { enabled: true }> {
  return {
    enabled: true,
    timezone,
    start_minute: 22 * 60,
    end_minute: 8 * 60,
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  };
}

export function mountProjectSettingsView(
  container: HTMLElement,
  input: {
    client: ProjectSettingsApiClient;
    locale: Locale;
    projectId: string;
    projectName: string;
    // vm.viewer.is_project_owner——非负责人理论上到不了这个视图（rail 只对负责人渲染入口），但所有权
    // 可能在会话中途变更，这里仍按只读渲染兜底（服务端 404 时另有 owner-only 诚实态）。
    editable: boolean;
  }
): ProjectSettingsViewHandle {
  const zh = input.locale === "zh-CN";
  let disposed = false;
  let governance: ProjectAiGovernanceVM | undefined;
  let loadState: "loading" | "ready" | "error" | "owner_only" = "loading";
  let savingSilenceWindow = false;
  let errorText: string | undefined;
  let loadGeneration = 0;

  // R14 批 GH（07-gh-design.md §3 UI 节）：GitHub 绑定卡是独立分区、独立状态机——GET 权限口径是
  // 项目可见者（比上面 governance 的"读也锁负责人"松），所以它不能挂在 loadState 上，非负责人打开
  // 这个标签时（governance 走 owner_only 分支）这个分区仍要独立加载并展示只读状态。
  let githubStatus: GithubBindingStatusVM | undefined;
  let githubLoadState: "loading" | "ready" | "error" = "loading";
  let githubMode: "status" | "form" = "status";
  let githubFormRepo = "";
  let githubFormPat = "";
  let githubSaving = false;
  let githubTestPending = false;
  let githubTestResult: GithubTestConnectionResult | undefined;
  let githubUnbindArmed = false;
  let githubErrorText: string | undefined;
  let githubLoadGeneration = 0;
  let githubUnbindArmTimer: ReturnType<typeof setTimeout> | undefined;

  function clearGithubUnbindTimer(): void {
    if (githubUnbindArmTimer !== undefined) {
      clearTimeout(githubUnbindArmTimer);
      githubUnbindArmTimer = undefined;
    }
  }

  function governanceSectionHtml(): string {
    if (loadState === "owner_only") {
      return renderProjectSettingsOwnerOnlyHtml(input.locale);
    }
    if (loadState === "error") {
      return renderProjectSettingsErrorHtml(input.locale);
    }
    if (loadState === "loading" || !governance) {
      return renderProjectSettingsLoadingHtml(input.locale);
    }
    return renderProjectSettingsHtml({
      locale: input.locale,
      projectName: input.projectName,
      governance,
      editable: input.editable,
      savingSilenceWindow,
      errorText
    });
  }

  function render(): void {
    if (disposed) {
      return;
    }
    container.innerHTML = `${governanceSectionHtml()}${renderGithubBindingSectionHtml({
      locale: input.locale,
      editable: input.editable,
      loadState: githubLoadState,
      status: githubStatus,
      mode: githubMode,
      formRepo: githubFormRepo,
      formPat: githubFormPat,
      saving: githubSaving,
      testPending: githubTestPending,
      testResult: githubTestResult,
      unbindArmed: githubUnbindArmed,
      errorText: githubErrorText
    })}`;
  }

  function load(): void {
    const generation = ++loadGeneration;
    loadState = "loading";
    render();
    void fetchProjectAiGovernance(input.client, input.projectId)
      .then((vm) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        governance = vm;
        loadState = "ready";
        render();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== loadGeneration) {
          return;
        }
        loadState = error instanceof WorkHubApiError && error.status === 404 ? "owner_only" : "error";
        render();
      });
  }

  function githubErrorMessage(error: unknown): string {
    if (error instanceof WorkHubApiError) {
      if (error.status === 503) {
        return zh
          ? "GitHub 集成未配置加密密钥，请联系管理员查看部署文档完成配置。"
          : "GitHub integration isn't configured with an encryption key yet — ask an administrator to check the deployment docs.";
      }
      if (error.status === 403) {
        return zh ? "只有项目负责人能管理 GitHub 绑定。" : "Only the project owner can manage the GitHub binding.";
      }
      if (error.message) {
        return error.message;
      }
    }
    return zh ? "没保存成功，再试一次。" : "Couldn't save — try again.";
  }

  function loadGithub(): void {
    const generation = ++githubLoadGeneration;
    githubLoadState = "loading";
    render();
    void fetchGithubBindingStatus(input.client, input.projectId)
      .then((status) => {
        if (disposed || generation !== githubLoadGeneration) {
          return;
        }
        githubStatus = status;
        githubLoadState = "ready";
        githubMode = "status";
        render();
      })
      .catch(() => {
        if (disposed || generation !== githubLoadGeneration) {
          return;
        }
        githubLoadState = "error";
        render();
      });
  }

  function captureGithubFormInputs(): void {
    const repoField = container.querySelector<HTMLInputElement>("[data-wb-gh-repo-input]");
    const patField = container.querySelector<HTMLInputElement>("[data-wb-gh-pat-input]");
    if (repoField) {
      githubFormRepo = repoField.value.trim();
    }
    if (patField) {
      githubFormPat = patField.value;
    }
  }

  function runGithubTest(payload: GithubTestConnectionRequest): void {
    githubTestPending = true;
    githubErrorText = undefined;
    githubTestResult = undefined;
    render();
    testGithubBindingConnection(input.client, input.projectId, payload)
      .then((result) => {
        if (disposed) {
          return;
        }
        githubTestPending = false;
        githubTestResult = result;
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        githubTestPending = false;
        githubErrorText = githubErrorMessage(error);
        render();
      });
  }

  function submitGithubBinding(): void {
    if (!githubFormRepo || !githubFormPat) {
      githubErrorText = zh ? "仓库和 PAT 都要填。" : "Fill in both the repository and the token.";
      render();
      return;
    }
    githubSaving = true;
    githubErrorText = undefined;
    render();
    putGithubBinding(input.client, input.projectId, {
      repo_full_name: githubFormRepo,
      personal_access_token: githubFormPat
    })
      .then((status) => {
        if (disposed) {
          return;
        }
        githubStatus = status;
        githubSaving = false;
        githubMode = "status";
        // PAT 提交后清空、永不回显（§6 安全红线）——响应 VM 结构性无 token 字段，本地草稿也一并丢弃。
        githubFormRepo = "";
        githubFormPat = "";
        githubTestResult = undefined;
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        githubSaving = false;
        githubErrorText = githubErrorMessage(error);
        render();
      });
  }

  function executeGithubUnbind(): void {
    githubSaving = true;
    githubUnbindArmed = false;
    githubErrorText = undefined;
    render();
    deleteGithubBinding(input.client, input.projectId)
      .then(() => {
        if (disposed) {
          return;
        }
        githubStatus = { project_id: input.projectId, bound: false };
        githubSaving = false;
        githubMode = "status";
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        githubSaving = false;
        githubErrorText = githubErrorMessage(error);
        render();
      });
  }

  // 单字段乐观更新 + PATCH + 失败回滚（同 spotlight settings 的 patchAiProfile 取舍）。
  function patchGovernance(patch: PatchProjectAiGovernanceRequest, previous: ProjectAiGovernanceVM): void {
    errorText = undefined;
    render();
    patchProjectAiGovernance(input.client, input.projectId, patch)
      .then((next) => {
        if (disposed) {
          return;
        }
        governance = next;
        savingSilenceWindow = false;
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        governance = previous;
        savingSilenceWindow = false;
        errorText =
          error instanceof WorkHubApiError && error.status === 404
            ? zh
              ? "只有项目负责人能改这里。"
              : "Only the project owner can change this."
            : zh
              ? "没保存成功，再试一次。"
              : "Couldn't save — try again.";
        render();
      });
  }

  function currentQuietEnabled(): Extract<AiQuietHours, { enabled: true }> | undefined {
    return governance?.quiet_hours.enabled ? governance.quiet_hours : undefined;
  }

  function showInlineError(message: string): void {
    errorText = message;
    render();
  }

  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement) || !governance || !input.editable) {
      if (event.target instanceof HTMLElement && event.target.closest("[data-wb-pset-retry]")) {
        load();
      }
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-pset-retry]")) {
      load();
      return;
    }
    if (target.closest("[data-wb-pset-observer]")) {
      const previous = governance;
      const next = !governance.observer_enabled;
      governance = { ...governance, observer_enabled: next };
      patchGovernance({ observer_enabled: next }, previous);
      return;
    }
    if (target.closest("[data-wb-pset-quiet-toggle]")) {
      const previous = governance;
      const nextQuiet: AiQuietHours = governance.quiet_hours.enabled
        ? { enabled: false }
        : defaultEnabledQuietHours(localTimezone());
      governance = { ...governance, quiet_hours: nextQuiet };
      patchGovernance({ quiet_hours: nextQuiet }, previous);
      return;
    }
    const weekdayBtn = target.closest<HTMLElement>("[data-wb-pset-quiet-weekday]");
    if (weekdayBtn?.dataset.wbPsetQuietWeekday !== undefined) {
      const quiet = currentQuietEnabled();
      if (!quiet) {
        return;
      }
      const day = Number(weekdayBtn.dataset.wbPsetQuietWeekday);
      const has = quiet.weekdays.includes(day);
      if (has && quiet.weekdays.length === 1) {
        // 契约要求 weekdays 至少一天（aiQuietHoursSchema min(1)）——别发一个必被 422 拒掉的 patch。
        showInlineError(zh ? "至少保留一天，或直接关掉安静时段。" : "Keep at least one day, or turn quiet hours off.");
        return;
      }
      const nextWeekdays = has ? quiet.weekdays.filter((value) => value !== day) : [...quiet.weekdays, day].sort((a, b) => a - b);
      const previous = governance;
      const nextQuiet: AiQuietHours = { ...quiet, weekdays: nextWeekdays };
      governance = { ...governance, quiet_hours: nextQuiet };
      patchGovernance({ quiet_hours: nextQuiet }, previous);
      return;
    }
    if (target.closest("[data-wb-pset-silence-save]")) {
      if (savingSilenceWindow) {
        return;
      }
      const field = container.querySelector<HTMLInputElement>("[data-wb-pset-silence-input]");
      const value = Number(field?.value ?? "");
      if (!Number.isInteger(value) || value < 0 || value > 86400) {
        showInlineError(zh ? "静默窗口要在 0 到 86400 秒之间。" : "The silence window must be 0-86400 seconds.");
        return;
      }
      if (value === governance.silence_window_seconds) {
        return;
      }
      const previous = governance;
      savingSilenceWindow = true;
      governance = { ...governance, silence_window_seconds: value };
      patchGovernance({ silence_window_seconds: value }, previous);
      return;
    }
    const granularBtn = target.closest<HTMLElement>("[data-wb-pset-granular]");
    if (granularBtn?.dataset.wbPsetGranular) {
      const key = granularBtn.dataset.wbPsetGranular as keyof AiGranularSettings;
      const previous = governance;
      const nextGranular: AiGranularSettings = {};
      for (const k of PROJECT_GRANULAR_KEYS) {
        nextGranular[k] = k === key
          ? !projectGranularEffective(previous.granular_settings, k)
          : projectGranularEffective(previous.granular_settings, k);
      }
      governance = { ...governance, granular_settings: nextGranular };
      patchGovernance({ granular_settings: nextGranular }, previous);
    }
  });

  // 时间输入的提交事件（change = 用户敲定值/离开控件，不是每次击键）——起止相等会被契约 422
  // （start 与 end 必须不同），在客户端先拦下来并回滚显示。
  container.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement) || !governance || !input.editable) {
      return;
    }
    const target = event.target;
    const isStart = target.matches("[data-wb-pset-quiet-start]");
    const isEnd = target.matches("[data-wb-pset-quiet-end]");
    if (!isStart && !isEnd) {
      return;
    }
    const quiet = currentQuietEnabled();
    if (!quiet) {
      return;
    }
    const minute = hhmmToMinute(target.value);
    if (minute === undefined) {
      showInlineError(zh ? "时间格式不对，用 HH:MM。" : "Bad time format — use HH:MM.");
      return;
    }
    const nextStart = isStart ? minute : quiet.start_minute;
    const nextEnd = isEnd ? minute : quiet.end_minute;
    if (nextStart === nextEnd) {
      showInlineError(zh ? "开始和结束时间不能相同。" : "Start and end times must differ.");
      return;
    }
    if (nextStart === quiet.start_minute && nextEnd === quiet.end_minute) {
      return;
    }
    const previous = governance;
    const nextQuiet: AiQuietHours = { ...quiet, start_minute: nextStart, end_minute: nextEnd };
    governance = { ...governance, quiet_hours: nextQuiet };
    patchGovernance({ quiet_hours: nextQuiet }, previous);
  });

  // R14 批 GH：独立的点击处理器，不挂在上面 governance 的早退守卫上——GH 分区的加载/只读态要在
  // governance 是 owner_only/loading 时也能工作（两者权限口径不同，见顶部注释）。多个 addEventListener
  // 互不干扰，这里的 return 只退出本回调，不影响上面那个监听器。
  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-gh-retry]")) {
      loadGithub();
      return;
    }
    if (!input.editable || !githubStatus) {
      // 只读查看者：分区没有渲任何写钩子，除了上面的重试没有别的可点。
      return;
    }
    if (target.closest("[data-wb-gh-bind-cta]") || target.closest("[data-wb-gh-edit-cta]")) {
      githubMode = "form";
      githubFormRepo = githubStatus.repo_full_name ?? "";
      githubFormPat = "";
      githubTestResult = undefined;
      githubErrorText = undefined;
      render();
      return;
    }
    if (target.closest("[data-wb-gh-cancel]")) {
      githubMode = "status";
      githubFormRepo = "";
      githubFormPat = "";
      githubTestResult = undefined;
      githubErrorText = undefined;
      render();
      return;
    }
    if (target.closest("[data-wb-gh-test]")) {
      if (githubTestPending || githubSaving) {
        return;
      }
      captureGithubFormInputs();
      runGithubTest({
        ...(githubFormRepo ? { repo_full_name: githubFormRepo } : {}),
        ...(githubFormPat ? { personal_access_token: githubFormPat } : {})
      });
      return;
    }
    if (target.closest("[data-wb-gh-retest]")) {
      if (githubTestPending || githubSaving) {
        return;
      }
      runGithubTest({});
      return;
    }
    if (target.closest("[data-wb-gh-submit]")) {
      if (githubSaving || githubTestPending) {
        return;
      }
      captureGithubFormInputs();
      submitGithubBinding();
      return;
    }
    if (target.closest("[data-wb-gh-unbind]")) {
      if (githubSaving) {
        return;
      }
      if (!githubUnbindArmed) {
        githubUnbindArmed = true;
        clearGithubUnbindTimer();
        githubUnbindArmTimer = setTimeout(() => {
          githubUnbindArmTimer = undefined;
          if (disposed) {
            return;
          }
          githubUnbindArmed = false;
          render();
        }, GITHUB_UNBIND_ARM_TIMEOUT_MS);
        render();
        return;
      }
      clearGithubUnbindTimer();
      executeGithubUnbind();
    }
  });

  load();
  loadGithub();

  return {
    dispose: () => {
      disposed = true;
      clearGithubUnbindTimer();
    }
  };
}
