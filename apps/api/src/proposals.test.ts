import assert from "node:assert/strict";
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
  ProposalRepositoryMergeConflictError,
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

class MemoryProposalRepository implements ProposalRepository {
  private rows = new Map<string, StoredProposalRows>();
  private reviewCount = 0;
  private acceptedByTargetKey = new Map<string, { proposalId: string; changeId: string; sha256After?: string }>();
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

  async merge(input: Parameters<ProposalRepository["merge"]>[0]) {
    const stored = this.rows.get(input.proposalId);
    if (!stored) {
      return null;
    }
    const at = input.at ?? now;
    const conflicts = stored.proposal.diffManifest.changes
      .map((change) => {
        const key = this.targetKey(change);
        const current = this.acceptedByTargetKey.get(key);
        if (!current || current.proposalId === stored.proposal.id) {
          return null;
        }
        if (change.target_ref.sha256_before) {
          return current.sha256After === change.target_ref.sha256_before ? null : {
            target_key: key,
            change_id: change.id,
            target_kind: change.target_kind,
            change_type: change.change_type,
            existing_proposal_id: current.proposalId,
            existing_change_id: current.changeId,
            ...(change.target_ref.path ? { target_path: change.target_ref.path } : {}),
            ...(current.sha256After ? { existing_sha256_after: current.sha256After } : {}),
            incoming_sha256_before: change.target_ref.sha256_before,
            ...(change.target_ref.sha256_after ? { incoming_sha256_after: change.target_ref.sha256_after } : {})
          };
        }
        if (change.change_type === "created" || change.change_type === "generated") {
          return current.sha256After === change.target_ref.sha256_after ? null : {
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
        }
        return null;
      })
      .filter((conflict): conflict is NonNullable<typeof conflict> => conflict !== null);
    if (conflicts.length > 0) {
      throw new ProposalRepositoryMergeConflictError(conflicts);
    }
    stored.proposal.status = "merged";
    stored.proposal.mergeSnapshotId = input.mergeSnapshotId ?? "91000000-0000-4000-8000-000000000199";
    stored.proposal.mergedAt = at;
    stored.proposal.updatedAt = at;
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
