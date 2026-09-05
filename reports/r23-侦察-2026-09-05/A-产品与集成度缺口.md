# 侦察报告 A：产品承诺与集成度缺口（2026-09-05）

范围：main-integration 工作树当前文件内容（含 2026-08-20 未提交改动）。只读侦察，全部行号为亲自读取。
不重复 reports/审查台账-2026-08-19.md 已 ☑ 条目；第十六节 F-01..F-10 由同事核实，本报告只在必要处引用不重报。
尊重 .agents/notes：不再提「展示层正则洗术语」；遵守「不允许界面未上线」口径（implemented/2026-08-20-land-all-reserved-features.md）。

价值等级：高 = 直接击穿 README 承诺或主闭环；中 = 功能存在但链路断/用户被误导；低 = 产品空白，需拍板。
工作量：S < 1 天；M 1–3 天；L > 3 天。

---

## 一、发现清单（按杠杆排序）

### SA-01 ｜高｜ 产品主面只在桌面端，而桌面端既无法分发也连不上自托管服务器——README「三步走」用户拿不到主打功能

问题：README 把「完整的项目群聊」列为「可以点开跑起来的真实功能」（README.md:30-32），但群聊、行动卡认领、私聊、个人空间、看板、时间线编辑全部只存在于桌面工作台；web 端 `/conversations/:id` 是刻意的只读镜像，不能发言/反应/已读/认领。与此同时，桌面客户端 (a) 没有任何构建/打包/安装说明与发布流水线，(b) 打包后的 CSP `connect-src` 只放行 127.0.0.1/localhost，连不上 README 第三步部署在 `http://<机器 IP>:8787` 的服务器。结果：按 README 自托管的团队，只能用一个「只读镜像 + 审批/工单」的 web，产品定位里的「打开一个项目，你看到的是一个群聊」在该路径上不可达。

证据：
- README.md:30-32（群聊为「真实功能」）、README.md:61-63（三步走只交付 web）。
- packages/ui/src/gold-path/route-components.ts:640-641（「只读镜像 · 完整协作请在桌面工作台」「不能发言、反应或标记已读」）、:5233-5236（注释：无 composer、无任何写按钮）、:5402-5417（行动卡在镜像里只渲标题，无认领/决定按钮）、:4771（里程碑「到桌面工作台的『时间线』标签里建」）。
- apps/web/src/my-conversations.ts:53,58（web 侧个人空间/私聊只读列表：「完整的新建与聊天在桌面工作台里」）。
- packages/api-client/src/client.ts：无任何 action-card 方法（grep `action` 仅 :565 `resolveBudgetDecision`）；apps/web/src/browser.ts 零处调用 action-card 端点；后端端点在 apps/api/src/routes/action-cards.ts:62,74。
- apps/desktop-webview/src/workbench/rail.ts:1144-1158（个人空间只能在桌面创建）。
- client-tauri/src-tauri/tauri.conf.json:16（`connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:* ws://…`）；apps/desktop-webview/src/desktop-api-base.ts:6-7（注释原话：「即使存进了非回环地址，打包后的 webview 也连不出去」）。
- .github/workflows/verify.yml:78-81 只跑 cargo fmt/clippy，无 `tauri build`/bundle；README.md / README.en.md / DEPLOY.md / CONTRIBUTING.md 对 dmg/.app/桌面安装零说明（grep 仅命中架构描述 README.md:111）；client-tauri/ 下无任何 README。

建议做法（二选一或并行，需拍板）：
1. 把 web 只读镜像升级为「轻量可写聊天」：发送文本、反应、已读上报、行动卡 decide/undo（后端端点全在：conversation-message-actions / conversation-read / action-cards），保持桌面为全功能。这样 README 三步走的用户就能用到主闭环。
2. 让桌面客户端真正可交付：`tauri build` 发布工作流 + 首启「服务器地址」设置卡 + CSP 放行用户配置的 https 主机（DSK-05 台账里已注明「打包后连远端 https 后端的取舍待评估」，需在此拍板）+ README 增加「获取桌面客户端」段落。
在拍板前，README「功能亮点」至少应诚实标注「群聊在桌面客户端」。

