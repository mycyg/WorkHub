# R14fix · 批 B（服务端 fail-fast + 审批回流）

分支 `r14fix/server`（基线 main `9d362c72`）。修两个已确认真 bug：BUG-02（无 key 仍发外部 LLM 请求、401→泛化 500）与 BUG-04（审批落定无实时 `message.created` 事件）。

---

## BUG-02 · 无 key 仍打 LLM，401 被泛化成 500

### 根因确认
`packages/agent/src/providers/registry.ts` 的 `get()` 是 provider 的唯一入口，此前完全不检查配置，无脑 `transportFactory(route.provider)` 建 transport。缺 `LLM_API_KEY` 时（config 默认空串）拿到一个空 key 的 client；调用侧 `apps/api/src/services/conversation-turns.ts` 拿到 client 就 `messages.stream()` 打 DeepSeek，收 401 后在 `catch`（原 1020-1023）被映射成泛化 `ConversationTurnServiceError(500, "conversation_turn_failed")`。观察者/判定器有 `isConfigured` 守卫、不受影响；真会打 LLM 的是「用户主动 @Cuu / 协同发消息」这条。

### 修法
1. **`registry.get()` fail-fast**（唯一入口）：`requireProviderRoute` 后、建 transport **之前**，若 `route.provider.apiKey.length === 0` → 抛新 typed error `ProviderNotConfiguredError`（`name`/`provider` 稳定，从 `@workhub/agent/providers` 导出）。断言未配置时 `transportFactory` **零调用**。
2. **`conversation-turns.ts` 语义映射**：`ConversationTurnServiceError` 的 status 联合新增 `503`；新增 `toConversationTurnServiceError()` 把 `ProviderNotConfiguredError` 映射成 `503 / ai_provider_not_configured`（文案给部署指引：缺 `LLM_API_KEY`，联系管理员）。主回应的 client acquisition（原 908）包 try/catch 走此映射，fail-fast 发生在打任何 transport 之前。压缩路径（`tryCompactConversationContext`）本就整体 try/catch fail-open，get() 抛错被吞成 undefined，无需改。

### 其他 `registry.get()` 调用点核对（一并覆盖 / 说明为何不需）
| 调用点 | 处置 | 理由 |
|---|---|---|
| `services/conversation-turns.ts`（@Cuu 主路径） | **改**：映射 503 + 测试 | 本 bug 主路径 |
| `services/spotlight-intent.ts`（聚焦盒问 Cuu） | **改**：client acquisition 在 try 外会漏原始错误 → 包 try/catch 映射 `SpotlightIntentServiceError(503, ai_provider_not_configured)`（status 联合加 503） | 同属「用户主动问 Cuu」，避免 raw error 漏到 onError |
| `cross-agent-judge` / `meta-planner` / `work-items` / `agent-memory` / `merge-fusion-candidates` / `conversation-reply-judge` | 不改 | 调用前已有显式 `isConfigured()` 守卫，永不触达 throw |
| `workers/agent-runner.ts`（defaultClient/defaultReviewClient） | 不改 | client acquisition 在 run 执行 try/catch 内（catch → run status=failed）；改后 fail 得更早、错误更清晰，行为无回归 |
| `workers/conversation-observer.ts` | 不改 | `analyzeConversation` 在 per-candidate try/catch 内（记 failed 计数 + warn，best-effort），优雅降级 |
| `workers/agent-skill-curation.ts`（distill/refine） | 不改 | `curateWorkspace` 在 per-workspace try/catch 内（warn 跳过），best-effort |
| `qa/r5-10-*.ts` | 不改 | QA 脚本，真 key 场景，非产线 |

### app.onError 挂载（集成者区 · snippet）
- **`ConversationTurnServiceError` 503：无需改 app.ts**。`app.ts:485-498` 已 `instanceof ConversationTurnServiceError` 并透传 `error.status`（`as 400` 只是 TS cast，运行时用真实 503）。status 联合 additive 加 503 不破坏该 cast。已验证。
- **`SpotlightIntentServiceError` 503：需集成者补分支**。该 error **当前完全不在 `app.onError` 的 instanceof 链里**（是既有缺口——它的 403/429/500 现也会落到兜底 `internal_error` 500）。我在服务层把 raw error 收敛成 typed 503；要在 HTTP 面呈现，集成者应加：

```ts
// apps/api/src/app.ts onError，紧随 ConversationTurnServiceError 分支
import { SpotlightIntentServiceError } from "./services/spotlight-intent.js";
// ...
if (error instanceof SpotlightIntentServiceError) {
  return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
}
```

---

## BUG-04 · 审批落定无实时 `message.created`

### 根因确认
`apps/api/src/routes/proposals.ts` 的 `createDefaultProposalSettledNotifier` 只 `postSystemMessage`（写库落定行）+ 仅在有行动卡血缘（`run.sourceActionCardItemId`）时 publish `conversation.action_card.updated`（军团面板刷新）。**从不 publish `conversation.message.created`**。纯聊天会话（无行动卡条目血缘）里开着来源会话的客户端收不到刚插入的 `proposal_settled` 落定行，只能靠重连补洞。

