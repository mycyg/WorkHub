import { randomUUID } from "node:crypto";

import { z } from "zod";

import { settings as runtimeSettings, type Settings } from "@workhub/config";
import {
  DEFAULT_USER_AI_PROFILE,
  USER_MEMORY_PROMPT_TOP_N,
  conversationMessageCreatedEventSchema,
  conversationMessageVmSchema,
  conversationMessageDeltaEventSchema,
  defaultWorkHubLocale,
  eventTypes,
  idSchema
} from "@workhub/contracts";
import {
  ASK_CLARIFYING_QUESTION_TOOL,
  CREATE_WORK_ITEM_TOOL,
  DRIVE_SEARCH_TOOL,
  MAX_TURN_MODEL_ROUNDS,
  MAX_TURN_TOOL_CALLS,
  SEND_FILE_CARD_TOOL,
  buildContextCompactionPrompt,
  buildTurnContextSummarySection,
  buildTurnConversationRefSection,
  buildTurnInvokedSkillSection,
  buildTurnMemorySection,
  buildTurnMessages,
  buildTurnProjectInstructionsSection,
  buildTurnSystemPrompt,
  composeTurnSystemPrompt,
  buildTurnToolDefinitions,
  parseTurnToolCall,
  type AskClarifyingQuestionToolInput,
  type CreateWorkItemToolInput,
  type DriveSearchToolInput,
  type SendFileCardToolInput,
  type TurnHistoryMessage,
  type TurnMemoryCitation
} from "@workhub/agent/turns";
import { ProviderNotConfiguredError } from "@workhub/agent/providers";
import {
  AssistantMessageEventStream,
  piMessagesToWorkhub,
  runAgentLoop,
  toPiStopReason,
  workhubAssistantContentToPi,
  type AgentContext,
  type AgentEvent,
  type AgentLoopConfig,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  type StreamFn
} from "@workhub/agent/loop2";
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
  type TeamSkillRow,
  type UserMemoryRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";

import { getDefaultPushBus, getDefaultPresenceStore, type PushBus } from "../broker/index.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { InternalContractError, parseOutputContract } from "../pages/output-contract.js";
import { notifyConversationMessage } from "./conversation-message-notify.js";
import {
  MAX_TURN_CONVERSATION_REFS,
  TURN_CONVERSATION_REF_MESSAGE_LIMIT,
  mayInvokeSkill,
  mayReferenceConversation,
  resolveConversationRefs,
  resolveSkillRefs
} from "./conversation-turn-references.js";
import { createNotificationService } from "./notifications.js";
import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";
import { DrivePageServiceError, getDefaultDrivePageService, type DrivePageService } from "./drive-pages.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";
import { WorkItemServiceError, getDefaultWorkItemService, type WorkItemService } from "./work-items.js";

// R12 批4a（协同会话 turns，服务端切片）：POST /conversations/:id/turns 的业务逻辑。仿
// apps/api/src/workers/conversation-observer.ts 的 LLM 调用/软预算/依赖注入模式（见该文件顶部注释）。
//
// 设计决策（集成者已拍板，不重新讨论）：
// 1. turn 不建 agent_run；R13 批4c 起，turn *可以*建 work_item——这是对批4a 原话「聊天轮次造空工单是
//    污染」的一次有意修订（由 N7「Cuu 自主发布任务」驱动），只在「明确的、经过澄清的创建意图」下才
//    触发（见 findPendingClarification），不是任何一句话都能顺嘴建工单。
// 2. 仅 collab 会话可用；发言人必须是可见参与者（复用 conversations 仓库的 findVisibleAccessRecord，
//    fail-closed 404，同时天然给出 kind=main 判定所需的数据）。
// 3. 并发闸：同会话同时只允许一个进行中 turn，进程内内存 Map——多进程部署下不同进程各自的 Map 互不
//    知情，这不是完整闸；已知缺口，见批汇报。
// 4. 流式 delta 通过 push bus 发 conversation.message.delta（严格 payload，见 events.ts）；delta 不落库、
//    无 seq、不参与 reconcile。
// 5. 完成后用 conversations 仓库的 createCuuMessage 落一条真 seq 的消息（kind 现在可能是 text/
//    file_card/tool_note，不再只有 text——见下方受限工具环）。
//    集成裁决（b22f8c28，取代批 4a 原报告里的「设计冲突」记录）：message.created 契约已放开为
//    human↔user / ai↔cuu 的严格配对，本服务落库后会补广播一条 created 事件（见下方
//    conversation_turn_created_publish 段）——发起端从 HTTP 响应拿最终消息 VM（loop 里最后一条落库的
//    消息），其它在看成员靠广播拿真 id/seq，两路都到时由客户端按 id 去重。广播失败仅告警不回滚，
//    拉取通道兜底。
// 6. 模式档：mode=1（只观察）拒绝；mode>=2 都允许纯对话 turn。
// 7. 硬超时；超时/任何 LLM 失败都统一映射成 500 conversation_turn_failed，不落半截消息（工具环已经
//    落库的 tool_note/file_card 除外——它们是已经发生的真实事实，不因为后续轮次失败而回滚）。
//
// R13 批4c（Cuu 对话工具面）新增：受限工具环——turn 从单发流式升级为最多 MAX_TURN_MODEL_ROUNDS 轮的
// 小型 agentic 循环，工具定义/入参校验在 packages/agent/src/turns/tools.ts（纯函数），DB/权限相关的
// 执行逻辑在下面的 executeXxxTool 函数里。终止性保证：每一轮要么模型直接给出文本（循环结束），要么
// 调用工具；一旦 toolCallsUsed 达到 MAX_TURN_TOOL_CALLS 或 round 到达最后一轮，下一次调用就不再传
// tools 参数，模型没有工具可调，只能回文本——循环因此在有限轮内必然终止，不依赖模型"自觉不再调用"。

const DEFAULT_HISTORY_WINDOW = 50;
const DEFAULT_MAX_TURN_RESPONSE_TOKENS = 4000;
// R13 批4c：60s 是为单轮纯文本流式设计的；多轮工具调用会显著拉长一次 turn 的耗时，翻倍到 120s
// （设计稿「踩雷」明确点名的已知风险，这里给出修订值而不是留着不动）。
const DEFAULT_TURN_TIMEOUT_MS = 120_000;
const TURN_TEAM_SKILL_TOP_N = 5;
// R23 F-07：解析 `#会话标题` 时一次取多少条本项目可见会话当候选——仓库层 limit 上限是 100，这里取
// 一半：项目里的会话数远小于这个量级，候选越多每条消息的字符串匹配成本越高，够用即可。
const TURN_CONVERSATION_REF_CANDIDATE_LIMIT = 50;

// ── R13 批 C1（会话上下文压缩）常量 ───────────────────────────────────────────────────
//
// 攒够多少条"新滑出窗口"的消息才刷新一次摘要——不是每轮都摘要，避免每条消息都触发一次额外 LLM 调用。
// MVP 用消息条数而非严格 token 计数：仓库里没有面向"自然语言会话历史"的 token 估算工具（loop.ts 的
// compactConversation 服务的是完全不同的数据形状——工具调用步骤，不是自然语言对话）。token 版本是
// 后续加固项，如实标注这个简化，不在本批打包。
const CONTEXT_SUMMARY_REFRESH_BATCH = 20;
// 单次压缩 LLM 调用最多吃多少条历史消息——与仓库层 listMessagesAfter 的 assertLimit 上限（100）对齐。
// 保证压缩确实是"滚动/增量"的：单次调用输入长度有界，不随会话总长度线性增长（04 铁律#4）。如果积压
// 超过这个数（很久没有 turn 触发过压缩），一次只吃最早的一批，context_summary_through_seq 只推进到
// 实际吃到的那条——下一轮 createTurn 会因为差值仍然 > REFRESH_BATCH 而继续追赶，几轮内自然追平，不需要
// 一次性无上限地啃完整个积压。
const CONTEXT_SUMMARY_MAX_BATCH_MESSAGES = 100;
const CONTEXT_SUMMARY_MAX_RESPONSE_TOKENS = 800;
// 压缩调用不面向任何用户等待中的界面反馈，给它一个比主 turn 更短的独立超时——超时即 fail-open（见
// tryCompactConversationContext），不拖累这一轮真正的用户对话。
const CONTEXT_SUMMARY_TIMEOUT_MS = 30_000;

export class ConversationTurnServiceError extends Error {
  constructor(
    // BUG-02：新增 503——目标 LLM provider 未配置（缺 apiKey）时返回「服务暂不可用」而非泛化 500。
    public readonly status: 400 | 403 | 404 | 409 | 429 | 500 | 503,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ConversationTurnServiceError";
  }
}

// BUG-02：把 provider registry 的 fail-fast typed error 映射成明确的 503 语义。部署侧没配 LLM_API_KEY 时，
// 「用户主动 @Cuu / 协同发消息」这条会真打 LLM 的路径应当立刻拿到「配置缺失」的清晰信号（而不是拿空 key
// 去打上游、收 401 再被泛化成 500）。文案给部署指引，方便运维定位。
const AI_PROVIDER_NOT_CONFIGURED_MESSAGE =
  "Cuu 暂时不可用：这个部署还没有配置 LLM 服务的密钥（LLM_API_KEY）。请联系管理员完成配置后再试。";

