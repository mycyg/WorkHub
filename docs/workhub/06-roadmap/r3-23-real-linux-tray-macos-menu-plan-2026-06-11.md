# R3.23 Real Linux Tray / macOS Menu Plan

日期：2026-06-11

## 1. 开工前必读

R3.23 开工前必须重读：

- `docs/workhub/05-clients/cuu-r3-agent-entry.md`
- `docs/workhub/05-clients/desktop-pet-tauri.md`
- `docs/workhub/06-roadmap/r3-21-cross-platform-tray-smoke-plan-2026-06-10.md`
- `docs/workhub/06-roadmap/r3-22-text-overflow-permission-offline-qa-plan-2026-06-11.md`
- `docs/workhub/05-clients/pet-settings-recovery-p1-5.md`
- `docs/workhub/05-clients/page-concepts.md`
- 概念图：`assets/cuu/cuu-desktop-approval-search.png`、`assets/cuu/cuu-option-first-clarify.png`、`assets/shared/endpoint-page-cuu-alignment.png`

## 2. 问题来源

R3.21 已证明 Linux Xvfb/openbox 能启动 WorkHub main window、独立 Cuu pet window 和 `520x720` card frame。R3.22 已证明 failed AgentRun 与 generic runtime error 卡在 Linux mock API smoke 中不越框、不遮住 Live2D。

但这两轮仍没有证明真实 Linux 桌面环境的 tray/appindicator 菜单物理点击，也没有证明 macOS menu bar item、截图权限与 Accessibility 自动化。R3.23 的目标是关闭这个平台能力缺口。

## 3. 施工范围

| 平台 | 必须覆盖 |
|---|---|
| Linux GNOME/KDE/Xfce | 至少一个真实 DE session；appindicator/tray icon 可见；菜单项可通过物理点击或等价系统 UI 自动化触发 |
| Linux fallback | 若当前远程机仍无 DE，则记录阻塞证据，并准备可复用的 `dbus` / `xdotool` / `gdbus` 探测脚本，不声明通过 |
| macOS | menu bar item contract、截图权限说明、Accessibility 自动化策略；有机器时跑真实点击 smoke |
| Cuu restore | `Restore Cuu interaction` 后必须 `pass=false`、`hide_on_hover=false`、`opacity=100`，右键菜单可用 |
| Main settings | `Open settings` 必须打开主窗 `/settings`，主窗无 Cuu 本体、无模型预览、无文本 overflow |
| Text/frame regression | 复用 R3.22 `spatial_safety`，确保平台菜单恢复后 Cuu card 仍不越框 |

## 4. 实施顺序

1. 审计当前 Tauri tray/menu 实现：`client-tauri/src-tauri/src/tray.rs`、`main.rs`、`pet_window.rs`、`pet_commands.rs`。
2. 增强 Linux smoke 脚本的环境探测：输出 `XDG_CURRENT_DESKTOP`、`XDG_SESSION_TYPE`、panel/appindicator 进程、DBus session、tray icon window、menu item 可见性。
3. 在真实 DE 环境优先验证 GNOME AppIndicator；若 GNOME 不可用，再验证 KDE/Xfce tray。
4. 加入菜单动作矩阵：show/hide Cuu、restore interaction、open settings、inbox、quit dry-run guard。
5. 对每个菜单动作采集前后状态：window list、DOM report、截图、settings route、pet settings state。
6. 为 macOS 添加可执行计划：menu bar item label、AppleScript/Accessibility 点击路径、Screen Recording 权限探测、失败时的明确退出码与日志。
7. 回归 R3.22：平台菜单恢复后复跑 `run-failure` 或 `generic-runtime-error` 的 `spatial_safety` gate。
8. 更新文档：`cuu-r3-agent-entry.md`、`desktop-pet-tauri.md`、R0-R4 roadmap、README 和本计划结果。

## 5. 验收门

