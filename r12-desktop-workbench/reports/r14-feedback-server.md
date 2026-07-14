# R14 批 FEEDBACK · W-A feedback-server 交付报告

> 分支 `r14/feedback-server`（基线 main `52119baa`）· 2026-07-14
> 施工说明书：`r14-release-readiness/04-feedback-design.md`（已定稿，头部集成裁定）
> 验收：`pnpm --filter @workhub/db test`（334，332 过 2 skip）· `pnpm --filter @workhub/contracts test`
> （137 全过）· `pnpm --filter @workhub/api test`（1364，1363 过 1 skip）· `pnpm -r typecheck` 全绿
> 加验：`pnpm audit:migrations` 过 + 迁移链 0000→0058 在 scratch 真库（workhub-postgres-1，PG16）
> 连跑两遍全过（重放安全实证），表形状（唯一索引/两 CHECK/两级联 FK）已逐项核对。

## 1. 端点表（三个路由文件全部**未挂载**，挂载归集成者）

| 文件 | 端点 | 语义 | 成败 |
|---|---|---|---|
| `apps/api/src/routes/conversation-message-feedback.ts` | `PUT /api/conversations/{id}/messages/{messageId}/feedback` | body `{verdict, note?}`，幂等 upsert | 204 / 400(note 超长/注入短语；坏 verdict 在契约层 ZodError) / 403(非真人) / 404(会话不可见、非 Cuu 文字消息、已删除、不存在、非 uuid 形参) |
| 同上 | `DELETE .../feedback` | 幂等撤销 | 204 / 403 / 404(会话不可见；「没反馈」与「不存在」同为幂等 204) |
| `apps/api/src/routes/proposal-feedback.ts` | `PUT /api/proposals/{id}/feedback` | 同上；status 不限（merged/rejected 仍可打分） | 204 / 400 / 403(canReadWorkItem 未过) / 404 |
| 同上 | `DELETE /api/proposals/{id}/feedback` | 幂等 | 204 / 403 / 404 |
| `apps/api/src/routes/action-card-item-feedback.ts` | `PUT /api/action-card-items/{id}/feedback` | 同上；kind/status 不限（UI 层自己收窄） | 204 / 400 / 403(非真人) / 404(不在此工作区) |
| 同上 | `DELETE /api/action-card-items/{id}/feedback` | 幂等 | 204 / 403 / 404 |

鉴权（全在 `apps/api/src/services/ai-feedback.ts` 服务层强制）：

- `conversation_message`：`assertConversationAccess`（既有会话可见性）先行 → 仓库新方法
  `findMessageForFeedback`（workspace 围栏只读定位）→ 必须 `sender_type='cuu' AND kind='text' AND
  deleted_at IS NULL`，否则 404。
- `proposal`：`proposals.get` 存在性 404 → `workItems.canReadWorkItems`（与 GET /proposals/:id 同一判
  定）403。DELETE 同样过闸（防借撤销探测存在性）。
- `action_card_item`：`actionCards.findItemForActor`（与 decide/undo 同款 workspace 围栏，未收紧）404。
- note：trim → 空串=null；>200 → 400 `ai_feedback_note_too_long`；`looksLikeInjection()` 命中 → 400
  `ai_feedback_note_rejected`（复用 skill-curation 的注入短语表，note 未来进 curation prompt）。

## 2. 数据层

- 迁移 `packages/db/migrations/0058_ai_feedback.sql`，journal `idx=58`、`when=1783910000000`、
  `tag=0058_ai_feedback`。多态主体（无真实 FK，audit_logs 先例）+ `workspace_id` 冗余围栏列 +
  `unique(subject_type, subject_id, user_id)`（幂等改判地基）+ curation 主查询索引
  `(workspace_id, subject_type, verdict, updated_at)` + 单主体索引 `(subject_type, subject_id)`。
  全部 `IF NOT EXISTS`，无 CONCURRENTLY。drizzle schema 落 `packages/db/src/schema/core.ts`
  （aiFeedback，紧邻 auditLogs 之后）。
- `schema.test.ts` 尾断言 0057→**0058**（批准变更；RISK 批 0059 顺延，合并时集成者归一）+ 新增 0058
  形状 gate 测试。
