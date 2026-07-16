import assert from "node:assert/strict";
import { test } from "node:test";

import type { GithubBindingStatusVM, ProjectAiGovernanceVM } from "@workhub/contracts";

import {
  hhmmToMinute,
  minuteToHhmm,
  projectInstructionsCounterState,
  renderGithubBindingSectionHtml,
  renderProjectInstructionsSectionHtml,
  renderProjectSettingsHtml,
  renderProjectSettingsOwnerOnlyHtml,
  resolveRiskMonitorForDisplay
} from "./render.js";

function governanceVm(over: Partial<ProjectAiGovernanceVM> = {}): ProjectAiGovernanceVM {
  return {
    project_id: "90000000-0000-4000-8000-000000000001",
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false },
    granular_settings: {},
    // R14 批 RISK：ProjectAiGovernanceVM 加了必填 risk_monitor（读侧完整默认值合并输出）——
    // 不是本文件测的功能改动，纯粹是共享契约加字段牵连的机械补齐（设置分区 UI 归 RISK-B 工包）。
    risk_monitor: {
      enabled: true,
      stall_days_threshold: 5,
      deadline_lookahead_days: 2,
      cost_spike_ratio_pct: 300,
      cost_spike_min_cny: 20
    },
    updated_at: null,
    ...over
  };
}

test("minuteToHhmm and hhmmToMinute round-trip and reject junk", () => {
  assert.equal(minuteToHhmm(0), "00:00");
  assert.equal(minuteToHhmm(1320), "22:00");
  assert.equal(minuteToHhmm(1439), "23:59");
  assert.equal(hhmmToMinute("22:00"), 1320);
  assert.equal(hhmmToMinute("08:30"), 510);
  assert.equal(hhmmToMinute("8:05"), 485);
  assert.equal(hhmmToMinute("24:00"), undefined);
  assert.equal(hhmmToMinute("aa:bb"), undefined);
  assert.equal(hhmmToMinute(""), undefined);
});

test("the editable governance form wires every control to a real data hook", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm(),
    editable: true
  });
  assert.match(html, /项目设置 · 星尘短剧/u);
  assert.match(html, /data-wb-pset-observer role="switch"/u);
  assert.match(html, /data-wb-pset-silence-input\b/u);
  assert.match(html, /data-wb-pset-silence-save\b/u);
  assert.match(html, /data-wb-pset-quiet-toggle role="switch"/u);
  assert.match(html, /data-wb-pset-granular="create_work_item"/u);
  assert.match(html, /data-wb-pset-granular="send_notification"/u);
  // Observer is on and quiet hours are off in this VM.
  assert.match(html, /data-on="true"[^>]*data-wb-pset-observer/u);
  assert.match(html, /data-on="false"[^>]*data-wb-pset-quiet-toggle/u);
  assert.doesNotMatch(html, /只有项目负责人能修改/u);
});

test("the read-only governance form has no action hooks and says why", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm(),
    editable: false
  });
  assert.match(html, /只有项目负责人能修改这些设置。/u);
  assert.doesNotMatch(html, /data-wb-pset-observer role="switch"/u);
  assert.doesNotMatch(html, /data-wb-pset-quiet-toggle role="switch"/u);
  assert.doesNotMatch(html, /data-wb-pset-granular=/u);
  assert.doesNotMatch(html, /data-wb-pset-silence-save\b/u);
  // The switches still render (read-only display), but disabled and without their write hooks.
  assert.match(html, /disabled role="switch"/u);
  // The current values still render (read-only display), just disabled.
  assert.match(html, /value="60" data-wb-pset-silence-input disabled/u);
});

test("enabled quiet hours render start/end times, weekday selection, and the timezone", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm({
      quiet_hours: { enabled: true, timezone: "Asia/Shanghai", start_minute: 1320, end_minute: 480, weekdays: [1, 2, 3, 4, 5] }
    }),
    editable: true
  });
  assert.match(html, /value="22:00" data-wb-pset-quiet-start/u);
  assert.match(html, /value="08:00" data-wb-pset-quiet-end/u);
  assert.match(html, /Asia\/Shanghai/u);
  // Monday selected, Sunday not.
  assert.match(html, /data-sel="true" data-wb-pset-quiet-weekday="1"/u);
  assert.match(html, /data-sel="false" data-wb-pset-quiet-weekday="0"/u);
});

