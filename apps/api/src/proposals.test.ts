import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
  ProposalRepositoryBranchWorkItemMismatchError,
  ProposalRepositoryInvalidMergeProposalCandidateError,
  ProposalRepositoryMergeConflictError,
  ProposalRepositoryMergeProposalAlreadyChosenError,
  ProposalRepositoryRebaseRequiredError,
  ProposalRepositoryStaleBaseError,
  ProposalRepositoryUnsupportedMergeProposalApplyError,
  type UpsertUserMemoryInput,
  type MergeAttemptRow,
  type MergeProposalCandidateApplicationContext,
  type MergeProposalRow,
  type ProposalAcceptedDriveFile,
  type ReviewRow,
  type StoredProposalRows,
  ClientDeviceAuthRow as DbClientDeviceAuthRow,
  ClientDeviceRepository as DbClientDeviceRepository,
  ProposalRepositoryConflictError,
  type ProposalRepository,
  UserAuthRow as DbUserAuthRow,
  UserRepository as DbUserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";
import { buildProposalDetailPage } from "./pages/proposals.js";
import { createPageRoutes } from "./routes/pages.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "./routes/proposals.js";
import {
  createDbProposalService,
  createInMemoryProposalService,
  ProposalServiceError,
  ProposalServiceMergeConflictError,
  ProposalServiceRebaseRequiredError,
  drivePathFromTargetPath,
  readBaseSnapshotFusionExcerpt,
  type ProposalService,
  type StoredProposal
} from "./services/proposals.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

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
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
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

function allowingWorkItems(): Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts" | "canReadWorkItems"> {
  return {
    async detailPage() {
      return {
        workitem: {},
        acceptance: [],
        agent_trace_preview: [],
        latest_proposal: undefined,
        accepted_deliverables: [],
        evidence_refs: []
      } as unknown as Awaited<ReturnType<WorkItemService["detailPage"]>>;
    },
    async assertCanMutateArtifacts() {
      return;
    },
    // R9 批次1-1：路由层可见性改走轻量批量接口（接口扩方法，非行为变化）；allowing=全可见。
    async canReadWorkItems({ workItemIds }: { workItemIds: string[] }) {
      return new Set(workItemIds);
    }
  };
}

function denyingWorkItems(): Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts" | "canReadWorkItems"> {
  return {
    async detailPage() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限查看这个事项。");
    },
    async assertCanMutateArtifacts() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    },
    // denying=全不可见，与 detailPage 403 语义一致。
    async canReadWorkItems() {
      return new Set<string>();
    }
  };
}

