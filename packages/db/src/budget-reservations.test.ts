import assert from "node:assert/strict";
import test from "node:test";

import type { BudgetScope } from "@workhub/cost";

import { createBudgetReservationRepository } from "./repositories/budget-reservations.js";
import { budgetReservations } from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences } from "./test-query-recorder.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const runId = "40000000-0000-4000-8000-000000000001";
const leaseExpiresAt = new Date("2026-07-04T00:05:00.000Z");
const teamScope: BudgetScope = { kind: "team", teamId: workspaceId };

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
