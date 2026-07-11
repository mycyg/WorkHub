# R12 · 用户流与数据流链路

> 状态:定稿 2026-07-12 · 回答三个问题:受派侧能否「自动建工作区+Cuu 审核」、审核放哪端、本地+服务端双 AI 怎么跑
> 配套:[00-interaction-design.md](00-interaction-design.md) · [02-construction-plan.md](02-construction-plan.md)

---

## 0. 三个问题的直答

**1)「收到派活默认自动建工作区,然后 Cuu 审核」——可以,做成受派侧「接单策略」三档(个人设置,默认第 1 档):**

| 档位 | 收到派活时 |
|---|---|
| 1 自动接单(默认) | 自动建工作副本 → 我的 agent 立即开工 → 服务端 Cuu 审核 → 按我的模式出提议或自动合并;我的 Cuu 气泡只是告知 |
| 2 先问我 | 气泡/收件箱先确认「接吗?」,点接单后走档 1 全流程 |
| 3 只挂单 | 进我的任务列表,手动启动 |

「自动建工作区」= 接单即开 branch(工作副本):执行全程的中间产物都在副本里,**人可以中途打开副本查看、插手、接管**,这是把现有「产物出来才开提议」前移到「接单即有副本」,可见性更好,红线不变(副本内容不进正式版,合并仍走审核)。

**2) 审核在服务端,必须。** 原则一句话:**执行可下放,信任不下放**。三个理由:
- judge(reviewDeliverable + 置信度矩阵)是信任链的一环,跑在客户端等于让被审对象自带裁判——本地进程可被篡改、可被 prompt 注入的产物污染,自证无效;
- 合并权、预算 reservation、审计账本、跨租户隔离本来就全在服务端,审核放别处会造出第二个权威;
- 全托管档(AI 审通过即合并)只有在「审核不可被客户端影响」时才敢开。

**3) 本地 + 服务端双 AI:成立,而且便宜。** 现有 AgentRunQueue 的 claim-lease(`FOR UPDATE SKIP LOCKED` + 心跳租约)天然支持多 worker 抢占——桌面端执行器就是「又一个 worker」,不需要新队列。诚实账:
- 真降的:服务端 worker 的**执行算力与工具 IO**(文件解析/检索/渲染在用户 Mac 上跑)、并发槽位;
- 不降的:LLM token 成本——本地执行默认仍经服务端 LLM 代理(零 key 红线);
- 也能降的:用户接本地模型(如 ollama)时连 token 都省,产物照样过服务端审核。
- 分期:R12 只**预留字段与协议**,本地执行器做后置批 9(见 02 §13),不拖主链路。

---

## 1. 用户流:一次派活的完整旅程

场景:主区讨论后,行动卡把「重写第三节」派给张三(阿曼是发起讨论的人)。

```
阿曼视角                          系统                              张三视角
────────                         ────                              ────────
群里讨论完,停了 60s
                          观察者拎出事项,行动卡:
                          「①重写第三节 · 派给张三(他最熟口径)」
                          → 建 work_item(assignee=张三)
                                                              张三接单策略=自动接单:
                                                              系统自动建工作副本 branch
                                                              张三的 agent(阿墨)开工
                                                              张三的 Cuu 气泡:「阿曼派了个
                                                              活,我已经开工了喵」(告知)
行动卡线程回贴:
「阿墨已开工(张三的军团)」
                          run 执行(本地或服务端,见 §2E)
                          中间产物落工作副本
                                                              张三可随时:打开副本看进度/
                                                              进协同会话补指示/接管/打回
                          产物 Manifest → 服务端 judge 审核
                          ┌─ grade5 且张三开全托管档:自动合并
                          ├─ 其余:开提议,路由审批人
                          └─ 不合格/拿不准:升级,回灌行动卡线程
线程:「提议好了,建议扫一眼」                                    (若张三是审批人)attention
                                                              收到「等你拍板」
                          合并 → 快照留档 → 网盘归档
群聊系统事件卡:「已采纳进正式版」                               战绩+成本记张三名下
```

要点:
- 全程**没有人被要求实时点头**;两个人各自在自己的节奏里(阿曼看线程,张三看军团/收件箱)。
- 「谁来确认」出现且只出现一次:审批(若非全托管档)。
- 张三改接单策略为「先问我」,唯一变化是开工前多一个他自己的确认,与群里无关。

---

## 2. 数据流:六条链路

### A. 主区消息

```
composer(chip 只含 id) → POST /conversations/:id/messages
  → 校验 membership + chip 权限 → 写 conversation_messages(seq 唯一)
  → SSE /me 流 conversation.message.created → 各端 store 按会话切片渲染
```

### B. 观察者 → 行动卡

