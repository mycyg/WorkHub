import assert from "node:assert/strict";
import test from "node:test";

import type {
  RiskMonitorDailyCostRow,
  RiskMonitorOpenWorkItemRow,
  RiskMonitorProjectCandidateRow
} from "@workhub/db";

import {
  buildRiskDigest,
  createRiskMonitorService,
  type RiskDigestSignal,
  type RiskMonitorServiceDeps
} from "./risk-monitor.js";

const now = new Date("2026-07-14T03:00:00.000Z"); // UTC date "2026-07-14"
const projectId = "20000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000002";
const ownerUserId = "20000000-0000-4000-8000-000000000003";
const conversationId = "20000000-0000-4000-8000-000000000004";

function candidate(overrides: Partial<RiskMonitorProjectCandidateRow> = {}): RiskMonitorProjectCandidateRow {
  return {
    projectId,
    projectName: "星尘短剧",
    workspaceId,
    ownerUserId,
    ownerNickname: "owner",
    mainConversationId: conversationId,
    riskMonitorJson: {},
    ...overrides
  };
}

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function workItem(overrides: Partial<RiskMonitorOpenWorkItemRow> = {}): RiskMonitorOpenWorkItemRow {
  return {
    projectId,
    id: "30000000-0000-4000-8000-000000000001",
    code: "WI-1",
    title: "接入支付",
    status: "ai_working",
    updatedAt: now,
    dueAt: null,
    ...overrides
  };
}

type BaseDepsOverrides = Partial<RiskMonitorServiceDeps> & {
  candidates?: RiskMonitorProjectCandidateRow[];
  workItems?: RiskMonitorOpenWorkItemRow[];
  costRows?: RiskMonitorDailyCostRow[];
};

function baseDeps(overrides: BaseDepsOverrides = {}) {
  const notificationCalls: unknown[] = [];
  const postSystemMessageCalls: unknown[] = [];
  const candidates = overrides.candidates ?? [candidate()];
  const workItemRows = overrides.workItems ?? [];
  const costRows = overrides.costRows ?? [];

  const deps: RiskMonitorServiceDeps = {
    repository: {
      async listProjectsPendingDigest() {
        return candidates;
      },
      async listOpenWorkItemAges() {
        return workItemRows;
      },
      async listDailyCostByProjects() {
        return costRows;
      }
    },
    notifications: {
      async createOrUpdateNotification(input) {
        notificationCalls.push(input);
        return {
          notification: { id: "notif-1" } as never,
          created: true,
          resurfaced: false
        };
      }
    },
    async postSystemMessage(input) {
      postSystemMessageCalls.push(input);
      return { id: "msg-1" };
    },
    now: () => now,
    logger: { warn: () => {} },
    ...overrides
  };

  return { deps, notificationCalls, postSystemMessageCalls };
}

// ── buildRiskDigest：模板拼接（非 LLM），digest 样例文案 ──────────────────────────────────────

test("buildRiskDigest assembles a single-signal digest with a PM-toned template summary", () => {
  const signals: RiskDigestSignal[] = [
    { kind: "stalled", items: [{ code: "WI-1", title: "接入支付", daysIdle: 6 }], totalCount: 1 }
  ];
  const digest = buildRiskDigest({ projectId, projectName: "星尘短剧", signals });

  assert.equal(digest.notificationTitle, "星尘短剧 · 今日风险巡检");
  assert.match(digest.notificationBody, /任务停滞（1 项）：WI-1（接入支付）已停滞 6 天/u);
  assert.equal(digest.chatSummary, "今天巡检发现 1 项风险信号——1 项任务停滞");
  assert.deepEqual(digest.chatCounts, { stalled: 1, deadline: 0, costSpike: false, githubStale: false });
});