test("disabled quiet hours render no time/weekday body at all", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm(),
    editable: true
  });
  assert.doesNotMatch(html, /data-wb-pset-quiet-start/u);
  assert.doesNotMatch(html, /data-wb-pset-quiet-weekday/u);
});

test("granular chips show honest allowed/blocked state text (unset means allowed)", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm({ granular_settings: { mutate_drive: false } }),
    editable: true
  });
  assert.match(html, /data-wb-pset-granular="mutate_drive">动网盘 · 已禁止/u);
  assert.match(html, /data-wb-pset-granular="create_work_item">建任务 · 允许/u);
});

test("the owner-only state is an honest explanation, not an empty or fake form", () => {
  const html = renderProjectSettingsOwnerOnlyHtml("zh-CN");
  assert.match(html, /data-wb-pset-owner-only="true"/u);
  assert.match(html, /只有项目负责人能查看和修改/u);
  assert.doesNotMatch(html, /data-wb-pset-observer/u);
});

test("an inline error row renders when errorText is set", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm(),
    editable: true,
    errorText: "没保存成功，再试一次。"
  });
  assert.match(html, /data-wb-pset-error="true">没保存成功，再试一次。/u);
});

// —— R14 批 GH（07-gh-design.md §3 UI 节）：GitHub 绑定卡——独立分区、独立状态机。 —— //

function githubBindingVm(over: Partial<GithubBindingStatusVM> = {}): GithubBindingStatusVM {
  return { project_id: "90000000-0000-4000-8000-000000000001", bound: false, ...over };
}

function githubSectionInput(over: Partial<Parameters<typeof renderGithubBindingSectionHtml>[0]> = {}) {
  return {
    locale: "zh-CN" as const,
    editable: true,
    loadState: "ready" as const,
    status: githubBindingVm(),
    mode: "status" as const,
    formRepo: "",
    formPat: "",
    saving: false,
    testPending: false,
    unbindArmed: false,
    ...over
  };
}

test("GH: the loading state shows a scoped spinner, not the page-level loader", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({ loadState: "loading" }));
  assert.match(html, /data-wb-gh-loading="true"/u);
  assert.match(html, /GitHub 集成/u);
  assert.doesNotMatch(html, /data-wb-pset-retry/u);
});

test("GH: the error state renders its own retry hook, distinct from the governance retry", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({ loadState: "error", status: undefined }));
  assert.match(html, /data-wb-gh-retry/u);
  assert.doesNotMatch(html, /data-wb-pset-retry/u);
});

test("GH: an unbound project shows the honest placeholder and, for the owner, a bind CTA", () => {
  const ownerHtml = renderGithubBindingSectionHtml(githubSectionInput({ editable: true }));
  assert.match(ownerHtml, /还没有关联 GitHub 仓库/u);
  assert.match(ownerHtml, /data-wb-gh-bind-cta/u);

  const readOnlyHtml = renderGithubBindingSectionHtml(githubSectionInput({ editable: false }));
  assert.match(readOnlyHtml, /还没有关联 GitHub 仓库/u);
  assert.doesNotMatch(readOnlyHtml, /data-wb-gh-bind-cta/u);
  assert.match(readOnlyHtml, /只有项目负责人能管理 GitHub 绑定。/u);
});

test("GH: a bound project shows repo, sync time, and 7-day activity count", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({
    status: githubBindingVm({
      bound: true,
      repo_full_name: "octocat/Hello-World",
      last_synced_at: "2026-07-14T09:30:00.000Z",
      activity_count_7d: 12
    })
  }));
  assert.match(html, /octocat\/Hello-World/u);
  assert.match(html, /最近同步 2026-07-14 09:30/u);
  assert.match(html, /近 7 天活动 12 条/u);
});