```
conversation-observer worker(claim-lease,服务端定时)
  扫描: observer_enabled && 新消息(seq > last_analyzed_seq) && 静默≥窗口 && 非安静时段
  → 预算 reservation → LLM 分析(增量消息+被引用上下文,超限先摘要压缩)
  → 结构化 plan{items[{kind, confidence, suggestedAssignee}]} → judge 自检(低质丢弃)
  → upsert action_cards(追加进 active 卡,不新发) + 更新水位线
  → execute 项: 建 work_item(assignee) ──→ 进入链路 C
  → decide 项: attention 决策卡 + 群聊 @负责人
  → SSE conversation.action_card.updated
```

### C. 派活 → 接单 → 执行 → 审核 → 合并(核心链路)

```
work_item(assignee=张三)
  → 读张三 user_ai_profiles.dispatch_policy
     ├ auto: 直接下一步
     ├ ask : 通知张三 → 接单动作 → 下一步
     └ manual: 挂张三任务列表,手动启动
  → 自动建工作副本 branch(run 全程产物锚在副本)
  → enqueue AgentRunQueue(execution_hint, 注入张三的 memories/技能/预算 scope)
  → worker 抢单执行(服务端池 或 张三本机执行器,见 E)
  → DeliverableManifest 上传/落库
  → 【服务端】reviewDeliverable(独立 review client) → 置信度矩阵
     ├ grade5 && 张三模式=全托管 && 非高风险类别 → 自动合并
     ├ 其余 → openProposalFromManifest → 审批路由(SLA) → 人审 → 合并
     └ 不合格 → escalate → 行动卡线程 + attention
  → 合并: 快照(可回滚) + 网盘归档 + 群聊系统事件 + 成本/战绩记张三
```

### D. 协同会话 turn

```
成员发言(@Cuu 或单聊) → POST /conversations/:id/turns
  → 轻量 run(kind='chat_turn',按发言人身份+其模式档)
  → SSE 流式: message.delta / tool.begin|output_delta|end / item.*
  → 产出文档改动 → 产出卡(+a -b) → 「交给审核」= 链路 C 的审核段
  → 记忆引用清单随响应返回(可折叠展示)
```

### E. 本地执行面(批 9 后置,协议现在定)

```
桌面执行器(Tauri 侧常驻,仅用户在线时):
  claim: 只能抢 assignee=本人 且 execution_hint∈{'local','any'} 的 run
         (同一 SKIP LOCKED 队列,和服务端 worker 互不干扰)
  租约: 心跳续约;断网/关机 → 租约过期 → 服务端 worker 自然接管(failover 免费)
  LLM:  默认调 POST /api/llm-proxy(服务端 key + 预算 reservation + 审计 + 限流)
        可选本地模型档(ollama 等):零 token 成本,产物同样走链路 C 审核
  工具: 文件解析/检索/渲染在本地跑(真省服务端算力的部分)
  产物: Manifest + 文件上传(带 run lease token 签名) → 之后与链路 C 完全一致
  边界: 本地永远不能 judge、不能合并、不能动预算——执行可下放,信任不下放
```

执行地选择规则(enqueue 时定 hint):涉本地大文件/用户在线且开启本地执行 → `local`;定时任务/受派人离线/长任务 → `server`;默认 `any`(谁先抢到谁跑)。

### F. 版本与回滚(git 化底座)

```
一切写入 = 版本事件:
  网盘文件 → project_drive_versions(自动留版本,UI 可回滚)
  文档产物 → branch 工作副本 → 合并留 snapshot → 「回滚这次采纳」
  行动卡撤销 → abort run + 副本废弃(留痕) + 线程记录
敢全自动的信任闭环 = 链路 C 的审核 + 本链路的可回滚
```

---

## 3. 信任与安全边界(一张表)

| 能力 | 本地(桌面) | 服务端 |
|---|---|---|
| 执行(loop/工具) | 可(批9) | 可(默认) |
| LLM 调用 | 经代理 或 本地模型 | 直连(key 唯一持有方) |
| judge 审核 | 永不 | 唯一 |
| 合并/回滚落库 | 永不 | 唯一 |
| 预算闸门/成本账 | 永不 | 唯一 |
| 审计日志 | 上报 | 记录与保全 |
| 观察者(60s 分析) | 不做(多端一致性) | 唯一 |
| 密钥 | 零 | 唯一 |

---

## 4. 落进施工计划的增量

- 批 0 表补两个字段(已更新 02):`user_ai_profiles.dispatch_policy('auto'|'ask'|'manual', default 'auto')`、`agent_runs.execution_hint('server'|'local'|'any', default 'server')`;接单确认通知复用 notifications。
- 批 3 派发逻辑按 dispatch_policy 分叉;批 5 军团卡显示执行地(本机/云端)。
- 新增批 9(后置,M5,可独立立项):桌面执行器 + `/api/llm-proxy` + 本地模型档。协议按本文件 §2E 冻结,先落协议测试(contract test)后落实现。
