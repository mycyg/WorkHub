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
