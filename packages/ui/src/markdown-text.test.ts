import assert from "node:assert/strict";
import test from "node:test";

import { stripMarkdownMarkers } from "./markdown-text.js";

// R27（真机走查）：提议摘要里的 `24-48 小时` 渲成了 `24 48 小时`。这层此前把 `-` 和其它标记符
// 塞进同一个字符类无差别替换，数字区间/连字词跟着遭殃。
test("数字区间与连字词里的连字符原样保留", () => {
  assert.equal(stripMarkdownMarkers("预计 24-48 小时内完成。"), "预计 24-48 小时内完成。");
  assert.equal(stripMarkdownMarkers("给 e-mail 里的 2026-09-06 那版加一节。"), "给 e-mail 里的 2026-09-06 那版加一节。");
  assert.equal(stripMarkdownMarkers("室外 -5 度也要跑。"), "室外 -5 度也要跑。");
});

test("行首列表符、引用符与分隔线仍旧被抹平", () => {
  assert.equal(stripMarkdownMarkers("- 第一条\n- 第二条"), "第一条 第二条");
  assert.equal(stripMarkdownMarkers("* 甲\n+ 乙\n> 丙"), "甲 乙 丙");
  assert.equal(stripMarkdownMarkers("上半段\n---\n下半段"), "上半段 下半段");
});

test("行内标记符照旧压掉，首尾空白与连续空白收敛", () => {
  assert.equal(stripMarkdownMarkers("  ## 标题 **重点** `代码` _强调_  "), "标题 重点 代码 强调");
  assert.equal(stripMarkdownMarkers(undefined), "");
  assert.equal(stripMarkdownMarkers(""), "");
});