test("GH: a bound project with no prior sync says so honestly instead of a blank/misleading time", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({
    status: githubBindingVm({ bound: true, repo_full_name: "octocat/Hello-World" })
  }));
  assert.match(html, /尚未完成过同步/u);
});

test("GH: a last_error renders as an inline failure banner with the human reason and timestamp", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({
    status: githubBindingVm({
      bound: true,
      repo_full_name: "octocat/Hello-World",
      last_error: "PAT 无效或已过期",
      last_error_at: "2026-07-14T08:00:00.000Z"
    })
  }));
  assert.match(html, /data-wb-gh-last-error="true"/u);
  assert.match(html, /最近一次同步失败（2026-07-14 08:00）：PAT 无效或已过期/u);
});

test("GH: the bound owner view exposes retest/edit/unbind hooks; the non-owner view exposes none of them", () => {
  const status = githubBindingVm({ bound: true, repo_full_name: "octocat/Hello-World" });
  const ownerHtml = renderGithubBindingSectionHtml(githubSectionInput({ status, editable: true }));
  assert.match(ownerHtml, /data-wb-gh-retest/u);
  assert.match(ownerHtml, /data-wb-gh-edit-cta/u);
  assert.match(ownerHtml, /data-wb-gh-unbind\b/u);

  const readOnlyHtml = renderGithubBindingSectionHtml(githubSectionInput({ status, editable: false }));
  assert.doesNotMatch(readOnlyHtml, /data-wb-gh-retest/u);
  assert.doesNotMatch(readOnlyHtml, /data-wb-gh-edit-cta/u);
  assert.doesNotMatch(readOnlyHtml, /data-wb-gh-unbind\b/u);
  assert.match(readOnlyHtml, /只有项目负责人能管理 GitHub 绑定。/u);
});

test("GH: an armed unbind renders a confirmation label and the armed style hook", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({
    status: githubBindingVm({ bound: true, repo_full_name: "octocat/Hello-World" }),
    unbindArmed: true
  }));
  assert.match(html, /确认解绑？/u);
  assert.match(html, /wh-wb-pset-gh-unbind--armed/u);
});

test("GH: the bind/edit form renders repo + password-type PAT inputs, test/submit/cancel hooks, and never labels the PAT field as anything but a token entry", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({ mode: "form", formRepo: "octocat/Hello-World" }));
  assert.match(html, /data-wb-gh-repo-input/u);
  assert.match(html, /type="password"[^>]*data-wb-gh-pat-input/u);
  assert.match(html, /value="octocat\/Hello-World"[^>]*data-wb-gh-repo-input/u);
  assert.match(html, /data-wb-gh-test\b/u);
  assert.match(html, /data-wb-gh-submit\b/u);
  assert.match(html, /data-wb-gh-cancel\b/u);
});

test("GH: a successful test-connection result renders the repo/branch/visibility summary; a failed one renders the server's human reason", () => {
  const ok = renderGithubBindingSectionHtml(githubSectionInput({
    mode: "form",
    testResult: { ok: true, repo_full_name: "octocat/Hello-World", repo_default_branch: "main", repo_private: false }
  }));
  assert.match(ok, /data-wb-gh-test-result="ok"/u);
  assert.match(ok, /连接成功/u);
  assert.match(ok, /main/u);

  const fail = renderGithubBindingSectionHtml(githubSectionInput({
    mode: "form",
    testResult: { ok: false, error: "PAT 无效或已过期" }
  }));
  assert.match(fail, /data-wb-gh-test-result="fail"/u);
  assert.match(fail, /PAT 无效或已过期/u);
});

test("GH: a bound status view never renders the PAT anywhere, even when a stale form draft is still held in state", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({
    mode: "status",
    status: githubBindingVm({ bound: true, repo_full_name: "octocat/Hello-World" }),
    formPat: "ghp_shouldneverappearhere1234"
  }));
  assert.doesNotMatch(html, /ghp_shouldneverappearhere1234/u);
  assert.doesNotMatch(html, /personal_access_token/u);
});

