# 04 双端交互规划(web + 桌面 Cuu 客户端)

基于 2026-07-15 双端审计(main HEAD 4653b358)。规模现状:web 10,835 行 vs 桌面 56,494 行(5.2 倍),会话/行动卡/presence 在 web 零入口,且工程上已形成"新会话能力默认不进 web 公共 API 面"的事实纪律。

## 一、各面定位裁定(建议)

| 面 | 定位 | 一句话 |
|---|---|---|
| 桌面 workbench | **主工作面**:聊天/私聊/军团/网盘/项目设置/审批 | 干活的地方 |
| 桌面 Spotlight(聚焦盒) | **快速唤起 + 决策收件箱**:搜索/审批总队列/成本/日历/通知/记忆/intake | 想起什么按一下 |
| 桌宠 pet | **氛围 + 主动性投递端**:批次 D 的 Cuu 主动消息、提醒气泡落点 | 它来找你的地方 |
| web | **管理者控制台 + 只读镜像**:仪表盘/审批/回放/设置,会话先做只读镜像(R14 既有 B 级待办) | 看和批的地方 |

裁定依据:web 聊天追平桌面成本极高(18/20 路由仍是字符串拼 HTML,缺局部状态架构),而"管理者在 web 批东西、成员在桌面聊和干"符合现有代码投入结构。**待用户确认:web 是否接受"只读镜像 + 控制台"定位。**

## 二、桌面:双壳收敛(最大交互债)

审计确认 Spotlight 与 workbench 是**两套并行、零导流**的产品:workbench 没有搜索/知识库/成本/日历/通知收件箱/审批总队列/escalation·budget 决策/intake/回放(全在 Spotlight);两边互相跳不过去;桌宠 Cuu 与聊天 Cuu 是两套不通的状态机。

收敛策略(不是合并,是"分工 + 双向导流"):

1. **双向导流**(小时级):workbench 顶栏加「打开聚焦盒」;Spotlight 结果可深链进 workbench 会话(已有 open_workbench 单向,补反向)。
2. **全局热键**(1 天,Rust):补 `tauri-plugin-global-shortcut`,聚焦盒真正 Cmd+Space 式唤起——"聚焦盒"心智模型目前最大的落差。
3. **决策收件箱进 workbench**(中期):Spotlight 的 attention.ts(686 行,approval/plan_review/budget/escalation/sync_conflict 全类型)是全桌面最完整的决策面,workbench 右栏只能看单个 proposal。把决策收件箱作为 workbench 第六模块挂进 rail(复用 attention.ts 渲染逻辑,两壳同源),批次 A 的提醒阶梯/digest 卡与它同一数据源。
4. **桌宠状态统一**(随批次 A):pet 状态机只认经典事件不认识会话。批次 A 的「消息→Notification 行→topics.user」桥接落地后,pet/托盘/OS 通知天然感知会话动静,pet 情绪可据此联动(收到关怀/提醒类 intent 时的表情),不再依赖 workbench 窗口活着。

## 三、SSE 拓扑修复(架构级,并入批次 A)

审计证据链:conversation 事件只 publish 到 `topics.conversation(id)`,从不进 `topics.user`;pet/main 的 Rust SSE worker 只订 `/stream/me`;普通聊天消息不落 Notification 行。**workbench 关闭 = 新消息/@提及/行动卡在桌面全链路零信号,无角标无托盘无系统通知。**

修法即批次 A 的 A4/A5,明确追加两条桌面侧验收:
- 未读角标三层落位:rail 树叶(A4)+ 托盘/Dock 计数(Rust,notify.rs dedupe 基建可复用)+ 聚焦盒 badge(已有 setBadges 通道)。
- interrupt-broadcast 里"算了但没渲染"的合并计数接回 UI(死计算变活)。

## 四、新能力的交互落位(批次 B/D 对齐)

| 能力 | workbench | Spotlight | pet | web |
|---|---|---|---|---|
| 私聊/roster(B) | rail「成员」分组+头像 popover | Cmd+K「私聊某人」命令 | 不涉 | 暂缓 |
| 提醒阶梯/digest(A/D) | main 会话 digest 卡 + 决策收件箱 | 通知收件箱既有 | 升级件弹气泡 | 通知页(修 risk_digest 裸串同批) |
| Cuu 主动消息(D) | 落在私聊/协同会话 | 不涉 | 气泡首发 + 点击深链进会话 | 只读可见 |
| 追 DDL/找人(D) | 行动卡(claim/reassign/defer 已有) | attention 队列 | 气泡提示 | attention 卡已有 |

## 五、双端止血批(G 批,几天量级,可与 A/C 并行)

桌面(审计 Top 10 精选):
1. 撤 composer 上 `/技能` 死 chip、`#会话` 标路线图(违反自家"不假接线"铁律,小时级)。
2. 军团「后台任务」永久空壳:隐藏或接真数据(小时级)。
3. 跨窗口登出广播:登出时给已开 workbench 发信号,替代"随机加载失败"(1 天)。
4. 清理 4 处过时的 capabilities 悲观注释 + 真机核实 `allow-is-focused`(小时级)。
5. 审批/重新分派操作补 markBusy 级忙态,对齐 Spotlight 手感(1 天)。

web(审计 Top 10 精选):
1. `project.risk_digest` 通知裸英文串:route-components.ts:1303 exact 表加一条(一行)。
2. SSE 订阅面窄化:去掉 web 用不上的 `conversation.*` 全量刷新触发(browser.ts:195)。
3. `main.ts` webSurface.pages 端点目录补 R14 新增(防文档腐化)。
4. GitHub 活动卡空态加「去桌面绑定」引导;通知页会话类通知加「去桌面看」提示。
5. productNavGroups 补 CI 断言(第 4 个路由同步点显式化);listProjects 加 in-flight 去重。
6. action-cards 路由过期"未挂载"注释清理;可选:通知详情页接最小 decide 动作。

## 六、遗留大项(不在 G 批,排期另议)

- OKR/objectives:后端闭环,**双端零 UI**(全仓库 grep 零命中)——是"完全没做面"清单里最大的一块,建议排进批次 E(项目管理深化)一起定交互。
- 团队技能治理 write 面:Spotlight 有,workbench 无。
- web 只读会话镜像:R14 B 级待办,搜索 deep_link 已就绪(SearchResultsVm 带 seq 定位),等定位裁定后排。
- intake 会话式建项与 rail 模态建项两套路径的归并。
