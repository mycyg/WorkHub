import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { buildUsageRecord, createMemoryCostLedgerStore } from "@workhub/cost";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { buildAgentArmyDashboardPage } from "./pages/agent-army.js";
import { InternalContractError } from "./pages/output-contract.js";
import { createPageRoutes } from "./routes/pages.js";

const now = new Date("2026-07-03T00:00:00.000Z");
const workspaceId = "96000000-0000-4000-8000-000000000010";
const userId = "96000000-0000-4000-8000-000000000011";
const planId = "96000000-0000-4000-8000-000000000001";
const workItemId = "96000000-0000-4000-8000-000000000002";
const objectiveId = "96000000-0000-4000-8000-000000000003";
const firstItemId = "96000000-0000-4000-8000-000000000004";
const secondItemId = "96000000-0000-4000-8000-000000000005";
const firstRunId = "96000000-0000-4000-8000-000000000006";
const secondRunId = "96000000-0000-4000-8000-000000000007";
const escalationId = "96000000-0000-4000-8000-000000000008";
const hiddenPlanId = "96000000-0000-4000-8000-000000000009";
const hiddenRunId = "96000000-0000-4000-8000-00000000000a";
const hiddenWorkItemId = "96000000-0000-4000-8000-00000000000b";
const runlessEscalationId = "96000000-0000-4000-8000-00000000000c";

function runtimeSettings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "army-user",
    cookieToken: "cookie-army-user",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function authDeps(settings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([user()]),
    devices: new MemoryDevices(),
    settings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof InternalContractError) {
      return c.json({ ok: false, error: { code: "internal_contract_error", message: "internal contract error" } }, 500);
    }
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(settings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-army-user", settings.auth.cookieSecret);
}

function testUuid(offset: number) {
  return `96000000-0000-4000-8000-${offset.toString(16).padStart(12, "0")}`;
}

function dashboardPlanFixture(index: number) {
  const itemId = testUuid(0x200 + index);
  return {
    plan: {
      id: testUuid(0x100 + index),
      workItemId: itemId,
      workspaceId,
      status: "dispatching" as const,
      objectiveId: null,
      budgetJson: {},
      decompositionContextJson: {},
      createdByUserId: userId,
      createdAt: now,
      updatedAt: new Date(now.getTime() - index)
    },
    workItem: {
      id: itemId,
      code: `DEMO-${index}`,
      title: `候选任务 ${index}`,
      status: "ai_working"
    },
    objective: null
  };
}

