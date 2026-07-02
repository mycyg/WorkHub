# R3.22 Text Overflow / Permission / Offline QA Plan

日期：2026-06-11

## 1. 开工前必读

R3.22 开工前必须重读：

- `docs/workhub/05-clients/cuu-r3-agent-entry.md`
- `docs/workhub/05-clients/desktop-pet-tauri.md`
- `docs/workhub/05-clients/cuu-tauri-business-motion-capture-p1-7.md`
- `docs/workhub/05-clients/pet-settings-recovery-p1-5.md`
- `docs/workhub/05-clients/prd-concept-reproduction-gap-audit.md`
- `docs/workhub/05-clients/page-concepts.md`
- 概念图：`assets/cuu/cuu-desktop-approval-search.png`、`assets/cuu/cuu-option-first-clarify.png`、`assets/shared/endpoint-page-cuu-alignment.png`

## 2. 问题来源

用户截图显示 Cuu run card 在小框内出现文本挤压风险：`This run needs attention`、`Run progress`、`Budget`、动作按钮和状态文案同时出现时，纵向内容容易超过视觉安全区。

R3.21 已把 card window 从 `520x640` 调整到 `520x720`，并让 bubble 与 Cuu 本体分离。但 R3.21 的 Linux devUrl smoke 因未启动 full daemon，最终捕获的是 API 502 runtime error card，不是完整 failed AgentRun 的 `Run progress/Budget` 卡。因此 R3.22 要补完整矩阵。

## 3. 施工范围

| 范围 | 必须覆盖 |
|---|---|
| failed AgentRun | zh-CN/en-US，含标题、message、`Run progress`、`Budget`、`View replay`、`Back to task` |
| run stream | queued/running/succeeded 的长标题、长 step excerpt、长 budget 数字 |
| permission | 401 / 403 中英错误卡，动作按钮、chip、长服务端 message 都不越框 |
| offline | stream offline / SSE retrying / daemon unreachable，主窗 notice 与 pet bubble 都不越框 |
| generic runtime error | 502 / network / unknown error 的 fallback 文案不撑破卡片 |
| main notice | `desktopCuuNoticeCss` 对主窗 Cuu notice 卡片也要有横向/纵向边界，而不只 pet bubble |

## 4. 验收门

| Gate | 要求 |
|---|---|
| horizontal overflow | `bubble.layout.horizontal_overflow=false`，`primary_action.layout.horizontal_overflow=false`，`overflow_offenders=[]` |
| vertical safety | pet bubble 允许内部滚动，但外框不得越出 `data_pet_window_height`；Cuu 本体不得被长卡遮住头部/正文 |
| fixed dimensions | card mode 必须保持 `data_pet_window_width=520`、`data_pet_window_height=720`；scale 75/100/125/150 都不能让按钮改尺寸挤破布局 |
| copy clamp | 标题、message、section line、action、chip 都必须有 `min-width:0`、`max-width:100%`、`overflow-wrap:anywhere` 或合理 clamp |
| bilingual | zh-CN/en-US 都要截图和 DOM report，不允许只用英文单测替代中文真实截图 |
| main/pet separation | 主窗严肃界面不显示 Cuu 本体；Cuu 只在独立 pet window |

## 5. 实施顺序

1. 增强 `cuu-qa-dom-report.ts`：补 bubble rect vs surface rect 的垂直安全字段，记录是否存在 `vertical_overflow` 或 Cuu overlap hint。
2. 增强 `pet-surface.test.ts`：为 failed AgentRun、permission、offline、generic runtime error 添加长文案 fixtures。
3. 增强 `desktop-cuu-runtime.test.ts`：主窗 notice card 的长标题/按钮/chip 样式必须锁住不越框。
4. 扩展 `scripts/qa/cuu-tauri-motion-capture.ps1` 的 `pet_card_text_overflow_gate`：除 run-failure/run-stream 外，把 permission/offline/generic error 纳入 gate。
5. 扩展 `scripts/qa/cuu-tauri-linux-smoke.sh`：增加 mock API/QA server 模式，让 Linux 也能捕获精确 failed AgentRun 卡，而不是只捕获 502 error card。
6. 重录最小证据：Windows 真实 Tauri failed/permission/offline；Linux Xvfb+openbox failed/generic；如有真实 Linux DE，再补 appindicator menu restore。
7. 文档复核：更新 `cuu-r3-agent-entry.md`、`desktop-pet-tauri.md`、R0-R4 roadmap 和本计划结果。

