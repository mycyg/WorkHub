import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_ROSTER_PROMPT_MAX,
  rankCandidates,
  scoreCandidate,
  skillTagOverlapRatio,
  type ScoreCandidateInput
} from "./assignee-scoring.js";

function input(overrides: Partial<ScoreCandidateInput> = {}): ScoreCandidateInput {
  return {
    hasProfile: false,
    hasTitle: false,
    acceptedDeliverableCount: 0,
    daysSinceLastAccepted: null,
    skillTagOverlapWithTask: 0,
    ...overrides
  };
}

// ── baseline / monotonicity ─────────────────────────────────────────────────────────

test("scoreCandidate returns exactly 0 for a completely blank candidate", () => {
  assert.equal(scoreCandidate(input()), 0);
});

test("scoreCandidate: having any profile scores strictly higher than having none, all else equal", () => {
  const withoutProfile = scoreCandidate(input());
  const withProfile = scoreCandidate(input({ hasProfile: true }));
  assert.ok(withProfile > withoutProfile);
});

test("scoreCandidate: having a title adds on top of having a profile (both are additive, not redundant)", () => {
  const profileOnly = scoreCandidate(input({ hasProfile: true }));
  const profileAndTitle = scoreCandidate(input({ hasProfile: true, hasTitle: true }));
  assert.ok(profileAndTitle > profileOnly);
  // 头衔本身没有资料完整度高的权重（是"更进一步"的补充信号，不是主力项）。
  const titleOnlyDelta = profileAndTitle - profileOnly;
  const profileOnlyDelta = profileOnly - scoreCandidate(input());
  assert.ok(titleOnlyDelta < profileOnlyDelta);
});

test("scoreCandidate: acceptedDeliverableCount is monotonically non-decreasing", () => {
  const zero = scoreCandidate(input({ acceptedDeliverableCount: 0 }));
  const one = scoreCandidate(input({ acceptedDeliverableCount: 1 }));
  const five = scoreCandidate(input({ acceptedDeliverableCount: 5 }));
  const twenty = scoreCandidate(input({ acceptedDeliverableCount: 20 }));
  assert.ok(zero < one);
  assert.ok(one < five);
  assert.ok(five < twenty);
});

test("scoreCandidate: acceptedDeliverableCount uses a log scale — diminishing marginal returns", () => {
  const delta0to1 = scoreCandidate(input({ acceptedDeliverableCount: 1 })) - scoreCandidate(input({ acceptedDeliverableCount: 0 }));
  const delta20to21 = scoreCandidate(input({ acceptedDeliverableCount: 21 })) - scoreCandidate(input({ acceptedDeliverableCount: 20 }));
  assert.ok(delta20to21 < delta0to1, "the 21st delivery must add less than the 1st (log scale, no rotation penalty, just diminishing returns)");
});

test("scoreCandidate: a veteran with 5 accepted deliveries outranks a zero-profile newcomer with none (acceptance-gate #2)", () => {
  const veteran = scoreCandidate(
    input({ hasProfile: true, hasTitle: true, acceptedDeliverableCount: 5, daysSinceLastAccepted: 10, skillTagOverlapWithTask: 0.5 })
  );
  const newcomer = scoreCandidate(input());
  assert.ok(veteran > newcomer);
});

// ── recency decay ────────────────────────────────────────────────────────────────────

test("scoreCandidate: never having delivered (null) scores neither a bonus nor a penalty from recency alone", () => {
  const neverDelivered = scoreCandidate(input({ daysSinceLastAccepted: null }));
  // 10 年前交付过一次：近期性项趋近于 0 但仍严格 > 0（指数衰减，不是从未交付的硬 0）。极端到
  // 10 万天时 0.5^(days/30) 会在双精度浮点下真的下溢成 0——用 10 年是"很久很久以前"里还没触底的量级。
  const deliveredLongAgo = scoreCandidate(input({ daysSinceLastAccepted: 3650 }));
  // 从未交付：近期性项恰好是 0。
  assert.equal(neverDelivered, 0);
  assert.ok(deliveredLongAgo > neverDelivered);
});

