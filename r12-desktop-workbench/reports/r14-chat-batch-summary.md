# R14 批 CHAT · 批次总结（集成者收口报告）

> 2026-07-14 · 集成者：Claude（无人值守）· main=758c8fa2 · CI 8/8 逐 job 全绿（run 29310676692，
> web-live-route-smoke 首跑 CDP 抖动「Inspected target navigated or closed」，rerun 即绿，与本批改动无关）

## 交付范围

设计=01-chat-design.md（含 PM 审视 A 级吸收项）。四个工包全部交付合入：

| 工包 | 分支 | 交付 |
|---|---|---|
| W1-A chat-core | r14/chat-core | 迁移 0055+仓库 11 方法+服务 9 方法+3 SSE 事件+VM 5 字段+下游墓碑过滤+两路由文件 |
| W1-B presence-observer | r14/chat-presence | GET /api/presence（复用既有 PresenceStore）+conversation.observer.analyzing 事件+观察者 worker 发布 |
| W1-C web-avatars | r14/web-avatars | personAvatarTileHtml helper+7 个 web 人物出现点铺头像（PM 审视 #6） |
| W2-A desktop-chat-ui | r14/chat-desktop-ui | §5 全部 11 项：hover 工具条/行内编辑/墓碑/引用回复跳转/reaction 行/置顶条/已读游标+未读分割线+已读 N/M/在线点/观察者指示灯/乐观 UI；撤 `/技能` 灰 chip；桌宠彩蛋=情绪映射核心完成、跨窗接收端留缝（见其报告） |

集成者挂载：app.ts 三路由、openapi 10 条路径+VM 字段+墓碑空串放宽+reply_to 请求字段、app.test 白名单 10 条。

## 验证账本

- 全量门：api 1280 / db 316 / contracts 121 / ui 193 / web 73 / 桌面 966 / agent 163，typecheck 0 错。
- 迁移链：scratch 真库 0000→0055 重放全过（新表约束/复合 FK/部分索引逐一核对）。
- 真库冒烟：`apps/api/src/qa/r14-chat-smoke.ts`（已入库可复跑）一把过——引用预览/他人编辑 403/
  reaction 幂等聚合/置顶往返/游标夹紧到水位+单调/receipts 双人/墓碑+引用侧联动/三个新 SSE 事件真实发布。
- 浏览器端到端（4174 dist+localStorage 覆写+8787 当前码 API+5432 长命库，免 Tauri 管道）：
  发消息→本人气泡下「Read 0/2」聚合；hover 工具条 9 动作按权限齐全；👍 reaction 行；「1 pinned message」
  置顶条且随编辑实时同步（message.updated 事件驱动）；「edited」标记；引用回复带原文预览块；两击确认删除
  →「This message was deleted」墓碑；成员条头像在线绿点（SSE 心跳驱动）；**观察者指示灯真机命中**
  （8787 真观察者拾取消息→analyzing 事件→桌面渲「Cuu is pulling the discussion together…」）。
- 长命库已迁 0055，8787 API 已重启为当前 main 码。

## 已知留尾（不阻塞批次）

1. 桌宠彩蛋跨窗接收端（workbench-interrupt emit→desktop-cuu-runtime 映射 CuuState）：情绪映射与 diff 核心
   已完成并留 onCuuReactionEmotion 干净缝，接收端需动桌宠 runtime 的穷举监听断言且无 Tauri 真窗不可验，
   诚实延后——真机验收轮顺手接上。
2. 聚焦盒/搜索的「会话定位到 seq」深链：SEARCH 批 W2 与本批的跳转机制对齐后做（deep-link stash 无 seq 字段）。
3. 浏览器自动化合成点击到不了 webview 元素（DOM click() 正常、真机鼠标正常）——自动化层限制记录在案，
   非产品缺陷。
4. PM 对「已读 N/M」的保留意见已记录于 00-plan §5；呈现已按克制口径（仅本人最后一条）落地，用户可复审。
