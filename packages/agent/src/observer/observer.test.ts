import assert from "node:assert/strict";
import test from "node:test";

import {
  buildObserverSystemPrompt,
  buildObserverUserPrompt,
  isLowQualityObserverPlan,
  observerPlanSchema,
  parseObserverPlanResponse,
  OBSERVER_PLAN_MAX_ITEMS,
  type ObserverPromptMessage
} from "./index.js";

function messages(): ObserverPromptMessage[] {
  return [
    { seq: 5, senderKind: "user", senderLabel: "阿曼", text: "第三节口径按张三说的重写一下", createdAt: "2026-07-12T08:00:00.000Z" },
    { seq: 6, senderKind: "user", senderLabel: "张三", text: "下周投放预算要不要砍半，我拿不准", createdAt: "2026-07-12T08:00:05.000Z" }
  ];
}

test("buildObserverSystemPrompt carries the data-isolation fence and judgement rules", () => {
  const prompt = buildObserverSystemPrompt();
  assert.match(prompt, /数据隔离/u);
  assert.match(prompt, /execute/u);
  assert.match(prompt, /decide/u);
  assert.match(prompt, /observe/u);
  assert.match(prompt, /不出现 branch\/PR\/merge\/commit 等技术黑话/u);
});

test("buildObserverUserPrompt renders ordered messages and referenced context, truncating oversized text", () => {
  const longText = "x".repeat(3000);
  const prompt = buildObserverUserPrompt({
    projectName: "星尘计划",
    messages: [
      { seq: 1, senderKind: "user", senderLabel: "阿曼", text: longText, createdAt: "2026-07-12T08:00:00.000Z" }
    ],
    referencedContext: ["选题报告.docx 摘要：……"]
  });
  assert.match(prompt, /星尘计划/u);
  assert.match(prompt, /#1 阿曼:/u);
  assert.ok(prompt.length < longText.length + 2000, "message text must be truncated, not embedded verbatim");
  assert.match(prompt, /已省略后/u);
  assert.match(prompt, /选题报告\.docx/u);
});

test("buildObserverUserPrompt renders an explicit empty state when there is no new discussion", () => {
  const prompt = buildObserverUserPrompt({ projectName: "星尘计划", messages: [] });
  assert.match(prompt, /无新增讨论/u);
  assert.match(prompt, /（无）/u);
});

// R13 批 A2（派人推荐 v2）：候选名单是可选入参，不传/空数组时完全不影响既有行为——不新增任何 prompt 分段。
test("buildObserverUserPrompt omits the candidate roster section entirely when no roster is supplied", () => {
  const withoutField = buildObserverUserPrompt({ projectName: "星尘计划", messages: [] });
  const withEmptyArray = buildObserverUserPrompt({ projectName: "星尘计划", messages: [], candidateRoster: [] });
  assert.doesNotMatch(withoutField, /候选名单/u);
  assert.doesNotMatch(withEmptyArray, /候选名单/u);
});

// R13 批 A2：候选名单 prompt 用「项目经理挑人」口吻校准（Cuu 角色总纲=项目经理），并且明确交代
// 点名优先——不能让名单本身盖过讨论里已经点名的人。
test("buildObserverUserPrompt renders the candidate roster in a project-manager voice and preserves nickname-first priority", () => {
  const prompt = buildObserverUserPrompt({
    projectName: "星尘计划",
    messages: [],
    candidateRoster: [
      { nickname: "张三", title: "前端负责人", topSkills: ["react", "typescript"], score: 42.5 },
      { nickname: "李四", title: null, topSkills: [], score: 10 }
    ]
  });
  assert.match(prompt, /派活候选名单/u);
  assert.match(prompt, /项目经理/u);
  assert.match(prompt, /张三/u);
  assert.match(prompt, /前端负责人/u);
  assert.match(prompt, /react、typescript/u);
  assert.match(prompt, /李四/u);
  // 分数本身不该被机械地贴在候选名单展示文本里给模型抄。
  assert.doesNotMatch(prompt, /42\.5/u);
  assert.match(prompt, /点名的必须原样用那个名字/u);
});

test("buildObserverUserPrompt caps the candidate roster and each candidate's skill list", () => {
  const roster = Array.from({ length: 12 }, (_unused, index) => ({
    nickname: `候选${index}`,
    title: null,
    topSkills: Array.from({ length: 10 }, (_unusedSkill, skillIndex) => `skill-${skillIndex}`),
    score: 12 - index
  }));
  const prompt = buildObserverUserPrompt({ projectName: "星尘计划", messages: [], candidateRoster: roster });
  assert.match(prompt, /候选0/u);
  assert.doesNotMatch(prompt, /候选8/u, "roster must be capped at 8 entries even when more are supplied");
  assert.doesNotMatch(prompt, /skill-6/u, "each candidate's skill list must be capped");
});

test("buildObserverUserPrompt caps referenced context and marks non-user senders distinctly", () => {
  const prompt = buildObserverUserPrompt({
    projectName: "星尘计划",
    messages: [
      { seq: 1, senderKind: "system", senderLabel: "系统事件", text: "张三加入了会话", createdAt: "2026-07-12T08:00:00.000Z" }
    ],
    referencedContext: Array.from({ length: 30 }, (_unused, index) => `ref-${index}`)
  });
  assert.match(prompt, /\[系统事件\]/u);
  assert.doesNotMatch(prompt, /ref-25/u);
});

test("parseObserverPlanResponse extracts a well-formed JSON plan from noisy LLM text", () => {
  const text = [
    "这是我的分析：",
    "```json",
    JSON.stringify({
      items: [
        { kind: "execute", title_md: "重写第三节", confidence: "high", suggested_assignee_nickname: "张三" },
        { kind: "decide", title_md: "下周投放预算是否砍半", confidence: "low", suggested_assignee_nickname: "阿曼" }
      ]
    }),
    "```"
  ].join("\n");

  const plan = parseObserverPlanResponse(text);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0]?.kind, "execute");
  assert.equal(plan.items[1]?.suggested_assignee_nickname, "阿曼");
  assert.deepEqual(observerPlanSchema.safeParse(plan).success, true);
});

