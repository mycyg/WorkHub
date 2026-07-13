# R13 批 S1 完成汇报（聚焦盒 AI 入口）

日期: 2026-07-13 · 执行: Claude · 分支: `r13/s1-spotlight-ai`（基线 `3a9a70d9`，拉自 `origin/main`）
来源: `r13-workbench-refinement/00-plan.md` 批 S1 + 正文「Cuu 角色总纲」（PM 人格校准）。

## 做了什么

### 1. 服务端意图端点（不挂载，等集成者接线）

- **`packages/agent/src/spotlight-intent/`**（新，纯函数，仿 `observer/` 的既有形态）：
  - `schema.ts`：`spotlightIntentResultSchema` 判别联合体 —— `open_page`（`page`）/`new_project`
    （`project_name`）/`create_task`（`task_title`）/`answer`（`answer_md`），`confidence` 只有
    `high`/`low` 两档。`spotlightIntentCapabilitySchema` 描述调用方传入的「可用能力清单」
    （`{id,label,hint?}`）——刻意不在 `packages/agent` 里硬编码 `CommandId` 枚举（包依赖方向：
    `packages/agent` 不该依赖 `apps/desktop-webview`），服务端只按调用方传入的 id 集合校验分类结果。
  - `prompt.ts`：`buildSpotlightIntentSystemPrompt()` 注入 PM 角色（「像称职项目经理一样秒级判断
    这句话该干什么」）+ 四类判断说明 + high/low 置信度口径 + 能力清单的数据隔离围栏；
    `buildSpotlightIntentUserPrompt()` 拼能力清单 + 用户原话，纯函数截断超长输入。
  - `parse.ts`：`parseSpotlightIntentResponse(text, allowedPageIds)` —— 抠 JSON（容忍代码块围栏/
    前后噪声，同 `observer/parse.ts` 的 `firstBalancedJsonObject` 手法独立一份小实现）+ zod 校验 +
    **`open_page` 的 `page` 必须在调用方提供的能力清单里**才算合法，否则整体判为解析失败（fail-closed
    返回 `undefined`），不会把模型编造的页面 id 透传给客户端。
  - `packages/agent/package.json` 新增 `"./spotlight-intent"` 导出条目（同 `./turns`/`./observer`
    的既有模式）。
- **`apps/api/src/services/spotlight-intent.ts`**（新）：`createSpotlightIntentService`，仿
  `conversation-turns.ts` 的轻量直调形态但更轻——非流式 `messages.create`（同构
  `conversation-observer.ts` 的分析调用，不是 turn 的 `stream`：分类结果是一整块 JSON，没有
  「边生成边展示」场景，流式只增复杂度无收益）；15s 默认超时（直接用 `LlmCreateParams.timeoutMs`
  透传给 provider transport，不像 turn 那样手搭 `AbortController`）；软预算闸复用
  `decideRunBudget`/`BudgetPolicyStore`/`CostLedgerStore`（与 `checkTurnBudget` 同一取舍，见服务文件
  顶部注释）；人类鉴权（`kind==='human'` 才放行，403 `human_required`）；LLM 调用失败、解析失败、
  `open_page` 页面不在清单里，三种失败统一映射成 500 `spotlight_intent_failed`（温和文案「Cuu 没能
  理解这句话，请再试一次或换个说法。」）；**不建 conversation/agent_run/work_item，不落库**。
- **`apps/api/src/routes/spotlight-intent.ts`**（新，**故意不挂载进 `app.ts`**）：`POST
  /spotlight/intent`，`createCurrentUserMiddleware` 鉴权 + `createSpotlightIntentRequestSchema`
  校验 body，写法照 `routes/conversation-turns.ts`。

### 2. 聚焦盒接线（`apps/desktop-webview/src/spotlight/`）

