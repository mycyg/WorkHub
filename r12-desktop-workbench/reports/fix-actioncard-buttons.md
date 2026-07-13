# 修复 P0-A1：行动卡桌面按钮 + decide/undo 接线

日期: 2026-07-13 · 分支: `r12/fix-actioncard-buttons`（拉自 `7e9d4b17`）

## 背景

`r12-desktop-workbench/reports/functional-review-2026-07-13.md` A1 记录：「行动卡渲染无任何按钮；
POST /api/action-card-items/:id/decide|undo 全仓库零调用方」。服务端语义（`apps/api/src/services/
action-cards.ts`）与路由（`apps/api/src/routes/action-cards.ts`，已挂载在 `app.ts:242` 的 `/api` 下）
本批确认健全、无需改动；缺口纯粹在客户端——`chat/render.ts` 只渲染纯文字状态标，没有任何按钮，
调用链完全没有接上。本批把按钮和调用链补上，范围仅限 `packages/db/src/repositories/action-cards.ts`
（+ 测试）与 `apps/desktop-webview/src/workbench/chat/**`。

## 做了什么

1. **`packages/db/src/repositories/action-cards.ts`**：`itemSummary`/`buildActionCardMessageContent`
   给行动卡消息内容的条目摘要增补 `assignee_user_id`/`undo_deadline_at` 两个只增字段（`undo_deadline_at`
   按仓库既有惯例转 ISO 字符串）。`createNewCard` 路径此前遗漏了这两个字段的映射（只在 `appendToCard`
   路径里因为直接透传整行 DB row 而"意外"带上），现在两条路径都显式补齐。SSE 事件契约
   （`conversationActionCardUpdatedEventSchema`）**未改动**——那是 strict schema；消息 content 是
   bounded 松对象，只增字段不算破坏性变更。
2. **`chat/api.ts`**：新增 `decideActionCardItem({itemId,action,assigneeUserId?})` 与
   `undoActionCardItem({itemId})`，照既有 `client.request` 薄封装模式（同 `requestConversationTurn`
   等既有会话端点一样，不为这两个路由本地 schema 端点扩大 `@workhub/api-client` 的具名方法面）。
3. **`chat/render.ts`**：`renderActionCardSummaryHtml` 从"只读状态标"升级为真实操作区，按
   kind×status×是否本人×撤销窗口内外渲染：
   - `kind==='decide' && status==='waiting_decision'`：本人（`assignee_user_id===currentUserId`）见
     「交给我干」(claim) / 「派给别人」(reassign，点开极简成员选择器，选中即提交，列表排除自己)
     / 「先不动」(defer) 三键；非本人见纯文字「等 @昵称 拍板」，查不到昵称落「负责人」。
   - `kind==='execute' && status==='running'`：本人 + `undo_deadline_at` 未过期见「撤销（N 分钟内）」
     danger 按钮（`computeUndoRemainingMinutes` 纯函数按渲染时刻算，向上取整，不开倒计时
     interval）；过期/无 deadline/非本人都不渲染按钮（不摆会点出 409 的死按钮）。
   - decide/undo 失败后的温和行内提示复用 `.wh-wb-chat-actioncard-note` 中性样式渲染在操作区下方。
   - 删除了过期的「撤销/指派的操作按钮由后续批次接入这个窗口」注释与 note 文案。
   - 按钮全部复用既有 `.wh-wb-act` 类，撤销用 `.wh-wb-act wh-wb-act--danger`（未碰 `css.ts`）。
4. **`chat/timeline.ts`**：
   - 新增 `computeUndoRemainingMinutes(iso, nowMs)` 纯函数。
   - 扩展 `applyActionCardUpdate` 的 patch 形状，`items[]` 新增可选 `assigneeUserId`/`undoDeadlineAt`
     字段——SSE 调用点不传（未定义时完全不碰这两个键，行为与批 3 落地时逐字节一致，靠新增单测锁死）；
     decide/undo 的 HTTP 响应走同一条合并函数，多传这两个字段即可就地更新快照。
   - 新增 `findActionCardMessageIdForItem(messages, itemId)`：按条目 id 反查它挂在哪条 `action_card`
     消息下（本地内存扫描，view.ts 只知道被点的条目 id，不知道消息归属）。
