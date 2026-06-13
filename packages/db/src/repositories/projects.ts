import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { orgs, projects, workspaces } from "../schema/index.js";

export type ProjectRow = typeof projects.$inferSelect;

export type BootstrapProjectInput = {
  orgId: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  slug: string;
  description?: string | null;
  ownerNickname: string;
  ownerUserId: string;
  at?: Date;
};

export type BootstrapProjectResultRow = {
  project: ProjectRow;
  created: boolean;
};

export type ProjectRepository = {
  bootstrapPilotProject: (input: BootstrapProjectInput) => Promise<BootstrapProjectResultRow>;
};

export function createProjectRepository(db: WorkHubDb): ProjectRepository {
  return {
    async bootstrapPilotProject(input) {
      const at = input.at ?? new Date();
      await db
        .insert(orgs)
        .values({
          id: input.orgId,
          name: "WorkHub Local",
          slug: "workhub-local",
          plan: "lan",
          createdAt: at,
          updatedAt: at
        })
        .onConflictDoNothing();

      await db
        .insert(workspaces)
        .values({
          id: input.workspaceId,
          orgId: input.orgId,
          name: "Pilot Workspace",
          slug: "pilot",
          createdAt: at,
          updatedAt: at
        })
        .onConflictDoNothing();

      const existingRows = await db
        .select()
        .from(projects)
        .where(and(eq(projects.slug, input.slug), eq(projects.archived, false), isNull(projects.deletedAt)))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        return { project: existing, created: false };
      }

      const rows = await db
        .insert(projects)
        .values({
          id: input.projectId ?? randomUUID(),
          workspaceId: input.workspaceId,
          name: input.name,
          slug: input.slug,
          ...(input.description ? { description: input.description } : {}),
          ownerNickname: input.ownerNickname,
          ownerUserId: input.ownerUserId,
          archived: false,
          nextSeq: 0,
          createdAt: at,
          updatedAt: at
        })
        .returning();
      const project = rows[0];
      if (!project) {
        throw new Error("Failed to create pilot project");
      }
      return { project, created: true };
    }
  };
}
