import assert from "node:assert/strict";
import test from "node:test";

import {
  assignPublicToolNames,
  isMcpToolId,
  isValidMcpServerName,
  MCP_TOOL_ID_MAX_CHARS,
  mcpServerNameRiskTokens,
  mcpToolIdTokens,
  mcpToolNameBudget,
  mcpToolNameFingerprint,
  publicToolName,
  sanitizeMcpNameSegment
} from "./names.js";

test("干净且够短的名字原样保留，不挂指纹", () => {
  assert.equal(publicToolName("gh", "create_issue"), "mcp__gh__create_issue");
  assert.equal(publicToolName("fs", "read-file"), "mcp__fs__read-file");
});

test("非法字符压成下划线之后必须挂指纹——否则两个不同工具会坍缩成一个名字", () => {
  const dotted = publicToolName("fs", "read.text.file");
  const underscored = publicToolName("fs", "read_text_file");
  assert.match(dotted, /^mcp__fs__read_text_file_[0-9a-f]{12}$/u);
  assert.equal(underscored, "mcp__fs__read_text_file");
  assert.notEqual(dotted, underscored);
});

test("两个不同身份永不坍缩（压缩前不同 → 压缩后同形也要靠指纹分开）", () => {
  const a = publicToolName("fs", "a.b");
  const b = publicToolName("fs", "a b");
  const c = publicToolName("fs", "a/b");
  assert.equal(new Set([a, b, c]).size, 3);
});

test("服务器名与工具名的边界不会串味（`a_b` + `c` 与 `a` + `b_c` 指纹不同）", () => {
  assert.notEqual(mcpToolNameFingerprint("a_b", "c"), mcpToolNameFingerprint("a", "b_c"));
});

test("超长名字截断并挂指纹，结果永远不超过上限", () => {
  const raw = "create_pull_request_review_comment_with_a_very_long_suffix_indeed";
  const id = publicToolName("github", raw);
  assert.equal(id.length <= MCP_TOOL_ID_MAX_CHARS, true, id);
  assert.match(id, /_[0-9a-f]{12}$/u);
  assert.equal(id.startsWith("mcp__github__create_pull_request"), true);
});

test("长度边界：正好压线不挂指纹，多一个字符就挂", () => {
  const head = "mcp__gh__".length;
  const exact = "x".repeat(MCP_TOOL_ID_MAX_CHARS - head);
  assert.equal(publicToolName("gh", exact).length, MCP_TOOL_ID_MAX_CHARS);
  assert.equal(publicToolName("gh", exact).endsWith(exact), true);
  const oneMore = `${exact}y`;
  assert.match(publicToolName("gh", oneMore), /_[0-9a-f]{12}$/u);
  assert.equal(publicToolName("gh", oneMore).length <= MCP_TOOL_ID_MAX_CHARS, true);
});

test("服务器名本身超长（治理层没拦住时）也要夹回上限内", () => {
  const id = publicToolName("s".repeat(80), "read");
  assert.equal(id.length <= MCP_TOOL_ID_MAX_CHARS, true, id);
  assert.match(id, /_[0-9a-f]{12}$/u);
});

test("同样的输入永远得到同样的名字", () => {
  assert.equal(publicToolName("gh", "a.b"), publicToolName("gh", "a.b"));
  assert.equal(mcpToolNameFingerprint("gh", "a.b"), mcpToolNameFingerprint("gh", "a.b"));
});

test("空的名字段直接抛错，不产出一个没有工具名的公开名", () => {
  assert.throws(() => publicToolName("gh", ""), /must not be empty/u);
  assert.throws(() => publicToolName("", "read"), /must not be empty/u);
});

test("服务器名形状：1 到 32 个 [A-Za-z0-9_-]", () => {
  assert.equal(isValidMcpServerName("a"), true);
  assert.equal(isValidMcpServerName("A_b-9"), true);
  assert.equal(isValidMcpServerName("x".repeat(32)), true);
  assert.equal(isValidMcpServerName("x".repeat(33)), false);
  assert.equal(isValidMcpServerName(""), false);
  assert.equal(isValidMcpServerName("has.dot"), false);
  assert.equal(isValidMcpServerName("has space"), false);
});

test("压缩只动非法字符", () => {
  assert.equal(sanitizeMcpNameSegment("read_text-file9"), "read_text-file9");
  assert.equal(sanitizeMcpNameSegment("a.b/c:d"), "a_b_c_d");
});

test("MCP 名字空间与内置工具不相交", () => {
  assert.equal(isMcpToolId(publicToolName("gh", "read")), true);
  for (const builtin of ["read_file", "write_file", "run_command", "load_skill", "submit"]) {
    assert.equal(isMcpToolId(builtin), false, builtin);
  }
});

test("整份清单分名：正常一一对应", () => {
  const assignment = assignPublicToolNames("gh", ["create_issue", "list_issues"]);
  assert.equal(assignment.ok, true);
  assert.deepEqual(assignment.ok ? assignment.names.map((entry) => entry.toolId) : [], [
    "mcp__gh__create_issue",
    "mcp__gh__list_issues"
  ]);
});

test("整份清单分名：raw 名重复即整份无效，不静默取第一个", () => {
  const assignment = assignPublicToolNames("gh", ["search", "search"]);
  assert.equal(assignment.ok, false);
  assert.equal(assignment.ok === false ? assignment.reason : "", "duplicate_raw_name");
});

test("整份清单分名：压缩后同形的两个名字仍然各自有名，不触发坍缩", () => {
  const assignment = assignPublicToolNames("fs", ["read.text", "read_text"]);
  assert.equal(assignment.ok, true);
  const ids = assignment.ok ? assignment.names.map((entry) => entry.toolId) : [];
  assert.equal(new Set(ids).size, 2);
});

test("名字预算：`mcp__` + 服务器名 + `__` 之后还剩多少", () => {
  const budget = mcpToolNameBudget("gh");
  assert.equal(budget.prefix, "mcp__gh__");
  assert.equal(budget.maxToolNameChars, MCP_TOOL_ID_MAX_CHARS - "mcp__gh__".length);
  assert.equal(budget.maxToolNameCharsWithFingerprint, budget.maxToolNameChars - 13);
  const longest = mcpToolNameBudget("s".repeat(32));
  assert.equal(longest.prefix.length, 39);
  assert.equal(longest.maxToolNameChars, 25);
});

test("工具 id 分词与人工保留门同口径——服务器名的词也在里面", () => {
  assert.deepEqual(mcpToolIdTokens("mcp__stripe__create_payment"), ["mcp", "stripe", "create", "payment"]);
  assert.deepEqual(mcpToolIdTokens("mcp__gh__createPullRequest"), ["mcp", "gh", "create", "pull", "request"]);
});

test("服务器名里的高风险词会被预告出来（词表由调用方传，本包不留副本）", () => {
  const financeTokens = ["finance", "payment", "invoice"];
  assert.deepEqual(mcpServerNameRiskTokens("finance", financeTokens), ["finance"]);
  assert.deepEqual(mcpServerNameRiskTokens("gh", financeTokens), []);
});