test("buildRiskDigest combines the work-item and cost signal kinds into one multi-paragraph digest", () => {
  const signals: RiskDigestSignal[] = [
    { kind: "stalled", items: [{ code: "WI-1", title: "接入支付", daysIdle: 6 }], totalCount: 2 },
    { kind: "deadline", items: [{ code: "WI-2", title: "上线检查", daysUntilDue: 1 }], totalCount: 1 },
    { kind: "cost_spike", todayCostCny: "128", baselineAvgCny: "40", ratioPct: 320 }
  ];
  const digest = buildRiskDigest({ projectId, projectName: "星尘短剧", signals });

  // 4 = 2 项停滞 + 1 项临期 + 成本放量计 1（信号计数按「项」累计，成本是项目级信号恒记 1）。
  assert.equal(digest.chatSummary, "今天巡检发现 4 项风险信号——2 项任务停滞、1 项临期未动工、成本异常放量");
  assert.deepEqual(digest.chatCounts, { stalled: 2, deadline: 1, costSpike: true, githubStale: false });
  const paragraphs = digest.notificationBody.split("\n");
  assert.equal(paragraphs.length, 3);
  assert.match(paragraphs[0]!, /任务停滞（2 项）/u);
  assert.match(paragraphs[1]!, /临期未动工（1 项）/u);
  assert.match(paragraphs[2]!, /今日 ¥128，是近 7 日日均（¥40）的 3.2 倍/u);
});

test("buildRiskDigest caps each signal bucket display and appends an honest overflow note", () => {
  const items = Array.from({ length: 7 }, (_, index) => ({
    code: `WI-${index}`,
    title: `任务 ${index}`,
    daysIdle: 10 - index
  }));
  const digest = buildRiskDigest({
    projectId,
    projectName: "星尘短剧",
    signals: [{ kind: "stalled", items, totalCount: 7 }]
  });

  const shownCodes = (digest.notificationBody.match(/WI-\d/gu) ?? []).length;
  assert.equal(shownCodes, 5, "must display at most 5 items per bucket");
  assert.match(digest.notificationBody, /及其余 2 项/u);
});

test("buildRiskDigest distinguishes an overdue deadline from an upcoming one", () => {
  const overdue = buildRiskDigest({
    projectId,
    projectName: "星尘短剧",
    signals: [{ kind: "deadline", items: [{ code: "WI-1", title: "上线检查", daysUntilDue: -2 }], totalCount: 1 }]
  });
  assert.match(overdue.notificationBody, /已过期 2 天仍未动工/u);

  const upcoming = buildRiskDigest({
    projectId,
    projectName: "星尘短剧",
    signals: [{ kind: "deadline", items: [{ code: "WI-1", title: "上线检查", daysUntilDue: 1 }], totalCount: 1 }]
  });
  assert.match(upcoming.notificationBody, /将于 1 天后到期仍未动工/u);
});

test("buildRiskDigest phrases a cold-start cost spike differently from a ratio-based one (no fabricated ratio)", () => {
  const coldStart = buildRiskDigest({
    projectId,
    projectName: "星尘短剧",
    signals: [{ kind: "cost_spike", todayCostCny: "45", baselineAvgCny: null, ratioPct: null }]
  });
  assert.match(coldStart.notificationBody, /近期无支出记录，今日新增 ¥45/u);
  assert.doesNotMatch(coldStart.notificationBody, /倍/u);
});

// ── runOnce：三信号判定 + digest 发送 + 幂等 ──────────────────────────────────────────────────

test("runOnce returns a zero result without touching notifications when there are no candidates", async () => {
  const { deps, notificationCalls } = baseDeps({ candidates: [] });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.scanned, 0);
  assert.equal(result.sent, 0);
  assert.equal(notificationCalls.length, 0);
});

