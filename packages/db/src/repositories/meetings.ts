import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import { allocateProjectCode } from "../sequences.js";
import {
  auditLogs,
  chatMessages,
  meetingInsights,
  meetingRecords,
  projects,
  proposals,
  users,
  workItems
} from "../schema/index.js";

export type MeetingProjectRow = typeof projects.$inferSelect;
export type MeetingRecordRow = typeof meetingRecords.$inferSelect;
export type MeetingInsightRow = typeof meetingInsights.$inferSelect;
export type MeetingUploadedByRow = typeof users.$inferSelect;
export type MeetingWorkItemRow = typeof workItems.$inferSelect;
export type MeetingProposalRow = typeof proposals.$inferSelect;

export type MeetingRecordWithUserRow = {
  meeting: MeetingRecordRow;
  uploadedBy: MeetingUploadedByRow;
};

export type MeetingPageRows = {
  project: MeetingProjectRow | null;
  meetings: MeetingRecordWithUserRow[];
  insights: MeetingInsightRow[];
  insightProposals: MeetingProposalRow[];
  // DF-3：项目内 insight 按状态的真实总数 + 会议真实总数,均 count(*) 不受 limit*5 / limit 载入上限影响。
  // summary 的 pending/confirmed/dismissed_insight_count 与 meeting_count 用它们,否则超过上限就静默少计。
  insightStatusCounts?: { status: string; count: number }[];
  meetingCount?: number;
};

export type MeetingInsightDraftRows = {
  insight: MeetingInsightRow;
  meeting: MeetingRecordRow;
  workItem: MeetingWorkItemRow | null;
  created: boolean;
};

export type MeetingInsightContextRows = {
  project: MeetingProjectRow | null;
  meeting: MeetingRecordRow | null;
  insight: MeetingInsightRow | null;
};

export type MeetingRepositoryActor = {
  actorKind: "human" | "ai" | "system" | string;
  actorUserId: string;
};

export class MeetingRepositoryConflictError extends Error {
  constructor(
    public readonly code:
      | "meeting_insight_not_pending"
      | "meeting_insight_draft_missing"
      | "meeting_insight_rationale_missing",
    message: string
  ) {
    super(message);
  }
}

export type MeetingRepository = {
  readPage: (input?: {
    projectId?: string;
    workspaceId?: string;
    limit?: number;
    targetMeetingId?: string;
  }) => Promise<MeetingPageRows>;
  findInsightContext?: (input: {
    projectId: string;
    insightId: string;
  }) => Promise<MeetingInsightContextRows>;
  insightToDraft: (input: MeetingRepositoryActor & {
    projectId: string;
    insightId: string;
    at?: Date;
  }) => Promise<MeetingInsightDraftRows | null>;
  dismissInsight: (input: MeetingRepositoryActor & {
    projectId: string;
    insightId: string;
    at?: Date;
  }) => Promise<MeetingInsightDraftRows | null>;
  recordDraftProposal: (input: MeetingRepositoryActor & {
    workItemId: string;
    proposalId: string;
    at?: Date;
  }) => Promise<MeetingInsightDraftRows | null>;
};

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(limit ?? 100, 300));
}

async function findProject(db: WorkHubDb, projectId?: string, workspaceId?: string) {
  const baseConditions = [eq(projects.archived, false), isNull(projects.deletedAt)];
  // 同 drive（M8）：挑默认项目时限定在 actor 所在 workspace，不能全库取最老的一个。显式 projectId 仍按 id 查。
  const conditions = projectId
    ? [...baseConditions, eq(projects.id, projectId)]
    : workspaceId
      ? [...baseConditions, eq(projects.workspaceId, workspaceId)]
      : baseConditions;
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    // XC-4：与 drive 同口径——裸 /meetings 的默认项目按最近活跃(desc(updatedAt))挑,和 /projects 列表首项一致。
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  return rows[0] ?? null;
}

function draftTitleFromInsight(insight: MeetingInsightRow) {
  const title = insight.title.replace(/\s+/gu, " ").trim();
  if (title) {
    return title.length > 80 ? `${title.slice(0, 77)}...` : title;
  }
  const description = insight.description.replace(/\s+/gu, " ").trim();
  return description.length > 80 ? `${description.slice(0, 77)}...` : description || "Meeting insight draft";
}

