import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { WorkItemStatus } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  objectiveWorkItemLinks,
  projectMilestones,
  workItemDependencies,
  workItems
} from "../schema/index.js";

type WorkHubTx = Parameters<Parameters<WorkHubDb["transaction"]>[0]>[0];

export type ProjectMilestoneRow = typeof projectMilestones.$inferSelect;
export type WorkItemDependencyRow = typeof workItemDependencies.$inferSelect;

// 时间线（甘特）取数行：只取渲染排期条要用的列（避免整行 work_items 装配）。
export type TimelineWorkItemRow = {
  id: string;
  code: string;
  title: string | null;
  status: WorkItemStatus;
  startAt: Date | null;
  dueAt: Date | null;
  claimedByUserId: string | null;
  claimedByNickname: string | null;
  milestoneId: string | null;
};

// 依赖有向边（A 依赖 B → { workItemId: A, dependsOnWorkItemId: B }）。
export type DependencyEdge = { workItemId: string; dependsOnWorkItemId: string };

export type CreateMilestoneInput = {
  id?: string;
  projectId: string;
  title: string;
  dueAt?: Date | null;
  sort?: number;
  now?: Date;
};

export type UpdateMilestoneInput = {
  projectId: string;
  milestoneId: string;
  title?: string;
  dueAt?: Date | null;
  sort?: number;
  status?: "open" | "done";
  now?: Date;
};

export type AddDependencyInput = {
  id?: string;
  workItemId: string;
  dependsOnWorkItemId: string;
  createdByUserId?: string | null;
  now?: Date;
};

// 仓库层的排期/依赖治理错误（服务/路由层映射成 422 带明确错误码；MVP 不跨项目、禁自依赖、禁成环）。
export class TimelineDependencyError extends Error {
  constructor(public readonly code: "self_dependency" | "cross_project" | "cycle" | "work_item_not_found", message: string) {
    super(message);
    this.name = "TimelineDependencyError";
  }
}

// 里程碑挂载/操作的作用域错误（里程碑不属于该项目 / 不存在）。
export class TimelineMilestoneScopeError extends Error {
  constructor(message = "milestone_scope_mismatch") {
    super(message);
    this.name = "TimelineMilestoneScopeError";
  }
}

// 项目规模内做传递闭包可接受，但仍设上限防御（超大项目图退化）：读取的边/节点上限，与内存 BFS 的访问上限。
const MAX_TIMELINE_WORK_ITEMS = 2000;
const MAX_DEPENDENCY_EDGES = 8000;
// 环检测 BFS 的访问上限（防御：正常项目图远小于此，触顶只发生在异常大/退化图，触顶即保守拒绝加边）。
const CYCLE_WALK_VISIT_CAP = 20000;

function terminalStatuses(): WorkItemStatus[] {
  return ["merged", "done", "cancelled"];
}

async function loadProjectDependencyEdges(db: WorkHubDb | WorkHubTx, projectId: string): Promise<DependencyEdge[]> {
  // 只取两端都在本项目、且两端工作项都未软删的边（MVP：依赖不跨项目，仓库层强制）。
  const rows = await db
    .select({
      workItemId: workItemDependencies.workItemId,
      dependsOnWorkItemId: workItemDependencies.dependsOnWorkItemId
    })
    .from(workItemDependencies)
    .innerJoin(workItems, eq(workItemDependencies.workItemId, workItems.id))
    .where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)))
    .limit(MAX_DEPENDENCY_EDGES);
  return rows;
}