test("runOnce counts a project with zero triggered signals as no_signal and sends nothing", async () => {
  const { deps, notificationCalls, postSystemMessageCalls } = baseDeps({
    workItems: [workItem({ status: "ai_working", updatedAt: now })] // freshly updated, not stalled
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.scanned, 1);
  assert.equal(result.no_signal, 1);
  assert.equal(result.sent, 0);
  assert.equal(notificationCalls.length, 0);
  assert.equal(postSystemMessageCalls.length, 0);
});

test("runOnce flags a work item stalled past the project's threshold and posts both the notification and the chat digest", async () => {
  const { deps, notificationCalls, postSystemMessageCalls } = baseDeps({
    workItems: [workItem({ code: "WI-9", title: "接入支付", updatedAt: daysAgo(6), status: "spec_ready" })]
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1);
  assert.equal(result.no_signal, 0);
  assert.equal(notificationCalls.length, 1);
  const notification = notificationCalls[0] as {
    userId: string;
    type: string;
    severity: string;
    dedupeKey: string;
    projectId: string;
    targetUrl: string;
  };
  assert.equal(notification.userId, ownerUserId);
  assert.equal(notification.type, "project.risk_digest");
  assert.equal(notification.severity, "normal");
  assert.equal(notification.dedupeKey, `risk-digest:${projectId}:2026-07-14`);
  assert.equal(notification.targetUrl, `/projects/${projectId}`);

  assert.equal(postSystemMessageCalls.length, 1);
  const message = postSystemMessageCalls[0] as {
    workspaceId: string;
    conversationId: string;
    senderType: string;
    content: Record<string, unknown>;
  };
  assert.equal(message.workspaceId, workspaceId);
  assert.equal(message.conversationId, conversationId);
  assert.equal(message.senderType, "cuu");
  assert.equal(message.content["event"], "risk_digest");
  assert.equal(message.content["stalled_count"], 1);
  assert.equal(message.content["deadline_count"], 0);
  assert.equal(message.content["cost_spike"], false);
});

test("runOnce excludes an early-stage work item's approaching deadline from the stalled signal but flags the deadline signal, and excludes a later-stage status from deadline entirely", async () => {
  const { deps } = baseDeps({
    workItems: [
      workItem({ id: "wi-a", code: "WI-A", status: "spec_ready", updatedAt: now, dueAt: daysFromNow(1) }),
      // already "in motion" (ai_working) — a near due_at here must NOT count as "not started yet".
      workItem({ id: "wi-b", code: "WI-B", status: "ai_working", updatedAt: now, dueAt: daysFromNow(1) })
    ]
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1, "the early-stage due-soon item must trigger a digest");
});

test("runOnce does not flag deadline for ai_working (already-started) work items even when due_at is imminent", async () => {
  const { deps, notificationCalls } = baseDeps({
    workItems: [workItem({ status: "ai_working", updatedAt: now, dueAt: daysFromNow(1) })]
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.no_signal, 1);
  assert.equal(notificationCalls.length, 0);
});

test("runOnce computes a ratio-based cost spike from today vs the 7-day baseline average", async () => {
  const { deps, notificationCalls } = baseDeps({
    costRows: [
      { projectId, periodBucket: "2026-07-14", costCny: "128" },
      { projectId, periodBucket: "2026-07-13", costCny: "40" },
      { projectId, periodBucket: "2026-07-12", costCny: "40" }
    ]
  });
  const service = createRiskMonitorService(deps);

  await service.runOnce();

  assert.equal(notificationCalls.length, 1);
  const notification = notificationCalls[0] as { body: string };
  assert.match(notification.body, /今日 ¥128，是近 7 日日均（¥40）的 3.2 倍/u);
});

test("runOnce does not flag a cost spike below both the ratio and absolute floor (noise guard)", async () => {
  const { deps, notificationCalls } = baseDeps({
    costRows: [
      { projectId, periodBucket: "2026-07-14", costCny: "0.05" },
      { projectId, periodBucket: "2026-07-13", costCny: "0.01" }
    ]
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.no_signal, 1);
  assert.equal(notificationCalls.length, 0);
});

test("runOnce treats a no-baseline project as cold-start, requiring double the floor before flagging", async () => {
  const below = baseDeps({ costRows: [{ projectId, periodBucket: "2026-07-14", costCny: "15" }] });
  const belowResult = await createRiskMonitorService(below.deps).runOnce();
  assert.equal(belowResult.no_signal, 1, "¥15 is below the ¥40 cold-start floor (2x the ¥20 default)");

  const above = baseDeps({ costRows: [{ projectId, periodBucket: "2026-07-14", costCny: "45" }] });
  const aboveResult = await createRiskMonitorService(above.deps).runOnce();
  assert.equal(aboveResult.sent, 1, "¥45 clears the ¥40 cold-start floor");
  const notification = above.notificationCalls[0] as { body: string };
  assert.match(notification.body, /近期无支出记录，今日新增 ¥45/u);
});

test("runOnce respects a project's own configured thresholds instead of the global default", async () => {
  const { deps, notificationCalls } = baseDeps({
    candidates: [candidate({ riskMonitorJson: { stall_days_threshold: 10 } })],
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })] // stalled under default (5d) but not under this project's 10d
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.no_signal, 1);
  assert.equal(notificationCalls.length, 0);
});

// ── digest 幂等：同日不重发 ────────────────────────────────────────────────────────────────

test("runOnce does not re-post the chat digest when the notification content is unchanged (resurfaced=false is a true no-op)", async () => {
  const { deps, notificationCalls, postSystemMessageCalls } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })],
    notifications: {
      async createOrUpdateNotification(input) {
        notificationCalls.push(input);
        return { notification: { id: "notif-1" } as never, created: false, resurfaced: false };
      }
    }
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.refreshed, 1);
  assert.equal(result.sent, 0);
  assert.equal(postSystemMessageCalls.length, 0, "unchanged-content no-op must never re-post the chat digest");
});

