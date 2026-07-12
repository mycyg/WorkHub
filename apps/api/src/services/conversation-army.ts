import {
  createConversationRunRepository,
  getSharedDatabaseClient,
  type ArmyOverviewRunCardRow,
  type ConversationRunCardRow,
  type ConversationRunRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  armyOverviewPageVmSchema,
  catCodename,
  conversationArmyPanelVmSchema,
  type ArmyOverviewPageVM,
  type ArmyRunListQuery,
  type ConversationArmyPanelVM
} from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

// R12 批 5(军团面板,服务端读侧切片):只读聚合，不碰派发写路径。
// GET /conversations/:id/army 与 GET /me/army 两个 handler 消费这个 service（见 routes/conversation-army.ts）。

export class ConversationArmyServiceError extends Error {
  constructor(
    public readonly status: 404,
    public readonly code: "conversation_army_not_found",
    message: string
  ) {
    super(message);
    this.name = "ConversationArmyServiceError";
  }
}

// 404 统一 fail-closed:不区分「会话不存在」与「你没权限看这个会话」，两种情况返回同一个 404，
// 攻击者拿不到存在性信号——照批 0 workbench-pages.ts 的 workbenchNotFound() 处理惯例。
function conversationArmyNotFound(): ConversationArmyServiceError {
  return new ConversationArmyServiceError(404, "conversation_army_not_found", "没有找到这个会话的军团面板。");
}

type HumanArmyActor = { userId: string; workspaceId: string };

function humanScope(actor: AuthActor): HumanArmyActor {
  const userId = actor.userId?.trim().toLowerCase();
  const workspaceId = actor.workspaceId?.trim().toLowerCase();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw conversationArmyNotFound();
  }
  return { userId, workspaceId };
}

export type ConversationArmyRepositorySources = Pick<
  ConversationRunRepository,
  "listRunsForConversation" | "listArmyOverviewForUser" | "listOutputLinksForConversation"
>;

export type ConversationArmyService = {
  conversationArmyPanel(input: {
    actor: AuthActor;
    conversationId: string;
    query: ArmyRunListQuery;
  }): Promise<ConversationArmyPanelVM>;
  armyOverview(input: { actor: AuthActor; query: ArmyRunListQuery }): Promise<ArmyOverviewPageVM>;
};

export type ConversationArmyServiceDependencies = {
  repo: ConversationArmyRepositorySources;
  now?: () => Date;
};

function recentStepToVm(step: ConversationRunCardRow["recentStep"]) {
  if (!step) {
    return null;
  }
  return {
    phase: step.phase,
    tool_name: step.toolName,
    output_excerpt: step.outputExcerpt,
    step_no: step.stepNo
  };
}

// 猫仔代号在这一层现算(catCodename 是纯函数,不用存库):卡片元数据全部装配完才知道 run id，
// 装配处离 UI 最近，重算成本可以忽略不计。
function runCardToVm(row: ConversationRunCardRow) {
  return {
    id: row.id,
    status: row.status,
    goal_summary: row.goalSummary,
    assignee_user_id: row.assigneeUserId,
    cost_cny: row.costEstimateCny,
    execution_hint: row.executionHint,
    work_item_id: row.workItemId,
    source_conversation_id: row.sourceConversationId,
    source_action_card_item_id: row.sourceActionCardItemId,
    cat_codename: catCodename(row.id),
    recent_step: recentStepToVm(row.recentStep),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
}

function overviewCardToVm(row: ArmyOverviewRunCardRow) {
  return {
    ...runCardToVm(row),
    project_id: row.projectId,
    project_name: row.projectName
  };
}

function cursorToVm(cursor: { createdAt: string; id: string } | null) {
  return cursor ? { after_created_at: cursor.createdAt, after_id: cursor.id } : null;
}

function cursorFromQuery(query: ArmyRunListQuery) {
  return query.afterCreatedAt && query.afterId
    ? { createdAt: query.afterCreatedAt, id: query.afterId }
    : undefined;
}

export function createConversationArmyService(deps: ConversationArmyServiceDependencies): ConversationArmyService {
  const now = deps.now ?? (() => new Date());

  return {
    async conversationArmyPanel(input) {
      const human = humanScope(input.actor);
      const cursor = cursorFromQuery(input.query);
      const runPage = await deps.repo.listRunsForConversation({
        workspaceId: human.workspaceId,
        viewerUserId: human.userId,
        conversationId: input.conversationId,
        limit: input.query.limit,
        ...(cursor ? { cursor } : {})
      });
      if (!runPage) {
        throw conversationArmyNotFound();
      }

      // 输出区不吃外部分页参数——它是这个会话 run 集合产出的提议链接聚合，本身已经用固定 cap
      // 兜底（禁止无上限查询），不需要跟 runs 列表共用游标语义。
      const outputPage = await deps.repo.listOutputLinksForConversation({
        workspaceId: human.workspaceId,
        conversationId: input.conversationId,
        limit: 20
      });

      return parseOutputContract(
        conversationArmyPanelVmSchema,
        {
          generated_at: now().toISOString(),
          conversation_id: input.conversationId,
          project_id: runPage.projectId,
          runs: {
            runs: runPage.rows.map(runCardToVm),
            capped: runPage.capped,
            next_cursor: cursorToVm(runPage.nextCursor),
            ...(runPage.rows.length === 0 ? { empty_state: "no_army_runs" as const } : {})
          },
          outputs: {
            items: outputPage.rows.map((row) => ({
              proposal_id: row.proposalId,
              work_item_id: row.workItemId,
              run_id: row.runId,
              title: row.title,
              status: row.status,
              proposal_href: `/proposals/${row.proposalId}`,
              updated_at: row.updatedAt.toISOString()
            })),
            capped: outputPage.capped
          },
          // 后台任务区尚无真数据源可读(见 packages/contracts/src/pages.ts 的 armyBackgroundTasksVmSchema
          // 注释与本批汇报的「缺口」一节)：永远空，绝不拿别的数据冒充。
          background_tasks: {
            items: [],
            empty_state: "not_yet_available" as const
          }
        },
        "conversation-army.panel"
      );
    },

    async armyOverview(input) {
      const human = humanScope(input.actor);
      const cursor = cursorFromQuery(input.query);
      const page = await deps.repo.listArmyOverviewForUser({
        workspaceId: human.workspaceId,
        viewerUserId: human.userId,
        limit: input.query.limit,
        ...(cursor ? { cursor } : {})
      });

      return parseOutputContract(
        armyOverviewPageVmSchema,
        {
          generated_at: now().toISOString(),
          viewer_user_id: human.userId,
          runs: {
            runs: page.rows.map(overviewCardToVm),
            capped: page.capped,
            next_cursor: cursorToVm(page.nextCursor),
            ...(page.rows.length === 0 ? { empty_state: "no_army_runs" as const } : {})
          }
        },
        "conversation-army.overview"
      );
    }
  };
}

let defaultConversationArmyDbClient: WorkHubDatabaseClient | undefined;
let defaultConversationArmyService: ConversationArmyService | undefined;

export function getDefaultConversationArmyService(): ConversationArmyService {
  if (!defaultConversationArmyService) {
    defaultConversationArmyDbClient = getSharedDatabaseClient();
    defaultConversationArmyService = createConversationArmyService({
      repo: createConversationRunRepository(defaultConversationArmyDbClient.db)
    });
  }
  return defaultConversationArmyService;
}
