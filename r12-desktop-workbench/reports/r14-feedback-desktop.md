# R14 批 FEEDBACK · W-C feedback-desktop 施工汇报

- 分支：`r14/feedback-desktop`
- 施工说明书：`r14-release-readiness/04-feedback-design.md` §7.1（桌面 UI）+ §8（字符 tile 视觉边界）
- 服务端依赖：`r12-desktop-workbench/reports/r14-feedback-server.md`（三组端点已挂载，基线含
  `feat(api): mount the R14 feedback routes`）
- 验收自查：`pnpm --filter @workhub/desktop-webview test`（**1079/1079** 通过，基线 1048，+31）+
  `pnpm -r typecheck`（16 个受影响包全绿）

## 1. 做了什么

### §7.1A Cuu 文字消息反馈——hover 工具条

`renderMessageToolbarHtml`（`chat/render.ts`）在五键反应之后追加两枚字符 tile 按钮
（`data-wb-chat-feedback="useful"/"not_useful"`），仅当 `message.sender_type === "cuu" &&
message.kind === "text"` 时渲染——写入端点服务层已经做过同款收紧，这里是渲染层的镜像收紧（不是重复
校验，是两层各自独立拒绝）。已判定态用 `wh-wb-chat-tool--fb-on-useful`/`--on-not-useful` 高亮
（`aria-pressed`同步）。字形是纯排版符号 `✓`/`✗`（U+2713/U+2717），不复用 `workbenchIcons.check`、不
落进 `REACTION_EMOJI` 那套 emoji 豁免。

### §7.1B 持久态徽标 + 备注编辑

- `renderMessageFeedbackBadgeHtml`：who 行「已编辑」灰标之后追加一枚常驻小 tile（不依赖 hover），只在
  `message.my_feedback` 存在时渲染，颜色随判定（成功绿/警示黄弱化）。点击 badge → 展开/收起一句话备注
  编辑框。
- `renderMessageFeedbackNoteBoxHtml`：单行 `textarea`（`rows=1`，`maxlength` 取
  `AI_FEEDBACK_NOTE_MAX_CHARS`，同 `renderMessageEditBoxHtml` 的结构），保存/跳过两个按钮，失败时行内
  展示温和错误提示（复用 `.wh-wb-chat-edit-error`）。不做备注是主路径默认状态——不点开 badge 什么都不
  会发生。
- `view.ts`：新状态 `feedbackNoteEditor`（一次只展开一条，与行内编辑正文/删除确认三者互斥，各自的
  `beginEdit`/`requestDelete`/`toggleFeedbackNoteEditor` 会清掉另外两个）。`toggleMessageFeedback` 做
  乐观 PUT/DELETE + 失败静默回滚（同 `toggleReaction` 的既有纪律）；改判（点另一个键）时把已有备注带
  过去，避免覆盖式 PUT 不带 note 默默清空用户已填的备注。`saveFeedbackNote` 保存失败会重新打开编辑框
  并带上错误文案（400 note 超长/命中注入短语拦截时的措辞；其余错误走通用兜底），不是无声丢字。

### §7.1C 行动卡条目反馈

`renderActionCardItemFeedbackHtml`（class 前缀独立 `wh-wb-chat-actioncard-fb-*`，避免和消息级选择器
混淆）只在**终态**（`done`/`escalated`）且**未撤销**的条目行末追加二值 tile（`data-wb-chat-
actioncard-feedback`）；`waiting_decision`/`running` 还没有可评判的结果、`undone` 已经整行置灰划线，
两种都不渲染入口。不做备注输入（条目已经很密集，备注需求主要在 Cuu 文字回复上，设计 §7.1C 明文排除）。
数据源是 §5.3 读时合并进 `content.items[i].feedback` 的字段（`ActionCardItemRow` 加 `feedback:
AiFeedbackVerdict | undefined`，解析时防御式收窄，只认 `"useful"|"not_useful"`）。

### 新文件 `chat/feedback.ts`（纯逻辑，无 DOM）

- `decideFeedbackToggle(current, clicked)`：点未选中键=put；点已选中键=delete（撤销）；点另一个键=put
  新 verdict（覆盖式改判，不先 delete）——镜像 `reactions.ts` 的 `toggleOwnReaction`，但反馈是单值判定，
  没有 `user_ids` 数组要维护，逻辑更简单。
- `normalizeFeedbackNote(raw)`：trim 后空串→`undefined`（同服务层「trim→null」口径，客户端提前归一）。

### `chat/timeline.ts` 新增落地函数（本地消息数组的乐观合并，同 `applyReactionUpdate` 一族的分工）

- `applyMessageFeedbackUpdate`：把 `my_feedback` 键整体设值/摘除（`exactOptionalPropertyTypes` 下用
  `delete` 摘键而不是设 `undefined`）。
- `applyActionCardItemFeedbackUpdate`：按 `itemId` 找到归属的 `action_card` 消息（复用既有
  `findActionCardMessageIdForItem`），就地替换命中条目的 `feedback` 键，其余条目原样透传。
