import { eq, inArray } from "drizzle-orm";

import {
  deliverableChangeManifestSchema,
  type DeliverableChangeManifest,
  type EvidenceRef
} from "@workhub/contracts";

import type { WorkHubDb } from "./client.js";
import { defaultSeedFixture, defaultSeedIds } from "./seed.js";
import {
  agentRuns,
  agentSteps,
  approvalRequests,
  auditLogs,
  branches,
  chatMessages,
  costLedgerEntries,
  proposals,
  reviews,
  snapshots,
  usageRecords,
  users,
  workItemAcceptanceItems,
  workItems,
  orgs,
  projects,
  workspaces
} from "./schema/index.js";

const fixedAt = new Date("2026-06-11T08:00:00.000Z");

export const r4WebLiveApiPgSeedIds = {
  userId: "00000000-0000-4000-8000-000000000102",
  forbiddenUserId: "00000000-0000-4000-8000-000000000471",
  projectId: defaultSeedIds.projectId,
  workspaceId: defaultSeedIds.workspaceId,
  teamId: defaultSeedIds.workspaceId,
  workItemId: "00000000-0000-4000-8000-000000000104",
  forbiddenWorkItemId: "00000000-0000-4000-8000-000000000472",
  missingProposalId: "00000000-0000-4000-8000-000000000473",
  branchId: "00000000-0000-4000-8000-000000000106",
  runId: "00000000-0000-4000-8000-000000000107",
  proposalId: "00000000-0000-4000-8000-000000000108",
  baseSnapshotId: "00000000-0000-4000-8000-000000000109",
  draftSnapshotId: "00000000-0000-4000-8000-00000000010a",
  auditSnapshotId: "00000000-0000-4000-8000-000000000501",
  auditProposalId: "00000000-0000-4000-8000-000000000502",
  acceptanceFitId: "00000000-0000-4000-8000-000000000474",
  acceptanceEvidenceId: "00000000-0000-4000-8000-000000000475",
  evidenceMessageId: "00000000-0000-4000-8000-000000000476",
  stepPlanId: "00000000-0000-4000-8000-000000000701",
  stepEvidenceId: "00000000-0000-4000-8000-000000000702",
  stepFinalId: "00000000-0000-4000-8000-000000000705",
  reviewId: "00000000-0000-4000-8000-000000000801",
  approvalId: "00000000-0000-4000-8000-000000000802",
  usageRecordId: "r4-web-live-api-pg-seed:deepseek-v4-flash:2026-06-11",
  costLedgerUserId: "00000000-0000-4000-8000-000000000901",
  costLedgerTeamId: "00000000-0000-4000-8000-000000000902",
  costLedgerWorkItemId: "00000000-0000-4000-8000-000000000903",
  changeMarkdownId: "00000000-0000-4000-8000-000000000401",
  changePreviewId: "00000000-0000-4000-8000-000000000402"
} as const;

export type R4WebLiveApiPgSeedResult = {
  ids: typeof r4WebLiveApiPgSeedIds & {
    currentUserId: string;
    forbiddenActorUserId: string;
  };
  seededAt: string;
};

const reviewerNickname = "P0.5 Reviewer";
const forbiddenNickname = "R4.7 Forbidden Reviewer";

const sha = (char: string) => char.repeat(64);

async function ensureDefaultSeed(db: WorkHubDb) {
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();
}

async function ensureUser(input: {
  db: WorkHubDb;
  id: string;
  nickname: string;
  cookieToken: string;
  at: Date;
}) {
  const rows = await input.db
    .select()
    .from(users)
    .where(eq(users.nickname, input.nickname))
    .limit(1);
  const existing = rows[0];
  if (existing) {
    await input.db
      .update(users)
      .set({
        cookieToken: input.cookieToken,
        preferredLocale: "zh-CN",
        availabilityStatus: "free",
        availabilityText: null,
        availabilityUpdatedAt: input.at,
        isAdmin: false,
        deletedAt: null,
        updatedAt: input.at
      })
      .where(eq(users.id, existing.id));
    return existing.id;
  }

  await input.db.insert(users).values({
    id: input.id,
    nickname: input.nickname,
    cookieToken: input.cookieToken,
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityUpdatedAt: input.at,
    isAdmin: false,
    createdAt: input.at,
    updatedAt: input.at
  });
  return input.id;
}

