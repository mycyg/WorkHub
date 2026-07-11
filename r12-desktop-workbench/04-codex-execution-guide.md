# R12 · Codex 执行手册(照着干就行)

> 给实现者(codex)的操作手册。两种驱动方式见 §8:逐批模式(一批一验收)或一次性模式(批 0-8 连续推进,每批留 commit+汇报痕迹,红了就地停)。
> 写给谁:一个没有本项目上下文的实现 agent。所以下面把话说满、说细,宁可啰嗦。

---

## 1. 你在干什么(30 秒版)

WorkHub 是一个 AI 当默认劳动力的协作平台(TypeScript monorepo + Tauri 桌面端 + PostgreSQL)。本迭代(R12)给桌面端做「项目工作台」:

- 每个项目一个**群聊主区**,人和 AI(叫 Cuu)在里面聊;
- 聊天停 60 秒,Cuu 自动把讨论里的活拎出来干(行动卡);
- 每个人还能和 Cuu **单聊**(协同会话)干细活;
- 会话右侧有**情境面板**:输出 / 军团(AI 任务卡) / 后台任务;
- 项目绑**网盘**,一切产物**版本化可回滚**;
- 铁律:AI 写任何生产数据必须走「提议 → 审批 → 合并」,没有例外。

## 2. 开工前必读(按这个顺序,都在 r12-desktop-workbench/ 里)

1. `00-interaction-design.md` —— 产品长什么样、为什么。看不懂交互时回来查它。
2. `03-user-and-data-flows.md` —— 数据怎么流。写后端逻辑前必看 §2 对应链路。
3. `02-construction-plan.md` —— 你的任务清单本体。只看你当前批次那节 + §0 全局约束。
4. `01-reference-codebases.md` —— 每个难点该抄哪个开源项目的思路,带 file:line。
5. `prototype/index.html` —— 视觉与交互基准。可 `node r12-desktop-workbench/prototype/serve.mjs` 起 4173 端口看。

## 3. 参考代码(已经 clone 好了,直接看)

| 位置 | 是什么 | 你会用它抄什么 |
|---|---|---|
| `reference/openai-codex/codex-rs/` | Codex CLI 本体(Rust) | SSE 事件命名(Delta/Begin/End)、中断语义、审批分级、压缩策略 |
| `reference/codexia/` | Codex 的 Tauri GUI | 军团卡片订阅模式、审批/diff 折叠 UI、store 切片 |
| `reference/wisp-science/` | 本地科学 agent(Tauri+Rust) | @引用系统(chip+服务端展开)、messages 表 seq 约束、技能抽象 |

**怎么用**:学结构、学协议形状、学边界处理;**禁止复制粘贴代码**(语言都不一样,许可证也各异)。01 文档每条都写了「抄什么、在哪、映射到我们哪个模块」。

## 4. 铁律(违反任何一条 = 返工,没有商量)

这些全部来自本仓库的历史事故,不是官僚主义:

1. **不许改测试/断言来迁就你的实现。** 测试红了先怀疑自己的代码。真要改断言,在汇报里单独说明理由等人批。
2. **不许写伪测试。** 断言必须真的会失败(先写会红的测试,再让它绿)。`assert(true)`、只测 mock 不测行为、把真库测试改成内存假仓库,都算伪测试。
3. **不许假接线。** UI 上的每个按钮/入口必须连到真后端;做不完就不要渲染这个按钮,不许摆一个点了没反应的空壳。
4. **所有列表查询必须带上限(limit/cap)和分页;所有循环内不许发 N+1 查询。**
5. **新增/修改 `*.test.ts` 之后必须跑 `pnpm -r typecheck`**(测试运行器不查类型,CI 的 tsc 会逮你)。
6. **只 `git add` 你自己改的文件,绝对禁止 `git add -A`**(工作树可能有别人的脏文件)。
7. **不许碰你当前批次范围外的文件**;发现范围外的问题,写进汇报,不要顺手修。
8. **不许动 README 的「N 篇文档已落盘」计数**,也不要往 `docs/workhub/` 里加文件(会触发计数门)。
9. 所有新端点必须:uuid 参数过守卫(照 `apps/api/src/routes/uuid-param.ts` 的既有用法)、过 membership 鉴权(隔离写进 SQL,不是查完再滤)、body 过 json 校验。
10. 桌面端代码里**不许出现任何 LLM API key 的读取路径**。
11. UI 不用 emoji,图标用 SVG symbol 或字符 tile(照 prototype 的做法)。
12. 用户面文案不许出现 git 黑话:说「工作副本/提议/采纳/撞车」,不说「branch/PR/merge/conflict」。
13. 提交信息规范照仓库惯例(`feat(scope): ...` / `fix(scope): ...`),分支从 main 拉,命名 `r12/batch-<N>-<slug>`。