## 6. 必跑命令

```powershell
node_modules\.bin\tsc.CMD -p apps\desktop-webview\tsconfig.json --noEmit
node --import tsx --test apps/desktop-webview/src/pet-surface.test.ts apps/desktop-webview/src/cuu-qa-dom-report.test.ts apps/desktop-webview/src/desktop-cuu-runtime.test.ts
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
```

```bash
WORKHUB_LINUX_SMOKE_OUT_DIR=/tmp/workhub-cuu-tauri-linux-smoke \
WORKHUB_LINUX_SMOKE_WAIT_SECONDS=22 \
bash scripts/qa/cuu-tauri-linux-smoke.sh
```

如本地 `pnpm` 可用，再跑：

```powershell
corepack pnpm --filter @workhub/desktop-webview test
corepack pnpm --filter @workhub/desktop-webview build
corepack pnpm --filter @workhub/api qa:cuu-r3-error-fault-smoke
corepack pnpm --filter @workhub/api qa:cuu-r3-run-failure-smoke
```

## 7. 退出门

- 用户截图对应的 failed AgentRun 卡片在 zh-CN/en-US、Windows/Linux smoke 中均无文本越框。
- permission/offline/generic error 的 pet bubble 与 main notice 均有 DOM gate 和截图证据。
- Linux smoke 能稳定复跑；若无真实 DE，则明确“Xvfb/openbox 只能证明窗口和渲染，不能证明物理 tray menu click”。
- 不提交 `reference/`。
- 完成后提交并推送 main。

## 8. 2026-06-11 完成结果

R3.22 已完成核心文本/frame hardgate：

| 范围 | 完成情况 |
|---|---|
| failed AgentRun | Linux mock API smoke 生成真实 `This run needs attention` 卡，`Run progress`、`Budget`、`View replay`、`Back to task` 均在 frame 内 |
| run stream | PowerShell/Linux QA 场景继续纳入 gate；run API 场景进入 Linux smoke helper |
| permission | 401/403 fault smoke 继续覆盖，PowerShell motion capture gate 已把 permission 场景纳入统一文本/frame 检查 |
| offline | `stream-offline` 继续进入 API fault smoke 与 PowerShell/Linux run API 场景映射 |
| generic runtime error | 新增 `generic-runtime-error` QA scenario 与 API `generic-502` fault，Linux 截图证明 fallback card 无旧帧残影和文本越框 |
| main notice | `desktopCuuNoticeCss` 增加 overflow clamp，并用长 title/message/chip/action 单测覆盖 |
| DOM hardgate | `cuu-qa-dom-report.ts` 新增 `vertical_overflow` 与 `spatial_safety`；PowerShell/Linux gate 均会失败关闭横向/纵向 overflow、bubble 出 surface、bubble 遮住 Live2D、场景语义错卡 |

实现落点：

- `apps/desktop-webview/src/cuu-qa-dom-report.ts` / test：记录 surface、bubble、Live2D、primary action layout 与 `spatial_safety`。
- `apps/desktop-webview/src/pet-surface.ts` / test：`generic-runtime-error` 进入 run API flow，非 completion 卡最小高度稳定为 `268px * scale`。
- `apps/desktop-webview/src/desktop-cuu-runtime.ts` / test：主窗 notice 长文案、长 chip、长 action 不撑破卡。
- `apps/api/src/qa/*`：新增 `generic-502` fault 并进入 error-fault smoke。
- `client-tauri/src-tauri/src/main.rs`：Tauri QA scenario 白名单加入 `generic-runtime-error`。
- `scripts/qa/cuu-tauri-motion-capture.ps1`：文本 gate 扩展为空间安全 gate，且 permission/offline/generic 都可触发，bubble / primary action 的 `vertical_overflow` 也会失败关闭。
- `scripts/qa/cuu-tauri-linux-smoke.sh`：新增 mock API server、健康检查、run API 场景、DOM spatial safety 检查，并校验 run API 场景的 state、bubble kind、payload ref、primary action 与场景文案。

