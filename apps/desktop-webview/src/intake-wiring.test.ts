import assert from "node:assert/strict";
import test from "node:test";

import { renderWebRouteComponent } from "@workhub/ui/gold-path";
import type { SessionVM } from "@workhub/contracts";

// 测试反馈修复（桌面主窗口接入真闭环）：桌面 browser.ts 的 intake 动作处理依赖共享 route-component 暴露的
// 一组 DOM 钩子（选项的 data-intake-option-id、提交的 next-question 载荷、确认阶段的 create-workitem 按钮、
// 起点屏的 start-intake 动作 + 意图输入框）。这里把这些钩子钉成契约——若共享 UI 改动抹掉任一钩子，
// 桌面 intake 会静默退回「暂不可用」，本测试先红、挡住回归。
function session(inputMode: SessionVM["question"]["input_mode"]): SessionVM {
  return {
    session_id: "10000000-0000-4000-8000-000000000901",
    work_item_id: "10000000-0000-4000-8000-000000000902",
    topic: "复盘包模板",
    stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000901",
    next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000901/next-question",
    question: {
      id: "10000000-0000-4000-8000-000000000903",
      title: inputMode === "confirm" ? "确认后创建工作项？" : "这份复盘包先按哪个口径做？",
      body: "先选一个方向，必要时再补充。",
      input_mode: inputMode,
      options: [
        { id: "risk-first", label: "风险优先", description: "先列阻塞与需拍板项。" },
        { id: "progress-first", label: "进展优先", description: "先列完成与下一步。" }
      ],
      recommended_option_ids: ["risk-first"],
      free_text: { enabled: true, collapsed_by_default: true, placeholder: "有特殊格式再补一句。", max_length: 280 },
      progress: [
        { key: "intent", label: "需求", state: "done" },
        { key: "scope", label: "范围", state: inputMode === "confirm" ? "done" : "active" }
      ],
      evidence_refs: [],
      submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000901/next-question" }
    }
  };
}

test("desktop intake scope question exposes the selection + next-question hooks the desktop handler keys on", () => {
  const html = renderWebRouteComponent({ key: "intake", session: session("single_choice") }, { locale: "zh-CN" }).html;
  // 选项勾选委托（[data-option-id] 分支）需要 data-intake-option-id 落在 [data-r4-route-component="intake"] 内。
  assert.equal(html.includes('data-r4-route-component="intake"'), true);
  assert.equal(html.includes('data-intake-option-id="risk-first"'), true);
  // 「继续」→ next-question：handler 用 sessionNextQuestionIdFromHref(href) + data-intake-submit 载荷。
  assert.equal(html.includes('data-intake-submit="next-question"'), true);
  assert.equal(html.includes("/api/sessions/10000000-0000-4000-8000-000000000901/next-question"), true);
  assert.equal(html.includes('data-session-id="10000000-0000-4000-8000-000000000901"'), true);
  // scope 阶段不该出现「创建工作项」按钮（只有 confirm 阶段才出现）。
  assert.equal(html.includes('data-intake-create-workitem="true"'), false);
});

test("desktop intake confirm question exposes the create-workitem hook", () => {
  const html = renderWebRouteComponent({ key: "intake", session: session("confirm") }, { locale: "zh-CN" }).html;
  // 确认阶段：handler 用 createWorkItemActionFromHref(href) + data-intake-create-workitem 载荷创建工作项。
  assert.equal(html.includes('data-intake-create-workitem="true"'), true);
});

test("desktop intake start screen exposes the start-intake action + intent input", () => {
  const html = renderWebRouteComponent({ key: "intake", start: true }, { locale: "zh-CN" }).html;
  // 起点屏：handler 用 bootstrapProjectActionFromHref(href)+data-s1-day0-start-intake 起真实会话，
  // 并从 data-s1-day1-intent-input 读用户意图。
  assert.equal(html.includes('data-s1-day0-start-intake="true"'), true);
  assert.equal(html.includes("data-s1-day1-intent-input"), true);
});
