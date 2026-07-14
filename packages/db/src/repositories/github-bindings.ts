import type { GithubActivityKind } from "@workhub/contracts";
import { and, count, desc, eq, gte, isNull, max, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  projectGithubActivities,
  projectGithubBindings,
  projects,
  workspaceMemberships
} from "../schema/index.js";

// R14 批 GH（07-gh-design.md §2/§3）。写操作（绑定/换 PAT/解绑）收口=严格 project owner
// （照 ai-settings.ts 的 activeProjectOwnerCondition 同一收紧程度，无 isAdmin 旁路——PAT 管理
// 比 AI 治理开关敏感，没有理由更松）；读状态走服务层 canViewProjectDrive（项目可见者皆可，
// 「绑了哪个 repo/上次同步时间」是协作透明度，不是敏感信息）。
// 安全红线：本仓库层的行类型带密文三列（bytea Buffer），调用方（服务层）绝不把整行序列化进
// 日志或响应——响应 VM 在 contracts 层结构性无 token 字段。

export type GithubBindingRow = typeof projectGithubBindings.$inferSelect;
export type GithubActivityRow = typeof projectGithubActivities.$inferSelect;
export type GithubBindingProjectRow = typeof projects.$inferSelect;

export type GithubBindingActorInput = {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
};

export type UpsertGithubBindingInput = GithubBindingActorInput & {
  repoFullName: string;
  patCiphertext: Buffer;
  patIv: Buffer;
  patAuthTag: Buffer;
  at?: Date;
};

export type UpsertGithubActivityInput = {
  projectId: string;
  kind: GithubActivityKind;
  externalId: string;
  title: string;
  htmlUrl: string;
  occurredAt: Date;
  authorLogin?: string | null;
  state?: string | null;
  relatedWorkItemId?: string | null;
};

export type GithubSyncWatermarkPatch = {
  commitsSince?: Date;
  issuesSince?: Date;
  etagJson?: Record<string, unknown>;
};

export type GithubBindingViewRecord = {
  project: GithubBindingProjectRow;
  binding: GithubBindingRow | null;
};

export type GithubBindingRepository = {
  // 读状态（宽口径）：只按 projectId 取项目行 + 绑定行，租户/可见性判定交给服务层
  // canViewProjectDrive（它自带 org/workspace scope 匹配与 archived/deleted 守卫）。
  findProjectWithBinding: (projectId: string) => Promise<GithubBindingViewRecord | null>;
  // 写权限探针（严格 owner 口径）：活跃项目 + owner=actor + 活跃工作区 membership，全部命中才返回。
  findBindingOwnerAccessRecord: (
    input: GithubBindingActorInput
  ) => Promise<GithubBindingViewRecord | null>;
  // 绑定或更新（换 repo/换 PAT 都算重新开始）：owner 锁内 upsert，重置全部水位与失败记录。
  upsertBinding: (input: UpsertGithubBindingInput) => Promise<GithubBindingRow>;
  // 解绑=物理删行（密文销毁），活动表靠 ON DELETE CASCADE 一并清理。返回是否真的删了行。
  deleteBinding: (input: GithubBindingActorInput) => Promise<boolean>;
  // 最近 7 天活动计数（绑定状态卡展示用）。
  countActivitiesSince: (projectId: string, since: Date) => Promise<number>;
  // 项目主页 github 区块的取数切片（GH-C 消费）。
  listRecentActivitiesByProject: (projectId: string, limit: number) => Promise<GithubActivityRow[]>;
  // ---- 以下为轮询 worker（GH-B）依赖的查询原语 ----
  listEnabledBindings: () => Promise<GithubBindingRow[]>;
  // 活动幂等落库：ON CONFLICT (project_id, kind, external_id) DO UPDATE 只更新会变的字段
  // （title/state/author——PR open 变 merged 更新已存行；occurred_at/html_url 不覆盖）。
  upsertActivity: (input: UpsertGithubActivityInput) => Promise<void>;
  // 成功收口：推进水位 + last_synced_at + 清空上次失败记录。
  recordSyncSuccess: (projectId: string, patch: GithubSyncWatermarkPatch, at: Date) => Promise<void>;
  // 失败降级不骚扰：只落人话摘要（调用方保证不含 token/堆栈），不推进水位。
  recordSyncFailure: (projectId: string, error: string, at: Date) => Promise<void>;
};

class NamedGithubBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class GithubBindingAccessDeniedError extends NamedGithubBindingError {}
export class GithubBindingWriteFailedError extends NamedGithubBindingError {}

function activeProjectOwnerCondition(input: GithubBindingActorInput) {
  return and(
    eq(projects.id, input.projectId),
    eq(projects.workspaceId, input.workspaceId),
    eq(projects.ownerUserId, input.actorUserId),
    eq(projects.archived, false),
    isNull(projects.deletedAt)
  );
}

async function lockProjectOwnerAccess(tx: WorkHubDb, input: GithubBindingActorInput) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(activeProjectOwnerCondition(input))
    .for("share", { of: projects })
    .limit(1);
  if (!project) {
    return null;
  }
  const [membership] = await tx
    .select({ membershipRole: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.userId, input.actorUserId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .for("share", { of: workspaceMemberships })
    .limit(1);
  return membership ? project : null;
}

export function createGithubBindingRepository(db: WorkHubDb): GithubBindingRepository {
  return {
    async findProjectWithBinding(projectId) {
      const [record] = await db
        .select({ project: projects, binding: projectGithubBindings })
        .from(projects)
        .leftJoin(projectGithubBindings, eq(projectGithubBindings.projectId, projects.id))
        .where(eq(projects.id, projectId))
        .limit(1);
      return record ?? null;
    },

    async findBindingOwnerAccessRecord(input) {
      const [record] = await db
        .select({ project: projects, binding: projectGithubBindings })
        .from(projects)
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, projects.workspaceId),
            eq(workspaceMemberships.userId, input.actorUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(projectGithubBindings, eq(projectGithubBindings.projectId, projects.id))
        .where(activeProjectOwnerCondition(input))
        .limit(1);
      return record ?? null;
    },

    async upsertBinding(input) {
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const project = await lockProjectOwnerAccess(tx, input);
        if (!project) {
          throw new GithubBindingAccessDeniedError(
            "active project ownership and workspace membership are required to manage the GitHub binding"
          );
        }
        // 重新绑定即覆盖旧密文并重置水位——换 repo 或换 PAT 都视为「重新开始」，
        // 不带着旧仓库的水位/ETag/失败记录去拉新仓库。
        const [written] = await tx
          .insert(projectGithubBindings)
          .values({
            projectId: input.projectId,
            repoFullName: input.repoFullName,
            patCiphertext: input.patCiphertext,
            patIv: input.patIv,
            patAuthTag: input.patAuthTag,
            enabled: true,
            createdByUserId: input.actorUserId,
            etagJson: {},
            createdAt: at,
            updatedAt: at
          })
          .onConflictDoUpdate({
            target: projectGithubBindings.projectId,
            set: {
              repoFullName: input.repoFullName,
              patCiphertext: input.patCiphertext,
              patIv: input.patIv,
              patAuthTag: input.patAuthTag,
              enabled: true,
              createdByUserId: input.actorUserId,
              commitsSince: null,
              issuesSince: null,
              etagJson: {},
              lastSyncedAt: null,
              lastError: null,
              lastErrorAt: null,
              updatedAt: at
            }
          })
          .returning();
        if (!written) {
          throw new GithubBindingWriteFailedError("GitHub binding upsert returned no row");
        }
        return written;
      });
    },

    async deleteBinding(input) {
      return db.transaction(async (tx) => {
        const project = await lockProjectOwnerAccess(tx, input);
        if (!project) {
          throw new GithubBindingAccessDeniedError(
            "active project ownership and workspace membership are required to manage the GitHub binding"
          );
        }
        const deleted = await tx
          .delete(projectGithubBindings)
          .where(eq(projectGithubBindings.projectId, input.projectId))
          .returning();
        return deleted.length > 0;
      });
    },

    async countActivitiesSince(projectId, since) {
      const [row] = await db
        .select({ value: count() })
        .from(projectGithubActivities)
        .where(
          and(
            eq(projectGithubActivities.projectId, projectId),
            gte(projectGithubActivities.occurredAt, since)
          )
        );
      return row?.value ?? 0;
    },

    async listRecentActivitiesByProject(projectId, limit) {
      return db
        .select()
        .from(projectGithubActivities)
        .where(eq(projectGithubActivities.projectId, projectId))
        .orderBy(desc(projectGithubActivities.occurredAt))
        .limit(limit);
    },

    async listEnabledBindings() {
      return db
        .select()
        .from(projectGithubBindings)
        .where(eq(projectGithubBindings.enabled, true));
    },

    async upsertActivity(input) {
      await db
        .insert(projectGithubActivities)
        .values({
          projectId: input.projectId,
          kind: input.kind,
          externalId: input.externalId,
          title: input.title,
          htmlUrl: input.htmlUrl,
          occurredAt: input.occurredAt,
          authorLogin: input.authorLogin ?? null,
          state: input.state ?? null,
          relatedWorkItemId: input.relatedWorkItemId ?? null
        })
        .onConflictDoUpdate({
          target: [
            projectGithubActivities.projectId,
            projectGithubActivities.kind,
            projectGithubActivities.externalId
          ],
          set: {
            title: input.title,
            state: input.state ?? null,
            authorLogin: input.authorLogin ?? null,
            ...(input.relatedWorkItemId !== undefined
              ? { relatedWorkItemId: input.relatedWorkItemId }
              : {})
          }
        });
    },

    async recordSyncSuccess(projectId, patch, at) {
      await db
        .update(projectGithubBindings)
        .set({
          ...(patch.commitsSince !== undefined ? { commitsSince: patch.commitsSince } : {}),
          ...(patch.issuesSince !== undefined ? { issuesSince: patch.issuesSince } : {}),
          ...(patch.etagJson !== undefined ? { etagJson: patch.etagJson } : {}),
          lastSyncedAt: at,
          lastError: null,
          lastErrorAt: null,
          updatedAt: at
        })
        .where(eq(projectGithubBindings.projectId, projectId));
    },

    async recordSyncFailure(projectId, error, at) {
      await db
        .update(projectGithubBindings)
        .set({
          lastError: error,
          lastErrorAt: at,
          updatedAt: at
        })
        .where(eq(projectGithubBindings.projectId, projectId));
    }
  };
}

