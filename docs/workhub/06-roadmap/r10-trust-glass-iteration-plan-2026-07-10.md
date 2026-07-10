# R10 迭代计划：信任链收口 + 液态玻璃 Web 改版

> 制定日期：2026-07-10
> 输入：codex《WorkHub 普通用户视角系统性审查报告》（[`../05-clients/workhub-user-facing-systematic-review-2026-07-10.md`](../05-clients/workhub-user-facing-systematic-review-2026-07-10.md)，8 P1 / 12 P2 / 3 P3）+ 用户诉求「web UI 换液态玻璃圆角主基调，与桌面设计语言同步」
> 前置：UX-R1..R13 十三轮用户视角审查（累计 ~250 条修复）已全部收口，CI 绿

---

## 0. 对 codex 报告的对抗核实结论

4 个独立核查 agent 逐条验证 8 条 P1：**7 条 REAL、1 条 PARTIAL，0 条 WRONG**。计划以核实后的口径为准，两处纠偏 + 一处追加：

| 条目 | 判定 | 纠偏/补充 |
|---|---|---|
| P1-1 Intake 被旧文件带偏 | REAL | 全局 `/intake` 硬编码 pilot-project；grounding 命中任一文件即过；首轮永远 `options:[]`。修复规模**中大**（涉 contracts/LLM 契约） |
| P1-2 审批切换上下文错位 | REAL | **追加**：R13 把行改成 `aria-current` 后 browser.ts 切换逻辑未写回，读屏「当前项」停在初始项，比原报告更重一层。A 的打回理由确会以 B 名义提交 |
| P1-3 资源链接被拦死 | REAL | **纠偏**：工作项交付物下载的后端路由（`/api/workitems/:id/deliverables/:id/download`）其实已注册，死的是前端拦截；真死链只有 manifest 的 `/api/agent/outputs/{download,preview}`。修复规模小（3 处补 `data-native-resource-link` + manifest 改指已注册端点） |
| P1-4 冲突失败伪装零冲突+静默截断 | REAL | 4 处截断（checks/evidence/知识证据/320字摘要）无提示，与已落地的「还有 N 条」模式形成对照；冲突 catch 降级 `[]` 无 partial 标志 |
| P1-5 「暂不可用」混淆+全局锁死 | REAL | 7 个真实 in-flight 场景共用「还在开发中」文案；`llmActionBusy` 模块级一把锁；web 两处 `createApiClient` 均未传已实现的 `requestTimeoutMs` |
| P1-6 切语言丢草稿 | **PARTIAL** | 确实绕过自定义 dirty-guard 且无草稿恢复，但原生 `beforeunload` 会拦一次（脏时非静默丢）。修复规模小 |
| P1-7 通知偏好水合竞态 | REAL | GET 回填前可点、失败静默吞、PUT 整体替换，覆盖链路成立 |
| P1-8 登出失败仍显示已登出 | REAL | catch 空吞一切错误无条件渲 Onboarding，无测试覆盖 |

---

## Phase 0：信任链收口（P1 全部，3 个批次 ≈ 3 轮）

**完成标准（codex 原文）：普通用户不会被带入错误任务，不会对错误对象做审批，也不会把加载失败理解成没有数据。**

### 批 0a：小件快修（web/ui 为主，1 轮）
1. **P1-3** 三处资源链接（工作项交付物下载 / proposal `preview_ref` / 知识证据）补 `data-native-resource-link="true" target="_blank" rel="noreferrer"`（照抄 drive_download 现有写法）；`packages/agent/manifest.ts` 默认 href 改指已注册的 workitems deliverables 端点，消灭 `/api/agent/outputs/*` 死链。
2. **P1-4** 截断提示：checks>3 / evidence>5 / 知识证据>6 / 摘要 320 字，仿既有 overflow 模式补「还有 N 条/字」；冲突接口失败加 `conflicts_check_failed` 标志位全链透传，UI 渲「冲突检查失败，重试」partial 提示（禁止显示零冲突）。
3. **P1-5(a)** 文案分型：`runtime.actionPending` 拆成 in-progress（「正在处理…」）与 unsupported 两套 key，7 个真实 in-flight 调用点换 in-progress；web 两处 `createApiClient` 传 `requestTimeoutMs`（30s）。
4. **P1-8** 登出 catch 分型：401/会话失效→静默视为成功；网络/5xx→显式错误提示+保留登录态+说明服务端会话可能仍有效；补失败路径测试。
5. **P1-6** 语言切换 reload 前接入 `confirmLeaveDirtyRoute` 同套 dirty 检查。

### 批 0b：状态源重构（中件，1 轮）
6. **P1-2** 审批页单一 `selectedApprovalId` 状态源：h1 / 顶部原因 / 详情 / approve-deny href / `aria-current` / 焦点全部从选中对象派生；打回理由 textarea 按事项缓存（或切换时清空+提示）；一并修 R13 的 aria-current 不写回退化。补「切到 B 后 A 理由不得提交给 B」回归测试。
7. **P1-7** 通知偏好：水合完成前禁用 checkbox；GET 失败显式提示+重试按钮；save 用最近一次成功 GET 结果做本地合并兜底。（后端 PATCH 增量语义可延后到 Phase 2。）
8. **P1-5(b)** 动作锁按 actionId/资源分区（timeout 落地后锁死风险已解，分区消除跨动作互相锁）。

