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
  agentRunReminderLine,
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

// R26 批 B6 观测面：重复动作提醒的人话行。事件里只有档位/连续步数/形态/原始工具 id，
// 句子在这里按 locale 组装——中英文各自是完整句子，工具名一律去下划线加引号后出现。
test("B6: 重复动作提醒渲成完整人话行，工具名去下划线、不裸露原始工具 id", () => {
  const tier1 = { step_no: 3, tier: 1 as const, repeats: 3, shape: "identical" as const, tool_id: "run_command" };

  assert.equal(
    agentRunReminderLine("zh-CN", tier1),
    "第一次提醒：Cuu 连续 3 步做了同一件事（重复的是「run command」），已让它换个做法再继续。"
  );
  assert.equal(
    agentRunReminderLine("en-US", tier1),
    "First reminder: Cuu repeated the same action for 3 steps (it kept using “run command”). Asked it to try another approach."
  );
  // 原始工具 id 不出现在任何一种语言里。
  assert.equal(agentRunReminderLine("zh-CN", tier1).includes("run_command"), false);
  assert.equal(agentRunReminderLine("en-US", tier1).includes("run_command"), false);
});

test("B6: 第二档提醒说明「再重复就交给人接手」，交替形态列出两个工具名", () => {
  const tier2 = {
    step_no: 5,
    tier: 2 as const,
    repeats: 5,
    shape: "alternating" as const,
    tool_id: "echo",
    tool_ids: ["echo", "mcp__gh__list_issues"]
  };

  const zh = agentRunReminderLine("zh-CN", tier2);
  assert.equal(zh.startsWith("第二次提醒：Cuu 连续 5 步在两个动作之间来回切换"), true);
  // MCP/插件工具 id 的前缀对用户无意义，只留最后一段并去下划线。
  assert.equal(zh.includes("「echo」、「list issues」"), true);
  assert.equal(zh.includes("mcp__gh__"), false);
  assert.equal(zh.includes("这次执行会自动交给人接手"), true);

  const en = agentRunReminderLine("en-US", tier2);
  assert.equal(en.startsWith("Second reminder: Cuu kept switching between two actions for 5 steps"), true);
  assert.equal(en.includes("“echo”, “list issues”"), true);
  assert.equal(en.includes("handed to a person"), true);
});

test("B6: 重复步没有工具调用时退到不提工具名的句子，两种语言都不留悬空括号", () => {
  const noTool = { step_no: 3, tier: 1 as const, repeats: 3, shape: "identical" as const };

  assert.equal(agentRunReminderLine("zh-CN", noTool), "第一次提醒：Cuu 连续 3 步做了同一件事，已让它换个做法再继续。");
  assert.equal(
    agentRunReminderLine("en-US", noTool),
    "First reminder: Cuu repeated the same action for 3 steps. Asked it to try another approach."
  );
  assert.equal(agentRunReminderLine("zh-CN", noTool).includes("（"), false);
  assert.equal(agentRunReminderLine("en-US", noTool).includes("("), false);
});

test("B6: 事件类型在通知/事件标签表里有人话，不裸显 agent_run.reminded", () => {
  assert.equal(notificationTypeLabel("agent_run.reminded", true), "AI 换个做法");
  assert.equal(notificationTypeLabel("agent_run.reminded", false), "AI course correction");
});
