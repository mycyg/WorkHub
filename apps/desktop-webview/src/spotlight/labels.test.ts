import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentRunStatuses,
  agentStepPhases,
  meetingInsightVmSchema,
  meetingRecordVmSchema,
  riskLevels,
  snapshotSchema,
  workItemPriorities,
  workItemStatuses
} from "@workhub/contracts";

import {
  agentRunStatusLabel,
  agentStepPhaseLabel,
  meetingInsightKindLabel,
  meetingInsightStatusLabel,
  meetingRecordStatusLabel,
  riskHintLabel,
  snapshotKindLabel,
  workItemPriorityLabel,
  workItemStatusLabel
} from "./labels.js";

test("desktop spotlight work item status labels hide raw machine enums", () => {
  assert.equal(workItemStatusLabel("ai_working", true), "AI 正在处理");
  assert.equal(workItemStatusLabel("ai_working", false), "AI working");
});

test("R9.7 desktop spec-ready status avoids dispatch/run wording", () => {
  assert.equal(workItemStatusLabel("spec_ready", true), "规格已就绪");
  assert.equal(workItemStatusLabel("spec_ready", false), "Spec ready");
  assert.doesNotMatch(workItemStatusLabel("spec_ready", true), /派活/u);
  assert.doesNotMatch(workItemStatusLabel("spec_ready", false), /run/i);
});

// 未登记的枚举取值绝不能原样渲染给用户（旧行为把 `future_state` 这种生 id 直接印在界面上）。
test("desktop spotlight work item status labels fall back to plain words, never the raw enum", () => {
  assert.equal(workItemStatusLabel("future_state", true), "未知状态");
  assert.equal(workItemStatusLabel("future_state", false), "Unknown status");
});

test("desktop spotlight agent step phase labels do not expose unknown machine enums", () => {
  assert.equal(agentStepPhaseLabel("future_phase", true), "步骤");
  assert.equal(agentStepPhaseLabel("future_phase", false), "Step");
});

// F-09：会议记录状态——与搜索结果行共用同一张表（search.ts 重导出同名函数），三个真实值配人话，
// 未知值原样透传（不编造词表，同 workItemStatusLabel 的纪律）。
test("desktop spotlight meeting record status labels cover the three real values and preserve unknown ones", () => {
  assert.equal(meetingRecordStatusLabel("processing", true), "处理中");
  assert.equal(meetingRecordStatusLabel("processing", false), "Processing");
  assert.equal(meetingRecordStatusLabel("ready", true), "已就绪");
  assert.equal(meetingRecordStatusLabel("ready", false), "Ready");
  assert.equal(meetingRecordStatusLabel("failed", true), "失败");
  assert.equal(meetingRecordStatusLabel("failed", false), "Failed");
  assert.equal(meetingRecordStatusLabel("future_status", true), "未知状态");
  assert.equal(meetingRecordStatusLabel("future_status", false), "Unknown status");
});

test("desktop spotlight meeting insight kind labels match the web route-components wording", () => {
  assert.equal(meetingInsightKindLabel("new_requirement", true), "新需求");
  assert.equal(meetingInsightKindLabel("new_requirement", false), "New requirement");
  assert.equal(meetingInsightKindLabel("requirement_change", true), "需求变更");
  assert.equal(meetingInsightKindLabel("requirement_change", false), "Requirement change");
  assert.equal(meetingInsightKindLabel("normal_note", true), "普通记录");
  assert.equal(meetingInsightKindLabel("normal_note", false), "Note");
  assert.equal(meetingInsightKindLabel("future_kind", true), "其它记录");
  assert.equal(meetingInsightKindLabel("future_kind", false), "Other note");
});

test("desktop spotlight meeting insight status labels are a disjoint enum from record status", () => {
  assert.equal(meetingInsightStatusLabel("pending", true), "待确认");
  assert.equal(meetingInsightStatusLabel("pending", false), "Pending");
  assert.equal(meetingInsightStatusLabel("confirmed", true), "已确认");
  assert.equal(meetingInsightStatusLabel("confirmed", false), "Confirmed");
  assert.equal(meetingInsightStatusLabel("dismissed", true), "已忽略");
  assert.equal(meetingInsightStatusLabel("dismissed", false), "Dismissed");
  assert.equal(meetingInsightStatusLabel("future_status", true), "未知状态");
  assert.equal(meetingInsightStatusLabel("future_status", false), "Unknown status");
});

// 缺映射要在这里红，不要在界面上露出来：逐个走 contracts 的枚举取值域，任何一个查不到映射就会
// 落到人话兜底（「未知状态」等），这里断言「真实取值都不走兜底」。新增枚举值忘了配文案 → 本测试红。
test("every real enum value has a label, so no value silently falls back", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly values: readonly string[];
    readonly label: (value: string, zh: boolean) => string;
    readonly fallbackZh: string;
    readonly fallbackEn: string;
  }> = [
    { name: "workItemStatus", values: workItemStatuses, label: workItemStatusLabel, fallbackZh: "未知状态", fallbackEn: "Unknown status" },
    { name: "workItemPriority", values: workItemPriorities, label: workItemPriorityLabel, fallbackZh: "未标注", fallbackEn: "Unspecified" },
    { name: "agentRunStatus", values: agentRunStatuses, label: agentRunStatusLabel, fallbackZh: "未知状态", fallbackEn: "Unknown status" },
    { name: "agentStepPhase", values: agentStepPhases, label: agentStepPhaseLabel, fallbackZh: "步骤", fallbackEn: "Step" },
    { name: "riskHint", values: riskLevels, label: riskHintLabel, fallbackZh: "风险未知", fallbackEn: "Risk unknown" },
    { name: "snapshotKind", values: snapshotSchema.shape.kind.options, label: snapshotKindLabel, fallbackZh: "还原点", fallbackEn: "Restore point" },
    { name: "meetingRecordStatus", values: meetingRecordVmSchema.shape.status.options, label: meetingRecordStatusLabel, fallbackZh: "未知状态", fallbackEn: "Unknown status" },
    { name: "meetingInsightKind", values: meetingInsightVmSchema.shape.kind.options, label: meetingInsightKindLabel, fallbackZh: "其它记录", fallbackEn: "Other note" },
    { name: "meetingInsightStatus", values: meetingInsightVmSchema.shape.status.options, label: meetingInsightStatusLabel, fallbackZh: "未知状态", fallbackEn: "Unknown status" }
  ];
  for (const { name, values, label, fallbackZh, fallbackEn } of cases) {
    assert.ok(values.length > 0, `${name} 的取值域是空的，枚举来源疑似失效`);
    for (const value of values) {
      assert.notEqual(label(value, true), fallbackZh, `${name}.${value} 中文缺映射`);
      assert.notEqual(label(value, false), fallbackEn, `${name}.${value} 英文缺映射`);
      assert.notEqual(label(value, true), value, `${name}.${value} 中文侧漏出了原始枚举值`);
    }
  }
});
