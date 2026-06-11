---
module: R4-settings-locale-device-boundary-hardening
layer: C-WEB / C-UI / C-API / C-PET boundary / QA
status: planned
owner: workflow
date: 2026-06-11
visuals:
  - ../05-clients/assets/web/web-operations-pages-atlas.png
  - ../05-clients/assets/desktop/desktop-support-pages-atlas.png
  - ../05-clients/assets/desktop/desktop-device-setup-update.png
depends_on:
  - r4-14-option-intake-knowledge-route-componentization-plan-2026-06-11.md
  - ../05-clients/web-app.md
  - ../05-clients/desktop-pet-tauri.md
  - ../05-clients/i18n-user-locale-preference-p1-3.md
  - ../05-clients/pet-settings-recovery-p1-5.md
---

# R4.15 Settings / Locale / Device Boundary Hardening Plan

## 1. 开工前必读

- [`r4-14-option-intake-knowledge-route-componentization-plan-2026-06-11.md`](./r4-14-option-intake-knowledge-route-componentization-plan-2026-06-11.md)
- [`web-app.md`](../05-clients/web-app.md)
- [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)
- [`i18n-locale-contract-p1-1.md`](../05-clients/i18n-locale-contract-p1-1.md)
- [`i18n-user-locale-preference-p1-3.md`](../05-clients/i18n-user-locale-preference-p1-3.md)
- [`pet-settings-recovery-p1-5.md`](../05-clients/pet-settings-recovery-p1-5.md)
- 概念图：`web-operations-pages-atlas.png`、`desktop-support-pages-atlas.png`、`desktop-device-setup-update.png`

## 2. 背景

R4.10-R4.14 已把 Web ready routes、action notice、Proposal advanced、Option Intake 与 Knowledge fallback 收敛进 active-only product shell。Settings 现在已有 typed Page VM 和桌面恢复入口，但语言偏好、运行时配置状态、桌面能力门、route-state recovery 和 Web/C-PET 边界还散在多个面。R4.15 要把这些边界硬化成可审计、可截图、双语一致的 Settings / Device control slice。

## 3. 目标

| Area | R4.15 目标 | 必守边界 |
|---|---|---|
| Locale persistence | `workhub.locale`、`PATCH /api/auth/preferences`、Page VM `meta.locale` 与 Web active locale 一致 | 不把用户/证据/LLM 原文硬翻译 |
| Settings route | Settings route component 展示 runtime、LLM configured status、language、device boundary、recovery action 的真实状态 | 不泄露 API key、base URL、token 或本地路径 |
| Device boundary | Web 中所有 desktop-only actions 都走 `desktop_required` / recovery notice，明确“浏览器不能执行本地能力” | 不在 Web 主窗执行接活、同步、托盘、通知恢复等本地动作 |
| Route recovery | forbidden/error/desktop-required/retry/request-access 文案和 action href 统一 | 不假装权限恢复成功 |
| QA | Browser smoke 覆盖 settings zh/en、locale reload、desktop gate、route-state recovery、mobile no-overflow、secret scan | 不降低 R4.10-R4.14 regression gates |

## 4. 数据流

```mermaid
flowchart LR
  A["Web locale toggle"] --> B["PATCH /api/auth/preferences"]
  B --> C["GET /api/pages/settings?locale"]
  C --> D["Settings route component"]
  D --> E["desktop_required notice"]
  D --> F["route-state recovery actions"]
  G["desktop pet settings docs"] --> D
```

## 5. 实施步骤

1. 复读本计划、R4.14 竣工记录、Web/desktop/i18n/settings 文档与三张概念图。
2. 审查 `SettingsPageVM` 是否覆盖 locale preference、supported locales、runtime health、LLM configured status、device boundary 与 recovery href。
3. 扩展 Settings route component 的 marker：locale source、preference sync state、desktop capability gate、secret-safe config status。
4. 扩展 browser dispatcher：desktop-only action、locale persistence failure、settings restore/retry 均走统一 notice；失败不发本地动作。
5. 扩展 API/client tests：Settings Page VM 不能返回 secret-like fields；locale preference patch 后 Page VM locale 一致。
6. 扩展 `qa:r4-web-live-route-interaction`：Settings zh/en、locale toggle after settings reload、desktop gate mobile/desktop、forbidden/request access、unknown retry、no overflow。
7. 更新 `web-app.md`、`page-concepts.md`、roadmap、详细计划、README，并制定 R4.16 后续计划。

## 6. QA Gate

必须全部通过：

- `pnpm --filter @workhub/ui test`
- `pnpm --filter @workhub/web test`
- `pnpm --filter @workhub/api-client test`
- `pnpm typecheck`
- `pnpm qa:r4-web-live-route-interaction` with R4.15 env
- `pnpm test`
- `git diff --check`
- no `reference` or `references` directories, and no secret scan matches

建议新增 browser gates：

- `r4_15_settings_locale_persistence=true`
- `r4_15_settings_secret_safe=true`
- `r4_15_desktop_boundary_gate=true`
- `r4_15_route_recovery_actions=true`
- `r4_15_settings_mobile_no_overflow=true`
- `r4_14_intake_knowledge_regression=true`

## 7. PRD / 概念图验收口径

- `web-operations-pages-atlas.png`：Settings 是严肃管理页的一部分，不做营销页、不做装饰页。
- `desktop-support-pages-atlas.png`：桌面支持能力属于 C-PET / Rust shell，Web 只显示状态和恢复入口。
- `desktop-device-setup-update.png`：Web 主窗不能承载 Cuu 外观配置；桌宠形象和本地能力继续留在独立桌宠/桌面客户端边界内。

## 8. 后续候选

R4.15 通过后进入 R4.16：真实 React route tree migration / route component hydration boundary。目标是在保持当前 typed Page VM、active-only shell、QA gates 的前提下，把 HTML render helpers 逐步迁移到可复用前端组件结构。
