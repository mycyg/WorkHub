---
module: 05-clients
layer: C-WEB / C-PET / Cuu / Rust shell
status: current-gap-audit
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/shared/prd-concept-gap-map.png
  - ./assets/desktop/desktop-rust-shell-gap-roadmap.png
  - ./assets/web/web-real-ui-gap-roadmap.png
  - ./assets/cuu/cuu-character-animation-states.png
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
  - ./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png
  - ./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png
---

# PRD 与概念设计复现差距审计

> 当前权威结论：WorkHub 已有 TS-first contracts、Page VM、Gold Path、P-COST、Replay、desktop webview、Tauri shell、Cuu pet window 地基；但距离 PRD 中“AI-native 工作中台 + 严肃主界面 + 活着的桌宠入口 + 中英双语 + 完整验收”仍未完成。Cuu 已收束为黑猫 / 白猫 Live2D 二选项，旧实验视觉路线不再是计划、资产或验收目标。

## 1. 总体差距

![PRD / 概念复现差距地图](./assets/shared/prd-concept-gap-map.png)

| 领域 | 已落地 | 未复现 |
|---|---|---|
| AI-native 主路径 | Gold Path、intake、approval、proposal、replay、cost Page VM | 真实后端持久化、真实 worker 执行、权限闭环、完整 eval/replay 数据 |
| Web 主界面 | React/Vite shell、页面渲染、部分中英语言切换 | 完整 SPA 信息架构、真实数据流、空/错/载入/权限四态、视觉 polish |
| Desktop 主窗 | Tauri webview 加载、surface 分流、Rust bridge、`/settings` pet 恢复面板 | 安装包、设备令牌门、生产更新、系统托盘状态、跨平台 smoke |
| Rust shell | 窗口、SSE、通知、deep-link、pet geometry、cursor sample、托盘 `restore-pet-interaction` 源码门 | 私有 SSE 重连、动态托盘状态、本地同步、跨平台截图/权限策略、恢复录屏 |
| Cuu 桌宠 | 独立 pet window、黑猫/白猫 Live2D registry、偏好二选项、QA 合同、概念图已同步真实模型帧、pass-through 源码恢复门、P1.6 behavior manifest 源码合同、P1.7 业务录屏入口与黑猫 approval smoke | 黑/白真实 Tauri 全量业务录屏、settings matrix、长期性能、授权或原创替换 |
| 多语言 | locale contract、Gold Path 和部分 Cuu 固定文案 | 非 Gold Path 页面全量中英、错误文案、Rust shell 系统文案 |
| 交付物变更 | DeliverableChangeManifest、GitHub-like proposal 页面方向 | 文档/PPT/表格/图片/文件夹 diff 预览、证据引用、审批写回 |

## 2. 概念图对齐

### 2.1 Web 真页面差距

![Web real UI gap roadmap](./assets/web/web-real-ui-gap-roadmap.png)

Web 的产品哲学是“AI 递一件事给人处理”，不是传统重看板。当前页面已经有入口，但仍需：

- 首页从 demo shell 进化为 attention workspace。
- 看板退到高级视图，只展示用户需要知道的信息。
- 澄清页默认点击选项，free text 只作为折叠兜底。
- Proposal 页面要支持多类型交付物，不只代码 diff。
- Cost / Replay / Audit 要能从真实 AgentRun 数据生成。

### 2.2 Rust 客户端差距

![Rust shell gap roadmap](./assets/desktop/desktop-rust-shell-gap-roadmap.png)

Rust 客户端的设计哲学是“少打扰、一个窗口承接一件事、本地能力由 shell 托底”。当前还缺：

- 安装/更新/签名/托盘恢复的完整工程链。
- 设备令牌后的私有 SSE 与系统通知。
- 本地文件同步、spec watch、离线缓存、回滚快照。
- Windows/macOS/Linux 三端透明窗口与截图 QA。

### 2.3 Cuu 桌宠差距

![Cuu 黑/白 Live2D 动效状态](./assets/cuu/cuu-character-animation-states.png)

2026-06-08 已把 Cuu 核心概念图同步为当前真实黑猫 Hijiki / 白猫 Tororo Live2D 模型：

- `./assets/cuu/cuu-character-animation-states.png`
- `./assets/cuu/cuu-desktop-approval-search.png`
- `./assets/cuu/cuu-option-first-clarify.png`
- 源帧：`./assets/audit/2026-06-08-cuu-live2d-model-preview/`