function toConversationTurnServiceError(error: unknown): unknown {
  if (error instanceof ProviderNotConfiguredError) {
    return new ConversationTurnServiceError(503, "ai_provider_not_configured", AI_PROVIDER_NOT_CONFIGURED_MESSAGE);
  }
  return error;
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

// 最小 LLM 客户端形状——流式接口 + R13 批4c 起支持工具调用（tools 入参、content 块里的 tool_use）。
// 真实 wiring 用 ProviderRegistry.get(...).messages.stream(...)，其返回值结构性兼容这个类型（见
// packages/agent/src/providers/measured-client.ts 的 messages.stream；tools/tool_use/tool_result
// 的线上协议见 packages/agent/src/providers/anthropic-compatible.ts 的 requestBody/finalizeBlock）。
export type TurnLlmStreamEvent = { type: string; data?: unknown };
// content 块的判别字段仍是 type；text 块带 text，tool_use 块带 id/name/input（input 在被 max_tokens
// 截断时可能是原始未解析字符串而不是对象——parseTurnToolCall 的 zod 校验会温和地把它判成参数不对，
// 见 packages/agent/src/turns/tools.ts 顶部注释）。
export type TurnLlmContentBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown };
// R16-W1（工作台聊天流升级）：结算时读用量做「N tokens」元信息——provider 的 getFinalMessage() 已经带
// usage（见 packages/agent/src/providers/anthropic-compatible.ts 的 finalMessage()：{inputTokens,
// outputTokens}）。声明成 optional 是因为既有测试桩/非 anthropic-compat 路径可能不带——拿不到就不写
// usage_tokens（铁律：没有真数据不渲染），不编造。
export type TurnLlmFinalMessage = {
  content: TurnLlmContentBlock[];
  usage?: { inputTokens?: number; outputTokens?: number };
};
export type TurnLlmStream = AsyncIterable<TurnLlmStreamEvent> & {
  getFinalMessage: () => Promise<TurnLlmFinalMessage>;
};
// messages 里一条消息的 content 可以是纯字符串（普通对话轮次，批4a 原有形态）或者一个内容块数组
// （工具环里的 assistant tool_use 回放 / user tool_result 回填）——两种形态在 provider 线上协议里都
// 合法，宽化这个联合类型不影响批4a 既有调用方（那些调用点只产出字符串 content）。
export type TurnLlmMessageContent = string | Array<Record<string, unknown>>;
export type TurnLlmClient = {
  // R16-W1（工作台聊天流升级）：实际路由到的模型 id——ProviderRegistry.get(...) 返回的 MeasuredLlmClient
  // 上就有这个只读字段（= route.model.model，见 packages/agent/src/providers/measured-client.ts）。声明成
  // optional 是为了不逼既有测试桩都补一个 model；拿不到（空/缺）就不渲染模型 pill，历史消息同理，不编造。
  model?: string;
  messages: {
    stream: (input: {
      maxTokens: number;
      source: "agent_step";
      system: string;
      messages: Array<{ role: "user" | "assistant"; content: TurnLlmMessageContent }>;
      tools?: unknown[];
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

// R13 批 C1（会话上下文压缩）：压缩完成后往会话里落一条 system_event(context_compacted) 透明提示的
// 注入点——直接是一个函数而不是整个仓库的 Pick（同 `nicknames`/`client` 的风格），省略时静默跳过这条
// 播报（见下方 ConversationTurnServiceDeps.postContextCompactionSystemMessage 的注释）。
export type ConversationTurnSystemEventPoster = (input: {
  workspaceId: string;
  conversationId: string;
  content: Record<string, unknown>;
  at: Date;
}) => Promise<unknown>;

export type ConversationTurnServiceDeps = {
  // R23 F-07：新增 listVisibleForProject（`#会话标题` 解析用的候选清单）与 listMessagesBefore（被引会话
  // 的最近一页消息）；两者的 viewerUserId 都是发起人本人，权限收口在仓库层。不改动其它既有方法的用法。
  conversations: Pick<
    ConversationRepository,
    | "findVisibleAccessRecord"
    | "listMessagesAfter"
    | "listMessagesBefore"
    | "createCuuMessage"
    | "updateContextSummary"
    | "listVisibleForProject"
  >;
  aiSettings: Pick<AiSettingsRepository, "findUserProfileAccessRecord">;
  userMemories: Pick<UserMemoryRepository, "listForUser" | "touch">;
  teamSkills: Pick<TeamSkillRepository, "listActive">;
  nicknames: ConversationNicknameLookup;
  client: ConversationTurnClientProvider;
  policyStore: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
  // R13 批4c：drive_search/send_file_card 工具背后的真实网盘服务——直接复用既有
  // DrivePageService.page()/file()（同一套 canViewProjectDrive 权限门槛，同一套已经在
  // apps/api/src/services/conversations.ts 的文件卡路径里验证过的错误映射）。设计稿原本建议一个更窄
  // 的专用检索包装（新文件 drive-search-tool.ts），但本批范围围栏没有把那个新文件纳入允许清单——
  // 复用现成的、已鉴权的 page()/file() 更安全，代价是 page() 会多组装一些本批用不到的字段（文件夹树/
  // 面包屑/评论），这是范围围栏驱动的取舍，不是遗漏，见批次汇报。
  drive: Pick<DrivePageService, "page" | "file">;
  // R13 批4c：create_work_item 工具直接复用既有 WorkItemService.createWorkItem——不重新实现一遍工单
  // 创建/项目解析/权限校验。
  workItems: Pick<WorkItemService, "createWorkItem">;
  settings?: Settings;
  bus?: Pick<PushBus, "publish">;
  logger?: Pick<StructuredLogger, "warn">;
  now?: () => Date;
  id?: () => string;
  historyWindowSize?: number;
  maxResponseTokens?: number;
  turnTimeoutMs?: number;
  // R13 批 G1（小群）：4c 并行批的轻量回话判定器注入点——只在"这一轮触发消息没有 @Cuu"时才会被
  // 问到（见 createTurn 里的调用点与 mentionsCuu 顶部注释）。省略时退回
  // defaultConversationTurnRespondDecider（保守永远 true，维持存量行为零回归）。
  respondDecider?: ConversationTurnRespondDecider;
  // R13 批 C1：摘要 LLM 调用的独立 client provider——任务类 "context_compact"，与主回应的 "assistant"
  // 分开路由/成本归因（见 packages/agent/src/providers/types.ts 的 taskClasses 注释）。省略时退回主
  // `client`（同一个 provider，只是任务类归因退化成 "assistant"）——不是长期正确状态，但保证这个可选
  // 依赖缺失时压缩仍能工作而不是直接抛错，与「摘要失败必须 fail-open」的精神一致。
  compactionClient?: ConversationTurnClientProvider;
  // R13 批 C1：压缩完成后往会话里落一条 system_event(context_compacted) 透明提示。省略时静默跳过这条
  // 播报（同 apps/api/src/workers/agent-runner.ts 的 postDeliverableSystemMessage 对同一类依赖的既有
  // 取舍："没接依赖/发布失败，都不影响...只是静默跳过"），不影响摘要本身已经落库的结果。
  postContextCompactionSystemMessage?: ConversationTurnSystemEventPoster;
  // R15 批 A（A5 消息通知）：Cuu 消息（text/file_card）落库 + 广播后，给其他参与者 fire-and-forget 扇出
  // conversation.message 通知（正在看该会话的人被抑制，见 conversation-message-notify.ts）。省略时（既有
  // 测试的调用点）不扇出，行为零回归。senderUserId=null（Cuu）+ senderLabel 在默认绑定里填好。
  notifyCuuMessage?: (input: {
    conversationId: string;
    projectId: string;
    conversationTitle: string;
    messageKind: string;
    previewText: string;
  }) => void;
  // R15 批 C Phase 4（Cuu 对话轮次迁 loop2）：轮次循环实现开关。off（默认）=现状内联轮次循环，逐字节零行为
  // 变化；on=走 loop2（pi 引擎）+ steering/follow-up 队列。省略时从 deps.settings（或运行时 settings）读取
  // conversationTurns.loop2Mode，缺省 off。测试通过这个字段直接注入 "on" 走新路径，不依赖进程 env。
  loop2Mode?: ConversationTurnLoop2Mode;
  // steering 队列深度上限（同会话已有一轮在跑时新到请求的排队上限）。省略时读 settings，缺省 3。
  queueMaxDepth?: number;
};

// R15 批 C Phase 4：对话轮次没有 shadow-assert 档——面向用户实时流式，双跑会双倍打 LLM 且延迟翻倍。
export type ConversationTurnLoop2Mode = "off" | "on";

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
  // R14 批 CHAT（下游墓碑过滤）：删除的消息一律不喂给 AI——turn 历史（buildHistory）与 C1 压缩摘要
  // （tryCompactConversationContext 也走 buildHistory）都靠这条短路跳过墓碑。编辑过的消息用当前文本
  // （不回溯派生物），故这里不特判 editedAt。
  if (row.deletedAt) {
    return null;
  }
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

// ── R13 批 G1（小群）：回话判定接缝 ──────────────────────────────────────────────────
//
// 「被 @ 必回」是这里唯一的具体实现——脆弱的文本子串匹配（昵称可自定义、用户可能提到"cuu"这个词但
// 不是想 @ 她），已知局限如实记录，不追求完美，只要求带词边界（不能是任意子串出现就命中，例如
// "reticuum" 不算提及）。真正的"该不该在没人 @ 时主动接话"判定（规则前置 + 小模型、限频合并、
// 预算意识）归 4c 并行批建设——ConversationTurnRespondDecider 就是留给它的注入点：createTurn 只在
// 「没有被 @」时才会去问这个函数，一旦问了它并且它说不该回，就整轮 409（见下方
// conversation_turn_not_warranted）；4c 落地前的默认实现（defaultConversationTurnRespondDecider）
// 保守地永远返回 true——维持"今天所有协同会话，不论 1:1 还是小群，只要客户端发起 turn 请求就一定有
// 回应"这条存量行为，不在判定器真正建成前就静默丢弃请求（那样用户会以为 Cuu 没看到消息，且当前
// 契约形状也没有"这轮特意不回"的诚实表达方式）。
export const CUU_MENTION_DISPLAY_NAME = "Cuu";

const WORD_CHAR_PATTERN = /[\p{L}\p{N}_]/u;

export function mentionsCuu(text: string, displayName: string = CUU_MENTION_DISPLAY_NAME): boolean {
  if (text.length === 0 || displayName.length === 0) {
    return false;
  }
  const haystack = text.toLowerCase();
  const needle = displayName.toLowerCase();
  let fromIndex = 0;
  while (fromIndex <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, fromIndex);
    if (index === -1) {
      return false;
    }
    const before = index > 0 ? haystack[index - 1] : undefined;
    const afterIndex = index + needle.length;
    const after = afterIndex < haystack.length ? haystack[afterIndex] : undefined;
    const beforeIsWord = before !== undefined && WORD_CHAR_PATTERN.test(before);
    const afterIsWord = after !== undefined && WORD_CHAR_PATTERN.test(after);
    if (!beforeIsWord && !afterIsWord) {
      return true;
    }
    fromIndex = index + 1;
  }
  return false;
}

export type ConversationTurnRespondDecisionInput = {
  // conversation_participants 的真实行数（含创建者）——1（只有创建者，即"1:1 与 Cuu 单聊"）与
  // >1（小群）是判定器唯一需要关心的会话规模维度，来自 ConversationAccessRecord.participantCount。
  participantCount: number;
  triggerMessageText: string;
};
export type ConversationTurnRespondDecider = (
  input: ConversationTurnRespondDecisionInput
) => boolean | Promise<boolean>;

function defaultConversationTurnRespondDecider(): boolean {
  return true;
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

// ── R13 批4c：受限工具环的支持函数 ───────────────────────────────────────────────────

type TurnToolUseBlock = { id: string; name: string; input: unknown };

function extractToolUseBlocks(final: TurnLlmFinalMessage): TurnToolUseBlock[] {
  return final.content
    .filter(
      (block): block is TurnLlmContentBlock & { id: string; name: string } =>
        block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string"
    )
    .map((block) => ({ id: block.id, name: block.name, input: block.input }));
}

// 澄清位——不落任何旁路状态字段，从消息流位置推导（与"turns 本来就无状态，每次从 DB 重建"的既有架构
// 一致）：历史窗口里紧邻在这一轮触发消息之前的一条，如果是 Cuu 发的、kind='text'、且带
// is_clarifying_question=true 标记，就认定这一轮是对那个问题的直接回答。rows 按 seq 升序，anchor 是
// 触发这轮 turn 的用户消息（在 createTurn 里已经定位过）。
function findPendingClarification(
  rows: ConversationMessageRow[],
  anchorId: string
): { question: string } | undefined {
  const anchorIndex = rows.findIndex((row) => row.id === anchorId);
  if (anchorIndex <= 0) {
    return undefined;
  }
  const prev = rows[anchorIndex - 1];
  // R14 批 CHAT（下游墓碑过滤）：删除的前一条消息不作为「用户在回答 Cuu 的澄清追问」的上下文线索。
  // （今天 Cuu 消息不可被删——只有本人 user 消息可删——这条守卫是防御性/前瞻性的，成本为零。）
  if (!prev || prev.deletedAt || prev.senderType !== "cuu" || prev.kind !== "text") {
    return undefined;
  }
  const content = prev.contentJson as Record<string, unknown>;
  if (content["is_clarifying_question"] !== true || typeof content["text"] !== "string") {
    return undefined;
  }
  return { question: content["text"] };
}

// 单个工具执行结果——content 是回填给模型的 tool_result 文本（成功确认或者温和的错误说明），
// auditSummary 是落进 tool_note 透明日志的一句话摘要（不含原始检索结果——drive_search 的命中列表
// 本身不落库，只作为模型下一步推理的输入）。isError 为 true 时 tool_result 块带 is_error:true。
type TurnToolExecutionResult = { content: string; auditSummary: string; isError: boolean };

type TurnToolExecutionContext = {
  actor: AuthActor;
  workspaceId: string;
  projectId: string;
};

async function executeDriveSearchTool(
  deps: ConversationTurnServiceDeps,
  ctx: TurnToolExecutionContext,
  input: DriveSearchToolInput,
  logger: Pick<StructuredLogger, "warn">
): Promise<TurnToolExecutionResult> {
  try {
    const page = await deps.drive.page({
      actor: ctx.actor,
      projectId: ctx.projectId,
      nameQuery: input.query,
      locale: defaultWorkHubLocale
    });
    const matches = page.items
      .filter((item) => item.kind === "file")
      .slice(0, 5)
      .map((item) => ({
        item_id: item.id,
        filename: item.name,
        mime: item.current_version?.mime,
        updated_at: item.updated_at
      }));
    if (matches.length === 0) {
      return { content: "没有找到匹配的文件。", auditSummary: `检索"${input.query}"，没有命中`, isError: false };
    }
    return {
      content: JSON.stringify({ matches }),
      auditSummary: `检索"${input.query}"，命中 ${matches.length} 条`,
      isError: false
    };
  } catch (error) {
    logger.warn?.("conversation_turn_tool_drive_search_failed", { projectId: ctx.projectId, error });
    return { content: "检索失败，请稍后再试或换个说法，不要编造结果。", auditSummary: `检索"${input.query}"失败`, isError: true };
  }
}

async function executeSendFileCardTool(
  deps: ConversationTurnServiceDeps,
  ctx: TurnToolExecutionContext,
  input: SendFileCardToolInput,
  logger: Pick<StructuredLogger, "warn">
): Promise<TurnToolExecutionResult & { fileCard?: { driveItemId: string; snapshotName: string } }> {
  try {
    const file = await deps.drive.file({ actor: ctx.actor, projectId: ctx.projectId, itemId: input.drive_item_id });
    if (file.projectId !== ctx.projectId || file.itemId !== input.drive_item_id) {
      throw new Error("Drive file authorization returned mismatched project or item identity");
    }
    return {
      content: `已经把文件"${file.filename}"发给对方了。`,
      auditSummary: `发送文件卡：${file.filename}`,
      isError: false,
      fileCard: { driveItemId: file.itemId, snapshotName: file.filename }
    };
  } catch (error) {
    if (error instanceof DrivePageServiceError && (error.status === 403 || error.status === 404)) {
      return {
        content: "没有找到这个文件，或者没有权限查看——如实告诉对方找不到，不要编造文件。",
        auditSummary: "发送文件卡失败：文件不可见",
        isError: true
      };
    }
    logger.warn?.("conversation_turn_tool_send_file_card_failed", { itemId: input.drive_item_id, error });
    throw error;
  }
}

async function executeCreateWorkItemTool(
  deps: ConversationTurnServiceDeps,
  ctx: TurnToolExecutionContext,
  input: CreateWorkItemToolInput
): Promise<TurnToolExecutionResult> {
  const rawDescription = input.clarification_answer
    ? `${input.summary}\n\n补充说明：${input.clarification_answer}`
    : input.summary;
  try {
    const detail = await deps.workItems.createWorkItem({
      payload: { project_id: ctx.projectId, title: input.title, raw_description: rawDescription },
      actor: ctx.actor,
      locale: defaultWorkHubLocale
    });
    return {
      content: `已经建好工单了：《${detail.workitem.title}》。`,
      auditSummary: `建工单：${detail.workitem.title}`,
      isError: false
    };
  } catch (error) {
    if (error instanceof WorkItemServiceError) {
      return {
        content: `没能建成工单：${error.message}——如实告诉对方，不要假装已经建好。`,
        auditSummary: "建工单失败",
        isError: true
      };
    }
    throw error;
  }
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

// ── R13 批 C1（会话上下文压缩）─────────────────────────────────────────────────────────
//
// WorkHub 的历史窗口本来就是硬截断的 DEFAULT_HISTORY_WINDOW 条，从不会真的撑爆 context window——真正
// 的问题是"超出窗口之外的内容被静默永久遗忘，用户毫无感知"。这个函数在窗口起点越过阈值时，把这次新
// 滑出窗口的一批原始消息压缩成一段滚动摘要（与旧摘要合并更新，不是从头整段重新摘要），落库并追加一条
// system_event(context_compacted) 透明提示。
//
// fail-open 是这个函数唯一的契约：调用方（createTurn）永远不会因为这个函数失败而让整轮 turn 失败——
// 任何一步出错（预算耗尽、DB 读写失败、LLM 调用失败/超时、摘要产出空文本）都在这里被吞掉，返回
// undefined，调用方据此原样沿用旧摘要（或没有摘要），下次 createTurn 再试。
async function tryCompactConversationContext(
  deps: ConversationTurnServiceDeps,
  logger: Pick<StructuredLogger, "warn">,
  input: {
    workspaceId: string;
    viewerUserId: string;
    conversationId: string;
    previousSummaryMd: string | null;
    // 已经覆盖到的 seq（含）——新一批要从这之后开始取。
    fromSeqExclusive: number;
    // 这一轮的新窗口起点（access.conversation.nextSeq - 1 - windowSize）——新滑出窗口就是
    // (fromSeqExclusive, toSeqExclusive] 这一段。
    toSeqExclusive: number;
    at: Date;
  }
): Promise<{ summaryMd: string; throughSeq: number } | undefined> {
  const gap = input.toSeqExclusive - input.fromSeqExclusive;
  if (gap <= 0) {
    return undefined;
  }
  try {
    // 摘要调用本身也要过预算软闸——额外的 LLM 调用不能变成账外开销（同主 turn 的 checkTurnBudget
    // 复用同一个函数）。预算耗尬时直接放弃这次压缩尝试，不读消息、不调模型，下次 createTurn 再判断。
    const budgetOk = await checkTurnBudget(deps, input.workspaceId, input.at);
    if (!budgetOk) {
      return undefined;
    }

    const batchLimit = Math.min(gap, CONTEXT_SUMMARY_MAX_BATCH_MESSAGES);
    const page = await deps.conversations.listMessagesAfter({
      workspaceId: input.workspaceId,
      viewerUserId: input.viewerUserId,
      conversationId: input.conversationId,
      afterSeq: input.fromSeqExclusive,
      limit: batchLimit
    });
    if (!page || page.rows.length === 0) {
      return undefined;
    }

    const senderIds = [
      ...new Set(page.rows.map((row) => row.senderUserId).filter((value): value is string => Boolean(value)))
    ];
    const nicknames = await deps.nicknames(senderIds);
    const history = buildHistory(page.rows, nicknames);
    if (history.length === 0) {
      // 这一批全是不进摘要的消息种类（比如清一色 action_card）——没有可摘要的文本。不推进覆盖游标；
      // 随着后续 turn 不断到来，gap 只会越滑越大，下一次会用更大的 batchLimit 重新尝试，几乎必然会
      // 带上一些真正的文本消息（同一批 100 条全是非文本消息的概率极低），不需要为这个边界特殊处理。
      return undefined;
    }

    const prompt = buildContextCompactionPrompt({
      previousSummaryMd: input.previousSummaryMd,
      newMessages: history
    });
    const clientProvider = deps.compactionClient ?? deps.client;
    const client = await clientProvider({
      actorId: input.viewerUserId,
      userId: input.viewerUserId,
      workspaceId: input.workspaceId
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONTEXT_SUMMARY_TIMEOUT_MS);
    let summaryText: string;
    try {
      const stream = await client.messages.stream({
        maxTokens: CONTEXT_SUMMARY_MAX_RESPONSE_TOKENS,
        source: "agent_step",
        system: prompt.system,
        messages: prompt.messages,
        signal: controller.signal
      });
      // 压缩摘要不面向任何用户展示——不需要迭代事件流产出 delta，直接要最终文本即可
      // （AnthropicCompatibleStream.getFinalMessage() 内部自己驱动消费，不依赖调用方先迭代一遍）。
      const final = await stream.getFinalMessage();
      summaryText = extractFinalText(final).trim();
    } finally {
      clearTimeout(timer);
    }

    if (summaryText.length === 0) {
      return undefined;
    }

    const throughSeq = page.rows[page.rows.length - 1]!.seq;
    await deps.conversations.updateContextSummary({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      summaryMd: summaryText,
      throughSeq
    });

    const poster = deps.postContextCompactionSystemMessage;
    if (poster) {
      try {
        await poster({
          workspaceId: input.workspaceId,
          conversationId: input.conversationId,
          content: {
            event: "context_compacted",
            compacted_message_count: page.rows.length,
            summary_excerpt: summaryText.slice(0, 200)
          },
          at: input.at
        });
      } catch (error) {
        // 透明提示是锦上添花——同 tryPersistToolNote 的既有取舍，写失败不影响摘要本身已经落库的结果。
        logger.warn?.("conversation_turn_context_compaction_system_message_failed", {
          conversationId: input.conversationId,
          error
        });
      }
    }

    return { summaryMd: summaryText, throughSeq };
  } catch (error) {
    logger.warn?.("conversation_turn_context_compaction_failed", { conversationId: input.conversationId, error });
    return undefined;
  }
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

// ── R15 批 C Phase 4：轮次运行时三件套 + 预备好的一轮上下文 ─────────────────────────────
//
// prepareTurnContext 把 createTurn 里"进循环之前"的全部装配（访问/模式/预算/历史/记忆/澄清位/落库
// 广播闭包）抽成一个纯函数：off（内联轮次循环）与 on（loop2）两条路径都调它，保证两条路径看到的是同一
// 套预处理，不各写一份逻辑漂移。off 路径的行为逐字节不变——它拿到的 prepared 里每个字段都和过去内联算出
// 来的一样，只是搬了个位置。

type TurnRuntime = {
  deps: ConversationTurnServiceDeps;
  now: () => Date;
  id: () => string;
  logger: Pick<StructuredLogger, "warn">;
};

type PersistCuuMessageInput =
  | {
      kind: "text";
      contentJson: {
        text: string;
        memory_citations?: TurnMemoryCitation[];
        is_clarifying_question?: boolean;
        clarify_options?: string[];
        clarify_placeholder?: string;
        // R16-W1（工作台聊天流升级）：展示元信息（模型 pill / 尾部「Ns · N tokens」）——additive optional。
        // model 由 persistAndBroadcastCuuMessage 统一补（所有 Cuu 文字回应都带），usage_tokens/elapsed_ms
        // 由具体轮次循环在落定文字回应时按真实结算值填（拿不到就不填，不编造）。
        model?: string;
        usage_tokens?: number;
        elapsed_ms?: number;
      };
    }
  | { kind: "file_card"; contentJson: { drive_item_id: string; snapshot_name: string } }
  | { kind: "tool_note"; contentJson: Record<string, unknown> };

type PreparedTurn = {
  human: HumanTurnActor;
  turnId: string;
  toolCtx: TurnToolExecutionContext;
  client: TurnLlmClient;
  historyMessages: Array<{ role: "user" | "assistant"; content: TurnLlmMessageContent }>;
  pendingClarification: { question: string } | undefined;
  memorySection: ReturnType<typeof buildTurnMemorySection>;
  // R16 批 W4a：预先算好的项目自定义指令段（""＝不注入——未配置或所属项目是 DM 容器）,两条 system
  // 拼接路径（runLegacyTurnLoop / runConversationTurnSegment）共用同一份,不重复判定 DM 容器围栏。
  projectInstructionsSection: string;
  // R23 F-07：这一轮触发消息里 `#会话` / `/技能` 解析出来的附加材料段（""＝这条消息没引用任何东西，
  // 或引用的名字解析不上）。同 projectInstructionsSection 的取舍：两条 system 拼接路径共用同一份。
  referenceSection: string;
  contextSummaryMd: string | null;
  triggerText: string;
  persistAndBroadcastCuuMessage: (messageInput: PersistCuuMessageInput) => Promise<ConversationTurnResultVM["message"]>;
  tryPersistToolNote: (contentJson: Record<string, unknown>) => Promise<void>;
};

// R23 F-07（`#会话引用` / `/技能唤起`）：把触发消息正文里点名的会话/技能变成一段 system prompt 附加材料。
//
// 权限：被引会话的候选清单与消息都用**发起人本人**的 viewerUserId 去查（listVisibleForProject /
// listMessagesAfter 都是仓库层带 viewer 门控的读，看不见就分别拿不到候选/拿到 null）——引用绝不能变成
// 「拿别人会话 id 让 Cuu 念给我听」的旁路。
//
// 成本：不带 `#` 的消息完全不查会话清单（mayReferenceConversation 便宜预判）；技能清单本来这一轮就已经
// 查过（listActive），唤起解析不额外多查。被引会话每条一次消息分页读，条数由 MAX_TURN_CONVERSATION_REFS
// 封顶（2 条），每条只取最近 TURN_CONVERSATION_REF_MESSAGE_LIMIT 条。
//
// 失败一律 fail-open：任何一条引用查失败只记一条 warn 并跳过它，不让「引用拉不到」把整轮回应炸掉——
// 用户要的是回应，附加材料是加分项不是前置条件。
async function buildTurnReferenceSection(
  deps: ConversationTurnServiceDeps,
  logger: Pick<StructuredLogger, "warn">,
  input: {
    triggerText: string;
    workspaceId: string;
    viewerUserId: string;
    projectId: string;
    conversationId: string;
    teamSkillRows: readonly TeamSkillRow[];
  }
): Promise<string> {
  const parts: string[] = [];

  const skills = mayInvokeSkill(input.triggerText)
    ? resolveSkillRefs(
        input.triggerText,
        input.teamSkillRows.map((row) => ({
          skillKey: row.skillKey,
          name: row.name,
          whenToUse: row.whenToUse,
          contentMd: row.contentMd
        }))
      )
    : [];
  if (skills.length > 0) {
    parts.push(
      buildTurnInvokedSkillSection(
        skills.map((skill) => ({ name: skill.name, whenToUse: skill.whenToUse, contentMd: skill.contentMd }))
      )
    );
  }

  if (mayReferenceConversation(input.triggerText)) {
    let candidates: Array<{ id: string; title: string }> = [];
    try {
      const visible = await deps.conversations.listVisibleForProject({
        workspaceId: input.workspaceId,
        viewerUserId: input.viewerUserId,
        projectId: input.projectId,
        limit: TURN_CONVERSATION_REF_CANDIDATE_LIMIT
      });
      candidates = (visible?.rows ?? []).map((row) => ({ id: row.id, title: row.title }));
    } catch (error) {
      logger.warn("conversation_turn_reference_candidates_failed", { conversationId: input.conversationId, error });
    }
    const refs = resolveConversationRefs(input.triggerText, candidates, {
      excludeConversationId: input.conversationId,
      max: MAX_TURN_CONVERSATION_REFS
    });
    const loaded: Array<{ title: string; messages: Array<{ senderLabel: string; text: string }> }> = [];
    for (const ref of refs) {
      try {
        // 「最近 N 条」＝反向游标的第一页（beforeSeq 传契约允许的上界＝「早于一切已存在的 seq」，同
        // 桌面端首屏拉最新一页的既有用法），仓库层已按 seq 升序回。拿不到（对本人不可见/已删）就静默
        // 跳过这条引用——fail-closed 的可见性判定在仓库层，这里不做二次判断。
        const refPage = await deps.conversations.listMessagesBefore({
          workspaceId: input.workspaceId,
          viewerUserId: input.viewerUserId,
          conversationId: ref.id,
          beforeSeq: Number.MAX_SAFE_INTEGER,
          limit: TURN_CONVERSATION_REF_MESSAGE_LIMIT
        });
        if (!refPage) {
          continue;
        }
        const rows = refPage.rows;
        const senderIds = [
          ...new Set(rows.map((row) => row.senderUserId).filter((value): value is string => Boolean(value)))
        ];
        const refNicknames = senderIds.length > 0 ? await deps.nicknames(senderIds) : new Map<string, string>();
        const messages = buildHistory(rows, refNicknames).map((row) => ({
          senderLabel: row.senderLabel,
          text: row.text
        }));
        if (messages.length > 0) {
          loaded.push({ title: ref.title, messages });
        }
      } catch (error) {
        logger.warn("conversation_turn_reference_fetch_failed", {
          conversationId: input.conversationId,
          referencedConversationId: ref.id,
          error
        });
      }
    }
    if (loaded.length > 0) {
      parts.push(buildTurnConversationRefSection(loaded));
    }
  }

  return parts.filter((part) => part.length > 0).join("\n\n");
}

async function prepareTurnContext(
  runtime: TurnRuntime,
  input: { actor: AuthActor; conversationId: string; payload: CreateConversationTurnRequest }
): Promise<PreparedTurn> {
  const { deps, now, id, logger } = runtime;
  const human = requireHumanActor(input.actor);

  const access = await deps.conversations.findVisibleAccessRecord({
    workspaceId: human.workspaceId,
    viewerUserId: human.userId,
    conversationId: input.conversationId
  });
  if (!access) {
    throw new ConversationTurnServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  // R13 终验修复（个人空间单聊必回）：个人空间的默认线程就是该项目的 main 会话（S3 设计），
  // 它是纯 1:1 单聊——放行 turn。团队项目的 main 仍归静默观察者，恒 409 不变。
  const personalSingleChat = access.conversation.kind === "main" && access.projectIsPersonal === true;
  if (access.conversation.kind !== "collab" && !personalSingleChat) {
    throw new ConversationTurnServiceError(
      409,
      "conversation_turn_not_collab",
      "主区群聊由静默观察者处理，不支持单独发起协同回应。"
    );
  }
  // R13 批 G1：cuu_enabled 硬闸——用户已拍板"强静默不可绕过"，必须排在 mode/回话判定之前，
  // 且不接受任何形式的绕过（包括本轮触发消息里 @Cuu）。
  if (access.conversation.cuuEnabled === false) {
    throw new ConversationTurnServiceError(409, "conversation_turn_cuu_disabled", "这个会话已经关掉了 Cuu，不会有回应。");
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

  // R13 批 C1（会话上下文压缩）：触发判定放在拉取历史窗口之前、cuu_enabled 闸与模式闸之后。
  let contextSummaryMd = access.conversation.contextSummaryMd ?? null;
  const contextSummaryThroughSeq = access.conversation.contextSummaryThroughSeq ?? 0;
  if (afterSeq > contextSummaryThroughSeq + CONTEXT_SUMMARY_REFRESH_BATCH) {
    const compacted = await tryCompactConversationContext(deps, logger, {
      workspaceId: human.workspaceId,
      viewerUserId: human.userId,
      conversationId: input.conversationId,
      previousSummaryMd: contextSummaryMd,
      fromSeqExclusive: contextSummaryThroughSeq,
      toSeqExclusive: afterSeq,
      at: now()
    });
    if (compacted) {
      contextSummaryMd = compacted.summaryMd;
    }
  }

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
  if (!anchor || anchor.senderType !== "user" || anchor.senderUserId?.toLowerCase() !== human.userId.toLowerCase()) {
    throw new ConversationTurnServiceError(404, "conversation_turn_message_not_found", "没有找到这条待回应的消息。");
  }

  // R13 批 G1：回话判定——被 @Cuu 必回。没被 @ 时才去问判定器。
  const triggerText = historyDisplayText(anchor) ?? "";
  if (!personalSingleChat && !mentionsCuu(triggerText)) {
    const decider = deps.respondDecider ?? defaultConversationTurnRespondDecider;
    const shouldRespond = await decider({
      participantCount: access.participantCount,
      triggerMessageText: triggerText
    });
    if (!shouldRespond) {
      throw new ConversationTurnServiceError(409, "conversation_turn_not_warranted", "这轮消息看起来还不需要 Cuu 回应。");
    }
  }

  const budgetOk = await checkTurnBudget(deps, human.workspaceId, now());
  if (!budgetOk) {
    throw new ConversationTurnServiceError(429, "conversation_turn_budget_exhausted", "这个工作区今天的 AI 预算已经用完了。");
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
  // R16 批 W4a（项目级自定义指令）：DM 容器项目的会话永不注入（硬围栏，与人自己的地盘个人空间不同——
  // 个人空间项目走下面同一条 buildTurnProjectInstructionsSection，正常按 access.projectInstructionsMd
  // 是否配置来注入，不做特殊豁免）。
  const projectInstructionsSection = access.projectIsDmContainer
    ? ""
    : buildTurnProjectInstructionsSection(access.projectInstructionsMd);
  // R23 F-07：这条触发消息里点名的 `#会话标题` / `/技能名`——解析成真实会话/技能后，把被引会话的近期
  // 讨论与被唤起技能的正文一起拼进这一轮 system prompt。解析规则与桌面端输入框的触发符解析同源，
  // 见 ./conversation-turn-references.ts 顶部注释。
  const referenceSection = await buildTurnReferenceSection(deps, logger, {
    triggerText,
    workspaceId: human.workspaceId,
    viewerUserId: human.userId,
    projectId: access.conversation.projectId,
    conversationId: input.conversationId,
    teamSkillRows
  });
  if (userMemoryRows.length > 0) {
    try {
      await deps.userMemories.touch(userMemoryRows.map((row) => row.id), now(), { workspaceId: human.workspaceId });
    } catch (error) {
      logger.warn("conversation_turn_memory_touch_failed", { conversationId: input.conversationId, error });
    }
  }

  const pendingClarification = findPendingClarification(page.rows, anchor.id);
  const toolCtx: TurnToolExecutionContext = {
    actor: human.actor,
    workspaceId: human.workspaceId,
    projectId: access.conversation.projectId
  };
  const conversationTitle = access.conversation.title;
  const turnId = id();

  let client: TurnLlmClient;
  try {
    client = await deps.client({ actorId: human.userId, userId: human.userId, workspaceId: human.workspaceId });
  } catch (error) {
    throw toConversationTurnServiceError(error);
  }

  const historyMessages: Array<{ role: "user" | "assistant"; content: TurnLlmMessageContent }> = [...buildTurnMessages(history)];

  // R16-W1（工作台聊天流升级）：这一轮实际路由到的模型 id——统一在落库前补进所有 Cuu 文字回应的 content，
  // 让两条轮次路径（off 内联循环 / on loop2 段）都自动带上模型 pill 数据，不用在各自的落定点分别接线
  // （on 路径的落定点属于「不碰 loop2」范围，集中在这里补是更克制的做法）。拿不到就不补（历史/测试桩），
  // 读侧据此不渲 pill。
  const routedModelId =
    typeof (client as { model?: unknown }).model === "string" ? (client as { model: string }).model.trim() : "";

  async function persistAndBroadcastCuuMessage(messageInput: PersistCuuMessageInput): Promise<ConversationTurnResultVM["message"]> {
    const withModel: PersistCuuMessageInput =
      messageInput.kind === "text" && routedModelId && messageInput.contentJson.model === undefined
        ? { kind: "text", contentJson: { ...messageInput.contentJson, model: routedModelId } }
        : messageInput;
    const created = await deps.conversations.createCuuMessage({
      workspaceId: human.workspaceId,
      conversationId: input.conversationId,
      at: now(),
      ...withModel
    });
    const vm = parseOutputContract(conversationMessageVmSchema, messageToVm(created), "conversation-turns.message");
    try {
      const conversationTopic = topics.conversation(input.conversationId).topic;
      const previewText = vm.kind === "text" ? vm.content.text : vm.kind === "file_card" ? vm.content.snapshot_name : vm.kind;
      const createdEvent = parseOutputContract(
        conversationMessageCreatedEventSchema,
        makeWorkHubEvent({
          type: eventTypes.conversationMessageCreated,
          topic: conversationTopic,
          ts: now(),
          actor: { actor_kind: "ai", label: "Cuu" },
          project_id: toolCtx.projectId,
          preview_text: previewText.slice(0, 200),
          data: vm
        }),
        "conversation-turns.event.created"
      );
      await deps.bus?.publish(conversationTopic, eventTypes.conversationMessageCreated, createdEvent);
    } catch (error) {
      logger.warn("conversation_turn_created_publish_failed", { conversationId: input.conversationId, turnId, error });
    }
    deps.notifyCuuMessage?.({
      conversationId: input.conversationId,
      projectId: toolCtx.projectId,
      conversationTitle,
      messageKind: vm.kind,
      previewText: vm.kind === "text" ? vm.content.text : vm.kind === "file_card" ? vm.content.snapshot_name : vm.kind
    });
    return vm;
  }

  async function tryPersistToolNote(contentJson: Record<string, unknown>) {
    try {
      await persistAndBroadcastCuuMessage({ kind: "tool_note", contentJson });
    } catch (error) {
      logger.warn("conversation_turn_tool_note_persist_failed", { conversationId: input.conversationId, turnId, error });
    }
  }

  return {
    human,
    turnId,
    toolCtx,
    client,
    historyMessages,
    pendingClarification,
    memorySection,
    projectInstructionsSection,
    referenceSection,
    contextSummaryMd,
    triggerText,
    persistAndBroadcastCuuMessage,
    tryPersistToolNote
  };
}

// ── off 路径：内联轮次循环（从原 createTurn 原样搬来，行为逐字节不变） ───────────────────────

async function runLegacyTurnLoop(
  runtime: TurnRuntime,
  input: { conversationId: string },
  prepared: PreparedTurn
): Promise<ConversationTurnResultVM> {
  const { deps, now, logger } = runtime;
  const { turnId, toolCtx, memorySection, pendingClarification, projectInstructionsSection, contextSummaryMd, client } = prepared;
  const referenceSection = prepared.referenceSection;
  const persistAndBroadcastCuuMessage = prepared.persistAndBroadcastCuuMessage;
  const tryPersistToolNote = prepared.tryPersistToolNote;

  const llmMessages: Array<{ role: "user" | "assistant"; content: TurnLlmMessageContent }> = [...prepared.historyMessages];

  let finalMessageVm: ConversationTurnResultVM["message"] | undefined;
  let toolCallsUsed = 0;
  let ordinal = 0;
  // R16-W1（工作台聊天流升级）：结算尾部元信息「Ns · N tokens」。startedAt=进循环时刻；usage 跨轮累加
  // （多轮工具调用时把每一轮模型调用的 token 都算进这一次 turn 的成本，不是只报最后一轮）。
  const startedAt = now().getTime();
  let usageTokensTotal = 0;
  let sawUsage = false;

  const controller = new AbortController();
  const timeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    roundLoop: for (let round = 1; ; round += 1) {
      if (round > MAX_TURN_MODEL_ROUNDS) {
        throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 卡在了工具调用里，请再试一次。");
      }
      if (round > 1) {
        const roundBudgetOk = await checkTurnBudget(deps, prepared.human.workspaceId, now());
        if (!roundBudgetOk) {
          throw new ConversationTurnServiceError(429, "conversation_turn_budget_exhausted", "这个工作区今天的 AI 预算已经用完了。");
        }
      }

      const allowTools = toolCallsUsed < MAX_TURN_TOOL_CALLS && round < MAX_TURN_MODEL_ROUNDS;
      const tools = allowTools ? buildTurnToolDefinitions({ allowCreateWorkItem: Boolean(pendingClarification) }) : undefined;
      // R25 批 B1：拼接顺序（工作纪律 → 项目指令 → 滚动摘要 → 记忆/技能 → 本轮引用材料）收进
      // @workhub/agent 的 composeTurnSystemPrompt，两条 turn 路径共用同一个纯函数，也是 golden 的入口。
      const system = composeTurnSystemPrompt({
        base: buildTurnSystemPrompt(pendingClarification ? { pendingClarification } : {}),
        projectInstructionsSection,
        contextSummarySection: contextSummaryMd ? buildTurnContextSummarySection(contextSummaryMd) : "",
        memorySection: memorySection.promptSection,
        referenceSection
      });

      let final: TurnLlmFinalMessage;
      try {
        const stream = await client.messages.stream({
          maxTokens: deps.maxResponseTokens ?? DEFAULT_MAX_TURN_RESPONSE_TOKENS,
          source: "agent_step",
          system,
          messages: llmMessages,
          ...(tools ? { tools } : {}),
          signal: controller.signal
        });
        for await (const event of stream) {
          const deltaText = extractDeltaText(event);
          if (deltaText) {
            await emitDelta(deps, { conversationId: input.conversationId, turnId, deltaText, ordinal, at: now() });
            ordinal += 1;
          }
        }
        final = await stream.getFinalMessage();
        if (final.usage) {
          usageTokensTotal += (final.usage.inputTokens ?? 0) + (final.usage.outputTokens ?? 0);
          sawUsage = true;
        }
      } catch (error) {
        logger.warn("conversation_turn_llm_failed", { conversationId: input.conversationId, turnId, error });
        throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没接上，请再试一次。");
      }

      const toolUseBlocks = extractToolUseBlocks(final);
      if (toolUseBlocks.length === 0) {
        const fullText = extractFinalText(final).trim();
        if (fullText.length === 0) {
          if (finalMessageVm) {
            break roundLoop;
          }
          throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。");
        }
        const contentJson: {
          text: string;
          memory_citations?: TurnMemoryCitation[];
          usage_tokens?: number;
          elapsed_ms?: number;
        } = { text: fullText };
        if (memorySection.citations.length > 0) {
          contentJson.memory_citations = memorySection.citations;
        }
        // R16-W1：只在真的从 provider 拿到过 usage 时才写 usage_tokens（铁律：没有真数据不渲染）；elapsed_ms
        // 是本机时钟差，恒可得。model 由 persistAndBroadcastCuuMessage 统一补，这里不重复。
        if (sawUsage) {
          contentJson.usage_tokens = usageTokensTotal;
        }
        contentJson.elapsed_ms = Math.max(0, now().getTime() - startedAt);
        try {
          finalMessageVm = await persistAndBroadcastCuuMessage({ kind: "text", contentJson });
        } catch (error) {
          logger.warn("conversation_turn_persist_failed", { conversationId: input.conversationId, turnId, error });
          throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 的回复没能保存，请再试一次。");
        }
        break roundLoop;
      }

      llmMessages.push({ role: "assistant", content: final.content as unknown as Array<Record<string, unknown>> });
      const toolResultBlocks: Array<Record<string, unknown>> = [];
      let askedClarifyingQuestion: AskClarifyingQuestionToolInput | undefined;

      for (const call of toolUseBlocks) {
        if (askedClarifyingQuestion) {
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: "这一轮已经结束，不会执行这个调用。", is_error: true });
          continue;
        }
        const parsed = parseTurnToolCall(call.name, call.input);
        if (!parsed.ok) {
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: parsed.error, is_error: true });
          continue;
        }
        if (parsed.name === ASK_CLARIFYING_QUESTION_TOOL) {
          askedClarifyingQuestion = parsed.input;
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: "已经把澄清问题发给对方了。", is_error: false });
          continue;
        }
        if (toolCallsUsed >= MAX_TURN_TOOL_CALLS) {
          toolResultBlocks.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "这一轮的工具调用次数已经用完了，请直接用文字回复对方。",
            is_error: true
          });
          continue;
        }
        toolCallsUsed += 1;
        if (parsed.name === DRIVE_SEARCH_TOOL) {
          const result = await executeDriveSearchTool(deps, toolCtx, parsed.input, logger);
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: result.content, is_error: result.isError });
          await tryPersistToolNote({ tool: DRIVE_SEARCH_TOOL, summary: result.auditSummary });
        } else if (parsed.name === SEND_FILE_CARD_TOOL) {
          const result = await executeSendFileCardTool(deps, toolCtx, parsed.input, logger);
          if (!result.isError && result.fileCard) {
            try {
              finalMessageVm = await persistAndBroadcastCuuMessage({
                kind: "file_card",
                contentJson: { drive_item_id: result.fileCard.driveItemId, snapshot_name: result.fileCard.snapshotName }
              });
              toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: result.content, is_error: false });
            } catch (error) {
              logger.warn("conversation_turn_tool_send_file_card_persist_failed", {
                conversationId: input.conversationId,
                turnId,
                error
              });
              toolResultBlocks.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: "文件卡没能发出去，请稍后再试，不要假装已经发送。",
                is_error: true
              });
            }
          } else {
            toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: result.content, is_error: result.isError });
          }
          await tryPersistToolNote({ tool: SEND_FILE_CARD_TOOL, summary: result.auditSummary });
        } else if (parsed.name === CREATE_WORK_ITEM_TOOL) {
          if (!pendingClarification) {
            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: call.id,
              content: "现在还不能建工单——需求还不够清楚，先用 ask_clarifying_question 问清楚。",
              is_error: true
            });
            continue;
          }
          const result = await executeCreateWorkItemTool(deps, toolCtx, parsed.input);
          toolResultBlocks.push({ type: "tool_result", tool_use_id: call.id, content: result.content, is_error: result.isError });
          await tryPersistToolNote({ tool: CREATE_WORK_ITEM_TOOL, summary: result.auditSummary });
        }
      }

      if (askedClarifyingQuestion) {
        const contentJson: {
          text: string;
          is_clarifying_question: true;
          clarify_options?: string[];
          clarify_placeholder?: string;
        } = { text: askedClarifyingQuestion.question, is_clarifying_question: true };
        if (askedClarifyingQuestion.options && askedClarifyingQuestion.options.length > 0) {
          contentJson.clarify_options = askedClarifyingQuestion.options;
        }
        if (askedClarifyingQuestion.placeholder) {
          contentJson.clarify_placeholder = askedClarifyingQuestion.placeholder;
        }
        try {
          finalMessageVm = await persistAndBroadcastCuuMessage({ kind: "text", contentJson });
        } catch (error) {
          logger.warn("conversation_turn_persist_failed", { conversationId: input.conversationId, turnId, error });
          throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 的澄清追问没能保存，请再试一次。");
        }
        break roundLoop;
      }

      llmMessages.push({ role: "user", content: toolResultBlocks });
    }
  } finally {
    clearTimeout(timer);
  }

  if (!finalMessageVm) {
    throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。");
  }

  return parseOutputContract(conversationTurnResultSchema, { turn_id: turnId, message: finalMessageVm }, "conversation-turns.result");
}