test("R9.6 agent army dashboard aggregates observable plan state from rows and cost ledger", async () => {
  const ledger = createMemoryCostLedgerStore({ teamId: workspaceId });
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: firstRunId,
    workItemId,
    userId,
    workspaceId,
    taskPlanId: planId,
    objectiveId,
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: now
  }));
  await ledger.recordUsage(buildUsageRecord({
    provider: "deepseek",
    model: "deepseek-v4-pro",
    task: "worker",
    runId: hiddenRunId,
    workItemId: hiddenWorkItemId,
    userId,
    workspaceId,
    taskPlanId: hiddenPlanId,
    objectiveId,
    inputTokens: 1000,
    outputTokens: 500,
    costTier: { inputCnyPerMtok: 2, outputCnyPerMtok: 8 },
    createdAt: now
  }));

  const vm = buildAgentArmyDashboardPage({
    generatedAt: now,
    locale: "zh-CN",
    attentionCount: 2,
    sourceWarnings: [{
      source: "sync_conflicts",
      message: "记忆冲突暂时加载失败。请打开设置或稍后重试。"
    }],
    autonomyRatePct: 67,
    plans: [{
      plan: {
        id: planId,
        workItemId,
        workspaceId,
        status: "dispatching",
        objectiveId,
        budgetJson: { max_cost_cny: "3.000000" },
        decompositionContextJson: { judge: { decision: "approve" } },
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now
      },
      workItem: {
        id: workItemId,
        code: "DEMO-960",
        title: "竞品资料梳理",
        status: "ai_working"
      },
      objective: {
        id: objectiveId,
        title: "季度上市策略",
        progressPercent: 40
      }
    }],
    items: [
      {
        id: firstItemId,
        planId,
        parentItemId: null,
        seq: 1,
        title: "竞品调研",
        role: "research",
        objectiveMd: "查清背景。",
        acceptanceMd: "列出来源。",
        budgetSharePct: 50,
        dependsOn: [],
        status: "succeeded",
        createdAt: now,
        updatedAt: now
      },
      {
        id: secondItemId,
        planId,
        parentItemId: null,
        seq: 2,
        title: "竞品复核",
        role: "review",
        objectiveMd: "复核冲突证据。",
        acceptanceMd: "给出人审问题。",
        budgetSharePct: 50,
        dependsOn: [firstItemId],
        status: "dispatched",
        createdAt: now,
        updatedAt: now
      }
    ],
    runs: [
      {
        id: firstRunId,
        parentRunId: null,
        workItemId,
        workspaceId,
        taskPlanId: planId,
        taskPlanItemId: firstItemId,
        agentRole: "research",
        title: "竞品调研",
        status: "succeeded",
        costEstimate: "1.250000",
        outcomeReason: null,
        createdAt: now,
        updatedAt: now,
        finishedAt: now
      },
      {
        id: secondRunId,
        parentRunId: null,
        workItemId,
        workspaceId,
        taskPlanId: planId,
        taskPlanItemId: secondItemId,
        agentRole: "review",
        title: "竞品复核",
        status: "escalated",
        costEstimate: null,
        outcomeReason: "needs human",
        createdAt: new Date("2026-07-02T22:00:00.000Z"),
        updatedAt: new Date("2026-07-02T22:00:00.000Z"),
        finishedAt: null
      }
    ],
    escalations: [
      {
        id: escalationId,
        workItemId,
        planId,
        runId: secondRunId,
        reasonMd: "证据互相冲突，需要人判断。",
        createdAt: new Date("2026-07-02T22:00:00.000Z")
      },
      {
        id: runlessEscalationId,
        workItemId,
        planId,
        runId: null,
        reasonMd: "依赖图需要人工调整。",
        createdAt: new Date("2026-07-02T21:00:00.000Z")
      }
    ],
    ledgerEntries: ledger.entries,
    pageInfo: {
      planLimit: 20,
      plansCapped: false,
      itemsCapped: false,
      runsCapped: false,
      escalationLimit: 5,
      escalationsCapped: false
    }
  });

  assert.equal(vm.kpis.active_team_count, 1);
  assert.equal(vm.kpis.waiting_decision_count, 2);
  // The dashboard only surfaces cost for plans that survived the page visibility filter.
  assert.equal(vm.kpis.today_cost_cny, "0.006");
  assert.equal(vm.kpis.autonomy_rate_pct, 67);
  assert.equal(vm.plans[0]?.progress.label, "1/2");
  assert.equal(vm.plans[0]?.objective_title, "季度上市策略");
  assert.equal(vm.plans[0]?.objective_progress_pct, 40);
  assert.equal(vm.plans[0]?.budget_href, "/dashboard/cost");
  assert.deepEqual(vm.plans[0]?.roles, [
    { role: "research", count: 1 },
    { role: "review", count: 1 }
  ]);
  assert.deepEqual(vm.plans[0]?.statuses, [
    { status: "succeeded", count: 1 },
    { status: "needs_human", count: 1 }
  ]);
  assert.equal(vm.plans[0]?.cost.used_cny, "0.006");
  assert.equal(vm.plans[0]?.cost.budget_cny, "3");
  assert.equal(vm.plans[0]?.judge.pass_rate_pct, 100);
  assert.equal(vm.plans[0]?.oldest_blocker?.href, "/attention");
  assert.match(vm.plans[0]?.oldest_blocker?.label ?? "", /竞品资料梳理/u);
  assert.equal(vm.recent_escalations[0]?.href, "/attention");
  assert.equal(vm.recent_escalations[1]?.id, runlessEscalationId);
  assert.match(vm.recent_escalations[1]?.title ?? "", /竞品资料梳理/u);
  assert.deepEqual(vm.source_warnings, [{
    source: "sync_conflicts",
    message: "记忆冲突暂时加载失败。请打开设置或稍后重试。"
  }]);
  assert.equal(vm.page_info.escalation_returned, 2);
  assert.equal(vm.empty_state, undefined);
});

test("R9.6 agent army dashboard returns an honest empty state without fake plans", () => {
  const vm = buildAgentArmyDashboardPage({
    generatedAt: now,
    locale: "en-US",
    attentionCount: 0,
    autonomyRatePct: 0,
    plans: [],
    items: [],
    runs: [],
    escalations: [],
    ledgerEntries: [],
    pageInfo: {
      planLimit: 20,
      plansCapped: false,
      itemsCapped: false,
      runsCapped: false,
      escalationLimit: 5,
      escalationsCapped: false
    }
  });

  assert.equal(vm.empty_state, "no_agent_armies");
  assert.deepEqual(vm.plans, []);
  assert.deepEqual(vm.recent_escalations, []);
});

