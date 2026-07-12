# 第一波并行集成汇报(集成者)

日期: 2026-07-12 · 分支: r12/workbench-full · 集成提交: 4a2c71ed/4320f79e(批5) · 63e44b9d/216407ec(批3/批1 merge) · 25ba7624(缝合)

## 集成了什么

三个并行 agent 分支全部验收合入,零合并冲突(按「文件占地」切分奏效):

| 分支 | 内容 | 验收要点(抽查通过) |
|---|---|---|
| r12/batch5-server-read | 军团面板读侧聚合 + 猫名代号 | 鉴权进 SQL(引 R8 DF-2)/cap 1..50/无 N+1/57 真断言/后台任务诚实空置 |
| r12/batch3-server | 观察者 worker + 行动卡 decide/undo + 派发 | 每轮 10 会话/200 消息上限/时区安静时段/undo 窗口语义/授权窄化到被@负责人 |
| r12/batch1-frontend | 工作台外壳(workbench.html+8 模块)+Spotlight 入口 | 322 测试(+53)/独立 27KB chunk 不拖 browser.ts/假 affordance 零容忍(降级为 no-op 并报告) |

## 集成者缝合(25ba7624)

- 挂载 army 与 action-card 路由进 app.ts;openapi 手写 schema 对齐 zod;覆盖门白名单 +4 端点;批0 的 decide/undo stale 门翻转(真实路径已文档化,旧猜测的会话嵌套路径保持未文档化)。
- server.ts 启动观察者调度器,LLM provider 未配置时不启动(isConfigured 守卫,照 meta-planner 先例)。
- **run 会话血缘打通**(批3/批5 各自报告的同一缺口):sourceConversationId/sourceActionCardItemId/executionHint 穿透 EnqueueAgentRunInput→队列记录→持久化双向映射→runInsertValues,观察者 auto 派发即时落血缘——军团面板从此能把 run 挂回会话。
- **Tauri capabilities 补洞**(批1 发现):新增 capabilities/workbench.json,workbench 窗独立授权 hide/minimize/drag+core:default,不扩大 main/pet 的 ACL。

## 门(全部本机通过)

- pnpm -r typecheck: 0 错(16 项目)
- pnpm test: 全绿(api 947+/db 211+/agent 69/contracts 89+/desktop-webview 322/web 67)
- PG+Redis smoke: scratch 库 workhub_r12_integrate_smoke 全绿后清理(run 血缘列真库插入验证)

## 待人工清单

1. 真机 .app: workbench 窗 vibrancy 截图;capabilities ACL 在 tauri build 时的真实校验(cargo test 不覆盖 ACL)。
2. 真 LLM key: 观察者端到端冒烟(60s 静默→行动卡→派发)。
3. CI: 分支未推送;推送后 gh run view --json jobs 逐 job 核 conclusion。
4. 批3 报告遗留:观察者预算为软闸(reservations.run_id NOT NULL 约束所致);「接单即建工作副本」现有 branches 机制不支持 run 前预开,暂为合并时开副本,已在 03 文档口径内待产品层跟进。
5. 批1 报告遗留:深链冷启动竞态(窗口创建完成前 deep-link 事件可能丢失)——批2 接 SSE/store 时一并处理。

## 下一波

批2(群聊 UI,吃批0 API+批1外壳)与批4(协同 turns,设计重,集成者亲做或单独派)可开;批6 网盘/批7 Cuu 随后。
