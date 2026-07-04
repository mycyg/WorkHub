import assert from "node:assert/strict";
import test from "node:test";

import type { BudgetScope } from "@workhub/cost";

import { createBudgetReservationRepository } from "./repositories/budget-reservations.js";
import { budgetReservations } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "00000000-0000-4000-8000-000000000002";
const runId = "40000000-0000-4000-8000-000000000001";
const leaseExpiresAt = new Date("2026-07-04T00:05:00.000Z");
const teamScope: BudgetScope = { kind: "team", teamId: workspaceId };
const sharedScopeId = "shared-team";

function scopeInput() {
  return {
    scope: teamScope,
    scopeKind: "team" as const,
    scopeId: workspaceId,
    period: "day" as const,
    periodBucket: "2026-07-04",
    capTokens: 100000,
    capCostCny: "10",
    committedTokens: 0,
    committedCostCny: "0",
    estTokens: 1000,
    estCostCny: "0.1"
  };
}

function reservationRow(over: Partial<typeof budgetReservations.$inferSelect> = {}): typeof budgetReservations.$inferSelect {
  return {
    id: "40000000-0000-4000-8000-000000000101",
    runId,
    workspaceId,
    scopeKind: "team",
    scopeId: sharedScopeId,
    period: "day",
    periodBucket: "2026-07-04",
    estTokens: 1000,
    estCostCny: "1",
    actualTokens: 0,
    actualCostCny: "0",
    status: "active",
    leaseExpiresAt,
    createdAt: new Date("2026-07-04T00:00:00.000Z"),
    updatedAt: new Date("2026-07-04T00:00:00.000Z"),
    ...over
  };
}

function outstandingKey(workspace: string) {
  return `${workspace}:team:${sharedScopeId}:2026-07-04`;
}

test("R9.7 budget reservation reserve is bounded by workspace", async () => {
  const { db, queries } = createQueryRecorder([[], [], []]);
  const repository = createBudgetReservationRepository(db);

  await repository.reserve({
    workspaceId,
    runId,
    leaseExpiresAt,
    scopes: [scopeInput()]
  } as Parameters<typeof repository.reserve>[0] & { workspaceId: string });

  const select = queries.find((query) => query.operation === "select");
  assert.ok(queryReferences(select?.where, budgetReservations.workspaceId));
  assert.ok(queryParamValues(select?.where).includes(workspaceId));
  const insert = queries.find((query) => query.operation === "insert");
  const inserted = insert?.valuesValue as Array<Record<string, unknown>> | undefined;
  assert.equal(inserted?.[0]?.["workspaceId"], workspaceId);
});

test("R9.7 budget reservation outstanding reads are bounded by workspace", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createBudgetReservationRepository(db);

  await repository.outstandingForScopes([
    {
      workspaceId,
      scopeKind: "team",
      scopeId: workspaceId,
      periodBucket: "2026-07-04"
    }
  ] as Parameters<typeof repository.outstandingForScopes>[0] & Array<{ workspaceId: string }>);

  const select = queries[0];
  assert.equal(select?.operation, "select");
  assert.ok(queryReferences(select?.where, budgetReservations.workspaceId));
  assert.ok(queryParamValues(select?.where).includes(workspaceId));
});

test("R9.7 budget reservation outstanding totals do not cross-count same scope ids across workspaces", async () => {
  const { db } = createQueryRecorder([[
    reservationRow({ workspaceId, estTokens: 1000, estCostCny: "1" }),
    reservationRow({
      id: "40000000-0000-4000-8000-000000000102",
      runId: "40000000-0000-4000-8000-000000000002",
      workspaceId: otherWorkspaceId,
      estTokens: 2500,
      estCostCny: "2.5"
    })
  ]]);
  const repository = createBudgetReservationRepository(db);

  const totals = await repository.outstandingForScopes([
    { workspaceId, scopeKind: "team", scopeId: sharedScopeId, periodBucket: "2026-07-04" },
    { workspaceId: otherWorkspaceId, scopeKind: "team", scopeId: sharedScopeId, periodBucket: "2026-07-04" }
  ]);

  assert.deepEqual(totals.get(outstandingKey(workspaceId)), { tokens: 1000, costCny: "1" });
  assert.deepEqual(totals.get(outstandingKey(otherWorkspaceId)), { tokens: 2500, costCny: "2.5" });
});
