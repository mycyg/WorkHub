---
module: R5-onboarding-minimal
layer: C-WEB / P-IDENTITY / API / QA
status: completed
owner: workflow
date: 2026-06-12
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - r4-mid-review-upgrade-audit-2026-06-11.md
  - ../00-overview/personas-and-jtbd.md
  - ../01-architecture/security-and-permissions.md
---

# R5.9 Onboarding 最小闭环 Plan（S1 序列第一刀）

## 1. 开工前必读

- [`s1-pilot-readiness-roadmap-2026-06-12.md`](./s1-pilot-readiness-roadmap-2026-06-12.md) §2.2 G1：北极星序列的第一个差距。
- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md) **P1-6**：`apps/web/src/browser.ts` boot 遇 `not_identified` 自动 `identify({nickname:"P0.5 Reviewer"})`——demo 残留，多真实用户无法各自登入。
- [`../00-overview/personas-and-jtbd.md`](../00-overview/personas-and-jtbd.md) **PJ-1**：单条渐进式 onboarding（不分叉两套）。
- 代码锚点：`apps/api/src/routes/auth.ts:27`（identify + admin_secret 已支持多用户）、`packages/contracts/src/auth.ts` `identifyRequestSchema`、`apps/api/src/middleware/auth.ts`（signed cookie 会话）、`apps/web/qa/r4-web-live-route-interaction.ts`（mock identify 路径）。

## 2. 背景与目标

服务端身份能力已够用（昵称制 identify、admin secret 提权、signed cookie、设备门），缺的只是 **Web 端的真实注册交互**。R5.9 不造新身份系统，只把"自动假注册"换成"用户自报到"。

必须完成：

1. **注册屏**：未识别用户访问任何路由时，呈现注册卡（昵称必填 + locale 选择 + 可选"管理员密钥"折叠项），提交走现有 `POST /api/auth/identify`；成功后进入原目标路由。
2. **当前用户可见**：product shell 显示当前昵称；提供"切换用户/登出"动作（清 cookie → 回注册屏）。需要新增 `POST /api/auth/logout`（清 signed cookie，~10 行路由）。
3. **替换自动注册**：删除 boot 的 `identify({nickname:"P0.5 Reviewer"})` 兜底；`not_identified` 一律进注册屏（fail-closed）。
4. **QA 适配**：browser smoke 的 identify 改为"脚本化注册步骤"（真实走注册卡提交），新增注册屏四态与双语 gate；现有 66 步全部回归。
5. **双语**：注册卡固定文案 zh-CN/en-US，复用 locale 合同。

不做：

- 不做密码/OAuth/SSO/邮箱验证——LAN-first 信任模型不变（D-3，PJ-3 admin 也无设备门特例）；
- 不做技能自述/画像采集（FR-STAFF-001 留给 staffing 纵切）；
- 不动 desktop-webview/Cuu 的 identify 路径（桌宠轨独立演进）。

## 3. 数据流

```
未识别访问 /any-route
  -> not_identified (REST fail-closed)
  -> 注册屏（昵称 + locale + 可选 admin secret）
  -> POST /api/auth/identify -> signed cookie 会话
  -> 跳回原目标路由（保留 deep link）
登出 -> POST /api/auth/logout -> 清 cookie -> 注册屏
```

硬门：

- 任何 Page VM 数据不得在未识别状态下渲染（沿用现有 REST fail-closed）；
- admin secret 错误时注册仍成功但不提权（沿用 `auth.ts` 现行为），UI 提示"以普通用户进入"；
- 注册屏无横向/文本盒溢出，移动端可用。

## 4. 施工顺序

1. API：`POST /api/auth/logout` + OpenAPI 登记 + api 测试。
2. api-client：`logout()` 方法。
3. Web：注册屏 route-state（复用 route state card 体系）、shell 当前用户区与登出动作、boot 流改造（删自动 identify）。
4. UI/contracts：注册卡双语固定文案进 locale 合同。
5. Tests：web boot 流单测（未识别→注册屏、提交→目标路由、登出→注册屏）。
6. Browser smoke：新增"首访注册→deep link 保持→登出→再注册（第二用户昵称）"步骤组与 `r5_9_onboarding_*` gates；全量回归。
7. 文档回写：本篇竣工记录、S1 roadmap §4 状态、README、中期审查 P1-6 关闭。

