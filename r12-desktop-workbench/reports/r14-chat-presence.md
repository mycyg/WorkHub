# R14 CHAT 批 · W1-B presence-observer · 完成汇报

分支：`r14/chat-presence`
Worktree：`/Users/apple/.codex/worktrees/WorkHub/r14-chat-presence`

## 做了什么

按 `r14-release-readiness/01-chat-design.md` §3/§4 拍板，服务端两件事：

1. **GET /api/presence 读端点**（新文件，未挂载——见下方集成清单）：`apps/api/src/routes/presence.ts` 导出 `createPresenceRoutes(deps)`。
   - `user_ids` 查询串：逗号分隔、去重后 ≤50 个、每个都必须是合法 uuid，否则整体 400（不是部分成功）；空/缺失同样 400。校验全部在 `apps/api/src/routes/uuid-param.ts` 的既有 `isUuidParam` 上做，不引入第二套 uuid 校验。
   - 鉴权：`createCurrentUserMiddleware`（登录 human actor；该中间件解析出的 actor 恒为 `kind:"human"`，无需再判一次）。
   - 同工作区过滤在 SQL 层完成：新仓库函数 `PresenceMembershipRepository.listActiveUserIdsInWorkspace(workspaceId, userIds)`（`packages/db/src/repositories/presence.ts`），用 `inArray` 把候选 id 集合整体推进 `workspace_memberships` 查询，走 `workspace_memberships_workspace_id_idx`，不是全捞回应用层再筛。不可见的 id 直接从响应里消失（不占位、不假装「存在但离线」）。
   - 在线态读侧复用既有 `PresenceStore.getPresenceMap`（`apps/api/src/broker/presence.ts`，双实现 InMemory/Redis，`ONLINE_TTL_SECONDS=120`，由 SSE 心跳驱动）——本批**没有**新造任何在线态存储。
   - 响应保留调用方请求顺序（过滤掉不可见 id，其余顺序不变），形状 `{ presence: [{ user_id, is_online, last_seen_at }] }`，用新契约 schema `presenceListResponseSchema` 校验后再序列化。

2. **conversation.observer.analyzing 瞬态事件**：
   - `packages/contracts/src/enums.ts`：`eventTypes.conversationObserverAnalyzing = "conversation.observer.analyzing"`。
   - `packages/contracts/src/events.ts`：`conversationObserverAnalyzingEventSchema`——完全照 `conversationPresenceTypingEventSchema` 的瞬态模式（`ts`/`expires_at` 同一个 `offset:true, precision:3` 的 datetime 格式，`superRefine` 强制 `expires_at - ts === 30000ms`），区别：`ttl_ms` 锁死 `30000`（比 typing 的 3000 长得多）、`actor` 固定 `conversationAiActorSchema`（`actor_kind:"ai"`，观察者自己触发，不归属某个人类）、`data` 只有 `conversation_id + ttl_ms`（没有 typing 那样的 `user_id`）。
   - `packages/contracts/src/r12-workbench.test.ts`：钉死事件名清单测试从「九个」改「十个」，加了 `conversationObserverAnalyzing`（点名批准的变更）；新增正反例测试 `R14 observer-analyzing events reserve a strict server-owned 30000ms transient contract only`。
   - `apps/api/src/workers/conversation-observer.ts`：新函数 `emitObserverAnalyzing`（照既有 `emitActionCardUpdated` 的尽力而为模式：契约校验失败/broker 发布失败只记 `logger.warn`，不让分析本身失败）。调用点在 `analyzeConversation` 里——**真正提交去分析这个消息窗之后（`messages.length > 0` 已确认）、构建 prompt/调 LLM 之前**：

     ```ts
     const analyzedToSeq = messages[messages.length - 1]!.seq;
     await emitObserverAnalyzing(deps, { conversationId: candidate.conversationId, at: now });
     const senderIds = [...new Set(messages.map(...))];
     // ...roster/prompt/LLM 调用...
     ```
     预算不足（`checkObserverBudget` 返回 false）或消息窗为空这两种「根本不会去分析」的分支都在这个调用点**之前**返回，所以不发——用测试钉死了这两条「不分析时不发」的路径。

## 挂载清单（集成者接线，本批范围围栏禁止直接改）

### `apps/api/src/app.ts`
```ts
import { createPresenceRoutes } from "./routes/presence.js";
// ...
app.route("/api", createPresenceRoutes());
```
不需要新增 `app.onError` 分支——`presence.ts` 只抛 `HTTPException`（400 系列），app.ts 现有的 `HTTPException` 通用分支已经覆盖，`httpErrorCodeFor` 会把 400 映射成 `code: "bad_request"`。

