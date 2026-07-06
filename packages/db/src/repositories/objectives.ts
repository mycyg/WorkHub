import { and, asc, eq } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  keyResults,
  objectives
} from "../schema/index.js";

export type ObjectiveRow = typeof objectives.$inferSelect;
export type KeyResultRow = typeof keyResults.$inferSelect;

export type ObjectivePlanningContextRows = {
  objective: ObjectiveRow;
  keyResults: KeyResultRow[];
};

const DEFAULT_KEY_RESULT_LIMIT = 8;
const MAX_KEY_RESULT_LIMIT = 20;

function boundedKeyResultLimit(input: number | undefined) {
  if (!Number.isFinite(input)) {
    return DEFAULT_KEY_RESULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(input ?? DEFAULT_KEY_RESULT_LIMIT), 0), MAX_KEY_RESULT_LIMIT);
}

export function createObjectiveRepository(db: WorkHubDb) {
  return {
    async getPlanningContext(input: {
      objectiveId: string;
      workspaceId: string;
      keyResultLimit?: number;
    }): Promise<ObjectivePlanningContextRows | null> {
      const [objective] = await db
        .select()
        .from(objectives)
        .where(and(
          eq(objectives.id, input.objectiveId),
          eq(objectives.workspaceId, input.workspaceId)
        ))
        .limit(1);
      if (!objective) {
        return null;
      }

      const limit = boundedKeyResultLimit(input.keyResultLimit);
      const rows = await db
        .select()
        .from(keyResults)
        .where(eq(keyResults.objectiveId, objective.id))
        .orderBy(asc(keyResults.seq), asc(keyResults.id))
        .limit(limit);

      return { objective, keyResults: rows };
    }
  };
}