function readOnlyWorkItems(): Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts"> {
  return {
    async detailPage() {
      return {
        workitem: {},
        acceptance: [],
        agent_trace_preview: [],
        latest_proposal: undefined,
        accepted_deliverables: [],
        evidence_refs: []
      } as unknown as Awaited<ReturnType<WorkItemService["detailPage"]>>;
    },
    async assertCanMutateArtifacts() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    }
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
    if (error instanceof ProposalServiceError) {
      // 镜像生产 app.onError：保留真实 code 与冲突/rebase 子类的 details。
      const details = error instanceof ProposalServiceRebaseRequiredError
        ? { conflicts: error.conflicts, card: error.card }
        : error instanceof ProposalServiceMergeConflictError
          ? { conflicts: error.conflicts }
          : undefined;
      return c.json({ ok: false, error: { code: error.code, message: error.message, ...(details ? { details } : {}) } }, error.status as 400);
    }
    if (error instanceof WorkItemServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
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

function structuredManifest(): DeliverableChangeManifest {
  const fixture = deliverableManifestFixtures.find((item) =>
    item.changes.some((change) => change.target_kind === "structured_record")
  );
  if (!fixture) {
    throw new Error("missing structured manifest fixture");
  }
  return structuredClone(fixture);
}

function taskPlanManifest(): DeliverableChangeManifest {
  const base = manifest();
  const change = base.changes[0];
  if (!change) {
    throw new Error("missing base change fixture");
  }
  const planId = "91000000-0000-4000-8000-000000000991";
  return {
    ...base,
    title: "计划提议",
    summary_md: "请先确认这份任务拆解计划。",
    changes: [{
      ...change,
      id: planId,
      target_kind: "structured_record",
      target_ref: {
        entity_type: "task_plan",
        entity_id: planId,
        path: `/workspaces/92000000-0000-4000-8000-000000000001/task-plans/${planId}`
      },
      change_type: "generated",
      human_summary: "新增可审的任务计划草稿。",
      machine_summary: {
        changed_fields: ["task_plan_items"],
        generated_content_md: "1. 调研证据\n2. 产出短报告"
      }
    }]
  };
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

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

type MemoryWorkItemRow = {
  status: string;
  mainBranchId: string | null;
  acceptedAt: Date | null;
  version: number;
  title: string | null;
  summaryMd: string | null;
  priority: string;
  dueAt: Date | null;
};

type MemoryAcceptanceItemRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  source_plan_id: string | null;
};

type MemoryTaskItemRow = {
  id: string;
  title: string;
  description: string | null;
  item_type: string;
  suggested_user_id: string | null;
  estimate_hours: number | null;
  sort_order: number;
};

type MemoryTaskPlanRow = {
  id: string;
  work_item_id: string;
  stage: string;
  status: string;
  summary: string | null;
  items: MemoryTaskItemRow[];
};

function memoryWorkItemFieldValue(row: MemoryWorkItemRow, field: string) {
  if (field === "title") return row.title;
  if (field === "summary_md") return row.summaryMd;
  if (field === "priority") return row.priority;
  if (field === "due_at") return row.dueAt ? row.dueAt.toISOString() : null;
  return undefined;
}

function normalizeMemoryAcceptanceItems(value: unknown): MemoryAcceptanceItemRow[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: MemoryAcceptanceItemRow[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item["id"] !== "string" || typeof item["title"] !== "string" || item["title"].trim().length === 0) {
      return undefined;
    }
    const status = typeof item["status"] === "string" ? item["status"] : "open";
    if (!["open", "met", "unmet", "waived"].includes(status)) {
      return undefined;
    }
    const id = item["id"];
    if (seen.has(id)) {
      return undefined;
    }
    seen.add(id);
    normalized.push({
      id,
      title: item["title"].trim(),
      description: typeof item["description"] === "string" ? item["description"] : null,
      status,
      sort_order: typeof item["sort_order"] === "number" && Number.isInteger(item["sort_order"]) ? item["sort_order"] : index,
      source_plan_id: typeof item["source_plan_id"] === "string" ? item["source_plan_id"] : null
    });
  }
  return normalized.sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

function memoryAcceptanceItemsEqual(left: unknown, right: unknown) {
  const normalizedLeft = normalizeMemoryAcceptanceItems(left);
  const normalizedRight = normalizeMemoryAcceptanceItems(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function normalizeMemoryTaskItems(value: unknown): MemoryTaskItemRow[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const seen = new Set<string>();
  const normalized: MemoryTaskItemRow[] = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return undefined;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item["id"] !== "string" || typeof item["title"] !== "string" || item["title"].trim().length === 0) {
      return undefined;
    }
    const itemType = typeof item["item_type"] === "string" ? item["item_type"] : "task";
    if (!["task", "risk", "acceptance"].includes(itemType)) {
      return undefined;
    }
    let estimateHours: number | null = null;
    if (typeof item["estimate_hours"] === "number") {
      if (!Number.isFinite(item["estimate_hours"]) || item["estimate_hours"] < 0) {
        return undefined;
      }
      estimateHours = item["estimate_hours"];
    } else if (item["estimate_hours"] !== undefined && item["estimate_hours"] !== null) {
      return undefined;
    }
    const id = item["id"];
    if (seen.has(id)) {
      return undefined;
    }
    seen.add(id);
    normalized.push({
      id,
      title: item["title"].trim(),
      description: typeof item["description"] === "string" ? item["description"] : null,
      item_type: itemType,
      suggested_user_id: typeof item["suggested_user_id"] === "string" ? item["suggested_user_id"] : null,
      estimate_hours: estimateHours,
      sort_order: typeof item["sort_order"] === "number" && Number.isInteger(item["sort_order"]) ? item["sort_order"] : index
    });
  }
  return normalized.sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
}

function memoryTaskItemsEqual(left: unknown, right: unknown) {
  const normalizedLeft = normalizeMemoryTaskItems(left);
  const normalizedRight = normalizeMemoryTaskItems(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function memoryComparableFieldValue(field: string, value: unknown) {
  if (field !== "due_at") {
    return value;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return value;
}

function memoryFieldValuesEqual(field: string, left: unknown, right: unknown) {
  return memoryComparableFieldValue(field, left) === memoryComparableFieldValue(field, right);
}

class MemoryProposalRepository implements ProposalRepository {
  private rows = new Map<string, StoredProposalRows>();
  private reviewCount = 0;
  private attemptCount = 0;
  private mergeProposalCount = 0;
  private acceptedByTargetKey = new Map<string, { proposalId: string; changeId: string; sha256After?: string }>();
  public readonly mergeAttempts: MergeAttemptRow[] = [];
  public readonly mergeProposals: MergeProposalRow[] = [];
  public readonly mergeInputs: Parameters<ProposalRepository["merge"]>[0][] = [];
  public readonly branchRows = new Map<string, { workItemId: string; status: string; headRef: string | null; version: number }>();
  public readonly workItemRows = new Map<string, MemoryWorkItemRow>();
  public readonly acceptanceItems = new Map<string, MemoryAcceptanceItemRow[]>();
  public readonly taskItems = new Map<string, MemoryTaskItemRow[]>();
  public readonly taskPlans = new Map<string, MemoryTaskPlanRow[]>();
  public readonly acceptedDriveFiles = new Map<string, ProposalAcceptedDriveFile[]>();
  public readonly workdirRefs = new Map<string, string>();
  public readonly baseSnapshotRefs = new Map<string, string>();
  public readonly forceStaleBase = new Set<string>();

  get acceptedTargetCount() {
    return this.acceptedByTargetKey.size;
  }

  async createFromManifest(input: Parameters<ProposalRepository["createFromManifest"]>[0]) {
    const at = input.at ?? now;
    const workItem: MemoryWorkItemRow = this.workItemRows.get(input.workItemId) ?? {
      status: "in_review",
      mainBranchId: null,
      acceptedAt: null,
      version: 0,
      title: null,
      summaryMd: null,
      priority: "normal",
      dueAt: null
    };
    const manifest = structuredClone(input.manifest);
    manifest.changes = manifest.changes.map((change) => {
      if (
        change.target_kind !== "structured_record"
        || change.target_ref.entity_type !== "work_item"
        || change.target_ref.entity_id !== input.workItemId
      ) {
        return change;
      }
      const fieldValuesBefore = Object.fromEntries(
        (change.machine_summary?.changed_fields ?? [])
          .map((field) => {
            if (field === "acceptance_items") {
              return [field, this.acceptanceItems.get(input.workItemId) ?? []] as const;
            }
            if (field === "task_items") {
              return [field, this.taskItems.get(input.workItemId) ?? []] as const;
            }
            return [field, memoryWorkItemFieldValue(workItem, field)] as const;
          })
          .filter(([, value]) => value !== undefined)
      );
      return {
        ...change,
        machine_summary: {
          ...change.machine_summary,
          field_values_before: {
            ...(change.machine_summary?.field_values_before ?? {}),
            ...fieldValuesBefore
          }
        }
      };
    });
    const branchId = input.branchId ?? manifest.branch_id ?? "91000000-0000-4000-8000-000000000152";
    const existingBranch = this.branchRows.get(branchId);
    if (existingBranch && existingBranch.workItemId !== input.workItemId) {
      throw new ProposalRepositoryBranchWorkItemMismatchError(branchId);
    }
    const stored: StoredProposalRows = {
      proposal: {
        id: input.proposalId ?? manifest.proposal_id ?? "91000000-0000-4000-8000-000000000151",
        workItemId: input.workItemId,
        branchId,
        round: 1,
        title: input.title ?? manifest.title,
        status: "opened",
        diffManifest: manifest,
        // R13 批 P1.5 ripple：proposals 加了 diffStatsJson 列（nullable），这份 fixture 满足的
        // ProposalRow 类型形状要求这个 key 存在——null=还没跑过右栏"变动文件"统计，无行为断言变化。
        diffStatsJson: null,
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
      workItemId: stored.proposal.workItemId,
      status: "proposed",
      headRef: manifest.base.branch_head_ref ?? null,
      version: 0
    });
    this.workItemRows.set(stored.proposal.workItemId, workItem);
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
      workdirRef: this.workdirRefs.get(proposalId) ?? null,
      baseSnapshotRef: this.baseSnapshotRefs.get(proposalId) ?? null,
      diffManifest: stored.proposal.diffManifest
    };
  }

  async findAcceptedDriveFileForTarget(input: Parameters<ProposalRepository["findAcceptedDriveFileForTarget"]>[0]) {
    const rows = this.acceptedDriveFiles.get(input.targetKey) ?? [];
    const refSha = input.ref?.replace(/^sha256:/iu, "");
    const sha = input.sha256?.replace(/^sha256:/iu, "");
    if (input.ref || input.sha256) {
      return rows.find((row) =>
        (input.ref && row.acceptedRef === input.ref)
        || (refSha && row.sha256After === refSha)
        || (sha && row.sha256After === sha)
      ) ?? null;
    }
    return rows.find((row) => row.acceptedRef === "current") ?? rows[0] ?? null;
  }

  private resolveTaskItemsForPatch(workItemId: string, scope?: { targetPlanId: string }) {
    const plans = this.taskPlans.get(workItemId) ?? [];
    if (scope?.targetPlanId) {
      const matched = plans.find((plan) => plan.id === scope.targetPlanId);
      if (!matched) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          "memory",
          "task_plan_scope_invalid",
          "Selected task plan does not belong to this WorkItem"
        );
      }
      return matched.items;
    }
    if (plans.length > 1) {
      throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
        "memory",
        "task_plan_scope_required",
        "Multiple task plans exist; choose a target task plan before writing task_items"
      );
    }
    return plans[0]?.items ?? this.taskItems.get(workItemId) ?? [];
  }

  private writeTaskItemsForPatch(workItemId: string, items: MemoryTaskItemRow[], scope?: { targetPlanId: string }) {
    const plans = this.taskPlans.get(workItemId) ?? [];
    if (scope?.targetPlanId) {
      const matched = plans.find((plan) => plan.id === scope.targetPlanId);
      if (!matched) {
        throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
          "memory",
          "task_plan_scope_invalid",
          "Selected task plan does not belong to this WorkItem"
        );
      }
      matched.items = items;
      return;
    }
    if (plans.length === 1) {
      plans[0]!.items = items;
      return;
    }
    this.taskItems.set(workItemId, items);
  }

  async findById(proposalId: string) {
    return this.rows.get(proposalId) ?? null;
  }

  async findProposalByMergeProposalId(mergeProposalId: string) {
    const mergeProposal = this.mergeProposals.find((proposal) => proposal.id === mergeProposalId);
    if (!mergeProposal) {
      return null;
    }
    const attempt = this.mergeAttempts.find((item) => item.id === mergeProposal.mergeAttemptId);
    return attempt ? this.rows.get(attempt.proposalId) ?? null : null;
  }

  async listByWorkItem(workItemId: string) {
    return [...this.rows.values()].filter((row) => row.proposal.workItemId === workItemId);
  }

  async listReviewable(input: Parameters<ProposalRepository["listReviewable"]>[0]) {
    void input;
    return [...this.rows.values()]
      .filter((row) => row.proposal.status === "opened" || row.proposal.status === "reviewed")
      .map((row) => ({
        id: row.proposal.id,
        workItemId: row.proposal.workItemId,
        title: row.proposal.title,
        status: row.proposal.status,
        diffManifest: row.proposal.diffManifest,
        createdAt: row.proposal.createdAt
      }));
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

  async listMergeAttemptsByProposals(proposalIds: string[]) {
    return this.mergeAttempts.filter((attempt) => proposalIds.includes(attempt.proposalId));
  }

  async listMergeProposalsByAttempts(mergeAttemptIds: string[]) {
    return this.mergeProposals.filter((proposal) => mergeAttemptIds.includes(proposal.mergeAttemptId));
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
    if (!context.candidate?.merged_value || (!input.resolvedDriveFile && !input.resolvedStructuredFieldPatch)) {
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
    // R2 audit#11：模拟真库 L3 最后防线撞车——有 base 快照 → rebase_required（可对底稿再采纳）；否则裸 stale_base。
    // 与本假仓库 merge() 同口径(1094)；此前候选-apply 不模拟撞车,故服务层的 rebase 分支无单测覆盖。
    if (this.forceStaleBase.has(context.proposalId)) {
      throw this.baseSnapshotRefs.has(context.proposalId)
        ? new ProposalRepositoryRebaseRequiredError([context.conflictKey])
        : new ProposalRepositoryStaleBaseError(context.conflictKey);
    }
    const at = input.at ?? now;
    const workItem = this.workItemRows.get(stored.proposal.workItemId);
    if (workItem && input.resolvedStructuredFieldPatch) {
      for (const operation of input.resolvedStructuredFieldPatch.dryRun.patch.operations) {
        if (operation.field === "acceptance_items") {
          const incomingItems = normalizeMemoryAcceptanceItems(operation.value);
          if (!incomingItems) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_field_unsupported",
              "Structured acceptance_items patch is invalid"
            );
          }
          if (!Object.prototype.hasOwnProperty.call(operation, "before_value")) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_base_missing",
              "Structured field patch is missing a base value for acceptance_items"
            );
          }
          const currentItems = this.acceptanceItems.get(stored.proposal.workItemId) ?? [];
          const currentMatchesBase = memoryAcceptanceItemsEqual(currentItems, operation.before_value);
          const currentMatchesIncoming = memoryAcceptanceItemsEqual(currentItems, incomingItems);
          if (!currentMatchesBase && !currentMatchesIncoming) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_conflict",
              "Structured acceptance_items patch conflicts with the current WorkItem acceptance items"
            );
          }
          continue;
        }
        if (operation.field === "task_items") {
          const incomingItems = normalizeMemoryTaskItems(operation.value);
          if (!incomingItems) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_field_unsupported",
              "Structured task_items patch is invalid"
            );
          }
          if (!Object.prototype.hasOwnProperty.call(operation, "before_value")) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_base_missing",
              "Structured field patch is missing a base value for task_items"
            );
          }
          const currentItems = this.resolveTaskItemsForPatch(
            stored.proposal.workItemId,
            input.resolvedStructuredFieldPatch.taskPlanScope
          );
          const currentMatchesBase = memoryTaskItemsEqual(currentItems, operation.before_value);
          const currentMatchesIncoming = memoryTaskItemsEqual(currentItems, incomingItems);
          if (!currentMatchesBase && !currentMatchesIncoming) {
            throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
              input.mergeProposalId,
              "structured_field_patch_conflict",
              "Structured task_items patch conflicts with the current WorkItem task items"
            );
          }
          continue;
        }
        const currentValue = memoryWorkItemFieldValue(workItem, operation.field);
        if (!Object.prototype.hasOwnProperty.call(operation, "before_value")) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "structured_field_patch_base_missing",
            `Structured field patch is missing a base value for ${operation.field}`
          );
        }
        const currentMatchesBase = memoryFieldValuesEqual(operation.field, currentValue, operation.before_value);
        const currentMatchesIncoming = memoryFieldValuesEqual(operation.field, currentValue, operation.value);
        if (!currentMatchesBase && !currentMatchesIncoming) {
          throw new ProposalRepositoryUnsupportedMergeProposalApplyError(
            input.mergeProposalId,
            "structured_field_patch_conflict",
            `Structured field patch conflicts with the current WorkItem value for ${operation.field}`
          );
        }
      }
    }
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
    const branch = this.branchRows.get(stored.proposal.branchId);
    if (branch) {
      branch.status = "merged";
      branch.headRef = stored.proposal.mergeSnapshotId;
      branch.version += 1;
    }
    if (workItem) {
      workItem.status = "merged";
      workItem.mainBranchId = stored.proposal.branchId;
      workItem.acceptedAt = at;
      workItem.version += 1;
      for (const operation of input.resolvedStructuredFieldPatch?.dryRun.patch.operations ?? []) {
        if (operation.field === "acceptance_items") {
          const incomingItems = normalizeMemoryAcceptanceItems(operation.value);
          if (incomingItems) {
            this.acceptanceItems.set(stored.proposal.workItemId, incomingItems);
          }
          continue;
        }
        if (operation.field === "task_items") {
          const incomingItems = normalizeMemoryTaskItems(operation.value);
          if (incomingItems) {
            this.writeTaskItemsForPatch(
              stored.proposal.workItemId,
              incomingItems,
              input.resolvedStructuredFieldPatch?.taskPlanScope
            );
          }
          continue;
        }
        if (operation.field === "title" && typeof operation.value === "string") {
          workItem.title = operation.value;
        }
        if (operation.field === "summary_md" && typeof operation.value === "string") {
          workItem.summaryMd = operation.value;
        }
        if (operation.field === "priority" && typeof operation.value === "string") {
          workItem.priority = operation.value;
        }
        if (operation.field === "due_at") {
          workItem.dueAt = operation.value_type === "null" ? null : new Date(operation.value as string);
        }
      }
    }
    if (input.resolvedDriveFile) {
      this.acceptedByTargetKey.set(context.conflictKey, {
        proposalId: stored.proposal.id,
        changeId: input.resolvedDriveFile.changeId,
        ...(input.resolvedDriveFile.sha256 ? { sha256After: input.resolvedDriveFile.sha256 } : {})
      });
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
    keptCurrentTargetKeys?: string[];
    candidateSupplements?: Parameters<ProposalRepository["merge"]>[0]["candidateSupplements"];
    at: Date;
  }) {
    const acceptedTargetKeys = new Set(input.acceptedTargetKeys);
    const keptCurrentTargetKeys = new Set(input.keptCurrentTargetKeys ?? []);
    for (const conflict of input.conflicts) {
      const supplement = input.candidateSupplements?.find((item) => item.conflictKey === conflict.target_key);
      this.mergeProposalCount += 1;
      const chosen = acceptedTargetKeys.has(conflict.target_key)
        ? "accept_incoming"
        : keptCurrentTargetKeys.has(conflict.target_key)
          ? "keep_current"
          : null;
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
    result: "conflict" | "merged" | "rebased";
    conflicts: ReturnType<MemoryProposalRepository["conflictsForStored"]>;
    acceptedTargetKeys: string[];
    keptCurrentTargetKeys?: string[];
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
      ...(input.keptCurrentTargetKeys ? { keptCurrentTargetKeys: input.keptCurrentTargetKeys } : {}),
      candidateSupplements: input.candidateSupplements,
      at: input.at
    });
    return mergeAttemptId;
  }

  async countTodayAiReviewOutcomes() {
    return { total: 0, approved: 0 };
  }

  // R13 批 P4：内存假仓库最小实现——按已落库的 reviews（本类没有单独 reviews 表，reviews 挂在
  // StoredProposalRows.reviews 里）现算，与真库口径（decision=approve 总数/其中 reviewerKind=ai 的数量）一致。
  async countTodayMergeReviewsByActorKind() {
    let total = 0;
    let aiApproved = 0;
    for (const stored of this.rows.values()) {
      for (const review of stored.reviews) {
        if (review.decision !== "approve") {
          continue;
        }
        total += 1;
        if (review.reviewerKind === "ai") {
          aiApproved += 1;
        }
      }
    }
    return { total, aiApproved };
  }

  async listReviewsByProposalIds(proposalIds: string[]) {
    const idSet = new Set(proposalIds);
    const reviews: ReviewRow[] = [];
    for (const stored of this.rows.values()) {
      if (!idSet.has(stored.proposal.id)) {
        continue;
      }
      reviews.push(...stored.reviews);
    }
    return reviews;
  }

  async merge(input: Parameters<ProposalRepository["merge"]>[0]) {
    this.mergeInputs.push(input);
    const stored = this.rows.get(input.proposalId);
    if (!stored) {
      return null;
    }
    // 模拟真库的 L3 最后防线撞车：有 base 快照 → rebase_required（可对底稿）；否则裸 stale_base。
    if (this.forceStaleBase.has(input.proposalId)) {
      throw this.baseSnapshotRefs.has(input.proposalId)
        ? new ProposalRepositoryRebaseRequiredError([this.conflictsForStored(stored)[0]?.target_key ?? "unknown"])
        : new ProposalRepositoryStaleBaseError(this.conflictsForStored(stored)[0]?.target_key ?? "unknown");
    }
    const at = input.at ?? now;
    const acceptedTargetKeys = [...new Set(input.acceptIncomingTargetKeys ?? [])];
    const keptCurrentTargetKeys = input.bulkAction?.action === "keep_current"
      ? [...new Set(input.bulkAction.targetKeys)]
      : [];
    const resolvedTargetKeys = new Set([...acceptedTargetKeys, ...keptCurrentTargetKeys]);
    const allConflicts = this.conflictsForStored(stored);
    const conflicts = this.conflictsForStored(stored, resolvedTargetKeys);
    if (conflicts.length > 0) {
      this.recordMergeAttempt({
        stored,
        actor: input.actor,
        result: "conflict",
        conflicts,
        acceptedTargetKeys,
        keptCurrentTargetKeys,
        candidateSupplements: input.candidateSupplements,
        at
      });
      throw new ProposalRepositoryMergeConflictError(conflicts);
    }
    const mergeSnapshotId = input.mergeSnapshotId ?? "91000000-0000-4000-8000-000000000199";
    const resolvedConflicts = allConflicts.filter((conflict) => resolvedTargetKeys.has(conflict.target_key));
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
      keptCurrentTargetKeys,
      mergeSnapshotId,
      candidateSupplements: input.candidateSupplements,
      at
    });
    for (const change of stored.proposal.diffManifest.changes) {
      if (keptCurrentTargetKeys.includes(this.targetKey(change))) {
        continue;
      }
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
      const workItemStatusAfterMerge = input.workItemStatusAfterMerge ?? "merged";
      workItem.status = workItemStatusAfterMerge;
      workItem.mainBranchId = stored.proposal.branchId;
      if (workItemStatusAfterMerge === "merged") {
        workItem.acceptedAt = at;
      }
      workItem.version += 1;
    }
    return stored;
  }

  async rebase(input: Parameters<ProposalRepository["rebase"]>[0]) {
    const stored = this.rows.get(input.proposalId);
    if (!stored) {
      return null;
    }
    // 对底稿 = 对最新正式版重算冲突（不动账本）。内存版直接复用冲突计算。
    this.recordMergeAttempt({
      stored,
      actor: input.actor,
      result: "rebased",
      conflicts: this.conflictsForStored(stored),
      acceptedTargetKeys: [],
      ...(input.candidateSupplements ? { candidateSupplements: input.candidateSupplements } : {}),
      at: input.at ?? now
    });
    return this.conflictsForStored(stored);
  }
}