5. **新增 `chat/action-card-decision.ts`**：`mapActionCardDecisionError`（403/409/422 等错误码 →
   温和中文/英文文案，未识别码落通用重试文案，不泄漏内部 code，同 `turn.ts` 的
   `mapConversationTurnError` 同款取舍）与 `shouldReconcileActionCardOnError`（仅
   `action_card_item_already_decided`/`action_card_decision_already_resolved` 两个 409 码触发"本地
   快照过期，重取消息对账"）。
6. **`chat/view.ts`** 接线：新增 `openReassignItemId`/`actionCardItemErrors` 两个瞬态状态；
   `submitActionCardDecision`/`submitActionCardUndo` 调 API，成功后用响应的条目 VM 走
   `applyActionCardUpdate` 就地更新本地消息（不等 SSE，SSE 到达时按 id 幂等覆盖，行为一致）；
   失败时 `handleActionCardDecisionError` 设置行内错误文案，`already_decided`/`already_resolved` 额外
   触发 `refreshActionCardMessage`（既有的按需补拉函数）做一次对账。`scrollEl` 的既有点击委托新增
   四类 `data-wb-chat-actioncard-*` 属性的处理分支。

## 自查

```
pnpm --filter @workhub/desktop-webview test   # 652 passed（改动前 620，本批 +32 新测试）
pnpm --filter @workhub/db test                # 238 passed / 2 skipped（真 PG 矩阵，环境无库，既有基线一致）
pnpm -r typecheck                              # 16/16 workspace 全绿
git status --porcelain                         # 只有围栏内文件，无越权改动
```

新增/改动测试文件：
- `packages/db/src/action-cards-repository.test.ts`（既有 2 条断言扩充，覆盖新字段落库）
- `apps/desktop-webview/src/workbench/chat/api.test.ts`（+5：decide 3 条/undo 2 条）
- `apps/desktop-webview/src/workbench/chat/render.test.ts`（+17：按钮可见性矩阵全覆盖 + 行内错误提示
  + 过期注释已删除的回归断言）
- `apps/desktop-webview/src/workbench/chat/timeline.test.ts`（+10：`computeUndoRemainingMinutes` 5 条 /
  `findActionCardMessageIdForItem` 2 条 / `applyActionCardUpdate` 新增合并分支 3 条）
- `apps/desktop-webview/src/workbench/chat/action-card-decision.test.ts`（新文件，9 条）

## 改过的断言

无——本批只新增断言/新增测试文件，未修改任何既有断言的期望值。

## 范围外发现（不修，只报）

- `functional-review-2026-07-13.md` A1 的完整现象还包含「dispatch_ask 问询有问无答」（通知 severity
  不弹横幅）、「Cuu 气泡丢弃 workItemId/targetUrl 只深链到主区」（`desktop-cuu-runtime.ts:915-940`）。
  这两项是通知/桌宠气泡链路，不在本批范围（`apps/desktop-webview` 的其它模块，未触碰）。
- A2「decide 类条目借用通用 escalation 卡，文案语义不匹配」与 A3「反向死锁：web 先 resolve 掉升级后，
  decide 端点 `requireUnresolvedEscalation` 前置检查 409 already_resolved，卡永久卡死」——都需要改
  `apps/api/src/services/escalations.ts`，明确在本批范围围栏之外（禁碰 apps/api），未处理。
- 行动卡撤销按钮的分钟数目前每次 `renderScroll()` 时用真实"现在"重新计算（不开 interval，符合任务要求
  "不做倒计时"），但如果用户长时间不触发任何重渲染，显示的剩余分钟数会静止不动直到下一次操作/SSE
  事件触发重渲——这是任务明确要求的取舍，不是遗漏。
- 未做真机（.app）交互验收——桌面 webview 在浏览器预览里跑不出 Tauri 环境，本批验收止于
  typecheck + 单测（渲染 HTML 断言 + 纯函数逻辑），同仓库既有惯例（见 R8/R12 多份报告的"桌面 UI
  在浏览器验不了"记录）。真机点击验收待人工用 `.app` 补。

## 没做/存疑

- 无。任务范围内五项交付（db 字段/api 函数/render 按钮/view 接线/纯函数测试）均已完成并全绿。
