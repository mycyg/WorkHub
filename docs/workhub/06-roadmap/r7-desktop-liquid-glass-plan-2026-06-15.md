---
module: R7-desktop-liquid-glass
layer: 客户端 / 桌面 webview / 视觉
status: in-progress
owner: engineering
date: 2026-06-15
depends_on:
  - r6-p3-cuu-pet-plan-2026-06-14.md
  - r6-web-redesign-plan-2026-06-14.md
---

# R7 桌面客户端「液态玻璃」改版

## 来源

用户用 Claude Design 打磨了一版桌面客户端交互原型（`WorkHub Desktop 打磨 v2.dc.html`，v2.3），handoff bundle 已 fetch + 读完（README + 全部 chat 转写 + 设计源码 + support.js）。**只改桌面端 webview，不动 Web**（Web 走共享 gold-path，由 web-live-route-smoke 把关；桌面玻璃必须 desktop-only，否则 70 步 smoke 红）。

## 用户拍板的方向（来自 chat 转写）

- **视觉核心 = 液态玻璃**：彩色极光底(lavender+peach+mint 四角 radial-gradient) + 磨砂玻璃面板(`backdrop-filter:blur(40px) saturate(180%)` + 半透白 + 高光描边 `inset 0 1px 0 rgba(255,255,255,.7)` + 大柔阴影)。字体 `M PLUS Rounded 1c` + `Noto Sans SC`（圆体/二次元）。圆角线性图标套玻璃小色块。
- **颜文字保留并加码**、口吻可爱二次元(主工作台也要,不再"萌点全留给 Cuu")。
- **Cuu 桌宠气泡统一成同一套玻璃风**（`pet-surface.ts`）。
- **导航极简 4 项**：今日待办 / 派个活儿 / 项目 / 团队；设置(含花费)进顶栏齿轮；搜索/问 Cuu 点右下角桌宠弹聚焦搜索。
- **今日待办 = 决策卡牌**：一叠会飞走的玻璃卡,一次一件。右滑/「发！」通过、左滑唤出打回原因(点 chip 选原因)、「晚点」丢牌底。卡类型:审批 / Cuu 拿不准让你选 / 要你授权 / **Cuu 当 PM 荐人(handoff,负责人+为什么是TA+协作者)**。过完撒花 `٩(◜◡◝)۶`,Cuu 旁边用表情实时反应。
- **项目 = 工作区**：多项目;点进有 文件/进行中/回放 三页签 + 跨项目概览 + 最近动态时间线。
- **团队**：日历 / 技能库(含导入) / 成员(协作图谱,喂 PM 荐人)。
- **顶栏去开发黑话**：`Tauri Webview P0.5` / `device-token aware client` → 「● 已连接 · 本地同步正常」+「Cuu 在线 ♡」。

## 后端缺口（"新功能需重新做后台实现"——已核过代码）

- **通用文件下载**：`drive.ts` 有上传/版本/软删恢复/评论转草稿,**无通用文件下载端点**;local_sync 在 Rust 壳声明但未实现。→ 项目「文件」页需补下载端点。
- **技能导入**：`team-skill` 模型支持 `authored`(人工导入),但**无对外 create/import 路由**,且子系统默认关闭。→ 团队「技能库·导入」需补 create 端点。
- **团队日历**：`GET /calendar`→`CalendarPageVM` 后端已有,桌面壳没接。→ 接进团队页。
- **PM 荐人(handoff)**：`escalationEvent.suggested_lead_user_id` + `assignment(lead/collaborator)` + `structuredHandoff` 已存在;需端点把"待派人的升级"列出 + 一个 assign/respond 端点供 handoff 卡用。

## 架构决定

- 桌面主窗 = `apps/desktop-webview/src/browser.ts`(渲染共享 `@workhub/ui/gold-path` app-shell,classes 为 `wh-app-*` + `wh-r4-*`)。
- **玻璃只在 desktop-webview 注入**(新 desktop-only CSS 模块 + 后续 desktop-only 组件),共享 gold-path 与 Web 不动 → web smoke 恒绿。
- 决策卡牌的数据源已就位：`/api/pages/attention` 的 `queue`(本轮已接 `listPendingForUser`)即决策队列;卡类型映射 approvals/proposals/permission-ask/escalation。
- support.js 是 Claude Design 原型运行时(`{{}}`/`<sc-if>` 模板引擎),**不照搬**;按 README 在真实栈里重建视觉与交互。

## 分阶段施工（每阶段 typecheck+test+CI 绿;desktop-only 不碰 web smoke）

1. **P1 视觉地基**（进行中）：① 顶栏去黑话(本提交)。② 新 `liquid-glass.ts` desktop-only CSS 模块:极光底+玻璃面板+M PLUS Rounded 字体,覆盖 `wh-app-*` 壳层,接进 browser.ts。
2. **P2 IA + 导航**：4 项玻璃导航(今日待办/派个活儿/项目/团队)+ 顶栏齿轮设置。
3. **P3 决策卡牌**：今日待办做成可滑动玻璃卡叠(approval/choice/permission/handoff)+ Cuu 反应 + 过完撒花,接 `/attention` queue。
4. **P4 项目工作区 + 团队页 + 聚焦搜索**（点桌宠弹）。
5. **P5 后端**：文件下载 / 技能导入 / 日历接线 / PM 荐人端点。
6. **P6 Cuu 气泡玻璃化**（`pet-surface.ts`）。
7. 每阶段 实现→测试→调试 直到无 bug、数据流通畅。

## 设计源参考

handoff bundle 解包在 `/tmp/workhub-desktop-v2/coworkrust/`（README + chats/chat1.md + project/WorkHub Desktop 打磨 v2.dc.html + support.js + 3 张截图）。玻璃 token 精确值见 `v2.dc.html`。
