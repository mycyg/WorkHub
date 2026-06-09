import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import {
  deliverableManifestFixtures,
  type DeliverableChangeManifest
} from "@workhub/contracts";
import {
  ProposalRepositoryInvalidMergeProposalCandidateError,
  ProposalRepositoryMergeConflictError,
  ProposalRepositoryMergeProposalAlreadyChosenError,
  ProposalRepositoryUnsupportedMergeProposalApplyError,
  type MergeAttemptRow,
  type MergeProposalCandidateApplicationContext,
  type MergeProposalRow,
  type StoredProposalRows,
  ClientDeviceAuthRow as DbClientDeviceAuthRow,
  ClientDeviceRepository as DbClientDeviceRepository,
  type ProposalRepository,
  UserAuthRow as DbUserAuthRow,
  UserRepository as DbUserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { buildProposalDetailPage } from "./pages/proposals.js";
import { createPageRoutes } from "./routes/pages.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "./routes/proposals.js";
import { createDbProposalService, createInMemoryProposalService } from "./services/proposals.js";

const now = new Date("2026-06-06T00:00:00.000Z");
const userId = "91000000-0000-4000-8000-000000000001";

function user(): DbUserAuthRow {
  return {
    id: userId,
    nickname: "proposal-reviewer",
    cookieToken: "cookie-proposal-reviewer",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements DbUserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-proposal-reviewer" ? user() : null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<DbUserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: DbUserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements DbClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<DbClientDeviceAuthRow> {
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

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
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

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-proposal-reviewer", runtimeSettings.auth.cookieSecret);
}

function manifest(index = 0): DeliverableChangeManifest {
  const fixture = deliverableManifestFixtures[index] ?? deliverableManifestFixtures[0];
  if (!fixture) {
    throw new Error("missing deliverable manifest fixture");
  }
  return structuredClone(fixture);
}

function ids() {
  const values = [
    "91000000-0000-4000-8000-000000000101",
    "91000000-0000-4000-8000-000000000102",
    "91000000-0000-4000-8000-000000000103",
    "91000000-0000-4000-8000-000000000104",
    "91000000-0000-4000-8000-000000000105",
    "91000000-0000-4000-8000-000000000106"
  ];
  return () => values.shift() ?? "91000000-0000-4000-8000-000000000199";
}

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesUnder(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

class MemoryProposalRepository implements ProposalRepository {
  private rows = new Map<string, StoredProposalRows>();
  private reviewCount = 0;
  private attemptCount = 0;
  private mergeProposalCount = 0;
  private acceptedByTargetKey = new Map<string, { proposalId: string; changeId: string; sha256After?: string }>();
  public readonly mergeAttempts: MergeAttemptRow[] = [];
  public readonly mergeProposals: MergeProposalRow[] = [];
  public readonly branchRows = new Map<string, { status: string; headRef: string | null; version: number }>();
  public readonly workItemRows = new Map<string, {
    status: string;
    mainBranchId: string | null;
    acceptedAt: Date | null;
    version: number;
  }>();

  async createFromManifest(input: Parameters<ProposalRepository["createFromManifest"]>[0]) {
    const at = input.at ?? now;
    const stored: StoredProposalRows = {
      proposal: {
        id: input.proposalId ?? input.manifest.proposal_id ?? "91000000-0000-4000-8000-000000000151",
        workItemId: input.workItemId,
        branchId: input.branchId ?? input.manifest.branch_id ?? "91000000-0000-4000-8000-000000000152",
        round: 1,
        title: input.title ?? input.manifest.title,
        status: "opened",
        diffManifest: input.manifest,
        confidenceId: null,
        mergeSnapshotId: null,
        openedByKind: input.actor.actorKind,
        openedByUserId: input.actor.actorUserId ?? null,
        reviewedAt: null,
        mergedAt: null,
        createdAt: at,
        updatedAt: at
      },
      reviews: []
    };
    this.rows.set(stored.proposal.id, stored);
    this.branchRows.set(stored.proposal.branchId, {
      status: "proposed",
      headRef: input.manifest.base.branch_head_ref ?? null,
      version: 0
    });
    this.workItemRows.set(stored.proposal.workItemId, {
      status: "in_review",
      mainBranchId: null,
      acceptedAt: null,
      version: 0
    });
    return stored;
  }

  async findMergeContext(proposalId: string) {
    const stored = this.rows.get(proposalId);
    if (!stored) {
      return null;
    }
    return {
      proposalId: stored.proposal.id,
      workItemId: stored.proposal.workItemId,
      workItemCode: "WH-TEST",
      projectId: "91000000-0000-4000-8000-000000000901",
      branchId: stored.proposal.branchId,
      agentRunId: null,
      workdirRef: null,
      diffManifest: stored.proposal.diffManifest
    };
  }

  async findAcceptedDriveFileForTarget() {
    return null;
  }

  async findById(proposalId: string) {
    return this.rows.get(proposalId) ?? null;
  }

  async listByWorkItem(workItemId: string) {
    return [...this.rows.values()].filter((row) => row.proposal.workItemId === workItemId);
  }

  async review(input: Parameters<ProposalRepository["review"]>[0]) {
    const stored = this.rows.get(input.proposalId);
    if (!stored) {
      return null;
    }
    const at = input.at ?? now;
    this.reviewCount += 1;
    stored.reviews.push({
      id: `91000000-0000-4000-8000-${String(160 + this.reviewCount).padStart(12, "0")}`,
      proposalId: input.proposalId,
      reviewerKind: input.actor.actorKind,
      reviewerUserId: input.actor.actorUserId ?? null,
      decision: input.decision,
      reasonMd: input.reasonMd ?? null,
      reasonFedBackAt: input.reasonFedBackAt ?? null,
      createdAt: at,
      updatedAt: at
    });
    stored.proposal.status = input.decision === "approve" ? "reviewed" : "rejected";
    stored.proposal.reviewedAt = at;
    stored.proposal.updatedAt = at;
    if (input.decision === "reject") {
      const branch = this.branchRows.get(stored.proposal.branchId);
      if (branch) {
        branch.status = "open";
      }
    }
    return stored;
  }

  private targetKey(change: DeliverableChangeManifest["changes"][number]) {
    if (change.target_ref.entity_id) {
      return `${change.target_ref.entity_type}:${change.target_ref.entity_id}`;
    }
    if (change.target_ref.path) {
      return `${change.target_ref.entity_type}:${change.target_ref.path.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/")}`;
    }
    return `${change.target_ref.entity_type}:${change.id}`;
  }

  private conflictsForStored(stored: StoredProposalRows, acceptedTargetKeys = new Set<string>()) {
    return stored.proposal.diffManifest.changes
      .map((change) => {
        const key = this.targetKey(change);
        if (acceptedTargetKeys.has(key)) {
          return null;
        }
        const current = this.acceptedByTargetKey.get(key);
        if (!current || current.proposalId === stored.proposal.id) {
          return null;
        }
        const base = {
          proposal_id: stored.proposal.id,
          work_item_id: stored.proposal.workItemId,
          proposal_title: stored.proposal.title,
          target_key: key,
          change_id: change.id,
          target_kind: change.target_kind,
          change_type: change.change_type,
          existing_proposal_id: current.proposalId,
          existing_change_id: current.changeId,
          ...(change.target_ref.path ? { target_path: change.target_ref.path } : {}),
          ...(current.sha256After ? { existing_sha256_after: current.sha256After } : {}),
          ...(change.target_ref.sha256_after ? { incoming_sha256_after: change.target_ref.sha256_after } : {})
        };
        if (change.target_ref.sha256_before) {
          return current.sha256After === change.target_ref.sha256_before ? null : {
            ...base,
            incoming_sha256_before: change.target_ref.sha256_before
          };
        }
        if (change.change_type === "created" || change.change_type === "generated") {
          return current.sha256After === change.target_ref.sha256_after ? null : base;
        }
        return null;
      })
      .filter((conflict): conflict is NonNullable<typeof conflict> => conflict !== null);
  }

  async listConflictsByWorkItem(workItemId: string) {
    return [...this.rows.values()]
      .filter((row) => row.proposal.workItemId === workItemId && row.proposal.status === "reviewed")
      .flatMap((row) => this.conflictsForStored(row));
  }

  async listMergeAttemptsByProposal(proposalId: string) {
    return this.mergeAttempts.filter((attempt) => attempt.proposalId === proposalId);
  }

  async listMergeProposalsByAttempt(mergeAttemptId: string) {
    return this.mergeProposals.filter((proposal) => proposal.mergeAttemptId === mergeAttemptId);
  }

  async chooseMergeProposalCandidate(input: Parameters<ProposalRepository["chooseMergeProposalCandidate"]>[0]) {
    const row = this.mergeProposals.find((proposal) => proposal.id === input.mergeProposalId);
    if (!row) {
      return null;
    }
    const candidates = Array.isArray(row.candidatesJson) ? row.candidatesJson : [];
    const hasCandidate = candidates.some((candidate) =>
      candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).option_key === input.optionKey
    );
    if (!hasCandidate) {
      throw new ProposalRepositoryInvalidMergeProposalCandidateError(input.mergeProposalId, input.optionKey);
    }
    if (row.chosenOptionKey && row.chosenOptionKey !== input.optionKey) {
      throw new ProposalRepositoryMergeProposalAlreadyChosenError(input.mergeProposalId, row.chosenOptionKey);
    }
    if (!row.chosenOptionKey) {
      row.chosenOptionKey = input.optionKey;
      row.chosenByUserId = input.actor?.actorUserId ?? null;
      row.chosenAt = input.at ?? now;
      row.updatedAt = input.at ?? now;
    }
    return row;
  }

  async findMergeProposalCandidateForApply(mergeProposalId: string) {
    const row = this.mergeProposals.find((proposal) => proposal.id === mergeProposalId);
    if (!row) {
      return null;
    }
    const attempt = this.mergeAttempts.find((item) => item.id === row.mergeAttemptId);
    if (!attempt) {
      return null;
    }
    const stored = this.rows.get(attempt.proposalId);
    if (!stored) {
      return null;
    }
    const conflicts = Array.isArray(attempt.conflictsJson) ? attempt.conflictsJson : [];
    const conflict = conflicts.find((item) =>
      item && typeof item === "object" && (item as { target_key?: string }).target_key === row.conflictKey
    );
    if (!conflict) {
      return null;
    }
    const candidates = Array.isArray(row.candidatesJson) ? row.candidatesJson : [];
    const applyOptionKey = row.chosenOptionKey ?? "ai_fusion";
    const candidate = candidates.find((item) =>
      item && typeof item === "object" && (item as { option_key?: string }).option_key === applyOptionKey
    );
    return {
      mergeProposalId: row.id,
      proposalId: stored.proposal.id,
      proposalStatus: stored.proposal.status,
      proposalTitle: stored.proposal.title,
      workItemId: stored.proposal.workItemId,
      workItemCode: "WH-TEST",
      projectId: "91000000-0000-4000-8000-000000000901",
      branchId: stored.proposal.branchId,
      conflictKey: row.conflictKey,
      conflict: conflict as MergeProposalCandidateApplicationContext["conflict"],
      chosenOptionKey: row.chosenOptionKey,
      chosenByUserId: row.chosenByUserId,
      chosenAt: row.chosenAt,
      candidate: candidate as MergeProposalCandidateApplicationContext["candidate"],
      diffManifest: stored.proposal.diffManifest
    };
  }

  async applyMergeProposalCandidate(input: Parameters<ProposalRepository["applyMergeProposalCandidate"]>[0]) {
    const context = await this.findMergeProposalCandidateForApply(input.mergeProposalId);
    if (!context) {
      return null;
    }
    if (context.proposalStatus === "merged") {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "proposal_already_merged",
        "Proposal is already merged"
      );
    }
    if (context.proposalStatus !== "reviewed") {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "proposal_not_reviewed",
        "Proposal must be reviewed before applying a merge candidate"
      );
    }
    if (context.chosenOptionKey && context.chosenOptionKey !== "ai_fusion") {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "merge_proposal_apply_requires_ai_fusion",
        "Only ai_fusion candidates can be applied through this route"
      );
    }
    if (!context.candidate?.merged_value || !input.resolvedDriveFile) {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        input.mergeProposalId,
        "merge_candidate_missing_result",
        "Chosen merge candidate does not contain a materialized result"
      );
    }
    const stored = this.rows.get(context.proposalId);
    if (!stored) {
      return null;
    }
    const at = input.at ?? now;
    const mergeProposal = this.mergeProposals.find((proposal) => proposal.id === input.mergeProposalId);
    if (mergeProposal && !mergeProposal.chosenOptionKey) {
      mergeProposal.chosenOptionKey = "ai_fusion";
      mergeProposal.chosenByUserId = input.actor?.actorUserId ?? null;
      mergeProposal.chosenAt = at;
      mergeProposal.updatedAt = at;
    }
    const mergeSnapshotId = input.mergeSnapshotId ?? "91000000-0000-4000-8000-000000000199";
    stored.proposal.status = "merged";
    stored.proposal.mergeSnapshotId = mergeSnapshotId;
    stored.proposal.mergedAt = at;
    stored.proposal.updatedAt = at;
    this.recordMergeAttempt({
      stored,
      actor: input.actor,
      result: "merged",
      conflicts: [context.conflict],
      acceptedTargetKeys: [context.conflictKey],
      mergeSnapshotId,
      candidateSupplements: [
        {
          conflictKey: context.conflictKey,
          recommendedOptionKey: "ai_fusion",
          candidates: [context.candidate]
        }
      ],
      at
    });
    const latestProposal = this.mergeProposals.at(-1);
    if (latestProposal && latestProposal.mergeAttemptId === this.mergeAttempts.at(-1)?.id) {
      latestProposal.chosenOptionKey = "ai_fusion";
      latestProposal.chosenByUserId = input.actor?.actorUserId ?? null;
      latestProposal.chosenAt = at;
      latestProposal.updatedAt = at;
    }
    this.acceptedByTargetKey.set(context.conflictKey, {
      proposalId: stored.proposal.id,
      changeId: input.resolvedDriveFile.changeId,
      ...(input.resolvedDriveFile.sha256 ? { sha256After: input.resolvedDriveFile.sha256 } : {})
    });
    const branch = this.branchRows.get(stored.proposal.branchId);
    if (branch) {
      branch.status = "merged";
      branch.headRef = stored.proposal.mergeSnapshotId;
      branch.version += 1;
    }
    const workItem = this.workItemRows.get(stored.proposal.workItemId);
    if (workItem) {
      workItem.status = "merged";
      workItem.mainBranchId = stored.proposal.branchId;
      workItem.acceptedAt = at;
      workItem.version += 1;
    }
    return stored;
  }

  private candidatesForConflict(conflict: ReturnType<MemoryProposalRepository["conflictsForStored"]>[number]) {
    return [
      {
        option_key: "keep_current",
        target_kind: conflict.target_kind,
        rationale_md: "保留当前正式版，不覆盖已经采纳的交付物。"
      },
      {
        option_key: "accept_incoming",
        target_kind: conflict.target_kind,
        rationale_md: "明确采纳这次版本，覆盖当前正式版，并保留还原入口。"
      }
    ];
  }

  private candidatesWithSupplements(
    conflict: ReturnType<MemoryProposalRepository["conflictsForStored"]>[number],
    candidateSupplements: NonNullable<Parameters<ProposalRepository["merge"]>[0]["candidateSupplements"]> = []
  ) {
    const candidates = this.candidatesForConflict(conflict);
    const supplement = candidateSupplements.find((item) => item.conflictKey === conflict.target_key);
    return [
      ...candidates,
      ...(supplement?.candidates.filter((candidate) =>
        candidate.option_key !== "keep_current" && candidate.option_key !== "accept_incoming"
      ) ?? [])
    ];
  }

  private recordMergeProposals(input: {
    mergeAttemptId: string;
    actor: Parameters<ProposalRepository["merge"]>[0]["actor"];
    conflicts: ReturnType<MemoryProposalRepository["conflictsForStored"]>;
    acceptedTargetKeys: string[];
    candidateSupplements?: Parameters<ProposalRepository["merge"]>[0]["candidateSupplements"];
    at: Date;
  }) {
    const acceptedTargetKeys = new Set(input.acceptedTargetKeys);
    for (const conflict of input.conflicts) {
      const supplement = input.candidateSupplements?.find((item) => item.conflictKey === conflict.target_key);
      this.mergeProposalCount += 1;
      const chosen = acceptedTargetKeys.has(conflict.target_key) ? "accept_incoming" : null;
      this.mergeProposals.push({
        id: `91000000-0000-4000-8000-${String(360 + this.mergeProposalCount).padStart(12, "0")}`,
        mergeAttemptId: input.mergeAttemptId,
        conflictKey: conflict.target_key,
        candidatesJson: this.candidatesWithSupplements(conflict, input.candidateSupplements ?? []),
        recommendedOptionKey: supplement?.recommendedOptionKey ?? "keep_current",
        chosenOptionKey: chosen,
        chosenByUserId: chosen ? input.actor?.actorUserId ?? null : null,
        chosenAt: chosen ? input.at : null,
        createdAt: input.at,
        updatedAt: input.at
      });
    }
  }

  private recordMergeAttempt(input: {
    stored: StoredProposalRows;
    actor: Parameters<ProposalRepository["merge"]>[0]["actor"];
    result: "conflict" | "merged";
    conflicts: ReturnType<MemoryProposalRepository["conflictsForStored"]>;
    acceptedTargetKeys: string[];
    mergeSnapshotId?: string;
    candidateSupplements?: Parameters<ProposalRepository["merge"]>[0]["candidateSupplements"];
    at: Date;
  }) {
    this.attemptCount += 1;
    const targetKeys = input.stored.proposal.diffManifest.changes.map((change) => this.targetKey(change));
    const mergeAttemptId = `91000000-0000-4000-8000-${String(260 + this.attemptCount).padStart(12, "0")}`;
    this.mergeAttempts.push({
      id: mergeAttemptId,
      proposalId: input.stored.proposal.id,
      workItemId: input.stored.proposal.workItemId,
      branchId: input.stored.proposal.branchId,
      actorKind: input.actor?.actorKind ?? "system",
      actorUserId: input.actor?.actorUserId ?? null,
      result: input.result,
      mergeSnapshotId: input.mergeSnapshotId ?? null,
      conflictsJson: input.conflicts,
      acceptedTargetKeys: input.acceptedTargetKeys,
      targetKeys,
      conflictCount: input.conflicts.length,
      createdAt: input.at
    });
    this.recordMergeProposals({
      mergeAttemptId,
      actor: input.actor,
      conflicts: input.conflicts,
      acceptedTargetKeys: input.acceptedTargetKeys,
      candidateSupplements: input.candidateSupplements,
      at: input.at
    });
    return mergeAttemptId;
  }

  async merge(input: Parameters<ProposalRepository["merge"]>[0]) {
    const stored = this.rows.get(input.proposalId);
    if (!stored) {
      return null;
    }
    const at = input.at ?? now;
    const acceptedTargetKeys = [...new Set(input.acceptIncomingTargetKeys ?? [])];
    const allConflicts = this.conflictsForStored(stored);
    const conflicts = this.conflictsForStored(stored, new Set(acceptedTargetKeys));
    if (conflicts.length > 0) {
      this.recordMergeAttempt({
        stored,
        actor: input.actor,
        result: "conflict",
        conflicts,
        acceptedTargetKeys,
        candidateSupplements: input.candidateSupplements,
        at
      });
      throw new ProposalRepositoryMergeConflictError(conflicts);
    }
    const mergeSnapshotId = input.mergeSnapshotId ?? "91000000-0000-4000-8000-000000000199";
    const resolvedConflicts = allConflicts.filter((conflict) => acceptedTargetKeys.includes(conflict.target_key));
    stored.proposal.status = "merged";
    stored.proposal.mergeSnapshotId = mergeSnapshotId;
    stored.proposal.mergedAt = at;
    stored.proposal.updatedAt = at;
    this.recordMergeAttempt({
      stored,
      actor: input.actor,
      result: "merged",
      conflicts: resolvedConflicts,
      acceptedTargetKeys,
      mergeSnapshotId,
      candidateSupplements: input.candidateSupplements,
      at
    });
    for (const change of stored.proposal.diffManifest.changes) {
      this.acceptedByTargetKey.set(this.targetKey(change), {
        proposalId: stored.proposal.id,
        changeId: change.id,
        ...(change.target_ref.sha256_after ? { sha256After: change.target_ref.sha256_after } : {})
      });
    }
    const branch = this.branchRows.get(stored.proposal.branchId);
    if (branch) {
      branch.status = "merged";
      branch.headRef = stored.proposal.mergeSnapshotId;
      branch.version += 1;
    }
    const workItem = this.workItemRows.get(stored.proposal.workItemId);
    if (workItem) {
      workItem.status = "merged";
      workItem.mainBranchId = stored.proposal.branchId;
      workItem.acceptedAt = at;
      workItem.version += 1;
    }
    return stored;
  }
}

