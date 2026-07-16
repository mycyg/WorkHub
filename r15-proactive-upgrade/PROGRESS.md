# R15 施工进度台账

2026-07-16 追加:launchChrome CDP 测试去 flake(真因=stopChrome 1200ms 放手 vs sh trap 延迟的竞态+trap 晚于 marker 安装),负责人亲修合入 wave1(29862eac),3 连跑全仓测试绿,flake chip 关闭。

**终态(2026-07-15):规划与脑暴清单全部落地。** wave1 = main+27 个合并单/109 commits/213 文件 +30378-755,终班全量集成验证 GREEN(typecheck+全包测试+cargo;apps/web 一例预置负载 flake 已排除并立 chip)。任务看板 24/24 完成。未推远端,等用户决定推 CI/真机验收/翻 loop2 默认。

负责人维护。流水线模式:子 agent(sonnet/opus)后台施工,负责人审查合并。基线 main `4653b358`。

## 产线状态

| 产线 | 分支 / worktree | 承包 agent | 状态 | 审查 |
|---|---|---|---|---|
| G-web 止血(7 项) | `r15/g-web` @ wh-r15/g-web | sonnet | **已合入 wave1**(761fae31) | 审查通过+复验绿 |
| G-desktop 止血(6 项) | `r15/g-desktop` @ wh-r15/g-desktop | sonnet | **已合入 wave1**(54595f6e) | 审查通过+复验绿。范围外:desktop-webview 缺 @workhub/events 依赖声明(已 spawn chip) |
| 全局热键(Alt+Space toggle 聚焦盒) | `r15/hotkey` @ wh-r15/hotkey | sonnet | **已合入 wave1**(11ceb7ee) | 审查通过+cargo 复验绿;真机 Option+Space 待手验 |
| loop2 Phase 1(四适配器) | `r15/loop2-phase1` @ wh-r15/loop2p1 | opus | **已合入 wave1**(78ad380a,38 新测) | 审查通过+复验绿。Phase 2 前置清单:截断 sanitize 进 configBuilder/顺序执行+afterToolCall 接线/seq 注入 |
| C 前三补丁(工具描述/结构化压缩/截断自愈) | `r15/c-engine-patches` @ wh-r15/c-engine | opus | **已合入 wave1**(b03ab8ef) | 审查(1 轮返修)+复验绿 |
| A1-A2(pulse 调度器 + 审批 SLA + 提醒阶梯) | `r15/a-pipeline` @ wh-r15/a-pipeline | opus | **已合入 wave1**(db239146) | 审查通过+复验绿。注记:创建后才静音类型的窄窗口提醒仍发,留 A6 |
| loop2 Phase 0(vendor pi loop 底座) | `r15/loop2-phase0` @ wh-r15/loop2 | opus | **已合入 wave1**(71e3f7c1,12 新测,保真 diff 仅 28 行) | 审查通过+复验绿。Phase 1 四适配器待 B/A 波次后排 |
| B 私聊后端切片(DM 容器+dm_key+开聊端点) | `r15/b-dm-backend` @ wh-r15/b-dm | opus | **已合入 wave1**(6ba7a9a5) | 审查通过+复验绿。2人不变量结构性成立;admin 无后门有断言 |
| A3-A5 后端(digest卡/未读聚合/消息通知) | `r15/a-wave2` @ wh-r15/a-wave2 | opus | **已合入 wave1**(自动合并零冲突) | 审查通过。亮点:自建逐会话观看者注册表(拒绝粗粒度 is_online)/digest 墓碑+新卡保 seq 不变量/mention 因无结构化数据不瞎猜。wave1 全量集成验证进行中 |
| B-UI(DM打开链路/roster/头像popover/分母修复) | `r15/b-ui` @ wh-r15/b-ui | opus | **已合入 wave1**(516a81a4) | 审查通过+复验绿。遗留小产线:请Cuu进来 PATCH 端点、小群分母参与者端点 |

## 第二班(2026-07-15 用户点头发车,基线 wave1 0843880a)

| 产线 | 分支 | 工人 | 状态 |
|---|---|---|---|
| A6 前端收尾(rail红点/托盘角标/snooze UI/内联批准) | `r15/a6-frontend` @ wh-r15/a6 | opus | **已合入 wave1**(5b57d04f),Dock 角标真机待手验 |
| 小产线(Cuu PATCH/参与者端点/小群分母/头部开关) | `r15/cuu-toggle` @ wh-r15/cuu-toggle | sonnet | **已合入 wave1**(4920adf4) |

第二班收班:六单全合(D 84718d8b / Phase2 f77c2de2 / cuu依赖补丁 c3304603 / A6 5b57d04f / 小产线 4920adf4 + events依赖补丁 9e7672de),wave1 第二轮全量集成验证 **GREEN**(install+typecheck+全包测试+cargo)。累计 16 个合并单。
| loop2 Phase 2(configBuilder+影子开关+双跑等价) | `r15/loop2-phase2` @ wh-r15/loop2p2 | opus | **已合入 wave1**(f77c2de2) | 审查通过+复验绿。Phase 3:真 key 冒烟/SSE 事件粒度适配器/结构化摘要移植 |
| 批次 D ProactiveIntent MVP(0063+频控闸+追DDL四阶梯+找人) | `r15/d-proactive` @ wh-r15/d-proactive | opus | **已合入 wave1**(84718d8b) | 审查通过+复验绿。D4 行动卡诚实降级为通知(observer 水位线强耦合) |
| 依赖补丁 2:apps/api 缺 @workhub/cuu 声明 | `r15/fix-events-dep` | 负责人亲修 | 复验中 | qa harness 直跑已恢复 |
| 小产线(Cuu PATCH+参与者端点+小群分母) | 排队 | - | 等 A6 合并(撞聊天区文件) |