async function cleanupR4Rows(db: WorkHubDb, at: Date) {
  await db
    .delete(costLedgerEntries)
    .where(inArray(costLedgerEntries.id, [
      r4WebLiveApiPgSeedIds.costLedgerUserId,
      r4WebLiveApiPgSeedIds.costLedgerTeamId,
      r4WebLiveApiPgSeedIds.costLedgerWorkItemId
    ]));
  await db.delete(usageRecords).where(eq(usageRecords.id, r4WebLiveApiPgSeedIds.usageRecordId));
  await db.delete(approvalRequests).where(eq(approvalRequests.id, r4WebLiveApiPgSeedIds.approvalId));
  await db.delete(reviews).where(eq(reviews.id, r4WebLiveApiPgSeedIds.reviewId));
  await db.delete(proposals).where(eq(proposals.id, r4WebLiveApiPgSeedIds.proposalId));
  await db
    .delete(auditLogs)
    .where(inArray(auditLogs.id, [r4WebLiveApiPgSeedIds.auditSnapshotId, r4WebLiveApiPgSeedIds.auditProposalId]));
  await db
    .delete(agentSteps)
    .where(inArray(agentSteps.id, [
      r4WebLiveApiPgSeedIds.stepPlanId,
      r4WebLiveApiPgSeedIds.stepEvidenceId,
      r4WebLiveApiPgSeedIds.stepFinalId
    ]));
  await db
    .update(agentRuns)
    .set({ branchId: null, updatedAt: at })
    .where(eq(agentRuns.id, r4WebLiveApiPgSeedIds.runId));
  await db.delete(agentRuns).where(eq(agentRuns.id, r4WebLiveApiPgSeedIds.runId));
  await db
    .delete(snapshots)
    .where(inArray(snapshots.id, [
      r4WebLiveApiPgSeedIds.baseSnapshotId,
      r4WebLiveApiPgSeedIds.draftSnapshotId
    ]));
  await db
    .update(workItems)
    .set({ mainBranchId: null, updatedAt: at })
    .where(inArray(workItems.id, [
      r4WebLiveApiPgSeedIds.workItemId,
      r4WebLiveApiPgSeedIds.forbiddenWorkItemId
    ]));
  await db.delete(branches).where(eq(branches.id, r4WebLiveApiPgSeedIds.branchId));
  await db.delete(chatMessages).where(eq(chatMessages.id, r4WebLiveApiPgSeedIds.evidenceMessageId));
  await db
    .delete(workItemAcceptanceItems)
    .where(inArray(workItemAcceptanceItems.id, [
      r4WebLiveApiPgSeedIds.acceptanceFitId,
      r4WebLiveApiPgSeedIds.acceptanceEvidenceId
    ]));
  await db
    .delete(workItems)
    .where(inArray(workItems.id, [
      r4WebLiveApiPgSeedIds.workItemId,
      r4WebLiveApiPgSeedIds.forbiddenWorkItemId
    ]));
}

function r4EvidenceRefs(): EvidenceRef[] {
  return [
    {
      id: "00000000-0000-4000-8000-000000000201",
      source_type: "meeting",
      source_id: "regional-launch-sync-2026-06-11",
      title: "Regional launch sync decisions",
      excerpt: "Stakeholders need a concise launch review focused on blocker status, owner actions, and evidence links.",
      locator: { timestamp_s: 728 },
      confidence_hint: "found",
      href: "/api/evidence/regional-launch-sync-2026-06-11"
    },
    {
      id: "00000000-0000-4000-8000-000000000202",
      source_type: "drive_file",
      source_id: "drive-regional-launch-metrics",
      title: "Regional launch metrics export",
      excerpt: "The source pack includes readiness, risk, follow-up owner, and budget columns for the launch review.",
      locator: { path: "/project-drive/regional-launch/metrics.csv" },
      confidence_hint: "found",
      href: "/api/evidence/drive-regional-launch-metrics"
    }
  ];
}