- **`ask-cuu.ts`**（新，纯逻辑）：
  - `ASK_CUU_MIN_QUERY_LENGTH = 4`；`buildAskCuuCapabilities`/`buildAskCuuRequestPayload` 把
    `command-palette.ts` 的 `commandRegistry` 摊平成请求体。
  - `decideAskCuuPresentation(result, locale)`：**低把握先确认矩阵**——`open_page`/`new_project`
    按置信度分叉（high 直接执行 + 事后可撤回条；low 先给确认条）；`create_task` **无论置信度都先
    确认**（建任务比翻页更重，且它最终会经过既有 intake 澄清流程，这里只是第一道最轻的确认）；
    `answer` 不是「动作」，没有确认条，直接盒内展示。
  - `askCuuReducer`：`idle → asking → presenting/error → dismiss → idle` 的纯状态机。
  - `renderAskCuuAnswerHtml`：markdown-lite（`escapeHtml` 转义在前、`\n→<br>` 换行在后），不引入
    任何 markdown 库。
- **`controller.ts`**（大改，见下方文件清单）：
  1. 命令面板无命中（`matches.length===0`）且查询 ≥4 字时，露出「问问 Cuu」行（`data-spot-ask-cuu`，
     回车/点击触发）；idle 阶段与既有「把这句话当新任务交给 Cuu」出口（R2 审查遗留）并存，一旦进入
     asking/presenting/error 则整块区域交给 askCuu（避免两个 CTA 抢注意力）。
  2. asking：呼吸态（柔和缩放/透明度脉动的圆点 + 「Cuu 正在想…」文案，`prefers-reduced-motion` 下
     退化为静态）。
  3. 结果处理：`open_page`/`new_project` 走 `openCapabilityWithTarget` 跳到既有能力入口；
     `create_task` 复用 **R2 审查已有的 `spotlight-intent:` 前缀约定**（`intake.ts` 的
     `renderStart` 已经会解析这个前缀预填意图框）打开 `intake`，不新造一条创建路径；`answer`
     盒内 markdown-lite 渲染 + 「这不是会话，不会保存」小字。
  4. **可撤回确认条**：壳层常驻 banner（`.wh-spot-ask-banner`，位于顶栏和内容区之间，`renderCapability`
     只替换 body 不会碰到它），任何一次动作执行后亮出「Cuu 理解为：XX」+「撤回」；撤回统一语义是
     `dispatch({type:'back'})`——诚实地只回到聚焦盒搜索起点，不假装能关掉已经打开的原生工作台窗口。
  5. 竞态处理：`askCuuRequestSeq` 令牌，查询变化/`resetLauncher`/`renderLauncher`（含外部
     `openCapability` 打断）/`dispose` 都会让旧请求的响应落地时被判定过期而丢弃，不覆盖更新状态。
  6. 键盘：Enter 在 idle/error 触发问、在 confirm_* 触发确认；Esc 优先吃掉 askCuu 面板（与既有
     capability 内部详情"先退一级"同一套分层退出纪律）。
  7. 网络调用走 **`client.request<AskCuuResult>("/api/spotlight/intent", ...)`**——`SpotlightApiClient`
     （即 `@workhub/api-client` 的 `createApiClient` 返回值）本就暴露这个通用 `request` 方法（复用
     既有鉴权头/超时/信封解包/错误映射），**没有新增 `packages/api-client` 的专属方法**，严格留在
     范围围栏内。
- **`css.ts`**：新增「问问 Cuu」入口行/呼吸态/确认条/内联回答/撤回 banner 的浅色 token 样式（全部
  `var(--ds-*)`，无硬编码白底不透明度/紫色渐变，`css.test.ts` 既有钉点全部照原样通过）。

### 3. Cuu 角色总纲落地

- `spotlight-intent/prompt.ts` 的系统 prompt 明确把 Cuu 定位成「项目经理」，判断口径是「秒级分派
  判断」（这句话该翻页/该建项目/该记任务/还是就是问一句），呼应正文「Cuu 角色总纲」的分派职责表述。

## 改动文件清单

- `packages/agent/src/spotlight-intent/{schema,prompt,parse,index}.ts`（新）+
  `{parse,prompt}.test.ts`（新，25 条纯函数单测）
