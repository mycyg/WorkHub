---
module: 05-clients
layer: C-PET / Cuu / Tauri
status: current
owner: workflow
date: 2026-06-10
---

# P1.4 Pet Right-Click Settings Menu

> 当前口径：设置入口属于独立 Cuu `pet` window 和系统托盘，不把 Cuu 形象放回 Web / desktop 主窗。右键菜单只做轻设置，不承载完整设置页。

## 1. 本轮已落

| 能力 | 落点 | 说明 |
|---|---|---|
| Pet 右键菜单 | `apps/desktop-webview/src/pet-surface.ts` | 右键 Cuu 打开隐藏菜单；打开/关闭菜单只 patch DOM hidden 状态，不重建 Live2D iframe |
| 黑猫 / 白猫 | `data-pet-menu-model` | 切换 `pet_model_pack_id`，复用当前黑/白 Live2D 白名单 |
| 中文 / EN | `data-pet-menu-locale` | 写回 `workhub.locale`，并调用 `client.updatePreferences({ locale })` |
| 悬停避让 | `data-pet-menu-toggle-hover` | 切换 `pet_hide_on_hover`，保存 Cuu preferences，并同步 Rust window settings |
| 打开设置 | `petWindowBridge.focusMainRoute("/settings")` | 通过 Tauri command 打开主窗安全 `/settings` 路由，不让 pet window 自己导航 |
| 隐藏 Cuu | `petWindowBridge.hidePetWindow()` | 通过 Tauri command 隐藏独立 pet window |
| 托盘设置项 | `client-tauri/src-tauri/src/tray.rs` / `main.rs` | 托盘新增 `Settings`，同样打开 `/settings` |

## 2. Deliberate Non-Goal

本轮没有把“点击穿透”放进 pet 右键菜单。

原因：一旦开启 pass-through，用户会失去右键入口。如果主窗设置页和托盘恢复策略还没完成，用户可能只能靠重启或手改 storage 恢复。点击穿透必须等以下能力一起落地：

- 主窗严肃 settings 页能关闭 `pet_pass_through`。P1.5 已落源码恢复门。
- 托盘有明确“恢复 Cuu 交互”动作。P1.5 已落 `restore-pet-interaction`。
- R3.18 已用主窗 `/settings` 真实截图证明开启后可恢复，并确认恢复后右键菜单重新可用；R3.19 已证明同一 Rust tray handler 可恢复；R3.20a 已证明右键菜单切 hover 后主窗 settings 同步；R3.20b 已证明 Windows 物理 OS 托盘菜单可恢复，且不走 command fallback。

## 3. Runtime Contract

菜单默认常驻 HTML：

```html
<nav data-pet-settings-menu hidden>
```

右键只做：

```ts
menu.hidden = false;
surface.dataset.petMenuOpen = "true";
```

不因为 pointer tick 或菜单开合重建 `root.innerHTML`。只有用户真正修改模型、语言或 hover setting 时才重新 render。

## 4. Tests

已验证：

```powershell
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview build
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
```

覆盖点：

- pet surface HTML 有隐藏设置菜单。
- 菜单只展示黑猫 / 白猫，不出现旧模型路线。
- 英文 locale 下菜单固定文案为英文。
- Bridge 可调用 `focus_main_route("/settings")` 与 `hide_pet_window`。
- Rust tray `Settings` 映射到安全主窗 `/settings`。

## 5. Next Acceptance Work

### 5.1 R3.17 已完成验收

| 项 | 证据 / 结论 |
|---|---|
| 右键菜单 zh-CN | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-settings-menu-recovery/hijiki/menu-zh-boundary-pass3/`，`settings_menu_layout_gate.passed=true` |
| 右键菜单 en-US | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-settings-menu-recovery/hijiki/menu-en-boundary-pass3/`，`settings_menu_layout_gate.passed=true` |
| 菜单模型切换 | `menu-model-switch-boundary-pass3/`，真实 Tauri contact sheet 显示黑猫右键菜单 -> 点击白猫 -> Tororo 白猫；最终 DOM `data_cuu_model_pack="cuu-tororo-live2d-cubism2"` |
| 文本边界 | 菜单宽度固定为 164px，rect 为 `x=8,width=164,right=172`，在 260px pet surface 内；按钮使用 `min-width:0`、grid `minmax(0,1fr)` 和 ellipsis，不再复现用户截图中的文本出框 |
| 短提示回归 | 模型切换后的 `Cuu 形象已更新。` 修为 compact status bubble；gate 记录 `x=102,width=150,right=252`，在 260px surface 内 |
| pass-through 菜单项 | 继续不出现在右键菜单；DOM text 不含 pass-through/点击穿透，避免开启后失去右键恢复入口 |