// 加边 (A 依赖 B) 是否成环：当且仅当 B 已能沿 depends_on 边走到 A（B → … → A），再加 A → B 即闭环。
// 从 B 出发在正向图（node → 它的 depends_on 目标）做 BFS，命中 A 即环。visited 去重 + 访问上限防御。
export function wouldCreateDependencyCycle(
  edges: DependencyEdge[],
  workItemId: string,
  dependsOnWorkItemId: string
): boolean {
  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    const bucket = forward.get(edge.workItemId) ?? [];
    bucket.push(edge.dependsOnWorkItemId);
    forward.set(edge.workItemId, bucket);
  }
  const visited = new Set<string>();
  const queue: string[] = [dependsOnWorkItemId];
  let steps = 0;
  while (queue.length > 0) {
    if (steps++ > CYCLE_WALK_VISIT_CAP) {
      // 图异常大/退化：保守当作会成环（拒绝加边），而不是无界遍历。
      return true;
    }
    const current = queue.shift()!;
    if (current === workItemId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    for (const next of forward.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }
  return false;
}

// 传递闭包：每个「未完成」项直接 + 传递阻塞的「未完成」项数。edge A→B 表示 A 依赖 B（B 阻塞 A），故
// 反向图 B → [依赖 B 的项] 上，从 B 可达的未完成项集合大小（不含自己）即 blocks_count。菱形/链/多根都正确。
export function computeBlockingCounts(
  items: Array<{ id: string; status: WorkItemStatus }>,
  edges: DependencyEdge[]
): Map<string, number> {
  const terminal = new Set(terminalStatuses());
  const openIds = new Set(items.filter((item) => !terminal.has(item.status)).map((item) => item.id));
  // 反向邻接：被依赖方 → 依赖它的那些项。只保留两端都是已知节点的边。
  const known = new Set(items.map((item) => item.id));
  const reverse = new Map<string, string[]>();
  for (const edge of edges) {
    if (!known.has(edge.workItemId) || !known.has(edge.dependsOnWorkItemId)) {
      continue;
    }
    const bucket = reverse.get(edge.dependsOnWorkItemId) ?? [];
    bucket.push(edge.workItemId);
    reverse.set(edge.dependsOnWorkItemId, bucket);
  }
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!openIds.has(item.id)) {
      continue;
    }
    const visited = new Set<string>();
    const queue = [...(reverse.get(item.id) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
      for (const next of reverse.get(current) ?? []) {
        if (!visited.has(next)) {
          queue.push(next);
        }
      }
    }
    // 只数未完成的下游（已完成的下游不再「等」它）。
    let blocked = 0;
    for (const downstream of visited) {
      if (downstream !== item.id && openIds.has(downstream)) {
        blocked += 1;
      }
    }
    counts.set(item.id, blocked);
  }
  return counts;
}

export type ProjectTimelineRepository = {
  // 里程碑 CRUD（软删）。
  createMilestone: (input: CreateMilestoneInput) => Promise<ProjectMilestoneRow>;
  updateMilestone: (input: UpdateMilestoneInput) => Promise<ProjectMilestoneRow | null>;
  softDeleteMilestone: (input: { projectId: string; milestoneId: string; now?: Date }) => Promise<boolean>;
  listActiveMilestonesByProject: (projectId: string, limit?: number) => Promise<ProjectMilestoneRow[]>;
  // 依赖增删（同项目 + 禁自依赖 + 环检测在仓库层强制）。
  addDependency: (input: AddDependencyInput) => Promise<{ edge: WorkItemDependencyRow; created: boolean }>;
  removeDependency: (input: { workItemId: string; dependsOnWorkItemId: string }) => Promise<boolean>;
  // 工作项挂里程碑（同项目校验；milestoneId=null 卸载）。
  attachWorkItemMilestone: (input: { workItemId: string; milestoneId: string | null; now?: Date }) => Promise<boolean>;
  // 时间线取数（纯读）。
  listTimelineWorkItems: (projectId: string, limit?: number) => Promise<TimelineWorkItemRow[]>;
  listDependencyEdgesByProject: (projectId: string) => Promise<DependencyEdge[]>;
  listObjectiveIdsByWorkItemIds: (input: { workspaceId: string; workItemIds: string[] }) => Promise<Map<string, string[]>>;
};

function clampSort(input: number | undefined): number {
  if (!Number.isFinite(input)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(input ?? 0), 1_000_000));
}

