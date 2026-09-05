import assert from "node:assert/strict";
import test from "node:test";

import {
  agentRunStatuses,
  agentStepPhases,
  deliverableTargetKinds,
  evidenceSourceTypes,
  workItemStatuses
} from "@workhub/contracts";

import {
  agentRunStatusLabel,
  agentStepPhaseLabel,
  deliverableTargetLabel,
  evidenceSourceLabel,
  notificationTypeLabel,
  uiResetUnmappedLabelValues,
  uiUnmappedLabelValues,
  workItemStatusLabel
} from "./i18n.js";

// A2-95：枚举缺人话映射时，界面不再把内部枚举摊平直出。缺映射登记在 uiUnmappedLabelValues 里，
// 由这条测试红——「缺映射在测试里暴露，不在用户面暴露」。
test("每个契约枚举都有人话标签，没有一个走中性兜底", () => {
  uiResetUnmappedLabelValues();

  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const status of workItemStatuses) {
      workItemStatusLabel(locale, status);
    }
    for (const status of agentRunStatuses) {
      agentRunStatusLabel(locale, status);
    }
    for (const phase of agentStepPhases) {
      agentStepPhaseLabel(locale, phase);
    }
    for (const kind of deliverableTargetKinds) {
      deliverableTargetLabel(locale, kind);
    }
    for (const source of evidenceSourceTypes) {
      evidenceSourceLabel(locale, source);
    }
  }

  assert.deepEqual(uiUnmappedLabelValues(), []);
});

test("未映射的枚举回落到中性词，不把内部字面量渲给用户", () => {
  uiResetUnmappedLabelValues();

  assert.equal(workItemStatusLabel("zh-CN", "brand_new_status"), "其他状态");
  assert.equal(workItemStatusLabel("en-US", "brand_new_status"), "Other status");
  assert.equal(deliverableTargetLabel("zh-CN", "quantum_doc"), "其他类型");
  assert.equal(evidenceSourceLabel("en-US", "telepathy"), "Other source");
  assert.equal(notificationTypeLabel("workhub.brand_new_thing", true), "其他通知");
  assert.equal(notificationTypeLabel("workhub.brand_new_thing", false), "Other notification");

  assert.deepEqual(uiUnmappedLabelValues(), [
    "kind:quantum_doc",
    "notification:workhub.brand_new_thing",
    "source:telepathy",
    "status:brand_new_status"
  ]);
  uiResetUnmappedLabelValues();
});
