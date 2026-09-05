import { randomUUID } from "node:crypto";

import {
  createObjectiveRepository,
  getSharedDatabaseClient,
  type ObjectiveDetailResult as DbObjectiveDetailResult,
  type ObjectiveListResult as DbObjectiveListResult,
  type ObjectivePlanningContextResult,
  type ObjectiveProgressSnapshot as DbObjectiveProgressSnapshot,
  type ObjectiveRepository as DbObjectiveRepository,
  type ObjectiveRow
} from "@workhub/db";

export type ObjectiveProgressSnapshot = DbObjectiveProgressSnapshot;
export type ObjectiveListResult = DbObjectiveListResult;
export type ObjectiveDetailResult = DbObjectiveDetailResult;

export type ObjectiveRepository = Pick<
  DbObjectiveRepository,
  | "listPlanningContextForWorkItem"
  | "readObjectiveProgressSnapshot"
  | "updateObjectiveProgress"
  | "createObjective"
  | "linkWorkItem"
  | "listActiveObjectiveIdsForWorkspace"
  | "listObjectivesForWorkspace"
  | "readObjectiveDetail"
>;

export type ObjectivePlanningContextForPlanner = {
  lines: string[];
  capped: boolean;
  objectiveId?: string;
};

export type ObjectiveRefreshResult = {
  objective: ObjectiveRow;
  progressPercent: number;
  capped: boolean;
};

export type ObjectiveService = {
  planningContextForWorkItem: (input: {
    workspaceId: string;
    workItemId: string;
  }) => Promise<ObjectivePlanningContextForPlanner>;
  refreshObjectiveProgress: (input: {
    workspaceId: string;
    objectiveId: string;
  }) => Promise<ObjectiveRefreshResult | null>;
  // B-R9.5-1（branch-review 整块死接线）：objectives 此前只有表和函数没接线——
  // 创建/链接入口 + 夜间聚合批量刷新是让它活起来的三个调用面。
  createObjective: (input: {
    workspaceId: string;
    title: string;
    descriptionMd?: string;
    ownerUserId?: string;
    keyResults?: Array<{ title: string; targetValue?: string; currentValue?: string; unit?: string }>;
  }) => Promise<ObjectiveRow>;
  linkWorkItem: (input: {
    workspaceId: string;
    objectiveId: string;
    workItemId: string;
    linkedByUserId?: string;
  }) => Promise<void>;
  refreshWorkspaceObjectives: (workspaceId: string) => Promise<number>;
  // R23 F-01（OKR 列表/详情持久化）：项目主页 OKR 面板首屏真拉取 + 详情抽屉的读入口。两个方法都是
  // 仓库层的薄封装（同 createObjective/linkWorkItem 的既有风格——业务逻辑在仓库查询里，服务层不加工），
  // 路由层负责映射成响应契约的 snake_case 形状。
  listObjectives: (input: { workspaceId: string; limit?: number }) => Promise<ObjectiveListResult>;
  getObjective: (input: { workspaceId: string; objectiveId: string }) => Promise<ObjectiveDetailResult | null>;
};

export type ObjectiveServiceOptions = {
  objectives: ObjectiveRepository;
  id?: () => string;
  now?: () => Date;
};

const COMPLETED_WORK_ITEM_STATUSES = new Set(["done", "merged"]);

function percent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(value), 0), 100);
}

function valueHint(row: { currentValue: string | null; targetValue: string | null; unit: string | null }) {
  if (!row.currentValue && !row.targetValue) {
    return "";
  }
  const current = row.currentValue ?? "?";
  const target = row.targetValue ?? "?";
  return `, ${current}/${target}${row.unit ? ` ${row.unit}` : ""}`;
}

export function buildObjectivePlanningLines(input: ObjectivePlanningContextResult): ObjectivePlanningContextForPlanner {
  const lines: string[] = [];
  for (const item of input.objectives) {
    const description = item.objective.descriptionMd?.trim();
    lines.push([
      `Objective: ${item.objective.title} (${item.objective.progressPercent}%)`,
      description ? ` - ${description}` : ""
    ].join(""));
    for (const kr of item.keyResults) {
      lines.push(`KR ${kr.seq}: ${kr.title} (${kr.progressPercent}%${valueHint(kr)})`);
    }
  }
  if (input.objectivesCapped || input.keyResultsCapped) {
    lines.push("Objective context capped; more OKR rows exist outside this planning prompt.");
  }
  const firstObjectiveId = input.objectives[0]?.objective.id;
  return {
    lines,
    capped: input.objectivesCapped || input.keyResultsCapped,
    ...(firstObjectiveId ? { objectiveId: firstObjectiveId } : {})
  };
}

