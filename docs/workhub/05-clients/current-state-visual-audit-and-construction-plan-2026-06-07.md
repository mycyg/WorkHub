---
module: 05-clients
layer: C-WEB / C-DESKTOP / C-PET / Cuu
status: audit-reset
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png
  - ./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png
  - ./assets/audit/2026-06-07-i18n-runtime/web-home-en-us.png
  - ./assets/web/web-ai-first-home.png
  - ./assets/web/web-option-first-intake-wizard.png
  - ./assets/desktop/desktop-one-thing-work-desk.png
  - ./assets/cuu/cuu-character-animation-states.png
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/idle-long-run/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/look-only/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/approval-scripted-smoke/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/approval-anchor-smoke/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/done-actual-dom-smoke/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/tororo/look-only/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-live2d-cat-runtime/tororo/approval-anchor-smoke/cuu-motion-contact-sheet.png
---

# 当前真实截图审计与后续施工计划

> 本文记录“当前实现距离 PRD / 概念图还有多远”。2026-06-08 之后，Cuu 视觉路线重置为黑猫 / 白猫 Live2D 二选项；之前未通过用户复核的实验素材、主窗角色栏和临时 renderer 已从当前路线移除，不能再作为验收证据。

## 1. 当前结论

| 维度 | 当前状态 | 与概念图差距 |
|---|---|---|
| Web 主窗 | 已有 Gold Path、澄清、审批、proposal、replay、cost 等页面 VM | 仍偏预览壳，密度、交互和异常态需要继续产品化 |
| Desktop 主窗 | 已能加载同源 webview 和 Tauri bridge | 必须保持严肃界面，不再出现 Cuu 本体 |
| Rust shell | 已有 Tauri scaffold、窗口命令、SSE、托盘、通知、deep-link、pet geometry | 需要跨平台 smoke、多屏恢复、安装包、设备令牌门实测 |
| Cuu pet | 当前只允许黑猫 Hijiki / 白猫 Tororo Live2D；黑猫 idle-long-run、黑/白 look-only、黑猫 approval scripted smoke、P1.8 approval anchor smoke、P1.9 黑猫业务 smoke 矩阵和白猫 approval smoke 已有真实 Tauri 证据；VPet/像素猫参考包已完成只读审查；P1.6 behavior manifest、P1.7 业务录屏入口、P1.8 actual DOM / 气泡锚点 QA 与 P1.9 card framing QA 已落 | 仍缺 32 帧正式矩阵、白猫全业务动作、拖拽、hide-on-hover、settings matrix、长期稳定性 |
| Cuu 交互 | 已有气泡、轻卡、option-first 方向 | 需要把审批、检索、澄清、交付物变更全部录成可验收场景 |
| 多语言 | 中英 locale 合同、非 Gold Path helper、用户语言偏好、pet 右键菜单和 settings 恢复面板源码已落；Web / desktop / pet 共享 `workhub.locale` | 需要补中英视觉回归和服务端生成内容 locale |

## 2. 已保留的有效截图

### 2.1 页面总览

![当前页面截图总览](./assets/audit/2026-06-07-current-state/current-state-contact-sheet.png)

这组截图仍可用于证明页面骨架存在：

| 截图 | 路由 / 来源 | 仍然有效的判断 |
|---|---|---|
| `web-home.png` | Web Gold Path | AI-first shell 已有 |
| `web-intake.png` | 澄清页 | option-first 方向已出现 |
| `web-approvals.png` | 审批中心 | 审批入口已存在 |
| `web-workitem.png` | 工作项详情 | trace / 状态区已有 |
| `web-proposal.png` | 交付物变更 | GitHub-like 说明方向已有 |
| `web-replay.png` | Replay | eval/replay 入口已有 |
| `web-cost.png` | Cost | P-COST 页面入口已有 |
| `desktop-home.png` | Desktop webview | 桌面主窗 shell 已有 |
| `pet-browser-preview.png` | Browser pet preview | 只能证明 pet surface 可预览，不能证明真实桌宠合格 |
| `tauri-pet-printwindow.png` | Tauri `pet` hwnd | 只能证明真实窗口可抓取，不能证明当前黑/白模型已验收 |

### 2.2 失败样例仍作为回归门

![Cuu 首轮动作抓取](./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png)

![Cuu card mode 裁切失败样例](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png)