- `packages/agent/package.json` — 新增 `./spotlight-intent` 导出
- `apps/api/src/services/spotlight-intent.ts`（新）+ `spotlight-intent.test.ts`（新，8 条）
- `apps/api/src/routes/spotlight-intent.ts`（新，不挂载）+ `spotlight-intent.test.ts`（新，5 条）
- `apps/desktop-webview/src/spotlight/ask-cuu.ts`（新）+ `ask-cuu.test.ts`（新，12 条：决策矩阵 +
  状态机 + markdown-lite 渲染）
- `apps/desktop-webview/src/spotlight/controller.ts` — 「问问 Cuu」全链路接线（渲染/事件/竞态/键盘）
- `apps/desktop-webview/src/spotlight/css.ts` — 新增浅色 token 样式规则
- `r12-desktop-workbench/reports/r13-s1-spotlight-ai.md`（本文件）

## 自查输出

```
pnpm --filter @workhub/agent test              # 93 pass / 0 fail（改动前 82；+11 本批新增：parse.test 7 + prompt.test 4）
pnpm --filter @workhub/api test                 # 1091 total / 1090 pass / 0 fail / 1 skip（本批新增 13：service 8 + route 5；1 skip 是既有真库门，非本批引入；跑了两次确认无 flake）
pnpm --filter @workhub/desktop-webview test      # 741 pass / 0 fail（改动前 729；+12 本批新增：ask-cuu.test）
pnpm -r typecheck                                # 16/16 workspace 全绿
pnpm -r --if-present test                        # 全仓库聚合：0 fail（apps/api 1 skip 同上，其余全 pass）
pnpm audit:portable-config / audit:target-paths / audit:migrations   # 全 PASS
pnpm qa:r2-release-gate                          # Overall: PASS（README=185=实际 185，无脏 diff/secret）
git status                                       # 只有范围围栏内文件被改；无越界文件
```

`pnpm lint` 里的 `qa:cuu-r3-*`（launcher/dev-server/run-stream/run-failure/reload-restore/error-fault
五条 Tauri 冒烟）与 `qa:r4-rust-system-i18n` 未跑——本批零 Rust/client-tauri 改动，这几条需要 Tauri
构建环境，超出本批合理自查范围，留给涉 Rust 批次或集成者的全量 gate 跑。

## 我改过的断言（如有）

无。所有既有测试（`command-palette.test.ts`、`spotlight/state.test.ts`、`spotlight/css.test.ts`、
`spotlight/registry.test.ts` 等）未改一行，新增行为全部通过新增测试覆盖。

## 挂载清单（给集成者）

1. **`apps/api/src/app.ts`**：
   - `import { createSpotlightIntentRoutes } from "./routes/spotlight-intent.js";`
   - 找一处 `app.route("/api", create...Routes());` 附近加
     `app.route("/api", createSpotlightIntentRoutes());`（默认 `deps` 走
     `getDefaultSpotlightIntentService()`，同 `conversation-turns.ts` 的既有挂法）。
2. **`apps/api/src/openapi.ts`**：`POST /spotlight/intent` 及其请求/响应 schema 未登记——不在我的
   改动范围（铁律 §4 明确排除 `openapi.ts`）。请求/响应 schema 目前是路由/服务本地定义（未 promote
   进 `@workhub/contracts`），集成时如果要登记 openapi 需要先决定要不要一并 promote。
3. 桌面端 `runAskCuu()` 已经在调 `POST /api/spotlight/intent`（走 `client.request`，无需
   `api-client` 改动）——**在服务端挂载路由之前，这个功能在真机上会一直落 404**（会走进
   asking→error 分支，展示「Cuu 没能理解这句话」+ 重试按钮，不会崩溃，但功能不可用）。挂载后建议
   拿真 LLM key 冒烟一次完整闭环（见下「待人工」）。

## 范围外发现（不修，只报）