// findings[#168/H12]：记录式总线，断言合并/评审事件确有 publish（也让路由测试与全局 PushBus 单例隔离）。
class RecordingBus {
  public events: { topic: string; type: string; data: unknown }[] = [];
  async publish(topic: string, type: string, data: unknown) {
    this.events.push({ topic, type, data });
  }
}

function appWithProposalRoutes() {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const workItems = allowingWorkItems();
  const bus = new RecordingBus();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth, proposals, workItems, bus }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals, workItems, bus }));
  app.route("/api/pages", createPageRoutes({ auth, proposals, workItems: workItems as WorkItemService, allowUnauthenticatedGoldPath: false }));
  return { app, runtimeSettings, bus };
}

function appWithDbProposalRoutes(options: Parameters<typeof createDbProposalService>[1] = {}) {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const repository = new MemoryProposalRepository();
  const proposals = createDbProposalService(repository, { now: () => now, id: ids(), ...options });
  const workItems = allowingWorkItems();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth, proposals, workItems }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals, workItems }));
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

test("proposal routes require work item access before read and write operations", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const workItems = denyingWorkItems();
  const itemManifest = manifest();
  const created = await proposals.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth, proposals, workItems }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals, workItems }));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const list = await app.request(`/api/workitems/${itemManifest.work_item_id}/proposals`, { headers });
  const create = await app.request(`/api/workitems/${itemManifest.work_item_id}/proposals`, {
    method: "POST",
    headers,
    body: JSON.stringify({ manifest: itemManifest })
  });
  const read = await app.request(`/api/proposals/${created.id}`, { headers });
  const review = await app.request(`/api/proposals/${created.id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  const merge = await app.request(`/api/proposals/${created.id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  // L3：鉴权先于请求体解析——未授权者发畸形 body 也应拿到 403（鉴权），而非 400（schema 校验），
  // 否则会泄露请求体形状/字段要求给无权限者。
  const reviewBadBody = await app.request(`/api/proposals/${created.id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "definitely-not-a-valid-decision" })
  });
  // 同理 merge 也应鉴权先于 parse：未授权者发畸形 body 得 403 而非 400。
  const mergeBadBody = await app.request(`/api/proposals/${created.id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ conflict_resolution: { accept_incoming_target_keys: "not-an-array" } })
  });

  assert.equal(list.status, 403);
  assert.equal(create.status, 403);
  assert.equal(read.status, 403);
  assert.equal(review.status, 403);
  assert.equal(merge.status, 403);
  assert.equal(reviewBadBody.status, 403);
  assert.equal(mergeBadBody.status, 403);
});

test("reviewable proposal summaries mark task-plan manifests as plan_review", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = taskPlanManifest();
  const proposal = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub Meta-Planner" },
    title: "计划提议"
  });

  const reviewable = await service.listReviewableForUser({
    user: { id: userId, isAdmin: true }
  });

  assert.equal(reviewable.find((item) => item.id === proposal.id)?.review_kind, "plan_review");
});

test("R9.7 task-plan proposal merge keeps the parent work item active for child dispatch", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = taskPlanManifest();
  repository.workItemRows.set(itemManifest.work_item_id, {
    status: "in_review",
    mainBranchId: null,
    acceptedAt: null,
    version: 0,
    title: "Agent army task",
    summaryMd: null,
    priority: "normal",
    dueAt: null
  });
  const proposal = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub Meta-Planner" },
    title: "计划提议"
  });
  await service.review({
    proposalId: proposal.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });

  await service.merge({
    proposalId: proposal.id,
    actor: { actor_kind: "human", actor_user_id: userId }
  });

  const workItem = repository.workItemRows.get(itemManifest.work_item_id);
  assert.equal(workItem?.status, "ai_working");
  assert.equal(workItem?.acceptedAt, null, "approving a plan must not mark deliverables accepted before child runs execute");
});