![Cuu card mode full-body 修复样例](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png)

这些图不再证明 Cuu 当前视觉通过；它们只保留三个回归门：

- 不能只靠单帧 smoke 说桌宠通过。
- 不能在 card mode 只露耳朵或局部。
- 必须用真实窗口多帧截图证明动作和布局。

## 3. 当前源码事实

| 区域 | 当前事实 |
|---|---|
| 模型包 | `packages/cuu/src/model-pack.ts` 只注册黑猫和白猫 |
| 运行时 | `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` 选择 Hijiki / Tororo iframe |
| Pet surface | `apps/desktop-webview/src/pet-surface.ts` 只渲染 Live2D cat runtime + 轻气泡 |
| 偏好 | `apps/desktop-webview/src/cuu-preferences.ts` 只展示黑猫 / 白猫 |
| QA | `apps/desktop-webview/src/pet-surface-qa.ts` 禁止旧实验 runtime/class/data attr 回流 |
| 概念图 | `./assets/cuu/cuu-character-animation-states.png`、`./assets/cuu/cuu-desktop-approval-search.png`、`./assets/cuu/cuu-option-first-clarify.png` 已同步为黑/白 Live2D 版 |
| 概念源帧 | `./assets/audit/2026-06-08-cuu-live2d-model-preview/` 保留 Hijiki / Tororo 浏览器模型帧、DOM 和 report |
| 主窗 | `packages/ui/src/gold-path/render.ts` 和 desktop main shell 不再承载 Cuu 本体 |
| Rust window | `client-tauri/src-tauri/src/pet_window.rs` / `pet_commands.rs` 承担几何、设置、拖拽和 cursor sample |
| Hover 稳定性 | `apps/desktop-webview/src/pet-surface.ts` pointer/idle tick 只 patch CSS variables / `data-*`，不重建 Live2D iframe |
| 参考包结论 | VPet 可借鉴透明窗口、Start/Loop/End 动作、touch area；像素猫可借鉴 `random_act` 和动作/音效 manifest；均不得直接纳入默认资产 |
| P1.6 behavior manifest | `packages/cuu/src/motion.ts`、`packages/cuu/src/model-pack.ts`、`apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` 已输出 `data-cuu-behavior-*` 与真实 `.mtn` attrs |
| P1.7 business capture | `apps/desktop-webview/src/cuu-qa-scenarios.ts`、`client-tauri/src-tauri/src/main.rs`、`scripts/qa/cuu-tauri-motion-capture.ps1` 已支持 env-gated 业务态录屏；黑猫 approval smoke 已生成 |
| P1.8 actual DOM / 锚点 QA | `apps/desktop-webview/src/cuu-qa-dom-report.ts`、`client-tauri/src-tauri/src/main.rs`、`scripts/qa/cuu-tauri-motion-capture.ps1` 已把真实 DOM attrs 写入 report；approval 气泡改为 Cuu 邻近锚点，业务首帧必须有猫体像素 |
| P1.9 business matrix / framing QA | 黑猫 `approval/clarify/search/sync/done/offline` 与白猫 `approval` 已重跑真实 Tauri capture；actual DOM gate 已校验 Live2D runtime/model pack/bubble/action；card 画布已校准为不裁猫、不裁气泡 |

## 4. 已清理内容

这轮清理的原则是：失败路线不再作为文件、脚本、用户选项或验收目标继续存在。

| 类别 | 处理 |
|---|---|
| 旧实验图形资产 | 已从当前文档资产和 public 入口移除 |
| 旧运行时脚本 | 已删除生成/拆件脚本 |
| 旧模型 ID | tests 和偏好归一化改用 generic legacy id，未知请求回退黑猫 |
| 旧 QA 像素门 | 不再用特定颜色像素作为通过标准，改为 foreground/visual pixels |
| 主窗 Cuu 视觉 | 撤回，Web / desktop 主窗保持严肃 |

## 5. 当前不算通过的点