test("R9.7 agent army dashboard KPI never undercounts returned escalation rows", () => {
  const plan = dashboardPlanFixture(30);
  const vm = buildAgentArmyDashboardPage({
    generatedAt: now,
    locale: "en-US",
    attentionCount: 0,
    autonomyRatePct: 0,
    plans: [plan],
    items: [],
    runs: [],
    escalations: [
      {
        id: escalationId,
        workItemId: plan.workItem.id,
        planId: plan.plan.id,
        runId: null,
        reasonMd: "Needs review.",
        createdAt: now
      },
      {
        id: runlessEscalationId,
        workItemId: plan.workItem.id,
        planId: plan.plan.id,
        runId: null,
        reasonMd: "Dependency is blocked.",
        createdAt: now
      }
    ],
    ledgerEntries: [],
    pageInfo: {
      planLimit: 20,
      plansCapped: false,
      itemsCapped: false,
      runsCapped: false,
      escalationLimit: 5,
      escalationsCapped: false
    }
  });

  assert.equal(vm.recent_escalations.length, 2);
  assert.equal(vm.kpis.waiting_decision_count, 2);
});

test("R9.6 /api/pages/agents returns the dashboard VM through auth and locale envelope", async () => {
  const settings = runtimeSettings();
  const calls: Array<{ actorId: string; locale: string }> = [];
  const vm = buildAgentArmyDashboardPage({
    generatedAt: now,
    locale: "en-US",
    attentionCount: 0,
    autonomyRatePct: 0,
    plans: [],
    items: [],
    runs: [],
    escalations: [],
    ledgerEntries: [],
    pageInfo: {
      planLimit: 20,
      plansCapped: false,
      itemsCapped: false,
      runsCapped: false,
      escalationLimit: 5,
      escalationsCapped: false
    }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(settings),
    agentArmyDashboard: {
      async page(input: { actor: { id: string }; locale: string }) {
        calls.push({ actorId: input.actor.id, locale: input.locale });
        return vm;
      }
    } as never
  }));

  const response = await app.request("/api/pages/agents?locale=en-US", {
    headers: { Cookie: await cookie(settings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: { empty_state?: string };
    meta: { locale: string };
  };
  assert.deepEqual(calls, [{ actorId: userId, locale: "en-US" }]);
  assert.equal(body.meta.locale, "en-US");
  assert.equal(body.data.empty_state, "no_agent_armies");
});

test("R9.7 /api/pages/agents marks failed attention count sources instead of looking empty", async () => {
  const settings = runtimeSettings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(settings),
    taskPlans: {
      async listDashboardPlans() {
        return {
          plans: [],
          plansCapped: false,
          items: [],
          itemsCapped: false,
          runs: [],
          runsCapped: false,
          escalations: [],
          escalationsCapped: false
        };
      }
    },
    workItems: {
      async canReadWorkItems() {
        return new Set<string>();
      }
    },
    ledgerStore: {
      async listEntriesForScopes() {
        return [];
      }
    },
    aiWorklog: {
      async getTodayMetrics() {
        return {
          runs_today: 0,
          autonomy_rate: 0,
          accepted_today: 0,
          saved_hours_estimate: 0,
          generated_at: now.toISOString()
        };
      }
    },
    escalations: {
      async listAttentionItems() {
        throw new Error("escalation source down");
      }
    },
    memoryConflicts: {
      async listAttentionItems() {
        return [];
      }
    },
    approvals: {
      async listPendingForUser() {
        throw new Error("approval source down");
      }
    },
    proposals: {
      async listReviewableForUser() {
        return [];
      }
    }
  } as never));

  const response = await app.request("/api/pages/agents?locale=zh-CN", {
    headers: { Cookie: await cookie(settings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      kpis: { waiting_decision_count: number };
      source_warnings: Array<{ source: string; message: string }>;
    };
  };
  assert.equal(body.data.kpis.waiting_decision_count, 0);
  assert.deepEqual(body.data.source_warnings.map((warning) => warning.source), ["escalations", "approvals"]);
  assert.match(body.data.source_warnings[0]?.message ?? "", /升级待办/u);
  assert.match(body.data.source_warnings[1]?.message ?? "", /审批待办/u);
});

test("R9.7 /api/pages/agents counts capped approval lower-bound totals in the decision KPI", async () => {
  const settings = runtimeSettings();
  const approvalId = testUuid(0x300);
  const attentionId = testUuid(0x301);
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(settings),
    taskPlans: {
      async listDashboardPlans() {
        return {
          plans: [],
          plansCapped: false,
          items: [],
          itemsCapped: false,
          runs: [],
          runsCapped: false,
          escalations: [],
          escalationsCapped: false
        };
      }
    },
    workItems: {
      async canReadWorkItems() {
        return new Set<string>();
      }
    },
    ledgerStore: {
      async listEntriesForScopes() {
        return [];
      }
    },
    aiWorklog: {
      async getTodayMetrics() {
        return {
          runs_today: 0,
          autonomy_rate: 0,
          accepted_today: 0,
          saved_hours_estimate: 0,
          generated_at: now.toISOString()
        };
      }
    },
    escalations: {
      async listAttentionItems() {
        return [];
      }
    },
    memoryConflicts: {
      async listAttentionItems() {
        return [];
      }
    },
    approvals: {
      async listPendingForUser() {
        return {
          items: [{
            id: attentionId,
            kind: "approval",
            priority: "high",
            work_item_id: workItemId,
            source_ref: { entity_type: "approval_request", entity_id: approvalId },
            title: "审批待办",
            summary_text: "需要人工审批",
            actions: [{ id: "open", label: "打开", style: "primary", method: "GET", href: "/approvals" }],
            created_at: now.toISOString()
          }],
          requests: [{
            id: approvalId,
            work_item_id: workItemId,
            action_pattern: "tool.write_file",
            payload_json: {},
            status: "pending",
            routed_to_user_id: userId,
            created_at: now.toISOString(),
            updated_at: now.toISOString()
          }],
          filters: { pending: true },
          counts: { pending: 1, pending_total: 125, pending_total_capped: 1 },
          page_info: { limit: 100, returned: 1, has_more: true },
          items_detail: {}
        };
      }
    },
    proposals: {
      async listReviewableForUser() {
        return [];
      }
    }
  } as never));

  const response = await app.request("/api/pages/agents?locale=zh-CN", {
    headers: { Cookie: await cookie(settings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      kpis: { waiting_decision_count: number };
      source_warnings: Array<{ source: string; message: string }>;
    };
  };
  assert.equal(body.data.kpis.waiting_decision_count, 125);
  assert.deepEqual(body.data.source_warnings.map((warning) => warning.source), ["approvals"]);
  assert.match(body.data.source_warnings[0]?.message ?? "", /下限/u);
});

