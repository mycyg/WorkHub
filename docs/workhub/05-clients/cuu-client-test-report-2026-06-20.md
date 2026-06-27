# CUU UI 与客户端补测报告 2026-06-20

## 结论

本轮按用户追加要求补测 CUU UI 和客户端本体。CUU 行为链路、pet UI 溢出截图、`@workhub/cuu` 逻辑包、desktop webview、Tauri Rust 壳、Tauri CLI debug build 和 macOS `.app` bundle 均通过。

补齐的缺失组件：

- `tauri-cli 2.11.3`，通过 `cargo tauri --version` 验证可用。

## CUU 行为链路

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `pnpm qa:cuu-r3-launcher-smoke` | PASS | Cuu body 触发 option-first launcher，clarification，confirmation，WorkItem，AgentRun |
| `pnpm qa:cuu-r3-dev-server-smoke` | PASS | typed API client 走真实本机 HTTP server，client-token auth，health route |
| `pnpm qa:cuu-r3-run-stream-smoke` | PASS | fetch SSE 收到 `agent_run.step` done event，最终 run status `succeeded` |
| `pnpm qa:cuu-r3-run-failure-smoke` | PASS | 失败运行通过 REST fallback 映射 worried/replay 卡片，最终 status `failed` |
| `pnpm qa:cuu-r3-reload-restore-smoke` | PASS | reload 后恢复 session question、active run、terminal run |
| `pnpm qa:cuu-r3-error-fault-smoke` | PASS | 401/403/offline/502 映射到 permission/worried/offline 卡片，并保留 `view_replay` 主动作 |

关键断言：

- launcher 输入为 `single_choice`。
- `option_first=true`。
- `free_text_enabled=false`。
- run stream 使用 `client-token-fetch-sse`。
- error fault 四类 case 均不会生成死路卡片。

## CUU UI 视觉

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm qa:cuu-pet-run-card-overflow` | PASS | `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/failed-run-card.png` |

视觉 gate：

| Gate | 结果 |
| --- | --- |
| `bubble_no_horizontal_overflow` | PASS |
| `bubble_no_vertical_overflow` | PASS |
| `no_text_clipped_by_bubble` | PASS |
| `surface_no_horizontal_overflow` | PASS |
| `surface_no_vertical_overflow` | PASS |
| `status_suppressed_for_failed_trace` | PASS |
| `budget_visible_with_padding` | PASS |
| `bubble_clear_of_live2d` | PASS |

本轮重新生成的视觉证据：

- `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/failed-run-card.html`
- `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/failed-run-card.png`
- `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/run-card-overflow-report.json`
- `docs/workhub/05-clients/assets/audit/2026-06-11-cuu-run-card-overflow-regression/smoke-summary.md`

## 客户端测试

| 命令 | 结果 | 覆盖 |
| --- | --- | --- |
| `pnpm --filter @workhub/cuu test` | PASS, 37 tests | Cuu cards、motion hints、controller、idle scheduler、model pack whitelist、behavior manifest |
| `pnpm --filter @workhub/desktop-webview test` | PASS, 106 tests | Live2D runtime、pet settings、Cuu action pipeline、launcher flow、run stream、右键菜单、restore、desktop shell bridge |
| `pnpm --filter @workhub/desktop-webview build` | PASS | Tauri webview 前端构建，包含 `index.html`、`pet.html` 和 bundled assets |
| `cargo test --manifest-path client-tauri/src-tauri/Cargo.toml` | PASS, 90 tests | config、deep link、SSE、notifications、pet commands、tray、window controls、scaffold |
| `cargo build --manifest-path client-tauri/src-tauri/Cargo.toml` | PASS | Tauri native shell dev profile 编译 |
| `cargo tauri build --debug --no-bundle --ci` | PASS | 执行 Tauri `beforeBuildCommand`，构建 desktop webview 并产出 debug native binary |
| `cargo tauri build --debug --bundles app --no-sign --ci` | PASS | 生成 macOS `.app` bundle，跳过本地签名 |

## Tauri 产物

| 产物 | 路径 |
| --- | --- |
| Debug binary | `client-tauri/src-tauri/target/debug/workhub-client-tauri` |
| macOS app bundle | `client-tauri/src-tauri/target/debug/bundle/macos/WorkHub.app` |

## 判断

CUU UI 和客户端不是只靠单元测试声明通过：本轮同时覆盖了 Cuu 专用 smoke、真实本机 HTTP/SSE、pet UI 截图 gate、desktop webview build/test、Tauri Rust test/build，以及完整 Tauri debug build + macOS app bundle。当前没有发现新的 CUU UI 或客户端阻断问题。