工作量：L（方案 1 约 M+，方案 2 约 M；两者合计 L）。建议模型：opus（跨两端+安全边界设计）。

---

### SA-02 ｜高｜ 会议模块是死胡同：导入转写后没有任何代码生成纪要/洞察，页面却叫「会议洞察」并挂着「生成草稿」链路

问题：唯一的会议数据入口是「导入会议转写」，仓库层只把文本存成 `status: "transcribed"` 的 meeting_records 行；全仓（apps/packages/scripts）不存在任何对 `meeting_insights` 的写入，也没有生成 `minutes_md` 的代码。于是：页面标题「会议洞察」、洞察卡「生成草稿/忽略」、通知类型 `meeting.insight.pending`、全局搜索的「会议纪要」检索（索引 minutes_md）全部空转；用户导入后只会看到「转写已导入」+「这次会议还没有纪要内容」+「这个项目还没有会议洞察」。桌面端根本没有会议视图。规格树 M-MEETING 承诺的是「转写 → AI 纪要 → AI 洞察 → 需求草稿」。

证据：
- packages/db/src/repositories/meetings.ts:174-208（importTranscript 仅 insert meeting_records，status "transcribed"，写审计后返回）。
- grep `insert(meetingInsights)` / `meeting_insights` 写入：apps、packages、scripts 均 0 命中（仅 schema/core.ts:1225 定义与各仓库层读取）。
- docs/workhub/04-modules/meetings-and-insights.md:10（「录制/上传 → ASR 转写 → AI 纪要 → AI 洞察 → 需求草稿（人确认）」）、:41（AI 工人态默认自动产出纪要+洞察）。
- packages/ui/src/gold-path/route-components.ts:690-707（「会议洞察」「生成草稿」「这个项目还没有会议洞察」「转写已导入」）、:3428-3437（纪要空态文案）、:3545（导入入口）。
- packages/db/migrations/0057_search_trgm_indexes.sql:30（搜索索引 `minutes_md`，但从未被填充）；README.md:33（「跨…会议纪要检索」）。
- 桌面端：grep `meetings` 在 spotlight/views 与 workbench 仅命中 spotlight/views/search.ts（无会议视图）。

建议做法：新增「会议分析」服务 + worker（形态照 conversation-observer：isConfigured 门控、disableThinking、预算闸、幂等）：导入落库后排队 → LLM 产出 minutes_md + insights（kind ∈ new_requirement/requirement_change/normal_note，带 confidence_reason）→ 写 meeting_insights + 状态 transcribed→ready → 触发既有 `meeting.insight.pending` 通知。无 key 时页面诚实标注「AI 未配置，仅保存转写」。

工作量：M。建议模型：opus（提示词+输出契约+worker）。

---

### SA-03 ｜高｜ GitHub 集成只是「展示」：活动从未进入 Cuu 的任何感知/巡检/规划上下文，README 却称其为「Cuu 感知项目进度的客观事实来源」

问题：轮询 worker 只把 commit/PR/issue upsert 进活动表；读取方只有项目主页的「GitHub 动态」列表和绑定面板的 7 天计数。conversation-observer、risk-monitor、meta-planner、project-planner、agent-runner 全都不读 GitHub 数据；设计文档里为 Cuu 巡检预留的 `github_stale` 信号与 `listStaleReposSinceThreshold` 查询函数被明确标注「只留签名，不接线」，且该函数至今只有测试调用。

证据：
- apps/api/src/services/github-poll.ts:126-154（只 upsertActivity）。
- 读取方：apps/api/src/services/project-home-pages.ts:61-64,129,251（展示）；apps/api/src/services/github-bindings.ts:192-195（activity_count_7d）。
- packages/db/src/repositories/github-bindings.ts:319 `listStaleReposSinceThreshold`：全仓调用仅 packages/db/src/github-bindings.test.ts。
- grep `github` 在 apps/api/src/workers 与 services（非测试）只命中 pulse-scheduler.ts:195 注释、github-*.ts、project-home-pages.ts——observer/risk/planner/runner 均无。
- r14-release-readiness/07-gh-design.md:186-198（「不在本批实现落库消费，只在设计里标注钩子位置」）、:562（「只留查询函数签名，不接线」）。
- README.md:37。

