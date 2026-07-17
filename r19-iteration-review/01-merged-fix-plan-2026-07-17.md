# R20 合流修复计划(2026-07-17)

两份独立审查对同一基线 main@33f52b16 的合流:

- **R19 卡点复审**(本仓 00-gap-review-2026-07-17.md):9 维度 workflow + 对抗核实 + 负责人终审,45 条(0H/23M/22L),偏产品断链与 UX。
- **codex 系统代码审查**(reports/WorkHub-系统代码审查-2026-07-17.md):三 lane 逐链深读,结论 HOLD,P0×2 / P1×12 / P2×11 / P3×2,偏安全边界、并发/崩溃窗口与可靠性。

**负责人独立核验**:codex 两条 P0 及承重 P1(P1-05/P1-10/P1-11)均亲手打开证据文件复核为真;P2-07/P2-08 与 R19-12/R19-24 互为独立重发现,交叉印证。**采纳 HOLD 结论:Phase 0 与 REL-1/2 收口前不扩大试用。**

## 一、两报告交叉对表

| codex | R19 | 关系 |
|---|---|---|
| P2-07 OS 通知点击不消费 route | R19-12 | 同一发现,双方独立证实(生产绑定漏传 onSystemNotification + notify.rs 无 click handler) |
| P2-08 破坏性操作单击即提交 | R19-24(web)/R19-23(桌面网盘) | 同簇:web 缺二次确认,桌面网盘删除缺确认+回收站入口 |
| P1-05 邀请 token 被重渲抹掉 | R19-4(已修正) | 互补:R19-4 给出接受落地页/撤销路由/桌面入口缺口,codex 抓到已交付 UI 的生命周期 bug |
| P2-06 web 会话镜像无实时流 | R19-15(web 无个人空间导航) | 同簇「web 会话体验断链」,合并施工 |
| P2-05 设备管理无 UI | —(R19 漏) | codex 独有 |
| P1-06 普通成员进不了 Settings | —(R19 漏) | codex 独有 |
| P1-08 /api/users 全局目录当花名册 | —(R19 漏) | codex 独有 |
| P0/P1 安全、并发、崩溃恢复全系 | —(R19 维度未设) | codex 独有 |
| — | R19-8 主动消息三端静默 | R19 独有(主动性观感核心) |
| — | R19-1/2/3 OKR/预算策略/回滚无 UI | R19 独有 |
| — | R19-19/20/21/22 归档/预览/审计页/评论区 | R19 独有 |
| — | R19-7/34-37 数据层孤儿表 | R19 独有(R19-38 死枚举已撤销:R17 G2 既档兼容债务) |
| — | R19-13/16/41/42 原生壳 locale/Reopen/updater/契约 | R19 独有(codex P1-04 第二实例深链丢失为近邻) |

结论:两报告重叠极小、互补性强。codex 管「地基与安全」,R19 管「可达性与体验」。

## 二、修复阶段(依赖顺序)

### Phase 0 — 安全封口(HOLD 解除门槛,最先做,全部需真实集成测试)

| 单 | 内容 | 来源 | 文件域 |
|---|---|---|---|
| SEC-1 | 成员移出 fail-closed:删无 membership 默认租户回退;移出=事务化撤销(membership+session/device+presence+SSE);identify 不自动补回被移出成员;补 remove→旧token→403 与 remove→identify→不恢复 测试 | P0-01 | apps/api middleware/auth.ts、services/workspace-members.ts、routes/auth.ts |
| SEC-2 | 身份代际+活跃流终止:Rust token state 加 generation/watch,清空或变更必中止当前 pump;服务端对撤销发布关流信号或心跳期重验 grant;logout 改有状态事务(修 P1-01 吞错);补 A登出→B登录→A事件不可达 测试 | P0-02+P1-01 | client-tauri sse_worker.rs/main.rs、apps/api sse/stream.ts、desktop-webview settings/boot |

### Phase 1 — 可靠性:不丢任务、不失联(REL)

