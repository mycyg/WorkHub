import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectAiGovernanceVM } from "@workhub/contracts";

import {
  hhmmToMinute,
  minuteToHhmm,
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