// §5.3 RISK digest 扩展钩子：本批不被任何调用方使用，纯粹为未来 RISK v2 准备的独立可测函数
// （「这个项目绑了 repo 但 N 天没有新 commit」），不产生跨批次运行时耦合。
export async function listStaleReposSinceThreshold(
  db: WorkHubDb,
  input: { projectIds: string[]; thresholdDays: number; now: Date }
): Promise<Array<{ projectId: string; lastActivityAt: Date | null }>> {
  if (input.projectIds.length === 0) {
    return [];
  }
  const cutoff = new Date(input.now.getTime() - input.thresholdDays * 24 * 60 * 60 * 1000);
  const lastActivity = db
    .select({
      projectId: projectGithubActivities.projectId,
      lastActivityAt: max(projectGithubActivities.occurredAt).as("last_activity_at")
    })
    .from(projectGithubActivities)
    .groupBy(projectGithubActivities.projectId)
    .as("last_activity");
  const rows = await db
    .select({
      projectId: projectGithubBindings.projectId,
      lastActivityAt: lastActivity.lastActivityAt
    })
    .from(projectGithubBindings)
    .leftJoin(lastActivity, eq(lastActivity.projectId, projectGithubBindings.projectId))
    .where(
      and(
        eq(projectGithubBindings.enabled, true),
        sql`${projectGithubBindings.projectId} = ANY(${input.projectIds})`,
        sql`(${lastActivity.lastActivityAt} IS NULL OR ${lastActivity.lastActivityAt} < ${cutoff})`
      )
    );
  return rows.map((row) => ({
    projectId: row.projectId,
    lastActivityAt: row.lastActivityAt ?? null
  }));
}
