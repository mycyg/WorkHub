import { randomUUID } from "node:crypto";

import { and, desc, eq, gte, isNull, ne, sql } from "drizzle-orm";

import { TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import { acceptedDeliverableChanges, escalationEvents, teamSkills, workItems, workspaces } from "../schema/index.js";

export type TeamSkillRow = typeof teamSkills.$inferSelect;

export type PromoteTeamSkillInput = {
  workspaceId: string;
  skillKey: string;
  name: string;
  whenToUse: string;
  contentMd: string;
  confidenceScore?: number;
  sampleCount?: number;
  samplesJson?: Record<string, unknown>;
  sourceRunId?: string;
  sourceKind?: "distilled" | "authored";
  createdByKind?: "ai" | "human";
};

export type AcceptedDeliverableSignal = { targetKind: string; count: number };
export type EscalationSignal = { reasonMd: string; trigger: string; count: number };

export type TeamSkillRepository = {
  promote: (input: PromoteTeamSkillInput) => Promise<TeamSkillRow>;
  listActive: (workspaceId: string) => Promise<TeamSkillRow[]>;
  listForWorkspace: (workspaceId: string) => Promise<TeamSkillRow[]>;
  getLatestVersion: (workspaceId: string, skillKey: string) => Promise<number>;
  listActiveSkillKeys: (workspaceId: string) => Promise<string[]>;
  deprecate: (workspaceId: string, id: string, reason: string, at?: Date) => Promise<boolean>;
  rollbackTo: (workspaceId: string, skillKey: string, version: number, at?: Date) => Promise<boolean>;
  // 蒸馏信号源（按 workspace 经 work_items 联接限定）。
  listActiveWorkspaceIds: () => Promise<string[]>;
  acceptedDeliverableSignals: (workspaceId: string, since: Date) => Promise<AcceptedDeliverableSignal[]>;
  escalationSignals: (workspaceId: string, since: Date) => Promise<EscalationSignal[]>;
};

// 活跃技能超上限时，按 confidence 升序驱逐最弱的（deprecate）。
async function evictActiveOverCap(db: WorkHubDb, workspaceId: string, at: Date): Promise<void> {
  const active = await db
    .select({ id: teamSkills.id, confidence: teamSkills.confidenceScore })
    .from(teamSkills)
    .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.status, "active")))
    .orderBy(desc(sql`coalesce(${teamSkills.confidenceScore}, 0)`), desc(teamSkills.createdAt));
  if (active.length <= TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE) {
    return;
  }
  for (const row of active.slice(TEAM_SKILL_MAX_ACTIVE_PER_WORKSPACE)) {
    await db
      .update(teamSkills)
      .set({ status: "deprecated", deprecatedReason: "active cap exceeded", deprecatedAt: at, updatedAt: at })
      .where(eq(teamSkills.id, row.id));
  }
}