test("parseObserverPlanResponse fails closed to an empty plan when no JSON object is present", () => {
  assert.deepEqual(parseObserverPlanResponse("我觉得没什么好拎的。"), { items: [] });
  assert.deepEqual(parseObserverPlanResponse(""), { items: [] });
});

test("parseObserverPlanResponse salvages valid items when the overall envelope is malformed", () => {
  const text = JSON.stringify({
    items: [
      { kind: "execute", title_md: "有效条目", confidence: "mid" },
      { kind: "bogus_kind", title_md: "坏条目", confidence: "mid" },
      { kind: "observe", title_md: "another valid one" } // missing confidence -> invalid
    ],
    extra_unexpected_field: true
  });
  const plan = parseObserverPlanResponse(text);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0]?.title_md, "有效条目");
});

test("parseObserverPlanResponse truncates plans exceeding the max item cap", () => {
  const items = Array.from({ length: OBSERVER_PLAN_MAX_ITEMS + 5 }, (_unused, index) => ({
    kind: "observe" as const,
    title_md: `事项 ${index}`,
    confidence: "low" as const
  }));
  const plan = parseObserverPlanResponse(JSON.stringify({ items }));
  assert.equal(plan.items.length, OBSERVER_PLAN_MAX_ITEMS);
});

test("isLowQualityObserverPlan discards empty plans and all-observe plans", () => {
  assert.equal(isLowQualityObserverPlan({ items: [] }), true);
  assert.equal(
    isLowQualityObserverPlan({
      items: [
        { kind: "observe", title_md: "只是记一笔", confidence: "low" }
      ]
    }),
    true
  );
});

test("isLowQualityObserverPlan keeps plans with at least one execute or decide item", () => {
  assert.equal(
    isLowQualityObserverPlan({
      items: [
        { kind: "observe", title_md: "顺带记一下", confidence: "low" },
        { kind: "execute", title_md: "重写第三节", confidence: "high" }
      ]
    }),
    false
  );
  assert.equal(
    isLowQualityObserverPlan({
      items: [{ kind: "decide", title_md: "预算是否砍半", confidence: "mid" }]
    }),
    false
  );
});

test("observerPlanItemSchema rejects git jargon leaking through blank/oversized titles", () => {
  assert.equal(
    observerPlanSchema.safeParse({ items: [{ kind: "execute", title_md: "", confidence: "high" }] }).success,
    false
  );
  assert.equal(
    observerPlanSchema.safeParse({
      items: [{ kind: "execute", title_md: "x".repeat(501), confidence: "high" }]
    }).success,
    false
  );
});