test("proposal create rejects branch ids that belong to a different work item", async () => {
  const { app, runtimeSettings, repository } = appWithDbProposalRoutes();
  const itemManifest = manifest(0);
  const foreignBranchId = "91000000-0000-4000-8000-000000009999";
  repository.branchRows.set(foreignBranchId, {
    workItemId: "91000000-0000-4000-8000-000000008888",
    status: "open",
    headRef: "refs/heads/foreign",
    version: 0
  });

  const response = await app.request(`/api/workitems/${itemManifest.work_item_id}/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({ manifest: itemManifest, branch_id: foreignBranchId })
  });

  assert.equal(response.status, 422);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "proposal_branch_workitem_mismatch");
});

test("db proposal merge materializes inline generated text deliverables without a workdir", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "workhub-inline-generated-proposal-"));
  try {
    const repository = new MemoryProposalRepository();
    const service = createDbProposalService(repository, {
      now: () => now,
      id: ids(),
      storageRoot
    });
    const itemManifest = manifest();
    const generatedContent = [
      "# Drive comment R5-7",
      "",
      "## 来源评论",
      "",
      "根据项目网盘里的文件生成三条验收要点。"
    ].join("\n");
    const generatedSha = sha256Text(generatedContent);
    const sourceChange = itemManifest.changes[0]!;
    itemManifest.changes = [{
      ...sourceChange,
      target_kind: "text_doc",
      target_ref: {
        entity_type: "delivery",
        path: "/outputs/复盘包/drive-comment-R5-7.md",
        sha256_after: generatedSha
      },
      change_type: "generated",
      machine_summary: {
        before_excerpt: "",
        after_excerpt: "根据项目网盘里的文件生成三条验收要点。",
        generated_content_md: generatedContent,
        changed_fields: ["drive_comment.body"]
      },
      preview_ref: {
        kind: "text",
        href: `/workitems/${itemManifest.work_item_id}`
      }
    }];

    const created = await service.createFromManifest({
      workItemId: itemManifest.work_item_id,
      manifest: itemManifest,
      actor: { actor_kind: "human", actor_user_id: userId, label: "PM" }
    });
    await service.review({
      proposalId: created.id,
      actor: { actor_kind: "human", actor_user_id: userId, label: "PM" },
      decision: "approve"
    });

    await service.merge({
      proposalId: created.id,
      actor: { actor_kind: "human", actor_user_id: userId, label: "PM" }
    });

    const adopted = repository.mergeInputs.at(-1)?.adoptedDriveFiles?.[0];
    assert.ok(adopted);
    assert.equal(adopted.filename, "drive-comment-R5-7.md");
    assert.equal(adopted.sha256, generatedSha);
    assert.equal(adopted.mime, "text/markdown");
    assert.equal(await readFile(adopted.storagePath, "utf8"), generatedContent);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test("proposal routes require mutation access before reviewing or merging readable work", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const workItems = readOnlyWorkItems();
  const reviewManifest = manifest(0);
  const mergeManifest = manifest(1);
  const reviewTarget = await proposals.createFromManifest({
    workItemId: reviewManifest.work_item_id,
    manifest: reviewManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  const mergeTarget = await proposals.createFromManifest({
    workItemId: mergeManifest.work_item_id,
    manifest: mergeManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await proposals.review({
    proposalId: mergeTarget.id,
    actor: { actor_kind: "human", actor_user_id: userId, label: "proposal-reviewer" },
    decision: "approve"
  });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/proposals", createProposalRoutes({ auth, proposals, workItems }));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const review = await app.request(`/api/proposals/${reviewTarget.id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  const merge = await app.request(`/api/proposals/${mergeTarget.id}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(review.status, 403);
  assert.equal(merge.status, 403);
  assert.equal((await proposals.get(reviewTarget.id))?.status, "opened");
  assert.equal((await proposals.get(mergeTarget.id))?.status, "reviewed");
});

test("findings: a concurrent same-id insert (repo conflict) maps to 409 proposal_already_exists, not 500", async () => {
  const repository = new MemoryProposalRepository();
  // 模拟并发输者：findById 预检通过（新 id），但插入撞唯一约束 → 仓库抛 ProposalRepositoryConflictError。
  repository.createFromManifest = async () => {
    throw new ProposalRepositoryConflictError("proposal_already_exists", "这份变更申请已经存在。");
  };
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = manifest(1);

  await assert.rejects(
    () =>
      service.createFromManifest({
        workItemId: itemManifest.work_item_id,
        manifest: itemManifest,
        actor: { actor_kind: "ai", label: "WorkHub AI" }
      }),
    (error: unknown) =>
      error instanceof ProposalServiceError && error.status === 409 && error.code === "proposal_already_exists"
  );
});

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

test("findings: re-reviewing a rejected proposal is a 409 proposal_rejected, not a 404 not_found", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = manifest(2);
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });

  await service.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "request_changes",
    reasonMd: "请补齐证据。"
  });

  // 第二次审查：状态已是 rejected → 409 proposal_rejected（不是 repository 返 null 误报的 404）。
  await assert.rejects(
    () =>
      service.review({
        proposalId: created.id,
        actor: { actor_kind: "human", actor_user_id: userId },
        decision: "request_changes",
        reasonMd: "再打回一次。"
      }),
    (error: unknown) =>
      error instanceof ProposalServiceError && error.status === 409 && error.code === "proposal_rejected"
  );
});

test("findings: a stale review after a concurrent merge returns proposal_already_merged instead of not_found", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = manifest(2);
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });
  repository.review = async (input) => {
    const stored = await repository.findById(input.proposalId);
    if (stored) {
      stored.proposal.status = "merged";
      stored.proposal.mergeSnapshotId = "91000000-0000-4000-8000-000000000198";
      stored.proposal.mergedAt = now;
      stored.proposal.updatedAt = now;
    }
    return null;
  };

  await assert.rejects(
    () =>
      service.review({
        proposalId: created.id,
        actor: { actor_kind: "human", actor_user_id: userId },
        decision: "request_changes",
        reasonMd: "请补齐证据。"
      }),
    (error: unknown) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "proposal_already_merged"
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
  assert.deepEqual(
    conflict?.options.find((option) => option.id === "keep_current")?.action?.request_json,
    {
      conflict_resolution: {
        accept_incoming_target_keys: [],
        bulk_action: {
          action: "keep_current",
          target_keys: [conflict?.target_key],
          conflict_count: 1
        }
      }
    }
  );
  assert.equal(
    conflict?.options.find((option) => option.id === "keep_current")?.action?.href,
    `/api/proposals/${second.id}/merge`
  );
  assert.equal(conflict?.options.some((option) => option.id === "accept_incoming"), true);
  assert.deepEqual(
    conflict?.options.find((option) => option.id === "accept_incoming")?.action?.request_json,
    { conflict_resolution: { accept_incoming_target_keys: [conflict.target_key] } }
  );

  const merged = await service.merge({
    proposalId: second.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    conflictResolution: {
      acceptIncomingTargetKeys: [conflict?.target_key ?? ""],
      bulkAction: {
        action: "accept_incoming",
        targetKeys: [conflict?.target_key ?? ""],
        conflictCount: 1
      }
    }
  });

  assert.equal(merged.status, "merged");
  assert.deepEqual(repository.mergeInputs.at(-1)?.bulkAction, {
    action: "accept_incoming",
    targetKeys: [conflict?.target_key ?? ""],
    conflictCount: 1
  });
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

test("proposal service keep-current conflict action merges without overwriting the accepted deliverable", async () => {
  const repository = new MemoryProposalRepository();
  let fusionCalls = 0;
  const service = createDbProposalService(repository, {
    now: () => now,
    id: ids(),
    fusionCandidateGenerator: {
      async generate() {
        fusionCalls += 1;
        return [];
      }
    }
  });
  const firstManifest = manifest(3);
  const secondManifest = manifest(3);
  const thirdManifest = manifest(3);
  const secondChange = secondManifest.changes[0];
  const thirdChange = thirdManifest.changes[0];
  if (!secondChange || !thirdChange) {
    throw new Error("missing fixture change");
  }
  secondManifest.changes = [{
    ...secondChange,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    target_ref: { ...secondChange.target_ref, sha256_after: "b".repeat(64) },
    human_summary: "生成了另一张同路径图片。"
  }];
  thirdManifest.changes = [{
    ...thirdChange,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    target_ref: { ...thirdChange.target_ref, sha256_after: "c".repeat(64) },
    human_summary: "生成了第三张同路径图片。"
  }];

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
  await assert.rejects(
    () => service.merge({ proposalId: second.id, actor: { actor_kind: "human", actor_user_id: userId } }),
    /撞车/
  );
  assert.equal(fusionCalls, 1);
  const conflict = (await service.listConflicts(firstManifest.work_item_id)).conflicts[0];
  assert.ok(conflict);

  const merged = await service.merge({
    proposalId: second.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    conflictResolution: {
      acceptIncomingTargetKeys: [],
      bulkAction: {
        action: "keep_current",
        targetKeys: [conflict.target_key],
        conflictCount: 1
      }
    }
  });

  assert.equal(merged.status, "merged");
  const keepAttempts = repository.mergeAttempts.filter((attempt) => attempt.proposalId === second.id);
  assert.equal(keepAttempts.at(-1)?.result, "merged");
  assert.deepEqual(keepAttempts.at(-1)?.acceptedTargetKeys, []);
  const keepCandidates = repository.mergeProposals.filter((proposal) => proposal.mergeAttemptId === keepAttempts.at(-1)?.id);
  assert.equal(keepCandidates[0]?.chosenOptionKey, "keep_current");
  assert.equal(keepCandidates[0]?.chosenByUserId, userId);
  assert.equal(fusionCalls, 1);

  const third = await service.createFromManifest({
    workItemId: thirdManifest.work_item_id,
    manifest: thirdManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: third.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });
  await assert.rejects(
    () => service.merge({ proposalId: third.id, actor: { actor_kind: "human", actor_user_id: userId } }),
    /撞车/
  );
  const thirdConflict = repository.mergeAttempts.find((attempt) => attempt.proposalId === third.id && attempt.result === "conflict")
    ?.conflictsJson[0] as { existing_proposal_id?: string } | undefined;
  assert.equal(thirdConflict?.existing_proposal_id, first.id);
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

test("P-COLLAB rebase: merge surfaces rebase_required with a de-jargoned card when a base snapshot exists", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const m = manifest(0);
  const created = await service.createFromManifest({ workItemId: m.work_item_id, manifest: m, actor: { actor_kind: "ai", label: "WorkHub AI" } });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });
  // 有 base 快照 + 撞上最后防线 → 期望可恢复的 rebase_required,而非裸 stale_base。
  repository.baseSnapshotRefs.set(created.id, "/tmp/workhub-rebase-base");
  repository.forceStaleBase.add(created.id);

  let captured: unknown;
  try {
    await service.merge({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId } });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof ProposalServiceRebaseRequiredError);
  const err = captured as ProposalServiceRebaseRequiredError;
  assert.equal(err.status, 409);
  assert.equal(err.code, "rebase_required");
  assert.ok(err.card.headline.length > 0 && err.card.body.length > 0 && err.card.action_label.length > 0);
  // 去黑话铁律：用户面卡片不得出现 git 术语 rebase。
  assert.doesNotMatch(`${err.card.headline} ${err.card.body} ${err.card.action_label}`, /rebase/iu);
});

test("P-COLLAB rebase: merge stays a bare stale_base when there is no base snapshot", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const m = manifest(0);
  const created = await service.createFromManifest({ workItemId: m.work_item_id, manifest: m, actor: { actor_kind: "ai", label: "WorkHub AI" } });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });
  repository.forceStaleBase.add(created.id); // 无 base 快照 → 无法三方合并 → 仍走安全中止

  await assert.rejects(
    service.merge({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId } }),
    (error: unknown) => error instanceof ProposalServiceError && error.code === "stale_base"
  );
});

test("P-COLLAB rebase: rebase() reports clean when there is nothing to reconcile", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const m = manifest(0);
  const created = await service.createFromManifest({ workItemId: m.work_item_id, manifest: m, actor: { actor_kind: "ai", label: "WorkHub AI" } });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });
  const result = await service.rebase({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId } });
  assert.equal(result.proposal_id, created.id);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.empty_state, "clean_after_rebase");
});

test("P-COLLAB M2: drivePathFromTargetPath maps an /outputs path to its project/ drive path", () => {
  assert.equal(drivePathFromTargetPath("/outputs/docs/spec.md"), "docs/spec.md");
  assert.equal(drivePathFromTargetPath("/outputs/report.md"), "report.md");
  assert.equal(drivePathFromTargetPath("outputs/report.md"), "report.md");
  assert.equal(drivePathFromTargetPath("/report.md"), "report.md");
  assert.equal(drivePathFromTargetPath(undefined), undefined);
  assert.equal(drivePathFromTargetPath("/outputs/"), undefined);
});

test("P-COLLAB M2: readBaseSnapshotFusionExcerpt reads the project/ ancestor, gates on sha, and falls back", async () => {
  const baseSnapshotDir = await mkdtemp(path.join(tmpdir(), "workhub-m2-base-snap-"));
  await mkdir(path.join(baseSnapshotDir, "docs"), { recursive: true });
  await writeFile(path.join(baseSnapshotDir, "docs", "spec.md"), "ANCESTOR\n", "utf8");
  const ancestorSha = sha256Text("ANCESTOR\n");

  // 命中：base 快照里的祖先文件按 /outputs/ 路径映射读到。
  const hit = await readBaseSnapshotFusionExcerpt({
    baseSnapshotRef: baseSnapshotDir,
    targetPath: "/outputs/docs/spec.md"
  });
  assert.equal(hit?.text, "ANCESTOR\n");
  assert.equal(hit?.sha256, ancestorSha);

  // 记录了祖先 sha 且一致 → 采信。
  assert.equal(
    (await readBaseSnapshotFusionExcerpt({
      baseSnapshotRef: baseSnapshotDir,
      targetPath: "/outputs/docs/spec.md",
      expectedShaBefore: ancestorSha
    }))?.text,
    "ANCESTOR\n"
  );
  // 祖先 sha 对不上 → 宁可不采信,回退(undefined),绝不喂错祖先给 diff3。
  assert.equal(
    await readBaseSnapshotFusionExcerpt({
      baseSnapshotRef: baseSnapshotDir,
      targetPath: "/outputs/docs/spec.md",
      expectedShaBefore: "f".repeat(64)
    }),
    undefined
  );
  // 没有 base 快照 / 文件不在快照里 → undefined。
  assert.equal(await readBaseSnapshotFusionExcerpt({ baseSnapshotRef: null, targetPath: "/outputs/docs/spec.md" }), undefined);
  assert.equal(await readBaseSnapshotFusionExcerpt({ baseSnapshotRef: baseSnapshotDir, targetPath: "/outputs/missing.md" }), undefined);
});

test("proposal service dry-runs structured field patches before applying AI fusion", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000601";
  const mergeProposalId = "91000000-0000-4000-8000-000000000602";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000603",
    existing_change_id: "91000000-0000-4000-8000-000000000604",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "更新标题和截止时间。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            title: "客户周报草稿",
            due_at: "2026-06-30",
            extra_field: "should be rejected"
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "structured_field_patch_dry_run_failed"
  );
});

test("R2 audit#11: applyMergeCandidate surfaces rebase_required (not bare stale_base) when the branch has a base snapshot", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["title", "summary_md", "priority", "due_at"]
  };
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-0000000006a1";
  const mergeProposalId = "91000000-0000-4000-8000-0000000006a2";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-0000000006a3",
    existing_change_id: "91000000-0000-4000-8000-0000000006a4",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "更新事项标题、摘要、优先级和截止时间。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            title: "客户周报草稿",
            summary_md: "整理客户周报素材，保留可追溯证据。",
            priority: "high",
            due_at: "2026-06-30T00:00:00.000Z"
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });
  // 有 base 快照 + 撞上最后防线 → 可恢复的 rebase_required（而非裸 stale_base 死路：AI 融合稿采纳得到"对一下底稿再采纳"卡片）。
  repository.baseSnapshotRefs.set(created.id, "/tmp/workhub-candidate-rebase-base");
  repository.forceStaleBase.add(created.id);

  let captured: unknown;
  try {
    await service.applyMergeCandidate({ mergeProposalId, actor: { actor_kind: "human", actor_user_id: userId } });
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof ProposalServiceRebaseRequiredError, "candidate-apply must surface rebase_required, not bare stale_base");
  const err = captured as ProposalServiceRebaseRequiredError;
  assert.equal(err.status, 409);
  assert.equal(err.code, "rebase_required");
  // 去黑话铁律：用户面卡片不得出现 git 术语 rebase。
  assert.doesNotMatch(`${err.card.headline} ${err.card.body} ${err.card.action_label}`, /rebase/iu);
});

test("proposal service applies executable structured field patches to WorkItem scalars", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["title", "summary_md", "priority", "due_at"]
  };
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000611";
  const mergeProposalId = "91000000-0000-4000-8000-000000000612";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000613",
    existing_change_id: "91000000-0000-4000-8000-000000000614",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "更新事项标题、摘要、优先级和截止时间。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            title: "客户周报草稿",
            summary_md: "整理客户周报素材，保留可追溯证据。",
            priority: "high",
            due_at: "2026-06-30T00:00:00.000Z"
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  const merged = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId }
  });

  const workItem = repository.workItemRows.get(itemManifest.work_item_id);
  assert.equal(merged.status, "merged");
  assert.equal(workItem?.title, "客户周报草稿");
  assert.equal(workItem?.summaryMd, "整理客户周报素材，保留可追溯证据。");
  assert.equal(workItem?.priority, "high");
  assert.equal(workItem?.dueAt?.toISOString(), "2026-06-30T00:00:00.000Z");
  assert.equal(workItem?.version, 1);
  assert.equal(repository.acceptedTargetCount, 0);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "merged");
  assert.equal(repository.mergeAttempts.at(-1)?.acceptedTargetKeys[0], conflict.target_key);
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
});

test("proposal service applies structured field overrides through the same merge gate", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["title", "summary_md", "priority", "due_at"]
  };
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000681";
  const mergeProposalId = "91000000-0000-4000-8000-000000000682";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000683",
    existing_change_id: "91000000-0000-4000-8000-000000000684",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "更新事项字段，但允许负责人微调。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            title: "AI 给出的标题",
            summary_md: "AI 给出的摘要。",
            priority: "urgent",
            due_at: "2026-07-31T00:00:00.000Z"
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  const merged = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId },
    structuredFieldOverrides: {
      operations: [
        { field: "title", decision: "custom", value: "负责人确认后的标题" },
        { field: "priority", decision: "keep_current" },
        { field: "due_at", decision: "keep_current" }
      ]
    }
  });

  const workItem = repository.workItemRows.get(itemManifest.work_item_id);
  assert.equal(merged.status, "merged");
  assert.equal(workItem?.title, "负责人确认后的标题");
  assert.equal(workItem?.summaryMd, "AI 给出的摘要。");
  assert.equal(workItem?.priority, "normal");
  assert.equal(workItem?.dueAt, null);
  assert.equal(workItem?.version, 1);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "merged");
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
});

test("proposal service applies executable acceptance item subrecord patches", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const existingItem: MemoryAcceptanceItemRow = {
    id: "91000000-0000-4000-8000-000000000631",
    title: "保留原始证据",
    description: null,
    status: "open",
    sort_order: 0,
    source_plan_id: null
  };
  const incomingItems: MemoryAcceptanceItemRow[] = [
    { ...existingItem, status: "met" },
    {
      id: "91000000-0000-4000-8000-000000000632",
      title: "输出可追溯结论清单",
      description: "每条结论都带证据来源。",
      status: "open",
      sort_order: 1,
      source_plan_id: null
    }
  ];
  repository.acceptanceItems.set(itemManifest.work_item_id, [existingItem]);
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["acceptance_items"]
  };

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000633";
  const mergeProposalId = "91000000-0000-4000-8000-000000000634";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000635",
    existing_change_id: "91000000-0000-4000-8000-000000000636",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "合并验收项子记录。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            acceptance_items: incomingItems
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  const merged = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId }
  });

  assert.equal(merged.status, "merged");
  assert.deepEqual(repository.acceptanceItems.get(itemManifest.work_item_id), incomingItems);
  assert.equal(repository.acceptedTargetCount, 0);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "merged");
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
});

test("proposal service applies per-item acceptance overrides through the structured merge gate", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const editedItem: MemoryAcceptanceItemRow = {
    id: "91000000-0000-4000-8000-000000000641",
    title: "输出可追溯结论清单",
    description: "原始描述。",
    status: "open",
    sort_order: 0,
    source_plan_id: null
  };
  const removedItem: MemoryAcceptanceItemRow = {
    id: "91000000-0000-4000-8000-000000000642",
    title: "保留人工验收项",
    description: null,
    status: "open",
    sort_order: 1,
    source_plan_id: null
  };
  const addedItem: MemoryAcceptanceItemRow = {
    id: "91000000-0000-4000-8000-000000000643",
    title: "新增证据映射表",
    description: "AI 建议补充的验收项。",
    status: "open",
    sort_order: 1,
    source_plan_id: null
  };
  const currentItems = [editedItem, removedItem];
  const incomingItems: MemoryAcceptanceItemRow[] = [
    { ...editedItem, description: "AI 改写后的描述。", status: "met" },
    addedItem
  ];
  repository.acceptanceItems.set(itemManifest.work_item_id, currentItems);
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["acceptance_items"]
  };

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000644";
  const mergeProposalId = "91000000-0000-4000-8000-000000000645";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000646",
    existing_change_id: "91000000-0000-4000-8000-000000000647",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "合并验收项子记录。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            acceptance_items: incomingItems
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId },
      structuredItemOverrides: {
        items: [
          { field: "acceptance_items", item_id: editedItem.id, decision: "keep_current" },
          { field: "acceptance_items", item_id: editedItem.id, decision: "accept_incoming" }
        ]
      }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "structured_item_override_duplicate"
  );

  const merged = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId },
    structuredItemOverrides: {
      items: [
        { field: "acceptance_items", item_id: editedItem.id, decision: "keep_current" },
        { field: "acceptance_items", item_id: addedItem.id, decision: "keep_current" },
        { field: "acceptance_items", item_id: removedItem.id, decision: "keep_current" }
      ]
    }
  });

  assert.equal(merged.status, "merged");
  assert.deepEqual(repository.acceptanceItems.get(itemManifest.work_item_id), currentItems);
  assert.equal(repository.acceptedTargetCount, 0);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "merged");
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
});

test("proposal service applies executable task item subrecord patches", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const existingItem: MemoryTaskItemRow = {
    id: "91000000-0000-4000-8000-000000000651",
    title: "整理原始访谈记录",
    description: null,
    item_type: "task",
    suggested_user_id: null,
    estimate_hours: 1,
    sort_order: 0
  };
  const incomingItems: MemoryTaskItemRow[] = [
    { ...existingItem, title: "整理可复核访谈证据表", estimate_hours: 2 },
    {
      id: "91000000-0000-4000-8000-000000000652",
      title: "标记证据缺口",
      description: "列出需要用户补充确认的风险点。",
      item_type: "risk",
      suggested_user_id: null,
      estimate_hours: null,
      sort_order: 1
    }
  ];
  repository.taskItems.set(itemManifest.work_item_id, [existingItem]);
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["task_items"]
  };

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000653";
  const mergeProposalId = "91000000-0000-4000-8000-000000000654";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000655",
    existing_change_id: "91000000-0000-4000-8000-000000000656",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "合并任务项子记录。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            task_items: incomingItems
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  const merged = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId }
  });

  assert.equal(merged.status, "merged");
  assert.deepEqual(repository.taskItems.get(itemManifest.work_item_id), incomingItems);
  assert.equal(repository.acceptedTargetCount, 0);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "merged");
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
});

test("proposal service requires an explicit task plan scope before task item writeback when plans are ambiguous", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const targetPlanId = "91000000-0000-4000-8000-000000000671";
  const workerPlanId = "91000000-0000-4000-8000-000000000672";
  const existingItem: MemoryTaskItemRow = {
    id: "91000000-0000-4000-8000-000000000673",
    title: "整理原始计划",
    description: null,
    item_type: "task",
    suggested_user_id: null,
    estimate_hours: 1,
    sort_order: 0
  };
  const workerItem: MemoryTaskItemRow = {
    id: "91000000-0000-4000-8000-000000000674",
    title: "执行侧保留事项",
    description: null,
    item_type: "task",
    suggested_user_id: null,
    estimate_hours: 3,
    sort_order: 0
  };
  const incomingItems: MemoryTaskItemRow[] = [
    { ...existingItem, title: "整理可复核计划", estimate_hours: 2 }
  ];
  repository.taskItems.set(itemManifest.work_item_id, [existingItem]);
  repository.taskPlans.set(itemManifest.work_item_id, [
    {
      id: targetPlanId,
      work_item_id: itemManifest.work_item_id,
      stage: "dispatch",
      status: "draft",
      summary: "方案拆解计划",
      items: [existingItem]
    },
    {
      id: workerPlanId,
      work_item_id: itemManifest.work_item_id,
      stage: "worker",
      status: "draft",
      summary: "执行计划",
      items: [workerItem]
    }
  ]);
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["task_items"]
  };

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000675";
  const mergeProposalId = "91000000-0000-4000-8000-000000000676";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000677",
    existing_change_id: "91000000-0000-4000-8000-000000000678",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "合并任务项子记录。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            task_items: incomingItems
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "task_plan_scope_required"
  );

  const scoped = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId },
    taskPlanScope: { target_plan_id: targetPlanId }
  });

  assert.equal(scoped.status, "merged");
  assert.deepEqual(repository.taskPlans.get(itemManifest.work_item_id)?.find((plan) => plan.id === targetPlanId)?.items, incomingItems);
  assert.deepEqual(repository.taskPlans.get(itemManifest.work_item_id)?.find((plan) => plan.id === workerPlanId)?.items, [workerItem]);
});

test("proposal service materializes text hunk overrides into the final text artifact", async (t) => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "workhub-text-hunk-apply-"));
  const workdirRoot = await mkdtemp(path.join(tmpdir(), "workhub-text-hunk-workdir-"));
  t.after(async () => {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(workdirRoot, { recursive: true, force: true });
  });
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids(), storageRoot });
  const itemManifest = manifest(3);
  const sourceChange = itemManifest.changes[0];
  if (!sourceChange) {
    throw new Error("missing fixture change");
  }
  const baseText = "Intro\nBase decision\nTail";
  const currentText = "Intro\nCurrent decision\nTail";
  const incomingText = "Intro\nIncoming decision\nTail";
  const aiFusionText = "Intro\nAI fusion decision\nTail";
  const baseSha = sha256Text(baseText);
  const currentSha = sha256Text(currentText);
  const incomingSha = sha256Text(incomingText);
  const targetPath = "outputs/result.md";
  const textChange = {
    ...sourceChange,
    id: "91000000-0000-4000-8000-000000000691",
    target_kind: "text_doc" as const,
    target_ref: {
      ...sourceChange.target_ref,
      path: targetPath,
      version_before: `sha256:${baseSha}`,
      sha256_before: baseSha,
      sha256_after: incomingSha
    },
    human_summary: "生成了另一版同路径文本说明。"
  };
  itemManifest.changes = [textChange];

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  repository.workdirRefs.set(created.id, workdirRoot);
  const incomingPath = path.join(workdirRoot, "outputs", "result.md");
  const basePath = path.join(workdirRoot, "base-result.md");
  const currentPath = path.join(workdirRoot, "current-result.md");
  await mkdir(path.dirname(incomingPath), { recursive: true });
  await writeFile(incomingPath, incomingText, "utf8");
  await writeFile(basePath, baseText, "utf8");
  await writeFile(currentPath, currentText, "utf8");
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const targetKey = `${textChange.target_ref.entity_type}:${targetPath}`;
  repository.acceptedDriveFiles.set(targetKey, [
    {
      acceptedChangeId: "91000000-0000-4000-8000-000000000692",
      targetKey,
      acceptedRef: `sha256:${baseSha}`,
      sha256After: baseSha,
      storagePath: basePath,
      mime: "text/markdown"
    },
    {
      acceptedChangeId: "91000000-0000-4000-8000-000000000693",
      targetKey,
      acceptedRef: "current",
      sha256After: currentSha,
      storagePath: currentPath,
      mime: "text/markdown"
    }
  ]);
  const mergeAttemptId = "91000000-0000-4000-8000-000000000694";
  const mergeProposalId = "91000000-0000-4000-8000-000000000695";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: targetKey,
    change_id: textChange.id,
    target_kind: "text_doc" as const,
    change_type: textChange.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000696",
    existing_change_id: "91000000-0000-4000-8000-000000000697",
    target_path: targetPath,
    existing_sha256_after: currentSha,
    incoming_sha256_before: baseSha,
    incoming_sha256_after: incomingSha,
    existing_ref: "current",
    incoming_version_before: `sha256:${baseSha}`
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [targetKey],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: targetKey,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "text_doc",
        rationale_md: "AI 给出融合稿，但用户逐段选择采用这次版本。",
        source: "llm",
        quality_gate: {
          status: "passed",
          text_diff3: {
            type: "line_text_diff3",
            auto_merge: false,
            current_hunks: 1,
            incoming_hunks: 1,
            conflict_hunks: 1,
            conflict_ranges: [{ start_line: 2, end_line: 2 }]
          }
        },
        merged_value: {
          merged_text: aiFusionText
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId },
      textHunkOverrides: {
        hunks: [
          {
            hunk_index: 0,
            start_line: 1,
            end_line: 1,
            decision: "accept_incoming"
          }
        ]
      }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "text_hunk_range_mismatch"
  );

  const merged = await service.applyMergeCandidate({
    mergeProposalId,
    actor: { actor_kind: "human", actor_user_id: userId },
    textHunkOverrides: {
      hunks: [
        {
          hunk_index: 0,
          start_line: 2,
          end_line: 2,
          decision: "accept_incoming"
        }
      ]
    }
  });

  const materializedFiles = await filesUnder(storageRoot);
  const materializedText = await readFile(materializedFiles[0]!, "utf8");
  assert.equal(merged.status, "merged");
  assert.equal(materializedText, incomingText);
  assert.notEqual(materializedText, aiFusionText);
  assert.equal(repository.acceptedTargetCount, 1);
  assert.equal(repository.mergeAttempts.at(-1)?.acceptedTargetKeys[0], targetKey);
  assert.equal(repository.mergeProposals.at(-1)?.chosenOptionKey, "ai_fusion");
});

test("proposal service blocks structured field patches when current WorkItem diverges from base", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["title"]
  };
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000621";
  const mergeProposalId = "91000000-0000-4000-8000-000000000622";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000623",
    existing_change_id: "91000000-0000-4000-8000-000000000624",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "更新事项标题。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            title: "客户周报草稿"
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });
  const workItem = repository.workItemRows.get(itemManifest.work_item_id);
  if (workItem) {
    workItem.title = "人工已经改过的标题";
  }

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "structured_field_patch_conflict"
  );
  assert.equal(repository.workItemRows.get(itemManifest.work_item_id)?.title, "人工已经改过的标题");
  assert.equal(repository.mergeAttempts.at(-1)?.result, "conflict");
  assert.equal(repository.acceptedTargetCount, 0);
});

test("proposal service blocks acceptance item patches when current subrecords diverge from base", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const baseItems: MemoryAcceptanceItemRow[] = [
    {
      id: "91000000-0000-4000-8000-000000000641",
      title: "保留证据清单",
      description: null,
      status: "open",
      sort_order: 0,
      source_plan_id: null
    }
  ];
  const incomingItems: MemoryAcceptanceItemRow[] = [
    { ...baseItems[0]!, status: "met" }
  ];
  repository.acceptanceItems.set(itemManifest.work_item_id, baseItems);
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["acceptance_items"]
  };

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000642";
  const mergeProposalId = "91000000-0000-4000-8000-000000000643";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000644",
    existing_change_id: "91000000-0000-4000-8000-000000000645",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "合并验收项子记录。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            acceptance_items: incomingItems
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });
  const manualItems: MemoryAcceptanceItemRow[] = [
    { ...baseItems[0]!, title: "人工已经改过的验收项" }
  ];
  repository.acceptanceItems.set(itemManifest.work_item_id, manualItems);

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "structured_field_patch_conflict"
  );
  assert.deepEqual(repository.acceptanceItems.get(itemManifest.work_item_id), manualItems);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "conflict");
  assert.equal(repository.acceptedTargetCount, 0);
});

test("proposal service blocks task item patches when current subrecords diverge from base", async () => {
  const repository = new MemoryProposalRepository();
  const service = createDbProposalService(repository, { now: () => now, id: ids() });
  const itemManifest = structuredManifest();
  const change = itemManifest.changes.find((item) => item.target_kind === "structured_record");
  if (!change?.target_ref.entity_id) {
    throw new Error("missing structured change");
  }
  const baseItems: MemoryTaskItemRow[] = [
    {
      id: "91000000-0000-4000-8000-000000000661",
      title: "整理任务清单",
      description: null,
      item_type: "task",
      suggested_user_id: null,
      estimate_hours: 1,
      sort_order: 0
    }
  ];
  const incomingItems: MemoryTaskItemRow[] = [
    { ...baseItems[0]!, estimate_hours: 2 }
  ];
  repository.taskItems.set(itemManifest.work_item_id, baseItems);
  change.machine_summary = {
    ...(change.machine_summary ?? {}),
    changed_fields: ["task_items"]
  };

  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({ proposalId: created.id, actor: { actor_kind: "human", actor_user_id: userId }, decision: "approve" });

  const mergeAttemptId = "91000000-0000-4000-8000-000000000662";
  const mergeProposalId = "91000000-0000-4000-8000-000000000663";
  const conflict = {
    proposal_id: created.id,
    work_item_id: itemManifest.work_item_id,
    proposal_title: itemManifest.title,
    target_key: `${change.target_ref.entity_type}:${change.target_ref.entity_id}`,
    change_id: change.id,
    target_kind: "structured_record" as const,
    change_type: change.change_type,
    existing_proposal_id: "91000000-0000-4000-8000-000000000664",
    existing_change_id: "91000000-0000-4000-8000-000000000665",
    existing_ref: "main"
  };
  repository.mergeAttempts.push({
    id: mergeAttemptId,
    proposalId: created.id,
    workItemId: itemManifest.work_item_id,
    branchId: created.branch_id,
    actorKind: "human",
    actorUserId: userId,
    result: "conflict",
    mergeSnapshotId: null,
    conflictsJson: [conflict],
    acceptedTargetKeys: [],
    targetKeys: [conflict.target_key],
    conflictCount: 1,
    createdAt: now
  });
  repository.mergeProposals.push({
    id: mergeProposalId,
    mergeAttemptId,
    conflictKey: conflict.target_key,
    recommendedOptionKey: "ai_fusion",
    chosenOptionKey: null,
    chosenByUserId: null,
    chosenAt: null,
    candidatesJson: [
      {
        option_key: "ai_fusion",
        target_kind: "structured_record",
        rationale_md: "合并任务项子记录。",
        source: "llm",
        quality_gate: { status: "passed" },
        merged_value: {
          fields: {
            task_items: incomingItems
          }
        }
      }
    ],
    createdAt: now,
    updatedAt: now
  });
  const manualItems: MemoryTaskItemRow[] = [
    { ...baseItems[0]!, title: "人工已经改过的任务项" }
  ];
  repository.taskItems.set(itemManifest.work_item_id, manualItems);

  await assert.rejects(
    () => service.applyMergeCandidate({
      mergeProposalId,
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error) =>
      error instanceof ProposalServiceError
      && error.status === 409
      && error.code === "structured_field_patch_conflict"
  );
  assert.deepEqual(repository.taskItems.get(itemManifest.work_item_id), manualItems);
  assert.equal(repository.mergeAttempts.at(-1)?.result, "conflict");
  assert.equal(repository.acceptedTargetCount, 0);
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

test("proposal detail page wraps stored proposal VM drift as an internal contract error", () => {
  const diffManifest = manifest(0);
  const proposal: StoredProposal = {
    id: "not-a-uuid",
    work_item_id: diffManifest.work_item_id,
    branch_id: diffManifest.branch_id ?? "91000000-0000-4000-8000-000000000152",
    round: 1,
    title: "Drifted proposal",
    status: "opened",
    diff_manifest: diffManifest,
    opened_by_kind: "ai",
    reviews: [],
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  assert.throws(
    () => buildProposalDetailPage(proposal),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.detail"
  );
});

test("db proposal service wraps stored proposal contract drift as an internal contract error", async () => {
  const repository = new MemoryProposalRepository();
  const rows = await repository.createFromManifest({
    proposalId: "91000000-0000-4000-8000-000000000188",
    branchId: "91000000-0000-4000-8000-000000000189",
    workItemId: manifest(3).work_item_id,
    manifest: manifest(3),
    actor: { actorKind: "ai" },
    title: "Stored proposal drift",
    at: now
  });
  rows.proposal.id = "not-a-uuid";
  const service = createDbProposalService(repository, { now: () => now });

  await assert.rejects(
    () => service.get("91000000-0000-4000-8000-000000000188"),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.stored"
  );
});

test("proposal service wraps generated manifest drift as an internal contract error", async () => {
  const service = createInMemoryProposalService({ now: () => now, id: () => "not-a-uuid" });
  const itemManifest = manifest(1);
  delete (itemManifest as { proposal_id?: string }).proposal_id;
  delete (itemManifest as { branch_id?: string }).branch_id;

  await assert.rejects(
    () => service.createFromManifest({
      workItemId: itemManifest.work_item_id,
      manifest: itemManifest,
      actor: { actor_kind: "ai", label: "WorkHub AI" }
    }),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.manifest"
  );
});

test("in-memory proposal service wraps review output contract drift as an internal contract error", async () => {
  const service = createInMemoryProposalService({ now: () => now, id: () => "not-a-uuid" });
  const itemManifest = manifest(1);
  itemManifest.proposal_id = "91000000-0000-4000-8000-000000000191";
  itemManifest.branch_id = "91000000-0000-4000-8000-000000000192";
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });

  await assert.rejects(
    () => service.review({
      proposalId: created.id,
      actor: { actor_kind: "human", actor_user_id: userId },
      decision: "approve"
    }),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.memory-review"
  );
});

test("in-memory proposal service wraps merge output contract drift as an internal contract error", async () => {
  const generatedIds = [
    "91000000-0000-4000-8000-000000000201",
    "not-a-uuid"
  ];
  const service = createInMemoryProposalService({ now: () => now, id: () => generatedIds.shift() ?? "not-a-uuid" });
  const itemManifest = manifest(1);
  itemManifest.proposal_id = "91000000-0000-4000-8000-000000000193";
  itemManifest.branch_id = "91000000-0000-4000-8000-000000000194";
  const created = await service.createFromManifest({
    workItemId: itemManifest.work_item_id,
    manifest: itemManifest,
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await service.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });

  await assert.rejects(
    () => service.merge({
      proposalId: created.id,
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.memory"
  );
});

test("proposal service wraps conflict list result drift as an internal contract error", async () => {
  const repository = {
    ...new MemoryProposalRepository(),
    async listConflictsByWorkItem() {
      return [{ id: "drifted-conflict" }];
    },
    async listMergeAttemptsByProposals() {
      return [];
    },
    async listMergeProposalsByAttempts() {
      return [];
    }
  } as unknown as ProposalRepository;
  const service = createDbProposalService(repository, { now: () => now });

  await assert.rejects(
    () => service.listConflicts(manifest(3).work_item_id),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.conflict-list"
  );
});

test("proposal service wraps merge candidate choice result drift as an internal contract error", async () => {
  const repository = {
    ...new MemoryProposalRepository(),
    async chooseMergeProposalCandidate() {
      return {
        id: "not-a-uuid",
        mergeAttemptId: "91000000-0000-4000-8000-000000000190",
        conflictKey: "delivery:/outputs/result.md",
        candidatesJson: [{ option_key: "ai_fusion" }],
        recommendedOptionKey: "ai_fusion",
        chosenOptionKey: "ai_fusion",
        chosenByUserId: userId,
        chosenAt: now,
        createdAt: now,
        updatedAt: now
      };
    }
  } as unknown as ProposalRepository;
  const service = createDbProposalService(repository, { now: () => now });

  await assert.rejects(
    () => service.chooseMergeCandidate({
      mergeProposalId: "91000000-0000-4000-8000-000000000191",
      optionKey: "ai_fusion",
      actor: { actor_kind: "human", actor_user_id: userId }
    }),
    (error: unknown) => error instanceof InternalContractError && error.context === "proposal.merge-candidate-choice"
  );
});

test("proposal review route wraps response VM drift as an internal contract error", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const baseProposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const proposals: ProposalService = {
    ...baseProposals,
    async review(input) {
      const reviewed = await baseProposals.review(input);
      return {
        ...reviewed,
        id: "not-a-uuid"
      };
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/proposals", createProposalRoutes({
    auth,
    proposals,
    workItems: allowingWorkItems(),
    bus: { publish: async () => undefined }
  }));
  const created = await baseProposals.createFromManifest({
    workItemId: manifest(3).work_item_id,
    manifest: manifest(3),
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });

  const response = await app.request(`/api/proposals/${created.id}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({ decision: "approve" })
  });

  assert.equal(response.status, 500);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "internal_contract_error");
});

