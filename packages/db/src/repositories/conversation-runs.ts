import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  actionCardItems,
  agentRuns,
  agentSteps,
  branches,
  projects,
  proposals,
  workItemAssignments,
  workItems,
  workspaceMemberships
} from "../schema/index.js";
import { createConversationRepository } from "./conversations.js";

// R12 批 5(军团面板读侧切片):这个仓库只读——它消费批 0 预留、批 3(并行分支)接线的
// agent_runs.source_conversation_id / source_action_card_item_id 两列，不写它们，也不碰派发路径。

export type ConversationRunRecentStep = {
  phase: string;
  toolName: string | null;
  outputExcerpt: string | null;
  stepNo: number;
};

export type ConversationRunCardRow = {
  id: string;
  status: string;
  goalSummary: string;
  assigneeUserId: string | null;
  costEstimateCny: string | null;
  executionHint: string;
  workItemId: string;
  sourceConversationId: string | null;
  sourceActionCardItemId: string | null;
  recentStep: ConversationRunRecentStep | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ArmyOverviewRunCardRow = ConversationRunCardRow & {
  projectId: string;
  projectName: string;
};

export type RunListCursor = {
  createdAt: string;
  id: string;
};

export type ListRunsForConversationInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
  limit?: number;
  cursor?: RunListCursor;
};

export type ListArmyOverviewForUserInput = {
  workspaceId: string;
  viewerUserId: string;
  limit?: number;
  cursor?: RunListCursor;
};

export type ConversationRunListResult = {
  rows: ConversationRunCardRow[];
  capped: boolean;
  nextCursor: RunListCursor | null;
  // 会话所属项目 id，取自本函数内部已经跑过的那次 access 判定（access.conversation.projectId），
  // 不为此额外发一次查询——服务层拼「情境面板 VM」的 project_id 字段要用，让它免于重新查一遍会话归属。
  projectId: string;
};

export type ArmyOverviewListResult = {
  rows: ArmyOverviewRunCardRow[];
  capped: boolean;
  nextCursor: RunListCursor | null;
};

export type ConversationRunOutputLink = {
  proposalId: string;
  workItemId: string;
  runId: string;
  title: string;
  status: string;
  updatedAt: Date;
};

export type ListOutputLinksForConversationInput = {
  workspaceId: string;
  conversationId: string;
  limit?: number;
};

export type ConversationRunOutputLinkResult = {
  rows: ConversationRunOutputLink[];
  capped: boolean;
};

export class ConversationRunRepositoryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationRunRepositoryInputError";
  }
}

const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 50;
const RECENT_STEP_EXCERPT_MAX_LENGTH = 240;
const GOAL_SUMMARY_MAX_LENGTH = 200;

// 与 packages/contracts/src/domain/conversation.ts 的 canonicalConversationCursorTimestampSchema 同一形状——
// 那个 const 未导出，这里按同一约定（UTC、六位微秒）本地复刻一份用于游标格式校验，避免跨包依赖内部私有导出。
const CANONICAL_CURSOR_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function exactRunLimit(limit: number | undefined, label: string): number {
  const value = limit ?? DEFAULT_RUN_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_RUN_LIMIT) {
    throw new ConversationRunRepositoryInputError(
      `${label} must be an integer from 1 through ${MAX_RUN_LIMIT}`
    );
  }
  return value;
}

function assertRunListCursor(cursor: RunListCursor | undefined, label: string) {
  if (!cursor) {
    return;
  }
  if (!CANONICAL_CURSOR_TIMESTAMP_RE.test(cursor.createdAt) || !UUID_RE.test(cursor.id)) {
    throw new ConversationRunRepositoryInputError(
      `${label} cursor requires a canonical UTC microsecond timestamp and UUID`
    );
  }
}