| Gate | 要求 |
|---|---|
| real DE proof | 不能用 Xvfb/openbox 替代真实 panel；截图和日志必须显示真实 DE / panel / tray indicator |
| menu action proof | 每个菜单项至少有一次可复跑 smoke，且状态变化来自 tray/menu handler，不是直接 command fallback |
| settings proof | 打开设置后主窗路由、控件状态和 `overflow.offenders=[]` 均有证据 |
| pet restore proof | restore 后 Cuu 可交互，右键菜单可用，`pass=false`、`hide=false`、`opacity=100` |
| macOS proof | 有 macOS 机器时必须提供 menu bar 截图、权限探测和点击日志；没有机器时只能交付策略与脚本，不声明通过 |
| regression proof | R3.22 text/frame hardgate 继续通过，尤其是 `spatial_safety.bubble_overlaps_live2d=false` |
| path hygiene | 不提交 `reference/`、临时 askpass、日志缓存或本地密钥 |

## 6. 必跑命令

```powershell
node_modules\.bin\tsc.CMD -p apps\desktop-webview\tsconfig.json --noEmit
corepack pnpm --filter @workhub/desktop-webview test
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
```

```bash
bash -n scripts/qa/cuu-tauri-linux-smoke.sh
WORKHUB_CUU_QA_SCENARIO=pass-through-recovery-tray-physical \
WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 \
bash scripts/qa/cuu-tauri-linux-smoke.sh
```

macOS 有机器时补：

```bash
WORKHUB_MACOS_MENU_SMOKE_OUT_DIR=/tmp/workhub-cuu-macos-menu-smoke \
bash scripts/qa/cuu-tauri-macos-menu-smoke.sh
```

## 7. 退出门

- Linux 至少一个真实 DE tray/appindicator 菜单动作矩阵通过，或明确给出无法通过的环境阻塞证据。
- macOS menu bar smoke 有可执行脚本；有机器则必须跑通截图/点击/权限探测。
- Cuu 仍只在独立 pet window，主窗保持严肃工作界面。
- R3.22 text/frame hardgate 在平台菜单恢复后仍通过。
- 文档完成“已落结果 + 证据 + 下一刀计划”闭环。
- 完成后提交并推送 main。

## 8. 2026-06-11 第一刀落点

R3.23 第一刀先补“不假阳性”的平台探测与 macOS smoke 脚本骨架，不声明真实 DE/macOS 已通过：

| 落点 | 结果 |
|---|---|
| Linux real DE gate | `scripts/qa/cuu-tauri-linux-smoke.sh` 增加 `WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1` 强门；除 `DISPLAY` / `WAYLAND_DISPLAY`、`XDG_CURRENT_DESKTOP`、`XDG_SESSION_TYPE=x11/wayland` 外，还要求能探测到 GNOME/KDE/Xfce/Waybar/appindicator 等 panel 进程 |
| Linux probe files | 每轮 Linux smoke 额外写 `linux-desktop-probe.txt`、`linux-panel-processes.txt`、`linux-x11-tray-owner.txt`、`linux-dbus-services.txt`，用于判断 DBus、X11 tray owner、panel/appindicator 是否真实存在 |
| API port guard | Linux mock API 继续锁定 `8787`，与 `apps/desktop-webview/vite.config.ts` 的 `/api` proxy 一致，避免“健康检查连 A 端口、WebView 实际连 B 端口”的假通过 |
| macOS smoke script | 新增 `scripts/qa/cuu-tauri-macos-menu-smoke.sh`；非 Darwin 直接退出 2，有 macOS 时才执行 desktop-webview test/build、Tauri cargo test/build、启动 devUrl、采集 menu bar inventory、尝试点击 WorkHub/Cuu menu bar item 并截图 |
| macOS 权限边界 | AppleScript / System Events 找不到 menu bar item 时脚本失败，不 fallback 到 Tauri command；这保证后续截图权限或 Accessibility 未开时不会伪造通过 |

