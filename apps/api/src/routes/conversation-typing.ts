import { Hono } from "hono";

import { conversationPresenceTypingEventSchema, eventTypes } from "@workhub/contracts";
import { makeWorkHubEvent, topics } from "@workhub/events";

import { getDefaultPushBus, type PushBus } from "../broker/index.js";
import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import { parseOutputContract } from "../pages/output-contract.js";
import {
  ConversationServiceError,
  getDefaultConversationService,
  type ConversationService
} from "../services/conversations.js";
import { isUuidParam } from "./uuid-param.js";

// R12 批 2(主区群聊,typing 生产者):这个路由模块故意 **不挂载** 进 apps/api/src/app.ts——挂载是
// 集成者的活(照 routes/conversation-army.ts 的先例:批 5 写好不挂,wave-1 集成者统一挂进 app.ts；
// 见 r12-desktop-workbench/reports/batch-2-chat.md 的「挂载清单」)。
//
// 只导出 createConversationTypingRoutes(deps)，跟 routes/conversations.ts / routes/conversation-army.ts
// 的既有写法保持一致。参与者鉴权直接复用 conversations 服务已有的 assertConversationAccess——不新开
// 第二条会话可见性判定 SQL（main=项目所属工作区 active membership，collab=参与者且租户一致，两条判定
// 只应该有一处实现，否则迟早漂移）。事件 shape 严格照 packages/contracts/src/events.ts 的
// conversationPresenceTypingEventSchema（服务端用户身份、固定 3000ms 过期，ts/expires_at 精确相差
// 3000ms）；typing 是瞬态信号，只发 SSE，不落库，broker 发布失败也不算请求失败（尽力而为，同
// conversations.ts 的 createMessage 对 message-created 发布失败的处理方式一致：记警告日志，仍 2xx）。

const TYPING_TTL_MS = 3000 as const;
// composer 侧已经按 2s 节流调用这个端点——这里的 1s 会话内去重是第二道防线，防多标签页/网络重试/
// 键盘连击造成的短时突发把同一条 SSE 主题灌爆，不是主力节流手段。
const TYPING_DEDUPE_WINDOW_MS = 1000;
// 纯内存去重表按 (会话, 用户) 计数，键空间受真实活跃会话数 × 真实在线用户数限制，不是攻击者可控的
// 无界输入；仍然给一个硬上限做兜底驱逐——04 §4 铁律 4「不许无上限增长」的精神同样适用于常驻内存态，
// 不只是列表查询。
const MAX_TYPING_DEDUPE_ENTRIES = 5000;

// 导出以便单测直接验证去重/驱逐语义，而不是只能通过多次 HTTP 往返间接断言。
export class TypingDedupeGate {
  private readonly lastSentAtMs = new Map<string, number>();

  constructor(
    private readonly windowMs: number = TYPING_DEDUPE_WINDOW_MS,
    private readonly maxEntries: number = MAX_TYPING_DEDUPE_ENTRIES
  ) {}

  // true = 这次真的该发布；false = 在去重窗口内，静默跳过发布（依然是成功响应，不是错误——
  // 调用方节流打得比服务端窗口更密只是浪费一次往返，不该报错）。
  shouldPublish(key: string, nowMs: number): boolean {
    const last = this.lastSentAtMs.get(key);
    if (last !== undefined && nowMs - last < this.windowMs) {
      return false;
    }
    if (!this.lastSentAtMs.has(key) && this.lastSentAtMs.size >= this.maxEntries) {
      // Map 保留插入顺序：驱逐最旧的一条腾位置，而不是拒绝这次请求——typing 是尽力而为的瞬态信号，
      // 偶发的一次「本该去重却没去重」远比拒绝用户的正常输入信号无害。
      const oldestKey = this.lastSentAtMs.keys().next().value;
      if (oldestKey !== undefined) {
        this.lastSentAtMs.delete(oldestKey);
      }
    }
    this.lastSentAtMs.set(key, nowMs);
    return true;
  }
}

export type ConversationTypingRoutesDependencies = {
  auth?: AuthDependencySource;
  conversations?: ConversationService;
  bus?: Pick<PushBus, "backend" | "publish">;
  logger?: Pick<StructuredLogger, "warn">;
  now?: () => Date;
  gate?: TypingDedupeGate;
};

function requireConversationId(value: string) {
  // uuid 参数守卫：非法串直接 404，和「合法但不存在的 uuid」同一形状（照 routes/uuid-param.ts 既有
  // 用法，conversations.ts/conversation-army.ts 的 requireConversationId 是同款先例）。
  if (!isUuidParam(value)) {
    throw new ConversationServiceError(404, "conversation_not_found", "没有找到这个会话。");
  }
  return value;
}

export function createConversationTypingRoutes(deps: ConversationTypingRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const conversations = deps.conversations ?? getDefaultConversationService();
  const bus = deps.bus ?? getDefaultPushBus();
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const now = deps.now ?? (() => new Date());
  const gate = deps.gate ?? new TypingDedupeGate();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  routes.post("/conversations/:id/typing", requireCurrentUser, async (c) => {
    const conversationId = requireConversationId(c.req.param("id"));
    // 参与者鉴权：复用 conversations 服务已有的可见性判定——非会话参与者/租户不一致一律在这里被拒
    // （404，和「会话不存在」同形状，不向无权限调用方泄露存在性）；非人类 actor 在这一步已经被
    // requireHumanActor 挡下（ConversationServiceError 403）。
    await conversations.assertConversationAccess({ actor: c.var.actor, conversationId });

    const userId = c.var.actor.userId?.trim();
    if (!userId) {
      throw new ConversationServiceError(403, "human_required", "需要已加入工作区的真人用户才能发送输入中信号。");
    }

    const nowDate = now();
    const nowMs = nowDate.getTime();
    if (!gate.shouldPublish(`${conversationId}:${userId}`, nowMs)) {
      return c.json({ ok: true, data: { published: false } }, 202);
    }

    const conversationTopic = topics.conversation(conversationId).topic;
    const label = c.var.actor.label;
    const event = parseOutputContract(
      conversationPresenceTypingEventSchema,
      makeWorkHubEvent({
        type: eventTypes.conversationPresenceTyping,
        topic: conversationTopic,
        ts: nowDate,
        actor: {
          actor_kind: "human",
          actor_user_id: userId,
          ...(label ? { label } : {})
        },
        data: {
          conversation_id: conversationId,
          user_id: userId,
          ttl_ms: TYPING_TTL_MS,
          expires_at: new Date(nowMs + TYPING_TTL_MS).toISOString()
        }
      }),
      "conversations.typing.event"
    );

    try {
      await bus.publish(conversationTopic, eventTypes.conversationPresenceTyping, event);
    } catch (error) {
      // 同 conversations.ts createMessage 的既有处理方式：broker 发布失败尽力而为，记警告不报错——
      // typing 本就允许丢，下一次节流周期还会再发一次，不值得让整个请求失败。
      logger.warn("conversation_typing_publish_failed", {
        event_id: event.event_id,
        topic: conversationTopic,
        conversation_id: conversationId,
        broker_backend: bus.backend,
        error
      });
    }

    return c.json({ ok: true, data: { published: true } }, 202);
  });

  return routes;
}