- `findActionCardItemFeedbackVerdict`：从本地快照读出"本人对某条目的当前判定"，供 toggle 处理器算
  `decideFeedbackToggle` 的 `current` 参数，不需要额外网络往返。

### `chat/api.ts` 薄封装

`putConversationMessageFeedback`/`deleteConversationMessageFeedback`（`PUT/DELETE
/api/conversations/:id/messages/:messageId/feedback`）+
`putActionCardItemFeedback`/`deleteActionCardItemFeedback`（`PUT/DELETE
/api/action-card-items/:id/feedback`，不支持 note 参数）。全部走既有 `client.request` 薄封装模式（不
扩大 `WorkHubApiClient` 具名方法面），204 无响应体。

### `css.ts`

新增 `.wh-wb-chat-fb-glyph`/`.wh-wb-chat-tool--fb-on-useful`/`--on-not-useful`（工具条按钮变体）、
`.wh-wb-chat-fb-badge`/`--useful`/`--not-useful`（持久徽标）、`.wh-wb-chat-fb-note*`（备注编辑行）、
`.wh-wb-chat-actioncard-fb*`（行动卡条目 tile），插在既有 `.wh-wb-chat-reaction*`/`.wh-wb-chat-tools*`
规则块之后（design §8.5 指定位置）。`useful` 用 `--ds-success`（同产出卡终态行语汇），`not_useful` 用
`--ds-warn` 弱化语汇而非满饱和度 `--ds-danger`（避免抢"删除"按钮的视觉分量，design §8.5 建议）。全部
新增，未动任何既有 `.wh-wb-chat-*` 规则串。

## 2. SSE / 无反馈事件（设计 §0 结论 3/§9）

没有接任何反馈相关 SSE 事件——本地乐观状态即真相，下次该消息/该会话自然重拉时以服务端 VM 的
`my_feedback`/`content.items[i].feedback` 为准兜底。失败均静默回滚，不弹阻断。

## 3. 偏离说明

1. **改判时携带已有备注**（设计原文只说"点另一个键=直接 put 新 verdict"，未明确 note 去留）——
   覆盖式 PUT 不带 note 字段时，服务端会把 note 置空（`payload.note ?? null`）。为避免用户改判时静默
   丢失已填的备注，`toggleMessageFeedback` 在改判分支把 `previous?.note` 一并带进新的 PUT body。这是
   对设计留白处的最保守、无害延伸（不改变端点契约，只改变客户端何时发 note 字段），不影响任何既有
   断言。
2. **备注保存失败时重新打开编辑框并展示错误**——设计 §7.1B 只描述了成功路径（"确认即 PUT 带上
   note"），没有细化失败态。照 CHAT 批 `saveEdit` 对 409 的既有纪律（失败时保留编辑框 + 温和文案，不
   静默清空用户输入）做了对称处理：400（note 超长/注入短语）给出针对性文案，其余错误走通用兜底。
3. 其余逐字照设计稿：字符 tile 非 emoji、行动卡条目无备注 UI、渲染层收紧镜像服务层收紧、不碰
   `renderDeliverableCardHtml`/`workbench/proposal/**`/`workbench/army/**`。

## 4. 测试

| 文件 | 新增 | 覆盖 |
|---|---|---|
| `chat/feedback.test.ts`（新） | 4 | `decideFeedbackToggle` 三分支 + `normalizeFeedbackNote` 空白归一 |
| `chat/timeline.test.ts` | +10 | `applyMessageFeedbackUpdate`（设值/摘键/改判/unknownId/changed=false）+
  `applyActionCardItemFeedbackUpdate`（设值/摘键/unknownId）+ `findActionCardItemFeedbackVerdict`（读回/
  未找到） |
| `chat/render.test.ts` | +13 | 工具条仅 Cuu 文字消息渲染（人类消息/action_card 消息不渲）、未判定态
  aria-pressed=false、已判定态精确高亮、✓/✗ 字符字形而非 emoji、持久徽标仅判定后出现且随判定变色、
  对人类消息的防御性收紧（即使 VM 假设性带 my_feedback 也不渲）、备注编辑器按 messageId 精确定位、
  备注保存错误行内展示、墓碑消息零反馈痕迹、行动卡条目 tile 仅终态非撤销出现、undone 条目零 tile、
  条目 tile 精确高亮、条目反馈无备注输入 |
| `chat/api.test.ts` | +4 | 消息反馈 PUT 省略 note/带 note/空串归一、DELETE 路径、行动卡条目反馈
  PUT/DELETE（无 note 支持） |

`pnpm --filter @workhub/desktop-webview test`：1048 → **1079**（+31，与上表加总一致）。

## 5. 施工围栏核对

只动 `apps/desktop-webview/src/workbench/chat/**` + `apps/desktop-webview/src/workbench/css.ts`（新增
`chat/feedback.ts`+`chat/feedback.test.ts`，其余 6 个文件为既有文件的追加式修改）。未碰
`apps/api/**`/`packages/**`/`apps/web/**`/`spotlight/**`/`workbench/proposal/**`/`workbench/army/**`；
未碰 `renderDeliverableCardHtml`；`css.ts` 只追加新规则，未动任何既有 `.wh-wb-chat-*` 串。
