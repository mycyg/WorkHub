import { createHash } from "node:crypto";

import {
  getSharedDatabaseClient,
  createMeetingRepository,
  createWorkItemRepository,
  MeetingRepositoryConflictError,
  type MeetingInsightRow,
  type MeetingPageRows,
  type MeetingRecordRow,
  type MeetingRecordWithUserRow,
  type MeetingRepository,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  meetingPageVmSchema,
  type MeetingInsightVM,
  type MeetingPageVM,
  type WorkItemDetailVM,
  type WorkHubLocale
} from "@workhub/contracts";
import { canManageProjectMeeting, canViewProjectMeetings, canViewWorkItemRecord } from "@workhub/permissions";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import {
  getDefaultProposalService,
  ProposalServiceError,
  type ProposalActor,
  type ProposalService
} from "./proposals.js";
import {
  getDefaultWorkItemService,
  type WorkItemService
} from "./work-items.js";

export type MeetingPageService = {
  page: (input: {
    actor: AuthActor;
    locale?: WorkHubLocale;
    projectId?: string;
    meetingId?: string;
  }) => Promise<MeetingPageVM>;
  insightToDraft: (input: MeetingMutationInput & {
    insightId: string;
  }) => Promise<MeetingPageVM>;
  dismissInsight: (input: MeetingMutationInput & {
    insightId: string;
  }) => Promise<MeetingPageVM>;
  draftToProposal: (input: {
    actor: AuthActor;
    locale?: WorkHubLocale;
    workItemId: string;
  }) => Promise<WorkItemDetailVM>;
};

export type MeetingPageServiceDependencies = {
  repo: MeetingRepository;
  proposals?: Pick<ProposalService, "createFromManifest" | "get">;
  workItems?: Pick<WorkItemService, "detailPage" | "assertCanMutateArtifacts">;
  workItemAccess?: Pick<WorkItemDataRepository, "findWorkItemAccessRecord">;
  now?: () => Date;
};

export type MeetingMutationInput = {
  actor: AuthActor;
  projectId: string;
  // R4 #19：mutation 也带请求 locale——否则 pageAfterMutation 取不到、重建页面恒回退 zh-CN（处理会议洞察后页面变中文）。
  locale?: WorkHubLocale;
};

export class MeetingPageServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 409,
    message: string,
    public readonly code = "meeting_error"
  ) {
    super(message);
  }
}

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32)
  ].join("-");
}