## 9. 验收证据

本轮已跑过：

```powershell
node_modules\.bin\tsc.CMD -p apps\desktop-webview\tsconfig.json --noEmit
corepack pnpm --filter @workhub/desktop-webview test
node_modules\.bin\tsc.CMD -p apps\api\tsconfig.json --noEmit
corepack pnpm --filter @workhub/api qa:cuu-r3-error-fault-smoke
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
```

结果：

- Desktop WebView package tests：83/83 通过。
- API error fault smoke：401、403、stream-offline、generic-502 均通过。
- Tauri Rust tests：66 + 9 + 3 通过。
- PowerShell QA 脚本解析通过。
- Linux `bash -n scripts/qa/cuu-tauri-linux-smoke.sh` 通过。

Linux 证据：

| 场景 | 证据目录 | 验收摘要 |
|---|---|---|
| failed AgentRun | `docs/workhub/05-clients/assets/audit/2026-06-11-r3-22-text-overflow/run-failure-linux-smoke/` | `status=ok`，`data_pet_window_height=720`，bubble/primary action 无横向 overflow，`Run progress` 与 `Budget` 存在，`bubble_overlaps_live2d=false`。2026-06-11 追加用户截图回归：QA gate 现在要求 `bubble_gap_to_live2d_px >= 8`，避免长卡贴住 Cuu 头部造成“文本越框感” |
| failed AgentRun 用户截图回归 | `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/` | `scripts/qa/cuu-pet-run-card-overflow-qa.ts` 直接用 Chrome 渲染截图中的英文失败运行卡，要求 bubble 无横向/纵向 overflow、失败 trace 不显示瞬时 `Cuu updated progress` 行、Budget 在气泡内且底部留白 `>=8px`、气泡到 Live2D `>=8px`。本轮实测 `budgetBottomClearance=11px`、`bubbleGapToLive2d=22.04px`、`statusVisible=false` |
| generic runtime error | `docs/workhub/05-clients/assets/audit/2026-06-11-r3-22-text-overflow/generic-runtime-error-linux-smoke/` | `status=ok`，`api_fault=generic-502`，bubble 高度稳定，未出现旧 failed card 残影，`spatial_safety` 通过 |

截图：

- `docs/workhub/05-clients/assets/audit/2026-06-11-r3-22-text-overflow/run-failure-linux-smoke/screen.png`
- `docs/workhub/05-clients/assets/audit/2026-06-11-r3-22-text-overflow/generic-runtime-error-linux-smoke/screen.png`
- `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/failed-run-card.png`

## 10. 未关闭边界

- 远程 Linux 当前是 `tty` + Xvfb/openbox，R3.22 不声明真实 GNOME/KDE/Xfce panel 的 appindicator 菜单点击通过。
- 本轮无 macOS 机器，不声明 macOS menu bar item、截图权限或 Accessibility 自动化通过。
- R3.22 解决 Cuu card / main notice 的文本与 frame 安全，不代表 Workbench、Approval、Proposal、Replay、Cost 等主窗产品页已完成最终视觉验收。
- Windows 真实截图矩阵沿用 R3.13/R3.20 的历史证据；R3.22 新增的是脚本 gate、单测、Linux mock API 精确复现与 DOM spatial safety。

## 11. 后续计划

后续详细计划已落盘：

- `docs/workhub/06-roadmap/r3-23-real-linux-tray-macos-menu-plan-2026-06-11.md`

R3.23 的开工目标是补真实 Linux DE tray/appindicator 与 macOS menu bar，而不是继续扩大 Cuu 文案矩阵；R3.22 的 `spatial_safety` 将作为跨平台 pet window 回归门复用。