- 仓库 `packages/db/src/repositories/ai-feedback.ts`：`upsert`（`ON CONFLICT ... DO UPDATE` 单语句原
  子）/ `remove`（物理删幂等，返回 bool）/ `getForSubject` / `listForSubjects`（页级批量、user_id 过
  滤自见性、空集短路、cap 200）/ **curation 侧预留**（见 §5）。对外行 `AiFeedbackRow` 刻意不含
  workspace_id。

## 3. VM 接缝

- **消息 VM**（`apps/api/src/services/conversations.ts`）：`enrichMessageRows` 从两条并行查询扩到四条
  （+消息级反馈、+行动卡条目反馈，均按 viewer `userId` 过滤）；`messageToVm` 挂 additive
  `my_feedback`（verdict/note?/updated_at），并对 `kind='action_card'` 做**读时合并**
  `content.items[i].feedback`（绝不写回共享 content_json，per-user 语义，设计 §5.3）。
  `ConversationServiceOptions.aiFeedback` 为**可选依赖**：缺省时四条查询回落两条、字段一律不出现——
  既有测试与调用点零回归（enrich 函数签名多了 `viewerUserId` 形参，7 个调用点全部传 `human.userId`）。
  `getDefaultConversationService` 已接默认仓库。
- **提议详情 VM**（`apps/api/src/pages/proposals.ts`）：`buildProposalDetailPage(proposal, locale,
  myFeedback?)` 第三可选参（`ProposalMyFeedback = {verdict, note}` 极简形状，与 db 层解耦）；
  `feedback` 块常驻（两个 mark 动作是常驻 affordance，`my_verdict/my_note` 无判定时为 null，`clear`
  仅有判定时出现），href 全部服务端算好（`PUT/DELETE /api/proposals/:id/feedback` + request_json）。
- **已挂载路由的唯一改动**（设计 §4.2 点名）：`apps/api/src/routes/pages.ts` GET `/proposals/:id`——
  `canReadWorkItem` 403 短路**之后**才查 `aiFeedback.getForSubject`（不给无权限用户泄露反馈存在性），
  依赖注入形状 `deps.aiFeedback?: Pick<AiFeedbackRepository, "getForSubject">`，默认直连共享 DB 客户端
  （照 teamSkills 同款惯例）。
- 行动卡 `ActionCardItemVM`（decide/undo 回执）**不改**——反馈只出现在聊天消息流读取路径（设计 §3.3）。

## 4. 挂载 snippet（给集成者，本批未动 app.ts / openapi.ts / app.test.ts）

```ts
// app.ts imports
import { createConversationMessageFeedbackRoutes } from "./routes/conversation-message-feedback.js";
import { createProposalFeedbackRoutes } from "./routes/proposal-feedback.js";
import { createActionCardItemFeedbackRoutes } from "./routes/action-card-item-feedback.js";
import { AiFeedbackServiceError } from "./services/ai-feedback.js";

// app.ts 路由注册（建议紧邻 createConversationMessageActionRoutes 的注册点）
app.route("/api", createConversationMessageFeedbackRoutes());
app.route("/api", createProposalFeedbackRoutes());
app.route("/api", createActionCardItemFeedbackRoutes());

// app.ts onError（一个 instanceof 分支，照 MemoryConflictServiceError 模板）
if (error instanceof AiFeedbackServiceError) {
  return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
}
```

- openapi.ts：三条路径 × PUT/DELETE 六个操作（请求体 `putAiFeedbackRequestSchema` 形状：verdict 枚举
  二值 + note ≤200 optional；响应 204/400/403/404）；`proposalDetailPageResponseSchema.properties` 加
  `feedback`（**只进 properties 不进 required**——app.test.ts:2833 的 required 断言因此不动）；消息 VM
  的 `my_feedback` 同理只进 properties。
- app.test.ts 路由白名单：+6 条（三路径 × 两方法）。
- 消息路由的会话可见性抛的是既有 `ConversationServiceError`（app.ts 已映射），无需额外分支。

## 5. curation 侧预留（W-B 消费，本批只建仓库层）

