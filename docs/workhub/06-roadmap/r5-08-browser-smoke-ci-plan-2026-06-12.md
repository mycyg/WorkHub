---
module: R5-browser-smoke-ci
layer: QA / CI / C-WEB
status: completed
owner: workflow
date: 2026-06-12
depends_on:
  - r5-07-knowledge-grounding-dashboard-plan-2026-06-11.md
  - r4-24-web-runtime-finalization-plan-2026-06-11.md
  - r4-mid-review-upgrade-audit-2026-06-11.md
---

# R5.8 Browser Smoke CI 化（第一段）Plan

## 1. 开工前必读

- [`r4-mid-review-upgrade-audit-2026-06-11.md`](./r4-mid-review-upgrade-audit-2026-06-11.md) **P1-5**：浏览器回归只能本机跑、不在 CI，步数线性增长（11→66），main 上没有任何浏览器级回归门。
- [`r4-24-web-runtime-finalization-plan-2026-06-11.md`](./r4-24-web-runtime-finalization-plan-2026-06-11.md)：已登记五组拆分目标（nav-locale / intake-knowledge / proposal-actions / settings-cost-replay / route-states）。
- `apps/web/qa/r4-web-live-route-interaction.ts`：现状已是 `--headless=new` + CDP + 进程内 Vite/mock API，支持 `CHROME_PATH`，Linux Chrome 路径已在候选列表——CI 化的地基已经存在。

## 2. 目标与边界

**第一段（本篇）**：把现有 66 步单体 smoke 原样跑进 GitHub Actions，main 从此有浏览器级回归门。**不做**按路由拆分（那是第二段，沿 R4.24 五组口径），不改任何 gate 语义，不动步数。

必须完成：

1. smoke 脚本支持 `WORKHUB_QA_CHROME_EXTRA_ARGS`（空格分隔追加 Chrome 启动参数），本地默认行为不变；CI 传 `--no-sandbox --disable-dev-shm-usage`。
2. `verify.yml` 新增 `web-live-route-smoke` job：ubuntu-latest 自带 Chrome + 安装 `fonts-noto-cjk`（防中文 tofu 字体度量漂移造成 overflow 误判），运行 `pnpm qa:r4-web-live-route-interaction`。
3. 失败可诊断：contact sheet、截图与 report json 以 CI artifact 上传（always()）。
4. 本机回归：全量 smoke 在本机继续全过，确保 env 改动零侵入。

不做：

- 不拆分单体脚本（第二段）；不引 Playwright（现有 CDP 驱动已够用且零新依赖）；不动 R4/R5 任何 gate 阈值。

## 3. 验收门

- 本机：`pnpm qa:r4-web-live-route-interaction` 66 步 114 gates 全 true（含 `WORKHUB_QA_CHROME_EXTRA_ARGS` 空值与非空值两种路径）。
- CI：`web-live-route-smoke` job 在 push 后真实跑绿；artifact 含 contact-sheet 与 report。
- `pnpm typecheck`、`pnpm test`、`pnpm qa:r2-release-gate`、`git diff --check`。

## 4. 竣工记录

状态：✅ completed（2026-06-12）

落地范围：

- smoke 启动器新增 `WORKHUB_QA_CHROME_EXTRA_ARGS` 透传（`apps/web/qa/r4-web-live-route-interaction.ts` chromeExtraArgs()），本地默认行为零变化。
- `verify.yml` 新增 `web-live-route-smoke` job：ubuntu runner 自带 Chrome + `fonts-noto-cjk`，env 传 `--no-sandbox --disable-dev-shm-usage`，contact-sheet / report / summary 以 artifact 上传（14 天）。
- **首跑即抓到真实缺陷**：Noto Sans CJK 行盒 ≈1.29×，仓库 16 处 1.0–1.25 紧行高使 zh-CN 标题在 Linux 上垂直裁切（首跑失败证据：home h2 sh/ch=31/28）。已把全部承载 CJK 的标题/标签/notice/语言切换钮行高统一为 1.35，纯数字徽章保留 `line-height:1`。这正是该 gate 要防的回归类型——Linux 用户可见的裁切此前任何本机（macOS/Windows）验收都发现不了。

验收证据：

- 本机：66 步 / 114 gates 全 true（含 extra-args 路径），`pnpm test` 全包 0 fail。
- CI run `27397712024`（commit `64f20300`）：六 job 全绿；`web-live-route-smoke` 端到端 **64 秒**（05:59:28→06:00:32），artifact `web-live-route-smoke-evidence` 已上传。
- main 从此每次 push/PR 都有浏览器级回归门（中期审查 P1-5 第一段关闭）。

## 5. R5.9 Handoff

第一段实测：单体 job 在 CI 仅 64 秒，远低于拆分阈值——**第二段（R4.24 五组拆分）正式降级为维护性重构，不再是急务**。下一刀建议 onboarding 最小闭环（P1-6，替换 "P0.5 Reviewer" 自动注册），其后是桌宠 OS 通知 surface（复用 R5.6/R5.7 API 合同）。
