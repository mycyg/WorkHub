import assert from "node:assert/strict";
import test from "node:test";

import { decideReservation, outstandingForBucket, type ReservationRow, type ReservationScopeCheck } from "./reservation.js";

const teamKey = { scopeKind: "team" as const, scopeId: "team-1", periodBucket: "2026-06-18" };

function row(over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    scopeKind: "team",
    scopeId: "team-1",
    periodBucket: "2026-06-18",
    estTokens: 1000,
    estCostCny: "1",
    actualTokens: 0,
    actualCostCny: "0",
    status: "active",
    ...over
  };
}

test("outstandingForBucket sums est-actual over matching active rows only", () => {
  const rows: ReservationRow[] = [
    row({ estTokens: 1000, actualTokens: 200, estCostCny: "1", actualCostCny: "0.2" }),
    row({ estTokens: 500, actualTokens: 0, estCostCny: "0.5", actualCostCny: "0" }),
    row({ status: "settled", estTokens: 9999, estCostCny: "99" }), // 已结算不计
    row({ status: "expired", estTokens: 8888, estCostCny: "88" }), // 已过期不计
    row({ scopeId: "team-2", estTokens: 7777, estCostCny: "77" }) // 别的 scope 不计
  ];
  const out = outstandingForBucket(rows, teamKey);
  assert.equal(out.tokens, 800 + 500); // (1000-200) + (500-0)
  assert.equal(out.costCny, "1.3"); // (1-0.2) + (0.5-0)
});

test("outstandingForBucket floors a row whose actual exceeds its estimate at 0 (no negative refund)", () => {
  const rows: ReservationRow[] = [row({ estTokens: 100, actualTokens: 400, estCostCny: "0.1", actualCostCny: "0.4" })];
  const out = outstandingForBucket(rows, teamKey);
  assert.equal(out.tokens, 0);
  assert.equal(out.costCny, "0");
});

function check(over: Partial<ReservationScopeCheck> = {}): ReservationScopeCheck {
  return {
    scope: { kind: "team", teamId: "team-1" },
    capTokens: 10000,
    capCostCny: "10",
    committedTokens: 0,
    committedCostCny: "0",
    outstandingTokens: 0,
    outstandingCostCny: "0",
    estTokens: 1000,
    estCostCny: "1",
    ...over
  };
}

test("decideReservation allows when committed+outstanding+estimate fits both dimensions", () => {
  const decision = decideReservation([check({ committedTokens: 5000, outstandingTokens: 3000, estTokens: 1000 })]);
  assert.equal(decision.allowed, true);
});

test("decideReservation allows exactly at the cap boundary (<=, not <)", () => {
  const decision = decideReservation([
    check({ capTokens: 10000, committedTokens: 6000, outstandingTokens: 3000, estTokens: 1000, capCostCny: "10", committedCostCny: "6", outstandingCostCny: "3", estCostCny: "1" })
  ]);
  assert.equal(decision.allowed, true);
});

test("decideReservation denies on tokens with the limiting scope", () => {
  const decision = decideReservation([check({ committedTokens: 9000, outstandingTokens: 1000, estTokens: 1, capTokens: 10000 })]);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.limit, "tokens");
    assert.deepEqual(decision.limitingScope, { kind: "team", teamId: "team-1" });
  }
});

test("decideReservation denies on cost when tokens fit", () => {
  const decision = decideReservation([
    check({ capTokens: 1_000_000, estTokens: 1, capCostCny: "5", committedCostCny: "4.5", outstandingCostCny: "0.4", estCostCny: "0.2" })
  ]);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.limit, "cost");
  }
});

test("decideReservation treats cap<=0 as no-limit for that dimension", () => {
  // capTokens 0 → tokens 维不设限；只看 cost。
  const decision = decideReservation([
    check({ capTokens: 0, committedTokens: 999999, estTokens: 999999, capCostCny: "10", committedCostCny: "1", estCostCny: "1" })
  ]);
  assert.equal(decision.allowed, true);
});

test("decideReservation cost comparison is float-safe at the boundary (0.1+0.2 not > 0.3)", () => {
  // committed 0.1 + outstanding 0.2 + est 0 = 0.3 == cap 0.3 → 允许（朴素 Number 加法会 0.30000000000000004>0.3 误拒）。
  const decision = decideReservation([
    check({ capTokens: 0, capCostCny: "0.3", committedCostCny: "0.1", outstandingCostCny: "0.2", estCostCny: "0" })
  ]);
  assert.equal(decision.allowed, true);
});

test("decideReservation denies at the first limiting scope among several", () => {
  const userScope = { kind: "user" as const, userId: "u-1" };
  const teamScope = { kind: "team" as const, teamId: "team-1" };
  const decision = decideReservation([
    check({ scope: userScope, capTokens: 100000, estTokens: 1 }), // fits
    check({ scope: teamScope, capTokens: 1000, committedTokens: 1000, estTokens: 1 }) // breaches
  ]);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.deepEqual(decision.limitingScope, teamScope);
  }
});