R3.17 新增 `settings_menu_layout_gate`，不再只靠人工截图判断菜单边界：`settings-menu` 场景检查菜单 present、rect 非零、窗口内边界、文本非空且无 pass-through 入口；`settings-menu-model-switch` 场景检查模型切换后的 compact 短提示在窗口内。

### 5.2 R3.18 pass-through recovery 已完成

| 项 | 证据 / 结论 |
|---|---|
| 主窗恢复 zh-CN | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-pass-through-recovery/hijiki/settings-restore-zh/`，`pass_through_recovery_gate.passed=true` |
| 主窗恢复 en-US | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-pass-through-recovery/hijiki/settings-restore-en/`，`pass_through_recovery_gate.passed=true` |
| 右键菜单重新可用 | 两个 locale 的最终 DOM report 均显示 `final_menu_usable=true`，菜单 text 非空且 rect 在 260px pet surface 内 |
| pass-through 菜单项 | 继续不放进右键菜单；恢复入口留在主窗 `/settings` 和系统托盘 |
| 主窗 settings 截图 | zh-CN / en-US 均 `layout_gate.passed=true`，无 Cuu 本体、无模型预览、`overflow.offenders=[]` |

### 5.3 R3.19 tray handler recovery 已完成

| 项 | 证据 / 结论 |
|---|---|
| tray handler 恢复后菜单可用 | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-tray-recovery/hijiki/tray-restore-en-official/` 与 `tray-restore-zh-official/`，两组 `settings_menu_layout_gate.passed=true` |
| 菜单遮挡回归 | 恢复提示缩短为 `Interaction restored.` / `已恢复交互。`；右键菜单打开时清掉 transient status，official DOM report `bubble=null`，contact sheet 中菜单不遮挡提示文字 |
| menu -> settings 事件桥 | 右键菜单切 hover 会 emit `pet-settings` 到 main；`pet right-click menu broadcasts hover setting changes to the main settings panel` 单测覆盖 `source="pet-menu"` payload |
| pass-through 菜单项 | 仍不放进右键菜单；pass-through 恢复入口继续保留在主窗 `/settings`、系统托盘 handler 和 R3.20b 已验证的物理 tray menu |

### 5.4 R3.20a settings hover sync 已完成

| 项 | 证据 / 结论 |
|---|---|
| 右键 hover -> 主窗 settings | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-settings-hover-sync/hijiki/hover-sync-en-official/` 与 `hover-sync-zh-official/`，两组 `settings_menu_hover_sync_gate.passed=true` |
| 主窗可见截图 | `main-settings-before-hover-sync.png` 显示 `hide_checked=false`；`main-settings-after-hover-sync.png` 直接显示 `Dodge hover` / `悬停避让` 已勾选 |
| 菜单可用性 | 点击 hover 后再次右键，菜单仍在 260px pet surface 内，hover 项保持 selected；`settings_menu_layout_gate.passed=true` |
| 文本边界 | 菜单按钮、短提示、主窗 settings 状态徽标均通过 overflow gate；两个 locale 的 `overflow.offenders=[]` |
| pass-through 菜单项 | 继续不放进右键菜单；R3.20a 只验证 `hide_on_hover`，不扩大菜单恢复入口 |

### 5.5 R3.20b physical tray recovery 已完成

| 项 | 证据 / 结论 |
|---|---|
| 物理 OS 托盘恢复 | `docs/workhub/05-clients/assets/audit/2026-06-10-cuu-r3-physical-tray-recovery/hijiki/physical-tray-restore-en-official/` 与 `physical-tray-restore-zh-official/`，两组 `physical_tray_recovery_gate.passed=true` |
| command fallback | 两组 capture 均 `command_fallback_used=false`；恢复动作来自 Windows UI Automation 定位系统 tray 图标、打开原生菜单、点击 `Restore Cuu interaction` |
| 恢复后状态 | 恢复后 `pass=false/hide=false/opacity=100`，pet 右键菜单可用，主窗 `/settings` 同步为可交互状态 |
| 文本边界 | 同轮把 run-failure/run-stream 卡片接入 `pet_card_text_overflow_gate`，中英证据均 `overflow_offender_count=0` |

### 5.6 后续验收

| 下一步 | 验收 |
|---|---|
| Linux/macOS tray/menu smoke | Linux 测试机先验证透明 pet window、tray/menu 恢复和截图权限；macOS 形成 menu bar / screenshot permission 策略 |
| settings 双向状态同步回归 | R3.20a 已补右键菜单切 hover 后主窗 settings 状态同步截图；R3.20b 已补物理托盘恢复后 pet/main 同步；后续保留跨平台回归 |
| Live2D motion driver | 菜单完成后继续接业务动作 `.mtn`，让 approval/search/offline 不只是 data attr |
