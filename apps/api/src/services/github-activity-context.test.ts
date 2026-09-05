import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRepoActivityLines,
  REPO_ACTIVITY_FETCH_LIMIT,
  type GithubActivityContextRow
} from "./github-activity-context.js";

const now = new Date("2026-07-14T03:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function row(overrides: Partial<GithubActivityContextRow> = {}): GithubActivityContextRow {
  return {
    kind: "commit",
    title: "修好了支付回调",
    occurredAt: daysAgo(1),
    state: null,
    authorLogin: null,
    ...overrides
  };
}

test("buildRepoActivityLines renders each kind with a human relative day label", () => {
  const lines = buildRepoActivityLines(
    [
      row({ kind: "commit", title: "修好了支付回调", occurredAt: now }),
      row({ kind: "pull_request", title: "支付重构", occurredAt: daysAgo(1), state: "merged", authorLogin: "amy" }),
      row({ kind: "issue", title: "回调偶发超时", occurredAt: daysAgo(3), state: "open" })
    ],
    { now }
  );

  assert.deepEqual(lines, [
    "提交 · 今天：修好了支付回调",
    "合并请求 · 昨天：支付重构（merged） · amy",
    "议题 · 3 天前：回调偶发超时（open）"
  ]);
});

test("buildRepoActivityLines drops anything older than the window", () => {
  const lines = buildRepoActivityLines(
    [row({ occurredAt: daysAgo(2) }), row({ title: "很久以前", occurredAt: daysAgo(30) })],
    { now, windowDays: 7 }
  );

  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0]!, /很久以前/u);
});

test("buildRepoActivityLines caps each kind independently so a busy repo cannot flood the prompt", () => {
  const commits = Array.from({ length: 40 }, (_, index) =>
    row({ kind: "commit" as const, title: `提交 ${index}`, occurredAt: daysAgo(index % 6) })
  );
  const pulls = Array.from({ length: 40 }, (_, index) =>
    row({ kind: "pull_request" as const, title: `合并 ${index}`, occurredAt: daysAgo(index % 6) })
  );

  const lines = buildRepoActivityLines([...commits, ...pulls], { now, perKindLimit: 3 });

  assert.equal(lines.length, 6, "3 commits + 3 pull requests, hard capped per kind");
  assert.equal(lines.filter((line) => line.startsWith("提交")).length, 3);
  assert.equal(lines.filter((line) => line.startsWith("合并请求")).length, 3);
});

test("buildRepoActivityLines takes the newest rows per kind regardless of input order", () => {
  const lines = buildRepoActivityLines(
    [
      row({ title: "旧的", occurredAt: daysAgo(5) }),
      row({ title: "最新的", occurredAt: daysAgo(0) }),
      row({ title: "中间的", occurredAt: daysAgo(2) })
    ],
    { now, perKindLimit: 2 }
  );

  assert.deepEqual(lines, ["提交 · 今天：最新的", "提交 · 2 天前：中间的"]);
});

test("buildRepoActivityLines truncates long titles and normalizes whitespace", () => {
  const [line] = buildRepoActivityLines(
    [row({ title: `${"很长的标题".repeat(60)}\n第二行` })],
    { now, titleMaxChars: 20 }
  );

  assert.ok(line);
  assert.ok(line.length < 60, `expected a truncated line, got ${line.length} chars`);
  assert.match(line, /…$/u);
  assert.doesNotMatch(line, /\n/u);
});

test("buildRepoActivityLines never renders an empty state suffix for commits", () => {
  const [line] = buildRepoActivityLines([row({ kind: "commit", state: "" })], { now });

  assert.equal(line, "提交 · 昨天：修好了支付回调");
});

test("buildRepoActivityLines returns an empty list rather than a placeholder line when there is nothing", () => {
  assert.deepEqual(buildRepoActivityLines([], { now }), []);
});

test("REPO_ACTIVITY_FETCH_LIMIT stays a small constant so the query can never grow unbounded", () => {
  assert.ok(REPO_ACTIVITY_FETCH_LIMIT > 0 && REPO_ACTIVITY_FETCH_LIMIT <= 50);
});
