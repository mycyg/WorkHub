import assert from "node:assert/strict";
import test from "node:test";

import {
  MINIMUM_LOCALE_OWNER_SOURCES,
  MINIMUM_SOURCES,
  buildBaseline,
  collectCopyLiterals,
  copyTermScanTargets,
  diffAgainstBaseline,
  discoverProductSources,
  findCjkCopyLiterals,
  isLocaleOwnerFile,
  isProductSourcePath,
  normalizeSnippet
} from "./check-ui-i18n.ts";

test("词典文件可以拥有中文文案", () => {
  const dictionary = `export const zh = { save: "保存", cancel: "取消" };\n`;
  for (const file of [
    "packages/ui/src/locales.ts",
    "packages/ui/src/i18n.ts",
    "packages/cuu/src/i18n.cards.ts",
    "apps/web/src/locales/dashboard.ts",
    "apps/desktop-webview/src/connection-banner-copy.ts"
  ]) {
    assert.equal(isLocaleOwnerFile(file), true, file);
    assert.deepEqual(findCjkCopyLiterals(file, dictionary), []);
  }
});

test("普通产品文件里的中文字符串字面量算违规", () => {
  const source = `export function render(): string {\n  return "保存草稿";\n}\n`;
  const violations = findCjkCopyLiterals("apps/web/src/routes.ts", source);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.text, "保存草稿");
  assert.equal(violations[0]?.line, 2);
  assert.equal(violations[0]?.kind, "字符串字面量");
});

test("两种模板字面量都算，插值不影响判定", () => {
  const source = [
    "const plain = `一共两条`;",
    "const woven = `共 ${count} 条待办`;",
    "const ascii = `nothing here`;"
  ].join("\n");
  const violations = findCjkCopyLiterals("apps/web/src/routes.ts", source);
  assert.deepEqual(
    violations.map((violation) => violation.kind),
    ["模板字面量", "带插值的模板字面量"]
  );
  assert.equal(violations[1]?.text, "共 条待办");
});

test("注释与正则里的中文不算", () => {
  const source = [
    "// 这是一句中文注释",
    "/** 文档注释里的中文也不算 */",
    "const hasHan = /[一-鿿]/u.test(input);",
    "const ok = \"plain ascii\";"
  ].join("\n");
  assert.deepEqual(findCjkCopyLiterals("apps/web/src/routes.ts", source), []);
});

test("行内 ui-i18n-allow 豁免只作用于本行", () => {
  const source = [
    'const prompt = "请用中文总结"; // ui-i18n-allow：这是喂给模型的提示词，不是界面文案',
    'const label = "总结";'
  ].join("\n");
  const violations = findCjkCopyLiterals("packages/agent/src/turns/prompt.ts", source);
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.line, 2);
  assert.equal(violations[0]?.text, "总结");
});

test("归一化片段折叠空白并截断，故基线不随排版漂移", () => {
  assert.equal(normalizeSnippet("  保存\n   草稿  "), "保存 草稿");
  const long = "重".repeat(200);
  assert.equal(normalizeSnippet(long).length, 80);
  assert.ok(normalizeSnippet(long).endsWith("..."));
});

test("基线内的条目不报错，超出次数的才报错", () => {
  const violations = findCjkCopyLiterals(
    "apps/web/src/routes.ts",
    ['const a = "保存";', 'const b = "保存";', 'const c = "删除";'].join("\n")
  );
  assert.equal(violations.length, 3);

  const exact = diffAgainstBaseline(violations, {
    note: "",
    entries: { "apps/web/src/routes.ts": { 保存: 2, 删除: 1 } }
  });
  assert.deepEqual(exact.added, []);
  assert.deepEqual(exact.stale, []);

  const short = diffAgainstBaseline(violations, {
    note: "",
    entries: { "apps/web/src/routes.ts": { 保存: 1 } }
  });
  assert.deepEqual(
    short.added.map((violation) => violation.text),
    ["保存", "删除"]
  );
});

