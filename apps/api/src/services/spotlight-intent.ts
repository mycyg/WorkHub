import { z } from "zod";

import { settings as runtimeSettings, type Settings } from "@workhub/config";
import {
  buildSpotlightIntentSystemPrompt,
  buildSpotlightIntentUserPrompt,
  parseSpotlightIntentResponse,
  spotlightIntentCapabilitySchema,
  spotlightIntentResultSchema,
  type SpotlightIntentResult
} from "@workhub/agent/spotlight-intent";
import { ProviderNotConfiguredError } from "@workhub/agent/providers";
import { decideRunBudget, type BudgetPolicyStore, type CostLedgerStore } from "@workhub/cost";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";

// R13 批 S1（聚焦盒 AI 入口，服务端切片）：POST /spotlight/intent 的业务逻辑。轻量直调形态照
// apps/api/src/services/conversation-turns.ts 顶部注释的既有取舍（provider registry + 软预算 +
// 超时），但比 turn 更轻：
// 1. 不建 conversation/agent_run/work_item——这只是一次「这句话该干什么」的分类，不落库、不建会话。
// 2. 用非流式 messages.create（同构 conversation-observer.ts 的分析调用），不是 turn 的 messages.stream——
//    分类结果是一整块 JSON，没有「边生成边展示」的场景，流式在这里只会增加复杂度而没有收益。
// 3. 15s 硬超时（比 turn 的 60s 更短：分类任务应该很快出结果，卡住 15s 还没回就该让用户重试而不是
//    干等一次完整对话轮次的时长）。
// 4. 失败温和 500：LLM 调用失败、解析失败、结果里的 open_page 页面不在调用方提供的能力清单里——
//    全部统一映射成同一个 spotlight_intent_failed，不区分给客户端（区分了也没有客户端能采取的
//    不同动作，都是「换个说法再试一次」）。

export class SpotlightIntentServiceError extends Error {
  constructor(
    // BUG-02：新增 503——目标 LLM provider 未配置（缺 apiKey）时返回「服务暂不可用」而非泛化 500。
    public readonly status: 400 | 403 | 429 | 500 | 503,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SpotlightIntentServiceError";
  }
}

// BUG-02：provider registry 的 get() 在缺 apiKey 时 fail-fast 抛 ProviderNotConfiguredError（发生在建
// transport / 发上游请求之前）。这里映射成明确的 503，与 conversation-turns 的「用户主动问 Cuu」路径一致，
// 而不是让原始错误漏到 app.onError 被泛化成 500。
const AI_PROVIDER_NOT_CONFIGURED_MESSAGE =
  "Cuu 暂时不可用：这个部署还没有配置 LLM 服务的密钥（LLM_API_KEY）。请联系管理员完成配置后再试。";

export const createSpotlightIntentRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    // 桌面端 command-palette.ts 的 commandRegistry 摊平后的可用能力清单——服务端只按这份清单校验
    // open_page 分类结果，不持有一份自己的硬编码能力枚举（见 packages/agent/spotlight-intent/schema.ts
    // 顶部注释：包依赖方向 + 能力清单本就该由调用方决定）。
    capabilities: z.array(spotlightIntentCapabilitySchema).min(1).max(64)
  })
  .strict();
export type CreateSpotlightIntentRequest = z.infer<typeof createSpotlightIntentRequestSchema>;

// 最小 LLM 客户端形状——只要求非流式 create 接口（同构 apps/api/src/workers/conversation-observer.ts
// 的 ObserverLlmClient）。真实 wiring 用 ProviderRegistry.get(...).messages.create(...)。
export type SpotlightIntentLlmContent = { type: string; text?: string };
export type SpotlightIntentLlmResponse = { content: SpotlightIntentLlmContent[] };
export type SpotlightIntentLlmClient = {
  messages: {
    create: (input: {
      maxTokens: number;
      source: "agent_step";
      system: string;
      messages: Array<{ role: "user"; content: string }>;
      signal?: AbortSignal;
      timeoutMs?: number;
    }) => Promise<SpotlightIntentLlmResponse>;
  };
};
export type SpotlightIntentClientProvider = (input: {
  actorId: string;
  userId: string;
  workspaceId: string;
}) => SpotlightIntentLlmClient | Promise<SpotlightIntentLlmClient>;

export type SpotlightIntentServiceDeps = {
  client: SpotlightIntentClientProvider;
  policyStore: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore: Pick<CostLedgerStore, "usageSnapshots">;
  settings?: Settings;
  logger?: Pick<StructuredLogger, "warn">;
  now?: () => Date;
  maxResponseTokens?: number;
  timeoutMs?: number;
};

