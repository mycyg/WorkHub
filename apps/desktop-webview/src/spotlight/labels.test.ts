import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentStepPhaseLabel,
  meetingInsightKindLabel,
  meetingInsightStatusLabel,
  meetingRecordStatusLabel,
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

test("desktop spotlight work item status labels preserve unknown values", () => {
  assert.equal(workItemStatusLabel("future_state", true), "future_state");
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
  assert.equal(meetingRecordStatusLabel("future_status", true), "future_status");
});

test("desktop spotlight meeting insight kind labels match the web route-components wording", () => {
  assert.equal(meetingInsightKindLabel("new_requirement", true), "新需求");
  assert.equal(meetingInsightKindLabel("new_requirement", false), "New requirement");
  assert.equal(meetingInsightKindLabel("requirement_change", true), "需求变更");
  assert.equal(meetingInsightKindLabel("requirement_change", false), "Requirement change");
  assert.equal(meetingInsightKindLabel("normal_note", true), "普通记录");
  assert.equal(meetingInsightKindLabel("normal_note", false), "Note");
  assert.equal(meetingInsightKindLabel("future_kind", true), "future_kind");
});

test("desktop spotlight meeting insight status labels are a disjoint enum from record status", () => {
  assert.equal(meetingInsightStatusLabel("pending", true), "待确认");
  assert.equal(meetingInsightStatusLabel("pending", false), "Pending");
  assert.equal(meetingInsightStatusLabel("confirmed", true), "已确认");
  assert.equal(meetingInsightStatusLabel("confirmed", false), "Confirmed");
  assert.equal(meetingInsightStatusLabel("dismissed", true), "已忽略");
  assert.equal(meetingInsightStatusLabel("dismissed", false), "Dismissed");
  assert.equal(meetingInsightStatusLabel("future_status", true), "future_status");
});