建议做法（最小闭环两步）：
1. risk-monitor 接第四信号 `github_stale`：项目有绑定且 N 天无 commit 但存在 ai_working/in_progress 工单 → 进日报（群聊系统消息 + 通知）与项目健康页。
2. 把「最近 GitHub 活动摘要」注入 conversation-observer 与 agent-runner 的项目上下文（复用 `listRecentActivitiesByProject`），让 Cuu 拎活/执行时能引用客观进度。

工作量：M。建议模型：sonnet（已有信号框架与仓库方法，接线为主）。

---

### SA-04 ｜高｜ 生产模式（APP_ENV=production 强制 AUTH_MODE≠nickname）下 web 端没有任何登录表单：昵称报到 404，密码登录只有桌面端接了

问题：配置守卫在生产环境拒绝 nickname 模式（只能 password/hybrid）；而一旦不是 nickname 模式，`POST /api/auth/identify` 直接 404，web 端唯一的入口屏 `renderOnboardingScreen` 只有「昵称 + 管理员口令」字段，失败后只把错误文案回显在同一个引导页。`client.login`（POST /api/auth/login）只被桌面端 `desktop-login.ts` 使用，web/ui 无任何登录表单。受邀用户经邀请落地页首次可登录（服务端 mint 会话），但会话 7 天闲置 / 30 天绝对过期后、或换浏览器/设备时，web 用户无路可走。DEPLOY.md「暴露到公网」一节也没提 AUTH_MODE 要求与首个管理员如何注册。

证据：
- packages/config/src/env.ts:432-436（生产禁 nickname）。
- apps/api/src/routes/auth.ts:65-67（hybrid/password 均为 passwordModeEnabled）、:328-332（identify 404「昵称登录在当前认证模式下不可用」）、:481-484（register 仅密码模式）、:561-564（login）、:826-829 + :893-894（invites/accept 后 mintSession + issueSessionCookie）。
- apps/web/src/browser.ts:5307（只渲 renderOnboardingScreen）、:5364-5367（只调 identify）、:5391-5395（失败回引导页显示错误）。
- packages/ui/src/onboarding.ts:11-23,38（字段仅昵称/语言/管理员口令；文案「无需密码，凭昵称报到」）。
- grep `renderLogin|wh-login|凭据登录` 在 packages/ui/src 与 apps/web/src（非测试）= 0；packages/api-client/src/types.ts:331（login 注释：桌面凭据登录）；apps/desktop-webview/src/desktop-login.ts:1-8。
- packages/config/src/auth.ts:10-11（sessionAbsoluteTtlHours 720 / sessionIdleTtlHours 168）。
- DEPLOY.md:136-138（生产段只列 COOKIE_SECRET/COOKIE_SECURE/CORS，未提 AUTH_MODE）。

建议做法：web 补「邮箱 + 密码」登录屏——首屏先探测模式（identify 404 → 渲登录表单，复用 `client.login`；nickname 模式保持现状），登出/会话过期同样落到该屏；DEPLOY.md 生产段补 AUTH_MODE、首个管理员走 `/register` + ADMIN_CLAIM 的流程说明。

工作量：S–M。建议模型：sonnet。

---

### SA-05 ｜中｜ Cuu 主动关怀 / 追 DDL 的「会话通道」依赖个人空间，而个人空间只能在桌面工作台创建：纯 web 用户永远收不到关怀，追 DDL 全部降级成系统通知

问题：R15 主动性链路本身闭合（intent → 频控闸 → 三通道 → 恢复扫描），但 conversation_message 通道只认「is_personal=true 且 owner=目标用户」的个人空间主区；care 明确 `degradeToNotification=false`（投不成直接 suppressed），DDL t1d/overdue 降级为通知。创建个人空间的唯一入口在桌面 rail；web 只有只读列表并写明「完整的新建…在桌面工作台里」。叠加 SA-01（多数自托管用户只有 web），主动性最有温度的那条通道对他们是断的，且没有任何提示告诉用户「建个个人空间 Cuu 才会来找你」。

