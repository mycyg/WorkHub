import assert from "node:assert/strict";
import test from "node:test";

import { collectFileHits } from "./check-copy-terms.ts";

const DICT = "apps/desktop-webview/src/spotlight/locales.ts";
const CODE = "apps/desktop-webview/src/spotlight/controller.ts";

/** 把一段词典源码扫出来的命中归一成「文案片段」列表，便于逐条断言。 */
function hitTexts(file: string, source: string): string[] {
  return collectFileHits(file, source).map((hit) => hit.text.split(" | ").slice(1).join(" | "));
}

/** 造一行词典条目。 */
function entry(value: string): string {
  return `const zh = {\n  key: ${JSON.stringify(value)}\n};\n`;
}

test("干净文案不报", () => {
  assert.deepEqual(hitTexts(DICT, entry("正在加载改动…")), []);
  assert.deepEqual(hitTexts(DICT, entry("Loading changes…")), []);
});

// —— R26 A1 审查补的中文侧规则：每条一个会红的用例 —— //
const ZH_CASES: ReadonlyArray<{ readonly why: string; readonly copy: string }> = [
  { why: "解释型开头（纪律第 5 条）", copy: "本页面用于展示项目进度" },
  { why: "在解说界面自己", copy: "界面只显示工具调用和当前状态。" },
  { why: "非最终态 / 路线图", copy: "即将上线，敬请期待" },
  { why: "开发运行方式泄漏", copy: "这个预览环境打不开工作台窗口。" },
  { why: "团队内部视角", copy: "把下面这段原样发给开发。" },
  { why: "内部设计代号", copy: "打开聚焦盒" },
  { why: "内部结构名（中英混排）", copy: "变动 = 提议 manifest 的变更集" },
  { why: "内部实体名（中英混排）", copy: "按能力细分：建任务 / 派 run / 动网盘" },
  { why: "数据库词", copy: "物化到时间线" },
  { why: "开发口里的 fetch/pull", copy: "改动没拉到" },
  { why: "接口字段名直出", copy: "冲突选项缺少必要参数" },
  { why: "后台子系统名", copy: "后台调度器当前未启用。" },
  { why: "能力协商实现词", copy: "Cuu 当前缺少启动 AI 执行的客户端能力。" },
  { why: "功能开关内部状态", copy: "实验锁定" },
  { why: "设计理由泄漏", copy: "还有 3 条未显示（可能是列表截断或权限过滤）。" },
  { why: "agent-run 的连字符写法（旧正则只认下划线与驼峰）", copy: "所有 Cuu 对话与 agent-run 都会读到这段指令" }
];

for (const { why, copy } of ZH_CASES) {
  test(`中文禁词：${why}`, () => {
    // 中英两张表都可能逮到同一句（词典文件两张表都跑），所以断言「被逮到」而不是「只逮到一次」。
    assert.ok(hitTexts(DICT, entry(copy)).includes(copy), copy);
  });
}

// —— 纯英文字面量：旧实现的汉字前置过滤把这些整片放过 —— //
const EN_CASES: ReadonlyArray<{ readonly why: string; readonly copy: string }> = [
  { why: "trace", copy: "Run trace" },
  { why: "curation / eval budget", copy: "Curation budget" },
  { why: "diff / manifest / daemon", copy: "Open a file for the line-by-line diff." },
  { why: "路线图语言", copy: "Coming soon" },
  { why: "开发运行方式", copy: "This preview can't open a native window." },
  { why: "接口字段名", copy: "Scope ID" },
  { why: "内部实体名", copy: "Showing first 100 child runs" },
  { why: "数据库词", copy: "Materialize to timeline" },
  { why: "后台子系统名", copy: "The background scheduler is currently disabled." },
  { why: "通道实现词", copy: "Cuu is missing the client capability to start a run." },
  { why: "功能开关内部状态", copy: "Experiment locked" },
  { why: "枚举字面 / 工程词", copy: "PM mode" },
  { why: "脚手架语言", copy: "Demo data" }
];

for (const { why, copy } of EN_CASES) {
  test(`英文禁词：${why}`, () => {
    assert.ok(hitTexts(DICT, entry(copy)).includes(copy), copy);
  });
}

test("英文禁词只在词典文件上跑：普通产品文件里的接口路径不误伤", () => {
  const source = 'const path = "/api/agent-runs/" + id + "/revert";\nconst sel = "[data-diff-row]";\n';
  assert.deepEqual(hitTexts(CODE, source), []);
  // 同一段代码放进词典文件才会被英文表逮到——那里除了 key 与 import 之外都是文案。
  assert.ok(hitTexts(DICT, source).length > 0);
});

test("词典的 key、类型字面量与 import 不是文案，不参与英文扫描", () => {
  const source = [
    'import { cuuT } from "./i18n.js";',
    'export type Key = "agentRun.doneTitle" | "budget.scope.curation";',
    "const zh = {",
    '  "agentRun.doneTitle": "这次执行完成了",',
    '  "budget.scope.curation": "AI 自学预算"',
    "};"
  ].join("\n");
  assert.deepEqual(hitTexts(DICT, source), []);
});

test("行内 term-allow 豁免对中英两张表都生效", () => {
  const source = 'const zh = {\n  key: "Run trace" // term-allow：单测用例\n};\n';
  assert.deepEqual(hitTexts(DICT, source), []);
});

test("同一条文案同时命中两张表时逐条报出，且按位置排序", () => {
  const source = 'const zh = {\n  a: "AI 改动的 diff、审阅与合并"\n};\n';
  const hits = collectFileHits(DICT, source);
  assert.equal(hits.length, 2, "中文表的「内部结构名」与英文表的 diff 各报一次");
  assert.ok(hits.every((hit) => hit.line === 2));
});
