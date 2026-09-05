# MCP 工具的模型可见形态 golden（工位 M6）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R26 工位 M6）

## Problem

MCP（Model Context Protocol）服务器自报的工具名/description/inputSchema 经
`packages/mcp-client`（M1，纯翻译包）翻成 `ToolSpec`，并入注册表后经 `toModelTools` 的
name/description/input_schema 对模型可见——这是一段第三方文本进模型上下文的通道，正是
`2026-09-05-prompt-and-tool-schema-golden.md` 落的逐字节 golden 门存在的理由。M1 的落地 Note
已明确写下这道口子：「MCP 工具的 golden 由 M6 用本包的常量夹具新建，且不许改动任何既有
expected 文件」，`M-MCP客户端设计.md` 4.6/4.7 同样把它列为独立工包。此前全库没有任何 MCP
相关 golden——这条通道处于无人看管状态。

## Decision

新增 `apps/api/src/golden/mcp-tool.golden.test.ts`，紧跟
`.agents/notes/implemented/2026-09-05-plugin-pg-gate-and-tool-golden.md` 落的
`plugin-tool.golden.test.ts` 的先例（结构、字段命名、`specSurface` 辅助函数都直接照抄），
五份 expected：

- `mcp-tool-spec.expected.json` —— 用 `qa/fixtures/echo-server-tools.ts` 的常量夹具
  （`echo` + `write_note`）经 `describeMcpTools` + `toMcpToolSpecs` 翻成 `ToolSpec` 之后的
  非函数面，**管理员断言 `read_only` 与 `external_effect` 两档各钉一份**——这是
  `to-tool-spec.ts` 读写分级真值表在模型可见面上的直接体现。
- `mcp-tool-model-view.expected.json` —— `toModelTools()` 里的那两项 + 三种任务计划角色
  （连同「无角色」）的可见性。
- `mcp-tool-engine-request.expected.json` —— 两套引擎（`createAgentLoop().run` /
  `runAgentLoop2`）真正发给 provider 的请求体里 MCP 那两项，复核
  `agent-run-engine.golden.test.ts` 的 `KNOWN_ENGINE_DELTA`
  （`legacyOnlyToolKeys: ["side_effect"]`、`loop2OnlyToolKeys: []`）对 MCP 工具仍成立。
- `mcp-tool-edge-cases.expected.json` —— `mcpEdgeCaseToolsListResult` 经 `describeMcpTools`
  之后，被丢弃的工具与原因、以及有损命名（点号压缩、超长名字截断）挂指纹后的公开名。
- `mcp-tool-content.expected.md` —— `renderMcpContent` 对一份含围栏注入尝试
  （`</outputs>`/`<worker_claim>`）、非文本块、较长多行文本的结果，模型实际读到的文本。

**一条新事实，插件那份 golden 里不存在**：插件工具阶段 0 全部保守钉成 `external_effect`，
可见性只按*工具*区分（装了插件，research/review 就是看不见它）。MCP 的读写分级真值表让
*同一台服务器*内部就能同时出现 `none`（`echo`，`readOnlyHint: true` 且管理员断言
`read_only`）与 `external_effect`（`write_note`，什么都不自述）——`mcp-tool-model-view`
golden 因此钉出一个两个工具可见性不同的矩阵：`echo` 对 research/review 可见，`write_note`
不可见。`mcp-tool-engine-request` 同样在 `none` 与 `external_effect` 两个值上各验一次
`KNOWN_ENGINE_DELTA`，比插件那份（只有 `external_effect` 一个值）覆盖更全。

**新增断言：装了 MCP 工具之后系统提示词逐字节不变**——验证结果**成立**（与插件工具同口径）。
`to-tool-spec.ts` 显式不设 `promptSnippet`/`promptGuidelines`，这条断言把这句话在系统提示词
组装层面的效果钉住；若哪天真把 MCP 服务器的某种描述文案接进提示词，这条断言会先红。

**「能红」演练**：把 `echo` 工具的 description 改一个字母（`"back."` → `"bacc."`），
`node --import tsx --test src/golden/mcp-tool.golden.test.ts` 里 3/8 条测试变红
（`mcp-tool-spec`/`mcp-tool-model-view`/`mcp-tool-engine-request` 三份 expected，因为都
含这个工具的 description），`firstDiff` 精确指到那一行（`- "Echo a phrase back."` /
`+ "Echo a phrase bacc."`）；其余 5 条（不依赖这个字段的边界夹具、截断精确断言、content
golden、系统提示词不变断言）保持绿。`git checkout` 还原后重跑，8/8 全绿。

**截断态不落整份 expected**：4000 字符的 description 上限与 32KB 的 content 上限，两处的
截断态都用精确断言而不是落一份由重复字符填出来的 expected——理由与
`plugin-tool.golden.test.ts` 对 `PLUGIN_TEXT_MAX_CHARS` 的处置、以及
`2026-09-05-prompt-and-tool-schema-golden.md` 对超长会议转录的处置完全一致：
`assertGolden` 的 `firstDiff` 按行报差异，一整行由重复字符填出来的 expected 只会产出不可读
的前后对照，还让仓库多背几十 KB 与内容本身无关的噪声。`mcp-tool-content.expected.md` 因此
只落一段长度适中（16 行、约 2.4KB）、可读的组合文本；32KB 硬顶截断（含「先中和再截断」的顺序）
由文件末尾一条精确断言单独覆盖，这条钉的是 `renderMcpContent` 这一层，不是
`content.test.ts` 已经覆盖过的 `truncateMcpContent` 那一层。