这解决了“概念图仍像旧橘猫/手绘实验图”的偏差，但没有解决桌宠鲜活感的最终验收。下一步必须在 Tauri `pet` window 中录黑猫/白猫多帧 idle、hover、tap、drag、approval、search、offline，并证明动作不是整体缩放。

![Cuu 首轮动作抓取](./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png)

![Cuu card mode 裁切失败样例](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png)

![Cuu card mode full-body 修复样例](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png)

这些截图只保留为回归门：不能只看单帧、不能只露耳朵、不能把裁切修复当成“鲜活感通过”。当前真正要验证的是黑猫 Hijiki 与白猫 Tororo 的 Live2D runtime。

## 3. 当前实现证据

| 模块 | 关键文件 | 当前结论 |
|---|---|---|
| Cuu model registry | `packages/cuu/src/model-pack.ts` | 只保留黑猫/白猫；未知请求回退黑猫 |
| Cuu Live2D runtime | `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 按 pack id 选择 Hijiki/Tororo，并输出 P1.6 `data-cuu-behavior-*` / 真实 `.mtn` attrs |
| Cuu pet surface | `apps/desktop-webview/src/pet-surface.ts` | 独立 pet window，Live2D cat + 轻气泡；idle tick patch behavior attrs，不重建 iframe |
| Cuu preferences | `apps/desktop-webview/src/cuu-preferences.ts` | 模型选择只显示黑猫/白猫 |
| Cuu QA | `apps/desktop-webview/src/pet-surface-qa.ts` | 检查透明 root、Live2D cat runtime、无旧实验回流 |
| Tauri pet window | `client-tauri/src-tauri/src/pet_window.rs` | body/card 几何、scale/opacity/pass-through/hide-on-hover |
| Tauri commands | `client-tauri/src-tauri/src/pet_commands.rs` | window mode/settings/drag/save/cursor sample |
| Desktop shell | `apps/desktop-webview/src/browser.ts` | 主窗/pet surface 分流 |
| Proposal contracts | `packages/contracts/src/deliverable-change.ts` | 多类型交付物变更包方向 |
| Cost governance | `docs/workhub/02-ai-engine/cost-governance.md` | P-COST 文档和 Page VM 规划已补 |

## 4. PRD 明确要求逐项差距

| PRD / 头脑风暴要求 | 当前状态 | 剩余施工 |
|---|---|---|
| AI 是主力，看板只显示必要信息 | 文档和部分页面已转向 Gold Path / attention | 真实首页重构、减少 dashboard 首屏重量 |
| 澄清让用户点击选项 | 概念图和 payload 合同已写 | 所有澄清路径接入 single/multi/rank/confirm controls |
| 变更申请像 GitHub PR，但对象多样 | Manifest fixture 和 proposal page 有基础 | 文档/PPT/表格/图片/文件夹预览与证据引用 |
| 知识库/项目检索由 Cuu 气泡承接 | 概念图已写 | Cuu search card + API endpoint + result bubble |
| Cuu 是会动的小猫桌宠 | 黑/白 Live2D registry 已落，概念图已同步真实模型帧，P1.6 behavior manifest 源码合同已落，P1.7 可录真实业务场景且已有黑猫 approval smoke | 黑/白全矩阵录屏、业务动作视觉验收、长期性能 |
| Cuu 不在 Web/主窗里 | 当前文档和代码收束中 | 截图审查确认无主窗 Cuu 本体 |
| Rust 客户端哲学是轻、气泡、少打扰 | Tauri shell、托盘 settings、pass-through 恢复源码门已对齐 | 通知、deep-link、真实恢复录屏、安装包 |
| 中英双语 | locale 地基已落 | 全页面、Cuu、Rust 系统文案补齐 |
| 完整测试验收 | 有单元测试和部分 QA 脚本 | UI 截图、桌宠录屏、编译、跨平台 smoke 全链路 |

## 5. Cuu 当前施工路线

| 阶段 | 目标 | 产物 |
|---|---|---|
| CUX-L2D-01 | 黑猫默认可验收 | Hijiki idle/hover/tap/drag/approval/search/offline 录屏 |
| CUX-L2D-02 | 白猫可选可验收 | Tororo 同场景录屏 |
| CUX-L2D-03 | 设置矩阵 | scale、opacity、pass-through、hide-on-hover、card mode、`/settings` 与托盘恢复报告 |
| CUX-L2D-04 | 主窗边界 | Web/desktop 主窗截图证明无 Cuu 本体 |
| CUX-L2D-05 | 恢复策略 | `/settings` 和托盘恢复源码已落；仍需 pass-through/full hide 录屏、多屏恢复 |
| CUX-L2D-06 | 行为状态机 | P1.6 `CuuBehaviorManifest` 源码合同已落；P1.7 业务场景 capture 入口已落 |
| CUX-L2D-07 | 授权/原创替换 | 授权记录或原创等效模型计划 |

## 6. Web 与页面施工路线

| 阶段 | 页面 | 核心改造 |
|---|---|---|
| WEB-P1 | `/` | Attention workspace，默认只给一件事 |
| WEB-P2 | `/intake/:id` | option-first 澄清控件全量接入 |
| WEB-P3 | `/proposals/:id` | 多类型交付物变更说明与预览 |
| WEB-P4 | `/knowledge` / Cuu search | Web 做兜底，Cuu 气泡做默认入口 |
| WEB-P5 | `/dashboard/cost` | P-COST Usage / BudgetNotice / CostSummaryVM 接真实数据 |
| WEB-P6 | `/agent-runs/:id/replay` | Eval/replay fixture 与真实 trace 对齐 |
| WEB-P7 | 全页面 | 中英双语、空/错/载入/权限四态 |

## 7. Rust / Tauri 施工路线

| 阶段 | 模块 | 核心改造 |
|---|---|---|
| PET-R1 | window recovery | 多屏、缩放、离屏、窗口状态恢复 |
| PET-R2 | tray recovery | Cuu 显隐、主窗、收件箱、设置已落；`restore-pet-interaction` 已落；继续补真实恢复录屏 |
| PET-R3 | notification | high/urgent 去重、点击 deep-link、静默策略 |
| PET-R4 | private SSE | 设备令牌、私有流重连、状态回传 |
| PET-R5 | local sync | spec watch、网盘同步、本地缓存 |
| PET-R6 | packaging | Windows/macOS/Linux 构建、签名、安装 smoke |

## 8. 验收矩阵

| 验收 | 证据 |
|---|---|
| 文档树正确 | README 文档数量与 `git ls-files docs/workhub/*.md` 统计一致 |
| Cuu 二选项 | model registry / preferences / QA tests |
| 无旧实验源码入口 | tracked source 搜索无旧 renderer 文件和 public 入口 |
| Web 主窗无 Cuu | Playwright 截图 + DOM dump |
| Desktop 主窗无 Cuu | Tauri/webview 截图 + DOM dump |
| Cuu motion | 黑/白 contact sheet、GIF/MP4、diff report |
| Rust window | Tauri smoke、settings matrix、多屏恢复报告 |
| i18n | zh-CN/en-US screenshots + locale tests |
| TypeScript 目标路径 | `_ts-target-path-audit.md` 和 `_ts-first-module-port-page-alignment.md` 对齐 |
| Git hygiene | 不提交 `reference/` / `references/` |

## 9. 当前最短 Gold Path

1. 用户打开 Web 或 desktop 主窗，看到一件待处理事项。
2. 事项需要澄清时，用户点击选项完成输入。
3. AI 生成交付物变更包，页面显示 GitHub-like 说明。
4. 审批需要用户动作时，Cuu 在桌面右下角提醒。
5. 用户通过 Cuu 轻卡同意、打回或查看详情。
6. 结果写入 proposal / audit / replay / cost。
7. 全流程有中英双语和可回放证据。

## 10. 下一步优先级

| 优先级 | 工作 |
|---|---|
| P0 | 完成 Cuu 黑/白真实 Tauri 录屏和设置矩阵；P1.7 已写入 expected behavior contract，后续补 actual DOM attrs |
| P0 | 主窗截图审查，确认无 Cuu 本体回流 |
| P0 | 跑 Cuu / desktop webview / contracts tests |
| P1 | Web attention workspace 真页面化 |
| P1 | Proposal 多类型交付物预览 |
| P1 | Cuu search / knowledge 气泡 |
| P1 | Rust tray recovery + private SSE |
| P2 | 跨平台客户端 smoke 和安装包 |