## 5. QA Gate

- `pnpm typecheck`、`pnpm test` 全包；
- browser smoke：注册屏双语四态、deep link 经注册后保持、登出后 fail-closed、第二用户注册成功、无溢出，现有 66 步全回归；
- `pnpm qa:r2-release-gate`、`git diff --check`、secret scan。

## 6. 竣工记录

状态：✅ completed（2026-06-12）

落地范围：

- **注册屏**：新增 `packages/ui/src/onboarding.ts`（`renderOnboardingScreen`），昵称 + 中/英 locale 选择 + 折叠的管理员口令项；双语固定文案自带；带 `data-r4-web-route-status="onboarding"` 与 `data-r5-9-onboarding-*` 全套标记；卡片显示"完成后将打开 <deep link>"承诺。
- **boot 改造**：`apps/web/src/browser.ts` 删除 `identify({nickname:"P0.5 Reviewer"})` 自动注册；`me()` 为空即渲染注册屏（fail-closed）；提交成功后保持 URL 不变直接进原目标路由（deep link 保持）；管理员口令错误时服务端人话错误内联呈现并保留已填昵称；locale 切换在注册卡上即时生效并在注册成功后 `PATCH /api/auth/preferences` 持久化。
- **当前用户可见**：product shell topbar 新增用户 chip（昵称 + admin 标签）与"退出"按钮（`data-wh-logout`）；登出走已有 `POST /api/auth/logout`（cookie 轮换 + 设备吊销），回注册屏。
- **API/client**：`POST /api/auth/logout` 本就存在且有测试（计划范围缩水的好消息）；本步补齐 api-client `logout()` 与 OpenAPI 登记。
- **QA 适配**：主 smoke 改为脚本化注册——首访见注册屏（zh/EN 切换证明）、注册进入 home、尾段在 `/approvals` 登出→第二用户 "Pilot Two" 注册→deep link 保持回 `/approvals`、用户 chip 切换为新昵称；新增 `r5_9_onboarding_routes` gate 与 4 个步骤（66→70）。
- **远端 smoke 同步改造**：pg-seed / redis-sse / locale-metrics 三个远端 Linux smoke 的浏览器段补 `registerThroughOnboarding()`（与主 smoke 同构选择器）。**已知限制**：本机无 PG/Redis，三者本轮仅 typecheck 级验证，待下次远端 Linux 验证窗口实跑回归。

验收证据：

- `pnpm typecheck` 全绿、`pnpm test` 全包 0 fail（ui 63 含注册屏/用户 chip 新测试）
- `pnpm --filter @workhub/web qa:r4-live-route-interaction`：**70 步 / 115 gates 全 true**，新增 `r5_9_onboarding_routes=true`；request proof：identify ×2（"R4 Live Reviewer" 与 "Pilot Two"）、logout ×1、注册附带 preferences PATCH（2→4）
- 截图：`00-onboarding-zh-desktop.png`、`00a-onboarding-zh-mobile-no-overflow.png`、`19-logout-onboarding-en-desktop.png`、`19a-second-user-deeplink-en-desktop.png`
- 安全口径不变：无密码/OAuth（LAN-first D-3）、未识别状态不渲染任何 Page VM 数据。**口径修订（R5.11）**：本计划 §3 原写"admin secret 错误时注册仍成功但不提权"已被推翻——R5.11 引入认领语义后，显式提交口令即认领意图，口令错误 403 fail-closed。

## 7. Handoff

R5.9 完成后进入 **R5.10 真实 LLM 端到端验证**（S1 序列第二刀，详见 S1 roadmap §4）：真 key 跑全链、实测预算护栏与成本计量、产出质量-成本-时延评估报告。