证据：
- apps/api/src/services/proactive-cuu-delivery.ts:17-18,33-34。
- apps/api/src/services/care-scan.ts:34,139-143；apps/api/src/services/proactive-intents.ts:96-99（no_personal_space 抑制）；apps/api/src/services/ddl-chase.ts:247-259。
- 创建入口：apps/desktop-webview/src/workbench/rail.ts:1144-1158；服务端 apps/api/src/routes/personal-projects.ts:46,55。
- web 侧：apps/web/src/my-conversations.ts:53,58。

建议做法：服务端在用户首次登录/首次成为成员时幂等 ensure 一个个人空间（个人空间语义本就是 1:1 自动命名「我的空间」），或最低限度在 web 项目页补「新建个人空间」按钮（端点已在）。care/DDL 的 suppressed(no_personal_space) 计数应在军团后台任务区可见（render.ts 已接 pulse stats，可顺手带上）。

工作量：S。建议模型：sonnet。

---

### SA-06 ｜中｜ 「AI 反馈闭环」默认是断的：夜间技能蒸馏 worker 默认关闭、部署文件从未提及、无手动触发——差评被收集但无人消费

问题：README 承诺「差评会真实进入夜间技能蒸馏的反例池」。消费逻辑确实写好了（curation prompt 里的反例段），但 worker 只在 `AGENT_RUN_SKILL_CURATION_ENABLED=true` 才启动，默认 false；.env.pilot.example、docker-compose.pilot.yml、DEPLOY.md、README 均未出现该变量；团队技能治理路由没有「立即蒸馏」入口。默认自托管下反馈永远不会进入蒸馏。

证据：
- apps/api/src/server.ts:40-44；packages/config/src/env.ts:116（default(false)）；.env.example:111（false）。
- grep `SKILL_CURATION` 在 .env.pilot.example / docker-compose.pilot.yml / DEPLOY.md / README.md = 0。
- apps/api/src/routes/team-skill-governance.ts:52-76（仅 manage 读/改/停用，无触发端点）。
- 消费点（已接）：apps/api/src/services/skill-curation.ts:45-49,144-146,185-202。
- README.md:35。

建议做法：默认开启（worker 内部本就受 provider isConfigured 与预算闸门控），或至少：在 .env.pilot.example/DEPLOY.md 暴露该开关；技能管理页显示「上次蒸馏时间 / 未启用」；给管理员一个「立即蒸馏」按钮（复用 curation tick）。

工作量：S。建议模型：sonnet。

---

### SA-07 ｜中｜ 设置页「助手主动性」三档（安静/均衡/主动）是死控件：落库可切换，但没有任何 worker/服务读取它

问题：桌面设置页渲染三枚 chip（「很少主动开口，等你来问 / 看情况开口 / 更爱主动汇报进展」）并 PATCH 到 user_ai_profiles；但 conversation-observer、ddl-chase、care-scan、proactive-intents、conversation-turns 无一读取 `cuu_proactivity`。同面板的 `dispatch_policy` 却被 observer 真正消费（对照组）。用户调成「安静」后打扰频率不变，正是「勾了却照发」。web 端把它标为「需要桌面客户端」，等于把一个无效控件包装成桌面独享能力。（R19 SSOT 里 R19-33 标「待拍板」，至今未处置，本条给出接线方案供拍板。）

证据：
- apps/desktop-webview/src/spotlight/views/settings.ts:95-103（三档文案）、:150-155（chips）、:1121-1124（PATCH）。
- apps/api/src/services/ai-settings.ts:282,354（只读写画像）。
- grep `cuuProactivity|cuu_proactivity` 生产代码：仅 openapi.ts、contracts/domain/conversation.ts、db/repositories/ai-settings.ts、settings.ts——零消费者。
- 对照：apps/api/src/workers/conversation-observer.ts:476-538（dispatch_policy 真被消费）。
- packages/ui/src/gold-path/route-components.ts:5611（web：「助手主动性…需要桌面客户端」）。

