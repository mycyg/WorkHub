import {
  createObjectiveRepository,
  getSharedDatabaseClient,
  type ObjectivePlanningContextResult,
  type ObjectiveProgressSnapshot as DbObjectiveProgressSnapshot,
  type ObjectiveRepository as DbObjectiveRepository,
  type ObjectiveRow
} from "@workhub/db";

export type ObjectiveProgressSnapshot = DbObjectiveProgressSnapshot;

export type ObjectiveRepository = Pick<
  DbObjectiveRepository,
  "listPlanningContextForWorkItem" | "readObjectiveProgressSnapshot" | "updateObjectiveProgress"
>;

export type ObjectivePlanningContextForPlanner = {
  lines: string[];
  capped: boolean;
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
};

export type ObjectiveServiceOptions = {
  objectives: ObjectiveRepository;
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
  return {
    lines,
    capped: input.objectivesCapped || input.keyResultsCapped
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
