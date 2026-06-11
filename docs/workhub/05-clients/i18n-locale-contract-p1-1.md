---
module: 05-clients
layer: C-WEB / C-PET / Cuu / Contracts
status: current
owner: workflow
date: 2026-06-08
---

# P1.1 Locale Contract Propagation

> 当前口径：WorkHub 只承诺 `zh-CN` / `en-US` 两种语言。语言切换必须轻，不阻塞 AI-first 主路径；Cuu 只存在于独立桌宠窗口，Web 和 desktop 主窗保持严肃工作界面。

## 1. 本轮目标

P1.0 只把 Gold Path shell 的固定文案做成双语。P1.1 把语言从“某个 UI 文件里的偏好”推进成跨端合同：

- `packages/contracts` 拥有 `WorkHubLocale`、默认语言、storage key 与 normalize 规则。
- `GET /api/pages/*` 可以接 `locale` query，并在 `meta.locale` 回显最终语言。
- `packages/api-client` 的 typed page client 可以显式传 locale。
- Web / desktop webview 加载 Page VM 时带上当前 locale。
- Cuu card adapter、desktop shell bridge、独立 pet 轻气泡固定文案按 locale 渲染。
- 动态用户内容、LLM 摘要、任务标题、证据摘录、proposal manifest 原样保留，不在客户端假翻译。

## 2. Target TS paths

| 层 | Target paths | 当前职责 |
|---|---|---|
| Shared contract | `packages/contracts/src/locale.ts`、`packages/contracts/src/index.ts` | `WorkHubLocale`、`workHubLocales`、`defaultWorkHubLocale`、`workHubLocaleStorageKey`、`normalizeWorkHubLocale()` |
| UI i18n | `packages/ui/src/gold-path/i18n.ts` | 复用 contracts locale，继续提供 `goldPathT(locale,key)` |
| API route | `apps/api/src/routes/pages.ts` | 读取 `?locale=` 或 `Accept-Language`，Page envelope 回 `meta.locale` |
| API client | `packages/api-client/src/types.ts`、`packages/api-client/src/client.ts` | `PageRequestOptions.locale`，为 `pages.goldPath/workItem/proposal/attention/approvals/cost` 拼 query |
| Web entry | `apps/web/src/browser.ts`、`apps/web/src/main.ts` | 从 `workhub.locale` / navigator 得到 locale，Page VM 请求带 locale |
| Desktop webview entry | `apps/desktop-webview/src/browser.ts`、`apps/desktop-webview/src/main.ts` | 同 Web；桌面 helper 创建 Cuu card 时可传 locale |
| Cuu fixed copy | `packages/cuu/src/i18n.ts`、`packages/cuu/src/cards.ts` | 业务卡片的标题、action label、fallback message、budget/cost/replay 固定标签双语 |
| Pet surface | `apps/desktop-webview/src/pet-surface.ts` | 独立桌宠轻气泡 kind/priority/evidence/input hint/action 状态双语 |
| Shell bridge/runtime | `apps/desktop-webview/src/shell-events.ts`、`apps/desktop-webview/src/desktop-cuu-runtime.ts` | SSE 状态、OS/Rust push card、审批/证据动作结果双语 |
| Rust shell system strings | `client-tauri/src-tauri/src/locale.rs`、`tray.rs`、`notify.rs`、`deep_link.rs`、`single_instance.rs` | R4.6 起 tray/menu/tooltip、system notification fallback、deep-link/single-instance diagnostics 双语；动态 payload/raw URL/ID 保持原文 |

## 3. Locale contract

```ts
type WorkHubLocale = "zh-CN" | "en-US";

const workHubLocaleStorageKey = "workhub.locale";
const defaultWorkHubLocale = "zh-CN";
```

Normalize 规则：

- `zh`、`zh-CN`、`zh-Hans`、`zh-SG` 归一为 `zh-CN`。
- `en`、`en-US`、`en-GB`、`en-SG` 归一为 `en-US`。
- 空值、未知值、数组首项未知值回退 `zh-CN`。

原因：用户在中文环境启动时默认中文；英文环境可以从 navigator 或 `Accept-Language` 进入英文。所有端只允许这两种结果，避免词表无限扩散。

## 4. API / Page VM contract

所有 Page VM route 接受同一语言入口：

```http
GET /api/pages/gold-path?locale=en-US
GET /api/pages/workitems/:id?locale=zh-CN
GET /api/pages/proposals/:id?locale=en-US
GET /api/pages/cost?locale=en-US
```

响应 envelope 必须回显最终 normalized locale：

```ts
type PageEnvelope<T> = {
  ok: true;
  data: T;
  meta: {
    locale: WorkHubLocale;
  };
};
```

失败态不因为 locale 变化改变 `ApiErr.code`。预算拒绝仍统一使用 `budget_exhausted`，审批、权限、未找到仍保持原错误码。

## 5. Page / Cuu alignment

