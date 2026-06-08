---
module: 05-clients
layer: C-WEB / C-DESKTOP / C-PET / Auth / DB
status: current
owner: workflow
date: 2026-06-08
---

# P1.3 User Locale Preference

> 当前口径：WorkHub 只支持 `zh-CN` / `en-US`。P1.3 把语言切换从本地按钮推进为用户偏好合同：Web、desktop 主窗和独立 Cuu pet window 共享同一个 locale 结果。

## 1. 本轮已落

| 层 | 落点 | 说明 |
|---|---|---|
| Contract | `packages/contracts/src/locale.ts` | 新增 `workHubLocaleInputSchema`，接收 `en` / `zh` 等输入并归一为产品双语枚举 |
| Auth contract | `packages/contracts/src/auth.ts` | 新增 `UserPreferences`、`UpdateUserPreferencesRequest`；`IdentifyResponse` 带 `locale` 与 `preferences.locale` |
| DB schema | `packages/db/src/schema/core.ts` | `users.preferred_locale`，默认 `zh-CN` |
| Migration | `packages/db/migrations/0001_elite_morlun.sql` | `ALTER TABLE users ADD COLUMN preferred_locale varchar(16) DEFAULT 'zh-CN' NOT NULL` |
| Repository | `packages/db/src/repositories/users.ts` | `updatePreferredLocale(userId, locale)` |
| API | `apps/api/src/routes/auth.ts` | `PATCH /api/auth/preferences` 保存当前用户语言偏好 |
| API client | `packages/api-client/src/client.ts` / `types.ts` | `client.updatePreferences({ locale })` typed method |
| Web boot | `apps/web/src/browser.ts` | 启动时优先同步 `/api/auth/me` 的服务端 locale；切换语言时 PATCH 保存并 reload |
| Desktop boot | `apps/desktop-webview/src/browser.ts` | 与 Web 同逻辑；写回 `workhub.locale` 供独立 pet window 读取 |

## 2. Contract Shape

```ts
type UserPreferences = {
  locale: "zh-CN" | "en-US";
};

type UpdateUserPreferencesRequest = {
  locale: "zh-CN" | "en-US";
};
```

`IdentifyResponse` / `MeResponse` 保留身份字段，同时新增：

```ts
{
  locale: "zh-CN",
  preferences: {
    locale: "zh-CN"
  }
}
```

`locale` 是快捷字段，`preferences.locale` 是后续设置页扩展入口。两者必须一致。

## 3. Startup Rule

启动顺序：

1. 先用 `localStorage["workhub.locale"]` 或 `navigator.language` 得到首屏 fallback。
2. 创建 API client 后请求 `/api/auth/me`。
3. 如果用户已登录且返回 `preferences.locale`，以服务端为准。
4. 把最终 locale 写回 `localStorage["workhub.locale"]`。
5. Web / desktop 主窗用该 locale 请求 Page VM；Cuu pet window 从同一个 localStorage 读取。

这保证了：

- 已登录用户跨设备语言一致。
- 未登录 preview 仍能按浏览器语言启动。
- 独立 Cuu pet 不需要自己发 auth 请求，也能跟随主窗语言。

## 4. Boundaries

本轮只翻译固定 UI 文案，不翻译用户内容和 LLM 内容：

- 用户任务标题、文件名、proposal summary、证据摘录保持原文。
- 页面 chrome、按钮、状态标签、Cuu 气泡固定文案必须跟随 locale。
- Cuu 形象选择仍只允许黑猫 / 白猫，locale 不影响模型包。
- Web / desktop 主窗仍不显示 Cuu 本体。

## 5. Tests

已验证：

```powershell
pnpm --filter @workhub/contracts test
pnpm --filter @workhub/api-client test
pnpm --filter @workhub/db build
pnpm --filter @workhub/api test
pnpm --filter @workhub/web test
pnpm --filter @workhub/web build
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/desktop-webview build
```

新增覆盖点：

- locale input schema 把 `en` 归一为 `en-US`。
- `/api/auth/preferences` PATCH 后 `/api/auth/me` 返回 `en-US`。
- API client 有 typed `updatePreferences()`。
- Web / desktop build 验证 browser boot 代码可打包。

## 6. 下一步

P1.4 不再只做抽象 locale 截图，应和 Cuu 桌宠设置入口合并推进：

| 下一模块 | 工作 | 验收 |
|---|---|---|
| Pet right-click settings | **已落**：独立 `pet` window 右键紧凑菜单支持黑猫/白猫、中文/EN、悬停避让、打开设置、隐藏 Cuu；详情见 [`pet-right-click-settings-menu-p1-4.md`](./pet-right-click-settings-menu-p1-4.md) | 待补 zh-CN/en-US DOM dump 或截图；菜单不造成 Cuu 位移或 iframe 重建 |
| Tray settings deep-link | 托盘增加“设置 / Settings”，打开 `/settings` | Rust tests + desktop bridge smoke |
| Pet settings recovery | **已落**：desktop 主窗 `/settings` 嵌入严肃恢复面板，支持 pass-through / hide-on-hover / show-hide / restore；详情见 [`pet-settings-recovery-p1-5.md`](./pet-settings-recovery-p1-5.md) | 待补 zh-CN/en-US 主窗截图和 pass-through 真实恢复录屏 |
| Locale visual regression | Web 主窗、desktop 主窗、Cuu pet card 各生成中英截图 | 固定按钮/标签不残留错误语言；主窗无 Cuu 本体 |
| Server multilingual VM | Agent / daemon 生成新任务 summary 时接 locale | 英文新任务的服务端摘要可生成英文；历史中文内容保持原文 |