test("GH: en-US copy is used end to end when locale is en-US", () => {
  const html = renderGithubBindingSectionHtml(githubSectionInput({ locale: "en-US" }));
  assert.match(html, /GitHub integration/u);
  assert.match(html, /No GitHub repository linked yet\./u);
  assert.match(html, /Link a GitHub repository/u);
});
// —— R14 批 RISK：风险巡检阈值分区 —— //

test("the editable risk monitor section wires the enable switch and all four threshold inputs to real data hooks", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm({
      risk_monitor: {
        enabled: true,
        stall_days_threshold: 7,
        deadline_lookahead_days: 3,
        cost_spike_ratio_pct: 400,
        cost_spike_min_cny: 30
      }
    }),
    editable: true
  });
  assert.match(html, /风险巡检/u);
  assert.match(html, /data-on="true"[^>]*data-wb-risk-enabled/u);
  assert.match(html, /value="7" data-wb-risk-stall-input/u);
  assert.match(html, /value="3" data-wb-risk-deadline-input/u);
  assert.match(html, /value="400" data-wb-risk-cost-ratio-input/u);
  assert.match(html, /value="30" data-wb-risk-cost-min-input/u);
  assert.match(html, /data-wb-risk-save\b/u);
  assert.match(html, /保存阈值/u);
});

test("the read-only risk monitor section shows the current thresholds but no write hooks", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm(),
    editable: false
  });
  assert.match(html, /value="5" data-wb-risk-stall-input disabled/u);
  assert.doesNotMatch(html, /data-wb-risk-enabled/u);
  assert.doesNotMatch(html, /data-wb-risk-save\b/u);
});

test("a saving-in-progress risk threshold save button reads 'Saving…' and is disabled", () => {
  const html = renderProjectSettingsHtml({
    locale: "zh-CN",
    projectName: "星尘短剧",
    governance: governanceVm(),
    editable: true,
    savingRiskThresholds: true
  });
  assert.match(html, /data-wb-risk-save disabled/u);
  assert.match(html, /保存中…/u);
});

test("resolveRiskMonitorForDisplay fills in every field from DEFAULT_RISK_MONITOR_SETTINGS when the VM sends a sparse object", () => {
  const resolved = resolveRiskMonitorForDisplay({ stall_days_threshold: 10 });
  assert.deepEqual(resolved, {
    enabled: true,
    stall_days_threshold: 10,
    deadline_lookahead_days: 2,
    cost_spike_ratio_pct: 300,
    cost_spike_min_cny: 20
  });
});

// —— R16 批 W4b1（项目自定义指令 · 桌面 UI）—— //

test("projectInstructionsCounterState reports normal below the warn ratio, warn near 4000, and over past it", () => {
  assert.equal(projectInstructionsCounterState(0), "normal");
  assert.equal(projectInstructionsCounterState(3599), "normal");
  assert.equal(projectInstructionsCounterState(3600), "warn");
  assert.equal(projectInstructionsCounterState(4000), "warn");
  assert.equal(projectInstructionsCounterState(4001), "over");
});

test("the instructions section shows a spinner while loading", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "loading",
    draft: "",
    saving: false,
    savedPillVisible: false
  });
  assert.match(html, /data-wb-instr-state="loading"/u);
  assert.match(html, /正在拉自定义指令/u);
  assert.doesNotMatch(html, /data-wb-instr-textarea/u);
});

test("an editable, loaded instructions section renders the textarea prefilled with the draft, a character counter, and the saved pill when requested", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "ready",
    draft: "所有输出用简体中文",
    saving: false,
    savedPillVisible: true
  });
  assert.match(html, /data-wb-instr-state="ready" data-wb-instr-editable="true"/u);
  assert.match(html, /<textarea class="wh-wb-pset-instr-area" data-wb-instr-textarea[^>]*>所有输出用简体中文<\/textarea>/u);
  assert.match(html, /data-wb-instr-count="9">9 \/ 4000/u);
  assert.match(html, /data-wb-instr-saved-pill="true"/u);
  assert.match(html, /已保存/u);
  assert.doesNotMatch(html, /wh-wb-pset-instr-count--warn|wh-wb-pset-instr-count--over/u);
});