本地验证：

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/qa/cuu-tauri-linux-smoke.sh
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/qa/cuu-tauri-macos-menu-smoke.sh
WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 bash scripts/qa/cuu-tauri-linux-smoke.sh
WORKHUB_MACOS_MENU_SMOKE_OUT_DIR=/tmp/workhub-r3-23-macos-non-darwin bash scripts/qa/cuu-tauri-macos-menu-smoke.sh
```

结果：

- 两个脚本 Bash 语法通过。
- 当前 Windows/Git Bash 环境无真实 DE，`WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1` 按预期失败，不落入 Xvfb/openbox。
- 当前非 Darwin 环境运行 macOS smoke 按预期退出 2，不声明 macOS 通过。

## 9. 2026-06-11 第二刀落点

R3.23 第二刀把菜单动作矩阵从文档要求推进到脚本合同：

| 落点 | 结果 |
|---|---|
| Rust quit dry-run | `client-tauri/src-tauri/src/main.rs` 新增 `WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN`，且必须同时存在非空 `WORKHUB_CUU_QA_SCENARIO` 才生效。默认行为不变；仅 QA smoke 显式设置时，点击 `Quit WorkHub` 只 emit `tray-action`，不退出进程 |
| Linux action matrix | `scripts/qa/cuu-tauri-linux-smoke.sh` 每轮输出 `tray-menu-action-matrix.json`，列出 `show-main`、`hide-main`、`toggle-pet`、`restore-pet-interaction`、`open-inbox`、`open-settings`、`quit` 的 label、target、expected effect、destructive/dry-run 属性 |
| Linux quit safety | Linux smoke 启动 Tauri 时设置 `WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN=1`，后续真实 DE 菜单点击可以覆盖 quit guard 而不杀掉 smoke |
| macOS action matrix | `scripts/qa/cuu-tauri-macos-menu-smoke.sh` 使用同一 action matrix，默认 `WORKHUB_MACOS_MENU_ACTIONS=restore-pet-interaction,open-settings,open-inbox,toggle-pet,show-main,hide-main,quit` |
| macOS menu automation | macOS smoke 使用 `AXShowMenu` 打开 WorkHub/Cuu menu bar item，再按 action label 点击原生菜单项，逐项保存 `menu-click-<action>.txt` 与 `screen-after-<action>.png`；找不到 menu item 或 action 后进程退出时失败，不 fallback 到 Tauri command |

本地验证：

```powershell
node_modules\.bin\tsc.CMD -p apps\desktop-webview\tsconfig.json --noEmit
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/qa/cuu-tauri-linux-smoke.sh
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/qa/cuu-tauri-macos-menu-smoke.sh
WORKHUB_MACOS_MENU_SMOKE_OUT_DIR=/tmp/workhub-r3-23-macos-non-darwin bash scripts/qa/cuu-tauri-macos-menu-smoke.sh
```

结果：

- Rust tests 覆盖 `WORKHUB_CUU_QA_TRAY_QUIT_DRY_RUN` truthy/falsey 解析。
- 两个 shell 脚本 Bash 语法通过。
- 当前非 Darwin 环境运行 macOS smoke 仍按预期退出 2，不声明 macOS 通过。

## 10. 2026-06-11 第三刀落点

R3.23 第三刀把 Linux 真实 DE 菜单动作从“矩阵合同”推进到“原生执行器”：

| 落点 | 结果 |
|---|---|
| real DE preservation | `WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1` 时不再启动 openbox，保留现有 GNOME/KDE/Xfce/Waybar panel，避免污染真实桌面证据 |
| StatusNotifier discovery | Linux smoke 读取 `org.kde.StatusNotifierWatcher.RegisteredStatusNotifierItems`，逐项快照 `Id/Title/ToolTip/Menu`，只选择包含 WorkHub/Cuu/workhub-main-tray 的 item；否则失败并要求显式 `WORKHUB_LINUX_STATUS_NOTIFIER_ITEM=service/path` |
| DBus menu execution | 真实 DE 下通过 `com.canonical.dbusmenu.GetLayout` 解析 menu label -> menu id，再用 `com.canonical.dbusmenu.Event(..., "clicked", ...)` 触发菜单项；不 fallback 到 Tauri command |
| action evidence | 每个 action 采集 `linux-dbusmenu-layout-<action>.txt`、`linux-dbusmenu-event-<action>.txt`、前后 `wmctrl/xdotool/ps`、前后截图；`quit` 依赖 dry-run，若进程退出则失败 |
| fallback safety | 未启用 `WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE` 时，菜单动作执行器只写 `linux-menu-action-status.txt` skipped，不影响 Xvfb/openbox 的窗口与文本 hardgate |

本地验证待跑：

```powershell
& 'C:\Program Files\Git\bin\bash.exe' -n scripts/qa/cuu-tauri-linux-smoke.sh
WORKHUB_LINUX_SMOKE_OUT_DIR=/tmp/workhub-r3-23-linux-real-de-guard bash scripts/qa/cuu-tauri-linux-smoke.sh
WORKHUB_LINUX_SMOKE_OUT_DIR=/tmp/workhub-r3-23-linux-real-de-guard WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1 bash scripts/qa/cuu-tauri-linux-smoke.sh
```

当前本机仍不是真实 Linux DE，所以第三刀只能证明脚本合同、Xvfb fallback 不被破坏、真实 DE guard 不假阳性；真实菜单 action proof 仍需在 GNOME/KDE/Xfce session 上跑。

## 11. 2026-06-11 第四刀落点

远端 `192.168.5.53` 的 `mycyg` 账号可通过临时 askpass 登录；已有真实 GNOME session，但 SSH shell 默认没有继承图形授权变量：

| 远端探测项 | 结果 |
|---|---|
| GNOME session | `gnome-shell --mode=ubuntu` 正在运行，user DBus 为 `unix:path=/run/user/1000/bus` |
| SSH 默认环境 | `XDG_SESSION_TYPE=tty`、`DISPLAY` 空、`XDG_CURRENT_DESKTOP` 空，不能直接声明 real-DE smoke |
| 可复用图形变量 | 从 GNOME 进程和 `/run/user/1000` 识别到 `DISPLAY=:0`、`WAYLAND_DISPLAY=wayland-0`、`XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.1SGUP3` |
| 失败证据 | 未设置 `XAUTHORITY` 时，Tauri/GTK、`wmctrl`、`xdotool`、`xwininfo`、`scrot` 均报 `Authorization required`，app 在 capture 前退出 |
| 清理问题 | 失败路径留下 orphan mock API node，占用 `127.0.0.1:8787`；已清理旧 R3.22/R3.23 临时 WorkHub smoke 进程 |
| AppIndicator 扩展 | 远端已安装 `ubuntu-appindicators@ubuntu.com`，手动启用后出现在 enabled extensions；但当前 GNOME Shell 未提供 `org.kde.StatusNotifierWatcher`，可能需要重启 GNOME session 后生效 |
| orphan Tauri | StatusNotifier 失败后曾留下 `workhub-client-tauri` orphan；下一轮触发单实例退出，表现为 `app-stdout.txt` 为空、`ps-app.txt` 空但旧窗口仍在 |

第四刀脚本改动：

- `scripts/qa/cuu-tauri-linux-smoke.sh` 新增 `bootstrap_real_desktop_session_env()`：仅在 `WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1` 时补齐 `XDG_RUNTIME_DIR`、`DBUS_SESSION_BUS_ADDRESS`，并在 `DISPLAY` 存在但 `XAUTHORITY` 为空时选择 `/run/user/<uid>/.mutter-Xwaylandauth.*` 或 `~/.Xauthority`。
- `linux-env-report.txt` 新增 `xauthority`、`xdg_runtime_dir`、`dbus_session_bus_address`，方便复盘 SSH -> GNOME 会话桥接。
- `cleanup()` 增加当前 `repo_root` 限定的 orphan 清理：`cuu-r3-tauri-run-stream-server` 与 `@workhub/desktop-webview dev`，避免失败后 8787/1420 stale 端口造成下一轮假阻塞。
- `cleanup()` 后续再收紧为 RETURN + EXIT 双保险，并按当前 `repo_root/client-tauri/src-tauri/target/debug/workhub-client-tauri` 清理 orphan Tauri debug binary，避免下一轮 single-instance 假失败。

当前状态：远端真实 GNOME 已证明 `DISPLAY/XAUTHORITY` 桥接、窗口列表、DOM `spatial_safety` 与文本/frame hardgate 可跑；root screenshot 在该远程 GNOME session 下是黑图，不作为 UI 验收截图；StatusNotifier menu action 仍阻塞在 `org.kde.StatusNotifierWatcher` 缺失/扩展未热加载，不能声明 tray menu action 通过。

本地证据已归档：

- `docs/workhub/05-clients/assets/audit/2026-06-11-r3-23-real-de-gnome/smoke-summary.md`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r3-23-real-de-gnome/screen.png`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r3-23-real-de-gnome/cuu-tauri-dom-report.json`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r3-23-real-de-gnome/gnome-appindicator-status.txt`

