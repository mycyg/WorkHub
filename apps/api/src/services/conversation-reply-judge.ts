import {
  buildReplyJudgeSystemPrompt,
  buildReplyJudgeUserPrompt,
  isAlreadyJudgedMessage,
  judgeReply,
  parseReplyJudgeLlmResponse,
  shouldEvaluateReplyJudgeNow,
  type ReplyJudgeLlmClassifier
} from "@workhub/agent/reply-judge";
import { settings as runtimeSettings, type Settings } from "@workhub/config";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";
import {
  createConversationRepository,
  getSharedDatabaseClient,
  type ConversationRepository,
  type ReplyJudgeCandidateRow
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";
import { getDefaultConversationTurnService, type ConversationTurnService } from "./conversation-turns.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";

// R13 批4c/G1（回话判定器，服务端切片）：小群里没人 @Cuu 时，"该不该接话"的判断——判定器本身
// （规则前置 + 便宜档 LLM 兜底 + 单聊/cuu_enabled 门禁）是纯函数，活在 packages/agent/src/
// reply-judge/**；这个文件只负责把它接到真实数据源（conversations 仓库的候选扫描）和真实动作
// （复用既有 ConversationTurnService.createTurn 触发一次 turn 形态的回复）上。调度（定时 tick）
// 在 apps/api/src/workers/conversation-reply-judge.ts，那层只是个薄壳，真正的判定/触发逻辑都在
// 这里的 runOnce()，方便注入假依赖单测。
//
// 设计取舍（04 铁律 + 范围围栏驱动）：
// 1. **只服务"真小群"**：conversations 仓库的 listReplyJudgeCandidates 只返回 participantCount>1
//    的 collab 会话——今天（G1 落地之前）rail.ts 建协同会话时 participant_user_ids 恒为空数组，
//    所以这个查询在当前仓库状态下恒返回空列表，是一次无副作用的提前就位。1:1 单聊继续 100% 由
//    桌面端既有的"发消息后自动请一轮 turn"路径处理（chat/turn.ts 的
//    shouldRequestConversationTurn）——两条路径刻意不重叠，避免同一条消息被两条机制各触发一次
//    turn（重复消耗预算，甚至出现两条 Cuu 回复）。
// 2. **cuu_enabled 当注入布尔处理**：G1 的迁移（project_conversations 加 cuu_enabled 列）与本批
//    并行施工，本文件不依赖那张列是否已经存在——cuuEnabledForConversation 默认恒真，G1 落地后只需要
//    把这个依赖换成一次真实的列读取，judge.ts 的判定逻辑不需要跟着变。
// 3. **触发 turn 用"最后发言人"合成的 AuthActor**：worker 是系统调用，不代表任何一次真实 HTTP
//    请求，没有认证 token；createTurn 的 requireHumanActor 只检查 kind/userId/workspaceId
//    （不检查 orgId），这里合成一个以"触发这次判定的最新人类消息的发送者"为身份的 AuthActor 去调用
//    既有的 createTurn——复用它已经做好的鉴权/预算/工具环，不重新实现一遍。orgId 留空字符串是安全
//    的：permissions 包对非 admin actor 的项目权限判定只在 project.orgId 和 actor.orgId 都非空时
//    才比较两者，留空视为跳过该项检查，落回工作区匹配（本来就会通过，因为消息发送者本就是这个
//    workspaceId 下的活跃成员）。
// 4. **限频合并 + 幂等判定水位线全在进程内内存**：与 conversation-turns.ts 的 activeTurns Set、
//    conversation-observer.ts 的 tick 统计同一类已知缺口——多进程部署/进程重启会丢失这份状态。
//    不是新缺口，是这一类"没有专属状态表、范围围栏又不许加迁移"场景下的既有取舍。
// 5. **不额外拉取历史上下文喂给便宜档模型**：只有规则前置给不出结论的候选才会走到 LLM 分类
//    （recentMessages 传空数组）——避免为每个"规则已经能决定"的候选都多发一次 DB 查询。这是本批
//    的一个已知简化，不是遗漏：更完整的实现应该只在真正进入 LLM 分类分支时才按需拉一小段历史，
//    留在批次汇报的"缺口"里，不在这批硬做。

const DEFAULT_LOOKBACK_MS = 10 * 60 * 1000; // 候选扫描只看最近 10 分钟内有人类消息的会话
const DEFAULT_MAX_CANDIDATES_PER_TICK = 20;
const DEFAULT_LLM_MAX_RESPONSE_TOKENS = 60;
const DEFAULT_LLM_TIMEOUT_MS = 10_000;

export type ConversationReplyJudgeTickResult = {
  scanned: number;
  judged: number;
  replied: number;
  skipped_merge_window: number;
  skipped_already_judged: number;
  skipped_non_text: number;
  skipped_cuu_disabled: number;
  failed: number;
  started_at: string;
  finished_at: string;
};

export type ConversationReplyJudgeServiceDeps = {
  conversations: Pick<ConversationRepository, "listReplyJudgeCandidates">;
  turns: Pick<ConversationTurnService, "createTurn">;
  // 见文件顶部注释第 2 点——默认恒真，G1 落地后应该替换成一次真实的 cuu_enabled 列读取。
  cuuEnabledForConversation?: (candidate: ReplyJudgeCandidateRow) => Promise<boolean>;
  // 便宜档 LLM 分类器工厂——按候选所在的 workspaceId 现场构造一次性分类器（分类调用的用量记账/
  // 预算门禁要按候选实际所在的 team 维度算，不是一个进程级共享的固定 workspace）。不传就跳过 LLM
  // 二级判定，undetermined 一律收口成"不回"（judge.ts 的既定保守默认）。
  llmClassifierFactory?: (workspaceId: string) => ReplyJudgeLlmClassifier;
  now?: () => Date;
  logger?: Pick<StructuredLogger, "warn">;
  mergeWindowMs?: number;
  cuuDisplayName?: string;
  maxCandidatesPerTick?: number;
  candidateLookbackMs?: number;
};

export type ConversationReplyJudgeService = {
  runOnce(): Promise<ConversationReplyJudgeTickResult>;
};

function extractCandidateText(candidate: ReplyJudgeCandidateRow): string | undefined {
  if (candidate.lastMessageKind !== "text") {
    return undefined;
  }
  const text = candidate.lastMessageContentJson["text"];
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

export function createConversationReplyJudgeService(
  deps: ConversationReplyJudgeServiceDeps
): ConversationReplyJudgeService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const cuuEnabledForConversation = deps.cuuEnabledForConversation ?? (async () => true);
  // 会话级"最后一次判定过的消息 id"——限频合并 + 幂等判定的核心状态，进程内内存（见顶部注释第4点）。
  const lastJudgedByConversation = new Map<string, string>();

  return {
    async runOnce() {
      const startedAt = now();
      const result = {
        scanned: 0,
        judged: 0,
        replied: 0,
        skipped_merge_window: 0,
        skipped_already_judged: 0,
        skipped_non_text: 0,
        skipped_cuu_disabled: 0,
        failed: 0
      };

      const lookbackMs = deps.candidateLookbackMs ?? DEFAULT_LOOKBACK_MS;
      const sinceCreatedAt = new Date(startedAt.getTime() - lookbackMs);
      const candidates = await deps.conversations.listReplyJudgeCandidates({
        limit: deps.maxCandidatesPerTick ?? DEFAULT_MAX_CANDIDATES_PER_TICK,
        sinceCreatedAt
      });
      result.scanned = candidates.length;

      for (const candidate of candidates) {
        try {
          const nowMs = now().getTime();
          if (
            !shouldEvaluateReplyJudgeNow({
              lastMessageCreatedAtMs: candidate.lastMessageCreatedAt.getTime(),
              nowMs,
              ...(deps.mergeWindowMs !== undefined ? { mergeWindowMs: deps.mergeWindowMs } : {})
            })
          ) {
            result.skipped_merge_window += 1;
            continue;
          }
          if (
            isAlreadyJudgedMessage({
              lastJudgedMessageId: lastJudgedByConversation.get(candidate.conversationId),
              candidateMessageId: candidate.lastMessageId
            })
          ) {
            result.skipped_already_judged += 1;
            continue;
          }
          // 标记为"已判定"要在实际判定之前完成——不管接下来判定结果是回还是不回、甚至判定本身失败，
          // 同一条消息在这个进程的生命周期里都不应该被重复判第二次。
          lastJudgedByConversation.set(candidate.conversationId, candidate.lastMessageId);
          result.judged += 1;

          const text = extractCandidateText(candidate);
          if (text === undefined) {
            result.skipped_non_text += 1;
            continue;
          }

          const cuuEnabled = await cuuEnabledForConversation(candidate);
          const classifyWithLlm = deps.llmClassifierFactory?.(candidate.workspaceId);

          const verdict = await judgeReply({
            cuuEnabled,
            participantCount: candidate.participantCount,
            text,
            ...(deps.cuuDisplayName ? { cuuDisplayName: deps.cuuDisplayName } : {}),
            ...(classifyWithLlm ? { classifyWithLlm } : {})
          });

          if (verdict.reason === "cuu_disabled") {
            result.skipped_cuu_disabled += 1;
            continue;
          }
          if (!verdict.shouldReply) {
            continue;
          }

          const syntheticActor: AuthActor = {
            kind: "human",
            id: candidate.lastMessageSenderUserId,
            label: "workspace-member",
            userId: candidate.lastMessageSenderUserId,
            isAdmin: false,
            orgId: "",
            workspaceId: candidate.workspaceId
          };
          await deps.turns.createTurn({
            actor: syntheticActor,
            conversationId: candidate.conversationId,
            payload: { user_message_id: candidate.lastMessageId }
          });
          result.replied += 1;
        } catch (error) {
          result.failed += 1;
          logger.warn?.("conversation_reply_judge_candidate_failed", { conversationId: candidate.conversationId, error });
        }
      }

      return { ...result, started_at: startedAt.toISOString(), finished_at: now().toISOString() };
    }
  };
}

// ── 默认便宜档 LLM 分类器——task 类沿用 turns 已经在用的 "assistant"（见 packages/agent/src/
//    reply-judge/prompt.ts 顶部注释：provider registry 今天只注册了一个 model，taskRouting 是空
//    对象，还没有真正的第二档更便宜的模型可选；经济性靠"只在规则给不出结论时才调用" + 低
//    maxTokens + 限频合并 + 这里的预算软闸 实现，不是靠模型选路） ──────────────────────────────

type ReplyJudgeLlmContent = { type: string; text?: string };
type ReplyJudgeLlmResponse = { content: ReplyJudgeLlmContent[] };
type ReplyJudgeLlmClient = {
  messages: {
    create: (input: {
      maxTokens: number;
      source: "agent_step";
      system: string;
      messages: Array<{ role: "user"; content: string }>;
      timeoutMs?: number;
    }) => Promise<ReplyJudgeLlmResponse>;
  };
};

function extractText(content: ReplyJudgeLlmContent[]): string {
  return content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

// ── 预算软闸——与 conversation-turns.ts/conversation-observer.ts 同款理由：判定器的便宜档 LLM 调用
//    本身也是一次计费调用，调用前查一次团队维度已用量快照做门槛判断，不参与并发原子预留互斥
//    （同款已知缺口，理由同 checkTurnBudget/checkObserverBudget）。 ─────────────────────────────

async function checkReplyJudgeBudget(input: {
  workspaceId: string;
  policyStore: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
  settings?: Settings;
  now: Date;
}): Promise<boolean> {
  const settings = input.settings ?? runtimeSettings;
  const usage = await input.ledgerStore.usageSnapshots({ teamId: input.workspaceId }, { now: input.now });
  const decision = decideRunBudget({
    settings,
    scopeIds: { teamId: input.workspaceId },
    policies: await input.policyStore.listPolicies(settings),
    usage,
    now: input.now
  });
  return decision.allowed;
}

function defaultLlmClassifierFactory(deps: {
  policyStore: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
  logger: Pick<StructuredLogger, "warn">;
}): (workspaceId: string) => ReplyJudgeLlmClassifier {
  return (workspaceId) => async ({ recentMessages, candidateText }) => {
    const registry = getDefaultProviderRegistry();
    if (!registry.isConfigured()) {
      return undefined;
    }
    const budgetOk = await checkReplyJudgeBudget({
      workspaceId,
      policyStore: deps.policyStore,
      ledgerStore: deps.ledgerStore,
      now: new Date()
    });
    if (!budgetOk) {
      return undefined;
    }
    try {
      const client = registry.get({ id: "conversation-reply-judge", workspaceId }, "assistant") as unknown as ReplyJudgeLlmClient;
      const response = await client.messages.create({
        maxTokens: DEFAULT_LLM_MAX_RESPONSE_TOKENS,
        source: "agent_step",
        system: buildReplyJudgeSystemPrompt(),
        messages: [{ role: "user", content: buildReplyJudgeUserPrompt({ recentMessages, candidateText }) }],
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS
      });
      const parsed = parseReplyJudgeLlmResponse(extractText(response.content));
      if (!parsed) {
        return undefined;
      }
      return { shouldReply: parsed.should_reply, ...(parsed.reason ? { reason: parsed.reason } : {}) };
    } catch (error) {
      deps.logger.warn?.("conversation_reply_judge_llm_failed", { workspaceId, error });
      return undefined;
    }
  };
}

let defaultConversationReplyJudgeService: ConversationReplyJudgeService | undefined;

export function getDefaultConversationReplyJudgeService(): ConversationReplyJudgeService {
  if (!defaultConversationReplyJudgeService) {
    const dbClient = getSharedDatabaseClient();
    const logger = getDefaultStructuredLogger();
    defaultConversationReplyJudgeService = createConversationReplyJudgeService({
      conversations: createConversationRepository(dbClient.db),
      turns: getDefaultConversationTurnService(),
      llmClassifierFactory: defaultLlmClassifierFactory({
        policyStore: getDefaultBudgetPolicyStore(),
        ledgerStore: getDefaultCostLedgerStore(),
        logger
      }),
      logger
    });
  }
  return defaultConversationReplyJudgeService;
}