function progressFromSnapshot(snapshot: ObjectiveProgressSnapshot) {
  if (snapshot.keyResults.length > 0) {
    const total = snapshot.keyResults.reduce((sum, row) => sum + row.progressPercent, 0);
    return percent(total / snapshot.keyResults.length);
  }
  if (snapshot.linkedWorkItems.length > 0) {
    const completed = snapshot.linkedWorkItems.filter((row) => COMPLETED_WORK_ITEM_STATUSES.has(row.status)).length;
    return percent((completed / snapshot.linkedWorkItems.length) * 100);
  }
  return percent(snapshot.objective.progressPercent);
}

export function createObjectiveService(options: ObjectiveServiceOptions): ObjectiveService {
  const now = options.now ?? (() => new Date());
  const nextId = options.id ?? randomUUID;
  return {
    async planningContextForWorkItem(input) {
      const context = await options.objectives.listPlanningContextForWorkItem(input);
      return buildObjectivePlanningLines(context);
    },

    async refreshObjectiveProgress(input) {
      const snapshot = await options.objectives.readObjectiveProgressSnapshot(input);
      if (!snapshot) {
        return null;
      }
      const progressPercent = progressFromSnapshot(snapshot);
      const objective = await options.objectives.updateObjectiveProgress({
        workspaceId: input.workspaceId,
        objectiveId: input.objectiveId,
        progressPercent,
        progressUpdatedAt: now()
      });
      if (!objective) {
        return null;
      }
      return {
        objective,
        progressPercent,
        capped: snapshot.keyResultsCapped || snapshot.workItemsCapped
      };
    },

    async createObjective(input) {
      return options.objectives.createObjective({
        id: nextId(),
        workspaceId: input.workspaceId,
        title: input.title,
        ...(input.descriptionMd ? { descriptionMd: input.descriptionMd } : {}),
        ...(input.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
        keyResults: (input.keyResults ?? []).map((keyResult, index) => ({
          id: nextId(),
          seq: index,
          title: keyResult.title,
          ...(keyResult.targetValue ? { targetValue: keyResult.targetValue } : {}),
          ...(keyResult.currentValue ? { currentValue: keyResult.currentValue } : {}),
          ...(keyResult.unit ? { unit: keyResult.unit } : {})
        })),
        now: now()
      });
    },

    async linkWorkItem(input) {
      await options.objectives.linkWorkItem({
        workspaceId: input.workspaceId,
        objectiveId: input.objectiveId,
        workItemId: input.workItemId,
        ...(input.linkedByUserId ? { linkedByUserId: input.linkedByUserId } : {}),
        now: now()
      });
    },

    // 夜间聚合的调用面：刷新该工作区活跃 objective 的进度（cap 20，失败不打断整轮）。
    async refreshWorkspaceObjectives(workspaceId) {
      const objectiveIds = await options.objectives.listActiveObjectiveIdsForWorkspace({ workspaceId, limit: 20 });
      let refreshed = 0;
      for (const objectiveId of objectiveIds) {
        const result = await this.refreshObjectiveProgress({ workspaceId, objectiveId });
        if (result) {
          refreshed += 1;
        }
      }
      return refreshed;
    },

    async listObjectives(input) {
      return options.objectives.listObjectivesForWorkspace(input);
    },

    async getObjective(input) {
      return options.objectives.readObjectiveDetail(input);
    }
  };
}

let defaultObjectiveService: ObjectiveService | undefined;

export function getDefaultObjectiveService(): ObjectiveService {
  if (!defaultObjectiveService) {
    defaultObjectiveService = createObjectiveService({
      objectives: createObjectiveRepository(getSharedDatabaseClient().db)
    });
  }
  return defaultObjectiveService;
}