建议做法：把三档接进 proactive-intents 闸与 observer：quiet → 关闭 care、DDL 仅 overdue 且只走通知、observer 静默阈值放宽；balanced = 现状；proactive → 允许 t3d 走会话、observer 阈值收紧、run 完成主动汇报。否则删掉控件。

工作量：S–M。建议模型：sonnet。

---

### SA-08 ｜中｜ 无 key 首日体验与 README 不符：web 没有「顶部横幅」，AI 未配置只藏在设置页一行；LLM key 只能改 env 重启，管理员无 UI

问题：README 说「顶部会出现一条『AI 服务未配置』的横幅提醒」。实际：这句文案只存在于桌面工作台聊天输入区；web 端只有设置页一行 pill「未配置」+ 一句提示，首页/intake/审批页均无任何提示，新用户第一次提需求才撞上 502（台账 INT-02 ☐ 已记错误提示问题，本条是入口/横幅与配置路径角度）。此外 ai-settings 路由只有个人画像与项目治理，provider/key 只能改环境变量并重启容器——对「成本可控性」与首日体验都是硬门槛。

证据：
- README.md:65。
- grep `AI 服务未配置`：仅 apps/desktop-webview/src/workbench/chat/render.ts:1726。
- web：packages/ui/src/gold-path/route-components.ts:5794-5795（设置页 pill 与一句提示）；apps/api/src/pages/attention.ts 无 configured/ai_available 字段（grep 空）；product-shell.ts:575,633 的 `[data-wh-app-notice]` 只承载动作通知，无 AI 就绪态。
- apps/api/src/routes/ai-settings.ts:44-60（仅 /me/ai-profile、/projects/:id/ai-governance）；.env.example:63-66。

建议做法：web 壳层根据 settings VM 的 apiKeyConfigured 渲常驻提示条（含「去哪配」指引），intake 入口在未配置时预先禁用/说明；中期做管理员 UI 配置 provider/base_url/model/key（加密落库复用 secret-box，热更新 provider registry，不必重启）。

工作量：S（横幅）+ M（UI 配置）。建议模型：sonnet。

---

### SA-09 ｜中｜ 两端能力割裂矩阵：同一后端能力只在一端有入口，用户需在 web/桌面间来回切换

问题：除 SA-01 的「聊天族」外，还有反向的 web 独有能力，桌面（被定位为全功能客户端）反而没有：

| 能力 | web | 桌面 | 证据 |
|---|---|---|---|
| 会议导入/洞察确认 | 有 | 无会议视图 | route-components.ts:3545；桌面 grep `meetings` 仅 search.ts |
| 预算策略编辑（成本可控性） | 有（admin） | 成本页只读 | apps/web/src/browser.ts:3315-3353；apps/desktop-webview/src/spotlight/views/dashboards.ts:530-539 `readOnlyView` |
| 群聊/私聊/个人空间/看板/时间线编辑 | 只读镜像 | 有 | SA-01 |
| 助手主动性/细粒度开关/模型档位 | 「需要桌面客户端」 | 有（主动性为死控件，SA-07） | route-components.ts:5611 |

建议做法：先拍板口径（例如「桌面 = 全功能，web = 审批/只读」），再按口径补齐：桌面项目设置补「会议导入」与「预算策略」（后端端点齐全）；web 若走 SA-01 方案 1 则补聊天写路径。

工作量：M。建议模型：sonnet。

---

### SA-10 ｜低｜ 单工作区硬编码：所有 actor 回落 defaultWorkspaceId，没有创建/切换工作区的端点与 UI

问题：schema 有 workspaces / workspace_memberships，但鉴权把无成员行的用户一律落到配置里的默认工作区；app.ts 未挂任何 workspaces 路由；web/桌面均无切换器。多团队/多客户只能多部署，且用户在界面上看不到「工作区」概念，权限模型（工作区 admin/owner/member + 项目级 manage）无处解释。DEPLOY.md 只写了「单实例」，未写「单工作区」。