### 批 0c：Intake 重做（大件，1 轮）
9. **P1-1** 三刀：① 全局 `/intake` 加项目选择器（复用知识落地页 `<select name="project_id">` 模式），不再静默落 pilot-project；② grounding 校验收紧——命中文件必须与当前意图相关（文件相关性得分>0 才计入，命中任一旧文件名不再放行）；③ scope 阶段生成真实 `options[]` + 推荐项（LLM 契约+schema 联动），自由文本折叠为兜底。回归用例：项目含旧文件、新请求无关时澄清不得引用旧文件。

---

## Phase 1：液态玻璃 Web 改版（用户主诉求，独立 track，≈ 3-4 轮）

**方向：web 与桌面 `.wh-ds` 同源的液态玻璃+大圆角设计语言。**

关键前提认知：桌面「CSS backdrop-filter 在透明 Tauri 窗里是空操作」的坑**不适用于 web**——普通浏览器里 `backdrop-filter` 完全可用，web 可以做真 CSS 毛玻璃。此前「玻璃 desktop-only」是 R7 的保守决策，现在正式翻案。

### S1：token 收敛 + 外壳换肤（先出效果给用户签字）
- 清障（即 P2-8/P3-1）：proposal/replay legacy CSS（重复定义 `:root`/`.wh-card`/`.wh-btn`）并入 product-shell token 体系；修正未定义的 `--wh-product-accent`；**AI 置信数字→人话分档**（`AI 置信 87%` 违反 README/术语规范的「绝不显示数值」合同）。
- 新 token 层：柔和渐变浅底 + 半透明白玻璃卡（`rgba` + `backdrop-filter: blur`）+ 大圆角（16–20px 分级）+ 桌面同源语义色/阴影层级 + spring 缓动。
- product-shell 外壳（顶栏/左导航/卡片基座/右栏）先换肤，**出整套截图走查给用户拍板视觉方向，再铺开**。

### S2：route-components 通用类铺开
- `wh-card/wh-btn/wh-pill/wh-row` 等通用类接玻璃 token，18 条路由逐页截图走查（复用 `reference/wh-report/capture.mjs` 管道）。

### S3：legacy 页面迁入标准壳（一并解 P2-7/P2-6）
- Replay 从 whole-page renderer 映射到标准 Route Component，消双框架双摘要；
- 非 Ready 状态（loading/error/403/404）回归 product shell，不再裸页。

### S4：门禁加固
- 玻璃上文字对比度实测 ≥4.5:1（muted 色一并修，P2-10 第 5 条）；
- `prefers-reduced-transparency` / `prefers-reduced-motion` 降级为实底；
- web smoke 溢出门 + 82 步截图产物全量重生成入库；CI Linux CJK 字体差异预跑。

---

## Phase 2：普通用户闭环补齐（P2 系列，≈ 2-3 轮）

1. **P2-1** 导航按「工作 / 团队 / 管理」分组 + 角色化披露；总览「打开网盘/新建任务」显示目标项目名（消 `projectList[0]` 静默指向）。
2. **P2-2** 会议接入入口（上传录音/导入转写，含后端路由——目前是只读孤岛）。
3. **P2-3** 日历上一周/下一周/今天/日周视图控件（路由参数已支持，纯 UI 补齐）。
4. **P2-4** 设置拆「个人设置」+ admin-only「系统诊断」。
5. **P2-5** 委派选人器（解锁已有的 `/delegate` API）。
6. **P2-11** 各列表截断补「查看全部」出路；**P2-12** 错误重试保留 query string。
7. P1-7 后端 PATCH 增量偏好语义。

---

## Phase 3：无障碍收尾 + 桌面首帧（≈ 1-2 轮）

- **P2-10**：真实 heading 层级（`<h3 role="heading" aria-level="2">` 改真 h2）、proposal tabs 方向键/Home/End、桌面 Intake 预选项 `aria-pressed`/radio 语义、textarea 显式 label、A/X 快捷键可关闭或仅组件聚焦时生效。
- **P2-9**：桌面 boot 首帧品牌化 loading/offline shell（消透明空窗）。

## Phase 4：文档回真（P3-2，半轮）

- `pnpm dev` 描述与实际对齐；迁移计数 0000-0045；路由报告从注册表动态生成（15→18 条漂移根治）。

---

## 排期与纪律

- **推荐顺序**：批 0a → 批 0b → S1（出视觉签字）→ 批 0c 与 S2 可并行 → S3/S4 → Phase 2 → Phase 3 → Phase 4。
- 施工纪律不变：targeted commit（绝不 `git add -A`）/ 每批 typecheck+全测+release gate+migration audit / 改产线行为本机跑对应 smoke / push 后 `gh run view --json jobs` 逐 job 核绿 / smoke 截图产物同批入库。
- 验收用例采用 codex 报告第 8 节裁剪版，每个 Phase 收口时逐条打勾并补对应回归测试（P3-3 的跨组件状态合同随各 Phase 落地，不单列）。