| 要求 | 为什么还不能算通过 | 需要的证据 |
|---|---|---|
| Cuu 鲜活感 | P1.9 已补黑猫业务 smoke 矩阵和白猫 approval，但每场只有 8 帧，motion gate 尚未用严格 changed-pixel 阈值证明长期流畅 | 黑/白 32 帧正式矩阵、changed-pixel/liveness threshold、长时间 idle/业务循环 |
| Cuu 任务动作 | 业务状态到 `.mtn` 的 `CuuBehaviorManifest` 源码合同已落；P1.9 已能注入业务场景并强校验 actual DOM attrs | 白猫全业务矩阵、direct QuestionCard option-first chip、DOM snapshot history |
| 桌面交互 | hover 固定锚点已通过；pet 右键设置轻菜单已补；主窗/托盘 pass-through 恢复门已落；tap/drag/pass-through/hide-on-hover 仍需真实复测 | Tauri motion capture + settings matrix |
| 主窗无 Cuu | 已做源码收束，但需要截图确认 | Web 与 desktop 主窗截图审查 |
| 跨平台 | 当前主要是 Windows 本机验证 | Linux/macOS smoke 与透明窗口 capture |
| 授权 | Hijiki/Tororo 来源需商用确认 | 授权记录或原创替换计划 |

## 6. 下一轮施工计划

### 6.1 黑猫正式矩阵

产物目录：`docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/`

| 场景 | 触发 | 验收 |
|---|---|---|
| idle 10s | 无事件 | 已有 smoke；正式版需 32+ 帧，持续动作，非空，非整体缩放 |
| hover | 鼠标靠近 | 已有 look-only；正式版需窗口 rect 固定，不能整只 Cuu 位移/闪烁 |
| tap | 点击 Cuu | 待录：气泡或反馈动作 |
| drag | 拖拽窗口 | 待录：位置变化、释放后保存 |
| approval | 注入审批卡 | 已有 P1.9 smoke；正式版需 32+ 帧 + liveness threshold |
| clarify/search/sync/done/offline | 注入业务卡 | 已有 P1.9 smoke；正式版需 32+ 帧 + stronger motion gate |

### 6.2 白猫录屏

产物目录：`docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime/tororo/`

白猫必须复用同一组场景，验证模型切换不是只改设置文案。P1.9 只完成白猫 approval smoke，其他业务场景仍待补。

### 6.3 Settings matrix

产物目录：`docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-settings/`

| case | 需要覆盖 |
|---|---|
| default | 黑猫默认 body-only |
| white-cat | 白猫 body-only |
| scale-75 | 缩小后仍全身可见 |
| scale-150 | 放大后不越界 |
| opacity-60 | 可见但不遮挡 |
| pass-through | 可开启，并可通过托盘恢复 |
| hide-on-hover | soft hide 后能恢复 |
| card-mode | P1.9 smoke 已证明 100% scale 不裁切；settings matrix 仍需覆盖 75/150 scale |

### 6.4 P1.6 鲜活动作状态机

参考：[`desktop-pet-reference-package-audit-2026-06-08.md`](./desktop-pet-reference-package-audit-2026-06-08.md) 与 [`cuu-live2d-cat-options-current-plan.md`](./cuu-live2d-cat-options-current-plan.md)。

