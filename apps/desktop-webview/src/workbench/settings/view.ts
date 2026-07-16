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
  ProjectAiGovernanceVM,
  ProjectInstructionsVM
} from "@workhub/contracts";
import { PROJECT_INSTRUCTIONS_MAX_CHARS } from "@workhub/contracts";

import {
  deleteGithubBinding,
  fetchGithubBindingStatus,
  fetchProjectAiGovernance,
  fetchProjectInstructions,
  patchProjectAiGovernance,
  patchProjectInstructions,
  putGithubBinding,
  testGithubBindingConnection,
  type ProjectSettingsApiClient
} from "./api.js";
import {
  PROJECT_GRANULAR_KEYS,
  RISK_MONITOR_BOUNDS,
  hhmmToMinute,
  projectGranularEffective,
  renderGithubBindingSectionHtml,
  renderProjectInstructionsSectionHtml,
  renderProjectMembersSectionHtml,
  renderProjectSettingsErrorHtml,
  renderProjectSettingsHtml,
  renderProjectSettingsLoadingHtml,
  renderProjectSettingsOwnerOnlyHtml,
  resolveRiskMonitorForDisplay,
  type ProjectInstructionsSectionLoadState,
  type ProjectMembersOverview
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
    // R17 批 G1（#2）：项目成员分区数据——由 shell 从已就绪的 workbench VM 直接传入（全员数 + collab
    // 会话列表），本视图不额外取数。缺省时不渲成员分区（兼容存量测试/调用点）。
    memberOverview?: ProjectMembersOverview | undefined;
    // 成员分区里「管理成员」按钮点击——跳到对应协同会话（shell 切 centerTab=collab）。缺省则按钮无效。
    onOpenConversation?: ((conversationId: string) => void) | undefined;
  }
): ProjectSettingsViewHandle {
  const zh = input.locale === "zh-CN";
  let disposed = false;
  let governance: ProjectAiGovernanceVM | undefined;
  let loadState: "loading" | "ready" | "error" | "owner_only" = "loading";
  let savingSilenceWindow = false;
  // R14 批 RISK：风险巡检阈值——四个数值输入共用一个显式「保存阈值」按钮（同静默窗口秒数的取舍，
  // 不能每次击键都发 PATCH）；启停开关走即改即 PATCH（同观察者开关，布尔值不需要校验）。
  let savingRiskThresholds = false;
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

  // R16 批 W4b1（项目自定义指令 · 桌面 UI）：第三个独立分区/状态机——GET 和 PATCH 同一道权限门
  // （canManageProjectDrive，见 apps/api/src/services/project-instructions.ts 顶部注释），跟上面
  // governance「读锁负责人」、GH「读放开写收紧」都不是同一个口径，所以也不能挂在既有的两个 loadState
  // 上，必须自己一套。instructionsDraft 是"当前该在 textarea 里显示的内容"——挂载时=GET 回来的
  // instructions_md，之后每次失焦保存尝试（无论成不成功）都同步成用户刚敲的内容：保存失败绝不能把
  // 这个值改回旧的，那等于替用户把刚写的东西吞了（见 attemptSaveFromTextarea）。
  let instructions: ProjectInstructionsVM | undefined;
  let instructionsLoadState: ProjectInstructionsSectionLoadState = "loading";
  let instructionsDraft = "";
  let instructionsSaving = false;
  let instructionsSavedPillVisible = false;
  let instructionsSaveErrorKind: "validation" | "network" | undefined;
  let instructionsSaveErrorText: string | undefined;
  let instructionsLoadGeneration = 0;
  let instructionsSavedPillTimer: ReturnType<typeof setTimeout> | undefined;

  function clearInstructionsSavedPillTimer(): void {
    if (instructionsSavedPillTimer !== undefined) {
      clearTimeout(instructionsSavedPillTimer);
      instructionsSavedPillTimer = undefined;
    }
  }

  function instructionsValidationMessage(): string {
    return zh
      ? `指令长度超过 ${PROJECT_INSTRUCTIONS_MAX_CHARS} 字符上限，请精简后再试。`
      : `Instructions exceed the ${PROJECT_INSTRUCTIONS_MAX_CHARS}-character limit — trim it and try again.`;
  }

  function instructionsSectionHtml(): string {
    return renderProjectInstructionsSectionHtml({
      locale: input.locale,
      editable: input.editable,
      loadState: instructionsLoadState,
      draft: instructionsDraft,
      saving: instructionsSaving,
      savedPillVisible: instructionsSavedPillVisible,
      saveErrorKind: instructionsSaveErrorKind,
      saveErrorText: instructionsSaveErrorText
    });
  }

  function loadInstructions(): void {
    const generation = ++instructionsLoadGeneration;
    instructionsLoadState = "loading";
    instructionsSaveErrorKind = undefined;
    instructionsSaveErrorText = undefined;
    render();
    void fetchProjectInstructions(input.client, input.projectId)
      .then((vm) => {
        if (disposed || generation !== instructionsLoadGeneration) {
          return;
        }
        instructions = vm;
        instructionsDraft = vm.instructions_md;
        instructionsLoadState = "ready";
        render();
      })
      .catch((error: unknown) => {
        if (disposed || generation !== instructionsLoadGeneration) {
          return;
        }
        instructionsLoadState = error instanceof WorkHubApiError && error.status === 403 ? "forbidden" : "error";
        render();
      });
  }

  // 失焦保存的落地函数——trimmed 已经在调用方（attemptSaveFromTextarea / 重试按钮）里做过幂等与
  // 客户端长度校验，这里只管发请求 + 三路错误分支：403（权限中途没了）把整个分区收成只读态；422
  // （服务端 trim 后仍超限的边界情况，客户端校验理论上已经拦住多数场景，这里是兜底）标红计数+提示；
  // 其它一律按网络错处理——绝不回滚 instructionsDraft，用户刚写的内容原样留在 textarea 里，只给一个
  // 可点的「重试」。
  function saveInstructions(trimmed: string): void {
    instructionsSaving = true;
    instructionsSaveErrorKind = undefined;
    instructionsSaveErrorText = undefined;
    render();
    patchProjectInstructions(input.client, input.projectId, { instructions_md: trimmed })
      .then((next) => {
        if (disposed) {
          return;
        }
        instructions = next;
        instructionsDraft = next.instructions_md;
        instructionsSaving = false;
        instructionsSavedPillVisible = true;
        render();
        clearInstructionsSavedPillTimer();
        instructionsSavedPillTimer = setTimeout(() => {
          instructionsSavedPillTimer = undefined;
          if (disposed) {
            return;
          }
          instructionsSavedPillVisible = false;
          render();
        }, 1800);
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        instructionsSaving = false;
        if (error instanceof WorkHubApiError && error.status === 403) {
          instructionsLoadState = "forbidden";
          render();
          return;
        }
        if (error instanceof WorkHubApiError && error.status === 422) {
          instructionsSaveErrorKind = "validation";
          instructionsSaveErrorText = instructionsValidationMessage();
          render();
          return;
        }
        instructionsSaveErrorKind = "network";
        instructionsSaveErrorText = zh
          ? "没保存成功，你刚才写的内容还在——点重试，或者再改一下、失焦即可重新保存。"
          : "Couldn't save — what you typed is still here. Retry, or edit and leave the field again.";
        render();
      });
  }

  // textarea 失焦时的落地——先把 instructionsDraft 同步成用户刚敲的原始内容（哪怕后面判定为不用发
  // 请求或者校验不过，这一步都先做，DOM 已经是这个内容了，状态跟着对齐，不是"假装没看见"）。
  function attemptSaveFromTextarea(raw: string): void {
    instructionsDraft = raw;
    const trimmed = raw.trim();
    const confirmed = instructions?.instructions_md ?? "";
    if (trimmed === confirmed) {
      // 幂等：跟上一次确认保存的值一样（用户改了又改回去，或者单纯失焦了一下），不发这趟请求。
      // 只有此前挂着一条错误提示时才重绘去清掉它——真的什么都没变就不用白重建一次 DOM。
      const hadError = instructionsSaveErrorKind !== undefined;
      instructionsSaveErrorKind = undefined;
      instructionsSaveErrorText = undefined;
      if (hadError) {
        render();
      }
      return;
    }
    if (trimmed.length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
      instructionsSaveErrorKind = "validation";
      instructionsSaveErrorText = instructionsValidationMessage();
      render();
      return;
    }
    saveInstructions(trimmed);
  }

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
      savingRiskThresholds,
      errorText
    });
  }

  // R17 批 G1（#2）：项目成员分区——独立块（同 GitHub 分区），由传入的 memberOverview 渲染，不依赖
  // governance 的 loadState（非负责人也能看到成员概览）。缺省 memberOverview 时不渲这个分区。
  function memberSectionHtml(): string {
    if (!input.memberOverview) {
      return "";
    }
    return renderProjectMembersSectionHtml({ locale: input.locale, overview: input.memberOverview });
  }

  function render(): void {
    if (disposed) {
      return;
    }
    container.innerHTML = `${governanceSectionHtml()}${memberSectionHtml()}${instructionsSectionHtml()}${renderGithubBindingSectionHtml({
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
        savingRiskThresholds = false;
        render();
      })
      .catch((error: unknown) => {
        if (disposed) {
          return;
        }
        governance = previous;
        savingSilenceWindow = false;
        savingRiskThresholds = false;
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
    // R17 批 G1（#2）：成员分区「管理成员」跳转——navigation only，任何 viewer 都可用（不受 governance/
    // editable 门控），所以放在下面「非负责人早退」判断之前。
    if (event.target instanceof HTMLElement) {
      const openConversationBtn = event.target.closest<HTMLElement>("[data-wb-pset-open-conversation]");
      if (openConversationBtn?.dataset.wbPsetOpenConversation) {
        input.onOpenConversation?.(openConversationBtn.dataset.wbPsetOpenConversation);
        return;
      }
    }
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
      return;
    }
    // R14 批 RISK：风险巡检启停——即改即 PATCH（同观察者开关，布尔值不需要客户端校验）。整列替换写
    // （见 render.ts 顶部注释），所以必须带上当前已解析的四个阈值，不能只发 { enabled }。
    if (target.closest("[data-wb-risk-enabled]")) {
      const previous = governance;
      const resolved = resolveRiskMonitorForDisplay(previous.risk_monitor);
      const nextRisk = { ...resolved, enabled: !resolved.enabled };
      governance = { ...governance, risk_monitor: nextRisk };
      patchGovernance({ risk_monitor: nextRisk }, previous);
      return;
    }
    // R14 批 RISK：四个阈值的显式「保存阈值」按钮——客户端先按契约边界（RISK_MONITOR_BOUNDS，跟
    // render.ts 的 riskMonitorSettingsSchema 边界同一份数字）校验，未过校验不发 PATCH，只给行内提示，
    // 避免发一个必被 422 拒掉的请求。
    if (target.closest("[data-wb-risk-save]")) {
      if (savingRiskThresholds) {
        return;
      }
      const stallField = container.querySelector<HTMLInputElement>("[data-wb-risk-stall-input]");
      const deadlineField = container.querySelector<HTMLInputElement>("[data-wb-risk-deadline-input]");
      const costRatioField = container.querySelector<HTMLInputElement>("[data-wb-risk-cost-ratio-input]");
      const costMinField = container.querySelector<HTMLInputElement>("[data-wb-risk-cost-min-input]");
      const stall = Number(stallField?.value ?? "");
      const deadline = Number(deadlineField?.value ?? "");
      const costRatio = Number(costRatioField?.value ?? "");
      const costMin = Number(costMinField?.value ?? "");
      const stallBounds = RISK_MONITOR_BOUNDS.stall_days_threshold;
      const deadlineBounds = RISK_MONITOR_BOUNDS.deadline_lookahead_days;
      const costRatioBounds = RISK_MONITOR_BOUNDS.cost_spike_ratio_pct;
      const costMinBounds = RISK_MONITOR_BOUNDS.cost_spike_min_cny;
      if (!Number.isInteger(stall) || stall < stallBounds.min || stall > stallBounds.max) {
        showInlineError(
          zh
            ? `工单停滞天数阈值要在 ${stallBounds.min} 到 ${stallBounds.max} 天之间。`
            : `The stall threshold must be ${stallBounds.min}-${stallBounds.max} days.`
        );
        return;
      }
      if (!Number.isInteger(deadline) || deadline < deadlineBounds.min || deadline > deadlineBounds.max) {
        showInlineError(
          zh
            ? `deadline 前瞻天数要在 ${deadlineBounds.min} 到 ${deadlineBounds.max} 天之间。`
            : `The deadline lookahead must be ${deadlineBounds.min}-${deadlineBounds.max} days.`
        );
        return;
      }
      if (!Number.isInteger(costRatio) || costRatio < costRatioBounds.min || costRatio > costRatioBounds.max) {
        showInlineError(
          zh
            ? `成本放量比例要在 ${costRatioBounds.min} 到 ${costRatioBounds.max} 之间。`
            : `The cost spike ratio must be ${costRatioBounds.min}-${costRatioBounds.max}.`
        );
        return;
      }
      if (!Number.isFinite(costMin) || costMin < costMinBounds.min) {
        showInlineError(
          zh ? `成本放量下限不能小于 ¥${costMinBounds.min}。` : `The cost spike floor cannot be less than ¥${costMinBounds.min}.`
        );
        return;
      }
      const previous = governance;
      const resolved = resolveRiskMonitorForDisplay(previous.risk_monitor);
      const nextRisk = {
        enabled: resolved.enabled,
        stall_days_threshold: stall,
        deadline_lookahead_days: deadline,
        cost_spike_ratio_pct: costRatio,
        cost_spike_min_cny: costMin
      };
      if (
        nextRisk.stall_days_threshold === resolved.stall_days_threshold
        && nextRisk.deadline_lookahead_days === resolved.deadline_lookahead_days
        && nextRisk.cost_spike_ratio_pct === resolved.cost_spike_ratio_pct
        && nextRisk.cost_spike_min_cny === resolved.cost_spike_min_cny
      ) {
        return;
      }
      savingRiskThresholds = true;
      governance = { ...governance, risk_monitor: nextRisk };
      patchGovernance({ risk_monitor: nextRisk }, previous);
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

  // R16 批 W4b1：自定义指令分区的点击处理器——同 GH 那个一样独立设监听器（这个分区的加载态跟
  // governance/GH 都不是同一权限口径，见顶部状态声明处的注释）。重试加载（读）不挂在 editable 早退
  // 上——同 GH 的 data-wb-gh-retry 一个道理，只读查看者遇到网络错误也该能重试读；但重试保存（写）
  // 必须在 editable 守卫之后，否则只读会话里一次"假装点了这个钩子"的事件就能触发一次 PATCH。
  container.addEventListener("click", (event) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const target = event.target;
    if (target.closest("[data-wb-instr-retry-load]")) {
      loadInstructions();
      return;
    }
    if (!input.editable) {
      return;
    }
    if (target.closest("[data-wb-instr-retry-save]")) {
      if (instructionsSaving) {
        return;
      }
      const trimmed = instructionsDraft.trim();
      if (trimmed.length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
        instructionsSaveErrorKind = "validation";
        instructionsSaveErrorText = instructionsValidationMessage();
        render();
        return;
      }
      saveInstructions(trimmed);
    }
  });

  // R16 批 W4b1：textarea 失焦即保存——focusout 会冒泡（blur 不会），走委托监听同 governance 的
  // change 监听器一个套路；同 spotlight/views/settings.ts「我的资料」自由文本字段的既有先例：
  // 这套整段 innerHTML 重绘架构下，逐击键的 input 事件重绘会在用户还在打字时打断输入焦点，
  // focusout 本身就意味着用户已经离开这个字段，这时候重绘不会有体验代价。
  container.addEventListener("focusout", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = event.target;
    if (!target.matches("[data-wb-instr-textarea]")) {
      return;
    }
    if (!input.editable || instructionsLoadState !== "ready") {
      return;
    }
    // attemptSaveFromTextarea 自己按分支决定要不要 render()——幂等分支（内容没变）故意不重绘，
    // 避免在没有任何视觉变化时白白重建一次整棵 DOM。
    attemptSaveFromTextarea(target.value);
  });

  // R16 批 W4b1：字符计数的逐击键实时更新——不走 render()（会在用户还在打字时重建整棵 DOM、打断
  // 焦点/光标位置），只直接改这一个 <span> 的文本和 class。真正的保存仍然只在失焦时发生（上面的
  // focusout 监听器），这里纯粹是"4000 上限，接近时变警示色"的即时视觉反馈。
  container.addEventListener("input", (event) => {
    if (!(event.target instanceof HTMLTextAreaElement)) {
      return;
    }
    const target = event.target;
    if (!target.matches("[data-wb-instr-textarea]")) {
      return;
    }
    const counterEl = container.querySelector<HTMLElement>("[data-wb-instr-count]");
    if (!counterEl) {
      return;
    }
    const length = target.value.length;
    counterEl.textContent = `${length} / ${PROJECT_INSTRUCTIONS_MAX_CHARS}`;
    counterEl.classList.remove("wh-wb-pset-instr-count--warn", "wh-wb-pset-instr-count--over");
    if (length > PROJECT_INSTRUCTIONS_MAX_CHARS) {
      counterEl.classList.add("wh-wb-pset-instr-count--over");
    } else if (length >= Math.round(PROJECT_INSTRUCTIONS_MAX_CHARS * 0.9)) {
      counterEl.classList.add("wh-wb-pset-instr-count--warn");
    }
  });

  load();
  loadGithub();
  loadInstructions();

  return {
    dispose: () => {
      disposed = true;
      clearGithubUnbindTimer();
      clearInstructionsSavedPillTimer();
    }
  };
}
