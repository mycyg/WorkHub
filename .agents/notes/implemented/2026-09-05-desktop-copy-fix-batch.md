# 桌面端文案修复批：加载态收进一处词典函数、内部词清场、禁词门补三处缺口

- Status: implemented
- Date: 2026-09-05
- Owner: claude（r26/f1-desktop-copy-fix 工位，F1）

## Problem

R26 文案审查（审查员 A1）逐文件读完桌面客户端 128 个非测试 `.ts`、`packages/cuu` 8 个、
`client-tauri/src-tauri` 18 个 `.rs`，出 78 条：高 7、中 49、低 22。

结论不是「AI 在界面上自述」——桌宠卡片模板早就内建了剥模型自述的守卫（`cards.ts` 的
`isModelSelfNarrationTitle` / `stripProposalOpenedPrefix`），所以「agent 叙述落进交付物」
这一类一条都没有。真正的问题是三件：

1. **内部实现词大面积渗进用户可见文案。** 68 处、19 个文件的「正在拉…／没拉到／拉不到」
   （开发口里的 fetch/pull）占满了每个视图的加载态与错误态；`派 run`／`物化`／`agent-run`／
   `diff`／`manifest`／`聚焦盒`／`dsh`／`Curation budget` 散在主路径控件上。
2. **同一个实体四种叫法。** work item = 工作项 / 工单 / 任务；agent army = 军团 / 小队；
   proposal = 变更申请 / 提议 / 改动 / 变更提案。系统通知说一个词，点开后的页面说另一个。
3. **禁词门有三处结构性缺口**，所以上面这些一条都没被拦住（见下）。

## Decision

### 1. 加载态 / 失败态：一处句式，各处只给主语

新增 `apps/desktop-webview/src/load-state-copy.ts`（`-copy.ts` 后缀即词典文件），
导出 `loadingZh/En`、`loadFailedZh/En`、`loadFailedRetryZh/En`、`withErrorDetail`。
各模块 `locales.ts` 只写「加载的是什么」——`couldnTLoad: loadFailedZh("改动")`。

**两种失败句式而不是一种**：自带「重试」按钮的错误块（`spotlightErrorHtml`）用
「X 没加载出来」，句子里不重复一遍重试；没有重试入口的地方用「X 没加载出来，稍后重试」。
这保住了改前就存在的区分（`couldnTLoad` vs `couldnTLoadCostRetry`），不是拍脑袋统一。

`withErrorDetail(locale, 产品句子, error)` 收编 12 处
`error instanceof Error ? error.message : T(...)`——**产品句子在前**，原始报错截断到
120 字符放进括号作次级信息。旧写法真出错时用户看到的只有服务端裸英文串，产品文案永远不显示。

### 2. 术语：以 glossary 为准，回写 glossary

| 实体 | 唯一叫法 | 曾并存 |
| --- | --- | --- |
| WorkItem | **任务** / *task* | 工作项、工单 |
| Agent Army | **小队** / *squad* | 军团、Army |
| Proposal（名词） | **变更申请** / *change request* | 提议、改动、变更提案 |
| Snapshot（可点的存档点） | **还原点** / *restore point* | 快照 |
| AgentRun（名词） | **执行 / 执行记录** | 运行、agent-run |
| materialize | **写入时间线** | 物化 |
| Spotlight | **快捷入口** | 聚焦盒 |

`docs/workhub/00-overview/glossary-dejargon.md` 的 §2/§4/§5/§9 逐条回写，
§10.2 checklist 从 6 条加到 10 条（解释型文案、加载态统一句式、枚举人话兜底、门禁指路）。

### 3. 枚举未映射时回退到人话，缺映射在测试里红

`spotlight/labels.ts` 九个标签函数的 `?? value` 全换成 `?? spotlightT(zh, "unknownStatus" | "unspecified" | "restorePoint" | "otherNote" | "unknownRiskLevel")`；
`search.ts` 的 `searchScopeLabel` 同理；`army/render.ts` 的三张表（定时任务名、主动提醒 kind、
stage）搬进 `army/locales.ts`，未登记的落「其它定时任务 / 其它主动提醒」，stage 未登记直接不渲染。

配套 `labels.test.ts` 新增一条数据驱动测试：从 `@workhub/contracts` 取
`workItemStatuses` / `workItemPriorities` / `agentRunStatuses` / `agentStepPhases` / `riskLevels`
以及三个 zod schema 的 `.options`，逐个断言「不落兜底、不等于原始取值」。
**以后新增枚举值忘了配文案，红在这里，不在界面上。**

### 4. 禁词门补三处缺口（`scripts/dev/check-copy-terms.ts`）

- **缺口一：写法漏网。** `/AgentRun|agent_run(?!_)/` 不匹配 `agent-run` / `agent run`，
  项目设置那句「所有 Cuu 对话与 agent-run」因此一直通过。放宽成 `/AgentRun|agent[-_ ]run(?!_)/i`。
- **缺口二：纯英文整片漏检。** 判据是「含汉字的字面量」，于是 `Run trace`、`Loading trace…`、
  `Couldn't load trace`、`Curation budget`、`Eval budget` 从来没被扫过。新增
  `collectCopyLiterals`（收全部字面量，剔除 key / 类型字面量 / import 这些标识符位置）
  和 `BANNED_EN`，**只在词典文件上跑**。