| 单 | 内容 | 来源 |
|---|---|---|
| REL-1 | AgentRun 启动 drain:恢复 expired claims 之外同时 drain 既有 queued rows,含多实例 ownership | P1-10 |
| REL-2 | ProactiveIntent created 恢复:lease/attempt/next_attempt_at 或 outbox,created 视为可恢复态 | P1-11 |
| REL-3 | 并发闸:最后管理员 TOCTOU(workspace 级锁)+ 依赖 DAG 环(项目 advisory lock),并发事务测试 | P1-09+P1-12 |
| REL-4 | 桌面 SSE/poll 可恢复状态机:自制 EventSource EOF 重连+fallback polling 不永久停 | P1-03 |
| REL-5 | 桌面 password/hybrid 登录链路(后端已有,客户端零入口) | P1-02 |
| REL-6 | 第二实例深链 create-if-missing(与正常深链共享 handle_deep_link_plan) | P1-04 |

### Phase 2 — 断链与数据真实性(双报告合流主战场)

**2A api+SDK 打底**(解锁 2B/2C):workspace-scoped roster API(P1-08)、邀请撤销路由+接受契约(R19-4)、assign/claim(R19-18)、项目归档/删除(R19-19)、工作区审计端点(R19-21)、workitem comments(R19-22)、图片/PDF 预览(R19-20)、读游标清通知(R19-10)、主动投递补 user-topic 信号(R19-8)、rename 领域事件(P2-04);SDK:revertAgentRun/objectives/invites/devices 等(R19-1/2/3、P2-05)。

**2B web**:邀请 token 生命周期修复+接受落地页(P1-05+R19-4)、Settings 常驻+capability 统一(P1-06)、成员数改 roster(P1-08)、partial-failure 诚实态(P1-07)、会话镜像窄流订阅+seq 合并(P2-06)、个人空间入口(R19-15)、设备管理页(P2-05)、二次确认三处(P2-08/R19-24)、成本页三维度渲染(R19-6)、OKR/预算策略/审计页/评论区 UI(R19-1/2/21/22)。

**2C 桌面 webview**:通知点击深链 webview 半边(P2-07/R19-12)、权限策略撤销 UI(R19-5)、网盘删除确认+回收站(R19-23)+键盘可达(R19-25)、presence 单源(R19-11)、未读重连补缺(R19-9)、桌宠/rail 吃主动信号(R19-8 桌面半边)、AI 改动回滚按钮(R19-3)、新 DM 即时入栏(R19-40)。

**2D 原生壳(Rust,与 2C 命令桥协调)**:通知 click→深链原生半边、RunEvent::Reopen(R19-16)、set_shell_locale(R19-13)、updater/autostart/log+panic hook(R19-41)、local_file_sync 契约清理(R19-42)。

### Phase 3 — 一致性、工程质量与打磨

消息 outbox/replay(P2-01)、offboarding 可重入 job(P2-02)、审计写入不静默吞(P2-03)、语言偏好同步提示(P2-09)、头像弹窗焦点生命周期(P2-10)、Chrome QA 日志(P2-11)、cargo fmt/clippy 清零并进 CI(P3-01)、预算续租可观测(P3-02)、数据层孤儿表处置(R19-7/34-37,user_profiles 已剔除)、死端点/死参数清理(R19-29/30;SSE 事件枚举值按 R17 G2 既档约束一律保留)、R19 低危 UX 清单其余项。

### 需产品拍板(不盲建)

R19 批 H 原样保留:通知偏好粒度扩展(R19-44)、用户 reactivate(R19-45)、项目级成员/访问控制(R19-46)、Cuu 主动性三档接频控(R19-33)、合并融合预览步(R19-28)。另:loop2 双开关翻 on(R18 冒烟已放行,等拍板)。

## 三、验收门槛(采纳 codex 第 12 节,全程适用)

每个修复单至少一个「修复前稳定失败、修复后稳定通过」的根因测试;auth/membership/stream 必须真实身份轮换或真库集成测试;并发问题用并发事务复现;crash/restart 问题用「中间点退出+二次进程恢复」测试;禁止空 catch 吞错;`pnpm verify`+Rust test/fmt/clippy 全绿后才进双端手工验收。
