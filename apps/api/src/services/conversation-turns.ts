import { randomUUID } from "node:crypto";

import { z } from "zod";

import { settings as runtimeSettings, type Settings } from "@workhub/config";
import {
  DEFAULT_USER_AI_PROFILE,
  USER_MEMORY_PROMPT_TOP_N,
  conversationMessageCreatedEventSchema,
  conversationMessageVmSchema,
  conversationMessageDeltaEventSchema,
  eventTypes,
  idSchema
} from "@workhub/contracts";
import {
  buildTurnMemorySection,
  buildTurnMessages,
  buildTurnSystemPrompt,
  type TurnHistoryMessage,
  type TurnMemoryCitation
} from "@workhub/agent/turns";
import {
  decideRunBudget,
  type BudgetPolicyStore,
  type CostLedgerStore
} from "@workhub/cost";
import { makeWorkHubEvent, topics } from "@workhub/events";
import {
  createActionCardRepository,
  createAiSettingsRepository,
  createConversationRepository,
  createTeamSkillRepository,
  createUserMemoryRepository,
  getSharedDatabaseClient,
  type AiSettingsRepository,
  type ConversationMessageRow,
  type ConversationRepository,
  type TeamSkillRepository,
  type UserMemoryRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { InternalContractError, parseOutputContract } from "../pages/output-contract.js";
import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";

// R12 批4a（协同会话 turns，服务端切片）：POST /conversations/:id/turns 的业务逻辑。仿
// apps/api/src/workers/conversation-observer.ts 的 LLM 调用/软预算/依赖注入模式（见该文件顶部注释）。
//
// 设计决策（集成者已拍板，不重新讨论）：
// 1. turn 不建 agent_run 也不建 work_item——聊天轮次造空工单是污染。直接调 LLM provider。
// 2. 仅 collab 会话可用；发言人必须是可见参与者（复用 conversations 仓库的 findVisibleAccessRecord，
//    fail-closed 404，同时天然给出 kind=main 判定所需的数据）。
// 3. 并发闸：同会话同时只允许一个进行中 turn，进程内内存 Map——多进程部署下不同进程各自的 Map 互不
//    知情，这不是完整闸；已知缺口，见批汇报。
// 4. 流式 delta 通过 push bus 发 conversation.message.delta（严格 payload，见 events.ts）；delta 不落库、
//    无 seq、不参与 reconcile。
// 5. 完成后用 conversations 仓库的 createCuuMessage 落一条真 seq 的 kind='text' 消息。
//    **已知设计冲突（写入报告，供集成者裁决）**：conversationMessageCreatedEventSchema 的 superRefine
//    强制 sender_type==='user' 且 actor.actor_kind==='human'——这个契约完全没有给 AI 发言者的路径开口，
//    这批范围内不允许放宽它（范围围栏只批准了 events.ts 里的 delta schema 新增）。所以 Cuu 落库的这条
//    消息**不会**触发任何"消息已创建"类的广播事件；发起 turn 的客户端从这次 HTTP 响应本身拿到完整的
//    消息 VM（含真 id/seq），其它同会话在线查看者目前只能看到 delta 流的实时打字，要拿到最终真实
//    seq/id 需要客户端自己重新拉取 GET /conversations/:id/messages。这与批3 的 postSystemMessage
//    （系统事件消息同样不配对任何专属实时事件，只靠 action-card-updated 事件提示"该刷新了"）是同一个
//    先例档位，不是我漏做。
// 6. 模式档：mode=1（只观察）拒绝；mode>=2 都允许纯对话 turn。执行/审核语义归批 4b。
// 7. 60s 硬超时；超时/任何 LLM 失败都统一映射成 500 conversation_turn_failed，不落半截消息。

const DEFAULT_HISTORY_WINDOW = 50;
const DEFAULT_MAX_TURN_RESPONSE_TOKENS = 4000;
const DEFAULT_TURN_TIMEOUT_MS = 60_000;
const TURN_TEAM_SKILL_TOP_N = 5;

export class ConversationTurnServiceError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 429 | 500,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ConversationTurnServiceError";
  }
}

export const createConversationTurnRequestSchema = z
  .object({
    user_message_id: idSchema
  })
  .strict();
export type CreateConversationTurnRequest = z.infer<typeof createConversationTurnRequestSchema>;

const conversationTurnResultSchema = z
  .object({
    turn_id: idSchema,
    message: conversationMessageVmSchema
  })
  .strict();