test("runOnce refreshes the notification body when content changed but still does not re-post the chat digest (only the first created=true post ever fires)", async () => {
  const { deps, notificationCalls, postSystemMessageCalls } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })],
    notifications: {
      async createOrUpdateNotification(input) {
        notificationCalls.push(input);
        return { notification: { id: "notif-1" } as never, created: false, resurfaced: true };
      }
    }
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.refreshed, 1);
  assert.equal(result.sent, 0);
  assert.equal(postSystemMessageCalls.length, 0, "resurfaced updates must not trigger a second chat post");
});

test("runOnce's dedupeKey is scoped to the calendar day, so a new UTC day starts a fresh created=true cycle", async () => {
  const { deps: dayOneDeps, notificationCalls: dayOneCalls } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })],
    now: () => new Date("2026-07-14T23:00:00.000Z")
  });
  await createRiskMonitorService(dayOneDeps).runOnce();
  const dayOneKey = (dayOneCalls[0] as { dedupeKey: string }).dedupeKey;

  const { deps: dayTwoDeps, notificationCalls: dayTwoCalls } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })],
    now: () => new Date("2026-07-15T01:00:00.000Z")
  });
  await createRiskMonitorService(dayTwoDeps).runOnce();
  const dayTwoKey = (dayTwoCalls[0] as { dedupeKey: string }).dedupeKey;

  assert.equal(dayOneKey, `risk-digest:${projectId}:2026-07-14`);
  assert.equal(dayTwoKey, `risk-digest:${projectId}:2026-07-15`);
  assert.notEqual(dayOneKey, dayTwoKey);
});

// ── 防御分支 + 隔离失败 ──────────────────────────────────────────────────────────────────

test("runOnce still creates the notification when a project has no main conversation, and counts it as skipped_no_conversation instead of failing", async () => {
  const { deps, notificationCalls, postSystemMessageCalls } = baseDeps({
    candidates: [candidate({ mainConversationId: null })],
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })]
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1);
  assert.equal(result.skipped_no_conversation, 1);
  assert.equal(notificationCalls.length, 1);
  assert.equal(postSystemMessageCalls.length, 0);
});

test("runOnce logs but does not fail the candidate when postSystemMessage rejects (notification already committed)", async () => {
  const warnings: unknown[] = [];
  const { deps } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })],
    async postSystemMessage() {
      throw new Error("conversation post exploded");
    },
    logger: { warn: (event, meta) => warnings.push({ event, meta }) }
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0, "a chat-post failure must not roll back the already-committed notification");
  assert.ok(warnings.some((entry) => (entry as { event: string }).event === "risk_digest_conversation_post_failed"));
});

test("runOnce isolates a single candidate's failure (notification write throws) without aborting the rest of the batch", async () => {
  const otherProjectId = "20000000-0000-4000-8000-000000000099";
  const { deps, notificationCalls } = baseDeps({
    candidates: [candidate(), candidate({ projectId: otherProjectId, mainConversationId: null })],
    workItems: [
      workItem({ updatedAt: daysAgo(6), status: "spec_ready" }),
      workItem({ projectId: otherProjectId, id: "wi-other", code: "WI-OTHER", updatedAt: daysAgo(6), status: "spec_ready" })
    ],
    notifications: {
      async createOrUpdateNotification(input) {
        notificationCalls.push(input);
        if (input.projectId === projectId) {
          throw new Error("db write exploded");
        }
        return { notification: { id: "notif-2" } as never, created: true, resurfaced: false };
      }
    }
  });
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
  assert.equal(notificationCalls.length, 2, "the failing candidate must not prevent the other candidate from being processed");
});