| 工作项 | 落点 | 验收 |
|---|---|---|
| motion manifest | `packages/cuu/src/motion.ts` | 已落：`enter` / `loop` / `exit`、priority、interruptible、idle random pool 单测 |
| pack coverage | `packages/cuu/src/model-pack.ts` | 已落：黑猫/白猫均声明 `coverage=partial`，未知 pack 回黑猫 |
| runtime API | `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 已落：`setDesktopCuuCatLive2DBehaviorState` patch data attrs，不重建 iframe |
| event binding | `apps/desktop-webview/src/pet-surface.ts` | 已落源码 attrs；P1.9 已补黑猫业务 smoke 与白猫 approval；待补白猫全业务与正式 32 帧 |
| motion evidence | `scripts/qa/cuu-tauri-motion-capture.ps1` | 已补业务场景入口、强 actual DOM gate、黑猫业务 smoke 矩阵；待补 32 帧正式矩阵、tap、drag |

### 6.5 文档回写

录屏完成后更新：

- 本文第 7 节追加真实证据。
- [`cuu-live2d-cat-options-current-plan.md`](./cuu-live2d-cat-options-current-plan.md) 更新验收状态。
- [`desktop-pet-tauri.md`](./desktop-pet-tauri.md) 更新 Rust/Tauri smoke 状态。
- [`prd-concept-reproduction-gap-audit.md`](./prd-concept-reproduction-gap-audit.md) 更新差距表。

## 7. 待填真实证据

| 证据 | 当前状态 |
|---|---|
| 黑/白 Live2D 概念图 | 已同步到 `./assets/cuu/`，源帧已入 `./assets/audit/2026-06-08-cuu-live2d-model-preview/` |
| 黑猫 idle contact sheet | 已生成：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/idle-long-run/cuu-motion-contact-sheet.png` |
| 黑猫 hover fixed anchor | 已生成：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/look-only/cuu-motion-contact-sheet.png` |
| 黑猫 approval scripted smoke | 已生成：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/approval-scripted-smoke/cuu-motion-contact-sheet.png`，含 GIF/MP4/report |
| 黑猫 approval anchor + actual DOM smoke | 已生成：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/approval-anchor-smoke/cuu-motion-contact-sheet.png`，`actual_dom_matches_expected=true` |
| 黑猫 clarify/search/sync/done/offline GIF/MP4 | 已生成 8 帧 smoke：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/hijiki/*-actual-dom-smoke/` |
| 白猫 hover fixed anchor | 已生成：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/tororo/look-only/cuu-motion-contact-sheet.png` |
| 白猫 idle contact sheet | 待生成 |
| 白猫 approval GIF/MP4 | 已生成 8 帧 smoke：`./assets/audit/2026-06-08-cuu-live2d-cat-runtime/tororo/approval-anchor-smoke/` |
| 白猫 clarify/search/sync/done/offline GIF/MP4 | 待生成 |
| settings matrix report | 待生成 |
| pet 右键设置菜单 | 已生成：[`pet-right-click-settings-menu-p1-4.md`](./pet-right-click-settings-menu-p1-4.md)；真实 zh-CN/en-US 截图 / DOM dump 待补 |
| pet settings 恢复门 | 已生成：[`pet-settings-recovery-p1-5.md`](./pet-settings-recovery-p1-5.md)；真实 pass-through 恢复录屏 / matrix 待补 |
| Web 主窗无 Cuu 截图 | 待生成 |
| desktop 主窗无 Cuu 截图 | 待生成 |
| 中英 locale preference API | 已生成：`PATCH /api/auth/preferences`、`users.preferred_locale`、[`i18n-user-locale-preference-p1-3.md`](./i18n-user-locale-preference-p1-3.md) |
| 桌宠参考包审查 | 已生成：[`desktop-pet-reference-package-audit-2026-06-08.md`](./desktop-pet-reference-package-audit-2026-06-08.md)，只借鉴状态机、资源包和窗口交互，不直接纳入未授权素材 |
| P1.6 鲜活动作状态机 | 已生成：[`cuu-behavior-manifest-p1-6.md`](./cuu-behavior-manifest-p1-6.md)；源码合同已落，真实 Tauri 业务动作录屏待补 |
| P1.7 业务动作录屏入口 | 已生成：[`cuu-tauri-business-motion-capture-p1-7.md`](./cuu-tauri-business-motion-capture-p1-7.md)；黑猫 approval smoke 已落，黑/白全矩阵待补 |
| P1.8 actual DOM / 气泡锚点 QA | 已生成：[`cuu-tauri-actual-dom-and-anchor-qa-p1-8.md`](./cuu-tauri-actual-dom-and-anchor-qa-p1-8.md)；黑猫 approval anchor smoke 已落 |
| P1.9 business matrix / card framing QA | 已生成：[`cuu-tauri-business-matrix-and-card-framing-p1-9.md`](./cuu-tauri-business-matrix-and-card-framing-p1-9.md)；黑猫业务 smoke 矩阵与白猫 approval 已落，32 帧正式矩阵待补 |

## 8. 完成标准

这轮 Cuu 模块只有在以下条件同时满足时，才可称为“当前 PRD 口径下通过”：

- 源码、偏好、QA 只承认黑猫/白猫。
- 删除旧实验文件、脚本、public 入口和过期文档入口。
- Web / desktop 主窗没有 Cuu 本体。
- 黑猫/白猫真实 Tauri 多帧录屏通过。
- 动作不是只缩放。
- 鼠标靠近不移动窗口、不移动整只 Cuu、不重建 iframe。
- card mode 不裁切。
- pass-through / hide-on-hover 有恢复策略。
- `git diff --name-only` 不含 `reference/` / `references/`。
