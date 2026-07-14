# R14 批 FEEDBACK · W-D feedback-web 施工汇报

- 分支：`r14/feedback-web`
- 施工说明书：`r14-release-readiness/04-feedback-design.md` §7.2（web UI）/§7.3（客户端方法）/§8（字符
  tile 视觉语言）+ W-A 交付报告 `r12-desktop-workbench/reports/r14-feedback-server.md`
- 上游：`r14/feedback-server`（已合入本分支基线，`f5b5864e`）——契约 `feedback` 字段、
  `PUT/DELETE /api/proposals/:id/feedback` 已挂载且已在提议详情 VM 里常驻拼装。
- 验收自查：`@workhub/ui` / `@workhub/web` / `@workhub/api-client` test + `pnpm -r typecheck`（16/17
  workspace）全绿（见文末计数）。

## 1. 做了什么

### 渲染——`packages/ui/src/gold-path/route-components.ts`

新增 `renderProposalFeedbackHtml(feedback, locale)`，插在 `renderProposalRouteComponent` 的 `<header>`
块之后（`vm.feedback` 存在才渲染，additive optional，旧响应零回归）：

- 两个字符 tile（✓ 有用 / ✗ 没用，U+2713/U+2717 排版符号，不是 emoji——§8 第四层视觉语言，不复用
  `REACTION_EMOJI` 的豁免边界，也不复用 `workbenchIcons.check` 的 SVG 对勾）。`href`/`method`/
  `request_json` 全部服务端算好（`buildProposalFeedbackVm`），本函数只管渲染点击，照 `review_actions`
  既有风格。`aria-pressed` 反映 `my_verdict`，已判定的一侧叠加 `wh-r14-proposal-feedback-tile--on`
  高亮 class（useful 用绿色语汇，not_useful 用中性 amber 弱化——不跟"删除"抢红色警示语义）。
- 「撤销反馈」链接**始终渲染**（不是等 `vm.feedback.clear` 存在才插入 DOM），用 `hidden` 属性按
  `my_verdict === null` 控制可见性——href/method/label 优先取服务端 `feedback.clear`，缺省时退化到
  `feedback.mark_useful.href` + 固定 `DELETE`（三个动作本就共用同一个端点，仅 method 不同）。这样
  客户端乐观切换判定后只需要翻 `hidden`，不用现造一个新锚点元素插入 DOM（那条路径更脆——插入位置、
  事件委托的 `closest("a[href]")` 都要重新对齐）。**对设计原文"clear 只在已有判定时出现"的一处忠实
  实现变体**：视觉行为完全一致（未判定时不可见），只是实现手段从"DOM 节点缺席"改成"DOM 节点常驻+
  hidden"，换取客户端更新的健壮性。
- 备注面板：`<textarea maxlength="200">` + 「保存备注」按钮（`data-r14-proposal-feedback-note-save`，
  未判定时原生 `disabled`）+ 状态行。备注**不**塞进两个 tile 的固定 `request_json`（那是"无备注"主
  路径的既有服务端契约），走独立提交（见下）。
- CSS 追加在既有 `webRouteComponentCss`（同文件内导出的数组，未新建/未改动 `packages/ui/src/
  proposal/render.ts` 的 `proposalCss`——那个文件不在本工包围栏内）。未使用 `-webkit-line-clamp`
  （web smoke 溢出门已知坑，全走 `min-height`+`resize:vertical`）。

### 客户端方法——`packages/api-client/src/{client,types}.ts`

紧邻 `mergeProposal`/`rebaseProposal` 新增 `putProposalFeedback(id, payload)`（PUT）/
`deleteProposalFeedback(id)`（DELETE），端点 204 No Content、`request()` 对空响应体天然返回 `null`，
void 化即可。

### 交互接线——`apps/web/src/browser.ts`

- 新增本地（非导出）href 匹配 `proposalFeedbackActionFromHref(href)`，识别
  `/api/proposals/:id/feedback`，**故意不加进** `packages/web-runtime/src/action-payload.ts`
  （`proposalActionFromHref` 所在的多端共享文件）——本工包围栏只含三个文件，一个新增子路径不值得为它
  改一个 desktop 也在用的共享文件。
- `bindGoldPathNavigation` 的 `api-action` 分发链新增一段（紧邻 `proposalAction?.action === "merge"`
  分支之后）：PUT 走 `client.putProposalFeedback`，DELETE 走 `client.deleteProposalFeedback`；成功后
  `applyProposalFeedbackVerdictState` 做**乐观本地 DOM 切换**（翻 tile 的 `--on`/`aria-pressed`、翻
  「撤销」的 `hidden`、翻备注保存按钮的 `disabled`），**不**整页 `renderCurrentRoute`（同
  `swapProposalActionRow` 已建立的详情页原地更新纪律）。**成功不弹 toast**——反馈是低仪式感的频繁小
  动作，只在失败时提示，呼应设计 §9「乐观 UI + 下次自然拉取兜底」的定位；与 approve/merge 这类一次性
  有后果的动作弹成功回执的既有口径刻意区分（这是本工包的产品判断，设计文档未强制）。
- 新增 `bindProposalFeedbackNotePanel`（照 `bindNotificationMutePanel` 模板：面板级 `querySelector` +
  自己的 `addEventListener` + 自己的状态文案），挂在 `bindReadyRoute` 里紧邻 `bindMemoryPanel`。备注
  保存按钮没有 `href`，delegated click 监听器的 `a[href],[data-action-href],[data-href]` 选择器天然
  不会拦到它，两条绑定路径互不打架。保存时从面板的 `data-r14-proposal-feedback-verdict` 属性读当前
  判定（未判定时禁用保存 + 兜底报错文案，双保险）。