test("proposal merge route wraps response VM drift as an internal contract error", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const baseProposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const proposals: ProposalService = {
    ...baseProposals,
    async merge(input) {
      const merged = await baseProposals.merge(input);
      return {
        ...merged,
        id: "not-a-uuid"
      };
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/proposals", createProposalRoutes({
    auth,
    proposals,
    workItems: allowingWorkItems(),
    bus: { publish: async () => undefined }
  }));
  const created = await baseProposals.createFromManifest({
    workItemId: manifest(3).work_item_id,
    manifest: manifest(3),
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await baseProposals.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });

  const response = await app.request(`/api/proposals/${created.id}/merge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 500);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "internal_contract_error");
});

test("proposal conflict list route wraps response VM drift as an internal contract error", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const baseProposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const proposals: ProposalService = {
    ...baseProposals,
    async listConflicts() {
      return { conflicts: [{ id: "drifted-conflict" }] } as never;
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({
    auth,
    proposals,
    workItems: allowingWorkItems()
  }));

  const response = await app.request(`/api/workitems/${manifest(3).work_item_id}/conflicts`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 500);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "internal_contract_error");
});

test("merge proposal candidate choice route wraps response VM drift as an internal contract error", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const baseProposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const created = await baseProposals.createFromManifest({
    workItemId: manifest(3).work_item_id,
    manifest: manifest(3),
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  const proposals: ProposalService = {
    ...baseProposals,
    async getByMergeProposal() {
      return created;
    },
    async chooseMergeCandidate() {
      return {
        merge_proposal_id: "not-a-uuid",
        conflict_key: "delivery:/outputs/result.md",
        chosen_option_key: "ai_fusion",
        chosen_by_user_id: userId,
        chosen_at: now.toISOString(),
        candidate: { option_key: "ai_fusion" }
      } as never;
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({
    auth,
    proposals,
    workItems: allowingWorkItems()
  }));
  const mergeProposalId = "91000000-0000-4000-8000-000000000177";

  const response = await app.request(`/api/merge-proposals/${mergeProposalId}/choose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({ option_key: "ai_fusion" })
  });

  assert.equal(response.status, 500);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "internal_contract_error");
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

