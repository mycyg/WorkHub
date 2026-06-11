---
module: 06-roadmap
layer: R4 / C-PET / Rust shell i18n
status: current
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/desktop/desktop-rust-shell-gap-roadmap.png
  - ../05-clients/assets/desktop/desktop-one-thing-work-desk.png
  - ../05-clients/assets/cuu/cuu-desktop-approval-search.png
  - ../05-clients/assets/cuu/cuu-option-first-clarify.png
evidence:
  - ../05-clients/assets/audit/2026-06-11-r4-rust-system-i18n/rust-system-i18n-report.json
---

# R4.6 Rust System-String I18n

## 1. 开工阅读

本轮开工前已复读：

- [`r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md`](./r4-05-web-live-route-interaction-smoke-plan-2026-06-11.md)
- [`recovery-r0-r4-roadmap-2026-06-08.md`](./recovery-r0-r4-roadmap-2026-06-08.md)
- [`review-driven-r0-r4-detailed-construction-plan-2026-06-08.md`](./review-driven-r0-r4-detailed-construction-plan-2026-06-08.md) 的 R4 段落
- [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)
- [`../05-clients/i18n-locale-contract-p1-1.md`](../05-clients/i18n-locale-contract-p1-1.md)
- [`../05-clients/pet-right-click-settings-menu-p1-4.md`](../05-clients/pet-right-click-settings-menu-p1-4.md)
- [`../05-clients/pet-settings-recovery-p1-5.md`](../05-clients/pet-settings-recovery-p1-5.md)
- 概念图：`desktop-rust-shell-gap-roadmap.png`、`desktop-one-thing-work-desk.png`、`cuu-desktop-approval-search.png`、`cuu-option-first-clarify.png`

并行子 agent 只读审查补充了 R4.6 风险清单：tray/menu、tooltip、notification fallback、deep-link/single-instance diagnostics 都是系统或 QA 可见字符串；动态 payload、raw URL、route、ID、WorkHub/Cuu 品牌名不能客户端硬翻译。

## 2. 本轮范围

R4.6 是 Rust shell 系统串 i18n，不是新桌宠外观或完整跨平台实机菜单验收：

1. 新增 `client-tauri/src-tauri/src/locale.rs`：
   - 定义 Rust 侧 `WorkHubLocale`，序列化值与 TS contract 一致：`zh-CN` / `en-US`。
   - `normalize_workhub_locale()` 与 TS 规则对齐：`en* -> en-US`、`zh* -> zh-CN`、未知回退 `zh-CN`。
   - 新增 `WORKHUB_LOCALE` 作为 Rust shell 系统串入口。
2. 扩展 `WorkHubShellConfig.locale`：
   - `workhub-shell-config.json.locale` 和 `WORKHUB_LOCALE` 都可设置系统层 locale。
   - Tauri `setup` 早期加载 shell config，再安装 tray 和启动 SSE worker，避免 tray/notification 拿不到 locale。
3. Tray/menu 本地化：
   - `tray_menu_items(locale)`、`tray_menu_action_plan_by_id_for_locale()`、`tray_tooltip(locale)`。
   - 中英文 menu label 覆盖 open/hide main、show/hide Cuu、restore interaction、inbox、settings、quit。
   - action ID、window control、route、focus 合同保持不变。
4. System notification fallback 本地化：
   - `system_notification_plan_from_push_payload_for_locale(payload, locale)`。
   - 仅 fallback title/body 本地化；payload 里的 `title`、`body`、`summary_text`、`message`、`preview_text` 保持原文。
   - SSE worker 通过 `config.locale` 把 locale 传入 notification planner。
5. Deep-link / single-instance diagnostics 本地化：
   - `describe_deep_link_error(error, locale)` 只翻译错误类型描述。
   - raw URL、unsafe target、scheme、route、ID 继续原样保留，方便审计和排查。
6. 新增 `pnpm qa:r4-rust-system-i18n` 并接入根 `pnpm lint` / `pnpm verify`。

## 3. 验收证据

证据目录：

`docs/workhub/05-clients/assets/audit/2026-06-11-r4-rust-system-i18n/`

