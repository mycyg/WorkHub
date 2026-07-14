import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RISK_MONITOR_SETTINGS,
  patchProjectAiGovernanceRequestSchema,
  projectAiGovernanceVmSchema,
  riskMonitorSettingsSchema
} from "./index.js";

const projectId = "90000000-0000-4000-8000-000000000009";

// R14 批 RISK（风险预警巡检）：三信号阈值契约——工单停滞天数/deadline 前瞻窗口/成本放量比例与下限。
// 全字段可选（PATCH 语义），bounded（防御性上下限），strict（拒绝任意扩展键）。

test("riskMonitorSettingsSchema accepts a partial patch and enforces bounds on every field", () => {
  assert.deepEqual(riskMonitorSettingsSchema.parse({}), {});
  assert.deepEqual(riskMonitorSettingsSchema.parse({ stall_days_threshold: 5 }), { stall_days_threshold: 5 });
  assert.deepEqual(
    riskMonitorSettingsSchema.parse({
      enabled: false,
      stall_days_threshold: 90,
      deadline_lookahead_days: 0,
      cost_spike_ratio_pct: 2000,
      cost_spike_min_cny: 0
    }),
    {
      enabled: false,
      stall_days_threshold: 90,
      deadline_lookahead_days: 0,
      cost_spike_ratio_pct: 2000,
      cost_spike_min_cny: 0
    }
  );

  for (const invalid of [
    { stall_days_threshold: 0 },
    { stall_days_threshold: 91 },
    { stall_days_threshold: 1.5 },
    { deadline_lookahead_days: -1 },
    { deadline_lookahead_days: 31 },
    { cost_spike_ratio_pct: 99 },
    { cost_spike_ratio_pct: 2001 },
    { cost_spike_min_cny: -1 },
    { enabled: "true" },
    { unknown_key: true }
  ]) {
    assert.equal(riskMonitorSettingsSchema.safeParse(invalid).success, false, `accepted malformed risk monitor settings: ${JSON.stringify(invalid)}`);
  }
});

test("DEFAULT_RISK_MONITOR_SETTINGS is the conservative default from the design doc and parses as a full patch", () => {
  assert.deepEqual(DEFAULT_RISK_MONITOR_SETTINGS, {
    enabled: true,
    stall_days_threshold: 5,
    deadline_lookahead_days: 2,
    cost_spike_ratio_pct: 300,
    cost_spike_min_cny: 20
  });
  assert.deepEqual(riskMonitorSettingsSchema.parse(DEFAULT_RISK_MONITOR_SETTINGS), DEFAULT_RISK_MONITOR_SETTINGS);
});

test("project AI governance PATCH accepts an additive risk_monitor field alongside the existing governance fields", () => {
  const patch = { risk_monitor: { stall_days_threshold: 3 } };
  assert.deepEqual(patchProjectAiGovernanceRequestSchema.parse(patch), patch);
  assert.equal(
    patchProjectAiGovernanceRequestSchema.safeParse({ risk_monitor: { unknown_key: true } }).success,
    false
  );
  // 依然要求至少一个字段非 undefined（既有 refine 不受新增可选字段影响）。
  assert.equal(patchProjectAiGovernanceRequestSchema.safeParse({}).success, false);
});

test("project AI governance VM requires a fully-merged risk_monitor object (not partial)", () => {
  const value = {
    project_id: projectId,
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false as const },
    granular_settings: {},
    risk_monitor: DEFAULT_RISK_MONITOR_SETTINGS,
    updated_at: null
  };
  assert.deepEqual(projectAiGovernanceVmSchema.parse(value), value);
  // risk_monitor 字段缺失时必须被拒绝——VM 是「读侧完整默认值合并输出」，不是 partial patch 回显。
  const { risk_monitor: _omitted, ...withoutRiskMonitor } = value;
  assert.equal(projectAiGovernanceVmSchema.safeParse(withoutRiskMonitor).success, false);
});
