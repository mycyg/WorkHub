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
- `docs/workhub/03-design/page-concepts/`

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