// ── on 路径：loop2（pi 引擎）跑一段对话 turn ─────────────────────────────────────────────
//
// 映射（现状受限工具环 → pi AgentLoopConfig，见 03-batch-c-engine.md Phase 4）：
//   ≤4 轮硬顶            → shouldStopAfterTurn（防御性）+ prepareNextTurn 到第 4 轮不再给工具
//   对话工具集(turns)     → AgentTool[].execute 直接跑既有 executeXxxTool（不重实现）
//   tool_note 落库        → afterToolCall 读 details.toolNote 落库；并把 details.isError 传回 pi
//   工具可见性/预算兜底    → create_work_item 靠 buildTurnToolDefinitions 隐藏 + execute 二次拒绝；
//                          逐轮预算软闸挪到 shouldStopAfterTurn（"下一次模型调用前"这个边界的诚实落点，
//                          比逐工具的 beforeToolCall 更贴近现状语义）
//   SSE delta            → 订阅 message_update 里的 text_delta，走既有 emitDelta（事件形状不变，前端零感知）
//   澄清位               → execute 落澄清消息 + terminate，shouldStopAfterTurn 立即收尾
//   连发/steering        → getSteeringMessages 逐条注入进行中的一轮（drainSteering 接缝，P4b 接队列）
//   follow-up            → getFollowUpMessages 恒返回 []（P4b 里 follow-up 交协调器另起一段=新 turn_id）
//
// 段（segment）= 一个 turn_id + 它落的若干 Cuu 消息。跨请求 steering/follow-up 队列（P4b）：同会话已有
// 一轮在跑时，新到的请求不再 409——消息文本入队，owner 的 loop 在下一次模型调用前经 getSteeringMessages
// 逐条注入（把连发的第二条折进进行中的这一轮，回复涵盖两条语境）；一轮收尾后队列还有货，owner 另起一段
// （新 turn_id）续答（follow-up）。队列是进程内跨请求内存态（与 activeTurns 同为进程内，多进程缺口维持
// 现状不扩大）；队列深度上限（env，默认 3）超限才退回 409 conversation_turn_busy 兜底。

