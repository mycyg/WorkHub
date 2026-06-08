---
module: 05-clients
layer: C-WEB / C-DESKTOP / C-PET
status: current-concept-index
owner: workflow
date: 2026-06-08
---

# WorkHub 页面概念图索引

> 本页收纳仍有效的概念图。概念图表达产品方向、信息密度和交互原则，不等同于最终 UI 截图。Cuu 当前只保留独立 `pet` window 中的黑猫 / 白猫 Live2D 二选项；Web 与 desktop 主窗保持严肃工作界面。

## 1. 阅读原则

| 原则 | 说明 |
|---|---|
| AI 默认过滤复杂度 | 默认只递给用户一件最需要判断的事 |
| 看板降级 | 看板是高级/兜底视图，不是默认首页 |
| 澄清点选项 | 打字只是折叠兜底 |
| Cuu 独立 | Cuu 不进入 Web / desktop 主窗，只在桌面右下角独立存在 |
| 交付物多样 | 变更申请像 GitHub PR，但对象可以是文档、表格、PPT、图片、文件夹 |
| 三端同源 | Web、desktop 主窗、Cuu 气泡都消费同一 Page VM / payload contract |
| 中英双语 | 概念落地时必须同步 zh-CN / en-US 固定文案 |

落地契约：

- 体验 payload：[`../../plans/p0-foundation/_experience-deliverable-contracts.md`](../../plans/p0-foundation/_experience-deliverable-contracts.md)
- Gold Path：[`../../plans/p0-foundation/_gold-path-p0-5-vertical-slice.md`](../../plans/p0-foundation/_gold-path-p0-5-vertical-slice.md)
- Cuu 概念：[`cuu-desktop-pet-concept.md`](./cuu-desktop-pet-concept.md)
- Cuu 二选项：[`cuu-live2d-cat-options-current-plan.md`](./cuu-live2d-cat-options-current-plan.md)
- Rust 客户端：[`desktop-pet-tauri.md`](./desktop-pet-tauri.md)

## 2. Web 端概念图

### 2.1 AI-first 首页

![Web AI-first 首页](./assets/web/web-ai-first-home.png)

默认首页不做重型项目看板，而是展示：

- 需要你决定什么。
- AI 正在做什么。
- 哪些事项可能出事。
- 成本、风险、证据的轻量摘要。

### 2.2 项目工作台

![Web 项目工作台细化](./assets/web/web-project-attention-workspace.png)

项目页默认是 attention workspace。左侧是项目上下文，中间是一件要处理的事，右侧是证据、风险、下一步建议。

### 2.3 选项优先提需求

![Web 选项优先提需求](./assets/web/web-option-first-intake-wizard.png)

提需求阶段不应要求用户先写长文本。AI 把意图拆成可点击选项，用户补附件、DDL、负责人、验收项即可。

### 2.4 核心页面图谱

![Web 核心页面图谱](./assets/web/web-core-pages-atlas.png)

覆盖登录门、项目列表、项目工作台、提需求、AI 澄清、工作项详情。后续实现要优先复现真实业务流，而不是堆展示卡片。

### 2.5 运营页面图谱

![Web 运营页面图谱](./assets/web/web-operations-pages-atlas.png)

资源排期、项目健康、知识搜索、日程、通知都属于完整工作台能力。知识搜索的默认入口应优先下沉到 Cuu 气泡，Web 页面做兜底和管理。

### 2.6 文件会议审批图谱

![Web 文件会议审批图谱](./assets/web/web-files-meetings-approvals-atlas.png)

网盘、会议、审批、提议详情、404 都需要同一套证据语言：发生了什么、依据是什么、需要人做什么。

### 2.7 工作项详情

![工作项详情概念](./assets/web/web-workitem-detail.png)

工作项详情要呈现状态、验收项、AI 执行轨迹、置信语气、升级简报、交付物预览和提议时间线。

### 2.8 审批中心

![审批中心概念](./assets/web/web-approval-center.png)

审批中心是负责人视角的阻塞收件箱。核心动作是通过、打回、委派和记住规则。

### 2.9 交付物变更申请

![交付物变更申请概念](./assets/web/web-deliverable-change-request.png)

变更申请要像 GitHub PR 一样清楚，但不是代码专用。页面必须支持文档、表格、PPT、图片、文件夹和版本变化。

### 2.10 项目资料 / 会议 / 知识

![项目资料会议知识概念](./assets/web/web-project-drive-meetings-knowledge.png)

项目资料页聚合网盘、会议和知识证据。文件评论、会议洞察、资料变更都可以触发需求草稿或 Cuu 提醒。

### 2.11 会议洞察转需求草稿

![会议洞察转需求草稿](./assets/web/web-meeting-insight-to-draft.png)

AI 可以发现变化，但不能直接改正式状态；必须先生成草稿、澄清或审批项。

### 2.12 网盘预览与变更草稿

![网盘预览与变更草稿](./assets/web/web-drive-preview-change-draft.png)

网盘页不是单纯文件管理器。文件评论、版本变化、文件夹重命名都可能变成“是否创建变更申请”的选项提示。

