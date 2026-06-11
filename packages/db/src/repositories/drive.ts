import { and, asc, desc, eq, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  acceptedDeliverableChanges,
  projectDriveComments,
  projectDriveItems,
  projectDriveVersions,
  projects
} from "../schema/index.js";

export type DriveProjectRow = typeof projects.$inferSelect;
export type DriveItemRow = typeof projectDriveItems.$inferSelect;
export type DriveVersionRow = typeof projectDriveVersions.$inferSelect;
export type DriveCommentRow = typeof projectDriveComments.$inferSelect;
export type DriveAcceptedDeliverableRow = {
  accepted: typeof acceptedDeliverableChanges.$inferSelect;
  driveItem: typeof projectDriveItems.$inferSelect | null;
  driveVersion: typeof projectDriveVersions.$inferSelect | null;
};

export type DrivePageRows = {
  project: DriveProjectRow | null;
  items: DriveItemRow[];
  versions: DriveVersionRow[];
  acceptedDeliverables: DriveAcceptedDeliverableRow[];
  comments: DriveCommentRow[];
};

export type DriveRepository = {
  readPage: (input?: { projectId?: string; limit?: number }) => Promise<DrivePageRows>;
};

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(limit ?? 200, 500));
}

async function findProject(db: WorkHubDb, projectId?: string) {
  const baseConditions = [eq(projects.archived, false), isNull(projects.deletedAt)];
  const rows = await db
    .select()
    .from(projects)
    .where(and(...(projectId ? [...baseConditions, eq(projects.id, projectId)] : baseConditions)))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export function createDriveRepository(db: WorkHubDb): DriveRepository {
  return {
    async readPage(input = {}) {
      const project = await findProject(db, input.projectId);
      if (!project) {
        return {
          project: null,
          items: [],
          versions: [],
          acceptedDeliverables: [],
          comments: []
        };
      }

      const limit = clampLimit(input.limit);
      const [items, versionRows, acceptedDeliverables, comments] = await Promise.all([
        db
          .select()
          .from(projectDriveItems)
          .where(and(eq(projectDriveItems.projectId, project.id), isNull(projectDriveItems.deletedAt)))
          .orderBy(asc(projectDriveItems.parentId), asc(projectDriveItems.name), asc(projectDriveItems.createdAt))
          .limit(limit),
        db
          .select({ version: projectDriveVersions })
          .from(projectDriveVersions)
          .innerJoin(projectDriveItems, eq(projectDriveVersions.itemId, projectDriveItems.id))
          .where(and(eq(projectDriveItems.projectId, project.id), isNull(projectDriveItems.deletedAt)))
          .orderBy(desc(projectDriveVersions.createdAt), desc(projectDriveVersions.versionNo))
          .limit(limit),
        db
          .select({
            accepted: acceptedDeliverableChanges,
            driveItem: projectDriveItems,
            driveVersion: projectDriveVersions
          })
          .from(acceptedDeliverableChanges)
          .leftJoin(projectDriveItems, eq(acceptedDeliverableChanges.driveItemId, projectDriveItems.id))
          .leftJoin(projectDriveVersions, eq(acceptedDeliverableChanges.driveVersionId, projectDriveVersions.id))
          .where(and(
            eq(projectDriveItems.projectId, project.id),
            isNull(projectDriveItems.deletedAt),
            isNull(acceptedDeliverableChanges.supersededAt)
          ))
          .orderBy(desc(acceptedDeliverableChanges.createdAt))
          .limit(limit),
        db
          .select()
          .from(projectDriveComments)
          .where(eq(projectDriveComments.projectId, project.id))
          .orderBy(desc(projectDriveComments.createdAt))
          .limit(50)
      ]);

      return {
        project,
        items,
        versions: versionRows.map((row) => row.version),
        acceptedDeliverables,
        comments
      };
    }
  };
}
