# R9 · codex 接续开发计划（交接文档，2026-07-02）

> 读者：无人值守 codex agent（以及回来复核的人类）。
> 本文档是后续开发的**唯一入口**：先读完「红线」，再按「任务批次」顺序施工。
> 背景：codex 上一轮 +24.4k 行大改经 134-agent 对抗式审查出 84 真发现（3 唯一高危 + 4 类系统性反模式），报告见 [`r9-codex-distrust-review-2026-07-02.md`](./r9-codex-distrust-review-2026-07-02.md)，逐条证据见 `reference/audit-r9/r9-codex-distrust-review.json`。批次 0（止血）与批次 1（性能反模式）已由 Claude 修复收口。**红线全部来自你上一轮真实犯过的错。**

## 一、当前基线（2026-07-02，commit 6f57d3ef，CI 8/8 全绿）

- 批次 0 ✅：/me 403 自愈链路恢复、intake 点名文件白名单+降级、玻璃磨砂复原（.82/.52 + .55 白底）、drive 上传 34MiB 预检+流式限量、docs gate 修正。
- 批次 1 ✅：审批中心/通知/drive/成本/审计 五簇「无上限翻页 + 逐行 N+1」全部收口（cap + SQL 批量/子查询 + 轻量 `canReadWorkItems`）。
- 两个 smoke 已同步产线行为：r1-pg-smoke（intake 必须真 AI 反问 → 确定性生成器注入）、web-live-route-smoke（proposal GitHub 式两段流：approve → `next_action` 换出 merge，79→80 步 + 精确门已更新）。
- 详细实施记录见 [`r9-iteration-plan-2026-07-02.md`](./r9-iteration-plan-2026-07-02.md) 批次 0/1 段落。

## 二、红线（每次开工前重读；违反任何一条 = 本轮产出不可信）

1. **禁止改测试迁就实现。** 你上一轮把「钉死玻璃白底约束」的测试改写成钉透明、把「/me 403」测试改成钉 200 null，制造了两个高危回归。改任何既有 `*.test.ts` 断言，必须在代码注释里写清「旧断言为什么错」；写不出来就说明是你的实现错了。
2. **透明窗玻璃约束（第三次踩了）：** 透明 macOS Tauri 窗里 CSS `backdrop-filter` 是空操作。毛玻璃只能来自 ① main 窗原生 vibrancy（HudWindow，main.rs 已接）或 ② ≥.55 不透明白底（pet 窗无 vibrancy，气泡 .82/.52、面板 .55 是实测下限）。任何「transparent + backdrop-filter」的新样式在真机上都是坏的，测试绿不代表对。
3. **读路径三件套：** 任何列表读路径必须 ① 有硬上限（cap，超出用 `*_capped`/page_info 诚实表达，禁止假装数完了）② 鉴权尽量进 SQL 或批量判定（用已有的 `workItems.canReadWorkItems`）③ 禁止循环内 `await` 单查（N+1）。参考批次 1 的改法照抄。
4. **改产线行为必须同步 smoke（你上一轮 CI 红了两个 job 没发现）：** 见「五、验证清单」。改了 intake/proposal/drive/审批的行为，先想 r1-pg-smoke 和 web-live-route-smoke 的哪个步骤/精确门会受影响，同 commit 更新并注明原因。web smoke 有精确请求计数门（步数/每端点 GET 次数），改交互必然要动它们——这是设计，不是烦人。
5. **docs 计数 gate：** `docs/workhub/**/*.md` 增删必须同 commit 改 README 第 6 行 `**N 篇文档已落盘**` 计数（当前 179）。`pnpm qa:r2-release-gate` 本地能跑。
6. **小批量提交：** 每完成一个编号任务就跑全量验证并 commit + push，逐 job 核 CI conclusion（`gh run view <id> --json jobs`，**不要只看 exit code**）。禁止再堆两万行未提交改动。禁止 `git add -A`——只 add 自己改的文件。
7. **禁止伪测试：** 「读源码文本做正则匹配」的测试不算覆盖（上一轮 6 个新测试文件全是这种，已被点名）。测试必须驱动行为：调函数/打路由/查返回值。
8. **不删不改既有守卫时先考古：** 动 auth/csrf/permissions/human-reserved-guard 前先 `git log -p` 看那行为什么存在。历史上每个「看起来多余」的守卫都对应一次真实事故。
9. **文案规范：** 用户可见字符串禁止原始枚举/裸字节/裸时间戳泄漏（有 formatBytes/本地化表）；指引类文案必须指向真实存在的入口（不许「进入 X 查看全部」而 X 不存在）；桌面二次元人设、web 专业中文，动词统一（合入/采纳 二选一贯穿）。
10. **依赖真机验证的改动（桌面玻璃/动画/vibrancy）单独成批**，在 commit message 里标注「待真机验证」，不要和逻辑改动混在一起。