function appWithProposalRoutes() {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth, proposals }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals }));
  app.route("/api/pages", createPageRoutes({ auth, proposals, allowUnauthenticatedGoldPath: false }));
  return { app, runtimeSettings };
}

function appWithDbProposalRoutes(options: Parameters<typeof createDbProposalService>[1] = {}) {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const repository = new MemoryProposalRepository();
  const proposals = createDbProposalService(repository, { now: () => now, id: ids(), ...options });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth, proposals }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals }));
  return { app, runtimeSettings, repository };
}

async function createProposal(app: Hono<AuthEnv>, runtimeSettings: Settings, itemManifest = manifest()) {
  const response = await app.request(`/api/workitems/${itemManifest.work_item_id}/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({ manifest: itemManifest })
  });
  assert.equal(response.status, 201);
  return response.json() as Promise<{ ok: true; data: { id: string; diff_manifest: DeliverableChangeManifest } }>;
}

test("DB-backed proposal service maps repository rows into the public proposal contract", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = manifest(1);

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  const reviewed = await service.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });
  const merged = await service.merge({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId }
  });
  const listed = await service.listByWorkItem(itemManifest.work_item_id);

  assert.equal(created.id, "91000000-0000-4000-8000-000000000101");
  assert.equal(created.branch_id, itemManifest.branch_id);
  assert.equal(created.diff_manifest.proposal_id, created.id);
  assert.equal(created.diff_manifest.branch_id, created.branch_id);
  assert.equal(created.opened_by_kind, "ai");
  assert.equal(reviewed.status, "reviewed");
  assert.equal(reviewed.reviews[0]?.decision, "approve");
  assert.equal(reviewed.reviews[0]?.reviewer_user_id, userId);
  assert.equal(merged.status, "merged");
  assert.equal(merged.merge_snapshot_id, "91000000-0000-4000-8000-000000000102");
  assert.equal(repository.branchRows.get(created.branch_id)?.status, "merged");
  assert.equal(repository.branchRows.get(created.branch_id)?.headRef, merged.merge_snapshot_id);
  assert.equal(repository.workItemRows.get(created.work_item_id)?.status, "merged");
  assert.equal(repository.workItemRows.get(created.work_item_id)?.mainBranchId, created.branch_id);
  assert.equal(repository.mergeAttempts.length, 1);
  assert.equal(repository.mergeAttempts[0]?.result, "merged");
  assert.equal(repository.mergeAttempts[0]?.mergeSnapshotId, merged.merge_snapshot_id);
  assert.deepEqual(repository.mergeAttempts[0]?.acceptedTargetKeys, []);
  assert.equal(repository.mergeProposals.length, 0);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, created.id);
});

test("proposal service blocks unreviewed merges and unlocks rejected branches", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = manifest(2);
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });

  await assert.rejects(
    () => service.merge({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId } }),
    /需要先确认/
  );
  assert.equal(repository.branchRows.get(created.branch_id)?.status, "proposed");

  await service.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "request_changes",
    reasonMd: "请补齐证据。"
  });

  assert.equal(repository.branchRows.get(created.branch_id)?.status, "open");
  await assert.rejects(
    () => service.merge({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId } }),
    /已经被打回/
  );
});

test("proposal service blocks merge when the same target was already accepted with a different file hash", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const firstManifest = manifest(3);
  const secondManifest = manifest(3);
  const secondChange = secondManifest.changes[0];
  if (!secondChange) {
    throw new Error("missing fixture change");
  }
  secondManifest.changes = [
    {
      ...secondChange,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      target_ref: {
        ...secondChange.target_ref,
        sha256_after: "b".repeat(64)
      },
      human_summary: "生成了另一张同路径图片。"
    }
  ];

  const first = await service.createFromManifest({
    workItemId: firstManifest.work_item_id,
    manifest: firstManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({
    proposalId: first.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });
  await service.merge({
    proposalId: first.id,
    actor: { actor_kind: "human", actor_user_id: userId }
  });

  const second = await service.createFromManifest({
    workItemId: secondManifest.work_item_id,
    manifest: secondManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({
    proposalId: second.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });

  await assert.rejects(
    () => service.merge({ proposalId: second.id, actor: { actor_kind: "human", actor_user_id: userId } }),
    /撞车/
  );
  assert.equal(repository.mergeAttempts.filter((attempt) => attempt.proposalId === second.id).length, 1);
  assert.equal(repository.mergeAttempts.find((attempt) => attempt.proposalId === second.id)?.result, "conflict");
  const blockedAttemptId = repository.mergeAttempts.find((attempt) => attempt.proposalId === second.id)?.id;
  const blockedCandidates = repository.mergeProposals.filter((proposal) => proposal.mergeAttemptId === blockedAttemptId);
  assert.equal(blockedCandidates.length, 1);
  assert.equal(blockedCandidates[0]?.recommendedOptionKey, "keep_current");
  assert.equal(blockedCandidates[0]?.chosenOptionKey, null);
  assert.equal(
    (blockedCandidates[0]?.candidatesJson as Array<{ option_key: string }>).some(
      (candidate) => candidate.option_key === "accept_incoming"
    ),
    true
  );
  const conflicts = await service.listConflicts(firstManifest.work_item_id);
  const conflict = conflicts.conflicts[0];

  assert.equal(conflicts.empty_state, undefined);
  assert.equal(conflict?.proposal_id, second.id);
  assert.equal(conflict?.recommended_option_id, "keep_current");
  assert.equal(conflict?.options.some((option) => option.id === "accept_incoming"), true);
  assert.deepEqual(
    conflict?.options.find((option) => option.id === "accept_incoming")?.action?.request_json,
    { conflict_resolution: { accept_incoming_target_keys: [conflict.target_key] } }
  );

  const merged = await service.merge({
    proposalId: second.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    conflictResolution: { acceptIncomingTargetKeys: [conflict?.target_key ?? ""] }
  });

  assert.equal(merged.status, "merged");
  const attempts = repository.mergeAttempts.filter((attempt) => attempt.proposalId === second.id);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1]?.result, "merged");
  assert.deepEqual(attempts[1]?.acceptedTargetKeys, [conflict?.target_key]);
  assert.equal(attempts[1]?.conflictCount, 1);
  const resolvedCandidates = repository.mergeProposals.filter((proposal) => proposal.mergeAttemptId === attempts[1]?.id);
  assert.equal(resolvedCandidates.length, 1);
  assert.equal(resolvedCandidates[0]?.chosenOptionKey, "accept_incoming");
  assert.equal(resolvedCandidates[0]?.chosenByUserId, userId);
});

test("proposal service persists AI fusion candidates when the mediator supplies one", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, {
    now: () => now,
    id: ids(),
    fusionCandidateGenerator: {
      async generate(input) {
        const conflict = input.conflicts[0];
        if (!conflict) {
          return [];
        }
        return [
          {
            conflictKey: conflict.target_key,
            recommendedOptionKey: "ai_fusion",
            candidates: [
              {
                option_key: "ai_fusion",
                target_kind: conflict.target_kind,
                rationale_md: "AI 建议保留正式版的结论，同时吸收这次版本里新增的证据说明。",
                source: "llm",
                quality_gate: { status: "passed" },
                merged_value: {
                  proposed_resolution_md: "保留已采纳交付物，并把新增证据说明作为下一轮修订要求。"
                }
              }
            ]
          }
        ];
      }
    }
  });
  const firstManifest = manifest(3);
  const secondManifest = manifest(3);
  const secondChange = secondManifest.changes[0];
  if (!secondChange) {
    throw new Error("missing fixture change");
  }
  secondManifest.changes = [
    {
      ...secondChange,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      target_ref: {
        ...secondChange.target_ref,
        sha256_after: "c".repeat(64)
      },
      human_summary: "生成了带新增证据说明的同路径文件。"
    }
  ];

  const first = await service.createFromManifest({
    workItemId: firstManifest.work_item_id,
    manifest: firstManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: first.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });
  await service.merge({ proposalId: first.id, actor: { actor_kind: "human", actor_user_id: userId } });

  const second = await service.createFromManifest({
    workItemId: secondManifest.work_item_id,
    manifest: secondManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: second.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  let conflictError: unknown;
  try {
    await service.merge({ proposalId: second.id, actor: { actor_kind: "human", actor_user_id: userId } });
  } catch (error) {
    conflictError = error;
  }

  assert.ok(conflictError instanceof Error);
  assert.match(conflictError.message, /撞车/);
  const blockedAttemptId = repository.mergeAttempts.find((attempt) => attempt.proposalId === second.id)?.id;
  const blockedCandidates = repository.mergeProposals.filter((proposal) => proposal.mergeAttemptId === blockedAttemptId);
  assert.equal(blockedCandidates.length, 1);
  assert.equal(blockedCandidates[0]?.recommendedOptionKey, "ai_fusion");
  assert.equal(
    (blockedCandidates[0]?.candidatesJson as Array<{ option_key: string }>).some(
      (candidate) => candidate.option_key === "ai_fusion"
    ),
    true
  );
});

test("proposal routes create, read, and render a page VM from a DeliverableChangeManifest", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(0));
  const proposalId = created.data.id;

  assert.equal(created.data.diff_manifest.proposal_id, proposalId);
  assert.equal(created.data.diff_manifest.changes[0]?.target_kind, "binary_doc");

  const raw = await app.request(`/api/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const list = await app.request(`/api/workitems/${created.data.diff_manifest.work_item_id}/proposals`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const page = await app.request(`/api/pages/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(raw.status, 200);
  assert.equal(list.status, 200);
  assert.equal(page.status, 200);
  const rawBody = await raw.json() as { ok: true; data: { diff_manifest: DeliverableChangeManifest } };
  const listBody = await list.json() as { ok: true; data: { id: string }[] };
  const pageBody = await page.json() as { ok: true; data: ReturnType<typeof buildProposalDetailPage> };

  assert.equal(rawBody.data.diff_manifest.proposal_id, proposalId);
  assert.equal(listBody.data.some((proposal) => proposal.id === proposalId), true);
  assert.equal(pageBody.data.proposal_id, proposalId);
  assert.equal(pageBody.data.manifest.review.reason_required_on_reject, true);
  assert.equal(pageBody.data.review_actions.request_changes.requires_reason, true);
});

test("proposal review requires reasons for changes and feeds them back into the next agent context", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(2));
  const proposalId = created.data.id;
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const missingReason = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes" })
  });
  assert.equal(missingReason.status, 422);

  const response = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes", reason_md: "请补齐数据来源和口径说明。" })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      status: string;
      next_agent_context?: { correction: string; reason_fed_back: boolean };
      attention: { cuu_state?: string };
      event: { type: string };
      feedback_event?: { type: string; cuu_state?: string; data: { reason_fed_back?: boolean } };
      audit_logs?: { action: string; detail_json: { reason_fed_back?: boolean } }[];
    };
  };
  assert.equal(body.data.status, "revision_requested");
  assert.equal(body.data.next_agent_context?.correction, "请补齐数据来源和口径说明。");
  assert.equal(body.data.next_agent_context?.reason_fed_back, true);
  assert.equal(body.data.attention.cuu_state, "revision_requested");
  assert.equal(body.data.event.type, "proposal.reviewed");
  assert.equal(body.data.feedback_event?.type, "revision.fedback");
  assert.equal(body.data.feedback_event?.cuu_state, "revision_requested");
  assert.equal(body.data.feedback_event?.data.reason_fed_back, true);
  assert.equal(body.data.audit_logs?.some((log) => log.action === "reason_fed_back"), true);
  assert.equal(body.data.audit_logs?.[0]?.detail_json.reason_fed_back, true);
});

test("approved proposal can be merged with proposal events, audit facts, and rollback payload", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(3));
  const proposalId = created.data.id;
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const review = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(review.status, 200);

  const reviewedPage = await app.request(`/api/pages/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const reviewedPageBody = await reviewedPage.json() as {
    ok: true;
    data: { status: string; review_actions: { merge?: { href: string } } };
  };
  assert.equal(reviewedPageBody.data.status, "reviewed");
  assert.equal(reviewedPageBody.data.review_actions.merge?.href, `/api/proposals/${proposalId}/merge`);

  const merge = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(merge.status, 200);
  const mergeBody = await merge.json() as {
    ok: true;
    data: {
      status: string;
      rollback_available: boolean;
      rollback: { available: boolean };
      events: { type: string }[];
      audit_logs: { action: string; snapshot_id?: string }[];
      attention: { cuu_state?: string };
    };
  };
  assert.equal(mergeBody.data.status, "merged");
  assert.equal(mergeBody.data.rollback_available, true);
  assert.equal(mergeBody.data.rollback.available, true);
  assert.equal(mergeBody.data.events.some((event) => event.type === "proposal.merged"), true);
  assert.equal(mergeBody.data.events.some((event) => event.type === "notification.created"), true);
  assert.equal(mergeBody.data.audit_logs.some((log) => log.action === "proposal.merged" && log.snapshot_id), true);
  assert.equal(mergeBody.data.attention.cuu_state, "celebrating");
});

test("proposal routes expose conflict cards, choose AI candidates, and apply an AI fusion artifact", async (t) => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "workhub-proposal-apply-"));
  t.after(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });
  const { app, runtimeSettings, repository } = appWithDbProposalRoutes({
    storageRoot,
    fusionCandidateGenerator: {
      async generate(input) {
        const conflict = input.conflicts[0];
        if (!conflict) {
          return [];
        }
        return [
          {
            conflictKey: conflict.target_key,
            recommendedOptionKey: "ai_fusion",
            candidates: [
              {
                option_key: "ai_fusion",
                target_kind: conflict.target_kind,
                rationale_md: "AI 已生成一个融合稿；用户点击后会写回正式交付物。",
                source: "llm",
                quality_gate: { status: "passed" },
                merged_value: { proposed_resolution_md: "融合正式版和这次版本的说明。" }
              }
            ]
          }
        ];
      }
    }
  });
  const firstManifest = manifest(3);
  const secondManifest = manifest(3);
  const firstChange = firstManifest.changes[0];
  const secondChange = secondManifest.changes[0];
  if (!firstChange || !secondChange) {
    throw new Error("missing fixture change");
  }
  firstManifest.changes = [
    {
      ...firstChange,
      target_kind: "text_doc",
      target_ref: {
        ...firstChange.target_ref,
        path: "outputs/result.md",
        sha256_after: "a".repeat(64)
      },
      human_summary: "生成了第一版文本说明。"
    }
  ];
  secondManifest.changes = [
    {
      ...secondChange,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      target_kind: "text_doc",
      target_ref: {
        ...secondChange.target_ref,
        path: "outputs/result.md",
        sha256_after: "b".repeat(64)
      },
      human_summary: "生成了另一版同路径文本说明。"
    }
  ];
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const first = await createProposal(app, runtimeSettings, firstManifest);
  await app.request(`/api/proposals/${first.data.id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  const firstMerge = await app.request(`/api/proposals/${first.data.id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(firstMerge.status, 200);

  const second = await createProposal(app, runtimeSettings, secondManifest);
  await app.request(`/api/proposals/${second.data.id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  const blocked = await app.request(`/api/proposals/${second.data.id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(blocked.status, 409);
  const blockedBody = await blocked.json() as {
    ok: false;
    error: {
      code: string;
      details?: {
        conflicts?: Array<{
          target_key: string;
          merge_proposal_id?: string;
          recommended_option_id: string;
          options: Array<{
            id: string;
            label?: string;
            action?: { id: string; href: string; request_json?: Record<string, unknown> };
          }>;
        }>;
      };
    };
  };
  const conflict = blockedBody.error.details?.conflicts?.[0];
  const targetKey = conflict?.target_key;
  const aiFusionOption = conflict?.options.find((option) => option.id === "ai_fusion");
  assert.equal(blockedBody.error.code, "merge_conflict");
  assert.equal(conflict?.recommended_option_id, "ai_fusion");
  assert.equal(conflict?.options.some((option) => option.id === "accept_incoming"), true);
  assert.equal(aiFusionOption?.label, "采用 AI 融合稿");
  assert.equal(aiFusionOption?.action?.id, "apply_ai_fusion");
  assert.equal(typeof targetKey, "string");
  const mergeProposalId = conflict?.merge_proposal_id;
  assert.equal(typeof mergeProposalId, "string");
  assert.equal(mergeProposalId, repository.mergeProposals[0]?.id);
  assert.equal(aiFusionOption?.action?.href, `/api/merge-proposals/${mergeProposalId}/apply`);
  assert.deepEqual(aiFusionOption?.action?.request_json, { confirm: true });

  const conflicts = await app.request(`/api/workitems/${secondManifest.work_item_id}/conflicts`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(conflicts.status, 200);
  const conflictBody = await conflicts.json() as {
    ok: true;
    data: {
      conflicts: Array<{
        target_key: string;
        merge_proposal_id?: string;
        recommended_option_id: string;
        options: Array<{ id: string; action?: { id: string; href: string } }>;
      }>;
    };
  };
  assert.equal(conflictBody.data.conflicts[0]?.target_key, targetKey);
  assert.equal(conflictBody.data.conflicts[0]?.merge_proposal_id, mergeProposalId);
  assert.equal(conflictBody.data.conflicts[0]?.recommended_option_id, "ai_fusion");
  assert.equal(
    conflictBody.data.conflicts[0]?.options.find((option) => option.id === "ai_fusion")?.action?.href,
    `/api/merge-proposals/${mergeProposalId}/apply`
  );

  const resolved = await app.request(`/api/merge-proposals/${mergeProposalId}/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(resolved.status, 200);
  const resolvedBody = await resolved.json() as { ok: true; data: { status: string; merge_snapshot_id: string } };
  assert.equal(resolvedBody.data.status, "merged");
  assert.equal(typeof resolvedBody.data.merge_snapshot_id, "string");
  assert.equal(repository.mergeProposals.find((proposal) => proposal.id === mergeProposalId)?.chosenOptionKey, "ai_fusion");
  assert.equal(repository.mergeProposals.find((proposal) => proposal.id === mergeProposalId)?.chosenByUserId, userId);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "merged");
  assert.deepEqual(repository.mergeAttempts.at(-1)?.acceptedTargetKeys, [targetKey]);
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
  assert.equal(repository.workItemRows.get(secondManifest.work_item_id)?.status, "merged");
  const materializedFiles = await filesUnder(storageRoot);
  assert.equal(materializedFiles.length, 1);
  const resolvedText = await readFile(materializedFiles[0]!, "utf8");
  assert.equal(resolvedText, "融合正式版和这次版本的说明。");
  assert.doesNotMatch(resolvedText, /AI 融合正式稿|```json|Merge Proposal ID/u);

  const chosenAi = await app.request(`/api/merge-proposals/${mergeProposalId}/choose`, {
    method: "POST",
    headers,
    body: JSON.stringify({ option_key: "ai_fusion" })
  });
  assert.equal(chosenAi.status, 200);
  const chosenAiBody = await chosenAi.json() as {
    ok: true;
    data: {
      merge_proposal_id: string;
      chosen_option_key: string;
      chosen_by_user_id: string;
      candidate: { option_key: string; source?: string };
    };
  };
  assert.equal(chosenAiBody.data.merge_proposal_id, mergeProposalId);
  assert.equal(chosenAiBody.data.chosen_option_key, "ai_fusion");
  assert.equal(chosenAiBody.data.chosen_by_user_id, userId);
  assert.equal(chosenAiBody.data.candidate.option_key, "ai_fusion");
  assert.equal(chosenAiBody.data.candidate.source, "llm");

  const overwriteChoice = await app.request(`/api/merge-proposals/${mergeProposalId}/choose`, {
    method: "POST",
    headers,
    body: JSON.stringify({ option_key: "keep_current" })
  });
  assert.equal(overwriteChoice.status, 409);

  const reapply = await app.request(`/api/merge-proposals/${mergeProposalId}/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(reapply.status, 409);
});
