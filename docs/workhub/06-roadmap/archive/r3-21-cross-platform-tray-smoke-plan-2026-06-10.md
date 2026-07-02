# R3.21 Cross-Platform Tray/Menu Smoke Plan

日期：2026-06-10

## 1. 开工前必读

R3.21 开工前必须先读以下文档和概念图，避免跨平台 smoke 偏离 Cuu 的独立 pet surface 设定：

- `docs/workhub/05-clients/cuu-r3-agent-entry.md`
- `docs/workhub/05-clients/pet-settings-recovery-p1-5.md`
- `docs/workhub/05-clients/pet-right-click-settings-menu-p1-4.md`
- `docs/workhub/05-clients/desktop-pet-tauri.md`
- `docs/workhub/05-clients/cuu-tauri-business-motion-capture-p1-7.md`
- `docs/workhub/05-clients/prd-concept-reproduction-gap-audit.md`
- `docs/workhub/05-clients/page-concepts.md`

## 2. 当前基线

R3.20b 已完成 Windows 物理 OS 托盘恢复闭环：UI Automation 定位系统 tray `WorkHub - Cuu is ready`，右键打开原生菜单，点击 `Restore Cuu interaction`，并确认 `command_fallback_used=false`。同轮已把用户截图中的文本越框风险纳入自动 gate，run-failure/run-stream 中英证据均要求 `pet_card_text_overflow_gate.passed=true`、`overflow_offender_count=0`。

R3.21 不重新定义 Windows 行为；它只把同一产品契约扩展到 Linux/macOS 的可验证策略。

## 3. 验收目标

| 平台 | 必须证明 |
|---|---|
| Linux | 能启动主窗和独立透明 `pet` window；能记录 X11/Wayland、desktop environment、tray 可见性、截图方式；能从 pass-through 初始态恢复到 `pass=false/hide=false/opacity=100`，或明确记录当前 DE 不提供 tray 时的 fallback 和限制 |
| macOS | 形成 menu bar restore、截图权限、透明 window 权限和自动化策略；有机器时再补真实 capture，不在无机器时伪造通过 |
| Windows 回归 | R3.20b physical tray recovery 仍保留，后续改 capture 脚本不得破坏 `command_fallback_used=false` |
| 文本边界 | run-failure、run-stream、permission-401、permission-403、stream-offline 的中英 card 继续接入 `pet_card_text_overflow_gate` |

## 4. Linux 施工顺序

1. 远程环境探测：确认 `192.168.5.53` 登录用户、桌面会话、`DISPLAY`、`WAYLAND_DISPLAY`、`XDG_CURRENT_DESKTOP`、截图工具和系统 tray 支持。
2. 构建/启动：在 Linux 上启动 Tauri dev 或可运行包，确认 main window 与 pet window 都能打开。
3. 透明窗口截图：保留一张全屏截图和一张 pet 局部截图，确认 Cuu 不在主窗内，pet window 不黑屏、不空白、不裁切。
4. 恢复路径：从 pass-through 初始态触发 tray/menu restore；若当前 DE 没有 tray menu，必须记录 fallback 方案，并证明主窗 `/settings` 可恢复。
5. 数据流复核：恢复后检查 pet DOM、main settings DOM、preferences/localStorage、Tauri event，确认状态不是单侧刷新。

## 5. macOS 策略顺序

1. 明确菜单入口：macOS 通常是 menu bar item，不强行复用 Windows tray 坐标门。
2. 明确自动化工具：优先评估 AppleScript / accessibility API / screenshot permission；需要人工授权时记录前置条件。
3. 明确截图证据：至少规划 menu before restore、menu restore item、main settings before/after、pet menu after restore。
4. 不在无 macOS 环境时声明已通过；只能声明策略完成。

## 6. 必跑回归

```powershell
corepack pnpm --filter @workhub/desktop-webview test
corepack pnpm --filter @workhub/desktop-webview build
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
corepack pnpm verify
```

R3.21 capture 产物必须继续保留 contact sheet、GIF/MP4、DOM report、motion diff report 和关键截图；不得提交 `reference/`。

## 7. 退出门

- Linux 至少有一份真实环境 smoke 报告，含平台探测、截图、恢复路径结果和限制。
- macOS 至少有自动化策略文档；若有机器，则补真实 capture。
- Windows R3.20b evidence gate 未回退。
- 文本 overflow gate 覆盖范围扩大后仍无 offender。
- 文档更新到 `cuu-r3-agent-entry.md`、`pet-settings-recovery-p1-5.md`、`desktop-pet-tauri.md`、`cuu-tauri-business-motion-capture-p1-7.md` 与总路线图。
- 提交前跑完测试、检查 `reference/` 未入暂存区，并推送 main。