test("proposal review remember-always stores corrections inside the authenticated workspace", async () => {
  const memoryWrites: UpsertUserMemoryInput[] = [];
  const userMemoryRepository = {
    async upsert(input: UpsertUserMemoryInput) {
      memoryWrites.push(input);
      return {
        id: "91000000-0000-4000-8000-000000000861",
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        category: input.category,
        key: input.key,
        valueMd: input.valueMd,
        confidence: input.confidence ?? 0.9,
        sourceRunId: input.sourceRunId ?? null,
        lastUsedAt: null,
        expiresAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      };
    }
  };
  const { app, runtimeSettings } = appWithDbProposalRoutes({ userMemoryRepository });
  const created = await createProposal(app, runtimeSettings, manifest(2));
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const response = await app.request(`/api/proposals/${created.data.id}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      decision: "request_changes",
      reason_md: "请补齐数据来源和口径说明。",
      remember: "always"
    })
  });

  assert.equal(response.status, 200);
  assert.equal(memoryWrites.length, 1);
  assert.deepEqual(memoryWrites[0], {
    userId,
    workspaceId: runtimeSettings.auth.defaultWorkspaceId,
    category: "correction",
    key: `proposal:${created.data.id}`,
    valueMd: "请补齐数据来源和口径说明。",
    confidence: 0.9
  });
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
    headers
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

test("proposal action routes localize result envelopes from locale query", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(3));
  const proposalId = created.data.id;
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const review = await app.request(`/api/proposals/${proposalId}/review?locale=en-US`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });

  assert.equal(review.status, 200);
  const reviewBody = await review.json() as {
    ok: true;
    data: {
      next_action?: { label: string };
      attention: { title: string; summary_text: string; actions: Array<{ label: string }> };
    };
  };
  assert.equal(reviewBody.data.attention.summary_text, "Approved — ready to accept into the official version.");
  assert.equal(reviewBody.data.attention.actions[0]?.label, "Merge deliverable");
  assert.equal(reviewBody.data.next_action?.label, "Merge deliverable");
  assert.doesNotMatch(reviewBody.data.attention.title, /已通过确认/u);

  const merge = await app.request(`/api/proposals/${proposalId}/merge?locale=en-US`, {
    method: "POST",
    headers
  });

  assert.equal(merge.status, 200);
  const mergeBody = await merge.json() as {
    ok: true;
    data: { attention: { summary_text: string; actions: Array<{ label: string }> } };
  };
  assert.equal(mergeBody.data.attention.summary_text, "The deliverable change is now in the official version, with a full audit trail.");
  assert.equal(mergeBody.data.attention.actions[0]?.label, "View changes");
});

test("proposal merge confirm:false does not merge or publish events", async () => {
  const { app, runtimeSettings, bus } = appWithProposalRoutes();
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

  const merge = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirm: false })
  });

  assert.equal(merge.status, 409);
  const mergeBody = await merge.json() as { ok: false; error: { code: string; recoverable?: boolean } };
  assert.equal(mergeBody.error.code, "confirmation_required");
  assert.equal(mergeBody.error.recoverable, true);
  assert.equal(bus.events.some((event) => event.type === "proposal.merged"), false);

  const page = await app.request(`/api/pages/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const pageBody = await page.json() as { ok: true; data: { status: string } };
  assert.equal(pageBody.data.status, "reviewed");
});

test("findings[#168] review and merge publish their events to the bus (live refresh for other clients)", async () => {
  const { app, runtimeSettings, bus } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(3));
  const proposalId = created.data.id;
  const workItemId = created.data.diff_manifest.work_item_id;
  const headers = { "Content-Type": "application/json", Cookie: await cookie(runtimeSettings) };

  const review = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(review.status, 200);
  // 评审通过发 proposal.reviewed 到工作项频道（修复前只塞进响应、从不 publish）。
  assert.equal(
    bus.events.some((event) => event.type === "proposal.reviewed" && event.topic === `workitem:${workItemId}`),
    true
  );

  const merge = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(merge.status, 200);
  // 合并发 proposal.merged（→ workitem 频道）+ notification.created（→ user 频道）。
  assert.equal(
    bus.events.some((event) => event.type === "proposal.merged" && event.topic === `workitem:${workItemId}`),
    true
  );
  assert.equal(bus.events.some((event) => event.type === "notification.created" && event.topic.startsWith("user:")), true);
});