export type SpotlightIntentService = {
  createIntent(input: {
    actor: AuthActor;
    payload: CreateSpotlightIntentRequest;
  }): Promise<SpotlightIntentResult>;
};

const DEFAULT_MAX_RESPONSE_TOKENS = 400;
const DEFAULT_TIMEOUT_MS = 15_000;

type HumanIntentActor = { userId: string; workspaceId: string };

function requireHumanActor(actor: AuthActor): HumanIntentActor {
  const workspaceId = actor.workspaceId.trim();
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw new SpotlightIntentServiceError(403, "human_required", "需要已加入工作区的真人用户才能问 Cuu。");
  }
  return { userId, workspaceId };
}

function extractText(content: SpotlightIntentLlmContent[]): string {
  return content
    .filter((block): block is { type: string; text: string } => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

// 软预算闸——与 conversation-turns.ts 的 checkTurnBudget 同款理由：分类调用不建 work_item/agent_run，
// 没有可挂靠的 run_id 走原子 reservation，改用调用前读团队维度已用量快照做门槛判断；调用本身仍通过
// ProviderRegistry 的 usageSink 计入 cost_ledger_entries（真实成本记账），只是不参与并发原子预留互斥。
async function checkSpotlightIntentBudget(deps: SpotlightIntentServiceDeps, workspaceId: string, at: Date): Promise<boolean> {
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

export function createSpotlightIntentService(deps: SpotlightIntentServiceDeps): SpotlightIntentService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();

  return {
    async createIntent(input) {
      const human = requireHumanActor(input.actor);

      const budgetOk = await checkSpotlightIntentBudget(deps, human.workspaceId, now());
      if (!budgetOk) {
        throw new SpotlightIntentServiceError(429, "spotlight_intent_budget_exhausted", "这个工作区今天的 AI 预算已经用完了。");
      }

      const system = buildSpotlightIntentSystemPrompt();
      const userPrompt = buildSpotlightIntentUserPrompt({
        query: input.payload.query,
        capabilities: input.payload.capabilities
      });

      // BUG-02 fail-fast：get() 缺 apiKey 时会在建 transport 前抛 ProviderNotConfiguredError；映射成 503。
      let client: SpotlightIntentLlmClient;
      try {
        client = await deps.client({ actorId: human.userId, userId: human.userId, workspaceId: human.workspaceId });
      } catch (error) {
        if (error instanceof ProviderNotConfiguredError) {
          throw new SpotlightIntentServiceError(503, "ai_provider_not_configured", AI_PROVIDER_NOT_CONFIGURED_MESSAGE);
        }
        throw error;
      }
      const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      let text: string;
      try {
        const response = await client.messages.create({
          maxTokens: deps.maxResponseTokens ?? DEFAULT_MAX_RESPONSE_TOKENS,
          source: "agent_step",
          system,
          messages: [{ role: "user", content: userPrompt }],
          timeoutMs
        });
        text = extractText(response.content);
      } catch (error) {
        logger.warn("spotlight_intent_llm_failed", { error });
        throw new SpotlightIntentServiceError(500, "spotlight_intent_failed", "Cuu 没能理解这句话，请再试一次或换个说法。");
      }

      const allowedPageIds = input.payload.capabilities.map((capability) => capability.id);
      const result = parseSpotlightIntentResponse(text, allowedPageIds);
      if (!result) {
        logger.warn("spotlight_intent_parse_failed", { textLength: text.length });
        throw new SpotlightIntentServiceError(500, "spotlight_intent_failed", "Cuu 没能给出可用的判断，请再试一次。");
      }

      return parseOutputContract(spotlightIntentResultSchema, result, "spotlight-intent.result");
    }
  };
}

let defaultSpotlightIntentService: SpotlightIntentService | undefined;

function defaultClientProvider(): SpotlightIntentClientProvider {
  return ({ actorId, userId, workspaceId }) =>
    getDefaultProviderRegistry().get({ id: actorId, userId, workspaceId }, "assistant") as unknown as SpotlightIntentLlmClient;
}

export function getDefaultSpotlightIntentService(): SpotlightIntentService {
  if (!defaultSpotlightIntentService) {
    defaultSpotlightIntentService = createSpotlightIntentService({
      client: defaultClientProvider(),
      policyStore: getDefaultBudgetPolicyStore(),
      ledgerStore: getDefaultCostLedgerStore(),
      logger: getDefaultStructuredLogger()
    });
  }
  return defaultSpotlightIntentService;
}