- `negativeSamplesSince(workspaceId, since, limit)`：`verdict='not_useful' AND updated_at >= since`，
  `ORDER BY updated_at DESC, id DESC LIMIT`（硬顶 100，命中 `ai_feedback_curation_idx` 零 join 裸索引
  扫描）。改判语义：`updated_at` 即新鲜度窗口——被改判的反馈重新计入本轮信号（设计 §1 注释）。
- `positiveCountsSince(workspaceId, since)`：`{subjectType, count}[]` 聚合，不取全文（防 prompt 膨胀）。
- W-B 还需要的「逐条差评摘要」批量取正文（conversation_message→content_json.text / proposal→title /
  action_card_item→title_md 三组 IN 查询）按设计 §6.1 属 W-B 文件域（skill-curation.ts /
  agent-skill-curation.ts），本批未建——W-B 可用既有各表仓库或自建批量查询，类型依赖
  （`AiFeedbackRow`/`AiFeedbackSubjectType`）已从 `@workhub/db`/`@workhub/contracts` 可导。

## 6. 测试计数（前 → 后）

| 包 | 前 | 后 | 增量 |
|---|---|---|---|
| @workhub/contracts | 132 | 137（全过） | +5（`ai-feedback.test.ts`：枚举钉死/请求体 400/自见 VM/additive 双向零回归/feedback 块形状） |
| @workhub/db | 326 | 334（332 过 2 skip，皆既有真库 matrix skip） | +7（`ai-feedback-repository.test.ts`：onConflict upsert/空 note=null/物理删幂等/自见性 user_id 过滤/空集短路/curation 双查询/limit 夹紧）+1（schema.test 0058 形状 gate） |
| @workhub/api | 1345 | 1364（1363 过 1 skip，既有） | +19（`ai-feedback.test.ts`：三主体鉴权正反例/幂等改判/note 三态/非真人 403/路由 204/422/404/401/VM 富化正反例/提议 VM 三态） |

## 7. 偏离与机械后果（全部列明）

1. **conversations.test.ts +1 拒绝桩**：`ConversationRepository` 新增 `findMessageForFeedback` 的机械
   后果（与历批新增仓库方法的处理完全一致，非断言迁就）。
2. **proposals.test.ts 的 createPageRoutes 注入 `aiFeedback: { getForSubject: async () => null }`**：
   GET /api/pages/proposals/:id 现在真读反馈，单测不连真库——三个既有用例（read page VM / merge 后读 /
   confirm:false 后读）需要这个「无判定」桩，行为断言零改动（机械后果）。
3. **`buildProposalFeedbackVm` 的动作 label 用内联 zh/en 三元**而非 pageT——pages/i18n.ts 的
   PageCopyKey 表不在本批围栏内（加 key 要动那张表）；label 本身照设计 §7.2 由 web 端渲染层消费，
   集成者如要归一到 pageT 是一行改动。
4. **`feedback` 块常驻**（设计 §3.2 说 additive optional）：`buildProposalDetailPage` 总是拼 feedback
   （两个 mark 动作是常驻 affordance，与 review_actions 一致）；契约层仍是 optional（旧客户端/旧响应
   零回归），W-D web UI 判 `vm.feedback` 存在再渲染即可。
5. **迁移真库验证已代做**：0000→0058 scratch 真库连跑两遍 + `pnpm audit:migrations`（集成者全量门
   仍应照 04 手册重跑）。
6. 其余逐字照设计稿：不做 SSE、不做全员聚合、不动三张主体表、不做行动卡备注、DELETE 物理删、
   K5 零新增记账路径。

## 8. 改动清单（3 个 targeted commits）

- `feat(contracts)`：domain/ai-feedback.ts（新）+ index 导出 + conversation.ts `my_feedback` +
  pages.ts `feedback` + 契约测试（新）。
- `feat(db)`：0058 迁移（新）+ journal + schema/core.ts aiFeedback 表 + repositories/ai-feedback.ts
  （新）+ conversations.ts `findMessageForFeedback` + db index 导出 + schema.test 尾断言/0058 gate +
  仓库测试（新）。
- `feat(api)`：services/ai-feedback.ts（新）+ 三路由文件（新，不挂载）+ conversations.ts 读聚合四查询
  + pages/proposals.ts 签名扩充 + routes/pages.ts 详情页接线 + api 测试（新）+ 两处机械桩。