function r4Manifest(input: { userId: string; at: Date }): DeliverableChangeManifest {
  return deliverableChangeManifestSchema.parse({
    version: 0,
    proposal_id: r4WebLiveApiPgSeedIds.proposalId,
    work_item_id: r4WebLiveApiPgSeedIds.workItemId,
    branch_id: r4WebLiveApiPgSeedIds.branchId,
    title: "R4.7 live API review package",
    summary_md: [
      "Real API and Postgres seed smoke package for the Web route workbench.",
      "",
      "- Adds a regional launch review draft with route-ready proof.",
      "- Keeps Web copy productized and free of legacy demo wording.",
      "- Includes explicit overflow acceptance for dense cards and mobile routes."
    ].join("\n"),
    author: {
      actor_kind: "ai",
      actor_user_id: input.userId,
      label: "WorkHub AI"
    },
    base: {
      snapshot_id: r4WebLiveApiPgSeedIds.baseSnapshotId,
      branch_head_ref: "workhub://branches/r4-web-live-api-pg@base",
      created_at: input.at.toISOString()
    },
    changes: [
      {
        id: r4WebLiveApiPgSeedIds.changeMarkdownId,
        target_kind: "text_doc",
        target_ref: {
          entity_type: "work_item",
          entity_id: r4WebLiveApiPgSeedIds.workItemId,
          path: "/outputs/regional-launch-review.md",
          version_before: "base",
          version_after: "r4.7-live-api-pg",
          sha256_before: sha("a"),
          sha256_after: sha("b")
        },
        change_type: "generated",
        human_summary: "Generated the regional launch review draft used by the Web live API smoke.",
        machine_summary: {
          before_excerpt: "No launch review package was attached to the seeded work item.",
          after_excerpt: "## Regional launch review\n\n- Blockers\n- Owner actions\n- Evidence links",
          changed_fields: ["summary_md", "evidence_refs", "review_actions"]
        },
        preview_ref: {
          kind: "text",
          href: "/api/previews/regional-launch-review.md"
        },
        evidence_refs: r4EvidenceRefs()
      },
      {
        id: r4WebLiveApiPgSeedIds.changePreviewId,
        target_kind: "text_doc",
        target_ref: {
          entity_type: "work_item",
          entity_id: r4WebLiveApiPgSeedIds.workItemId,
          path: "/outputs/regional-launch-review-preview.html",
          version_after: "r4.7-live-api-pg-preview",
          sha256_after: sha("c")
        },
        change_type: "generated",
        human_summary: "Generated a browser preview artifact for screenshot QA.",
        preview_ref: {
          kind: "text",
          href: "/api/previews/regional-launch-review-preview.html"
        },
        evidence_refs: r4EvidenceRefs()
      }
    ],
    checks: [
      {
        id: "live_api_pg_seed",
        label: "Real API + Postgres seed routes are browser reachable",
        status: "passed",
        detail: "The R4.7 smoke drives Vite through the TCP API daemon and seeded DB rows."
      },
      {
        id: "text_box_overflow",
        label: "Dense Web cards do not leak text outside their containers",
        status: "passed",
        detail: "Desktop and mobile route captures include horizontal and text containment checks."
      }
    ],
    evidence_refs: r4EvidenceRefs(),
    risk: {
      level: "low",
      human_label: "Reversible UI/data smoke seed",
      reversible: true
    },
    rollback: {
      available: true,
      snapshot_id: r4WebLiveApiPgSeedIds.baseSnapshotId,
      description: "Remove the R4.7 seed rows and return to the default local seed."
    },
    review: {
      suggested_decision: "approve",
      reason_required_on_reject: true
    }
  });
}