### `apps/api/src/openapi.ts`
补一条路径文档：
- `GET /api/presence?user_ids=<逗号分隔 uuid，≤50 个>`：登录 human actor；响应 `{ ok: true, data: { presence: [{ user_id, is_online, last_seen_at }] } }`；`last_seen_at` 为 ISO datetime 或 `null`（从未见过在线信号）；400 = 缺失/空/非法 uuid/超过 50 个；同工作区之外的 id 静默从结果里过滤掉，不单独报错。

### `apps/api/src/app.test.ts`
未改动（范围围栏禁止）——集成者接线后建议照其余路由模块的既有先例补一条挂载存在性断言。

## 测试数字

| 命令 | 结果 |
|---|---|
| `pnpm --filter @workhub/contracts test` | 114 tests, 114 pass, 0 fail（含新增 observer-analyzing 正反例测试 1 条，钉死清单测试改为「十个」） |
| `pnpm --filter @workhub/api test` | 1258 tests, 1257 pass, 1 skip（既有 skip，与本批无关）, 0 fail（含 presence 路由测试 11 条 + observer-analyzing worker 测试 3 条 + 1 条既有测试的必要更新） |
| `pnpm --filter @workhub/db test` | 288 tests, 286 pass, 2 skip（真 PG 矩阵，本地无库时按既有约定跳过，与本批无关）, 0 fail |
| `pnpm -r typecheck` | 16/16 项目 0 错误 |

新增测试文件：
- `apps/api/src/routes/presence.test.ts`（11 条）：未登录 401、缺失/空白/非法 uuid/超 50 个 400（且不进入 membership/presence 查询）、恰好 50 个的边界通过、membership 过滤确实带正确的 workspaceId 和完整候选集下推到仓库层、工作区外 id 静默丢弃（不是假 offline 占位）、全部不可见时 presence store 完全不被调用、去重且保留请求顺序、响应形状精确匹配契约（含从未见过信号时 `last_seen_at: null`）。
- `apps/api/src/conversation-observer.test.ts` 新增 2 条：`tick publishes conversation.observer.analyzing before analyzing a message window, shaped exactly per contract`、`tick does not publish...when there is no message window to analyze` + `...when budget-blocked before any message window is fetched`。

## 我改过的断言（点名批准之外的必要连锁）

1. `packages/contracts/src/r12-workbench.test.ts` 的「钉死事件名清单」测试——点名批准的变更，九个改十个，加 `conversationObserverAnalyzing`。
2. `apps/api/src/conversation-observer.test.ts` 里 `tick publishes a conversation.action_card.updated event carrying only the minimal renderable summary` 这条既有测试，原断言 `published.length === 1`。这条测试跑的正是「有消息、执行分派」这条路径——现在这条路径会先发一条 `conversation.observer.analyzing`，总发布数变成 2，是本批设计要求的必然结果（不是为了让测试变绿而放宽断言）。改法是**收紧不是放松**：断言总数为 2，显式断言第一条是 `conversation.observer.analyzing`，再按 `type` 过滤出 `action_card.updated` 那一条、保留原有的「只发一条、只带最小可渲染摘要」核心断言不变。这条不在设计文档「点名批准」清单里，但是实现「真正调用 LLM 分析之前发布」这一明确要求的机械必然结果，如果不改这条测试会一直红；已经在这里如实说明，供集成者复核。

## 范围外发现（不修，只报）

- `packages/db/src/repositories/presence.ts` 的 `listActiveUserIdsInWorkspace` 没有专门的仓库层单测（只在 `presence.test.ts` 里通过注入的 `PresenceMembershipRepository` fake 间接验证行为契约）。仓库里其余小型仓库文件（如 `memberships.ts`）同样没有独立的 SQL 级单测，真实 SQL 正确性靠「真 PG 矩阵」测试层（需要本地 docker，本次环境未起）。如果需要真库验证 `inArray` + 软删过滤的实际查询行为，建议集成者接线后顺路跑一次涉及 presence 的 PG smoke，或补一条 real-PG 矩阵测试（照 `workbench.test.ts` 的 `R12 workbench repository real PostgreSQL matrix` 先例）。

## 没做/存疑

- 未跑 `pnpm verify`/PG smoke（范围围栏未要求本批跑库；presence 仓库层只在假 DB/mock 层面测过查询形状）。
- 未改 `apps/api/src/app.ts`/`openapi.ts`/`app.test.ts`（范围围栏严禁），presence 端点因此**尚未真正对外可用**，需集成者按上方「挂载清单」接线。
- 桌面端消费 `observer.analyzing`（typing 指示行同款样式渲染「Cuu 正在整理刚才的讨论…」）是 W2-A desktop-chat-ui 工包（01-chat-design.md §5，等 Wave 1 合并后发车）的范围，本批不涉及任何客户端代码。