export type ConversationTurnResultVM = z.infer<typeof conversationTurnResultSchema>;

// 最小 LLM 客户端形状——只要求流式接口（本批只做纯对话，不接工具调用）。真实 wiring 用
// ProviderRegistry.get(...).messages.stream(...)，其返回值结构性兼容这个类型（见
// packages/agent/src/providers/measured-client.ts 的 messages.stream）。
export type TurnLlmStreamEvent = { type: string; data?: unknown };
export type TurnLlmFinalMessage = { content: Array<{ type: string; text?: string }> };
export type TurnLlmStream = AsyncIterable<TurnLlmStreamEvent> & {
  getFinalMessage: () => Promise<TurnLlmFinalMessage>;
};
export type TurnLlmClient = {
  messages: {
    stream: (input: {
      maxTokens: number;
      source: "agent_step";
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: string }>;
      signal?: AbortSignal;
    }) => Promise<TurnLlmStream>;
  };
};
export type ConversationTurnClientProvider = (input: {
  actorId: string;
  userId: string;
  workspaceId: string;
}) => TurnLlmClient | Promise<TurnLlmClient>;

export type ConversationNicknameLookup = (userIds: string[]) => Promise<Map<string, string>>;

export type ConversationTurnServiceDeps = {
  conversations: Pick<ConversationRepository, "findVisibleAccessRecord" | "listMessagesAfter" | "createCuuMessage">;
  aiSettings: Pick<AiSettingsRepository, "findUserProfileAccessRecord">;
  userMemories: Pick<UserMemoryRepository, "listForUser" | "touch">;
  teamSkills: Pick<TeamSkillRepository, "listActive">;
  nicknames: ConversationNicknameLookup;
  client: ConversationTurnClientProvider;
  policyStore: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
  settings?: Settings;
  bus?: Pick<PushBus, "publish">;
  logger?: Pick<StructuredLogger, "warn">;
  now?: () => Date;
  id?: () => string;
  historyWindowSize?: number;
  maxResponseTokens?: number;
  turnTimeoutMs?: number;
};

export type ConversationTurnService = {
  createTurn(input: {
    actor: AuthActor;
    conversationId: string;
    payload: CreateConversationTurnRequest;
  }): Promise<ConversationTurnResultVM>;
};

type HumanTurnActor = { actor: AuthActor; userId: string; workspaceId: string };

function requireHumanActor(actor: AuthActor): HumanTurnActor {
  const workspaceId = actor.workspaceId.trim();
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw new ConversationTurnServiceError(403, "human_required", "需要已加入工作区的真人用户才能发起协同会话回应。");
  }
  return { actor, userId, workspaceId };
}

// 与 apps/api/src/services/conversations.ts 里未导出的同名私有函数同构；那份不导出，触碰它超出本批
// 范围，这里独立写一份最小拷贝（10 行，纯映射，没有分叉行为风险）。
function messageToVm(row: ConversationMessageRow): Record<string, unknown> {
  return {
    id: row.id,
    conversation_id: row.conversationId,
    seq: row.seq,
    sender_type: row.senderType,
    sender_user_id: row.senderUserId,
    kind: row.kind,
    content: row.contentJson,
    thread_root_id: row.threadRootId,
    created_at: row.createdAt.toISOString()
  };
}

// ── 历史消息 → 多轮对话展示文本（同构 conversation-observer.ts 的 messageDisplayText，独立成本文件
//    自己的小函数：那份是未导出的 worker 内部函数，触碰它超出本批范围） ─────────────────────────

function historyDisplayText(row: ConversationMessageRow): string | null {
  const content = row.contentJson as Record<string, unknown>;
  switch (row.kind) {
    case "text":
      return typeof content["text"] === "string" ? content["text"] : null;
    case "file_card":
      return typeof content["snapshot_name"] === "string" ? `分享了文件：${content["snapshot_name"]}` : "分享了一个文件";
    case "tool_note":
      return "（一次工具调用）";
    case "system_event":
      return typeof content["summary"] === "string" ? content["summary"] : "（系统事件）";
    case "action_card":
      // 不把 Cuu 自己产出的行动卡结构化内容回灌进对话上下文。
      return null;
    default:
      return null;
  }
}