test("proposal merge does not republish events when the proposal is already merged", async () => {
  const { app, runtimeSettings, bus } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(3));
  const proposalId = created.data.id;
  const headers = { "Content-Type": "application/json", Cookie: await cookie(runtimeSettings) };

  const review = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(review.status, 200);

  const firstMerge = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(firstMerge.status, 200);
  const eventCountAfterFirstMerge = bus.events.length;
  const mergedEventsAfterFirstMerge = bus.events.filter((event) => event.type === "proposal.merged").length;
  const notificationEventsAfterFirstMerge = bus.events.filter((event) => event.type === "notification.created").length;

  const secondMerge = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(secondMerge.status, 409);
  const secondBody = await secondMerge.json() as { ok: false; error: { code: string } };
  assert.equal(secondBody.error.code, "proposal_already_merged");
  assert.equal(bus.events.length, eventCountAfterFirstMerge);
  assert.equal(bus.events.filter((event) => event.type === "proposal.merged").length, mergedEventsAfterFirstMerge);
  assert.equal(bus.events.filter((event) => event.type === "notification.created").length, notificationEventsAfterFirstMerge);
});

test("findings[#168] a throwing bus does not fail the merge (best-effort publish)", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const workItems = allowingWorkItems();
  const throwingBus = { publish: async () => { throw new Error("bus down"); } };
  const warnings: unknown[][] = [];
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/proposals", createProposalRoutes({
    auth,
    proposals,
    workItems,
    bus: throwingBus,
    logger: { warn: (...args: unknown[]) => warnings.push(args) }
  }));
  const created = await proposals.createFromManifest({
    workItemId: manifest(3).work_item_id,
    manifest: manifest(3),
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  const headers = { "Content-Type": "application/json", Cookie: await cookie(runtimeSettings) };
  await app.request(`/api/proposals/${created.id}/review`, {
    method: "POST", headers, body: JSON.stringify({ decision: "approve" })
  });
  const merge = await app.request(`/api/proposals/${created.id}/merge`, {
    method: "POST", headers, body: JSON.stringify({})
  });
  assert.equal(merge.status, 200);
  assert.equal(warnings.some((entry) => entry[0] === "WorkHub proposal event publish failed"), true);
  assert.equal(
    warnings.some((entry) => {
      const detail = entry[1] as { topic?: string; type?: string; error?: string } | undefined;
      return detail?.type === "proposal.merged" && detail.error === "bus down";
    }),
    true
  );
});