- **缺口三：纪律第 5 条一个词都没进表。** 补 15 组中文规则（解释型文案、对界面自身的解说、
  路线图语言、开发运行方式、内部设计代号、内部结构名、内部实体名混排、数据库词、
  「正在拉/没拉到」、接口字段名直出、后台子系统名、能力协商词、功能开关内部状态、设计理由泄漏）。

`check-copy-terms.test.ts`：每条新规则一个会红的用例（29 条），加上词典/非词典的分工边界、
`term-allow` 豁免、key/类型/import 不参与英文扫描。`main()` 加了直接执行判据，
测试 `import` 不再顺带触发一次全库扫描。

## Alternatives considered

- **把 68 处加载态逐条改字，不建共享句式。** 否决：这正是它们各走各的原因。审查清单里
  「正在拉取待拍板…」「正在拉 diff…」「暂时拉不到」三种写法并存就是逐处手写的产物。
- **把 `工单|工作项` / `\bwork items?\b` 也做成禁词。** 试过，173 处命中里 116 处来自
  `apps/api` 的 **LLM 提示词**（`agent-run-prompt.ts`、`conversation-turns.ts` 的工具描述）——
  那些是模型可见文本，用内部术语是对的。做成正则 90% 是误报，会把门变成噪音源。
  改为写进 glossary 靠审查守，门只管机械可查的部分。
- **`占位` 整词入禁词表**（指挥者给的短语之一）。收窄成 `占位符|占位文案|占位内容|演示数据|示例数据`：
  「已有同名文件占位，改名或删除后再还原」是正当产品文案，整词禁会误伤。
- **把改到的文案从 `command-palette.ts` 等基线文件迁进 `locales.ts`。** 只在成本低的地方做了
  （`army/render.ts` 的三张标签表，ui-i18n 基线 30 → 20）。`command-palette.ts` 96 条是
  `{ "zh-CN", en }` + `keywords` 数组的记录式写法，整体搬家是另一件事（B5 的 Note 已列在
  「后来者怎么继续搬」里），不塞进文案批。其余按「同一文件条数不增」更新基线。
- **删掉 `createDesktopCuuDemoScript` 这个死导出**（审查建议）。只改了它那句
  「开发预览：daemon 连接不稳定」的文案：删产线导出不是文案批该做的决定，留给下一轮。
  `cuuStart.defaultIntent` 反过来删了——它全仓零引用，且本身是一句指令口吻的文本，
  改写它等于给一个没人用的键编文案。

## Consequences

- **A1 清单 78 条全部处置**（高 7 / 中 49 / 低 22）。逐条按原文字符串复核过：产线代码里
  再也搜不到任何一条原文，剩下的同名命中全是代码注释、标识符与词典 key。审查建议「英文侧
  不动」的条目（`Search knowledge and evidence`、`Use a cheaper model`、`Hide main window`）
  按建议保持原样。
- **桌面端 1699 测试全绿**（多出的 1 条是新增的枚举覆盖测试），`packages/cuu` 50 条全绿，
  `pnpm test:scripts` 48 条全绿，`cargo test` 196 条全绿 + `clippy -D warnings` 干净。
- **改文案就要改断言。** 本批逐条改了 45 处精确文案断言，没有一处放宽成任意匹配；
  渲染结构（`data-*` 契约、DOM 形状）一处未动。唯二放宽的是两处带撇号的英文断言
  （`aren't` 经 `escapeHtml` 变成 `&#39;`，`includes` 断言必然假红）——改成断言不含撇号的片段，
  并补一条「提示里不再出现 list cap 这种实现推理」的正向断言，覆盖面没有变窄。
- **禁词门存量基线 19 → 62**，新增的 43 条全部落在本工位不许碰的包里，交给另一路：
  `packages/ui/src/gold-path/locales.ts` 12、`apps/web/src/locales.ts` 10、
  `packages/ui/src/workitem/locales.ts` 4、`apps/api/src/services/project-planner.ts` 4、
  `packages/ui/src/{i18n,gold-path/route-components,gold-path/i18n}.ts` 5、
  `apps/api/src/services/{risk-monitor,merge-fusion-candidates,plugins}.ts` 4、
  `packages/agent/src/{golden/expected,spotlight-intent/prompt}.ts` 3、`apps/web/src/browser.ts` 1。
  其中 `packages/agent` 那 3 条是 dev 工具输出与 LLM 提示词，合适的处置是加 `term-allow`
  而不是改文案。
- **ui-i18n 基线 3669 → 3659**（-10，army 标签表迁走），逐文件核过没有任何文件条数变大。
- **英文禁词表只在词典文件上跑是刻意的。** 普通产品文件里满是接口路径（`/api/agent-runs/:id`）
  与选择器（`[data-diff-row]`），套同一张表必然误报；测试里有一条专门钉这个边界。
  代价是非词典文件里的纯英文文案仍然漏检——那些文案本来就该搬进词典，由 ui-i18n 门催。