function buildHistory(rows: ConversationMessageRow[], nicknames: Map<string, string>): TurnHistoryMessage[] {
  const history: TurnHistoryMessage[] = [];
  for (const row of rows) {
    const text = historyDisplayText(row);
    if (!text) {
      continue;
    }
    if (row.senderType === "cuu") {
      history.push({ role: "assistant", senderLabel: "Cuu", text });
    } else if (row.senderType === "user") {
      const label = row.senderUserId ? nicknames.get(row.senderUserId) ?? "未知成员" : "未知成员";
      history.push({ role: "user", senderLabel: label, text });
    } else {
      history.push({ role: "user", senderLabel: "系统", text });
    }
  }
  return history;
}

function extractDeltaText(event: TurnLlmStreamEvent): string | null {
  if (event.type !== "content_block_delta" || !event.data || typeof event.data !== "object") {
    return null;
  }
  const delta = (event.data as Record<string, unknown>)["delta"];
  if (!delta || typeof delta !== "object") {
    return null;
  }
  const deltaRecord = delta as Record<string, unknown>;
  if (deltaRecord["type"] !== "text_delta" || typeof deltaRecord["text"] !== "string") {
    return null;
  }
  return deltaRecord["text"];
}

function extractFinalText(final: TurnLlmFinalMessage): string {
  return final.content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

// ── 预算软闸——与 conversation-observer.ts 的 checkObserverBudget 同款理由，已知缺口：
//    budget_reservations.run_id 是 NOT NULL 外键指向 agent_runs（且 agent_runs.work_item_id 也
//    NOT NULL）。turn 不建 work_item/agent_run，没有可挂靠的 run_id——接入原子 reservation 需要伪造
//    一个 work_item+agent_run，这正是铁律第3条禁止的假接线。改用软闸：调用前读团队维度已用量快照
//    做门槛判断，调用本身仍通过 ProviderRegistry 的 usageSink 计入 cost_ledger_entries（真实成本
//    记账），只是不参与并发原子预留的互斥。这条缺口是观察者那条的原样复述，不是新缺口。

async function checkTurnBudget(deps: ConversationTurnServiceDeps, workspaceId: string, at: Date): Promise<boolean> {
  const settings = deps.settings ?? runtimeSettings;
  const usage = await deps.ledgerStore.usageSnapshots({ teamId: workspaceId }, { now: at });
  const decision = decideRunBudget({
    settings,
    scopeIds: { teamId: workspaceId },
    policies: await deps.policyStore.listPolicies(settings),
    usage,
    now: at
  });
  return decision.allowed;
}

// ── delta SSE 生产者 ──────────────────────────────────────────────────────────────

async function emitDelta(
  deps: ConversationTurnServiceDeps,
  input: { conversationId: string; turnId: string; deltaText: string; ordinal: number; at: Date }
) {
  const bus = deps.bus ?? getDefaultPushBus();
  const topic = topics.conversation(input.conversationId).topic;
  let event;
  try {
    event = parseOutputContract(
      conversationMessageDeltaEventSchema,
      makeWorkHubEvent({
        type: eventTypes.conversationMessageDelta,
        topic,
        ts: input.at,
        data: {
          conversation_id: input.conversationId,
          turn_id: input.turnId,
          delta_text: input.deltaText,
          ordinal: input.ordinal
        }
      }),
      "conversation-turns.delta.event"
    );
  } catch (error) {
    if (error instanceof InternalContractError) {
      deps.logger?.warn?.("conversation_turn_delta_contract_violation", { conversationId: input.conversationId, error });
      return;
    }
    throw error;
  }
  try {
    await bus.publish(topic, eventTypes.conversationMessageDelta, event);
  } catch (error) {
    deps.logger?.warn?.("conversation_turn_delta_publish_failed", { conversationId: input.conversationId, error });
  }
}

// ── 并发闸：进程内 Map，key=conversationId。多进程部署下这不是完整闸——已知缺口，见批汇报。────────

export function createConversationTurnService(deps: ConversationTurnServiceDeps): ConversationTurnService {
  const now = deps.now ?? (() => new Date());
  const id = deps.id ?? randomUUID;
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const activeTurns = new Set<string>();

  return {
    async createTurn(input) {
      const human = requireHumanActor(input.actor);

      // 并发闸必须是函数体里**第一个**同步动作(在任何 await 之前)：两个并发请求 A/B 在同一个事件循环
      // tick 里先后调用 createTurn 时，A 会同步跑完这一段(含 activeTurns.add)才让出控制权，B 紧接着
      // 同步执行到这里时一定能看见 A 已经设置的标记——如果这段前面插了任何 await(哪怕是访问权限查询),
      // A/B 两个 await 链路的微任务交错顺序就不再可预测,busy 闸会变成竞态而不是确定性行为。
      // 代价:未经访问权限校验的请求也会短暂占用/释放这个会话的忙碌位——它只泄露"这个会话 id 当前有
      // 一轮 turn 在跑"，不泄露内容/参与者，且 try/finally 保证失败请求立刻释放,不会真的卡住合法请求。
      if (activeTurns.has(input.conversationId)) {
        throw new ConversationTurnServiceError(409, "conversation_turn_busy", "这个会话已经有一轮 Cuu 回应正在进行，请稍候。");
      }
      activeTurns.add(input.conversationId);

      try {
        const access = await deps.conversations.findVisibleAccessRecord({
          workspaceId: human.workspaceId,
          viewerUserId: human.userId,
          conversationId: input.conversationId
        });
        if (!access) {
          throw new ConversationTurnServiceError(404, "conversation_not_found", "没有找到这个会话。");
        }
        if (access.conversation.kind !== "collab") {
          throw new ConversationTurnServiceError(
            409,
            "conversation_turn_not_collab",
            "主区群聊由静默观察者处理，不支持单独发起协同回应。"
          );
        }

        const profileAccess = await deps.aiSettings.findUserProfileAccessRecord({
          workspaceId: human.workspaceId,
          userId: human.userId
        });
        const mode = profileAccess?.profile?.defaultMode ?? DEFAULT_USER_AI_PROFILE.default_mode;
        if (mode === 1) {
          throw new ConversationTurnServiceError(
            409,
            "conversation_turn_mode_observe_only",
            "当前模式只观察不回应，先在设置里调高档位。"
          );
        }

        const windowSize = deps.historyWindowSize ?? DEFAULT_HISTORY_WINDOW;
        const afterSeq = Math.max(0, access.conversation.nextSeq - 1 - windowSize);
        const page = await deps.conversations.listMessagesAfter({
          workspaceId: human.workspaceId,
          viewerUserId: human.userId,
          conversationId: input.conversationId,
          afterSeq,
          limit: windowSize + 1
        });
        if (!page) {
          throw new ConversationTurnServiceError(404, "conversation_not_found", "没有找到这个会话。");
        }
        const anchor = page.rows.find((row) => row.id === input.payload.user_message_id);
        if (
          !anchor ||
          anchor.senderType !== "user" ||
          anchor.senderUserId?.toLowerCase() !== human.userId.toLowerCase()
        ) {
          throw new ConversationTurnServiceError(
            404,
            "conversation_turn_message_not_found",
            "没有找到这条待回应的消息。"
          );
        }

        const budgetOk = await checkTurnBudget(deps, human.workspaceId, now());
        if (!budgetOk) {
          throw new ConversationTurnServiceError(
            429,
            "conversation_turn_budget_exhausted",
            "这个工作区今天的 AI 预算已经用完了。"
          );
        }

        const senderIds = [...new Set(page.rows.map((row) => row.senderUserId).filter((value): value is string => Boolean(value)))];
        const nicknames = await deps.nicknames(senderIds);
        const history = buildHistory(page.rows, nicknames);

        const [userMemoryRows, teamSkillRows] = await Promise.all([
          deps.userMemories.listForUser(human.userId, { limit: USER_MEMORY_PROMPT_TOP_N, workspaceId: human.workspaceId }),
          deps.teamSkills.listActive(human.workspaceId)
        ]);
        const topTeamSkills = teamSkillRows.slice(0, TURN_TEAM_SKILL_TOP_N);
        const memorySection = buildTurnMemorySection({
          userMemories: userMemoryRows.map((row) => ({ key: row.key, valueMd: row.valueMd })),
          teamSkills: topTeamSkills.map((row) => ({ name: row.name, whenToUse: row.whenToUse }))
        });
        if (userMemoryRows.length > 0) {
          try {
            await deps.userMemories.touch(userMemoryRows.map((row) => row.id), now(), { workspaceId: human.workspaceId });
          } catch (error) {
            logger.warn("conversation_turn_memory_touch_failed", { conversationId: input.conversationId, error });
          }
        }

        const system = [buildTurnSystemPrompt(), memorySection.promptSection].filter((part) => part.length > 0).join("\n\n");
        const messages = buildTurnMessages(history);

        const turnId = id();
        const client = await deps.client({ actorId: human.userId, userId: human.userId, workspaceId: human.workspaceId });

        const controller = new AbortController();
        const timeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let fullText: string;
        try {
          const stream = await client.messages.stream({
            maxTokens: deps.maxResponseTokens ?? DEFAULT_MAX_TURN_RESPONSE_TOKENS,
            source: "agent_step",
            system,
            messages,
            signal: controller.signal
          });
          let ordinal = 0;
          for await (const event of stream) {
            const deltaText = extractDeltaText(event);
            if (deltaText) {
              await emitDelta(deps, { conversationId: input.conversationId, turnId, deltaText, ordinal, at: now() });
              ordinal += 1;
            }
          }
          const final = await stream.getFinalMessage();
          fullText = extractFinalText(final).trim();
        } catch (error) {
          logger.warn("conversation_turn_llm_failed", { conversationId: input.conversationId, turnId, error });
          throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没接上，请再试一次。");
        } finally {
          clearTimeout(timer);
        }

        if (fullText.length === 0) {
          throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。");
        }

        const contentJson: { text: string; memory_citations?: TurnMemoryCitation[] } = { text: fullText };
        if (memorySection.citations.length > 0) {
          contentJson.memory_citations = memorySection.citations;
        }

        let created: ConversationMessageRow;
        try {
          created = await deps.conversations.createCuuMessage({
            workspaceId: human.workspaceId,
            conversationId: input.conversationId,
            contentJson,
            at: now()
          });
        } catch (error) {
          logger.warn("conversation_turn_persist_failed", { conversationId: input.conversationId, turnId, error });
          throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 的回复没能保存，请再试一次。");
        }

        const message = parseOutputContract(conversationMessageVmSchema, messageToVm(created), "conversation-turns.message");

        // R12 批4a 集成修订:落库的 Cuu 回复广播 message.created(ai actor↔cuu sender 严格配对已在
        // 契约放开)——其他在看成员不再只能靠瞬态 delta,断线/后进场者按既有 afterSeq 语义补齐。
        // 广播失败仅告警不回滚:消息已持久,可靠性由拉取通道兜底(与 conversations.ts 同款容错)。
        try {
          const conversationTopic = topics.conversation(input.conversationId).topic;
          const createdEvent = parseOutputContract(
            conversationMessageCreatedEventSchema,
            makeWorkHubEvent({
              type: eventTypes.conversationMessageCreated,
              topic: conversationTopic,
              ts: now(),
              actor: { actor_kind: "ai", label: "Cuu" },
              project_id: access.conversation.projectId,
              preview_text: contentJson.text.slice(0, 200),
              data: message
            }),
            "conversation-turns.event.created"
          );
          await deps.bus?.publish(conversationTopic, eventTypes.conversationMessageCreated, createdEvent);
        } catch (error) {
          logger.warn("conversation_turn_created_publish_failed", {
            conversationId: input.conversationId,
            turnId,
            error
          });
        }

        return parseOutputContract(conversationTurnResultSchema, { turn_id: turnId, message }, "conversation-turns.result");
      } finally {
        activeTurns.delete(input.conversationId);
      }
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultConversationTurnService: ConversationTurnService | undefined;

function defaultClientProvider(): ConversationTurnClientProvider {
  return ({ actorId, userId, workspaceId }) =>
    getDefaultProviderRegistry().get({ id: actorId, userId, workspaceId }, "assistant") as unknown as TurnLlmClient;
}

export function getDefaultConversationTurnService(): ConversationTurnService {
  if (!defaultConversationTurnService) {
    defaultDbClient = defaultDbClient ?? getSharedDatabaseClient();
    const db = defaultDbClient.db;
    const actionCards = createActionCardRepository(db);
    defaultConversationTurnService = createConversationTurnService({
      conversations: createConversationRepository(db),
      aiSettings: createAiSettingsRepository(db),
      userMemories: createUserMemoryRepository(db),
      teamSkills: createTeamSkillRepository(db),
      nicknames: (userIds) => actionCards.listNicknamesByUserIds(userIds),
      client: defaultClientProvider(),
      policyStore: getDefaultBudgetPolicyStore(),
      ledgerStore: getDefaultCostLedgerStore(),
      bus: getDefaultPushBus(),
      logger: getDefaultStructuredLogger()
    });
  }
  return defaultConversationTurnService;
}
