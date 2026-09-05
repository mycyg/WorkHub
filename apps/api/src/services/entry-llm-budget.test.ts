import assert from "node:assert/strict";
import test from "node:test";

import { loadSettings } from "@workhub/config";
import type { BudgetPolicy } from "@workhub/cost";

import { checkEntryLlmBudget, entryLlmBudgetExceededMessage } from "./entry-llm-budget.js";

const teamId = "92000000-0000-4000-8000-000000000001";

function teamDayPolicy(maxTokens: number): BudgetPolicy {
  return {
    id: "pcost-team-day-test",
    scopeKind: "team",
    period: "day",
    maxTokens,
    maxCostCny: "1000000",
    warningRatio: 0.8,
    criticalRatio: 0.95,
    onWarning: "notify",
    onExhausted: "block_new_run",
    enabled: true,
    version: 1
  };
}

function ledgerWithTeamDayUsage(tokenIn: number) {
  return {
    async usageSnapshots() {
      return [{
        scope: { kind: "team" as const, teamId },
        period: "day" as const,
        tokenIn,
        tokenOut: 0,
        estimatedCostCny: "0"
      }];
    }
  };
}

test("API-04 entry LLM budget gate blocks when the team daily budget is exhausted", async () => {
  const allowed = await checkEntryLlmBudget({
    workspaceId: teamId,
    settings: loadSettings({}),
    now: new Date("2026-08-19T00:00:00.000Z"),
    policyStore: {
      async listPolicies() {
        return [teamDayPolicy(1_000)];
      }
    },
    ledgerStore: ledgerWithTeamDayUsage(5_000)
  });

  assert.equal(allowed, false);
});

test("API-04 entry LLM budget gate allows when usage is under the team budget", async () => {
  const allowed = await checkEntryLlmBudget({
    workspaceId: teamId,
    settings: loadSettings({}),
    now: new Date("2026-08-19T00:00:00.000Z"),
    policyStore: {
      async listPolicies() {
        return [teamDayPolicy(1_000_000)];
      }
    },
    ledgerStore: ledgerWithTeamDayUsage(5_000)
  });

  assert.equal(allowed, true);
});

test("API-04 entry LLM budget gate passes through when no workspace scope is available", async () => {
  const allowed = await checkEntryLlmBudget({
    settings: loadSettings({}),
    policyStore: {
      async listPolicies() {
        throw new Error("policy store must not be consulted without a workspace scope");
      }
    }
  });

  assert.equal(allowed, true);
});

test("API-04 budget exceeded message is human-readable in both locales", () => {
  assert.match(entryLlmBudgetExceededMessage("zh-CN"), /预算/u);
  assert.match(entryLlmBudgetExceededMessage("en-US"), /budget/iu);
});