test("scoreCandidate: a more recent delivery scores higher than an older one, all else equal", () => {
  const recent = scoreCandidate(input({ acceptedDeliverableCount: 3, daysSinceLastAccepted: 1 }));
  const stale = scoreCandidate(input({ acceptedDeliverableCount: 3, daysSinceLastAccepted: 200 }));
  assert.ok(recent > stale);
});

test("scoreCandidate: recency decay treats a negative day count defensively as zero elapsed time", () => {
  const negative = scoreCandidate(input({ daysSinceLastAccepted: -5 }));
  const zero = scoreCandidate(input({ daysSinceLastAccepted: 0 }));
  assert.equal(negative, zero);
});

// ── skill overlap ─────────────────────────────────────────────────────────────────────

test("scoreCandidate: skillTagOverlapWithTask is monotonically non-decreasing across its range", () => {
  const none = scoreCandidate(input({ skillTagOverlapWithTask: 0 }));
  const half = scoreCandidate(input({ skillTagOverlapWithTask: 0.5 }));
  const full = scoreCandidate(input({ skillTagOverlapWithTask: 1 }));
  assert.ok(none < half);
  assert.ok(half < full);
});

test("scoreCandidate: skillTagOverlapWithTask is clamped into [0, 1] even for out-of-range inputs", () => {
  const overOne = scoreCandidate(input({ skillTagOverlapWithTask: 5 }));
  const atOne = scoreCandidate(input({ skillTagOverlapWithTask: 1 }));
  assert.equal(overOne, atOne);
  const belowZero = scoreCandidate(input({ skillTagOverlapWithTask: -2 }));
  const atZero = scoreCandidate(input({ skillTagOverlapWithTask: 0 }));
  assert.equal(belowZero, atZero);
});

test("scoreCandidate: NaN/Infinity inputs degrade to their safe defaults instead of poisoning the sum", () => {
  assert.equal(Number.isFinite(scoreCandidate(input({ acceptedDeliverableCount: Number.NaN }))), true);
  assert.equal(Number.isFinite(scoreCandidate(input({ skillTagOverlapWithTask: Number.NaN }))), true);
  assert.equal(scoreCandidate(input({ acceptedDeliverableCount: Number.NaN })), scoreCandidate(input({ acceptedDeliverableCount: 0 })));
});

// ── skillTagOverlapRatio ──────────────────────────────────────────────────────────────

test("skillTagOverlapRatio: no candidate tags is zero overlap, not full overlap", () => {
  assert.equal(skillTagOverlapRatio([], "写一份关于 react 的技术方案"), 0);
});

test("skillTagOverlapRatio: counts case-insensitive substring matches against the task text", () => {
  assert.equal(skillTagOverlapRatio(["React", "TypeScript"], "帮忙写一版 react 前端方案"), 0.5);
  assert.equal(skillTagOverlapRatio(["react", "typescript"], "帮忙用 React 和 TypeScript 重构一下"), 1);
  assert.equal(skillTagOverlapRatio(["go", "rust"], "帮忙写一版 react 前端方案"), 0);
});

test("skillTagOverlapRatio: blank tags are ignored rather than counted as unmatched", () => {
  assert.equal(skillTagOverlapRatio(["  ", "react"], "react 前端方案"), 1);
});

// ── rankCandidates ────────────────────────────────────────────────────────────────────

test("rankCandidates sorts by score descending without mutating the input array", () => {
  const input1 = [
    { userId: "a", nickname: "甲", title: null, score: 1 },
    { userId: "b", nickname: "乙", title: null, score: 9 },
    { userId: "c", nickname: "丙", title: null, score: 5 }
  ];
  const ranked = rankCandidates(input1);
  assert.deepEqual(ranked.map((c) => c.userId), ["b", "c", "a"]);
  assert.deepEqual(input1.map((c) => c.userId), ["a", "b", "c"], "must not mutate the caller's array");
});

test("CANDIDATE_ROSTER_PROMPT_MAX caps the roster shown to the LLM at a small, bounded number (04 iron rule #4)", () => {
  assert.ok(CANDIDATE_ROSTER_PROMPT_MAX >= 5 && CANDIDATE_ROSTER_PROMPT_MAX <= 8);
});