> 备注：该「写库不广播」是原 `r14-approve-chat.md` §54 的显式设计决策（「与 proposal_opened 同款、实时性交给 action_card.updated」）。QA 验收证实 action_card.updated 只覆盖有行动卡血缘的军团面板，纯会话直接漏——故本批推翻该决策，改为发 message.created。

### 契约前置（真正的堵点）
桌面客户端 `apps/desktop-webview/.../chat/events.ts` 的 `parseIncomingMessageCreated` 用 `conversationMessageCreatedEventSchema.safeParse()` 过闸，失败即静默丢弃。而该 schema 的 `superRefine` 只允许 `human↔user` / `ai↔cuu`——**system_event 消息（sender_type='system'）根本无法通过校验**，直接发也会被客户端丢掉。

**`packages/contracts/src/events.ts`（additive）**：新增与 human/ai 并列的 `conversationSystemActorSchema`（`actor_kind:'system'`，label 可选、无 user_id），加入 `conversationMessageCreatedEventSchema.actor` 联合；`superRefine` 增 `system actor ⟺ sender_type='system' 且 sender_user_id=null` 一支。既有两配对完全不变。因客户端同用 `@workhub/contracts` 包、渲染层已有 system_event 的 sysline 分支，**无需改任何客户端代码**即自动接收。

### 修法
`routes/proposals.ts`：
- `postSystemMessage` 现捕获返回的落库行（`settledMessage`）。
- 抽出可测函数 `publishProposalSettledMessageCreated(deps, input)`（notifier 主体直连 `getSharedDatabaseClient`、脱库难单测，故把事件构造 + 发布这段核心逻辑独立出来）：照既有 message.created 模式 `makeWorkHubEvent` + `parseOutputContract(conversationMessageCreatedEventSchema, …)` + `bus.publish` 到 `topics.conversation`。actor `{actor_kind:'system', label:'WorkHub'}`，`project_id` 取自 `findMergeContext().projectId`，data 是落库行的 VM。**best-effort**：发布失败仅 `warn('proposal_settled_message_created_publish_failed')`，不影响消息已落库。
- notifier 主体在 `postSystemMessage` 后、action_card.updated 之前调用它。

---

## 挂载清单（集成者）
1. **app.onError**：`SpotlightIntentServiceError` 需补 instanceof 分支（snippet 见上）；`ConversationTurnServiceError` 无需改（503 已透传）。
2. **openapi.ts（可选文档）**：`conversation.message.created` 事件的 actor 现多一种 `system`。openapi 未对该 event actor 做严格 schema（仅 `openapi.ts:5913` 一句 prose 描述 Cuu 回复用 ai actor，仍准确），无结构性破坏；如需精确可补一句「审批落定回流用 system actor」。
3. 无 DB 迁移、无新表新列（proposal_settled content 仍走 `boundedConversationObjectContentSchema` 宽松边界）。

## 测试计数（全绿）
| 套件 | 结果 | 本批新增 |
|---|---|---|
| `@workhub/agent test` | 165 pass / 0 fail | +2（get() 未配置 fail-fast + transportFactory 零调用；createDefaultProviderRegistry fail-fast）；另重写 1 例（默认注册表换沉降槽改用已配置注册表） |
| `@workhub/contracts test` | 147 pass / 0 fail | +1（message.created 接受 system actor + 反例） |
| `@workhub/api test` | 1450 pass / 1 skip(既有) / 0 fail | +3（BUG-02 turn 映射 503 无 stream 无落库；BUG-04 发 schema-valid message.created 到源会话 topic；BUG-04 best-effort 发布失败仅 warn） |
| `pnpm -r typecheck` | 全 17 包 Done | — |
| （非门，回归确认）desktop-webview 1130 / web 83 / events 18 | 全 pass | 契约 additive 未破客户端 |

## 偏离
- **契约改动**：BUG-04 必须扩 `conversationMessageCreatedEventSchema` 支持 system actor（否则客户端 safeParse 丢弃、修了等于没修）。原 `r14-approve-chat.md` 记「packages/contracts 未动」，本批推翻——这是让实时回流真正落地的前置。packages/contracts 不在禁区，且 `@workhub/contracts test` 是要求门。
- **spotlight-intent 一并覆盖**：超出 BUG-02 点名的 conversation-turns，但其 client acquisition 在 try 外会漏 raw error，属「用户主动问 Cuu」同类路径，顺手收敛成 typed 503（HTTP 呈现依赖集成者补 app.onError 分支——既有缺口，已在挂载清单标注）。
- **抽函数 `publishProposalSettledMessageCreated`**：为可测性把发布逻辑从直连 DB 的 notifier 主体里抽出（导出供单测）；notifier 行为等价。