export async function seedR4WebLiveApiPg(
  db: WorkHubDb,
  options: { at?: Date } = {}
): Promise<R4WebLiveApiPgSeedResult> {
  const at = options.at ?? fixedAt;
  await ensureDefaultSeed(db);
  await cleanupR4Rows(db, at);
  const currentUserId = await ensureUser({
    db,
    id: r4WebLiveApiPgSeedIds.userId,
    nickname: reviewerNickname,
    cookieToken: `r4-web-live-api-pg:${r4WebLiveApiPgSeedIds.userId}`,
    at
  });
  const forbiddenActorUserId = await ensureUser({
    db,
    id: r4WebLiveApiPgSeedIds.forbiddenUserId,
    nickname: forbiddenNickname,
    cookieToken: `r4-web-live-api-pg:${r4WebLiveApiPgSeedIds.forbiddenUserId}`,
    at
  });
  const evidenceRefs = r4EvidenceRefs();
  const manifest = r4Manifest({ userId: currentUserId, at });

  await db.insert(workItems).values([
    {
      id: r4WebLiveApiPgSeedIds.workItemId,
      code: "WH-R4-7001",
      projectId: defaultSeedIds.projectId,
      workspaceId: defaultSeedIds.workspaceId,
      submitterUserId: currentUserId,
      claimedByUserId: currentUserId,
      claimedByNickname: reviewerNickname,
      title: "R4.7 live API PG seed review package with deliberately-long-provider-diagnostic-token-alpha-beta-1234567890",
      rawDescription: "Use real API and Postgres data to prove the Web route workbench, path navigation, bilingual reload, and overflow gates.",
      summaryMd: "Real API + PG seeded review package for Web route smoke verification.",
      status: "in_review",
      priority: "high",
      estimateHours: 2,
      estimateConfidence: "high",
      planningNote: "Seeded by seedR4WebLiveApiPg for R4.7 browser acceptance.",
      syncState: "synced",
      mode: "worker",
      humanReserved: false,
      createdAt: at,
      updatedAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.forbiddenWorkItemId,
      code: "WH-R4-7403",
      projectId: defaultSeedIds.projectId,
      workspaceId: defaultSeedIds.workspaceId,
      submitterUserId: forbiddenActorUserId,
      title: "Restricted R4.7 control item",
      rawDescription: "This row proves forbidden route rendering through the real API.",
      summaryMd: "Forbidden route control row for R4.7 smoke.",
      status: "spec_ready",
      priority: "normal",
      syncState: "synced",
      mode: "worker",
      humanReserved: false,
      createdAt: at,
      updatedAt: at
    }
  ]);

  await db.insert(workItemAcceptanceItems).values([
    {
      id: r4WebLiveApiPgSeedIds.acceptanceFitId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      title: "Browser routes use the real API daemon and seeded Postgres rows.",
      description: "The smoke must fail if the API process is not reachable.",
      status: "met",
      sortOrder: 0,
      createdAt: at,
      updatedAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.acceptanceEvidenceId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      title: "Desktop and mobile captures have no text outside card bounds.",
      description: "Long provider and route labels must wrap or clamp inside their containers.",
      status: "met",
      sortOrder: 1,
      createdAt: at,
      updatedAt: at
    }
  ]);

  await db.insert(chatMessages).values({
    id: r4WebLiveApiPgSeedIds.evidenceMessageId,
    workItemId: r4WebLiveApiPgSeedIds.workItemId,
    role: "assistant",
    kind: "evidence_binding",
    contentJson: {
      evidence_refs: evidenceRefs
    },
    createdAt: at,
    updatedAt: at
  });

  await db.insert(branches).values({
    id: r4WebLiveApiPgSeedIds.branchId,
    workItemId: r4WebLiveApiPgSeedIds.workItemId,
    actorKind: "ai",
    actorUserId: currentUserId,
    agentRunId: r4WebLiveApiPgSeedIds.runId,
    kind: "work",
    baseSnapshotId: r4WebLiveApiPgSeedIds.baseSnapshotId,
    headRef: "workhub://branches/r4-web-live-api-pg@draft",
    status: "proposed",
    version: 1,
    createdAt: at,
    updatedAt: at
  });
  await db
    .update(workItems)
    .set({ mainBranchId: r4WebLiveApiPgSeedIds.branchId, updatedAt: at })
    .where(eq(workItems.id, r4WebLiveApiPgSeedIds.workItemId));

  await db.insert(snapshots).values([
    {
      id: r4WebLiveApiPgSeedIds.baseSnapshotId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      branchId: r4WebLiveApiPgSeedIds.branchId,
      kind: "base",
      ref: "snapshots/r4-web-live-api-pg/base",
      contentSha256: sha("a"),
      createdByKind: "system",
      createdAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.draftSnapshotId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      branchId: r4WebLiveApiPgSeedIds.branchId,
      kind: "draft",
      ref: "snapshots/r4-web-live-api-pg/draft",
      contentSha256: sha("b"),
      createdByKind: "ai",
      createdAt: at
    }
  ]);

  await db.insert(agentRuns).values({
    id: r4WebLiveApiPgSeedIds.runId,
    orgId: defaultSeedIds.orgId,
    workspaceId: defaultSeedIds.workspaceId,
    workItemId: r4WebLiveApiPgSeedIds.workItemId,
    branchId: r4WebLiveApiPgSeedIds.branchId,
    mode: "worker",
    actor: "AI",
    actorUserId: currentUserId,
    title: "R4.7 live API PG seed browser smoke",
    status: "running",
    model: "deepseek-v4-flash",
    turnsUsed: 3,
    maxTurns: 15,
    totalTimeoutS: 300,
    maxTokens: 120000,
    maxCostCny: "5.000000",
    seconds: 42.7,
    tokenIn: 64000,
    tokenOut: 12000,
    costEstimate: "0.224000",
    budgetDecisionJson: {
      decision_id: "r4-web-live-api-pg-budget",
      allowed: true,
      run_budget: {
        max_steps: 15,
        total_timeout_s: 300,
        max_tokens: 120000,
        max_cost_cny: "5.00"
      },
      model_route: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        reason: "default"
      }
    },
    handoffMd: "The seeded run is ready for browser QA against the real API daemon.",
    handoffJson: {
      done: ["Seeded work item, proposal, approval, run trace, and cost rows."],
      remaining: ["Review screenshots and approve R4.7 gate."],
      next_steps: ["Run R4.8 Redis/SSE production browser smoke."],
      blockers: [],
      artifacts: ["/outputs/regional-launch-review.md"],
      budget_hit: "ok"
    },
    workdirRef: "workhub://workdirs/r4-web-live-api-pg",
    startedAt: at,
    heartbeatAt: at,
    createdAt: at,
    updatedAt: at
  });

  await db.insert(agentSteps).values([
    {
      id: r4WebLiveApiPgSeedIds.stepPlanId,
      agentRunId: r4WebLiveApiPgSeedIds.runId,
      seq: 1,
      stepNo: 1,
      phase: "think",
      inputJson: { route: "r4.7" },
      outputExcerpt: "Planned real API, Postgres seed, bilingual reload, and text overflow checks.",
      createdAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.stepEvidenceId,
      agentRunId: r4WebLiveApiPgSeedIds.runId,
      seq: 2,
      stepNo: 2,
      phase: "tool_result",
      toolName: "postgres_seed",
      inputJson: { seed: "r4-web-live-api-pg" },
      outputExcerpt: "Inserted route-ready work item, proposal, approval, evidence, and cost records.",
      createdAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.stepFinalId,
      agentRunId: r4WebLiveApiPgSeedIds.runId,
      seq: 3,
      stepNo: 3,
      phase: "final",
      inputJson: {},
      outputExcerpt: "Opened the R4.7 live API review package for approval.",
      snapshotId: r4WebLiveApiPgSeedIds.draftSnapshotId,
      createdAt: at
    }
  ]);

  await db.insert(proposals).values({
    id: r4WebLiveApiPgSeedIds.proposalId,
    workItemId: r4WebLiveApiPgSeedIds.workItemId,
    branchId: r4WebLiveApiPgSeedIds.branchId,
    round: 1,
    title: "R4.7 live API review package",
    status: "reviewed",
    diffManifest: manifest,
    mergeSnapshotId: r4WebLiveApiPgSeedIds.draftSnapshotId,
    openedByKind: "ai",
    openedByUserId: currentUserId,
    reviewedAt: at,
    createdAt: at,
    updatedAt: at
  });
  await db.insert(reviews).values({
    id: r4WebLiveApiPgSeedIds.reviewId,
    proposalId: r4WebLiveApiPgSeedIds.proposalId,
    reviewerKind: "human",
    reviewerUserId: currentUserId,
    decision: "approve",
    reasonMd: "Seeded approval comment for R4.7 browser smoke.",
    createdAt: at,
    updatedAt: at
  });

  await db.insert(approvalRequests).values({
    id: r4WebLiveApiPgSeedIds.approvalId,
    workItemId: r4WebLiveApiPgSeedIds.workItemId,
    agentRunId: r4WebLiveApiPgSeedIds.runId,
    actionPattern: "proposal.review.r4_web_live_api_pg",
    payloadJson: {
      kind: "proposal",
      proposal_id: r4WebLiveApiPgSeedIds.proposalId,
      ui: {
        title: "R4.7 live API review package",
        summary_text: "WorkHub AI prepared the live API and Postgres seed review package for final approval.",
        reason_text: "Approving confirms browser routes, bilingual switching, and text containment passed against real API data.",
        evidence_refs: evidenceRefs
      },
      risk: {
        level: "low",
        reversible: true
      }
    },
    status: "pending",
    routedToUserId: currentUserId,
    slaDueAt: new Date("2026-06-12T08:00:00.000Z"),
    createdAt: at,
    updatedAt: at
  });

  await db.insert(usageRecords).values({
    id: r4WebLiveApiPgSeedIds.usageRecordId,
    runId: r4WebLiveApiPgSeedIds.runId,
    workItemId: r4WebLiveApiPgSeedIds.workItemId,
    userId: currentUserId,
    actorId: "workhub-ai",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    task: "r4_web_live_api_pg_seed",
    source: "agent_step",
    inputTokens: 64000,
    outputTokens: 12000,
    estimatedCostCny: "0.224000",
    createdAt: at
  });
  await db.insert(costLedgerEntries).values([
    {
      id: r4WebLiveApiPgSeedIds.costLedgerUserId,
      usageRecordId: r4WebLiveApiPgSeedIds.usageRecordId,
      runId: r4WebLiveApiPgSeedIds.runId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      userId: currentUserId,
      scopeKind: "user",
      scopeId: currentUserId,
      scopeJson: { kind: "user", userId: currentUserId },
      periodBucket: "2026-06-11",
      tokenIn: 64000,
      tokenOut: 12000,
      estimatedCostCny: "0.224000",
      unitPriceCny: "0.000003",
      currency: "CNY",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      source: "agent_step",
      createdAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.costLedgerTeamId,
      usageRecordId: r4WebLiveApiPgSeedIds.usageRecordId,
      runId: r4WebLiveApiPgSeedIds.runId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      teamId: defaultSeedIds.workspaceId,
      scopeKind: "team",
      scopeId: defaultSeedIds.workspaceId,
      scopeJson: { kind: "team", teamId: defaultSeedIds.workspaceId },
      periodBucket: "2026-06-11",
      tokenIn: 64000,
      tokenOut: 12000,
      estimatedCostCny: "0.224000",
      unitPriceCny: "0.000003",
      currency: "CNY",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      source: "agent_step",
      createdAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.costLedgerWorkItemId,
      usageRecordId: r4WebLiveApiPgSeedIds.usageRecordId,
      runId: r4WebLiveApiPgSeedIds.runId,
      workItemId: r4WebLiveApiPgSeedIds.workItemId,
      scopeKind: "workitem",
      scopeId: r4WebLiveApiPgSeedIds.workItemId,
      scopeJson: { kind: "workitem", workitemId: r4WebLiveApiPgSeedIds.workItemId },
      periodBucket: "2026-06-11",
      tokenIn: 64000,
      tokenOut: 12000,
      estimatedCostCny: "0.224000",
      unitPriceCny: "0.000003",
      currency: "CNY",
      provider: "deepseek",
      model: "deepseek-v4-flash",
      source: "agent_step",
      createdAt: at
    }
  ]);

  await db.insert(auditLogs).values([
    {
      id: r4WebLiveApiPgSeedIds.auditSnapshotId,
      orgId: defaultSeedIds.orgId,
      workspaceId: defaultSeedIds.workspaceId,
      actorKind: "ai",
      actorUserId: currentUserId,
      actorNickname: "WorkHub AI",
      entityType: "agent_run",
      entityId: r4WebLiveApiPgSeedIds.runId,
      action: "snapshot.created",
      detailJson: {
        run_id: r4WebLiveApiPgSeedIds.runId,
        snapshot_id: r4WebLiveApiPgSeedIds.draftSnapshotId,
        ref: "snapshots/r4-web-live-api-pg/draft"
      },
      snapshotId: r4WebLiveApiPgSeedIds.draftSnapshotId,
      createdAt: at
    },
    {
      id: r4WebLiveApiPgSeedIds.auditProposalId,
      orgId: defaultSeedIds.orgId,
      workspaceId: defaultSeedIds.workspaceId,
      actorKind: "ai",
      actorUserId: currentUserId,
      actorNickname: "WorkHub AI",
      entityType: "proposal",
      entityId: r4WebLiveApiPgSeedIds.proposalId,
      action: "proposal.opened",
      detailJson: {
        run_id: r4WebLiveApiPgSeedIds.runId,
        proposal_id: r4WebLiveApiPgSeedIds.proposalId,
        work_item_id: r4WebLiveApiPgSeedIds.workItemId
      },
      snapshotId: r4WebLiveApiPgSeedIds.draftSnapshotId,
      createdAt: at
    }
  ]);

  return {
    ids: {
      ...r4WebLiveApiPgSeedIds,
      currentUserId,
      forbiddenActorUserId
    },
    seededAt: at.toISOString()
  };
}