## 12. 2026-06-11 第六刀落点

为避免 GNOME `ubuntu-appindicators@ubuntu.com` 长期 `INACTIVE` 时完全卡死，Linux smoke 增加显式 fallback driver：

| Driver | 用法 | 证明边界 |
|---|---|---|
| `status-notifier` | 默认；读取 `org.kde.StatusNotifierWatcher`，通过 DBus menu `GetLayout` / `Event(clicked)` 触发 action | AppIndicator / StatusNotifier panel proof |
| `x11-tray-icon` | `WORKHUB_LINUX_MENU_DRIVER=x11-tray-icon`；解析 `xwininfo -root -tree` 中的 `tray-icon tray app workhub-main-tray` X window，右键后按 focusable menu item 顺序键盘选择 action | 真实 X11 tray-window automation，不等同 GNOME panel/AppIndicator proof |

X11 fallback 每个 action 仍保留前后 `ps/wmctrl/xdotool/screen`、`linux-x11-tray-click-<action>.txt` 和 `linux-menu-action-status.txt`。`quit` 仍必须依赖 dry-run；若进程退出，脚本失败。

## 13. 下一步

1. 重启或重建远端 GNOME session，使已启用的 `ubuntu-appindicators@ubuntu.com` 从 `INACTIVE` 变为 active，再跑 `WORKHUB_LINUX_SMOKE_REQUIRE_REAL_DE=1`，保留 StatusNotifier item、DBus menu layout/event、每个菜单动作前后截图。
2. 若重启后 `RegisteredStatusNotifierItems` 仍无 WorkHub，先读取 `linux-status-notifier-items.txt` 与每个 `linux-status-notifier-item-*.txt`，再用 `WORKHUB_LINUX_STATUS_NOTIFIER_ITEM=service/path` 显式指定，不改用 Tauri command fallback。
3. 在远端当前 session 先跑 `WORKHUB_LINUX_MENU_DRIVER=x11-tray-icon`，确认 X11 tray-window fallback 是否能触发同一 Rust tray handler；通过后单独归档，不能替代 AppIndicator gate。
4. 在 macOS 机器上跑 `scripts/qa/cuu-tauri-macos-menu-smoke.sh`，若 Accessibility / Screen Recording 权限不足，保留失败截图与权限前置条件，不声明通过。
5. 成功取得任一真实平台菜单证据后，再更新 `cuu-r3-agent-entry.md`、`desktop-pet-tauri.md`、R0-R4 roadmap 和 README。
