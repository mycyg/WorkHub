# R9 · 后续迭代与开发计划（2026-07-02）

> 输入：[`r9-codex-distrust-review-2026-07-02.md`](./r9-codex-distrust-review-2026-07-02.md)（84 条确认发现）+ R8 未竟事项。
> 原则：先止血（回归/主流程炸断/红 gate），再收系统性反模式，再补体验，最后接续 R8/R9 方向性工作。
> 产品北极星不变：**桌面 = 满满 apple 味、液态玻璃、过渡动画、灵动设计；web = GitHub-like，项目管理与网盘同步是核心。**

## 批次 0 · 止血（提交前必须完成，否则 codex 这批改动不能进 main）——✅ 已全部完成（2026-07-02，typecheck/全量测试/release gate 全绿）

> 实施记录：0-1 `/me` 回退为只吞 401（403 invalid client token 恢复抛出，桌面死 token 自愈链路复活，迁就测试翻回）；0-2 点名文件改扩展名白名单+剥 URL，找不到降级留痕继续（不再 502+cancel），删「草稿逐字包含文件名」伪 grounding，两个钉旧行为的测试改写+新增误报回归用例；0-3 气泡磨砂 .82/.52、chips/按钮/标签白底、入场淡入动画恢复（suppress 机制改为有的放矢的 animation:none），偏好面板恢复 .55 不透白底（liquid-glass.ts + cuu-preferences.ts 双处），4 个钉透明的测试全部翻回钉约束；保留 codex 的几何语言（radius 24/blur 40/统一 tone）不动；0-4 归档时已修（README 178 = 实际）；0-5 豁免改为 34MiB 专属预检 + 路由内流式边读边限量（chunked 也封顶），JSON 解析复用 jsonObjectFromText，补 35MiB 流截断回归用例，fail-closed 姿态保持。

| # | 事项 | 发现 | 验收 |
|---|------|------|------|
| 0-1 | 恢复 `/me` 对 invalid client token 抛 403（或桌面端补 null 兜底） | H1 | 桌面死 token 自愈链路测试恢复且真机可自愈 |
| 0-2 | intake 点名文件正则收紧 + 失败降级不 502/不 cancel 工单 | H2 | 常见中文意图（含版本号/URL/小数）全部通过 intake |
| 0-3 | 玻璃回退复原：偏好面板不透白底、气泡 .82/.52、chips 底色恢复；改回被迁就的测试 | H3 | 真机深浅壁纸截图核验（screencapture CLI） |
| 0-4 | release gate docs.count 修正（README 计数与实际一致） | gate 红 | `pnpm qa:r2-release-gate` 绿 |
| 0-5 | drive 上传 body：读 body 前按 Content-Length 预检（32MiB+余量），JSON 分支回到全局 1MiB | auth-core-2 簇 | 声明超限请求在读 body 前 413 |

## 批次 1 · 性能反模式收口（核心读路径）——✅ 已全部完成（2026-07-02，commit 6f57d3ef）

> 实施记录：1-1 审批中心扫描 cap 500+`pending_total_capped` 诚实截断、可见性改轻量批量 `canReadWorkItems`、workItemId 去重、路由层去二遍检查；1-2 通知输出 200 封顶（扫描 ≤3×cap）、通知页回单次有界查询、鉴权并发化；1-3 drive readPage 批量化（数百串行 SQL→2）、下载/预览窄查询（~14→1）、项目主页 recent files 批量；1-4 cost-ledger IN→SQL 子查询、非管理员回 user-scope；1-5 audit 时间线 limit 200+谓词收窄+0030 表达式索引。**附带修复两个 codex 没同步的 CI 红 smoke**：r1-pg-smoke（intake 必须真 AI 反问→注入确定性生成器）、web-live-route-smoke（proposal GitHub 式两段流→场景补 approve 步+QA 服务器对齐真实 review 响应+回收站逐行 restore_href+7 个精确门按新语义更新）。typecheck/全量测试/gate/双 smoke 全绿。

