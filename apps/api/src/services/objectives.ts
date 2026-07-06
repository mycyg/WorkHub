import {
  createObjectiveRepository,
  getSharedDatabaseClient,
  type ObjectivePlanningContextRows
} from "@workhub/db";

export class ObjectiveServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type ObjectivePlanningContext = {
  objectiveId: string;
  title: string;
  lines: string[];
};

export type ObjectivePlanningService = {
  getPlanningContext: (input: {
    objectiveId: string;
    workspaceId: string;
  }) => Promise<ObjectivePlanningContext>;
};

export type ObjectivePlanningRepository = {
  getPlanningContext: (input: {
    objectiveId: string;
    workspaceId: string;
    keyResultLimit?: number;
  }) => Promise<ObjectivePlanningContextRows | null>;
};

function formatObjectiveLines(rows: ObjectivePlanningContextRows) {
  const lines = [
    `Objective: ${rows.objective.title}`,
    rows.objective.descriptionMd ? `Description: ${rows.objective.descriptionMd}` : undefined,
    `Status: ${rows.objective.status}`,
    `Progress: ${rows.objective.progressPct}%`
  ].filter((line): line is string => typeof line === "string");
  for (const keyResult of rows.keyResults) {
    lines.push(`KR ${keyResult.seq}: ${keyResult.title} (${keyResult.status}, ${keyResult.progressPct}%)`);
  }
  return lines;
}

export function createObjectivePlanningService(repository: ObjectivePlanningRepository): ObjectivePlanningService {
  return {
    async getPlanningContext(input) {
      const rows = await repository.getPlanningContext({
        objectiveId: input.objectiveId,
        workspaceId: input.workspaceId
      });
      if (!rows) {
        throw new ObjectiveServiceError(404, "objective_not_found", "没有找到这个目标，或它不属于当前工作区。");
      }
      return {
        objectiveId: rows.objective.id,
        title: rows.objective.title,
        lines: formatObjectiveLines(rows)
      };
    }
  };
}

export function getDefaultObjectivePlanningService() {
  return createObjectivePlanningService(createObjectiveRepository(getSharedDatabaseClient().db));
}