// ── 不依赖 LLM：deps 类型本身没有 provider/isConfigured 依赖，runOnce 在没有任何 LLM 相关注入下照常跑完 ──

test("runOnce completes normally with no LLM/provider dependency wired in at all (rule-based signals only)", async () => {
  const { deps } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })]
  });
  // RiskMonitorServiceDeps 本身没有 provider/isConfigured 字段——没有 key 的自托管实例照样能跑通整条链路。
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
});

// ── R23 P3b（SA-03）：第四信号 github_stale ─────────────────────────────────────────────────

test("buildRiskDigest names the stale repository and folds it into the summary", () => {
  const signals: RiskDigestSignal[] = [
    { kind: "github_stale", repoFullName: "acme/stardust", daysIdle: 12 }
  ];
  const digest = buildRiskDigest({ projectId, projectName: "星尘短剧", signals });

  assert.equal(digest.notificationBody, "代码仓库：acme/stardust 已经 12 天没有新提交。");
  assert.equal(digest.chatSummary, "今天巡检发现 1 项风险信号——代码仓库长期没有新提交");
  assert.deepEqual(digest.chatCounts, { stalled: 0, deadline: 0, costSpike: false, githubStale: true });
});

test("buildRiskDigest says the repo has no synced commits at all instead of inventing a day count", () => {
  const digest = buildRiskDigest({
    projectId,
    projectName: "星尘短剧",
    signals: [{ kind: "github_stale", repoFullName: "acme/stardust", daysIdle: null }]
  });

  assert.equal(digest.notificationBody, "代码仓库：acme/stardust 绑定后还没有同步到任何提交记录。");
});

test("runOnce turns a stale bound repository into a risk digest entry for that project only", async () => {
  const otherProjectId = "20000000-0000-4000-8000-0000000000ff";
  const staleCalls: Array<{ projectIds: string[]; thresholdDays: number }> = [];
  const { deps, notificationCalls, postSystemMessageCalls } = baseDeps({
    candidates: [candidate(), candidate({ projectId: otherProjectId, projectName: "另一个项目" })],
    githubStaleDays: 9
  });
  deps.repository.listStaleRepos = async (input) => {
    staleCalls.push({ projectIds: input.projectIds, thresholdDays: input.thresholdDays });
    return [{ projectId, repoFullName: "acme/stardust", lastActivityAt: daysAgo(11) }];
  };
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  // 一次批量查（两个项目一起问），不是逐项目 N+1。
  assert.equal(staleCalls.length, 1);
  assert.deepEqual(staleCalls[0]!.projectIds, [projectId, otherProjectId]);
  assert.equal(staleCalls[0]!.thresholdDays, 9, "threshold must come from the configured GITHUB_STALE_DAYS");
  assert.equal(result.sent, 1, "only the project with the stale repo has a signal");
  assert.equal(result.no_signal, 1);
  assert.equal(notificationCalls.length, 1);
  assert.match(
    (notificationCalls[0] as { body: string }).body,
    /代码仓库：acme\/stardust 已经 11 天没有新提交。/u
  );
  assert.equal((postSystemMessageCalls[0] as { content: { github_stale: boolean } }).content.github_stale, true);
});

test("runOnce keeps the other three signals alive when the stale-repo query blows up", async () => {
  const warnings: string[] = [];
  const { deps, notificationCalls } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })],
    logger: { warn: (event: string) => { warnings.push(event); } }
  });
  deps.repository.listStaleRepos = async () => {
    throw new Error("github table exploded");
  };
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.ok(warnings.includes("risk_monitor_stale_repo_query_failed"));
  assert.doesNotMatch((notificationCalls[0] as { body: string }).body, /代码仓库/u);
});

test("runOnce leaves the github signal out entirely when no stale-repo query is wired in", async () => {
  const { deps, notificationCalls } = baseDeps({
    workItems: [workItem({ updatedAt: daysAgo(6), status: "spec_ready" })]
  });
  assert.equal(deps.repository.listStaleRepos, undefined);
  const service = createRiskMonitorService(deps);

  const result = await service.runOnce();

  assert.equal(result.sent, 1);
  assert.doesNotMatch((notificationCalls[0] as { body: string }).body, /代码仓库/u);
});
