import { randomUUID } from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import type { WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { allocateProjectCode } from "../sequences.js";
import {
  projectMilestones,
  projectPlanDrafts,
  workItemDependencies,
  workItems
} from "../schema/index.js";

type JsonObject = Record<string, unknown>;

export type ProjectPlanDraftRow = typeof projectPlanDrafts.$inferSelect;
export type ProjectPlanDraftStatus = ProjectPlanDraftRow["status"];

export type CreateProjectPlanDraftInput = {
  id: string;
  projectId: string;
  workspaceId: string;
  intentMd: string;
  payloadJson: JsonObject;
  rationaleMd?: string | null;
  decompositionContextJson?: JsonObject;
  createdByUserId: string;
  status?: ProjectPlanDraftStatus;
  now?: Date;
};

// 物化输入：局部 ref 已由 service 解析成真 uuid（里程碑 id、工作项 id、依赖两端 id 都是最终 id）。
// 仓库层只负责在一个事务里原子落库 + 分配工作项 code + 把草案 CAS 到 materialized。
export type MaterializeMilestoneInput = {
  id: string;
  title: string;
  dueAt: Date | null;
  sort: number;
};

export type MaterializeWorkItemInput = {
  id: string;
  title: string;
  objectiveMd: string;
  milestoneId: string | null;
  status: WorkItemStatus;
};

export type MaterializeDependencyInput = {
  workItemId: string;
  dependsOnWorkItemId: string;
};

export type MaterializeResult = {
  milestoneIds: string[];
  workItemIds: string[];
  dependencyCount: number;
};

// materialize 的四种收口：物化成功 / 已物化（幂等回读）/ 状态不对（未批准）/ 找不到。
// service 据此映射 HTTP（already_materialized 与 materialized 都回 200 结果，not_approved→409，not_found→404）。
export type MaterializeOutcome =
  | { outcome: "materialized"; result: MaterializeResult; draft: ProjectPlanDraftRow }
  | { outcome: "already_materialized"; result: MaterializeResult; draft: ProjectPlanDraftRow }
  | { outcome: "not_approved"; draft: ProjectPlanDraftRow }
  | { outcome: "not_found" };

export type MaterializeProjectPlanDraftInput = {
  draftId: string;
  workspaceId: string;
  projectId: string;
  submitterUserId: string;
  milestones: MaterializeMilestoneInput[];
  workItems: MaterializeWorkItemInput[];
  dependencies: MaterializeDependencyInput[];
  now?: Date;
};

export type ProjectPlannerRepository = {
  createDraft: (input: CreateProjectPlanDraftInput) => Promise<ProjectPlanDraftRow>;
  getDraftById: (input: { draftId: string; workspaceId?: string }) => Promise<ProjectPlanDraftRow | null>;
  listDraftsByProject: (input: { projectId: string; workspaceId: string; limit?: number }) => Promise<ProjectPlanDraftRow[]>;
  approveDraft: (input: { draftId: string; workspaceId: string; reviewedByUserId: string; now?: Date }) => Promise<ProjectPlanDraftRow | null>;
  // expectedStatus 默认 pending_review（人工驳回）；物化环兜底传 'approved' 把已批准草案打回。
  rejectDraft: (input: { draftId: string; workspaceId: string; reviewedByUserId: string; reasonMd: string; expectedStatus?: ProjectPlanDraftStatus; now?: Date }) => Promise<ProjectPlanDraftRow | null>;
  materialize: (input: MaterializeProjectPlanDraftInput) => Promise<MaterializeOutcome>;
};

const DEFAULT_DRAFT_LIMIT = 50;
const MAX_DRAFT_LIMIT = 100;

function resultFromJson(value: JsonObject | null | undefined): MaterializeResult {
  const milestoneIds = Array.isArray(value?.milestone_ids)
    ? (value?.milestone_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const workItemIds = Array.isArray(value?.work_item_ids)
    ? (value?.work_item_ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  const dependencyCount = typeof value?.dependency_count === "number" ? value.dependency_count : 0;
  return { milestoneIds, workItemIds, dependencyCount };
}

function resultToJson(result: MaterializeResult): JsonObject {
  return {
    milestone_ids: result.milestoneIds,
    work_item_ids: result.workItemIds,
    dependency_count: result.dependencyCount
  };
}

export function createProjectPlannerRepository(db: WorkHubDb): ProjectPlannerRepository {
  return {
    async createDraft(input) {
      const now = input.now ?? new Date();
      const [row] = await db
        .insert(projectPlanDrafts)
        .values({
          id: input.id,
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          status: input.status ?? "pending_review",
          intentMd: input.intentMd,
          payloadJson: input.payloadJson,
          rationaleMd: input.rationaleMd ?? null,
          decompositionContextJson: input.decompositionContextJson ?? {},
          createdByUserId: input.createdByUserId,
          createdAt: now,
          updatedAt: now
        })
        .returning();
      return row!;
    },

    async getDraftById(input) {
      const [row] = await db
        .select()
        .from(projectPlanDrafts)
        .where(and(
          eq(projectPlanDrafts.id, input.draftId),
          ...(input.workspaceId ? [eq(projectPlanDrafts.workspaceId, input.workspaceId)] : [])
        ))
        .limit(1);
      return row ?? null;
    },

    async listDraftsByProject(input) {
      const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_DRAFT_LIMIT), MAX_DRAFT_LIMIT);
      return db
        .select()
        .from(projectPlanDrafts)
        .where(and(
          eq(projectPlanDrafts.projectId, input.projectId),
          eq(projectPlanDrafts.workspaceId, input.workspaceId)
        ))
        .orderBy(desc(projectPlanDrafts.createdAt), desc(projectPlanDrafts.id))
        .limit(limit);
    },

    // CAS pending_review → approved（幂等：已 approved 也算成功，兜底重复点批准）。返回 null = 状态已变。
    async approveDraft(input) {
      const now = input.now ?? new Date();
      const [row] = await db
        .update(projectPlanDrafts)
        .set({
          status: "approved",
          reviewedByUserId: input.reviewedByUserId,
          reviewedAt: now,
          updatedAt: now
        })
        .where(and(
          eq(projectPlanDrafts.id, input.draftId),
          eq(projectPlanDrafts.workspaceId, input.workspaceId),
          // draft/pending_review/approved 都可再批准（幂等）；已 rejected/materialized 不可复活。
          eq(projectPlanDrafts.status, "pending_review")
        ))
        .returning();
      return row ?? null;
    },

    // CAS expectedStatus → rejected（理由必填，回灌下次起草上下文）。返回 null = 状态已变。
    // 人工驳回从 pending_review；物化时 judge 漏网的环兜底从 approved 打回（见 service.materialize）。
    async rejectDraft(input) {
      const now = input.now ?? new Date();
      const [row] = await db
        .update(projectPlanDrafts)
        .set({
          status: "rejected",
          reviewReasonMd: input.reasonMd,
          reviewedByUserId: input.reviewedByUserId,
          reviewedAt: now,
          updatedAt: now
        })
        .where(and(
          eq(projectPlanDrafts.id, input.draftId),
          eq(projectPlanDrafts.workspaceId, input.workspaceId),
          eq(projectPlanDrafts.status, input.expectedStatus ?? "pending_review")
        ))
        .returning();
      return row ?? null;
    },

    // 物化：单事务内 里程碑 → 工作项（分配 code）→ 依赖 → 草案 CAS materialized。
    // 幂等：已 materialized 直接回读既有结果，不重复建。状态不是 approved/materialized → not_approved。
    // 任一 insert 抛错（含 DB 层环/唯一冲突兜底）→ 整个事务回滚，无半成品；service 在事务外标 rejected。
    async materialize(input) {
      const now = input.now ?? new Date();
      return db.transaction(async (tx) => {
        const [draft] = await tx
          .select()
          .from(projectPlanDrafts)
          .where(and(
            eq(projectPlanDrafts.id, input.draftId),
            eq(projectPlanDrafts.workspaceId, input.workspaceId)
          ))
          .for("update")
          .limit(1);
        if (!draft) {
          return { outcome: "not_found" } satisfies MaterializeOutcome;
        }
        if (draft.status === "materialized") {
          return {
            outcome: "already_materialized",
            result: resultFromJson(draft.resultJson),
            draft
          } satisfies MaterializeOutcome;
        }
        if (draft.status !== "approved") {
          return { outcome: "not_approved", draft } satisfies MaterializeOutcome;
        }

        if (input.milestones.length > 0) {
          await tx.insert(projectMilestones).values(input.milestones.map((milestone) => ({
            id: milestone.id,
            projectId: input.projectId,
            title: milestone.title,
            dueAt: milestone.dueAt,
            sort: milestone.sort,
            status: "open" as const,
            createdAt: now,
            updatedAt: now,
            deletedAt: null
          })));
        }

        for (const item of input.workItems) {
          const allocation = await allocateProjectCode(tx, input.projectId);
          await tx.insert(workItems).values({
            id: item.id,
            code: allocation.code,
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            submitterUserId: input.submitterUserId,
            title: item.title,
            rawDescription: item.objectiveMd,
            summaryMd: item.objectiveMd,
            status: item.status,
            priority: "normal",
            mode: "worker",
            humanReserved: false,
            milestoneId: item.milestoneId,
            createdAt: now,
            updatedAt: now
          });
        }

        if (input.dependencies.length > 0) {
          await tx.insert(workItemDependencies).values(input.dependencies.map((edge) => ({
            id: randomUUID(),
            workItemId: edge.workItemId,
            dependsOnWorkItemId: edge.dependsOnWorkItemId,
            createdByUserId: input.submitterUserId,
            createdAt: now
          })));
        }

        const result: MaterializeResult = {
          milestoneIds: input.milestones.map((milestone) => milestone.id),
          workItemIds: input.workItems.map((item) => item.id),
          dependencyCount: input.dependencies.length
        };
        const [updated] = await tx
          .update(projectPlanDrafts)
          .set({
            status: "materialized",
            resultJson: resultToJson(result),
            materializedAt: now,
            updatedAt: now
          })
          .where(eq(projectPlanDrafts.id, input.draftId))
          .returning();
        return { outcome: "materialized", result, draft: updated! } satisfies MaterializeOutcome;
      });
    }
  };
}