统一手法：把「全量翻页 + 逐行 detailPage/鉴权」改回「SQL 内联鉴权 + 硬上限 + 批量判定」。历史上 DF-2 已为项目健康页做过同款改造（逐 actor 鉴权进 SQL），照抄。

| # | 事项 | 发现簇 |
|---|------|--------|
| 1-1 | 审批中心：可见性判定下沉 SQL / 批量化，去掉路由层二次重复，封顶恢复 | routes-a-2 簇（5 条） |
| 1-2 | 通知：恢复上限（200/500 clamp），鉴权批量化，归档项默认排除 | services-b-4 簇（3 条） |
| 1-3 | drive readPage：restoreBlocked/canRestore/祖先链改批量查询；下载/预览不再全跑 readPage；写操作后不重跑 3 遍 | db-repos-5 簇（6 条） |
| 1-4 | cost-ledger：IN 子句改 EXISTS/JOIN 子查询；非管理员成本页回到 user scope 索引查询 | db-repos-2 簇（5 条） |
| 1-5 | audit_logs work_item_id 谓词加表达式索引或落列，补 limit | db-repos-7 |

## 批次 2 · 数据正确性

| # | 事项 | 发现 |
|---|------|------|
| 2-1 | drive 采纳清单：主查询恢复 supersededAt 过滤，历史版本不占配额；acceptedByVersionId 取当前生效版 | db-repos-3 簇 |
| 2-2 | 审批评论取「最新 N 条」或真分页，第 21+ 条可见 | db-repos-6 簇 |
| 2-3 | 审计恢复 fail-closed（至少对 allow 扩权策略与 AI 副作用工具） | services-a-1 / ux-web-govern-4 |
| 2-4 | org 级策略围栏修正：kill-switch deny 跨工作区仍生效 | contracts-pkgs-2 |
| 2-5 | 归档项目后认领人仍可读自己的工作项 | ux-web-projects-7 |
| 2-6 | 澄清草稿复用口径与生成口径统一，杜绝重复烧 LLM | services-b-3 |

## 批次 3 · 桌面 apple 味修复（Spotlight/Cuu）

| # | 事项 | 发现 |
|---|------|------|
| 3-1 | 缩放手柄：要么真支持高度持久（记录用户高度、重渲尊重），要么删掉南/东南手柄；东侧热区避开滚动条 | desktop-spotlight-2/5 簇 |
| 3-2 | 拖拽排除加 input/textarea，搜索框可正常拖选 | desktop-spotlight-1 簇 |
| 3-3 | Cuu 项目上下文真接线：Spotlight 壳路由变化时写入 project_id | desktop-glass-6 簇 |
| 3-4 | 删除 SVG 折射死管线（或真启用）；恢复气泡入场淡入动画（并让 suppress 机制有的放矢） | desktop-glass-4/5 簇 |
| 3-5 | Rust：set_background_color 加 macOS 门控；execute_window_control chrome 配置失败降级不中断导航；回收无用 capability | tauri-rust-3/5 / ux-desktop-10 |
| 3-6 | 提议卡标题保留变更名；「合入/采纳」动词统一 | ux-copy-1/5 |

## 批次 4 · web GitHub-like / 网盘体验

| # | 事项 | 发现 |
|---|------|------|
| 4-1 | 回收站真分页/完整视图，第 6+ 条可还原；文案不再自指 | web-ui-1 簇（4 条） |
| 4-2 | 项目主页隐藏工作项提示改为真实入口（或如实说明权限过滤） | web-ui-3 簇（3 条） |
| 4-3 | 上传支持选目录（parent_id 已有 API）；「还原」不再无脑跳 /drive | ux-web-drive-7 / web-ui-2 |
| 4-4 | 交付物不可读行给出解释性占位而非裸行；深链失效优雅回退 | ux-web-drive-4/6 |
| 4-5 | 预览面板枚举/字节本地化；成本页「预算未启用」如实呈现 | web-ui-4 簇 / ux-web-govern-7 |
| 4-6 | 审批中心 100 条截断：web/桌面接 page_info 或去掉截断契约 | xlink-contract-2 |
| 4-7 | 上传失败清理死代码修复（storagePathForCleanup） | ux-web-drive-8 |