// 一条排队等注入的请求：injectText=已带发言人前缀的用户文本；prepared=该请求自己的一轮上下文（follow-up
// 另起一段时用它的 actor/client/澄清位）；settle/fail=该请求 HTTP 承诺的结算钩子（它被哪一段答复，就用
// 那一段的最终消息 VM 结算）。
type ConversationQueueEntry = {
  injectText: string;
  prepared: PreparedTurn;
  settle: (result: ConversationTurnResultVM) => void;
  fail: (error: unknown) => void;
};

type ConversationTurnState = {
  running: boolean;
  queue: ConversationQueueEntry[];
};

function zeroPiUsage(): AssistantMessage["usage"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
}

function newPiAssistant(): AssistantMessage {
  return { role: "assistant", content: [], api: "", provider: "", model: "", usage: zeroPiUsage(), stopReason: "stop", timestamp: Date.now() };
}

function isPiAssistant(message: AgentMessage): message is AssistantMessage {
  return (message as { role?: string }).role === "assistant";
}

function lastPiAssistant(messages: AgentMessage[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && isPiAssistant(message)) return message;
  }
  return undefined;
}

function piAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function seedPiTranscript(historyMessages: PreparedTurn["historyMessages"]): AgentMessage[] {
  return historyMessages.map((m): AgentMessage =>
    m.role === "assistant"
      ? { ...newPiAssistant(), content: workhubAssistantContentToPi(m.content) }
      : { role: "user", content: typeof m.content === "string" ? m.content : "", timestamp: Date.now() }
  );
}