### 一处主动加固（超出设计字面描述，记为偏离）

切换判定（点 tile）的固定 `request_json` 里没有 `note` 字段；而服务端 PUT 是整行覆盖式 upsert（改判
只更新这一行，`note` 缺省即写 `null`，见设计 §1/§2）。这意味着"先在备注框打字（甚至已保存过一条备注）
→ 又点了另一个 tile 切换判定"会把备注静默清空。为避免这个数据丢失陷阱，`api-action` 分发分支在提交
tile 点击时，额外读一次备注框当前值，非空就一并带上（`{verdict, note}`），空则维持设计原文的固定
`{verdict}` 主路径。纯 `browser.ts` 内部改动，不涉及契约/服务端。

## 2. 测试计数（前 → 后）

| 包 | 前 | 后 | 新增 | 覆盖 |
|---|---|---|---|---|
| `@workhub/ui` | 199 | 203 | +4 | `route-components.test.ts`：无 feedback 字段零渲染（additive 回归）/ 未判定态（tile 未选中+撤销隐藏+备注禁用+request_json 逐字校验）/ 已判定态（高亮+撤销可见+备注回填）/ 英文本地化 + 反馈块自身无「Cuu」 |
| `@workhub/web` | 82 | 83 | +1 | `routes.test.ts`：`loadWebRoute` 完整管线端到端渲染 feedback 块（不只是 route-components 直接单测） |
| `@workhub/api-client` | 22 | 23 | +1 | `api-client.test.ts`：`putProposalFeedback`/`deleteProposalFeedback` 的 URL/method/body 逐字对齐服务端路由 |

`pnpm -r typecheck` 全绿（16/17 workspace；`apps/api`/`packages/db`/`packages/contracts`/
`apps/desktop-webview` 四个禁区包均未改动、自身也保持绿）。

## 3. 偏离与机械后果

1. **`packages/api-client/src/types.ts` 在名义围栏之外，但不可避免**：`client.ts` 的
   `createApiClient` 返回值显式标注 `WorkHubApiClient`，新增方法不进接口声明会在 `client.ts` 自身触发
   TS 超额属性检查报错。两个新方法标成**可选**（`?:`，同 `patchUserMemory`/`listUserMemories` 那批
   "必需字段"的反向选择）——原因：`apps/web/src/main.test.ts` 与 `apps/desktop-webview/src/
   main.test.ts` 各有一个显式标注 `WorkHubApiClient` 返回类型、逐方法穷举实现的 `fakeClient()`；标成
   必需会让这两个文件缺属性报错，而 `apps/desktop-webview/**` 在本工包禁区内、`apps/web/src/
   main.test.ts` 也不在名义三文件清单里，两处都不该碰。`browser.ts` 侧对应有 `if (!fn) return`
   防御性判断（同 `bindMemoryPanel` 已有的写法，尽管那批的方法是必需的）。
2. **撤销链接改为"DOM 常驻 + hidden"而非"按需插入"**：见上文渲染小节，行为等价、更利于客户端乐观
   更新，已在测试里逐一验证未判定/已判定两态的可见性与 `disabled`/`hidden` 属性。
3. **主动加固：tile 点击一并携带未保存备注**：见上文说明，超出设计字面描述但零契约影响，纯前端行为
   优化，防止真实会遇到的数据丢失场景。
4. **成功不弹 toast**（tile 点击/撤销）：设计 §7.2 未明确要求也未禁止，本工包按"低仪式感频繁小动作"
   的产品判断处理，只在失败时提示；备注保存走面板内联状态文案（同 `bindNotificationMutePanel`/
   `bindMemoryPanel` 既有口径），也不弹全局 toast。
5. **未做**（防范围漂移，符合 04-feedback-design.md §10/§11 与任务给定禁区）：桌面 UI（W-C 工包独立
   施工）、夜间 curation 消费（W-B 工包）、任何契约/迁移/服务端路由改动、smoke/截图 artifacts 重生成。

## 4. 文案与视觉红线自查

- 反馈块自身 HTML（`git diff` 新增行）逐行 grep `Cuu`：0 命中；测试里对反馈块单独截取区间断言
  `/\bCuu\b/u` 不命中（页面其余部分沿用既有 fixture 数据里的 "Cuu" 字面量，是测试夹具遗留、非本批新增
  文案，不在本批改动范围）。web 端反馈块通篇不提及 AI 身份（连「AI 助手」都不需要——"这条提议对你有
  帮助吗"本身就不需要点名主语）。
- 字符 tile 用 U+2713/U+2717 排版符号（非 emoji presentation 字符），符合用户"排版符号 ✓ ● ⌘ 可以"的
  既有偏好边界。
- CSS 未使用 `-webkit-line-clamp`。

## 5. 关键文件

- `packages/ui/src/gold-path/route-components.ts`：`renderProposalFeedbackHtml` + 调用点 + CSS。
- `packages/ui/src/gold-path/route-components.test.ts`：4 个新测试。
- `packages/api-client/src/client.ts` / `types.ts`：两个新方法（实现 + 接口，可选）。
- `packages/api-client/src/api-client.test.ts`：1 个新测试。
- `apps/web/src/browser.ts`：`proposalFeedbackActionFromHref` / `applyProposalFeedbackVerdictState` /
  `bindProposalFeedbackNotePanel` + `api-action` 分发分支 + `bindReadyRoute` 挂载点。
- `apps/web/src/routes.test.ts`：1 个新的端到端 loader 测试。