async function loadWorkItemScope(
  db: WorkHubDb | WorkHubTx,
  ids: string[]
): Promise<Map<string, { projectId: string; deletedAt: Date | null }>> {
  const rows = await db
    .select({ id: workItems.id, projectId: workItems.projectId, deletedAt: workItems.deletedAt })
    .from(workItems)
    .where(inArray(workItems.id, ids));
  const byId = new Map<string, { projectId: string; deletedAt: Date | null }>();
  for (const row of rows) {
    byId.set(row.id, { projectId: row.projectId, deletedAt: row.deletedAt });
  }
  return byId;
}

export function createProjectTimelineRepository(db: WorkHubDb): ProjectTimelineRepository {
  return {
    async createMilestone(input) {
      const at = input.now ?? new Date();
      const [row] = await db
        .insert(projectMilestones)
        .values({
          id: input.id ?? randomUUID(),
          projectId: input.projectId,
          title: input.title,
          dueAt: input.dueAt ?? null,
          sort: clampSort(input.sort),
          status: "open",
          createdAt: at,
          updatedAt: at,
          deletedAt: null
        })
        .returning();
      return row!;
    },

    async updateMilestone(input) {
      const at = input.now ?? new Date();
      const patch: Partial<typeof projectMilestones.$inferInsert> = { updatedAt: at };
      if (input.title !== undefined) patch.title = input.title;
      if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
      if (input.sort !== undefined) patch.sort = clampSort(input.sort);
      if (input.status !== undefined) patch.status = input.status;
      const [row] = await db
        .update(projectMilestones)
        .set(patch)
        .where(and(
          eq(projectMilestones.id, input.milestoneId),
          eq(projectMilestones.projectId, input.projectId),
          isNull(projectMilestones.deletedAt)
        ))
        .returning();
      return row ?? null;
    },

    async softDeleteMilestone(input) {
      const at = input.now ?? new Date();
      const rows = await db
        .update(projectMilestones)
        .set({ deletedAt: at, updatedAt: at })
        .where(and(
          eq(projectMilestones.id, input.milestoneId),
          eq(projectMilestones.projectId, input.projectId),
          isNull(projectMilestones.deletedAt)
        ))
        .returning({ id: projectMilestones.id });
      return rows.length > 0;
    },

    async listActiveMilestonesByProject(projectId, limit = 200) {
      return db
        .select()
        .from(projectMilestones)
        .where(and(eq(projectMilestones.projectId, projectId), isNull(projectMilestones.deletedAt)))
        .orderBy(asc(projectMilestones.sort), asc(projectMilestones.dueAt), asc(projectMilestones.createdAt))
        .limit(Math.min(Math.max(1, limit), 500));
    },

    async addDependency(input) {
      if (input.workItemId === input.dependsOnWorkItemId) {
        throw new TimelineDependencyError("self_dependency", "一个工作项不能依赖它自己。");
      }
      const at = input.now ?? new Date();
      return db.transaction(async (tx) => {
        const scope = await loadWorkItemScope(tx, [input.workItemId, input.dependsOnWorkItemId]);
        const dependent = scope.get(input.workItemId);
        const dependency = scope.get(input.dependsOnWorkItemId);
        if (!dependent || dependent.deletedAt || !dependency || dependency.deletedAt) {
          throw new TimelineDependencyError("work_item_not_found", "没有找到要建立依赖的工作项。");
        }
        if (dependent.projectId !== dependency.projectId) {
          throw new TimelineDependencyError("cross_project", "依赖只能建立在同一个项目内的工作项之间。");
        }
        const edges = await loadProjectDependencyEdges(tx, dependent.projectId);
        if (wouldCreateDependencyCycle(edges, input.workItemId, input.dependsOnWorkItemId)) {
          throw new TimelineDependencyError("cycle", "这条依赖会造成循环依赖（A 依赖 B、B 又绕回依赖 A）。");
        }
        const inserted = await tx
          .insert(workItemDependencies)
          .values({
            id: input.id ?? randomUUID(),
            workItemId: input.workItemId,
            dependsOnWorkItemId: input.dependsOnWorkItemId,
            createdByUserId: input.createdByUserId ?? null,
            createdAt: at
          })
          .onConflictDoNothing({
            target: [workItemDependencies.workItemId, workItemDependencies.dependsOnWorkItemId]
          })
          .returning();
        if (inserted[0]) {
          return { edge: inserted[0], created: true };
        }
        // 幂等：边已存在（复合唯一冲突被 onConflictDoNothing 吞掉），回读现存边。
        const [existing] = await tx
          .select()
          .from(workItemDependencies)
          .where(and(
            eq(workItemDependencies.workItemId, input.workItemId),
            eq(workItemDependencies.dependsOnWorkItemId, input.dependsOnWorkItemId)
          ))
          .limit(1);
        return { edge: existing!, created: false };
      });
    },

    async removeDependency(input) {
      const rows = await db
        .delete(workItemDependencies)
        .where(and(
          eq(workItemDependencies.workItemId, input.workItemId),
          eq(workItemDependencies.dependsOnWorkItemId, input.dependsOnWorkItemId)
        ))
        .returning({ id: workItemDependencies.id });
      return rows.length > 0;
    },

    async attachWorkItemMilestone(input) {
      const at = input.now ?? new Date();
      if (input.milestoneId !== null) {
        // 同项目校验：里程碑必须与工作项同项目、且未软删——否则拒绝（TimelineMilestoneScopeError）。
        const [pair] = await db
          .select({ workItemId: workItems.id })
          .from(workItems)
          .innerJoin(projectMilestones, and(
            eq(projectMilestones.id, input.milestoneId),
            eq(projectMilestones.projectId, workItems.projectId),
            isNull(projectMilestones.deletedAt)
          ))
          .where(and(eq(workItems.id, input.workItemId), isNull(workItems.deletedAt)))
          .limit(1);
        if (!pair) {
          throw new TimelineMilestoneScopeError();
        }
      }
      const rows = await db
        .update(workItems)
        .set({ milestoneId: input.milestoneId, updatedAt: at })
        .where(and(eq(workItems.id, input.workItemId), isNull(workItems.deletedAt)))
        .returning({ id: workItems.id });
      return rows.length > 0;
    },

    async listTimelineWorkItems(projectId, limit = MAX_TIMELINE_WORK_ITEMS) {
      const rows = await db
        .select({
          id: workItems.id,
          code: workItems.code,
          title: workItems.title,
          status: workItems.status,
          startAt: workItems.startAt,
          dueAt: workItems.dueAt,
          claimedByUserId: workItems.claimedByUserId,
          claimedByNickname: workItems.claimedByNickname,
          milestoneId: workItems.milestoneId
        })
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), isNull(workItems.deletedAt)))
        .orderBy(asc(workItems.dueAt), asc(workItems.createdAt))
        .limit(Math.min(Math.max(1, limit), MAX_TIMELINE_WORK_ITEMS));
      return rows.map((row) => ({ ...row, status: row.status as WorkItemStatus }));
    },

    async listDependencyEdgesByProject(projectId) {
      return loadProjectDependencyEdges(db, projectId);
    },

    // E1d OKR 挂钩（最小、只读）：时间线在工作项上标 OKR 关联。按 workspace 钉死，只返回有链接的项。
    async listObjectiveIdsByWorkItemIds(input) {
      const ids = [...new Set(input.workItemIds)];
      const result = new Map<string, string[]>();
      if (ids.length === 0) {
        return result;
      }
      const conditions: SQL[] = [
        eq(objectiveWorkItemLinks.workspaceId, input.workspaceId),
        inArray(objectiveWorkItemLinks.workItemId, ids)
      ];
      const rows = await db
        .select({
          workItemId: objectiveWorkItemLinks.workItemId,
          objectiveId: objectiveWorkItemLinks.objectiveId
        })
        .from(objectiveWorkItemLinks)
        .where(and(...conditions))
        .orderBy(desc(objectiveWorkItemLinks.createdAt))
        .limit(ids.length * 20);
      for (const row of rows) {
        const bucket = result.get(row.workItemId) ?? [];
        bucket.push(row.objectiveId);
        result.set(row.workItemId, bucket);
      }
      return result;
    }
  };
}
