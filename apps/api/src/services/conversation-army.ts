import { settings } from "@workhub/config";
import {
  createConversationRunRepository,
  getSharedDatabaseClient,
  listRecentProactiveIntentsForUser,
  type ArmyOverviewRunCardRow,
  type ConversationRunCardRow,
  type ConversationRunRepository,
  type ProposalDiffStatsFile,
  type RecentProactiveIntentRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  armyBackgroundPageVmSchema,
  armyOverviewPageVmSchema,
  catCodename,
  conversationArmyPanelVmSchema,
  type ArmyBackgroundPageVM,
  type ArmyChangedFileVM,
  type ArmyOverviewPageVM,
  type ArmyRunListQuery,
  type ConversationArmyPanelVM
} from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { getDefaultPulseScheduler, type PulseSchedulerStats } from "../workers/pulse-scheduler.js";

// R17 G3（#8 后台任务区接真）：最近主动性动态展示上限（拍板 B）。多取 1 条用来精确判定 capped（拿到
// 第 11 条即说明「还有更多没显示」），VM 只回前 10。
const ARMY_BACKGROUND_PROACTIVE_LIMIT = 10;

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

// R17 G3（#8）：后台任务区的两个只读数据源端口——都可注入，便于单测不碰真库/真调度器。
//  * pulse.stats() —— 统一调度器每任务运行统计（进程级心跳，无工作区/用户数据）。enabled=false 时不调用。
//  * listRecentProactiveIntents —— 最近投向某用户的主动性动态（workspace+target_user 收窄，见仓库函数注释）。
export type ConversationArmyBackgroundSources = {
  pulse: { enabled: boolean; stats: () => PulseSchedulerStats };
  listRecentProactiveIntents: (input: {
    workspaceId: string;
    targetUserId: string;
    limit: number;
  }) => Promise<RecentProactiveIntentRow[]>;
};

export type ConversationArmyService = {
  conversationArmyPanel(input: {
    actor: AuthActor;
    conversationId: string;
    query: ArmyRunListQuery;
  }): Promise<ConversationArmyPanelVM>;
  armyOverview(input: { actor: AuthActor; query: ArmyRunListQuery }): Promise<ArmyOverviewPageVM>;
  armyBackground(input: { actor: AuthActor }): Promise<ArmyBackgroundPageVM>;
};

export type ConversationArmyServiceDependencies = {
  repo: ConversationArmyRepositorySources;
  // 可选：只有 armyBackground() 用得到（#8）。conversationArmyPanel/armyOverview 不依赖它——不注入时
  // 那两个方法照常工作，只有 armyBackground 会在缺依赖时抛错（默认工厂恒注入，生产永不缺）。
  background?: ConversationArmyBackgroundSources;
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

// R13 批 P1.5（右栏变动文件区）：把 proposals.diff_stats_json 的一条 per-file 明细映射成公开 VM——
// 有意丢弃内部 change_id（VM 只暴露 path/change_type/adds/dels，去重靠 path，见 army/render.ts 的
// collectArmyChangedFiles），adds/dels 缺省即"这条改动没能计入统计"，不冒充 0。
function changedFileToVm(file: ProposalDiffStatsFile): ArmyChangedFileVM {
  return {
    ...(file.path ? { path: file.path } : {}),
    change_type: file.change_type,
    ...(file.adds !== undefined ? { adds: file.adds } : {}),
    ...(file.dels !== undefined ? { dels: file.dels } : {})
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

// R17 G3（#8）：pulse stats() 的 Record<name, taskStats> → VM 数组（保留注册顺序）。有意丢弃
// last_error_message——它可能带内部错误细节，不该泄漏给普通成员；error_count 数字足够表达「健康度」。
function schedulerStatsToVm(stats: PulseSchedulerStats): ArmyBackgroundPageVM["scheduler"]["tasks"] {
  return Object.entries(stats.tasks).map(([name, task]) => ({
    name,
    interval_ms: task.interval_ms,
    running: task.running,
    tick_count: task.tick_count,
    skipped_count: task.skipped_count,
    error_count: task.error_count,
    last_tick_at: task.last_tick_at ?? null
  }));
}

function proactiveIntentToVm(row: RecentProactiveIntentRow): ArmyBackgroundPageVM["proactive"]["items"][number] {
  return {
    id: row.id,
    kind: row.kind,
    stage: row.stage,
    status: row.status,
    delivered_via: row.deliveredVia,
    created_at: row.createdAt.toISOString()
  };
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
              updated_at: row.updatedAt.toISOString(),
              // R13 批 P1.5：null（历史 proposal/还没统计过）时整个字段不出现，不冒充空数组——
              // 右栏据此区分"这份产出没有变动文件"与"这份产出还没跑过统计"。
              ...(row.diffStatsJson ? { changed_files: row.diffStatsJson.files.map(changedFileToVm) } : {})
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
    },

    async armyBackground(input) {
      const human = humanScope(input.actor);
      const background = deps.background;
      if (!background) {
        // 只有当调用方漏注入 background 端口时才会到这（默认工厂恒注入）——大声报错，不静默返回假空。
        throw new Error("conversation army service missing background sources for armyBackground()");
      }
      // 定时任务：总开关未开时不去实例化调度器（避免副作用），诚实回 enabled=false + 空表。
      const scheduler = background.pulse.enabled
        ? { enabled: true, tasks: schedulerStatsToVm(background.pulse.stats()) }
        : { enabled: false, tasks: [] };
      // 主动性动态：多取 1 条精确判定 capped（拿到第 11 条即「还有更多」），VM 只回前 10。
      const proactiveRows = await background.listRecentProactiveIntents({
        workspaceId: human.workspaceId,
        targetUserId: human.userId,
        limit: ARMY_BACKGROUND_PROACTIVE_LIMIT + 1
      });
      const capped = proactiveRows.length > ARMY_BACKGROUND_PROACTIVE_LIMIT;
      const items = proactiveRows.slice(0, ARMY_BACKGROUND_PROACTIVE_LIMIT).map(proactiveIntentToVm);

      return parseOutputContract(
        armyBackgroundPageVmSchema,
        {
          generated_at: now().toISOString(),
          scheduler,
          proactive: { items, capped }
        },
        "conversation-army.background"
      );
    }
  };
}

let defaultConversationArmyDbClient: WorkHubDatabaseClient | undefined;
let defaultConversationArmyService: ConversationArmyService | undefined;

export function getDefaultConversationArmyService(): ConversationArmyService {
  if (!defaultConversationArmyService) {
    defaultConversationArmyDbClient = getSharedDatabaseClient();
    const db = defaultConversationArmyDbClient.db;
    defaultConversationArmyService = createConversationArmyService({
      repo: createConversationRunRepository(db),
      background: {
        // pulse 总开关未开时不调 getDefaultPulseScheduler()（避免为一个只读端点实例化调度器 + 其依赖的
        // 审批/通知服务）。开启时拿到的正是 server.ts 已 start 的同一个 memoized 单例，stats 反映真实 tick。
        pulse: {
          enabled: settings.pulse.enabled,
          stats: () => getDefaultPulseScheduler().stats()
        },
        listRecentProactiveIntents: (input) => listRecentProactiveIntentsForUser(db, input)
      }
    });
  }
  return defaultConversationArmyService;
}
