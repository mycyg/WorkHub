---
module: 05-clients
layer: C-PET / Cuu / Tauri
status: current
owner: workflow
date: 2026-06-08
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
- settings matrix 证明开启后可恢复，不只是命令返回成功。该项仍待真实截图 / 录屏。

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

| 下一步 | 验收 |
|---|---|
| 右键菜单真实截图 / DOM dump | zh-CN / en-US 各一份，确认文本不溢出，不遮挡 Cuu 主体 |
| 菜单模型切换 capture | 黑猫切白猫后真实 Tauri contact sheet，证明不是只改文案 |
| settings matrix | default / white-cat / scale / opacity / hide-on-hover / card-mode |
| pass-through recovery | 主窗 settings 和托盘恢复源码已落；真实 matrix 通过前仍不开放右键菜单入口 |
| Live2D motion driver | 菜单完成后继续接业务动作 `.mtn`，让 approval/search/offline 不只是 data attr |