test("proposal merge reports a typed contract error when the merged snapshot is missing", async () => {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const baseProposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const proposals: ProposalService = {
    ...baseProposals,
    async merge(input) {
      const merged = await baseProposals.merge(input);
      const { merge_snapshot_id: _mergeSnapshotId, ...withoutSnapshot } = merged;
      return withoutSnapshot as StoredProposal;
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/proposals", createProposalRoutes({ auth, proposals, workItems: allowingWorkItems() }));

  const created = await baseProposals.createFromManifest({
    workItemId: manifest(3).work_item_id,
    manifest: manifest(3),
    actor: { actor_kind: "ai", label: "WorkHub AI" }
  });
  await baseProposals.review({
    proposalId: created.id,
    actor: { actor_kind: "human", actor_user_id: userId },
    decision: "approve"
  });

  const response = await app.request(`/api/proposals/${created.id}/merge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: await cookie(runtimeSettings) },
    body: JSON.stringify({})
  });

  assert.equal(response.status, 409);
  const body = await response.json() as { ok: false; error: { code: string; message: string } };
  assert.equal(body.error.code, "merge_snapshot_missing");
  assert.match(body.error.message, /缺少合并快照/u);
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
                quality_gate: {
                  status: "passed",
                  text_patch_preview: {
                    type: "unified_text_patch_preview",
                    base_available: true,
                    stats: {
                      changed: true,
                      added_lines: 1,
                      removed_lines: 1,
                      overlap_risk: "requires_review"
                    },
                    hunks: [
                      {
                        header: "@@ -1 +1 @@",
                        lines: ["-正式版已有结论。", "+融合后的正文"]
                      }
                    ]
                  }
                },
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
            quality_gate?: Record<string, unknown>;
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
  const blockedPreview = aiFusionOption?.quality_gate?.["text_patch_preview"] as
    | { type?: string; stats?: { overlap_risk?: string } }
    | undefined;
  assert.equal(blockedPreview?.type, "unified_text_patch_preview");
  assert.equal(blockedPreview?.stats?.overlap_risk, "requires_review");
  assert.equal(typeof targetKey, "string");
  const mergeProposalId = conflict?.merge_proposal_id;
  assert.equal(typeof mergeProposalId, "string");
  assert.equal(mergeProposalId, repository.mergeProposals[0]?.id);
  assert.equal(aiFusionOption?.action?.href, `/api/merge-proposals/${mergeProposalId}/apply`);
  assert.deepEqual(aiFusionOption?.action?.request_json, { confirm: true });

  const rejectedApply = await app.request(`/api/merge-proposals/${mergeProposalId}/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ confirm: false })
  });
  assert.equal(rejectedApply.status, 409);
  const rejectedApplyBody = await rejectedApply.json() as { ok: false; error: { code: string; recoverable?: boolean } };
  assert.equal(rejectedApplyBody.error.code, "confirmation_required");
  assert.equal(rejectedApplyBody.error.recoverable, true);
  assert.equal(repository.mergeProposals.find((proposal) => proposal.id === mergeProposalId)?.chosenOptionKey, null);

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
        options: Array<{ id: string; quality_gate?: Record<string, unknown>; action?: { id: string; href: string } }>;
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
  const listedPreview = conflictBody.data.conflicts[0]?.options.find((option) => option.id === "ai_fusion")
    ?.quality_gate?.["text_patch_preview"] as { type?: string } | undefined;
  assert.equal(listedPreview?.type, "unified_text_patch_preview");

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

  // L5：keep_current / accept_incoming 不是候选「选择」路由的合法 option——apply 只认 ai_fusion，
  // 选了它们会让变更申请永久卡在 reviewed（死状态）。路由层直接 422 fail-closed 拒绝，无论该合并建议
  // 此前是否已选定（这两种解析走合并接口的 conflict_resolution 内联完成）。
  const overwriteChoice = await app.request(`/api/merge-proposals/${mergeProposalId}/choose`, {
    method: "POST",
    headers,
    body: JSON.stringify({ option_key: "keep_current" })
  });
  assert.equal(overwriteChoice.status, 422);

  const reapply = await app.request(`/api/merge-proposals/${mergeProposalId}/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });
  assert.equal(reapply.status, 409);
});