type ToolExecDetails = { isError: boolean; toolNote?: { tool: string; summary: string } };

type SegmentOutcome = { finalVm?: ConversationTurnResultVM["message"]; error?: unknown };

// 跑一段 turn（一个 turn_id）：owner 段用 prepared（原请求的 actor/client/澄清位），follow-up 段（P4b）用
// 队列条目自带的 prepared。转录 transcript 跨段共享（累积会话历史 + 上一段回复），保证续答看得到上文。
// drainSteering 是队列注入接缝：返回下一条要折进这一轮的用户文本（已带发言人前缀），无货返回 undefined。
async function runConversationTurnSegment(
  runtime: TurnRuntime,
  input: { conversationId: string },
  prepared: PreparedTurn,
  seg: { turnId: string; prompts: AgentMessage[]; transcript: AgentMessage[]; drainSteering: () => string | undefined }
): Promise<SegmentOutcome> {
  const { deps, now, logger } = runtime;
  const turnId = seg.turnId;

  let finalMessageVm: ConversationTurnResultVM["message"] | undefined;
  let toolCallsUsed = 0;
  let modelRound = 0;
  let clarifyAsked = false;
  let ordinal = 0;
  let fatalError: unknown;
  let budgetExhausted = false;
  // R16-W1 结算尾部元信息「Ns · N tokens」——与 runLegacyTurnLoop 同口径：startedAt=进段时刻；usage 跨轮
  // 累加（多轮工具调用把每一次模型调用的 token 都算进这一段 turn 的成本，不是只报最后一轮）；sawUsage 只在
  // 真从 provider 拿到过 usage 时才置位（铁律：没有真数据不写 usage_tokens）。loop2 段路径此前漏戳，聊天 UI
  // 的 token 数会丢。
  const startedAt = now().getTime();
  let usageTokensTotal = 0;
  let sawUsage = false;

  const controller = new AbortController();
  const timeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // R25 批 B1：与 runLegacyTurnLoop 共用同一个 composeTurnSystemPrompt（原先两处各抄一份拼接规则）。
  const system = composeTurnSystemPrompt({
    base: buildTurnSystemPrompt(prepared.pendingClarification ? { pendingClarification: prepared.pendingClarification } : {}),
    projectInstructionsSection: prepared.projectInstructionsSection,
    contextSummarySection: prepared.contextSummaryMd ? buildTurnContextSummarySection(prepared.contextSummaryMd) : "",
    memorySection: prepared.memorySection.promptSection,
    referenceSection: prepared.referenceSection
  });

  const toolDefs = buildTurnToolDefinitions({ allowCreateWorkItem: Boolean(prepared.pendingClarification) });

  const makeExecute =
    () =>
    async (_toolCallId: string, params: Record<string, unknown>, callName: string): Promise<AgentToolResult<ToolExecDetails>> => {
      const parsed = parseTurnToolCall(callName, params);
      if (!parsed.ok) {
        return { content: [{ type: "text", text: parsed.error }], details: { isError: true } };
      }
      if (parsed.name === ASK_CLARIFYING_QUESTION_TOOL) {
        const contentJson: {
          text: string;
          is_clarifying_question: true;
          clarify_options?: string[];
          clarify_placeholder?: string;
        } = { text: parsed.input.question, is_clarifying_question: true };
        if (parsed.input.options && parsed.input.options.length > 0) contentJson.clarify_options = parsed.input.options;
        if (parsed.input.placeholder) contentJson.clarify_placeholder = parsed.input.placeholder;
        try {
          finalMessageVm = await prepared.persistAndBroadcastCuuMessage({ kind: "text", contentJson });
          clarifyAsked = true;
        } catch (error) {
          logger.warn("conversation_turn_persist_failed", { conversationId: input.conversationId, turnId, error });
          fatalError = new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 的澄清追问没能保存，请再试一次。");
        }
        return { content: [{ type: "text", text: "已经把澄清问题发给对方了。" }], details: { isError: false }, terminate: true };
      }
      if (toolCallsUsed >= MAX_TURN_TOOL_CALLS) {
        return { content: [{ type: "text", text: "这一轮的工具调用次数已经用完了，请直接用文字回复对方。" }], details: { isError: true } };
      }
      if (parsed.name === CREATE_WORK_ITEM_TOOL && !prepared.pendingClarification) {
        return {
          content: [{ type: "text", text: "现在还不能建工单——需求还不够清楚，先用 ask_clarifying_question 问清楚。" }],
          details: { isError: true }
        };
      }
      toolCallsUsed += 1;
      try {
        if (parsed.name === DRIVE_SEARCH_TOOL) {
          const result = await executeDriveSearchTool(deps, prepared.toolCtx, parsed.input, logger);
          return { content: [{ type: "text", text: result.content }], details: { isError: result.isError, toolNote: { tool: DRIVE_SEARCH_TOOL, summary: result.auditSummary } } };
        }
        if (parsed.name === SEND_FILE_CARD_TOOL) {
          const result = await executeSendFileCardTool(deps, prepared.toolCtx, parsed.input, logger);
          if (!result.isError && result.fileCard) {
            try {
              finalMessageVm = await prepared.persistAndBroadcastCuuMessage({
                kind: "file_card",
                contentJson: { drive_item_id: result.fileCard.driveItemId, snapshot_name: result.fileCard.snapshotName }
              });
              return { content: [{ type: "text", text: result.content }], details: { isError: false, toolNote: { tool: SEND_FILE_CARD_TOOL, summary: result.auditSummary } } };
            } catch (error) {
              logger.warn("conversation_turn_tool_send_file_card_persist_failed", { conversationId: input.conversationId, turnId, error });
              return {
                content: [{ type: "text", text: "文件卡没能发出去，请稍后再试，不要假装已经发送。" }],
                details: { isError: true, toolNote: { tool: SEND_FILE_CARD_TOOL, summary: result.auditSummary } }
              };
            }
          }
          return { content: [{ type: "text", text: result.content }], details: { isError: result.isError, toolNote: { tool: SEND_FILE_CARD_TOOL, summary: result.auditSummary } } };
        }
        // create_work_item
        const result = await executeCreateWorkItemTool(deps, prepared.toolCtx, parsed.input);
        return { content: [{ type: "text", text: result.content }], details: { isError: result.isError, toolNote: { tool: CREATE_WORK_ITEM_TOOL, summary: result.auditSummary } } };
      } catch (error) {
        // 现状语义：send_file_card / create_work_item 对非预期错误会向上抛，整轮失败。pi 会把工具抛异常
        // 吞成 error tool_result 并继续循环——为保持等价，这里捕获、记 fatalError、中断，收尾后原样抛出。
        fatalError = error;
        controller.abort();
        return { content: [{ type: "text", text: "工具执行失败。" }], details: { isError: true } };
      }
    };

  const executeImpl = makeExecute();
  const buildPiTools = (): AgentTool[] =>
    toolDefs.map((raw) => {
      const spec = raw as { name: string; description?: string; input_schema?: unknown };
      const parameters = spec.input_schema && typeof spec.input_schema === "object" ? (spec.input_schema as Record<string, unknown>) : { type: "object" };
      return {
        name: spec.name,
        description: spec.description ?? "",
        parameters,
        label: spec.name,
        execute: (toolCallId: string, params: Record<string, unknown>) => executeImpl(toolCallId, params, spec.name)
      } satisfies AgentTool;
    });
  const piTools = buildPiTools();

  const model: Model = {
    id: "",
    name: "",
    api: "anthropic",
    provider: "conversation-turn",
    baseUrl: "",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: deps.maxResponseTokens ?? DEFAULT_MAX_TURN_RESPONSE_TOKENS
  };

  const streamFn: StreamFn = (_model, context, streamOptions) => {
    const stream = new AssistantMessageEventStream();
    void pumpConversationStream(stream, context, streamOptions);
    return stream;
  };

  async function pumpConversationStream(stream: AssistantMessageEventStream, context: Context, streamOptions: SimpleStreamOptions | undefined) {
    const turnMessages = piMessagesToWorkhub(context.messages) as Array<{ role: "user" | "assistant"; content: TurnLlmMessageContent }>;
    const turnTools = (context.tools ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    const base = newPiAssistant();
    try {
      const turnStream = await prepared.client.messages.stream({
        maxTokens: deps.maxResponseTokens ?? DEFAULT_MAX_TURN_RESPONSE_TOKENS,
        source: "agent_step",
        system,
        messages: turnMessages,
        ...(turnTools.length > 0 ? { tools: turnTools } : {}),
        ...(streamOptions?.signal ? { signal: streamOptions.signal } : {})
      });
      stream.push({ type: "start", partial: { ...base, content: [] } });
      let acc = "";
      for await (const event of turnStream) {
        const deltaText = extractDeltaText(event);
        if (deltaText !== null) {
          acc += deltaText;
          stream.push({ type: "text_delta", contentIndex: 0, delta: deltaText, partial: { ...base, content: [{ type: "text", text: acc }] } });
        }
      }
      const final = await turnStream.getFinalMessage();
      // 与 runLegacyTurnLoop 同口径：累加每一轮模型调用的 usage（input+output），供最终文本消息戳 usage_tokens。
      if (final.usage) {
        usageTokensTotal += (final.usage.inputTokens ?? 0) + (final.usage.outputTokens ?? 0);
        sawUsage = true;
      }
      const content = workhubAssistantContentToPi(final.content);
      const hasToolCalls = content.some((block) => block.type === "toolCall");
      const finalMessage: AssistantMessage = { ...base, content, stopReason: toPiStopReason(undefined, hasToolCalls), timestamp: Date.now() };
      stream.push({ type: "done", reason: hasToolCalls ? "toolUse" : "stop", message: finalMessage });
    } catch (error) {
      const aborted = Boolean(streamOptions?.signal?.aborted);
      stream.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: { ...base, content: [], stopReason: aborted ? "aborted" : "error", errorMessage: error instanceof Error ? error.message : String(error), timestamp: Date.now() }
      });
    }
  }

  const emitSink = async (event: AgentEvent): Promise<void> => {
    if (event.type === "turn_start") {
      modelRound += 1;
      return;
    }
    if (event.type === "message_update") {
      const ame = event.assistantMessageEvent as { type: string; delta?: unknown };
      if (ame.type === "text_delta" && typeof ame.delta === "string") {
        await emitDelta(deps, { conversationId: input.conversationId, turnId, deltaText: ame.delta, ordinal, at: now() });
        ordinal += 1;
      }
    }
  };

  const config: AgentLoopConfig = {
    model,
    toolExecution: "sequential",
    convertToLlm: (messages) => messages as Message[],
    afterToolCall: async ({ result }) => {
      const details = result.details as ToolExecDetails | undefined;
      if (details?.toolNote) {
        await prepared.tryPersistToolNote({ tool: details.toolNote.tool, summary: details.toolNote.summary });
      }
      return details ? { isError: Boolean(details.isError) } : undefined;
    },
    // 工具可见性逐轮刷新：第 4 轮（或工具调用已达硬顶）不再给工具，模型只能收尾出文本——等价于现状
    // allowTools = toolCallsUsed < MAX_TURN_TOOL_CALLS && round < MAX_TURN_MODEL_ROUNDS。
    prepareNextTurn: async ({ context }) => {
      const nextRound = modelRound + 1;
      const allowTools = toolCallsUsed < MAX_TURN_TOOL_CALLS && nextRound < MAX_TURN_MODEL_ROUNDS;
      return { context: { ...context, tools: allowTools ? piTools : [] } };
    },
    getSteeringMessages: async () => {
      const injectText = seg.drainSteering();
      if (injectText === undefined) return [];
      return [{ role: "user", content: injectText, timestamp: Date.now() }];
    },
    getFollowUpMessages: async () => [],
    shouldStopAfterTurn: async ({ message }) => {
      if (fatalError) return true;
      if (clarifyAsked) return true;
      const hasToolCalls = isPiAssistant(message) && message.content.some((block) => block.type === "toolCall");
      if (!hasToolCalls) return false;
      if (modelRound >= MAX_TURN_MODEL_ROUNDS) return true;
      const roundBudgetOk = await checkTurnBudget(deps, prepared.human.workspaceId, now());
      if (!roundBudgetOk) {
        budgetExhausted = true;
        return true;
      }
      return false;
    }
  };

  try {
    const context: AgentContext = { systemPrompt: system, messages: seg.transcript, tools: piTools };
    const newMessages = await runAgentLoop(seg.prompts, context, config, emitSink, controller.signal, streamFn);
    seg.transcript.push(...newMessages);
  } catch (error) {
    return { error };
  } finally {
    clearTimeout(timer);
  }

  if (fatalError !== undefined) return { error: fatalError };

  const last = lastPiAssistant(seg.transcript);
  if (last && (last.stopReason === "error" || last.stopReason === "aborted")) {
    return { error: new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没接上，请再试一次。") };
  }

  if (budgetExhausted && !finalMessageVm) {
    return { error: new ConversationTurnServiceError(429, "conversation_turn_budget_exhausted", "这个工作区今天的 AI 预算已经用完了。") };
  }

  if (clarifyAsked) {
    if (!finalMessageVm) return { error: new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。") };
    return { finalVm: finalMessageVm };
  }

  if (last) {
    const hasToolCalls = last.content.some((block) => block.type === "toolCall");
    const text = piAssistantText(last);
    if (!hasToolCalls && text.length > 0) {
      const contentJson: {
        text: string;
        memory_citations?: TurnMemoryCitation[];
        usage_tokens?: number;
        elapsed_ms?: number;
      } = { text };
      if (prepared.memorySection.citations.length > 0) contentJson.memory_citations = prepared.memorySection.citations;
      // R16-W1：只在真拿到过 usage 时写 usage_tokens；elapsed_ms 是本机时钟差恒可得。model 由
      // persistAndBroadcastCuuMessage 统一补，这里不重复（与 runLegacyTurnLoop 最终文本落点同口径）。
      if (sawUsage) contentJson.usage_tokens = usageTokensTotal;
      contentJson.elapsed_ms = Math.max(0, now().getTime() - startedAt);
      try {
        finalMessageVm = await prepared.persistAndBroadcastCuuMessage({ kind: "text", contentJson });
      } catch (error) {
        logger.warn("conversation_turn_persist_failed", { conversationId: input.conversationId, turnId, error });
        return { error: new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 的回复没能保存，请再试一次。") };
      }
    }
  }

  if (!finalMessageVm) {
    return { error: new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。") };
  }
  return { finalVm: finalMessageVm };
}

// owner：串起若干"段"。第 1 段=原请求（prompts 空——触发消息已在历史里），收尾后若队列还有货，逐条起
// 新段（新 turn_id）续答（follow-up）。每段：owner + 被 steering 折进来的条目，用该段的最终消息 VM 结算
// （共用该段的 turn_id；client 靠 id 去重，共用 turn_id 前端无感）。段失败：该段的 owner/absorbed 条目
// 用错误结算，但外层继续处理剩余队列——队列不丢，剩下的转成新 turn 正常处理（满足 abort/失败不丢队列）。
//
// turn 行取舍（无 DB turn 表，turn 只是一个 id + 它落的若干 Cuu 消息）：连发 burst 里"生成中到达"的
// 折进当前段（共用 turn_id，因为 steering 本质就是同一次模型 loop 的续写）；"收尾后到达"的另起一段
// （新 turn_id）——正好对上 steering vs follow-up 的语义边界，也让 follow-up=新 turn 行更诚实。
async function runConversationTurnOwner(
  runtime: TurnRuntime,
  input: { conversationId: string },
  prepared: PreparedTurn,
  state: ConversationTurnState
): Promise<ConversationTurnResultVM> {
  const transcript = seedPiTranscript(prepared.historyMessages);
  let firstResult: ConversationTurnResultVM | undefined;
  let firstError: unknown;
  let firstDone = false;

  let segmentPrepared = prepared;
  let segmentTurnId = prepared.turnId;
  let prompts: AgentMessage[] = [];
  let segmentOwnerEntry: ConversationQueueEntry | undefined;

  while (true) {
    // 本段被 steering 折进来的排队条目——drainSteering 每弹一条就记在这里，段收尾时用本段的最终消息结算。
    const absorbed: ConversationQueueEntry[] = [];
    const outcome = await runConversationTurnSegment(runtime, input, segmentPrepared, {
      turnId: segmentTurnId,
      prompts,
      transcript,
      drainSteering: () => {
        // "一次一条"（QueueMode.one-at-a-time）：每次模型调用前只注入队首一条，其余留到后续注入点。
        // 理由：逐条注入让每条连发消息按顺序拿到模型的注意力、保序，且不会把一个 burst 一次性灌成一大坨
        // user turn（那样上下文突然膨胀、也更容易让模型漏掉中间某条）。
        const entry = state.queue.length > 0 ? state.queue.shift() : undefined;
        if (!entry) return undefined;
        absorbed.push(entry);
        return entry.injectText;
      }
    });

    const entries = segmentOwnerEntry ? [segmentOwnerEntry, ...absorbed] : absorbed;
    if (outcome.error !== undefined) {
      if (!firstDone) {
        firstError = outcome.error;
        firstDone = true;
      }
      for (const entry of entries) entry.fail(outcome.error);
    } else {
      const result = parseOutputContract(
        conversationTurnResultSchema,
        { turn_id: segmentTurnId, message: outcome.finalVm },
        "conversation-turns.result"
      );
      if (!firstDone) {
        firstResult = result;
        firstDone = true;
      }
      for (const entry of entries) entry.settle(result);
    }

    // follow-up：这一段收尾后队列还有货 → 弹队首，另起一段（新 turn_id），用它自己的 prepared 续答。
    // 这一步是同步弹队列——与 createTurn 里"同步入队/置 running"配对，配合外层 finally 的同步收口，保证
    // 收尾竞态窗口里到达的消息不会既没被本段注入、又赶不上新段（见 createTurn 的注释）。
    const next = state.queue.length > 0 ? state.queue.shift() : undefined;
    if (!next) break;
    segmentOwnerEntry = next;
    segmentPrepared = next.prepared;
    segmentTurnId = runtime.id();
    prompts = [{ role: "user", content: next.injectText, timestamp: Date.now() }];
  }

  if (firstError !== undefined) throw firstError;
  if (!firstResult) throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。");
  return firstResult;
}

// ── 并发闸：进程内 Map，key=conversationId。多进程部署下这不是完整闸——已知缺口，见批汇报。────────

export function createConversationTurnService(deps: ConversationTurnServiceDeps): ConversationTurnService {
  const now = deps.now ?? (() => new Date());
  const id = deps.id ?? randomUUID;
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const runtime: TurnRuntime = { deps, now, id, logger };
  const activeTurns = new Set<string>();
  const settings = deps.settings ?? runtimeSettings;
  const loop2Mode: ConversationTurnLoop2Mode = deps.loop2Mode ?? settings.conversationTurns?.loop2Mode ?? "off";
  const queueMaxDepth = deps.queueMaxDepth ?? settings.conversationTurns?.queueMaxDepth ?? 3;
  // R15 批 C Phase 4（P4b）：steering/follow-up 队列的进程内跨请求态（key=conversationId），与 activeTurns
  // 同为进程内——多进程缺口维持现状不扩大。仅 on 模式使用；off 走 activeTurns 老闸。
  const conversations = new Map<string, ConversationTurnState>();

  return {
    async createTurn(input) {
      if (loop2Mode === "on") {
        // on 路径：先做和 off 完全相同的一轮前置校验/装配（无效请求照样 403/404/409，不占队列），再看
        // 协调器：本会话没有进行中的一轮 → 成为 owner 起 loop2；已有一轮在跑 → 消息入 steering 队列
        // （不再 409），排队等 owner 在下一次模型调用前注入；队列已满才退回 409 兜底。
        const prepared = await prepareTurnContext(runtime, input);
        // 「查/置 running 或入队」必须是同步的（无 await 穿插），才和 activeTurns 一样是确定性闸而非竞态：
        // 两个并发请求先后同步跑到这里，第一个置 running=true 成为 owner，第二个看见 running=true 入队。
        // owner 收尾在 finally 里同步「若队列空则置 running=false」，与这里的同步检查配对，杜绝丢消息。
        let state = conversations.get(input.conversationId);
        if (!state) {
          state = { running: false, queue: [] };
          conversations.set(input.conversationId, state);
        }
        if (state.running) {
          if (state.queue.length >= queueMaxDepth) {
            throw new ConversationTurnServiceError(409, "conversation_turn_busy", "这个会话已经有一轮 Cuu 回应正在进行，请稍候。");
          }
          const label = prepared.human.actor.label ?? "成员";
          const injectText = `${label}：${prepared.triggerText}`;
          const activeState = state;
          return await new Promise<ConversationTurnResultVM>((resolve, reject) => {
            activeState.queue.push({ injectText, prepared, settle: resolve, fail: reject });
          });
        }
        state.running = true;
        const ownerState = state;
        try {
          return await runConversationTurnOwner(runtime, input, prepared, ownerState);
        } finally {
          // owner 处理完自己这一段起、直到队列被 follow-up 段抽干，才释放 running。抽干后置 running=false；
          // 若此刻队列已空则连状态一起清掉（避免 Map 无限长）。若竞态里又有新条目入队（running 仍 true 时
          // 入的），它已被上面的 owner 循环消费掉，这里 queue 必空。
          ownerState.running = false;
          if (ownerState.queue.length === 0) conversations.delete(input.conversationId);
        }
      }

      // 非真人 actor 在触碰仓库/占用忙碌位之前就 403（与 prepareTurnContext 里的守卫同源；这里提前一次，
      // 保住"gate 前先 403、不碰仓库"这条既有行为）。off 路径走 activeTurns 老闸，行为逐字节不变。
      requireHumanActor(input.actor);

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
        const prepared = await prepareTurnContext(runtime, input);
        return await runLegacyTurnLoop(runtime, input, prepared);
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

// R13 批 C1：压缩摘要调用走独立的 "context_compact" 任务类——provider-registry 据此单独路由/记账，
// 与主回应的 "assistant" 分开归因（见 packages/agent/src/providers/types.ts 的 taskClasses 注释）。
function defaultCompactionClientProvider(): ConversationTurnClientProvider {
  return ({ actorId, userId, workspaceId }) =>
    getDefaultProviderRegistry().get(
      { id: actorId, userId, workspaceId },
      "context_compact"
    ) as unknown as TurnLlmClient;
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
      // R13 批4c：drive_search/send_file_card/create_work_item 三个工具复用既有已鉴权服务，不重新
      // 实现一遍网盘检索/工单创建。
      drive: getDefaultDrivePageService(),
      workItems: getDefaultWorkItemService(),
      bus: getDefaultPushBus(),
      logger: getDefaultStructuredLogger(),
      // R13 批 C1：压缩摘要的独立 client + 压缩完成后的透明提示，都直接复用已经在这个函数里建好的
      // 依赖（provider registry / action-cards 仓库），不新增任何服务或仓库。
      compactionClient: defaultCompactionClientProvider(),
      postContextCompactionSystemMessage: ({ workspaceId, conversationId, content, at }) =>
        actionCards.postSystemMessage({ workspaceId, conversationId, senderType: "system", content, at }),
      // R15 批 A（A5 消息通知）：Cuu 消息落库后给其他参与者扇出——senderUserId=null（Cuu）、senderLabel=Cuu，
      // 参与者/未读聚合复用同一个共享 DB 的会话仓库，presence/notifications 复用默认单例（fire-and-forget）。
      notifyCuuMessage: (message) => {
        void notifyConversationMessage(
          {
            repository: createConversationRepository(db),
            presence: getDefaultPresenceStore(),
            notifications: createNotificationService(),
            logger: getDefaultStructuredLogger()
          },
          {
            conversationId: message.conversationId,
            projectId: message.projectId,
            conversationTitle: message.conversationTitle,
            senderUserId: null,
            senderLabel: CUU_MENTION_DISPLAY_NAME,
            messageKind: message.messageKind,
            previewText: message.previewText
          }
        ).catch(() => {});
      }
    });
  }
  return defaultConversationTurnService;
}