test("an empty draft renders the placeholder hint text (not a literal empty string) and no saved pill when not requested", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "ready",
    draft: "",
    saving: false,
    savedPillVisible: false
  });
  assert.match(html, /placeholder="[^"]*简体中文/u);
  assert.match(html, /data-wb-instr-count="0">0 \/ 4000/u);
  assert.doesNotMatch(html, /data-wb-instr-saved-pill/u);
});

test("a non-editable, loaded instructions section renders read-only text with no write hooks and an owner-only note", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: false,
    loadState: "ready",
    draft: "别用黑话",
    saving: false,
    savedPillVisible: false
  });
  assert.match(html, /data-wb-instr-editable="false"/u);
  assert.match(html, /<pre class="wh-wb-pset-instr-readonly" data-wb-instr-readonly="true">别用黑话<\/pre>/u);
  assert.doesNotMatch(html, /data-wb-instr-textarea/u);
  assert.match(html, /只有项目负责人能修改自定义指令/u);
});

test("a non-editable, loaded instructions section with an empty draft says honestly that nothing is configured, not a blank box", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: false,
    loadState: "ready",
    draft: "",
    saving: false,
    savedPillVisible: false
  });
  assert.doesNotMatch(html, /wh-wb-pset-instr-readonly/u);
  assert.match(html, /data-wb-instr-empty="true"/u);
  assert.match(html, /还没有配置自定义指令/u);
});

test("the forbidden state renders only an honest permission note — no textarea, no stale content", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "forbidden",
    draft: "leftover draft that must never leak",
    saving: false,
    savedPillVisible: false
  });
  assert.match(html, /data-wb-instr-state="forbidden"/u);
  assert.match(html, /data-wb-instr-forbidden="true"/u);
  assert.match(html, /需要项目管理权限/u);
  assert.doesNotMatch(html, /data-wb-instr-textarea/u);
  assert.doesNotMatch(html, /leftover draft/u);
});

test("the error state renders a scoped retry button", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "en-US",
    editable: true,
    loadState: "error",
    draft: "",
    saving: false,
    savedPillVisible: false
  });
  assert.match(html, /data-wb-instr-state="error"/u);
  assert.match(html, /data-wb-instr-retry-load/u);
  assert.match(html, /Couldn't load custom instructions/u);
});

test("a validation save error renders in the danger tone with no retry button (client already knows what's wrong)", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "ready",
    draft: "x".repeat(4001),
    saving: false,
    savedPillVisible: false,
    saveErrorKind: "validation",
    saveErrorText: "指令长度超过 4000 字符上限，请精简后再试。"
  });
  assert.match(html, /data-wb-instr-error="validation"/u);
  assert.match(html, /class="wh-wb-pset-error" data-wb-instr-error="validation"/u);
  assert.doesNotMatch(html, /data-wb-instr-retry-save/u);
  // 4001 chars is past the limit — the counter itself must also read the danger tone.
  assert.match(html, /wh-wb-pset-instr-count--over" data-wb-instr-count="4001"/u);
});

test("a network save error preserves the user's typed draft in the textarea and offers a retry button", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "ready",
    draft: "刚打的字不能丢",
    saving: false,
    savedPillVisible: false,
    saveErrorKind: "network",
    saveErrorText: "没保存成功，你刚才写的内容还在——点重试，或者再改一下、失焦即可重新保存。"
  });
  assert.match(html, /<textarea class="wh-wb-pset-instr-area" data-wb-instr-textarea[^>]*>刚打的字不能丢<\/textarea>/u);
  assert.match(html, /data-wb-instr-error="network"/u);
  assert.match(html, /data-wb-instr-retry-save/u);
});

test("saving disables the textarea and shows a saving indicator instead of the idle hint", () => {
  const html = renderProjectInstructionsSectionHtml({
    locale: "zh-CN",
    editable: true,
    loadState: "ready",
    draft: "内容",
    saving: true,
    savedPillVisible: false
  });
  assert.match(html, /<textarea class="wh-wb-pset-instr-area" data-wb-instr-textarea[^>]* disabled>/u);
  assert.match(html, /data-wb-instr-saving="true"/u);
  assert.match(html, /保存中…/u);
});