## 5. 每批怎么干(通用流程)

```
1. 读 02 计划里你这批的那一节(目标/任务/踩雷/验收门)
2. 读 03 里对应的数据流小节;读 01 里被引用的参考条目,打开 reference/ 对应文件看明白
3. 先写迁移/schema → 再写 repository+测试 → 再写路由+测试 → 再写前端 → 最后接 SSE
4. 每完成一个 checkbox,跑一次对应测试
5. 全部做完,跑完整自查(见 §6)
6. 按 §7 格式写汇报,停下,等人验收。不许自动开始下一批。
```

## 6. 自查命令(每批交活前全部跑一遍,贴输出)

```bash
pnpm -r typecheck          # 必须 0 错
pnpm test                  # 相关 workspace 全绿
pnpm verify                # 仓库聚合门(含 lint/gate)
# 涉库批次(0/3/4/5/6):跑 PG smoke(真库门),命令见 scripts/qa/ 下既有 smoke 脚本
# 涉 Rust 批次(1/7):cargo test --manifest-path client-tauri/src-tauri/Cargo.toml
git status                 # 确认没有范围外文件被改
```

## 7. 汇报格式(每批一份,贴在 PR 描述里)

```
## 批 N 完成汇报
- 做了什么:3-6 行人话
- 改动文件清单:路径 + 一句话
- 自查输出:typecheck / test / verify / smoke 的关键行(测试数量前后对比)
- 我改过的断言(如有):哪条、为什么
- 范围外发现(不修,只报):...
- 没做/存疑:...
```

---

## 8. goal 命令(复制即用)

> 两种用法,二选一:
> - **逐批模式**(§8.1-8.9):一次一条,每批人验收后再给下一条。最稳。
> - **一次性模式**(§8.0 总 goal):批 0→8 连续推进,批间不等人,但每批必须:自查全绿 → targeted commit → 在 `r12-desktop-workbench/reports/batch-N.md` 落汇报。**任何一批的验收门过不了 = 就地停工写阻塞报告,禁止带病进下一批,更禁止改测试装绿。**

### 8.0 总 goal(一次性推进批 0-8)

```
你要在 WorkHub 仓库完成 R12 桌面工作台的全部施工(批 0 到批 8,批 9 只做协议 contract test 不做实现)。

第一步:通读 r12-desktop-workbench/04-codex-execution-guide.md,把 §4 的 13 条铁律当作不可
违反的约束;再按 §2 顺序通读 00/03/02/01 四份文档;参考代码在 reference/{openai-codex,
codexia,wisp-science},只学结构禁止复制粘贴代码。

第二步:从 main 拉分支 r12/workbench-full,按 02-construction-plan.md 的批 0→1→2→3→4→5→6→7→8
顺序施工。每一批:
  1. 只改该批范围内的文件;
  2. 完成后跑 §6 全部自查命令(pnpm -r typecheck / pnpm test / pnpm verify /
     涉库批跑 PG smoke / 涉 Rust 批跑 cargo test),必须全绿;
  3. targeted git add 该批文件(绝不 git add -A),按仓库惯例提交(一批可多个 commit);
  4. 在 r12-desktop-workbench/reports/batch-N.md 按手册 §7 格式写汇报(含测试数量前后
     对比、改过的断言及理由、范围外发现、没做/存疑项);
  5. 然后才允许进入下一批。

硬性规则:
- 某批自查过不了且诚实修复数次仍红:停在该批,写 reports/BLOCKED.md(卡在哪、试了什么、
  需要人裁决什么),结束任务。禁止跳过该批继续、禁止削弱测试或改断言让它变绿。
- 需要真机(.app vibrancy 截图)或真 LLM key 的验收项:在该批汇报里标注「待人工」,
  不许伪造、不许用 mock 冒充真验收。
- 计划与代码现实冲突(表已存在/端点名被占):停下写进 BLOCKED.md,等人裁决。
- 不合并 main、不动 README 文档计数、不碰 docs/workhub/。

全部完成后:写 r12-desktop-workbench/reports/FINAL.md,汇总每批证据链接、整体测试数量
变化、所有「待人工」项清单、所有范围外发现。你的工作到此为止,等待人工审查。
```