function previewText(value: string | null | undefined, max = 260) {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

async function insertMeetingAudit(
  db: WorkHubDb,
  input: MeetingRepositoryActor & {
    project: MeetingProjectRow;
    entityType: string;
    entityId: string;
    action: string;
    detailJson: Record<string, unknown>;
    at: Date;
  }
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    orgId: null,
    workspaceId: input.project.workspaceId,
    actorKind: input.actorKind,
    actorUserId: input.actorUserId,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    detailJson: input.detailJson,
    createdAt: input.at
  });
}

export function createMeetingRepository(db: WorkHubDb): MeetingRepository {
  return {
    async readPage(input = {}) {
      const project = await findProject(db, input.projectId, input.workspaceId);
      if (!project) {
        return {
          project: null,
          meetings: [],
          insights: [],
          insightProposals: []
        };
      }
      const limit = clampLimit(input.limit);
      const initialMeetingRows = await db
        .select({
          meeting: meetingRecords,
          uploadedBy: users
        })
        .from(meetingRecords)
        .innerJoin(users, eq(meetingRecords.uploadedByUserId, users.id))
        .where(eq(meetingRecords.projectId, project.id))
        .orderBy(desc(meetingRecords.createdAt))
        .limit(limit);
      let meetingRows = initialMeetingRows;
      if (input.targetMeetingId && !meetingRows.some((row) => row.meeting.id === input.targetMeetingId)) {
        const [targetMeeting] = await db
          .select({
            meeting: meetingRecords,
            uploadedBy: users
          })
          .from(meetingRecords)
          .innerJoin(users, eq(meetingRecords.uploadedByUserId, users.id))
          .where(and(
            eq(meetingRecords.projectId, project.id),
            eq(meetingRecords.id, input.targetMeetingId)
          ))
          .limit(1);
        if (targetMeeting) {
          meetingRows = [...meetingRows, targetMeeting];
        }
      }
      const meetingIds = meetingRows.map((row) => row.meeting.id);
      const insightRows = meetingIds.length
        ? await db
          .select()
          .from(meetingInsights)
          .where(inArray(meetingInsights.meetingId, meetingIds))
          .orderBy(desc(meetingInsights.createdAt))
          .limit(limit * 5)
        : [];
      const filteredInsights = insightRows;
      const draftWorkItemIds = [...new Set(filteredInsights.map((insight) => insight.createdWorkItemId).filter((id): id is string => Boolean(id)))];
      // DF-3：summary 计数走全量聚合,不受上面 limit*5 / limit 载入上限影响（>500 insight / >100 会议时不再静默少计）。
      const [insightStatusRows, meetingCountRows, insightProposals] = await Promise.all([
        db
          .select({ status: meetingInsights.status, value: sql<number>`count(*)` })
          .from(meetingInsights)
          .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
          .where(eq(meetingRecords.projectId, project.id))
          .groupBy(meetingInsights.status),
        db
          .select({ value: sql<number>`count(*)` })
          .from(meetingRecords)
          .where(eq(meetingRecords.projectId, project.id)),
        draftWorkItemIds.length
          ? db
            .select()
            .from(proposals)
            .where(inArray(proposals.workItemId, draftWorkItemIds))
            .orderBy(desc(proposals.createdAt))
            .limit(100)
          : Promise.resolve([])
      ]);
      return {
        project,
        meetings: meetingRows,
        insights: filteredInsights,
        insightProposals,
        insightStatusCounts: insightStatusRows.map((row) => ({ status: row.status, count: Number(row.value ?? 0) })),
        meetingCount: Number(meetingCountRows[0]?.value ?? 0)
      };
    },

    async findInsightContext(input) {
      const project = await findProject(db, input.projectId);
      if (!project) {
        return { project: null, meeting: null, insight: null };
      }
      const rows = await db
        .select({
          insight: meetingInsights,
          meeting: meetingRecords
        })
        .from(meetingInsights)
        .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
        .where(and(
          eq(meetingInsights.id, input.insightId),
          eq(meetingRecords.projectId, input.projectId)
        ))
        .limit(1);
      const row = rows[0];
      return {
        project,
        meeting: row?.meeting ?? null,
        insight: row?.insight ?? null
      };
    },

    async insightToDraft(input) {
      const at = input.at ?? new Date();
      let result: MeetingInsightDraftRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        const rows = await tx
          .select({
            insight: meetingInsights,
            meeting: meetingRecords
          })
          .from(meetingInsights)
          .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
          .where(and(
            eq(meetingInsights.id, input.insightId),
            eq(meetingRecords.projectId, input.projectId)
          ))
          .for("update")
          .limit(1);
        const source = rows[0];
        if (!source) {
          return;
        }
        if (source.insight.createdWorkItemId) {
          const existingRows = await tx
            .select()
            .from(workItems)
            .where(eq(workItems.id, source.insight.createdWorkItemId))
            .limit(1);
          if (!existingRows[0] || existingRows[0].deletedAt) {
            throw new MeetingRepositoryConflictError("meeting_insight_draft_missing", "这条会议洞察关联的草稿已经不可用，请刷新后联系项目负责人。");
          }
          result = {
            insight: source.insight,
            meeting: source.meeting,
            workItem: existingRows[0],
            created: false
          };
          return;
        }
        if (source.insight.status !== "pending") {
          throw new MeetingRepositoryConflictError("meeting_insight_not_pending", "只有待确认的会议洞察可以生成草稿。");
        }
        if (!previewText(source.insight.confidenceReason)) {
          throw new MeetingRepositoryConflictError("meeting_insight_rationale_missing", "会议洞察缺少判断理由，不能生成草稿。");
        }

        const allocation = await allocateProjectCode(tx, input.projectId);
        const workItemId = randomUUID();
        const title = draftTitleFromInsight(source.insight);
        const summaryMd = [
          source.insight.description,
          "",
          `Meeting: ${source.meeting.title}`,
          `Reason: ${previewText(source.insight.confidenceReason)}`
        ].join("\n");
        const workItemRows = await tx
          .insert(workItems)
          .values({
            id: workItemId,
            code: allocation.code,
            projectId: input.projectId,
            workspaceId: project.workspaceId,
            submitterUserId: input.actorUserId,
            title,
            rawDescription: source.insight.description,
            summaryMd,
            status: "ai_clarifying",
            priority: "normal",
            mode: "worker",
            humanReserved: false,
            sourceMeetingId: source.meeting.id,
            planningNote: `source=meeting_insight meeting_id=${source.meeting.id} insight_id=${source.insight.id}`,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        const workItem = workItemRows[0] as MeetingWorkItemRow | undefined;
        if (!workItem) {
          throw new Error("Failed to create work item draft from meeting insight");
        }
        await tx.insert(chatMessages).values({
          id: randomUUID(),
          workItemId,
          role: "user",
          kind: "intent",
          contentJson: {
            source: "meeting_insight",
            meeting_id: source.meeting.id,
            insight_id: source.insight.id,
            project_id: input.projectId,
            kind: source.insight.kind,
            confidence_reason: source.insight.confidenceReason,
            transcript_excerpt: previewText(source.meeting.transcriptText, 360) ?? null,
            minutes_excerpt: previewText(source.meeting.minutesMd, 360) ?? null
          },
          userOtherText: source.insight.description,
          createdAt: at,
          updatedAt: at
        });
        const updatedInsights = await tx
          .update(meetingInsights)
          .set({
            status: "confirmed",
            createdWorkItemId: workItemId,
            confirmedByUserId: input.actorUserId,
            confirmedAt: at,
            updatedAt: at
          })
          .where(and(
            eq(meetingInsights.id, source.insight.id),
            eq(meetingInsights.status, "pending")
          ))
          .returning();
        const updatedInsight = updatedInsights[0] as MeetingInsightRow | undefined;
        if (!updatedInsight) {
          throw new MeetingRepositoryConflictError("meeting_insight_not_pending", "这条会议洞察已经被处理，请刷新后查看最新状态。");
        }
        const detailJson = {
          meeting_id: source.meeting.id,
          insight_id: source.insight.id,
          work_item_id: workItemId,
          insight_kind: source.insight.kind,
          confidence_reason: previewText(source.insight.confidenceReason)
        };
        await insertMeetingAudit(tx, {
          ...input,
          project,
          entityType: "work_item",
          entityId: workItemId,
          action: "work_item.created_from_meeting_insight",
          detailJson,
          at
        });
        await insertMeetingAudit(tx, {
          ...input,
          project,
          entityType: "meeting_insight",
          entityId: source.insight.id,
          action: "meeting.insight.confirmed",
          detailJson,
          at
        });
        result = {
          insight: updatedInsight,
          meeting: source.meeting,
          workItem,
          created: true
        };
      });
      return result;
    },

    async dismissInsight(input) {
      const at = input.at ?? new Date();
      let result: MeetingInsightDraftRows | null = null;
      await db.transaction(async (tx) => {
        const project = await findProject(tx, input.projectId);
        if (!project) {
          return;
        }
        const rows = await tx
          .select({
            insight: meetingInsights,
            meeting: meetingRecords
          })
          .from(meetingInsights)
          .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
          .where(and(
            eq(meetingInsights.id, input.insightId),
            eq(meetingRecords.projectId, input.projectId)
          ))
          .limit(1);
        const source = rows[0];
        if (!source) {
          return;
        }
        if (source.insight.status === "confirmed" || source.insight.createdWorkItemId) {
          throw new MeetingRepositoryConflictError("meeting_insight_not_pending", "已确认的会议洞察不能再忽略。");
        }
        if (source.insight.status === "dismissed") {
          result = {
            insight: source.insight,
            meeting: source.meeting,
            workItem: null,
            created: false
          };
          return;
        }
        const updatedRows = await tx
          .update(meetingInsights)
          .set({
            status: "dismissed",
            confirmedByUserId: input.actorUserId,
            confirmedAt: at,
            updatedAt: at
          })
          .where(and(
            eq(meetingInsights.id, source.insight.id),
            eq(meetingInsights.status, "pending")
          ))
          .returning();
        const updatedInsight = updatedRows[0] as MeetingInsightRow | undefined;
        if (!updatedInsight) {
          throw new MeetingRepositoryConflictError("meeting_insight_not_pending", "这条会议洞察已经被处理，请刷新后查看最新状态。");
        }
        await insertMeetingAudit(tx, {
          ...input,
          project,
          entityType: "meeting_insight",
          entityId: source.insight.id,
          action: "meeting.insight.dismissed",
          detailJson: {
            meeting_id: source.meeting.id,
            insight_id: source.insight.id,
            insight_kind: source.insight.kind
          },
          at
        });
        result = {
          insight: updatedInsight,
          meeting: source.meeting,
          workItem: null,
          created: true
        };
      });
      return result;
    },

    async recordDraftProposal(input) {
      const at = input.at ?? new Date();
      let result: MeetingInsightDraftRows | null = null;
      await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            insight: meetingInsights,
            meeting: meetingRecords
          })
          .from(meetingInsights)
          .innerJoin(meetingRecords, eq(meetingInsights.meetingId, meetingRecords.id))
          .where(eq(meetingInsights.createdWorkItemId, input.workItemId))
          .orderBy(desc(meetingInsights.updatedAt), desc(meetingInsights.createdAt))
          .for("update")
          .limit(1);
        const source = rows[0];
        if (!source) {
          return;
        }
        const project = await findProject(tx, source.meeting.projectId);
        if (!project) {
          return;
        }
        // findings[#22/#24 后继]：跨服务 draft→proposal 写入非原子且非幂等——并发/重试会重复写 audit 行；
        // 部分失败又被 service 早返回掩盖。会议侧无 operation 表（recordDraftProposal 只写 audit），
        // 因此在事务内查是否已存在指向同一 proposalId 的 proposal.created_from_meeting_draft audit 行：
        // 已存在 → 直接返回既有 insight/meeting，绝不重复 insert。首次路径不变；重跑成安全 no-op。
        const existingAudit = await tx
          .select({ id: auditLogs.id })
          .from(auditLogs)
          .where(and(
            eq(auditLogs.entityType, "proposal"),
            eq(auditLogs.entityId, input.proposalId),
            eq(auditLogs.action, "proposal.created_from_meeting_draft")
          ))
          .limit(1);
        if (existingAudit[0]) {
          result = {
            insight: source.insight,
            meeting: source.meeting,
            workItem: null,
            created: false
          };
          return;
        }
        const detailJson = {
          meeting_id: source.meeting.id,
          insight_id: source.insight.id,
          work_item_id: input.workItemId,
          proposal_id: input.proposalId,
          proposal_href: `/proposals/${input.proposalId}`
        };
        await insertMeetingAudit(tx, {
          ...input,
          project,
          entityType: "proposal",
          entityId: input.proposalId,
          action: "proposal.created_from_meeting_draft",
          detailJson,
          at
        });
        await insertMeetingAudit(tx, {
          ...input,
          project,
          entityType: "meeting_insight",
          entityId: source.insight.id,
          action: "meeting.insight.proposal_created",
          detailJson,
          at
        });
        result = {
          insight: source.insight,
          meeting: source.meeting,
          workItem: null,
          created: true
        };
      });
      return result;
    }
  };
}