function goalSummaryFrom(title: string, objectiveMd: string | null): string {
  const trimmedObjective = objectiveMd?.trim() ?? "";
  const source = trimmedObjective.length > 0 ? trimmedObjective : title.trim();
  const normalized = source.length > 0 ? source : "AI 执行";
  if (normalized.length <= GOAL_SUMMARY_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, GOAL_SUMMARY_MAX_LENGTH)}…`;
}

type RawRecentStepJson = {
  phase?: unknown;
  toolName?: unknown;
  outputExcerpt?: unknown;
  stepNo?: unknown;
} | null;

// SQL 侧已经把「取这个 run 最近一步」压成一条相关子查询（见 recentStepJsonSelection），这里只负责把
// 拿回来的 jsonb 值防御性地收窄成强类型；行状不对（列缺失/类型不符）时整体丢弃，不把半成品结构塞给上层。
function normalizeRecentStep(raw: RawRecentStepJson): ConversationRunRecentStep | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const phase = typeof raw.phase === "string" && raw.phase.length > 0 ? raw.phase : null;
  const stepNo = typeof raw.stepNo === "number" && Number.isFinite(raw.stepNo) ? raw.stepNo : null;
  if (phase === null || stepNo === null) {
    return null;
  }
  const toolName = typeof raw.toolName === "string" && raw.toolName.length > 0 ? raw.toolName : null;
  const outputExcerptRaw = typeof raw.outputExcerpt === "string" ? raw.outputExcerpt : "";
  const outputExcerpt = outputExcerptRaw.length > 0 ? outputExcerptRaw : null;
  return { phase, toolName, outputExcerpt, stepNo };
}

// 一次相关子查询拿「这个 run 最新一步」的摘要（phase/toolName/输出截断/stepNo 打包成一个 jsonb 对象）。
// 这是「步骤聚合用一次 join/子查询,不逐 run 再查」的落地：无论 select 返回多少行 run，这段子查询都随
// 外层查询一次性执行完，不会在应用层对每个 run 再发一条 agent_steps 查询。
const recentStepJsonSelection = sql<RawRecentStepJson>`(
  select jsonb_build_object(
    'phase', ${agentSteps.phase},
    'toolName', ${agentSteps.toolName},
    'outputExcerpt', left(coalesce(${agentSteps.outputExcerpt}, ''), ${RECENT_STEP_EXCERPT_MAX_LENGTH}),
    'stepNo', ${agentSteps.stepNo}
  )
  from ${agentSteps}
  where ${agentSteps.agentRunId} = ${agentRuns.id}
  order by ${agentSteps.seq} desc, ${agentSteps.createdAt} desc
  limit 1
)`;

const runCursorCreatedAtSelection = sql<string>`to_char(
  ${agentRuns.createdAt} at time zone 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
)`;

const runCardSelection = {
  id: agentRuns.id,
  status: agentRuns.status,
  title: agentRuns.title,
  objectiveMd: agentRuns.objectiveMd,
  // assignee = 派活对象。批 3(并行分支)接线的 action_card_items.assignee_user_id 是权威来源；
  // turn 通道等没有来源行动卡条目的 run（source_action_card_item_id 为空）回落到 run 发起者
  // agent_runs.actor_user_id，保证这个字段永远有值可展示，不出现「军团卡没有执行者」的空态。
  assigneeUserId: sql<string | null>`coalesce(${actionCardItems.assigneeUserId}, ${agentRuns.actorUserId})`,
  costEstimateCny: agentRuns.costEstimate,
  executionHint: agentRuns.executionHint,
  workItemId: agentRuns.workItemId,
  sourceConversationId: agentRuns.sourceConversationId,
  sourceActionCardItemId: agentRuns.sourceActionCardItemId,
  recentStepJson: recentStepJsonSelection,
  createdAt: agentRuns.createdAt,
  updatedAt: agentRuns.updatedAt,
  cursorCreatedAt: runCursorCreatedAtSelection
};

type RunCardSelectionRow = {
  id: string;
  status: string;
  title: string;
  objectiveMd: string | null;
  assigneeUserId: string | null;
  costEstimateCny: string | null;
  executionHint: string;
  workItemId: string;
  sourceConversationId: string | null;
  sourceActionCardItemId: string | null;
  recentStepJson: RawRecentStepJson;
  createdAt: Date;
  updatedAt: Date;
  cursorCreatedAt: string;
};

function toCardRow(row: RunCardSelectionRow): ConversationRunCardRow {
  return {
    id: row.id,
    status: row.status,
    goalSummary: goalSummaryFrom(row.title, row.objectiveMd),
    assigneeUserId: row.assigneeUserId,
    costEstimateCny: row.costEstimateCny,
    executionHint: row.executionHint,
    workItemId: row.workItemId,
    sourceConversationId: row.sourceConversationId,
    sourceActionCardItemId: row.sourceActionCardItemId,
    recentStep: normalizeRecentStep(row.recentStepJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function cursorCondition(cursor: RunListCursor | undefined) {
  if (!cursor) {
    return undefined;
  }
  // 倒序分页（新 run 在前）：下一页取「比游标更早」的行，故用 <，跟 conversations 仓库正序列表的
  // > 方向相反，二者都靠 (created_at, id) 复合比较避免同一时间戳内的行被跳过或重复。
  return sql`(${agentRuns.createdAt}, ${agentRuns.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;
}

function buildPage<TRow extends { cursorCreatedAt: string; id: string }>(
  rows: TRow[],
  limit: number
): { pageRows: TRow[]; capped: boolean; nextCursor: RunListCursor | null } {
  const pageRows = rows.slice(0, limit);
  const capped = rows.length > limit;
  const last = pageRows.at(-1);
  return {
    pageRows,
    capped,
    nextCursor: capped && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null
  };
}

export type ConversationRunRepository = {
  listRunsForConversation: (input: ListRunsForConversationInput) => Promise<ConversationRunListResult | null>;
  listArmyOverviewForUser: (input: ListArmyOverviewForUserInput) => Promise<ArmyOverviewListResult>;
  listOutputLinksForConversation: (
    input: ListOutputLinksForConversationInput
  ) => Promise<ConversationRunOutputLinkResult>;
};

export function createConversationRunRepository(db: WorkHubDb): ConversationRunRepository {
  const conversationAccess = createConversationRepository(db);

  return {
    async listRunsForConversation(input) {
      const limit = exactRunLimit(input.limit, "conversation run list limit");
      assertRunListCursor(input.cursor, "conversation run list");

      // 鉴权复用 conversations 仓库同一套「会话可见成员」判定（main=项目所属工作区 active membership；
      // collab=participant 且租户一致）——不是自己另写一份等价但可能漂移的 SQL。
      const access = await conversationAccess.findVisibleAccessRecord({
        workspaceId: input.workspaceId,
        viewerUserId: input.viewerUserId,
        conversationId: input.conversationId
      });
      if (!access) {
        return null;
      }

      const rows = (await db
        .select(runCardSelection)
        .from(agentRuns)
        .leftJoin(actionCardItems, eq(actionCardItems.id, agentRuns.sourceActionCardItemId))
        .where(
          and(
            eq(agentRuns.workspaceId, input.workspaceId),
            eq(agentRuns.sourceConversationId, input.conversationId),
            cursorCondition(input.cursor)
          )
        )
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(limit + 1)) as unknown as RunCardSelectionRow[];

      const { pageRows, capped, nextCursor } = buildPage(rows, limit);
      return {
        rows: pageRows.map(toCardRow),
        capped,
        nextCursor,
        projectId: access.conversation.projectId
      };
    },

    async listArmyOverviewForUser(input) {
      const limit = exactRunLimit(input.limit, "army overview limit");
      assertRunListCursor(input.cursor, "army overview");

      // 「我名下+我派出」= 我是发起者(actor_user_id)，或行动卡条目把这个 run 派给了我(assignee_user_id)，
      // 或这个 run 所在工单本身有一条把我列为受派人的 work_item_assignments 记录。三者取并集。
      const mineCondition = or(
        eq(agentRuns.actorUserId, input.viewerUserId),
        eq(actionCardItems.assigneeUserId, input.viewerUserId),
        sql`exists (
          select 1
          from ${workItemAssignments}
          where ${workItemAssignments.workItemId} = ${agentRuns.workItemId}
            and ${workItemAssignments.userId} = ${input.viewerUserId}
        )`
      );

      const rows = (await db
        .select({
          ...runCardSelection,
          projectId: projects.id,
          projectName: projects.name
        })
        .from(agentRuns)
        .innerJoin(workItems, and(eq(workItems.id, agentRuns.workItemId), isNull(workItems.deletedAt)))
        .innerJoin(
          projects,
          and(
            eq(projects.id, workItems.projectId),
            eq(projects.workspaceId, workItems.workspaceId),
            eq(projects.archived, false),
            isNull(projects.deletedAt)
          )
        )
        // 逐 actor 鉴权进 SQL:只有 viewer 在这个项目所属工作区有 active membership，这些行才会出现——
        // 不是先查全部 run 再在应用层过滤（R8 DF-2 的教训）。
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, projects.workspaceId),
            eq(workspaceMemberships.userId, input.viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(actionCardItems, eq(actionCardItems.id, agentRuns.sourceActionCardItemId))
        .where(
          and(
            eq(agentRuns.workspaceId, input.workspaceId),
            eq(workItems.workspaceId, input.workspaceId),
            eq(projects.workspaceId, input.workspaceId),
            mineCondition,
            cursorCondition(input.cursor)
          )
        )
        .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
        .limit(limit + 1)) as unknown as Array<RunCardSelectionRow & { projectId: string; projectName: string }>;

      const { pageRows, capped, nextCursor } = buildPage(rows, limit);
      return {
        rows: pageRows.map((row) => ({
          ...toCardRow(row),
          projectId: row.projectId,
          projectName: row.projectName
        })),
        capped,
        nextCursor
      };
    },

    async listOutputLinksForConversation(input) {
      // 这个方法信任调用方已经通过 listRunsForConversation 做过一次会话可见性判定(与
      // apps/api/src/services/workbench-pages.ts 里 findWorkbenchAccess 之后同页多个子查询共享
      // 已验证 projectId/workspaceId 的既有先例一致)，本查询自身仍把 workspaceId 写进 WHERE 做租户围栏，
      // 但不重复整套会话成员判定——服务层绝不能在没有先跑过 access 判定的情况下单独调用它。
      const limit = exactRunLimit(input.limit, "conversation output link limit");
      const rows = await db
        .select({
          proposalId: proposals.id,
          workItemId: proposals.workItemId,
          runId: agentRuns.id,
          title: proposals.title,
          status: proposals.status,
          updatedAt: proposals.updatedAt
        })
        .from(proposals)
        .innerJoin(branches, eq(branches.id, proposals.branchId))
        .innerJoin(agentRuns, eq(agentRuns.id, branches.agentRunId))
        .where(
          and(
            eq(agentRuns.workspaceId, input.workspaceId),
            eq(agentRuns.sourceConversationId, input.conversationId)
          )
        )
        .orderBy(desc(proposals.updatedAt), desc(proposals.id))
        .limit(limit + 1);

      const pageRows = rows.slice(0, limit);
      return {
        rows: pageRows,
        capped: rows.length > limit
      };
    }
  };
}