| 页面或入口 | 当前 locale 行为 | 仍未完成 |
|---|---|---|
| Gold Path Home / Approval / Proposal / Replay / Cost | 静态 chrome、按钮、导航、预算/成本固定标签双语；请求带 locale | Page VM 内的任务标题、proposal manifest、证据摘录仍由 daemon 原文决定 |
| Web typed helpers | `loadWebGoldPathSurface(client, locale)` 带 locale | `renderWebIntakeSession`、`renderWebWorkItemDetail`、`renderWebProposalDetail`、`renderWebAgentRunLive` 的非 Gold Path 固定文案仍需抽词表 |
| Desktop main webview | 与 Web 同源；主窗不展示 Cuu 形象 | 真实 React routes 迁移后要复用同一 locale contract |
| Desktop pet Cuu | 轻气泡 kind、priority、证据标题、按钮、动作结果、离线状态双语 | Live2D 动作截图要补中英两套 card fixture |
| Cuu card adapters | 预算、成本、replay、approval、run fallback、event fallback 双语 | 动态 event summary 不翻译；需要服务端生成多语言摘要时再改 Page VM/Agent 输出 |

## 6. 动态内容边界

不做客户端硬翻译：

- 用户输入的任务标题、说明、打回原因。
- LLM 生成的 proposal title、summary、risk note。
- 文件名、证据摘录、会议纪要、网盘评论。
- 事件里传来的 `preview_text` / `data.summary`。

客户端只翻译：

- 页面固定 chrome。
- action label。
- fallback / empty / error / offline 文案。
- card kind / priority / state 标签。
- Cuu 对用户动作的短反馈。
- Rust shell 的固定系统串：tray label/tooltip、notification fallback、deep-link/single-instance 错误类型描述。

这条是验收护栏：英文模式下如果看到中文任务标题，不算双语失败；如果看到中文按钮、状态、空态、固定 action label，则算失败。

## 6.1 R4.6 Rust shell locale contract

R4.6 已把系统层固定文案接入同一双语合同：

| Rust 落点 | Locale 来源 | 翻译范围 | 不翻译范围 |
|---|---|---|---|
| `WorkHubShellConfig.locale` | `workhub-shell-config.json.locale` 或 `WORKHUB_LOCALE` | shell 安装时的系统层固定文案 | WebView `localStorage` runtime 热切换暂不反向刷新 OS tray |
| `tray.rs` | `WorkHubLocale` | menu label、tooltip | action id、route、window label、focus contract |
| `notify.rs` | SSE worker 传入 `config.locale` | fallback title/body | payload `title/body/summary_text/message/preview_text` |
| `deep_link.rs` / `single_instance.rs` | 当前 shell locale | error type description | raw URL、unsafe target、scheme、route、ID |

验证：

```powershell
cargo test --manifest-path client-tauri\src-tauri\Cargo.toml
pnpm qa:r4-rust-system-i18n
```

## 7. Tests / gates

本轮合同测试：

- `@workhub/contracts`：locale normalize 合同。
- `@workhub/api-client`：typed page request 拼 locale query。
- `@workhub/api`：Page route 回 `meta.locale`，非法 locale 回退 `zh-CN`。
- `@workhub/ui`：Gold Path static chrome 继续双语。
- `@workhub/web`：Web loader 带 locale。
- `@workhub/desktop-webview`：pet surface、shell bridge、desktop Cuu runtime 固定文案双语。
- `@workhub/cuu`：Cuu card adapter 固定文案双语，同时保留动态摘要原文。

施工验收还必须跑：

```powershell
pnpm --filter @workhub/contracts test
pnpm --filter @workhub/api-client test
pnpm --filter @workhub/api test
pnpm --filter @workhub/ui test
pnpm --filter @workhub/web test
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/cuu test
git diff --check
```

## 8. 后续计划

| 阶段 | 工作 | 验收 |
|---|---|---|
| P1.2 Non-GoldPath render helpers | **已落**：`packages/ui/src/intake/*`、`workitem/*`、`proposal/*`、`agent-run/*` 抽固定文案词表，Web/desktop facade 可传 locale | 英文模式下非 Gold Path helper 的固定 label 不残留中文；详情见 [`i18n-nongoldpath-render-helpers-p1-2.md`](./i18n-nongoldpath-render-helpers-p1-2.md) |
| P1.3 User locale preference | **已落**：`users.preferred_locale`、`UserPreferences`、`PATCH /api/auth/preferences`、Web/desktop 启动同步服务端 locale；详情见 [`i18n-user-locale-preference-p1-3.md`](./i18n-user-locale-preference-p1-3.md) | Web、desktop 主窗、pet 三端共享 `workhub.locale`，已登录用户以服务端偏好为准 |
| P1.4 Visual regression | Web + desktop main + pet card fixture 做中英截图，检查文本不溢出、不遮挡 Cuu | 中英两套 screenshot / DOM dump 进入审计文档 |
| P1.5 Server-generated multilingual VM | Agent / daemon 在生成 summary、proposal、evidence digest 时接 `locale`，明确哪些内容可双语生成、哪些保持用户原文 | 英文新任务的 proposal summary 可由服务端生成英文，历史中文内容仍保留原文 |
| P1.6 OpenAPI contract | `openapi.json` 写入 `locale` query 与 response `meta.locale` | client codegen 不丢 locale 字段 |

## 9. 与 Cuu 二选项的关系

本轮不恢复任何失败视觉路线。Cuu 仍只允许：

- `cuu-hijiki-live2d-cubism2` 黑猫。
- `cuu-tororo-live2d-cubism2` 白猫。

Locale 只影响 Cuu 气泡文字、按钮和动作反馈，不影响模型包选择。Web / desktop 主窗不出现 Cuu 形象 DOM。
