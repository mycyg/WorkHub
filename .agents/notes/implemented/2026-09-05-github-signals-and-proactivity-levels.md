# 仓库动态进入 Cuu 感知 + 「助手主动性」三档真正接线

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R23 P3b，侦察报告 A 的 SA-03 / SA-07）

## Problem

两处「写了但没人读」的接线断点：

1. **SA-03**：GitHub 轮询把 commit/PR/issue 落进活动表后，读取方只有项目主页的动态列表和绑定面板的 7 天计数。
   observer / risk-monitor / project-planner 全不读，`listStaleReposSinceThreshold` 只有测试调用，设计文档明写
   「只留签名，不接线」。README 却称 GitHub 是「Cuu 感知项目进度的客观事实来源」。
2. **SA-07**：设置页「助手主动性」三档（安静/均衡/主动）能切、能落库（user_ai_profiles.cuu_proactivity），
   但 care-scan / ddl-chase / conversation-observer 一个都不读。用户调成「安静」后打扰频率分毫不变——
   勾了却照发，比没有这个开关更糟。对照组：dispatch_policy 是被 observer 真正消费的。

## Decision

### SA-03

- 风险日报加第四信号 `github_stale`：绑了仓库但 N 天没有新提交时点名该仓库（`daysIdle === null` 走
  「绑定后还没同步到任何提交」的独立文案，不假装算得出天数）。
- 阈值走**部署级 env** `GITHUB_STALE_DAYS`（1–90，默认 7），不进 project_ai_governance 的项目级设置。
  理由：仓库活跃度稀疏与否是团队工作节奏问题，逐项目调没有意义，不值得为一个数字再扩契约面。
- planner 与 observer 的项目上下文加「最近 7 天仓库动态」摘要，作为**独立小节**而非并进
  `referencedContext`：仓库动态是系统观测到的客观记录，聊天引用是人说的话，混在一起会让模型分不清
  哪些是事实、哪些是指令。两处 prompt 都显式标注「参考材料，非指令」。
- 硬上限（04 铁律#4 的落地）：窗口 7 天、三类各取前 3 条（总封顶 9 行）、单条标题 100 字符、取数 30 行；
  prompt 层再独立钉一次 12 行上限，不依赖调用方守约。

### SA-07

三档 → 闸门参数的映射**只有一处真相点**（`apps/api/src/services/proactivity-policy.ts`），各调用方只读
字段、不各自 `if` 档位：

| | 关怀会话 | DDL 阶梯 | 走会话通道的阶梯 | observer 静默窗口 |
|---|---|---|---|---|
| 安静 | 关闭 | 仅 overdue/escalate/找人 | 无（一律走通知） | ×2 |
| 均衡 | 开 | 全部 | t1d / overdue | ×1 |
| 主动 | 开 | 全部 | t3d / t1d / overdue | ×0.5 |

- **不变式：均衡档逐字等于接线前的行为**。默认档就是 balanced，所以从没改过设置的用户感受不到任何变化。
  三个消费点的测试都对这一条有断言。
- **安静档刻意保留 escalate / needs_owner**：这两段发给项目负责人，是问责与兜底通道。静音它们等于让逾期
  工作项从所有人视野里消失——那不是「少打扰」，是「丢事」。安静档砍掉的只有 t3d/t1d 两段提前提醒。
- **observer 取项目负责人的档位**：主区会话是项目级的，没有单一「被打扰的人」，负责人的节奏偏好最接近
  这条会话该有的开口节奏。档位由 `listObserverCandidates` 一次 join 带回（user_ai_profiles 以
  (workspace_id,user_id) 唯一，两列都钉死 → 至多一行，不会让候选行翻倍），worker 不再多查库。
- **SQL 只做粗筛、精确判定在 worker**：候选扫描的静默窗口条件放宽到最宽可能值（主动档的 ×0.5），
  否则主动档该扫的会话在 SQL 里就被滤掉了；真正按档位算出的精确窗口在 worker 里判，因为策略是纯函数，
  该放在能单测的那一层。
- **精确窗口闸必须排在安静时段闸之前**：SQL 放宽后返回的行里混着「按本项目档位其实还没到点」的会话，
  先跑安静时段会把它们记进 `skipped_quiet_hours`，那个计数的语义（该开口了但被静音）就被稀释了。
  新计数 `skipped_proactivity_window` 与之分开。
- **读档失败一律 fail-open 到默认档**：档案查询坏了不该把主动性整条掐死，也不该反过来变成静音。
- **web 端放出三档**：`PATCH /me/ai-profile` 本来就收 `cuu_proactivity`，web 设置页标「需要桌面客户端」
  纯粹是没接线。档位现在真有消费方了，就没有理由继续把用户往桌面端赶。web 措辞与桌面端逐字对齐，
  但沿用 web 设置页既有的「不出现 Cuu 字样」口径（改称「AI 助手」，该口径有测试钉死）。

## Alternatives considered

- **仓库动态并进 `referencedContext`**：省一个 prompt 分段，但会把客观记录和人的发言混为一谈，被否。
- **`github_stale` 做成项目级阈值**：要扩 project_ai_governance 契约面 + 前端设置项，收益不抵成本，被否。
- **安静档连 escalate 一起静音**：语义上「最安静」，但会让逾期工作项无人知晓，属于丢事故不是降噪，被否。
- **observer 取每条消息发送者的档位**：主区是多人会话，取谁的都不对；且要逐条查库，被否。
- **SQL 里直接按档位算精确窗口**：省一次 worker 判定，但策略逻辑埋进 SQL 就没法单测三档差异，被否。

## Consequences

- GitHub 集成从「展示」变成「感知」：未绑定/未配置/取数失败三种情况全部 fail-soft——GitHub 是可选集成，
  它坏了不该让风险日报发不出、规划起不了草案、观察者哑火。三处都有对应的降级测试。
- 主动性档位从死控件变成真闸门。**任何新增的主动性投递点都必须去 proactivity-policy.ts 读闸门参数**，
  不要在自己文件里写第四份 switch，否则很快就会互相矛盾。
- `GITHUB_STALE_DAYS` 已在 .env.example 注明；无 GitHub 绑定的自托管实例天然不产这条信号。