证据：
- apps/api/src/middleware/auth.ts:309,359,374,501-509。
- apps/api/src/app.ts:246-312（无 workspaces 路由）。
- packages/db/src/schema/core.ts:216,236。
- grep `switchWorkspace|切换工作区|listWorkspaces|/api/workspaces` 在 web/desktop/ui/api-client/routes = 0。

建议做法：短期在 DEPLOY.md 与设置页明示「单工作区」口径与角色含义；产品若要面向多团队再做工作区创建+切换（那是 L 级）。

工作量：S（明示）。建议模型：sonnet。

---

### SA-11 ｜低｜ 无导出/分享：交付物、回放、审计、成本无导出，无分享链接

问题：一个强调「回放 + 成本 + 审计」可信交付物的产品，没有任何导出（CSV/Markdown/PDF）或对外分享能力；只有网盘单文件下载。管理者要向上汇报或向未入驻的干系人展示时无路可走。

证据：
- grep `导出|分享|exportCsv|shareLink|share_link|复制链接` 在 packages/ui/src、apps/web/src、apps/desktop-webview/src（非测试）= 0 有效命中（仅注释里的「导出的」用词）。
- 仅有的下载：packages/ui/src/gold-path/route-components.ts:3222（网盘单项 href）。

建议做法：先做两件小的：回放页「导出 Markdown」（步骤+成本+还原点）、成本页「导出 CSV」；分享链接需与权限模型一起拍板，暂缓。

工作量：S–M。建议模型：sonnet。

---

## 二、已核实为「打通」的链路（正面记录，供对照，不必再查）

- 全局搜索直达：web 会话命中 → `/conversations/:id?seq=`（apps/web/src/browser.ts:4085-4090），网盘 → `/drive?project_id&item_id`（:4150），会议 → `/meetings?project_id&m=`（:4160）；桌面网盘/工单逐项深链、会话到工作台（apps/desktop-webview/src/spotlight/views/search.ts:8-12）。桌面会议直达为 F-09（同事）。
- 通知落点：每条通知带 open 动作 href（packages/ui/src/gold-path/route-components.ts:3741）；会话类通知附 conversation_id（apps/api/src/services/notifications.ts:164-169,188-192）。
- AgentRun 真消费记忆/技能/项目指令/网盘：apps/api/src/workers/agent-runner.ts:1739-1745（agentMemory/userMemory/teamSkills/projectInstructions）、:1789、:1801-1803；项目网盘水合为只读 project/ 目录 :1691-1703,917-920。
- 反馈 → 蒸馏提示词已接（apps/api/src/services/skill-curation.ts:185-202），断点仅在 worker 默认关闭（SA-06）。
- 风险巡检日报同时进群聊系统消息与通知（apps/api/src/services/risk-monitor.ts:357-395），且不受 isConfigured 门控。
- 主动性管线：approval-sla / notification-reminder / approval-digest / ddl-chase / care-scan / clarification-chase / proactive-intent-recovery 七任务全部注册并默认启用（apps/api/src/workers/pulse-scheduler.ts:228-377；packages/config/src/env.ts:138 PULSE_SCHEDULER_ENABLED 默认 true）；军团面板已接 pulse stats（apps/desktop-webview/src/workbench/army/render.ts:360-381）。断点只在投递面依赖个人空间（SA-05）与用户档位不生效（SA-07）。
- pg_trgm 承诺属实（packages/db/migrations/0057_search_trgm_indexes.sql:15-34）。

## 三、建议施工顺序

1. SA-04（S–M，生产部署硬阻断）→ 2. SA-06 + SA-05（各 S，两条 README 承诺一天内可回真）→ 3. SA-01 拍板（决定 web 可写 vs 桌面分发，牵动 SA-09）→ 4. SA-02、SA-03（各 M，把「会议」「GitHub」两条亮点从展示变成 Cuu 感知）→ 5. SA-07、SA-08 → 6. SA-10、SA-11 视产品方向。
