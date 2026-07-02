import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "@workhub/config";

import {
  budgetPolicyStorageId,
  mergeDefaultPoliciesForSettings,
  type BudgetPolicyRow
} from "./repositories/budget-policies.js";

const settings = loadSettings({
  APP_ENV: "test",
  COOKIE_SECRET: "test-cookie-secret",
  DEFAULT_ORG_ID: "00000000-0000-4000-8000-000000000001",
  DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000002"
});

const otherWorkspaceSettings = loadSettings({
  APP_ENV: "test",
  COOKIE_SECRET: "test-cookie-secret",
  DEFAULT_ORG_ID: "00000000-0000-4000-8000-000000000001",
  DEFAULT_WORKSPACE_ID: "00000000-0000-4000-8000-000000000003"
});

function row(overrides: Partial<BudgetPolicyRow> = {}): BudgetPolicyRow {
  return {
    id: "pcost-user-day-v0",
    orgId: settings.auth.defaultOrgId,
    workspaceId: settings.auth.defaultWorkspaceId,
    scopeKind: "user",
    period: "day",
    maxTokens: 100_000,
    maxCostCny: "1.23",
    warningRatio: "0.7",
    criticalRatio: "0.9",
    onWarning: "notify",
    onExhausted: "block",
    modelRouteHint: null,
    enabled: true,
    version: 2,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: new Date("2026-06-28T00:00:00.000Z"),
    updatedAt: new Date("2026-06-28T00:00:00.000Z"),
    ...overrides
  };
}

test("budget policy overrides are scoped to the current settings tenant", () => {
  const policies = mergeDefaultPoliciesForSettings(settings, [
    row({ maxCostCny: "3.50" }),
    row({
      orgId: "99990000-0000-4000-8000-000000000001",
      workspaceId: "99990000-0000-4000-8000-000000000002",
      maxCostCny: "999"
    })
  ]);

  assert.equal(policies.find((policy) => policy.id === "pcost-user-day-v0")?.maxCostCny, "3.5");
});

test("budget policy storage ids are tenant-scoped while public policy ids stay stable", () => {
  const logicalId = "pcost-user-day-v0";
  const currentStorageId = budgetPolicyStorageId(settings, logicalId);
  const otherStorageId = budgetPolicyStorageId(otherWorkspaceSettings, logicalId);

  assert.notEqual(currentStorageId, otherStorageId);

  const policies = mergeDefaultPoliciesForSettings(settings, [
    row({
      id: currentStorageId,
      maxCostCny: "4.50"
    }),
    row({
      id: otherStorageId,
      workspaceId: otherWorkspaceSettings.auth.defaultWorkspaceId,
      maxCostCny: "999"
    })
  ]);

  assert.equal(policies.find((policy) => policy.id === logicalId)?.id, logicalId);
  assert.equal(policies.find((policy) => policy.id === logicalId)?.maxCostCny, "4.5");
});