补丁:desktop-webview 缺 @workhub/events 依赖声明——负责人亲修合入 wave1(9e7672de),仓库根直跑该包测试恢复正常,chip 已撤。

## 第三班(2026-07-15 用户令:全部落地打通再测,基线 wave1 4920adf4)

| 产线 | 分支 | 工人 | 状态 |
|---|---|---|---|
| E1 里程碑/依赖/甘特后端(0064+环检测+timeline VM+闭包) | `r15/e1-timeline` @ wh-r15/e1 | opus | **已合入 wave1**(f9e4f78f) |
| E3 规划 agent(草案→plan_review→物化) | `r15/e3-planner` @ wh-r15/e3 | opus | **已合入 wave1**(b9caba05,迁移0065,新表不污染 task_plans,草案行自带 review 语义) |
| D4 行动卡解耦(system 卡+找人交互化,迁移 0066) | `r15/d4-cards` @ wh-r15/d4 | opus | **已合入 wave1**(0e7b3c31,负责人手解 F/D4 四文件冲突:三通道+degradeToNotification 织合,journal 0063→0066 严格递增,解后回归绿)。纠正批D两个错误前提 |
| F 关怀批 | `r15/f-care` | opus | **已合入 wave1**(2e2d21dc,含负责人 1 条文案修订) |
| web 只读会话镜像 | `r15/web-mirror` | opus | **已合入 wave1**(路由 20→21,零写动作,发送者昵称暂用 /api/users 既有债) |
| D2 Cuu 主动开口(会话投递通道+追DDL接入+关怀接缝) | `r15/d2-cuu-speak` @ wh-r15/d2 | opus | **已合入 wave1**(fcf4e063) |
| F 关怀批(三信号/care-scan/模板/周频闸/opt-out) | `r15/f-care` @ wh-r15/f-care | opus | 施工中 |
| web 只读会话镜像(/conversations/:id+搜索/通知入口) | `r15/web-mirror` @ wh-r15/web-mirror | opus | 施工中 |
| 决策收件箱进 workbench(+digest 卡专属渲染) | `r15/wb-inbox` @ wh-r15/wb-inbox | opus | **已合入 wave1**(b82542e9)。范围外记录:合并冲突内联子面板样式微缺(低频) |
| E2 甘特前端+OKR UI(workbench 时间线 tab+web 只读路由) | `r15/e2-gantt` @ wh-r15/e2 | opus | **已合入 wave1**(78a17dea,负责人手解与 web-mirror 的路由并集冲突,解后回归绿)。残留:OKR 名称待 VM 增补/E3 起草按钮待接线/时间线行开工作项详情待接 |
| loop2 Phase 3 代码(SSE事件粒度/结构化摘要/动态工具面) | `r15/loop2-phase3` @ wh-r15/loop2p3 | opus | **已合入 wave1**(cad05fc8,含返修的瞬态重试)。白名单 6→3,翻默认仅剩真key/pg冒烟 |
| loop2 Phase 4 对话侧(steering队列灭409,默认off) | `r15/loop2-phase4` @ wh-r15/loop2p4 | opus | 施工中 |

工具链补丁 3:packages/agent test glob 未加引号致 loop2/adapters 42 测从未进包级测试/CI——负责人亲修(193→227)合入 wave1(0502b4c3)。

第四班队列:Phase 4 对话侧上 loop2(steering 白送干掉 409)、E2 甘特前端+OKR 双端 UI、F 关怀(记忆写入源+扫描)、决策收件箱进 workbench、web 只读会话镜像、E3 规划 agent 走 proposal 流、D4 行动卡解耦增强、digest 卡前端渲染。

## 排队中(第二波)

- A3-A6:digest 卡 / 未读聚合红点 / 消息通知→OS 桥 / 内联批准(等 A1-A2 + G-desktop 合并,动 conversations + workbench rail)
- B 私聊:DM 容器/dm_key/roster/头像 popover(等 A 通知管道)
- C loop2 Phase 0:vendor pi loop 底座(等前三补丁合并)
- 04 §二 双壳收敛:全局热键/决策收件箱进 workbench

## 合并纪律

- 子 agent 只在各自 worktree 分支 commit,不推远端,不碰范围外文件,不跑 qa smoke。
- 负责人逐分支审查 diff → 本地跑 typecheck/测试 → 合入 `r15/wave1` 集成分支 → 推远端跑 CI → 全绿后并 main(并 main 前知会用户)。
- 迁移号冲突风险:A 产线用 0056+(以合并时最新为准,集成时负责人复核)。

## Wave1 集成验证

2026-07-15 十单全部合入后,wave1(516a81a4+a-wave2 合并)全量集成验证 **GREEN**:pnpm install + 全仓 typecheck + `pnpm -r test` 全包测试 + cargo test 一次通过。待真机验收:Option+Space 热键、跨窗口登出、DM 端到端、锁屏 OS 通知深链、digest 卡真 PG 行为。未推远端(等用户点头推 CI/并 main)。

## 日志

- 2026-07-15 四条产线开工,worktree 基线 4653b358。
- 2026-07-15 G-web 交付:7/7 项完成(9fa0a958/397f4684/7202d650/7e0cac63)。亮点:main.ts 目录欠账比预期多(R10 起未同步)一并补齐;GitHub 端点核实 web 零调用点拒绝虚构;揪出 listProjects 实为 6 处调用点。审查结论=通过;小瑕疵:GitHub 空态文案对"已绑定但无动态"不精确(服务端三态不可区分,可接受)。范围外记录:browser.ts 无单测基建,SSE 窄化仅 grep 验证。r15/wave1 集成分支已建。