## 批次 5 · 测试与文档债

| # | 事项 | 发现 |
|---|------|------|
| 5-1 | 重写 6 个「grep 源码」伪测试为行为测试（真 PG/内存仓库跑行为） | db-repos-8 / test-integrity-2 |
| 5-2 | openapi.ts：修 4 处已知漂移；建「从 zod 契约派生或 CI 比对」机制，不再手维护 4500 行 | openapi-1..4 |
| 5-3 | 快照/替换所有被迁就的测试断言（以 git log -p 原断言为准逐个复核） | test-integrity-1 |

### 5-3 断言复核记录（2026-07-02）

`test-integrity` JSON 清单只有两条已确认项：`test-integrity-2` 是 DB 源码 grep 伪测试债，已由 5-1 改成行为测试；`test-integrity-1` 是桌宠玻璃约束测试被改写迁就实现。

以 `git log -p` 逐项复核后，当前约束为：

- `32d2efb7` 的批次 0 止血已经把 `apps/desktop-webview/src/pet-surface.test.ts` 中被削弱的桌宠气泡断言恢复到 `.wh-pet-bubble` 白底 `rgba(255,255,255,.82/.52)`，并恢复入场淡入动画；当前实现 `apps/desktop-webview/src/pet-surface.ts` 同步保持 `.82/.52`。
- 后续 `a2ef86e3` 只改掉隐藏 SVG filter 相关断言，且在 `pet-surface.test.ts`、`spotlight/css.test.ts`、`liquid-glass-filter.test.ts` 中逐条写明旧断言为什么错：这些 `url(#workhub-liquid-glass-*)` 层在生产消费方被隐藏，继续钉住它们只会保留死的生成贴图路径。
- 后续 `b2fb61cf` 改掉 Spotlight 手动 resize 命中区相关断言，已写明旧断言为什么错：旧断言钉住了没有持久 resize 状态支撑的假 affordance。

复核命令：`pnpm exec node --import tsx --test src/pet-surface.test.ts src/liquid-glass-filter.test.ts src/spotlight/css.test.ts`（`apps/desktop-webview`）通过 `56/56`。5-3 不再替换额外断言，只保留这份可回溯记录。

## 流程红线（写进协作规范，防复发）

1. **无人值守 agent 产出必须过对抗式审查才能进 main**——本轮 84 真发现即为代价证明。
2. **测试是约束不是摆设**：禁止改测试迁就实现；改任何 `.test.ts` 断言必须在提交说明里逐条解释为什么旧断言错了。
3. **透明窗玻璃约束是红线**：透明 Tauri 窗内 CSS backdrop-filter 无效；毛玻璃 = 原生 vibrancy（main 窗）或 ≥.8 不透明白底（pet 窗）。第三次踩坑。
4. **读路径三件套**：任何列表读路径必须有硬上限、鉴权尽量进 SQL、禁止循环内 await 单查。
5. **docs/workhub 增删 .md 必须同 commit 改 README 计数**（release gate 会红）。

## 批次之后：接续方向性工作（R8 未竟 + R9）

1. **桌面 Spotlight S2–S12**（`r8-desktop-spotlight-rebuild`）：桌宠决策信箱、各能力内联 morph、删死码——先修批次 3 再继续。
2. **web GitHub 化 P3–P5**（`r8-web-github-refactor-plan`）：Drive 项目切换、引导、导航重排。
3. **桌面端图文验收报告**：复用 `reference/wh-report/capture.mjs` 管道，本轮修复后出真机截图验收（web 报告已交付，桌面未并入）。
4. **R8 遗留专项**：DF-2 项目健康逐 actor 鉴权进 SQL（task_fabe4dda，与批次 1-1 同型可合并施工）。
5. **R9 Agent Army**（`r9-agent-army/`，纯规划）：meta-planner + 子 agent 派发、记忆冲突归并、OKR——待批次 0–2 收口、真机验收后再启动实施。