test("基线里已消失的条目被标为待删除，且只针对本次扫过的文件", () => {
  const baseline = {
    note: "",
    entries: {
      "apps/web/src/routes.ts": { 保存: 1 },
      "apps/web/src/browser.ts": { 关闭: 3 }
    }
  };
  const all = diffAgainstBaseline([], baseline);
  assert.deepEqual(all.stale, [
    { file: "apps/web/src/browser.ts", text: "关闭", remaining: 3 },
    { file: "apps/web/src/routes.ts", text: "保存", remaining: 1 }
  ]);

  const partial = diffAgainstBaseline([], baseline, new Set(["apps/web/src/routes.ts"]));
  assert.deepEqual(partial.stale, [{ file: "apps/web/src/routes.ts", text: "保存", remaining: 1 }]);
});

test("buildBaseline 按文件与片段排序并计数", () => {
  const baseline = buildBaseline([
    { file: "b.ts", line: 1, column: 1, text: "乙", kind: "字符串字面量" },
    { file: "a.ts", line: 2, column: 1, text: "甲", kind: "字符串字面量" },
    { file: "a.ts", line: 3, column: 1, text: "甲", kind: "字符串字面量" }
  ]);
  assert.deepEqual(Object.keys(baseline.entries), ["a.ts", "b.ts"]);
  assert.deepEqual(baseline.entries["a.ts"], { 甲: 2 });
});

test("扫描范围谓词排除测试、夹具、QA 与非产品路径", () => {
  assert.equal(isProductSourcePath("apps/web/src/routes.ts"), true);
  assert.equal(isProductSourcePath("packages/ui/src/gold-path/render.ts"), true);
  assert.equal(isProductSourcePath("apps/web/src/routes.test.ts"), false);
  assert.equal(isProductSourcePath("packages/contracts/src/types.d.ts"), false);
  assert.equal(isProductSourcePath("apps/api/src/qa/r1-pg-smoke.ts"), false);
  assert.equal(isProductSourcePath("packages/agent/src/fixtures/run.ts"), false);
  assert.equal(isProductSourcePath("scripts/dev/check-ui-i18n.ts"), false);
  assert.equal(isProductSourcePath("apps/web/vite.config.ts"), false);
  assert.equal(isProductSourcePath("reference/deepseek-harness/packages/x/src/a.ts"), false);
});

test("真实仓库发现结果满足失效保险丝下限", () => {
  const sources = discoverProductSources();
  assert.ok(
    sources.length >= MINIMUM_SOURCES,
    `发现 ${sources.length} 个产品源文件，低于下限 ${MINIMUM_SOURCES}`
  );
  const owners = sources.filter(isLocaleOwnerFile);
  assert.ok(
    owners.length >= MINIMUM_LOCALE_OWNER_SOURCES,
    `发现 ${owners.length} 个词典文件，低于下限 ${MINIMUM_LOCALE_OWNER_SOURCES}`
  );
});

test("禁词门的扫描目标覆盖词典与基线里仍含文案的文件", () => {
  const targets = copyTermScanTargets();
  assert.ok(targets.includes("packages/ui/src/i18n.ts"));
  assert.ok(targets.includes("packages/cuu/src/i18n.ts"));
  assert.ok(targets.length > 20, `禁词门目标只有 ${targets.length} 个，疑似发现逻辑失效`);
  assert.deepEqual(targets, [...targets].sort());
});

test("collectCopyLiterals 收纯英文文案，但放过 key / 类型 / import 这些标识符位置", () => {
  const source = [
    'import { cuuT } from "./i18n.js";',
    'export type Key = "budget.scope.curation";',
    "const en = {",
    '  "budget.scope.curation": "Curation budget",',
    "  runTrace: `Run trace`",
    "};",
    'const path = table["budget.scope.curation"];'
  ].join("\n");
  assert.deepEqual(
    collectCopyLiterals("packages/cuu/src/i18n.ts", source).map((literal) => literal.text),
    ["Curation budget", "Run trace"]
  );
});

test("collectCopyLiterals 与 findCjkCopyLiterals 的分工：前者不看汉字，后者只看汉字", () => {
  const source = 'const a = "Run trace";\nconst b = "运行时间线";\n';
  assert.deepEqual(
    collectCopyLiterals("packages/ui/src/i18n.ts", source).map((literal) => literal.text),
    ["Run trace", "运行时间线"]
  );
  assert.deepEqual(findCjkCopyLiterals("apps/web/src/routes.ts", source).map((literal) => literal.text), ["运行时间线"]);
});