> 一次性模式的代价要知道:批 0 的地基走歪会一路传染到批 8,人工审查发现问题时返工面更大;换来的是无人值守推进。审查方会对照每批 reports/ 与 02 验收门逐条对抗式核验。

### 逐批模式命令

### 批 0 · 数据与协议地基

```
阅读 WorkHub 仓库 r12-desktop-workbench/04-codex-execution-guide.md 全文并严格遵守其铁律,
然后执行 02-construction-plan.md 的「批 0 · 数据与协议地基」:
建 8 张新表(project_conversations / conversation_participants / conversation_messages /
action_cards / action_card_items / conversation_observer_state / user_ai_profiles /
project_ai_governance,列定义以 02 批0 为准,含 dispatch_policy 与 agent_runs 的
execution_hint/source_conversation_id 扩展列)、conversations 路由、/api/me/ai-profile、
workbench 聚合 VM、SSE conversation topic 族(事件命名照 01 §1 的 Delta/Begin/End 规范,
参考 reference/openai-codex/codex-rs/protocol/src/protocol.rs)。
conversation_messages 必须有 UNIQUE(conversation_id, seq)(参考 reference/wisp-science/
crates/wisp-store/migrations/0000_init.sql)。含批9 的协议 contract test 三条(claim 过滤/
租约接管/产物签名,见 03 §2E)。完成后按手册 §6 自查、§7 汇报,停下等验收。
```

### 批 1 · 工作台主窗外壳

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 1」:
Tauri 新增 workbench 窗口(原生 vibrancy,复用现有 HudWindow/玻璃约束,CSS backdrop-filter
在透明窗无效——这是本仓库踩过的坑,禁止依赖它)、open_workbench command 与
workhub://workbench 深链、apps/desktop-webview/src/workbench/ 三栏外壳+左栏项目树+
新建项目模态(视觉按 r12-desktop-workbench/prototype/index.html,SVG 图标不用 emoji)、
Spotlight registry 增「打开工作台」「新建项目」两条。桌面 UI 在浏览器验不了 vibrancy,
你的验收 = typecheck + 测试 + 说明哪些需要人真机确认。完成后自查、汇报、停下。
```

### 批 2 · 主区群聊 MVP

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 2」:
workbench 群聊视图(消息流/翻页/文件卡/系统事件折叠/成员条/正在输入)+ composer
(@ 文件·成员、# 会话、/ 技能三种 chip picker,chip 只存 id 不存内容——安全规范见
01 §6 与 reference/wisp-science/ui/src/app_support.rs:494-559 的纯函数解析器形态,
给解析器写同样风格的单测)+ 拖文件上传。数据流照 03 §2A。本批不接 LLM,@Cuu 不响应。
PG smoke 加双用户互发消息断言。完成后自查、汇报、停下。
```

