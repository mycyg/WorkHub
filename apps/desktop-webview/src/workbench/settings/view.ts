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
import type { AiGranularSettings, AiQuietHours, PatchProjectAiGovernanceRequest, ProjectAiGovernanceVM } from "@workhub/contracts";

import { fetchProjectAiGovernance, patchProjectAiGovernance, type ProjectSettingsApiClient } from "./api.js";
import {
  PROJECT_GRANULAR_KEYS,
  hhmmToMinute,
  projectGranularEffective,
  renderProjectSettingsErrorHtml,
  renderProjectSettingsHtml,
  renderProjectSettingsLoadingHtml,
  renderProjectSettingsOwnerOnlyHtml
} from "./render.js";

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

  function render(): void {
    if (disposed) {
      return;
    }
    if (loadState === "owner_only") {
      container.innerHTML = renderProjectSettingsOwnerOnlyHtml(input.locale);
      return;
    }
    if (loadState === "error") {
      container.innerHTML = renderProjectSettingsErrorHtml(input.locale);
      return;
    }
    if (loadState === "loading" || !governance) {
      container.innerHTML = renderProjectSettingsLoadingHtml(input.locale);
      return;
    }
    container.innerHTML = renderProjectSettingsHtml({
      locale: input.locale,
      projectName: input.projectName,
      governance,
      editable: input.editable,
      savingSilenceWindow,
      errorText
    });
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

  load();

  return {
    dispose: () => {
      disposed = true;
    }
  };
}