通过的 gate：

- `cargo_tests_passed=true`
- `locale_contract_has_two_values=true`
- `shell_config_consumes_locale=true`
- `tray_labels_and_tooltip_bilingual=true`
- `main_installs_tray_with_shell_locale=true`
- `notification_fallbacks_bilingual=true`
- `dynamic_notification_payload_preserved=true`
- `sse_worker_passes_locale_to_notification_plan=true`
- `deep_link_diagnostics_bilingual=true`
- `single_instance_rejections_bilingual=true`

验证命令：

```powershell
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
corepack pnpm qa:r4-rust-system-i18n
```

## 4. PRD / 概念图一致性审查

符合：

- Rust shell 仍只负责窗口、托盘、通知、deep-link、SSE worker 和本地系统能力；没有把业务状态机或 AI DTO 移入 Rust。
- Cuu 仍只在独立 pet window 出现；本轮没有把 Cuu 本体、模型预览或角色设置页放回主窗。
- `desktop-rust-shell-gap-roadmap.png` 里的 tray menu、system notifications、deep-link handler 进入了同一 locale contract。
- `desktop-one-thing-work-desk.png` 的系统状态/通知方向被落实为系统层短文案，不扩展成新的装饰 UI。
- 中英双语只覆盖固定系统串；动态任务标题、LLM 摘要、证据摘录和 raw deep-link 诊断值保留原文。

不能宣称：

- 不能宣称 Windows / Linux / macOS 原生菜单视觉截图都已重录。
- 不能宣称 WebView localStorage 的 runtime locale 会热更新 OS tray label；当前 Rust shell locale 来自 config/env，菜单安装时确定。
- 不能宣称服务端动态 VM 内容已经多语言生成。

## 5. Bug / Dataflow 审查

- Bug 审查：原 `tray.rs` 和 `notify.rs` 的英文硬编码已迁移到 locale-aware helper；R4.6 QA 会阻止回退到单语系统串。
- 数据流审查：`WorkHubShellConfig.locale -> install_workhub_tray()` 控制原生 tray；`WorkHubShellConfig.locale -> spawn_default_shell_sse_workers() -> system_notification_plan_from_push_payload_for_locale()` 控制通知 fallback。
- 诊断审查：deep-link / single-instance 只本地化错误前缀，保留原始目标值；不会隐藏安全审计线索。
- 动态内容审查：notification payload text 原样保留；英文模式下看到中文任务标题不是失败，英文模式下出现中文固定系统 fallback 才是失败。
- 安全审查：未引入 provider key 或远端凭据；新增 QA report 只记录 cargo/test gate，不写入用户提供的测试密钥。

## 6. 后续详细计划

2026-06-11 后续已补：

1. R4.7 真实 API daemon + deterministic PG seed browser smoke；远端 Linux `192.168.5.53` 已用 PostgreSQL 18.4 + Chrome 跑通 `pnpm qa:r4-web-live-api-pg-seed`，详见 [`r4-07-web-live-api-pg-seed-smoke-2026-06-11.md`](./r4-07-web-live-api-pg-seed-smoke-2026-06-11.md)。
2. R4.8 真实 Redis/SSE production browser smoke；远端 Linux 已补 Redis 8.0.5，双 API worker + Chrome EventSource 15 步通过，详见 [`r4-08-redis-sse-production-browser-smoke-2026-06-11.md`](./r4-08-redis-sse-production-browser-smoke-2026-06-11.md)。

下一刀进入 R4.9：动态双语 Page VM 与 shell 指标一致性。

1. 开工前复读 `web-app.md`、`page-concepts.md`、`api-contract.md`、R4.7/R4.8 计划和 Web 概念图。
2. 让 Home / WorkItem / Proposal / Replay / Cost 的固定摘要、状态、metric title/value 可按 `locale` 输出。
3. 修正 Replay 等页面顶部 metric 与正文内容不一致的问题。
4. 继续保留 endpoint-first Page VM proof、Redis/SSE topic auth、REST reconcile、path nav/back/forward、locale query/meta、no Cuu/no Kanban/no old shell、text box overflow 与 horizontal overflow hard gate。