## 三、任务批次（按序施工；每条完成即验证+提交）

### 批次 2 · 数据正确性（优先，全部来自已确认发现）

| # | 事项 | 现场 | 验收 |
|---|------|------|------|
| 2-1 | drive 采纳清单：主查询恢复 supersededAt 过滤，历史版本不占 limit 配额；`acceptedByVersionId` 取当前生效版而非 last-wins | `packages/db/src/repositories/drive.ts:433`、`apps/api/src/services/drive-pages.ts:427` | 当前生效交付物不被历史版本挤出；「还原上一版」后元数据指向正确变更；计数与清单同口径 |
| 2-2 | 审批评论取「最新 N 条」或真分页（现在是最早 20 条，第 21 条起提交成功却永远不显示） | `packages/db/src/repositories/approval-comments.ts:50` | 新评论可见；超限有诚实提示 |
| 2-3 | 审计恢复 fail-closed：至少对 allow 扩权策略与 AI 副作用工具快照，审计写失败必须让动作失败 | `apps/api/src/services/approvals.ts:553`、`apps/api/src/services/agent-run-snapshots.ts:78` | 注释承诺与实现一致；补行为测试 |
| 2-4 | org 级策略围栏修正：kill-switch deny 必须跨工作区生效 | `packages/permissions/src/evaluate.ts:82` | M25 kill-switch 语义恢复；补跨工作区测试 |
| 2-5 | 归档项目后认领人仍可读自己认领过的工作项（现在 403） | `apps/api/src/services/work-items.ts:950` 附近 access 判定 | 认领人可读；其他人权限不变宽 |
| 2-6 | 澄清草稿复用口径与生成口径统一（现在 files:[] 走不同口径 → 中文意图永不复用，每次重烧 LLM） | `apps/api/src/services/work-items.ts:1444` 附近 | 同一意图二次进入会话复用草稿，不再打 LLM |

### 批次 3 · 桌面 apple 味（涉玻璃/动画的项标「待真机验证」）

| # | 事项 | 现场 |
|---|------|------|
| 3-1 | 缩放手柄二选一：真支持（记录用户拖出的高度、重渲尊重、`userResizeAutoUnlockAt` 覆盖渲染路径的 `requestResize`）或删掉南/东南手柄；东侧 10px 热区避开滚动条 | `apps/desktop-webview/src/spotlight/controller.ts:182,653`、`css.ts:31` |
| 3-2 | 拖拽排除选择器加 input/textarea（搜索框拖选文字现在会拖走整个窗口） | `controller.ts:439` dragExcludedSelector |
| 3-3 | Cuu 项目上下文真接线：生产 Spotlight 壳路由变化时写 project_id（现在写入方只在废弃的 gold-path boot 里，桌宠「带项目启动」是假接线） | `browser.ts:485`、`desktop-cuu-runtime.ts:169` |
| 3-4 | 删除 SVG 折射死管线（所有消费方 display:none 却仍逐像素生成 3 张全窗贴图烧 CPU）——除非真启用 | `liquid-glass-filter.ts:19`、`spotlight/css.ts:23` |
| 3-5 | Rust：`set_background_color(0,0,0,1)` 加 macOS 门控（Windows 上变纯黑）；`execute_window_control` 的 chrome 配置失败降级为 log 不中断托盘/深链导航；回收无人用的 `start-resize-dragging` capability | `client-tauri/src-tauri/src/main.rs:821,1044`、`capabilities/default.json` |
| 3-6 | 提议卡标题保留变更名（现在被通用文案覆盖，认不出是哪个变更）；「合入/采纳」动词统一 | `packages/cuu/src/cards.ts:225`、`cuu/i18n.ts:240` |

### 批次 4 · web GitHub-like / 网盘体验

