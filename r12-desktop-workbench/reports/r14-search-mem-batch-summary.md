# R14 批 SEARCH + 批 MEM · 批次总结（集成者收口报告）

> 2026-07-14 · 集成者：Claude（无人值守，异步流水线模式）· 与批 CHAT 同日交付

## 交付范围

两批设计稿（02-search-design.md / 03-mem-design.md）由侦察+设计 agent 产出、集成者裁定后定稿：
迁移号对调（MEM=0056 先落地、SEARCH=0057）；搜索的网盘/会议围栏按保守版（个人空间 owner-only，fail-closed）。

| 工包 | 分支 | 交付 |
|---|---|---|
| SEARCH W1 search-core | r14/search-core | 迁移 0057（pg_trgm+5 GIN 表达式索引）+四 scope 仓库（鉴权全进 SQL）+服务（q 2-64/LIKE 转义/snippet/limit+1）+GET /api/search 路由+契约+真库冒烟 qa/r14-search-smoke.ts |
| SEARCH W2 spotlight | r14/search-spotlight | 聚焦盒「搜索全部」能力视图（防抖/分组/键盘可达/深链：会话→工作台会话级、网盘/工单→逐项、会议→项目级诚实降级） |
| SEARCH W3 web | r14/search-web | /dashboard/search 路由全链路（q 参数可分享）+分组渲染+跳转矩阵（会话=不可点说明行，如实） |
| MEM W-A mem-server | r14/mem-server | 迁移 0056（edited_by/edited_at 两列）+治理仓库/服务（本人可读写记忆、管理员编辑技能走 K2 七道闸+promote 版本化+审计）+8 端点+契约 |
| MEM W-B web | r14/mem-web | /settings/memory 双 tab（关于我/团队技能）+出处三级降级+两步确认删除/停用+admin 门从 SSR 身份流 |
| MEM W-C desktop | r14/mem-desktop | 聚焦盒独立 memory 能力视图（list→detail→edit/armed 删除）+settings 入口 row+isAdmin 走 client.me() |

集成者挂载：app.ts 三路由+onError 治理分支、openapi /api/search+8 条 MEM 路径（错误码与服务逐条对齐，
含 team_skill_edit_* 动态族全枚举）、app.test 白名单 9 条；api-client 治理/search 方法**必选化收口**
（两个工包各自为避围栏把方法声明为可选——集成裁定统一改必选+两侧穷举 mock 补存根，杜绝 ?. 静默吞）。

## 验证账本

- 全量门：api 1345 / db 326 / contracts 132 / ui 199 / web 82 / api-client 22 / 桌面 1025 / agent 163，typecheck 0。
- 迁移链 scratch 真库 0000→0057 重放（pg_trgm 扩展+edited 列逐一核对）；CI migration-audit 亦绿。
- SEARCH 真库冒烟（agent 跑）：四 scope 命中+围栏反例（他人个人空间不可见/墓碑滤除/assignee EXISTS/
  LIKE 元字符转义/has_more）全过。
- 真机 HTTP 冒烟（8787 当前码+5432 长命库）：`/api/search?q=验证` 命中真实聊天消息且被删消息未泄漏；
  短词 400；治理端点诚实空态。
- 浏览器端到端（web 5173 dev+cookie 登录验收甲）：登录深链直达 /dashboard/search?q=验证（Chat 组真命中+
  空 scope 诚实）；/settings/memory 双 tab+统计 tile+空态（web 文案「AI assistant」不泄 Cuu）。
- 聚焦盒两个新视图（search/memory）为 Tauri 主窗能力，浏览器管道不可达——单测覆盖（+33/+26），
  真机图文验收归人工轮。

## 已知留尾（不阻塞批次）

1. 聚焦盒意图分类扩「搜索」类（需动 packages/agent spotlight-intent schema，施工围栏外诚实跳过）。
2. 会话搜索结果 seq 级精确滚动（deep-link stash 无 seq 字段，与 CHAT 批留尾同源，一起接）。
3. 会议结果的桌面深链=项目级降级（无逐会议能力视图）。
4. web 搜索页会话结果不可点（web 无聊天页——已立案 B 级 web 只读会话镜像）。
5. 团队技能回滚端点/记忆回收站等=设计 §8 明确不做，防漂移。