**apps/api 新增 `@workhub/mcp-client: workspace:*` 依赖**：这条依赖此前不存在——M2（连接与
监督）、M3（治理服务）、M4（装配接线）都还没在这条集成分支上落地，`apps/api` 里没有任何文件
引用过 `@workhub/mcp-client`。本工位需要用它的纯函数（`describeMcpTool(s)`/`toMcpToolSpecs`/
`renderMcpContent`）搭 golden，因此加了这条依赖并 `pnpm install --offline` 重新生成
`pnpm-lock.yaml`（3 行新增，纯 workspace 内部链接，不拉任何新第三方包）。

**命名与设计稿的出入**：`M-MCP客户端设计.md` 4.6/4.7 草拟时把这份文件与其 expected 分别记成
`mcp-tool-schemas.golden.test.ts` / `agent-run-tool-schemas.mcp.expected.json`
（`packages/mcp-client/qa/fixtures/echo-server-tools.ts` 顶部注释至今仍引用着那个旧名字）；
指挥者实际派工时把落地文件名改成了与 `plugin-tool.golden.test.ts` /
`plugin-tool-*.expected.*` 同构的 `mcp-tool.golden.test.ts` / `mcp-tool-*.expected.*`。
本工位照最新派工来的名字落地，没有改动 `echo-server-tools.ts` 顶部注释里的旧文件名引用
（那是 M1 范围内的文件，本工位文件白名单不包含它）。

## Alternatives considered

- **model-view / engine-request golden 只用 `external_effect` 一档断言**（像插件那份一样）：
  否决——那样两个工具的可见性会退化成同一档，看不出「分级按工具生效、不是按服务器生效」这条
  MCP 独有的新事实，白白浪费了夹具专门设计出的两档区分。
- **`mcp-tool-content.expected.md` 落一份真正触发 32KB 截断的完整 expected**：否决，见
  Decision 段「截断态不落整份 expected」——不可读、且给仓库添几十 KB 与内容无关的噪声。
  改用「组合文本落 golden + 32KB 精确断言单独覆盖」两条并存的方案。
- **边界夹具 golden 落完整 `specSurface`（含 json_schema/description）**：否决——这道 golden
  要证明的是命名与拒绝规则，不是重复证明「描述符能翻成合法 schema」（那件事已经在
  `mcp-tool-spec.expected.json` 证明过）。只取 `raw_name`/`tool_id`/`side_effect`/`min_scope`
  四个字段，更聚焦，diff 也更小。
- **手写 `McpToolDescriptor` 常量而不是经 `describeMcpTools` 真翻译**：否决，理由同插件
  golden——手写常量会把 `describeMcpTools` 自己的判断（分级真值表、拒绝规则、命名指纹）绕过去，
  钉住的只是「我以为翻译器会产出什么」。

## Consequences

- 五份 expected 文件是生成物，`pnpm gen:expected` 重生成，不手改；跑了两次确认第二次
  `git status` 无变化（幂等）。
- 改 `packages/mcp-client` 的翻译逻辑、`echo-server-tools.ts` 夹具、或
  `apps/api/src/workers/agent-runner.ts` 的 `canUseToolForTaskPlanRole`，这五份 golden 会先
  感知到——这正是这道门存在的意义。
- **已知负债，不在本工位范围内，如实记录**：`packages/mcp-client/src/content.ts` 与
  `to-tool-spec.ts` 目前各自内联一份 `sanitizeModelFacingText` 的局部实现，而不是从
  `@workhub/tools/model-facing-text.ts` 导入共享版本——`2026-09-05-mcp-m1b-shared-sanitize.md`
  的 Consequences 段其实已经点名「M1 落地时的合并点」该怎么改（`to-tool-spec.ts` 调用
  `sanitizeModelFacingText(desc, 4000)`、`content.ts` 调用
  `sanitizeModelFacingText(joinedText, { maxChars: 32*1024, neutralizeFenceTags: true })`），
  但 M1 落地时两处仍是局部复制实现。本工位的文件白名单不包含 `packages/mcp-client`，且
  `mcp-tool.golden.test.ts` 钉住的是**行为**（模型可见文本的形状），不是实现路径，因此这份
  golden 无法区分「消费共享函数」与「本地复制一份等价逻辑」——两种实现下 golden 都会通过。
  这条合并留给下一个允许碰 `packages/mcp-client` 的工位处理；处理时这份 golden 应当保持全绿
  （行为不变是这次合并的前提），如果变红说明合并顺手改了行为，需要独立评审。
- 本工位新增的 `@workhub/mcp-client` 依赖与 `pnpm-lock.yaml` 变化会被后续 M2/M3/M4 工位复用
  （它们迟早也要在 `apps/api` 里引用这个包），无需重复声明。