### 2.13 早期工作台探索

![早期 Web 工作台探索](./assets/web/web-workbench-dashboard-early.png)

这张图保留为反例/探索记录：它偏重看板和信息密度，不作为默认首页目标。

## 3. Rust/Tauri 客户端概念图

### 3.1 单件事干活桌

![单件事干活桌](./assets/desktop/desktop-one-thing-work-desk.png)

客户端主窗被唤起时，应该让用户处理一个决定、一个任务或一个本地动作，而不是进入复杂管理面板。

### 3.2 客户端主窗

![Rust 客户端概念](./assets/desktop/desktop-rust-client-concept.png)

桌面主窗保留严肃工作风格：左侧导航、中间任务、右侧证据/状态。本地能力由 Rust shell 提供，业务 UI 由 TS webview 渲染。

### 3.3 设备设置与更新

![设备设置与更新](./assets/desktop/desktop-device-setup-update.png)

设备令牌、连接状态、更新、系统权限都属于桌面客户端设置；这里不展示 Cuu 本体。

### 3.4 同步冲突处理

![同步冲突处理](./assets/desktop/desktop-sync-conflict-resolver.png)

本地同步必须可解释、可回滚。冲突页要用普通语言说明“哪个文件、谁改了、建议怎么处理”。

### 3.5 支持页面图谱

![桌面支持页面图谱](./assets/desktop/desktop-support-pages-atlas.png)

支持收件箱、离线状态、诊断、同步、设置等桌面特有页面。

## 4. Cuu 桌宠概念图

### 4.1 Cuu 动效状态

![Cuu 动效状态](./assets/cuu/cuu-character-animation-states.png)

这张图定义动作语义：idle、thinking、approval、carrying、search、sync、worried、revision、celebrating、offline。当前黑猫/白猫都要承接这些状态。

### 4.2 Cuu 审批与项目检索

![Cuu 桌面审批与项目检索](./assets/cuu/cuu-desktop-approval-search.png)

Cuu 的核心价值是桌面右下角独立存在，用气泡承接轻审批、项目检索、交付物变更摘要和澄清提醒。

### 4.3 Cuu 选项优先澄清

![Cuu 选项优先澄清](./assets/cuu/cuu-option-first-clarify.png)

Cuu 气泡和 Web 澄清页都默认点选项。输入框只作为“其他 / 补充”兜底。

### 4.4 Pet 交付物变更

![Pet 交付物变更包](./assets/pet/pet-deliverable-change-package.png)

桌宠只展示摘要和关键动作；完整说明 deep-link 到 proposal 页面。

### 4.5 Pet 项目检索气泡

![Pet 项目检索气泡](./assets/pet/pet-project-search-bubble.png)

项目检索不默认打开复杂搜索页。Cuu 先给 chips：找文件、总结会议、解释改动、列证据。

## 5. 当前真实审计图

### 5.1 页面总览

![当前页面截图总览](./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png)

该图证明页面骨架存在，但不代表最终体验已完成。

### 5.2 Cuu 早期窗口回归门

![Cuu 首轮动作抓取](./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png)

![Cuu card mode 裁切失败样例](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png)

![Cuu card mode full-body 修复样例](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png)

这些图只作为回归门：不能只看单帧，不能只露耳朵，card mode 不能裁切。当前 Cuu 通过标准以黑猫/白猫 Live2D 真实录屏为准。

## 6. 后续补图计划

| 编号 | 概念图 / 截图 | 目的 |
|---|---|---|
| IMG-CUU-01 | 黑猫真实 Tauri idle contact sheet | 证明默认模型有持续动作 |
| IMG-CUU-02 | 白猫真实 Tauri idle contact sheet | 证明可选模型真实可用 |
| IMG-CUU-03 | 黑/白 approval/search/card mode 录屏 | 证明任务状态能触发动作 |
| IMG-CUU-04 | settings matrix 截图 | 证明 scale/opacity/pass-through/hide-on-hover |
| IMG-WEB-01 | Web 主窗无 Cuu 本体截图 | 验证主窗边界 |
| IMG-DESK-01 | desktop 主窗无 Cuu 本体截图 | 验证桌面主窗边界 |
| IMG-I18N-01 | zh-CN/en-US 页面组图 | 验证双语 |

## 7. 施工对齐

每个模块开工前先读对应文档和概念图：

| 模块 | 必读 |
|---|---|
| Web 页面 | `web-app.md` + 本文第 2 节 |
| Rust 客户端 | `desktop-pet-tauri.md` + 本文第 3 节 |
| Cuu 桌宠 | `cuu-desktop-pet-concept.md` + `cuu-live2d-cat-options-current-plan.md` + 本文第 4/5 节 |
| Proposal | `requirements-workitem.md` + `_experience-deliverable-contracts.md` |
| Knowledge / Search | `knowledge-base.md` + Cuu 检索气泡概念图 |
| i18n | `i18n-locale-contract-p1-1.md` + `i18n-nongoldpath-render-helpers-p1-2.md` |