function compactText(value: string | null | undefined, max = 260) {
  const text = value?.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function meetingStatus(status: string): "processing" | "ready" | "failed" {
  return status === "ready" || status === "failed" ? status : "processing";
}

function insightKind(kind: string): "new_requirement" | "requirement_change" | "normal_note" {
  return kind === "requirement_change" || kind === "normal_note" ? kind : "new_requirement";
}

function insightStatus(status: string): "pending" | "confirmed" | "dismissed" {
  if (status === "confirmed" || status === "dismissed") {
    return status;
  }
  return "pending";
}

function actorUserId(actor: AuthActor) {
  return actor.userId ?? actor.id;
}

function ensureHumanActor(actor: AuthActor) {
  const userId = actor.userId;
  if (!userId) {
    throw new MeetingPageServiceError(403, "只有具名用户可以处理会议洞察。", "meeting_forbidden");
  }
  return userId;
}

function proposalActorFromAuth(actor: AuthActor): ProposalActor {
  if (actor.kind === "human") {
    return {
      actor_kind: "human",
      actor_user_id: actor.userId ?? actor.id,
      label: actor.label
    };
  }
  return {
    actor_kind: actor.kind,
    label: actor.label
  };
}

function fallbackReason(locale: WorkHubLocale) {
  return locale === "zh-CN" ? "会议洞察需要人工确认后再进入主线。" : "Meeting insight needs human confirmation before entering the main workflow.";
}

function buildInsightVm(input: {
  insight: MeetingInsightRow;
  meeting: MeetingRecordRow;
  latestProposal?: MeetingPageRows["insightProposals"][number];
  canManage: boolean;
  locale: WorkHubLocale;
  linkableWorkItemIds?: ReadonlySet<string> | undefined;
}): MeetingInsightVM {
  const reason = compactText(input.insight.confidenceReason, 420) ?? fallbackReason(input.locale);
  const status = insightStatus(input.insight.status);
  // findings[#44]：原 `?? input.insight.description` 回退是未截断的原始描述，会越过 excerpt 的 max(300) 契约、
  // 把整张 meetings 页 422。回退也走 compactText 截断到 260（描述也空时给空串，excerpt 可选且无下限）。
  const evidenceExcerpt = compactText(input.meeting.minutesMd ?? input.meeting.transcriptText, 260)
    ?? compactText(input.insight.description, 260)
    ?? "";
  const canCreateDraft = input.canManage && status === "pending" && Boolean(compactText(input.insight.confidenceReason));
  const canLinkTarget = !input.insight.targetWorkItemId
    || !input.linkableWorkItemIds
    || input.linkableWorkItemIds.has(input.insight.targetWorkItemId);
  const canLinkDraft = !input.insight.createdWorkItemId
    || !input.linkableWorkItemIds
    || input.linkableWorkItemIds.has(input.insight.createdWorkItemId);
  return {
    id: input.insight.id,
    meeting_id: input.insight.meetingId,
    kind: insightKind(input.insight.kind),
    title: input.insight.title,
    description: input.insight.description,
    confidence_reason: reason,
    status,
    ...(input.insight.targetWorkItemId && canLinkTarget ? { target_work_item_id: input.insight.targetWorkItemId } : {}),
    ...(input.insight.createdWorkItemId ? {
      created_work_item_id: input.insight.createdWorkItemId,
      ...(canLinkDraft ? { draft_href: `/workitems/${input.insight.createdWorkItemId}` } : {})
    } : {}),
    ...(input.latestProposal && canLinkDraft ? {
      proposal_id: input.latestProposal.id,
      proposal_href: `/proposals/${input.latestProposal.id}`,
      proposal_status: input.latestProposal.status
    } : {}),
    // findings[#low-F39]：仅 confirmed 态才暴露 confirmed_by/at——dismissed 等态即便列里残留确认信息也不回传，避免误导。
    ...(status === "confirmed" && input.insight.confirmedByUserId ? { confirmed_by_user_id: input.insight.confirmedByUserId } : {}),
    ...(status === "confirmed" && input.insight.confirmedAt ? { confirmed_at: input.insight.confirmedAt.toISOString() } : {}),
    created_at: input.insight.createdAt.toISOString(),
    evidence_refs: [{
      id: stableUuid(`meeting-insight-evidence:${input.insight.id}`),
      source_type: "meeting",
      source_id: input.meeting.id,
      title: input.meeting.title,
      excerpt: evidenceExcerpt,
      locator: {
        path: `/meetings/${input.meeting.id}`
      },
      confidence_hint: "found",
      href: `/meetings?project_id=${input.meeting.projectId}`
    }],
    actions: {
      ...(canCreateDraft ? {
        create_draft: {
          id: "meeting_insight_to_draft",
          label: input.locale === "zh-CN" ? "生成草稿" : "Create draft",
          method: "POST",
          href: `/api/meetings/projects/${input.meeting.projectId}/insights/${input.insight.id}/draft`
        }
      } : {}),
      ...(input.canManage && status === "pending" ? {
        dismiss: {
          id: "meeting_insight_dismiss",
          label: input.locale === "zh-CN" ? "忽略" : "Dismiss",
          method: "POST",
          href: `/api/meetings/projects/${input.meeting.projectId}/insights/${input.insight.id}/dismiss`
        }
      } : {})
    }
  };
}

function buildMeetingPage(
  rows: MeetingPageRows,
  actor: AuthActor,
  locale: WorkHubLocale,
  now: Date,
  selectedMeetingId?: string,
  linkableWorkItemIds?: ReadonlySet<string>
): MeetingPageVM {
  const canView = rows.project ? canViewProjectMeetings(rows.project, actor) : false;
  if (!rows.project || !canView) {
    return parseOutputContract(meetingPageVmSchema, {
      generated_at: now.toISOString(),
      summary: {
        meeting_count: 0,
        ready_count: 0,
        pending_insight_count: 0,
        confirmed_insight_count: 0,
        dismissed_insight_count: 0
      },
      can_manage: false,
      meetings: [],
      empty_state: "no_project"
    }, "meeting.page");
  }

  const insightsByMeetingId = new Map<string, MeetingInsightRow[]>();
  for (const insight of rows.insights) {
    const list = insightsByMeetingId.get(insight.meetingId) ?? [];
    list.push(insight);
    insightsByMeetingId.set(insight.meetingId, list);
  }
  const latestProposalByWorkItemId = new Map<string, MeetingPageRows["insightProposals"][number]>();
  for (const proposal of rows.insightProposals) {
    const current = latestProposalByWorkItemId.get(proposal.workItemId);
    if (!current || proposal.createdAt > current.createdAt) {
      latestProposalByWorkItemId.set(proposal.workItemId, proposal);
    }
  }
  const meetings = rows.meetings.map(({ meeting, uploadedBy }: MeetingRecordWithUserRow) => {
    const canManage = canManageProjectMeeting(rows.project!, meeting, actor);
    const canLinkMeetingWorkItem = !meeting.workItemId
      || !linkableWorkItemIds
      || linkableWorkItemIds.has(meeting.workItemId);
    const insights = (insightsByMeetingId.get(meeting.id) ?? []).map((insight) => {
      const latestProposal = insight.createdWorkItemId
        ? latestProposalByWorkItemId.get(insight.createdWorkItemId)
        : undefined;
      return buildInsightVm({
        insight,
        meeting,
        canManage,
        locale,
        linkableWorkItemIds,
        ...(latestProposal ? { latestProposal } : {})
      });
    });
    return {
      id: meeting.id,
      project_id: meeting.projectId,
      ...(meeting.workItemId && canLinkMeetingWorkItem ? { work_item_id: meeting.workItemId } : {}),
      uploaded_by_user_id: meeting.uploadedByUserId,
      uploaded_by_label: uploadedBy.nickname,
      title: meeting.title,
      audio_filename: meeting.audioFilename,
      ...(meeting.audioMime ? { audio_mime: meeting.audioMime } : {}),
      audio_size_bytes: meeting.audioSizeBytes,
      ...(meeting.transcriptText ? { transcript_text: meeting.transcriptText } : {}),
      ...(meeting.minutesMd ? { minutes_md: meeting.minutesMd } : {}),
      status: meetingStatus(meeting.status),
      ...(meeting.jobId ? { job_id: meeting.jobId } : {}),
      created_at: meeting.createdAt.toISOString(),
      updated_at: meeting.updatedAt.toISOString(),
      insights
    };
  });
  const flatInsights = meetings.flatMap((meeting) => meeting.insights);
  // DF-3：summary 计数优先用仓库全量聚合(不受 insight 500 / 会议 100 载入上限影响);缺失(旧调用/假仓库)
  // 才回退到从已载入子集过滤——否则超过上限就静默少计,像 insight/会议"丢了"。
  const insightStatusCount = (status: string) =>
    rows.insightStatusCounts
      ? (rows.insightStatusCounts.find((row) => row.status === status)?.count ?? 0)
      : flatInsights.filter((insight) => insight.status === status).length;
  return parseOutputContract(meetingPageVmSchema, {
    generated_at: now.toISOString(),
    project: {
      id: rows.project.id,
      name: rows.project.name,
      slug: rows.project.slug,
      owner_label: rows.project.ownerNickname,
      status: "active"
    },
    summary: {
      meeting_count: Math.max(meetings.length, rows.meetingCount ?? 0),
      // ready_count 仍按已载入会议算(状态明细未做全量聚合);>100 会议的极端项目里它反映已载入的 100 条。
      ready_count: meetings.filter((meeting) => meeting.status === "ready").length,
      pending_insight_count: insightStatusCount("pending"),
      confirmed_insight_count: insightStatusCount("confirmed"),
      dismissed_insight_count: insightStatusCount("dismissed")
    },
    // findings[#low-F40]：can_manage 是项目级权限(admin/owner)，不该因「项目暂无会议」让 meetings.some()→false。
    // 直接问项目级 canManageProjectMeeting(空 uploadedByUserId)——admin/owner 判定不看该字段；非 owner 非 admin 仍 false。
    can_manage: canManageProjectMeeting(rows.project!, { uploadedByUserId: "" }, actor),
    selected_meeting_id: meetings.find((meeting) => meeting.id === selectedMeetingId)?.id ?? meetings[0]?.id,
    meetings,
    ...(meetings.length === 0 ? { empty_state: "no_meetings" } : {})
  }, "meeting.page");
}

export function createMeetingPageService(deps: MeetingPageServiceDependencies): MeetingPageService {
  const proposalService = () => deps.proposals ?? getDefaultProposalService();
  const workItemService = () => deps.workItems ?? getDefaultWorkItemService();
  const workItemAccess = () => deps.workItemAccess;

  async function linkableWorkItemsForActor(input: { actor: AuthActor; workItemIds: Iterable<string> }) {
    const access = workItemAccess();
    if (!access) {
      return undefined;
    }
    const uniqueIds = [...new Set([...input.workItemIds].filter(Boolean))];
    const visible = new Set<string>();
    const actorUserId = input.actor.userId ?? input.actor.id;
    for (const workItemId of uniqueIds) {
      const record = await access.findWorkItemAccessRecord(workItemId);
      if (record && canViewWorkItemRecord(record, { id: actorUserId, isAdmin: input.actor.isAdmin }, { workspaceId: input.actor.workspaceId })) {
        visible.add(workItemId);
      }
    }
    return visible;
  }

  function linkableWorkItemIdsFromRows(rows: MeetingPageRows) {
    return [
      ...rows.meetings.map((row) => row.meeting.workItemId).filter((id): id is string => Boolean(id)),
      ...rows.insights.map((insight) => insight.targetWorkItemId).filter((id): id is string => Boolean(id)),
      ...rows.insights.map((insight) => insight.createdWorkItemId).filter((id): id is string => Boolean(id))
    ];
  }

  async function pageForActor(input: { actor: AuthActor; projectId?: string; meetingId?: string }) {
    const rows = await deps.repo.readPage({
      ...(input.projectId ? { projectId: input.projectId } : {}),
      // 无显式 projectId 时默认项目限定在 actor 所在 workspace（M8）。
      ...(input.actor.workspaceId ? { workspaceId: input.actor.workspaceId } : {}),
      ...(input.meetingId ? { targetMeetingId: input.meetingId } : {})
    });
    if (!rows.project && input.projectId) {
      throw new MeetingPageServiceError(404, "没有找到这个项目会议。", "meeting_not_found");
    }
    if (rows.project && !canViewProjectMeetings(rows.project, input.actor)) {
      if (!input.projectId) {
        return { project: null, meetings: [], insights: [], insightProposals: [] };
      }
      throw new MeetingPageServiceError(403, "你没有权限查看这个项目会议。", "meeting_forbidden");
    }
    if (rows.project && input.meetingId && !rows.meetings.some((row) => row.meeting.id === input.meetingId)) {
      throw new MeetingPageServiceError(404, "没有找到这场会议。", "meeting_not_found");
    }
    return rows;
  }

  async function ensureCanManageInsight(input: MeetingMutationInput & { insightId: string }) {
    const rows = await pageForActor(input);
    if (!rows.project) {
      throw new MeetingPageServiceError(404, "没有找到这个项目会议。", "meeting_not_found");
    }
    const insight = rows.insights.find((candidate) => candidate.id === input.insightId);
    const meeting = insight ? rows.meetings.find((candidate) => candidate.meeting.id === insight.meetingId)?.meeting : undefined;
    if (insight && meeting) {
      if (!canManageProjectMeeting(rows.project, meeting, input.actor)) {
        throw new MeetingPageServiceError(403, "你没有权限处理这条会议洞察。", "meeting_forbidden");
      }
      return { rows, project: rows.project, insight, meeting };
    }

    const context = await deps.repo.findInsightContext?.({
      projectId: input.projectId,
      insightId: input.insightId
    });
    if (context?.project) {
      if (!canViewProjectMeetings(context.project, input.actor)) {
        throw new MeetingPageServiceError(403, "你没有权限查看这个项目会议。", "meeting_forbidden");
      }
      if (!context.insight || !context.meeting) {
        throw new MeetingPageServiceError(404, "没有找到这条会议洞察。", "meeting_insight_not_found");
      }
      if (!canManageProjectMeeting(context.project, context.meeting, input.actor)) {
        throw new MeetingPageServiceError(403, "你没有权限处理这条会议洞察。", "meeting_forbidden");
      }
      return { rows, project: context.project, insight: context.insight, meeting: context.meeting };
    }

    throw new MeetingPageServiceError(404, "没有找到这条会议洞察。", "meeting_insight_not_found");
  }

  async function ensureCanReadInsight(input: MeetingMutationInput & { insightId: string }) {
    const rows = await pageForActor(input);
    if (!rows.project) {
      throw new MeetingPageServiceError(404, "没有找到这个项目会议。", "meeting_not_found");
    }
    const insight = rows.insights.find((candidate) => candidate.id === input.insightId);
    const meeting = insight ? rows.meetings.find((candidate) => candidate.meeting.id === insight.meetingId)?.meeting : undefined;
    if (insight && meeting) {
      return { rows, project: rows.project, insight, meeting };
    }

    const context = await deps.repo.findInsightContext?.({
      projectId: input.projectId,
      insightId: input.insightId
    });
    if (context?.project) {
      if (!canViewProjectMeetings(context.project, input.actor)) {
        throw new MeetingPageServiceError(403, "你没有权限查看这个项目会议。", "meeting_forbidden");
      }
      if (!context.insight || !context.meeting) {
        throw new MeetingPageServiceError(404, "没有找到这条会议洞察。", "meeting_insight_not_found");
      }
      return { rows, project: context.project, insight: context.insight, meeting: context.meeting };
    }

    throw new MeetingPageServiceError(404, "没有找到这条会议洞察。", "meeting_insight_not_found");
  }

  async function pageAfterMutation(input: MeetingMutationInput & { locale?: WorkHubLocale }) {
    const rows = await pageForActor(input);
    const linkableWorkItemIds = await linkableWorkItemsForActor({
      actor: input.actor,
      workItemIds: linkableWorkItemIdsFromRows(rows)
    });
    return buildMeetingPage(rows, input.actor, input.locale ?? "zh-CN", deps.now?.() ?? new Date(), undefined, linkableWorkItemIds);
  }

  function mutationError(error: unknown): never {
    if (error instanceof MeetingRepositoryConflictError) {
      throw new MeetingPageServiceError(409, error.message, error.code);
    }
    throw error;
  }

  function meetingDraftProposalManifest(input: {
    page: WorkItemDetailVM;
    actor: AuthActor;
    createdAt: Date;
  }) {
    const source = input.page.source_context;
    if (!source || source.source_type !== "meeting_insight") {
      throw new MeetingPageServiceError(409, "这个事项不是从会议洞察生成的草稿。", "meeting_draft_source_missing");
    }
    const workItem = input.page.workitem;
    const proposalId = stableUuid(`meeting-draft-proposal:${workItem.id}:${source.insight_id}`);
    const branchId = stableUuid(`meeting-draft-branch:${workItem.id}:${source.insight_id}`);
    const changeId = stableUuid(`meeting-draft-change:${workItem.id}:${source.insight_id}`);
    const evidenceId = stableUuid(`meeting-draft-evidence:${source.insight_id}`);
    const sourcePreview = compactText(source.description, 240) ?? source.title;
    const actorUser = input.actor.kind === "human" ? actorUserId(input.actor) : undefined;
    return {
      version: 0 as const,
      proposal_id: proposalId,
      work_item_id: workItem.id,
      branch_id: branchId,
      title: `Meeting draft: ${compactText(workItem.title ?? source.title, 80) ?? "Meeting insight proposal"}`,
      summary_md: [
        "Create a reviewable proposal from the confirmed meeting insight.",
        "",
        `Meeting: ${source.meeting_title}`,
        `Insight: ${sourcePreview}`,
        `Reason: ${source.confidence_reason}`
      ].join("\n"),
      author: {
        actor_kind: input.actor.kind,
        ...(actorUser ? { actor_user_id: actorUser } : {}),
        label: input.actor.label ?? "WorkHub"
      },
      base: {
        created_at: input.createdAt.toISOString()
      },
      changes: [
        {
          id: changeId,
          target_kind: "text_doc" as const,
          target_ref: {
            entity_type: "work_item" as const,
            entity_id: workItem.id,
            path: `/workitems/${workItem.code}/meeting-insight.md`
          },
          change_type: "generated" as const,
          human_summary: "Generate a proposal draft from the meeting insight.",
          machine_summary: {
            before_excerpt: "",
            after_excerpt: sourcePreview,
            changed_fields: ["meeting_insight.description", "meeting_insight.confidence_reason"]
          },
          preview_ref: {
            kind: "text" as const,
            href: `/workitems/${workItem.id}`
          },
          evidence_refs: [
            {
              id: evidenceId,
              source_type: "meeting" as const,
              source_id: source.meeting_id,
              title: source.meeting_title,
              excerpt: sourcePreview,
              locator: {
                path: `/meetings/${source.meeting_id}`
              },
              confidence_hint: "found" as const,
              href: `/meetings?project_id=${source.project_id}`
            }
          ]
        }
      ],
      checks: [
        {
          id: "meeting_insight_source",
          label: "Meeting insight source is attached",
          status: "passed" as const,
          detail: source.insight_id
        },
        {
          id: "confidence_reason_present",
          label: "Meeting insight confidence reason is present",
          status: "passed" as const,
          detail: source.confidence_reason
        },
        {
          id: "human_review_required",
          label: "Proposal requires human review before merge",
          status: "passed" as const
        }
      ],
      evidence_refs: [
        {
          id: evidenceId,
          source_type: "meeting" as const,
          source_id: source.meeting_id,
          title: source.meeting_title,
          excerpt: sourcePreview,
          locator: {
            path: `/meetings/${source.meeting_id}`
          },
          confidence_hint: "found" as const,
          href: `/meetings?project_id=${source.project_id}`
        }
      ],
      risk: {
        level: "low" as const,
        human_label: "Preview-only proposal; no official project state is overwritten.",
        reversible: true
      },
      rollback: {
        available: true,
        description: "Discard this proposal to keep the meeting-derived draft unchanged."
      },
      review: {
        suggested_decision: "needs_human" as const,
        reason_required_on_reject: true as const
      }
    };
  }

  return {
    async page(input) {
      const rows = await pageForActor(input);
      const linkableWorkItemIds = await linkableWorkItemsForActor({
        actor: input.actor,
        workItemIds: linkableWorkItemIdsFromRows(rows)
      });
      return buildMeetingPage(rows, input.actor, input.locale ?? "zh-CN", deps.now?.() ?? new Date(), input.meetingId, linkableWorkItemIds);
    },
    async insightToDraft(input) {
      const actorUserId = ensureHumanActor(input.actor);
      await ensureCanManageInsight(input);
      try {
        const created = await deps.repo.insightToDraft({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          insightId: input.insightId,
          at: deps.now?.() ?? new Date()
        });
        if (!created) {
          throw new MeetingPageServiceError(404, "没有找到这条会议洞察。", "meeting_insight_not_found");
        }
        return pageAfterMutation(input);
      } catch (error) {
        mutationError(error);
      }
    },
    async dismissInsight(input) {
      const actorUserId = ensureHumanActor(input.actor);
      await ensureCanManageInsight(input);
      try {
        const dismissed = await deps.repo.dismissInsight({
          actorKind: input.actor.kind,
          actorUserId,
          projectId: input.projectId,
          insightId: input.insightId,
          at: deps.now?.() ?? new Date()
        });
        if (!dismissed) {
          throw new MeetingPageServiceError(404, "没有找到这条会议洞察。", "meeting_insight_not_found");
        }
        return pageAfterMutation(input);
      } catch (error) {
        mutationError(error);
      }
    },
    async draftToProposal(input) {
      const actorUserId = ensureHumanActor(input.actor);
      const detailInput = {
        workItemId: input.workItemId,
        actor: input.actor,
        ...(input.locale ? { locale: input.locale } : {})
      };
      const workItems = workItemService();
      const initialPage = await workItems.detailPage(detailInput);
      await workItems.assertCanMutateArtifacts({
        workItemId: input.workItemId,
        actor: input.actor
      });
      const source = initialPage.source_context;
      if (!source || source.source_type !== "meeting_insight") {
        throw new MeetingPageServiceError(409, "这个事项不是从会议洞察生成的草稿。", "meeting_draft_source_missing");
      }
      await ensureCanReadInsight({
        actor: input.actor,
        projectId: source.project_id,
        insightId: source.insight_id
      });
      if (source.status === "dismissed") {
        throw new MeetingPageServiceError(409, "这条会议洞察已经被忽略，不能生成变更提议。", "meeting_insight_dismissed");
      }
      const existingProposalId = initialPage.latest_proposal?.proposal_id ?? source.proposal_id;
      if (existingProposalId) {
        // findings[#22/#24 后继]：提议已存在，但 draft→proposal 的跨服务 audit 写入可能在上次部分失败
        //（会议侧无 operation 表、insight 无独立 proposal_created 态，故 source 不携带「audit 已写」信号）。
        // self-heal：调用（已幂等的）recordDraftProposal 把残留 audit 补完——已写则安全 no-op，再返回。
        await deps.repo.recordDraftProposal({
          actorKind: input.actor.kind,
          actorUserId,
          workItemId: input.workItemId,
          proposalId: existingProposalId,
          at: deps.now?.() ?? new Date()
        });
        return initialPage;
      }

      const createdAt = deps.now?.() ?? new Date();
      const manifest = meetingDraftProposalManifest({
        page: initialPage,
        actor: input.actor,
        createdAt
      });
      const actor = proposalActorFromAuth(input.actor);
      try {
        const created = await proposalService().createFromManifest({
          workItemId: input.workItemId,
          manifest,
          actor,
          title: manifest.title,
          branchId: manifest.branch_id
        });
        await deps.repo.recordDraftProposal({
          actorKind: input.actor.kind,
          actorUserId,
          workItemId: input.workItemId,
          proposalId: created.id,
          at: createdAt
        });
      } catch (error) {
        if (error instanceof ProposalServiceError && error.code === "proposal_already_exists") {
          await deps.repo.recordDraftProposal({
            actorKind: input.actor.kind,
            actorUserId,
            workItemId: input.workItemId,
            proposalId: manifest.proposal_id,
            at: createdAt
          });
        } else if (error instanceof ProposalServiceError) {
          const status = error.status === 403 || error.status === 404 || error.status === 409 ? error.status : 409;
          throw new MeetingPageServiceError(status, error.message, error.code);
        } else {
          throw error;
        }
      }
      return workItems.detailPage({
        workItemId: input.workItemId,
        actor: input.actor,
        ...(input.locale ? { locale: input.locale } : {})
      });
    }
  };
}

let defaultMeetingPageService: MeetingPageService | undefined;
let defaultMeetingPageDbClient: WorkHubDatabaseClient | undefined;

export function getDefaultMeetingPageService() {
  if (!defaultMeetingPageService) {
    defaultMeetingPageDbClient = getSharedDatabaseClient();
    defaultMeetingPageService = createMeetingPageService({
      repo: createMeetingRepository(defaultMeetingPageDbClient.db),
      workItemAccess: createWorkItemRepository(defaultMeetingPageDbClient.db)
    });
  }
  return defaultMeetingPageService;
}