### 批 3 · 静默观察者 + 行动卡

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 3」:
conversation-observer worker(仿 apps/api/src/workers/agent-runner.ts 的 claim-lease 模式;
水位线/静默窗口/安静时段/预算 reservation/失败静默,数据流照 03 §2B)、行动卡建卡与
追加语义、execute 项按受派人 dispatch_policy 分叉派发(接单即建工作副本,照 03 §2C)、
decide 项进 attention(同步改 proposal-review-attention.test 与 PG smoke 断言——
这是本仓库踩过的坑)、行动卡 UI+线程+撤销(撤销要语义化留痕,参考 01 §4)。
观察者 prompt 进 packages/agent,输出结构化 schema。完成后自查、汇报、停下,
并在汇报里注明哪一步需要真 LLM key 冒烟(人来跑)。
```

### 批 4 · 协同会话 + 模式五档

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 4」:
POST /conversations/:id/turns 轻量 run 通道(流式 SSE 三段式照 01 §1)、工具 chips UI
(连续只读调用聚合,参考 reference/codexia/src/components/cc/session/messages/
ExploredGroup.tsx)、产出卡(+a -b 撤销/交给审核,审核走 openProposalFromManifest 复用)、
记忆引用折叠、模式五档全链路(存储→执行 gate→UI;第 5 档接现有 auto_merge verdict,
高风险类别在 5 档仍升级——给这条红线写单测)、@/#// 三类引用的服务端展开+防注入包裹
(照 01 §6,参考 reference/wisp-science/src-tauri/src/lib.rs:1936-2043)。
完成后自查、汇报、停下。
```

### 批 5 · 军团面板

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 5」:
run 溯源接线(source_conversation_id/source_action_card_item_id)、per-assignee 执行身份
注入(memories/技能/预算 scope,成本记 assignee,真 PG 测)、右栏情境面板三区
(输出/军团/后台任务)+run 卡下钻详情+军团总览(聚合端点逐 actor 鉴权进 SQL,带 cap
分页,禁 N+1)、猫名代号(runId 哈希→词表,确定性可测)。面板订阅用一条事件流按 id
切片(照 01 §7,参考 reference/codexia/src/components/agent/AgentCard.tsx:28-52),
不许为每张卡开独立连接。完成后自查、汇报、停下。
```

### 批 6 · 网盘整合 + git 化

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 6」:
drive 视图迁入工作台标签(spotlight 内保留同组件)、聊天互通(file_card 点击右栏预览/
拖入上传/合并后自动归档+系统事件卡)、版本历史+回滚 UI(project_drive_versions 列表;
回滚=追加新版本不抹历史;缺 rollback 端点则补,回滚是可审计操作)。用户面文案全程
去黑话(「找回之前的版本」,不说 revert)。完成后自查、汇报、停下。
```

### 批 7 · Cuu 联动与通知

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 7」:
打扰路由(workbench 前台=窗内呈现;后台=桌宠气泡+系统通知;点气泡深链定位会话/行动卡)、
被派活告知气泡话术(对齐仓库既有 Cuu 二次元文案基调)、桌宠状态钩子(彩蛋级)。
通知 dedupe 遵循现有 generation 语义,不另起炉灶。写打扰矩阵测试(前台/后台 ×
消息/行动卡/派活/提议)。完成后自查、汇报、停下,注明真机验收项。
```

### 批 8 · 收尾加固

```
阅读 r12-desktop-workbench/04-codex-execution-guide.md 并遵守铁律,执行 02 计划「批 8」:
空态全套(00 §9 表逐条)、行动卡线程→replay 跳转、长会话摘要压缩(压缩事件用户可见,
照 01 §11)、消息列表虚拟滚动、军团总览分页 cap 复核、全量 gate(pnpm verify+lint+
release-gate+PG smoke)。列出图文验收报告所需的四条演示线(群聊闭环/单聊产出/
派活跨人/版本回滚)的操作步骤清单(报告由人来截图出)。完成后自查、汇报、停下。
```

---

## 9. 卡住了怎么办

- 计划与代码现实冲突(表已存在/端点名被占/约定不一致):**停下,写清冲突点,等人裁决**。不要自作主张绕过。
- 参考代码看不懂:先看 01 文档里那条的「抄法」一句话,它说明了我们要的是什么形状。
- 测试环境起不来:PG 容器等基建问题写进汇报,不要为了绿而跳过测试。