test("R9.7 /api/pages/agents applies visibility before the public plan cap", async () => {
  const settings = runtimeSettings();
  const hiddenCandidates = Array.from({ length: 20 }, (_, index) => dashboardPlanFixture(index + 1));
  const visibleCandidate = dashboardPlanFixture(21);
  const requestedPlanLimits: Array<number | undefined> = [];
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(settings),
    taskPlans: {
      async listDashboardPlans(input: { planLimit?: number }) {
        requestedPlanLimits.push(input.planLimit);
        const plans = input.planLimit && input.planLimit > 20
          ? [...hiddenCandidates, visibleCandidate]
          : hiddenCandidates;
        return {
          plans,
          plansCapped: false,
          items: [],
          itemsCapped: false,
          runs: [],
          runsCapped: false,
          escalations: [],
          escalationsCapped: false
        };
      }
    },
    workItems: {
      async canReadWorkItems() {
        return new Set([visibleCandidate.workItem.id]);
      }
    },
    ledgerStore: {
      async listEntriesForScopes() {
        return [];
      }
    },
    aiWorklog: {
      async getTodayMetrics() {
        return {
          runs_today: 0,
          autonomy_rate: 0,
          accepted_today: 0,
          saved_hours_estimate: 0,
          generated_at: now.toISOString()
        };
      }
    },
    escalations: {
      async listAttentionItems() {
        return [];
      }
    },
    memoryConflicts: {
      async listAttentionItems() {
        return [];
      }
    },
    approvals: {
      async listPendingForUser() {
        return { requests: [], counts: { pending: 0, total: 0 }, page_info: { limit: 100, returned: 0, has_more: false } };
      }
    },
    proposals: {
      async listReviewableForUser() {
        return [];
      }
    }
  } as never));

  const response = await app.request("/api/pages/agents?locale=zh-CN", {
    headers: { Cookie: await cookie(settings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      plans: Array<{ plan_id: string; work_item_id: string }>;
      page_info: { plan_limit: number; returned: number; plans_capped: boolean };
      empty_state?: string;
    };
  };
  assert.deepEqual(requestedPlanLimits, [50]);
  assert.equal(body.data.empty_state, undefined);
  assert.deepEqual(body.data.plans.map((plan) => plan.plan_id), [visibleCandidate.plan.id]);
  assert.deepEqual(body.data.plans.map((plan) => plan.work_item_id), [visibleCandidate.workItem.id]);
  assert.equal(body.data.page_info.plan_limit, 20);
  assert.equal(body.data.page_info.returned, 1);
  assert.equal(body.data.page_info.plans_capped, false);
});
