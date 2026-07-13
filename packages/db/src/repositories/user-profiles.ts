import { randomUUID } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  projects,
  userProfiles,
  users,
  workItemAssignments,
  workItems,
  workspaceMemberships
} from "../schema/index.js";

// R13 批 A2（派人推荐 v2）：user_profiles 此前是零接线死表——没有 repository、没有 service、没有路由、
// 没有 UI。这是给它建的第一份 repository：读写"我是谁"（title/bioMd/skillTags）+ 一条为观察者派活
// 评分服务的聚合查询（listCandidatesForProject）。

export type UserProfileRow = typeof userProfiles.$inferSelect;

export type UserProfilePatch = {
  title?: string | null;
  bioMd?: string | null;
  skillTags?: string[];
};

export type UserProfileUpsertInput = {
  userId: string;
  patch: UserProfilePatch;
  at?: Date;
};

// 观察者派活候选名单一行：历史交付信号只算给 role='lead' 的工单归属人（04 铁律#4 讨论的默认值，
// 详见 r13-workbench-refinement/01-new-batches-design.md 批 A2 §4 踩雷），且限定在目标项目自身的
// 交付历史内（work_items.project_id = 目标 project），不是整个工作区的全量历史——这是一个可复核的
// 范围选择，不是设计文档强制的唯一解：候选池（谁能被推荐）确实是"项目所在工作区的全体 active 成员"，
// 但"这个人历史交付得怎么样"算的是"在这个项目里"的记录，不是这人在其它项目里的战绩。
export type CandidateForProjectRow = {
  userId: string;
  nickname: string;
  title: string | null;
  bioMd: string | null;
  skillTags: string[] | null;
  acceptedDeliverableCount: number;
  lastAcceptedAt: Date | null;
};

export type ListCandidatesForProjectInput = {
  projectId: string;
  limit?: number;
};

export type UserProfileRepository = {
  findByUserId: (userId: string) => Promise<UserProfileRow | null>;
  upsert: (input: UserProfileUpsertInput) => Promise<UserProfileRow>;
  listCandidatesForProject: (input: ListCandidatesForProjectInput) => Promise<CandidateForProjectRow[]>;
};

class NamedUserProfileRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UserProfileRepositoryInputError extends NamedUserProfileRepositoryError {}
export class UserProfileEmptyPatchError extends NamedUserProfileRepositoryError {}
export class UserProfileInvalidPatchError extends NamedUserProfileRepositoryError {}
export class UserProfileWriteFailedError extends NamedUserProfileRepositoryError {}

const USER_PROFILE_PATCH_KEYS = ["title", "bioMd", "skillTags"] as const;

// 04 铁律#4：候选名单聚合查询必须带上限——即便是"项目所在工作区全体 active 成员"，一个足够大的
// 工作区也不该无上限拉全量行。默认给足观察者评分/取 top-N 用（其消费点只取分数最高的 5-8 个），
// 硬顶防误传超大数值。
const DEFAULT_CANDIDATE_LIMIT = 50;
const CANDIDATE_LIMIT_HARD_CAP = 200;

function assertCandidateLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > CANDIDATE_LIMIT_HARD_CAP) {
    throw new UserProfileRepositoryInputError(
      `limit must be an integer from 1 through ${CANDIDATE_LIMIT_HARD_CAP}`
    );
  }
}

function assertPatch(patch: Record<string, unknown>, label: string) {
  const unknownKey = Object.keys(patch).find((key) => !USER_PROFILE_PATCH_KEYS.includes(key as never));
  if (unknownKey) {
    throw new UserProfileInvalidPatchError(`${label} patch contains unknown field: ${unknownKey}`);
  }
  if (!USER_PROFILE_PATCH_KEYS.some((key) => patch[key] !== undefined)) {
    throw new UserProfileEmptyPatchError(`${label} patch must include at least one defined field`);
  }
}

function insertValues(input: UserProfileUpsertInput, at: Date) {
  return {
    id: randomUUID(),
    userId: input.userId,
    title: input.patch.title ?? null,
    bioMd: input.patch.bioMd ?? null,
    skillTags: input.patch.skillTags ? [...input.patch.skillTags] : [],
    createdAt: at,
    updatedAt: at
  };
}

function updateValues(patch: UserProfilePatch, at: Date) {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.bioMd !== undefined ? { bioMd: patch.bioMd } : {}),
    ...(patch.skillTags !== undefined ? { skillTags: [...patch.skillTags] } : {}),
    updatedAt: at
  };
}

export function createUserProfileRepository(db: WorkHubDb): UserProfileRepository {
  return {
    async findByUserId(userId) {
      const [row] = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      return row ?? null;
    },

    async upsert(input) {
      assertPatch(input.patch as Record<string, unknown>, "user profile");
      const at = input.at ?? new Date();
      const [written] = await db
        .insert(userProfiles)
        .values(insertValues(input, at))
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: updateValues(input.patch, at)
        })
        .returning();
      if (!written) {
        throw new UserProfileWriteFailedError("user profile upsert returned no row");
      }
      return written;
    },

    async listCandidatesForProject(input) {
      const limit = input.limit ?? DEFAULT_CANDIDATE_LIMIT;
      assertCandidateLimit(limit);
      const rows = await db
        .select({
          userId: workspaceMemberships.userId,
          nickname: users.nickname,
          title: userProfiles.title,
          bioMd: userProfiles.bioMd,
          skillTags: userProfiles.skillTags,
          acceptedDeliverableCount: sql<number>`count(distinct ${acceptedDeliverableChanges.id})`.mapWith(Number),
          lastAcceptedAt: sql<Date | null>`max(${acceptedDeliverableChanges.createdAt})`
        })
        .from(projects)
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, projects.workspaceId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .innerJoin(
          users,
          and(eq(users.id, workspaceMemberships.userId), isNull(users.deletedAt))
        )
        .leftJoin(userProfiles, eq(userProfiles.userId, workspaceMemberships.userId))
        .leftJoin(
          workItemAssignments,
          and(
            eq(workItemAssignments.userId, workspaceMemberships.userId),
            eq(workItemAssignments.role, "lead")
          )
        )
        .leftJoin(
          workItems,
          and(eq(workItems.id, workItemAssignments.workItemId), eq(workItems.projectId, projects.id))
        )
        .leftJoin(acceptedDeliverableChanges, eq(acceptedDeliverableChanges.workItemId, workItems.id))
        .where(eq(projects.id, input.projectId))
        .groupBy(
          workspaceMemberships.userId,
          users.nickname,
          userProfiles.title,
          userProfiles.bioMd,
          userProfiles.skillTags
        )
        .limit(limit);
      return rows;
    }
  };
}