## 8. 2026-06-11 执行结果

R3.21 已完成 Linux 首轮真实环境 smoke，但不冒充 macOS 通过。

| 项 | 结果 |
|---|---|
| Linux 登录用户 | `mycyg@192.168.5.53` 可用；`mycyg1994` 不可用 |
| 原始会话 | `XDG_SESSION_TYPE=tty`，`DISPLAY` / `WAYLAND_DISPLAY` / `XDG_CURRENT_DESKTOP` 均为空；真实桌面会话不可用 |
| 依赖补齐 | 安装 Node 22.22.1、pnpm 11.0.9、Rust/Cargo 1.93.1、Tauri Linux 依赖、`xvfb-run`、`scrot`、`wmctrl`、`xdotool`、`openbox` |
| Linux 编译缺口 | Tauri Linux 编译需要 `client-tauri/src-tauri/icons/icon.png`；仓库原来只有 `icon.ico`，已补 PNG 图标并用 Linux `cargo test` 证明通过 |
| 真实窗口证据 | Xvfb + openbox + Vite devUrl 下，`wmctrl` 有 `WorkHub` 与 `Cuu` 两个窗口，`xwininfo` 有 `WorkHub 1180x780`、`Cuu 520x720`、tray icon `16x16` |
| 文本越框修正 | card mode 从 `520x640` 调整为 `520x720`，bubble 锚点从 `bottom:304/348px` 收敛到 `bottom:392px`；新增失败 AgentRun 英文长卡结构/CSS 单测，覆盖 `Run progress` / `Budget` / 双按钮组合。真实截图级 failed AgentRun overflow 证据进入 R3.22 |
| hardgate 复跑 | 加固后的 `scripts/qa/cuu-tauri-linux-smoke.sh` 已在 `/tmp/workhub-r3-linux-smoke-20260611-hardgate5` 退出码 0；脚本断言 `WorkHub` / `Cuu` 窗口、`Cuu 520x720`、截图、DOM report 与横向无 overflow，并在复跑后清理 Vite/1420 残留进程 |
| devUrl 说明 | debug Tauri 二进制必须配套 `pnpm --filter @workhub/desktop-webview dev -- --host 127.0.0.1 --port 1420`；未启动 dev server 时只会显示 `Could not connect to 127.0.0.1` |
| tray 限制 | Xvfb/openbox 能看到 Tauri tray icon X window，但没有真实桌面 panel / appindicator 菜单交互；Linux 物理 tray menu click 仍需有真实 DE 的机器补测 |
| macOS 限制 | 本轮无 macOS 机器，不声明 menu bar 真实通过 |

证据目录：

- 主证据：`docs/workhub/05-clients/assets/audit/2026-06-11-cuu-r3-linux-tray-smoke/mycyg-xvfb-openbox-hardgate/`
- 诊断证据：`docs/workhub/05-clients/assets/audit/2026-06-11-cuu-r3-linux-tray-smoke/mycyg-xvfb-openbox-smoke/`
- 诊断证据：`docs/workhub/05-clients/assets/audit/2026-06-11-cuu-r3-linux-tray-smoke/mycyg-xvfb-openbox-devserver-smoke/`

复跑入口：

```bash
WORKHUB_LINUX_SMOKE_OUT_DIR=/tmp/workhub-cuu-tauri-linux-smoke \
WORKHUB_LINUX_SMOKE_WAIT_SECONDS=22 \
bash scripts/qa/cuu-tauri-linux-smoke.sh
```

## 9. 后续计划

1. R3.22：按用户截图继续扩大文本边界门，覆盖 permission/offline/main notice/desktop Cuu card 的纵向高度与滚动边界；详见 `r3-22-text-overflow-permission-offline-qa-plan-2026-06-11.md`。
2. Linux 真机 DE：找带 GNOME/KDE/Xfce panel 的 Linux 桌面会话，补 appindicator/tray menu 真实点击恢复，不用 Xvfb 结果替代。
3. macOS：补 menu bar item、截图权限、Accessibility 权限、透明 window 的真实 capture 策略；有机器后再跑实证。
4. R4：继续补主窗全页面 zh/en、四态、mobile-narrow 视觉审查，避免 R3 Cuu 证据掩盖 R0/R4 主窗缺口。