export function createTeamSkillRepository(db: WorkHubDb): TeamSkillRepository {
  async function latestVersion(workspaceId: string, skillKey: string): Promise<number> {
    const rows = await db
      .select({ version: teamSkills.version })
      .from(teamSkills)
      .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.skillKey, skillKey)))
      .orderBy(desc(teamSkills.version))
      .limit(1);
    return rows[0]?.version ?? 0;
  }

  return {
    async promote(input) {
      const now = new Date();
      const nextVersion = (await latestVersion(input.workspaceId, input.skillKey)) + 1;

      // 同 key 的旧 active 版本先弃用，保证"一 key 一 active"。
      await db
        .update(teamSkills)
        .set({
          status: "deprecated",
          deprecatedReason: `superseded by v${nextVersion}`,
          deprecatedAt: now,
          updatedAt: now
        })
        .where(
          and(
            eq(teamSkills.workspaceId, input.workspaceId),
            eq(teamSkills.skillKey, input.skillKey),
            eq(teamSkills.status, "active")
          )
        );

      const inserted = await db
        .insert(teamSkills)
        .values({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          skillKey: input.skillKey,
          name: input.name,
          whenToUse: input.whenToUse,
          contentMd: input.contentMd,
          status: "active",
          version: nextVersion,
          sourceKind: input.sourceKind ?? "distilled",
          createdByKind: input.createdByKind ?? "ai",
          ...(input.confidenceScore !== undefined ? { confidenceScore: input.confidenceScore } : {}),
          sampleCount: input.sampleCount ?? 0,
          ...(input.samplesJson ? { samplesJson: input.samplesJson } : {}),
          ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {})
        })
        .returning();
      await evictActiveOverCap(db, input.workspaceId, now);
      return inserted[0]!;
    },

    async listActive(workspaceId) {
      return db
        .select()
        .from(teamSkills)
        .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.status, "active")))
        .orderBy(teamSkills.skillKey);
    },

    async listForWorkspace(workspaceId) {
      return db
        .select()
        .from(teamSkills)
        .where(eq(teamSkills.workspaceId, workspaceId))
        .orderBy(teamSkills.skillKey, desc(teamSkills.version));
    },

    getLatestVersion: latestVersion,

    async listActiveSkillKeys(workspaceId) {
      const rows = await db
        .select({ skillKey: teamSkills.skillKey })
        .from(teamSkills)
        .where(and(eq(teamSkills.workspaceId, workspaceId), eq(teamSkills.status, "active")));
      return rows.map((row) => row.skillKey);
    },

    async deprecate(workspaceId, id, reason, at) {
      const now = at ?? new Date();
      const updated = await db
        .update(teamSkills)
        .set({ status: "deprecated", deprecatedReason: reason, deprecatedAt: now, updatedAt: now })
        .where(and(eq(teamSkills.id, id), eq(teamSkills.workspaceId, workspaceId), ne(teamSkills.status, "deprecated")))
        .returning({ id: teamSkills.id });
      return updated.length > 0;
    },

    async rollbackTo(workspaceId, skillKey, version, at) {
      const now = at ?? new Date();
      // 目标版本设 active，同 key 其余版本弃用（人类回滚 / kill-switch 配套）。
      const target = await db
        .update(teamSkills)
        .set({ status: "active", deprecatedReason: null, deprecatedAt: null, updatedAt: now })
        .where(
          and(
            eq(teamSkills.workspaceId, workspaceId),
            eq(teamSkills.skillKey, skillKey),
            eq(teamSkills.version, version)
          )
        )
        .returning({ id: teamSkills.id });
      if (target.length === 0) {
        return false;
      }
      await db
        .update(teamSkills)
        .set({ status: "deprecated", deprecatedReason: `rolled back to v${version}`, deprecatedAt: now, updatedAt: now })
        .where(
          and(
            eq(teamSkills.workspaceId, workspaceId),
            eq(teamSkills.skillKey, skillKey),
            ne(teamSkills.version, version)
          )
        );
      return true;
    },

    async listActiveWorkspaceIds() {
      const rows = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(isNull(workspaces.deletedAt));
      return rows.map((row) => row.id);
    },

    async acceptedDeliverableSignals(workspaceId, since) {
      const rows = await db
        .select({
          targetKind: acceptedDeliverableChanges.targetKind,
          count: sql<number>`count(*)::int`
        })
        .from(acceptedDeliverableChanges)
        .innerJoin(workItems, eq(acceptedDeliverableChanges.workItemId, workItems.id))
        .where(
          and(
            eq(workItems.workspaceId, workspaceId),
            gte(acceptedDeliverableChanges.createdAt, since),
            isNull(acceptedDeliverableChanges.supersededAt)
          )
        )
        .groupBy(acceptedDeliverableChanges.targetKind)
        .orderBy(desc(sql`count(*)`));
      return rows.map((row) => ({ targetKind: row.targetKind, count: Number(row.count) }));
    },

    async escalationSignals(workspaceId, since) {
      const rows = await db
        .select({
          reasonMd: escalationEvents.reasonMd,
          trigger: escalationEvents.trigger,
          count: sql<number>`count(*)::int`
        })
        .from(escalationEvents)
        .innerJoin(workItems, eq(escalationEvents.workItemId, workItems.id))
        .where(and(eq(workItems.workspaceId, workspaceId), gte(escalationEvents.createdAt, since)))
        .groupBy(escalationEvents.reasonMd, escalationEvents.trigger)
        .orderBy(desc(sql`count(*)`))
        .limit(20);
      return rows.map((row) => ({ reasonMd: row.reasonMd, trigger: row.trigger, count: Number(row.count) }));
    }
  };
}
