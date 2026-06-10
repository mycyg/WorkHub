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
