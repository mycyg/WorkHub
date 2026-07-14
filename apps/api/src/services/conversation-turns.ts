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
  buildTurnMemorySection,
  buildTurnMessages,
  buildTurnSystemPrompt,
  buildTurnToolDefinitions,
  parseTurnToolCall,
  type AskClarifyingQuestionToolInput,
  type CreateWorkItemToolInput,
  type DriveSearchToolInput,
  type SendFileCardToolInput,
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

// 最小 LLM 客户端形状——流式接口 + R13 批4c 起支持工具调用（tools 入参、content 块里的 tool_use）。
// 真实 wiring 用 ProviderRegistry.get(...).messages.stream(...)，其返回值结构性兼容这个类型（见
// packages/agent/src/providers/measured-client.ts 的 messages.stream；tools/tool_use/tool_result
// 的线上协议见 packages/agent/src/providers/anthropic-compatible.ts 的 requestBody/finalizeBlock）。
export type TurnLlmStreamEvent = { type: string; data?: unknown };
// content 块的判别字段仍是 type；text 块带 text，tool_use 块带 id/name/input（input 在被 max_tokens
// 截断时可能是原始未解析字符串而不是对象——parseTurnToolCall 的 zod 校验会温和地把它判成参数不对，
// 见 packages/agent/src/turns/tools.ts 顶部注释）。
export type TurnLlmContentBlock = { type: string; text?: string; id?: string; name?: string; input?: unknown };
export type TurnLlmFinalMessage = { content: TurnLlmContentBlock[] };
export type TurnLlmStream = AsyncIterable<TurnLlmStreamEvent> & {
  getFinalMessage: () => Promise<TurnLlmFinalMessage>;
};
// messages 里一条消息的 content 可以是纯字符串（普通对话轮次，批4a 原有形态）或者一个内容块数组
// （工具环里的 assistant tool_use 回放 / user tool_result 回填）——两种形态在 provider 线上协议里都
// 合法，宽化这个联合类型不影响批4a 既有调用方（那些调用点只产出字符串 content）。
export type TurnLlmMessageContent = string | Array<Record<string, unknown>>;
export type TurnLlmClient = {
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
  conversations: Pick<
    ConversationRepository,
    "findVisibleAccessRecord" | "listMessagesAfter" | "createCuuMessage" | "updateContextSummary"
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
          throw new ConversationTurnServiceError(
            409,
            "conversation_turn_cuu_disabled",
            "这个会话已经关掉了 Cuu，不会有回应。"
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

        // R13 批 C1（会话上下文压缩）：触发判定放在拉取历史窗口之前、cuu_enabled 闸与模式闸之后——
        // afterSeq 就是这一轮的新窗口起点，超出它的内容原本会被 listMessagesAfter 的滑窗静默丢弃。
        // 攒够 CONTEXT_SUMMARY_REFRESH_BATCH 条才刷新一次，不是每轮都摘要。
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

        // R13 批 G1：回话判定——被 @Cuu 必回，任何判定器都不能覆盖这条（见本文件顶部 §8 与
        // mentionsCuu/ConversationTurnRespondDecider 的注释）。没被 @ 时才去问判定器；默认判定器
        // （4c 落地前）保守永远放行，维持存量行为零回归。
        const triggerText = historyDisplayText(anchor) ?? "";
        // 个人空间单聊=判定的必回特例（用户终裁语义）：不要求 @、判定器无权否决。
        if (!personalSingleChat && !mentionsCuu(triggerText)) {
          const decider = deps.respondDecider ?? defaultConversationTurnRespondDecider;
          const shouldRespond = await decider({
            participantCount: access.participantCount,
            triggerMessageText: triggerText
          });
          if (!shouldRespond) {
            throw new ConversationTurnServiceError(
              409,
              "conversation_turn_not_warranted",
              "这轮消息看起来还不需要 Cuu 回应。"
            );
          }
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

        // R13 批4c：澄清位从消息流位置推导（anchor 的上一条如果是 Cuu 发的带 is_clarifying_question
        // 标记的文本），不新增任何旁路状态字段——满足时解锁 create_work_item 工具 + system prompt 提示。
        const pendingClarification = findPendingClarification(page.rows, anchor.id);
        const toolCtx: TurnToolExecutionContext = {
          actor: human.actor,
          workspaceId: human.workspaceId,
          projectId: access.conversation.projectId
        };

        const turnId = id();
        const client = await deps.client({ actorId: human.userId, userId: human.userId, workspaceId: human.workspaceId });

        // llmMessages 在受限工具环里会被追加 assistant tool_use 回放 / user tool_result 回填；
        // buildTurnMessages(history) 产出的都是 content:string 的普通对话轮次，是这个更宽类型的子集。
        const llmMessages: Array<{ role: "user" | "assistant"; content: TurnLlmMessageContent }> = [
          ...buildTurnMessages(history)
        ];

        // 把一条已经落库、广播过的 Cuu 消息映射成响应/事件都要用的 VM——发文件卡/收尾文本/澄清追问
        // 三条终止路径共用同一段"落库 + 广播"逻辑，只是 kind/contentJson 不同。createCuuMessage 抛出的
        // 错误原样向上抛，由各调用点按自己的语义决定是让整个 turn 失败，还是降级成一条错误 tool_result
        // （见下方 file_card 分支）。
        async function persistAndBroadcastCuuMessage(
          messageInput:
            | { kind: "text"; contentJson: { text: string; memory_citations?: TurnMemoryCitation[]; is_clarifying_question?: boolean; clarify_options?: string[]; clarify_placeholder?: string } }
            | { kind: "file_card"; contentJson: { drive_item_id: string; snapshot_name: string } }
            | { kind: "tool_note"; contentJson: Record<string, unknown> }
        ) {
          const created = await deps.conversations.createCuuMessage({
            workspaceId: human.workspaceId,
            conversationId: input.conversationId,
            at: now(),
            ...messageInput
          });
          const vm = parseOutputContract(conversationMessageVmSchema, messageToVm(created), "conversation-turns.message");
          try {
            const conversationTopic = topics.conversation(input.conversationId).topic;
            const previewText =
              vm.kind === "text" ? vm.content.text : vm.kind === "file_card" ? vm.content.snapshot_name : vm.kind;
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
          return vm;
        }

        async function tryPersistToolNote(contentJson: Record<string, unknown>) {
          try {
            await persistAndBroadcastCuuMessage({ kind: "tool_note", contentJson });
          } catch (error) {
            // 透明日志是锦上添花，不因为它写失败就把整轮判成失败——真正的动作（file_card/工单/最终文本）
            // 各自有自己的失败处理。
            logger.warn("conversation_turn_tool_note_persist_failed", { conversationId: input.conversationId, turnId, error });
          }
        }

        let finalMessageVm: ConversationTurnResultVM["message"] | undefined;
        let toolCallsUsed = 0;
        let ordinal = 0;

        const controller = new AbortController();
        const timeoutMs = deps.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          roundLoop: for (let round = 1; ; round += 1) {
            if (round > MAX_TURN_MODEL_ROUNDS) {
              // 防御性兜底：下面 allowTools 的门槛设计保证第 MAX_TURN_MODEL_ROUNDS 轮必然不带
              // tools、模型只能回文本——正常情况下走不到这里。
              throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 卡在了工具调用里，请再试一次。");
            }
            if (round > 1) {
              // R13 批4c 修订已知缺口：预算软闸之前只在 turn 开头查一次；多工具调用循环意味着一次
              // turn 可能产生多次 LLM 计费，这里在每一次额外的模型调用前重新检查。
              const roundBudgetOk = await checkTurnBudget(deps, human.workspaceId, now());
              if (!roundBudgetOk) {
                throw new ConversationTurnServiceError(429, "conversation_turn_budget_exhausted", "这个工作区今天的 AI 预算已经用完了。");
              }
            }

            const allowTools = toolCallsUsed < MAX_TURN_TOOL_CALLS && round < MAX_TURN_MODEL_ROUNDS;
            const tools = allowTools ? buildTurnToolDefinitions({ allowCreateWorkItem: Boolean(pendingClarification) }) : undefined;
            const system = [
              buildTurnSystemPrompt(pendingClarification ? { pendingClarification } : {}),
              // R13 批 C1：滚动摘要插在 memorySection 之前——"这个会话更早内容的背景"先于"用户偏好/
              // 团队技能"这类跨会话的参考材料。
              contextSummaryMd ? buildTurnContextSummarySection(contextSummaryMd) : "",
              memorySection.promptSection
            ]
              .filter((part) => part.length > 0)
              .join("\n\n");

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
            } catch (error) {
              logger.warn("conversation_turn_llm_failed", { conversationId: input.conversationId, turnId, error });
              throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没接上，请再试一次。");
            }

            const toolUseBlocks = extractToolUseBlocks(final);
            if (toolUseBlocks.length === 0) {
              const fullText = extractFinalText(final).trim();
              if (fullText.length === 0) {
                if (finalMessageVm) {
                  // 这一轮之前已经有真实动作发生过（比如发了文件卡）——模型这轮没有更多话要补充，
                  // 不算失败，直接收尾用已经落库的那条消息。
                  break roundLoop;
                }
                throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 没给出内容，请再试一次。");
              }
              const contentJson: { text: string; memory_citations?: TurnMemoryCitation[] } = { text: fullText };
              if (memorySection.citations.length > 0) {
                contentJson.memory_citations = memorySection.citations;
              }
              try {
                finalMessageVm = await persistAndBroadcastCuuMessage({ kind: "text", contentJson });
              } catch (error) {
                logger.warn("conversation_turn_persist_failed", { conversationId: input.conversationId, turnId, error });
                throw new ConversationTurnServiceError(500, "conversation_turn_failed", "这一轮 Cuu 的回复没能保存，请再试一次。");
              }
              break roundLoop;
            }

            // 模型请求了工具调用：把这一轮的 assistant 内容（含 tool_use 块）原样回放进历史，
            // 再给每一个 tool_use 生成恰好一条 tool_result——包括参数校验失败/超过调用上限的情形，
            // 保证不会留下悬空的 tool_use（见 tools.ts 顶部注释）。
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
                // 纵深防御：工具可见性已经在 buildTurnToolDefinitions 那一层把 create_work_item 藏起来
                // （不满足 pendingClarification 时不出现在 tools 清单里），这里再校验一次——万一模型
                // 无视清单直接编出这个调用名，服务端仍然拒绝执行，不给"顺嘴建工单"留第二条路。
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

        return parseOutputContract(
          conversationTurnResultSchema,
          { turn_id: turnId, message: finalMessageVm },
          "conversation-turns.result"
        );
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
        actionCards.postSystemMessage({ workspaceId, conversationId, senderType: "system", content, at })
    });
  }
  return defaultConversationTurnService;
}