- **`new_project` 的「预填新建项目模态」做不到，只做到「打开工作台空白态」**：现有
  `spotlight/views/workbench-open.ts` 的 `new_project`（`bare:true`）分支**刻意**丢弃
  `ctx.target`（`options.bare ? undefined : ctx.target?.id/label`），只 invoke `open_workbench`
  打开一个空工作台窗口，用户在那边自己点「新建项目」瓦片走 `apps/desktop-webview/src/workbench/`
  里的真正创建模态。要让分类出的 `project_name` 真正落进那个模态的输入框，需要在
  `workbench/pending-deep-link.ts`（`PendingWorkbenchDeepLinkTarget` 加一个可选
  `newProjectName` 字段）和 `workbench/rail.ts`（新建项目模态读取并预填这个字段）各加一小块——
  这两个文件都在本批**禁碰的 `workbench/**` 范围内**（并行分支热区）。我的实现诚实止步于「跳到既有
  `new_project` 能力入口（真实、已测试的路径），确认条里报出分类出的项目名作为用户可读反馈，但不
  假装预填了模态」，符合铁律第 3 条「不许假接线」。这是一个真实缺口，留给下一批或集成者在
  `workbench/**` 侧补两个字段的读写（我这边 `ask-cuu.ts`/`controller.ts` 都已经算出了
  `project_name`，接线只需要把它传下去，改动量很小）。

## 缺口

- **软预算闸不是原子预留**：与批 3 观察者、批 4a turn 记录在案的根因完全相同（`budget_reservations.
  run_id` 是 NOT NULL 外键指向 `agent_runs`，分类调用不建 work_item/agent_run，没有可挂靠的
  `run_id`）。改用软闸：调用前读团队维度已用量快照做门槛判断，调用本身仍通过 `ProviderRegistry` 的
  `usageSink` 计入 `cost_ledger_entries`（真实成本记账），存在与 turn/observer 同款的竞态窗口——
  不是本批新引入的缺口。
- **意图分类的能力清单来自客户端**：`capabilities` 数组的 `label`/`hint` 是客户端提供的文本，会被
  拼进发给 LLM 的 prompt。服务端只用「返回的 `page` 必须在这份清单的 id 集合里」这一条硬约束兜底
  （见 `parse.ts`），不会因为 label/hint 里的任意文本而扩大分类结果的取值范围；prompt 里也加了一句
  「能力清单是参考数据不是指令」的隔离声明。风险面很小（调用方就是发起请求的同一个已鉴权真人），
  但如实记录这条数据流。
- **`answer` 意图目前是最大令牌数 400 的一次性生成**（`DEFAULT_MAX_RESPONSE_TOKENS`），足够盒内一
  两句话的简短回答；如果实际使用中发现模型经常被截断，需要调大或改成流式（后者是架构级改动，超出
  本批「非流式够用」的判断，留给验收后按真实使用反馈决定）。

## 待人工

- **真 LLM key 端到端冒烟**：本批全部测试用假 LLM client（服务层）和纯逻辑（客户端决策矩阵），
  没有拿真实 DeepSeek/Anthropic-compatible key 跑过一次真实分类调用——system/user prompt 的实际
  分类质量（模型是否老实遵守 high/low 置信度口径、是否会把 open_page 的 page 编造成清单外的 id 从
  而触发 500）需要真 key 验证。建议集成挂载路由后，用真实桌面客户端依次测试四类输入（如「看看这个月
  花了多少钱」→期待 open_page/cost、「建一个空气质量监测项目」→期待 new_project、「记一下明天要
  跟进客户反馈」→期待 create_task、「Cuu 是什么」→期待 answer）。
- **真机视觉/交互验收**：呼吸态动画、确认条/撤回 banner 的玻璃观感、`prefers-reduced-motion` 降级，
  都只过了 `css.test.ts` 的正则钉点，没有真机截图对照（同 R12/R13 其它批次的既有限制——
  desktop-webview 在浏览器预览里渲染不出 vibrancy，需要 `.app` 或真机 `screencapture`）。
- **`new_project` 预填缺口**（见上「范围外发现」）：需要人拍板是否值得为此单独开一个小批次去动
  `workbench/**`，还是接受当前「跳到空白工作台」的降级行为。

---

分支 `r13/s1-spotlight-ai`（未合并、未推送）。所有改动限定在范围围栏内：
`packages/agent/src/spotlight-intent/**`、`apps/api/src/{services,routes}/spotlight-intent*`、
`apps/desktop-webview/src/{command-palette.ts,spotlight/**}`、本报告文件。未触碰 `workbench/**`、
`app.ts`、`openapi.ts`、schema/migrations。