| # | 事项 | 现场 |
|---|------|------|
| 4-1 | 回收站真分页/完整视图（第 6+ 条现在永远无法还原）；自指文案删除 | `route-components.ts:2285`、drive VM |
| 4-2 | 项目主页隐藏工作项提示改真实入口或如实说明权限过滤（现在指向不存在的页面） | `route-components.ts:2963` |
| 4-3 | 上传支持选目录（parent_id API 已有，UI 不传）；「还原」成功不再无脑跳 /drive | `route-components.ts:2206`、`apps/web/src/browser.ts:906` |
| 4-4 | 交付物不可读行给解释性占位；深链失效优雅回退（现在整页 404）+ 回收站深链不误标选中 | `drive-pages.ts:358,873` |
| 4-5 | 预览面板「类型 text」「N 字节」本地化；成本页「预算未启用」如实呈现（现在渲染成「预算 0/剩余 ¥0」像额度耗尽） | `apps/web/src/browser.ts:141`、`apps/api/src/pages/cost.ts:52` |
| 4-6 | 审批中心 100 条截断契约：web/桌面接 page_info 或删掉无消费方的契约 | `packages/contracts/src/pages.ts:749` |
| 4-7 | 上传失败清理死代码修复（storagePathForCleanup 赋值后立即置 undefined） | `apps/api/src/routes/drive.ts:379` |

### 批次 5 · 测试与文档债

| # | 事项 |
|---|------|
| 5-1 | 重写 6 个「grep 源码」伪测试为行为测试：`packages/db/src/{project-health,proposals-repository,work-items-access,budget-policies,meeting-path,audit-repository}.test.ts`（用内存仓库/真行为驱动） |
| 5-2 | openapi.ts：修 4 处已知漂移（permissions 404 码、workitems 409、审批/会议缺 401/403/404）；建「CI 比对 zod 契约 ↔ openapi」机制，否则 4500 行手写文档必然腐烂 |
| 5-3 | 以 `git log -p` 为准逐个复核上一轮被改过断言的测试（audit JSON 里 test-integrity 切片有清单） |

### 批次之后 · 方向性工作（每项先出 plan 文档再动手）

1. **桌面 Spotlight S2–S12**（`r8-desktop-spotlight-rebuild` 记忆/文档）：桌宠决策信箱、能力内联 morph、删死码。依赖批次 3 收口。
2. **web GitHub 化 P3–P5**（`r8-web-github-refactor-plan`）：Drive 项目切换、引导、导航重排。
3. **桌面端图文验收报告**：复用 `reference/wh-report/capture.mjs` CDP 截图管道。
4. **R9 Agent Army**（`r9-agent-army/` 六篇规划文档已落）：「每人背后一支 agent 军团」。实施顺序：① meta-planner + 子 agent 派发（复用已有 judge/预算/技能/记忆四子系统，盘点见规划包）② 记忆冲突归并 ③ OKR 对齐。红线不变：高风险动作必须升级给人审批（human-reserved-guard 是产品底线，任何「提效」都不许绕）。**启动条件：批次 2 收口 + 桌面真机验收通过。**

## 四、施工顺序与提交粒度

```
批次2（2-1→2-6，每条一个 commit）
→ 批次4（web 体验，4-1→4-7）
→ 批次3（桌面，涉真机验证项单独成批标注）
→ 批次5（测试债）
→ 方向性工作（先 plan 后做，agent army 最后）
```
批次 2/4 优先因为可以纯自动验证；批次 3 有真机盲区放后面攒着人来验。

## 五、验证清单（每个 commit 前全部跑；任何一项红都不许提交）

```bash
pnpm -r typecheck                 # 严格类型（tsx 跑测试不查类型，别省这步）
pnpm test                         # 全量单测（确认输出里没有 "fail 1..n"）
pnpm qa:r2-release-gate           # 文档计数/密钥/reference 泄漏门
# 改了 api 行为时（本机 PG：docker run -d --name wh-pg -e POSTGRES_DB=workhub \
#   -e POSTGRES_USER=workhub -e POSTGRES_PASSWORD=workhub -p 55432:5432 postgres:16）
# 注意：库是脏的会假红，先 DROP DATABASE workhub WITH (FORCE) 重建再跑
DATABASE_URL='postgresql+psycopg://workhub:workhub@127.0.0.1:55432/workhub' \
  APP_ENV=test COOKIE_SECRET=local pnpm --filter @workhub/api qa:r1-pg-smoke
# 改了 web 交互/渲染时（本机可跑，有精确步数/请求计数门）
pnpm qa:r4-web-live-route-interaction
# 推送后：逐 job 核 conclusion，不要信 exit code
gh run list --branch main --limit 1
gh run view <run-id> --json jobs --jq '.jobs[]|{name,conclusion}'
```
