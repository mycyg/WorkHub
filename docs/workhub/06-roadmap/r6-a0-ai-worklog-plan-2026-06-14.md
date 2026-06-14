---
module: AI 战绩/work-volume feature
layer: backend + web UI integration
status: planned
owner: AI team
date: 2026-06-14
depends_on: [r6-compounding-ai-labor-plan-2026-06-14.md]
---

## 开工前必读

**核心文件位置与行号：**

1. **PilotDay1Metrics 服务**  
   - `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/services/pilot-day1-metrics.ts`
     - Line 31–62: `metricDefinitions` — 现有度量指标集合
     - Line 146–293: `buildPilotDay1MetricsSnapshot()` — 生成快照的逻辑，已读取 agent_runs（Line 165）、proposals（已merge的行数），成本数据
     - Line 302–319: `snapshot()` 方法 — admin-only gate at Line 303
   
2. **数据库层**  
   - `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/repositories/pilot-metrics.ts`
     - Line 90–104: `PilotDay1MetricsRows` 类型 — 包含 agentRuns（Line 94）、proposals
     - Line 106–203: `createPilotMetricsRepository()` — 已读取 agentRuns（Line 144–154），costLedgerEntries（Line 187）
   - `/Users/apple/Desktop/开发项目/WorkHub/packages/db/src/schema/core.ts`
     - Line 772–810: `acceptedDeliverableChanges` table — id, workItemId, proposalId, createdAt（Line 798）
     - Line 883–931: `agentRuns` table — id, status（Line 894）, finishedAt（Line 915）, costEstimate（Line 904）

3. **路由与Contract**  
   - `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/routes/pilot.ts`
     - Line 44–57: `/day1/metrics` GET endpoint — admin 保护在 Line 303（service 层）
   - `/Users/apple/Desktop/开发项目/WorkHub/packages/contracts/src/pages.ts`
     - Line 39–50: `attentionHomeVmSchema` — 当前首页VM，包含 primary、queue、background_runs、cuu_state
   
4. **Web 路由与指标生成**  
   - `/Users/apple/Desktop/开发项目/WorkHub/apps/web/src/routes.ts`
     - Line 590–695: `metricsForSurface()` — 根据 surface key 生成 shell metrics，home 路由在 Line 591–596
     - Line 778–810: `loadRouteSurface()` — home 路由处理在 Line 782–787
   
5. **QA 与 smoke test**  
   - `/Users/apple/Desktop/开发项目/WorkHub/apps/web/qa/r4-web-live-route-interaction.ts`
     - Line 1–150+: 浏览器审计数据结构，检查 data-r4-* 标记、React 指纹、SSE 更新信号

## 目标

**"今天 AI 干了多少活" 战绩面板（最小可交付片）**

在首页（home）添加一个用户友好的 banner，展示：
- ✨ **AI 完成件数**（accepted_today）：今日被人类接受的交付物改动数量
- ⚡ **自主率**（autonomy_rate）：(succeeded + finished 的 agent_runs) / 总运行次数，单位 %
- 📊 **估算节省时间**（saved_hours_estimate）：保守常数估值（如 0.25 h/件），展示为"约省 X 小时"
- 🎀 **可爱的喵咪表情包**（cute kaomoji）

**样式参考：**  
"今天 AI 干了 5 件 · 自主率 82% · 约省 1.25 小时 ฅ(๑•́ ω •̀๑)ฅ"

**非管理员用户均可见**（对标 PilotDay1Metrics 的 admin-only 限制），数据基于**今日 00:00–现在**的时间范围。

## 数据流与契约

### 1. 数据查询路径

**Source tables：**
- `agent_runs`（status, finishedAt, createdAt）→ 筛选今日已完成或成功的 runs
- `accepted_deliverable_changes`（createdAt）→ 筛选今日被接受的交付物改动
- `cost_ledger_entries`（createdAt, estimatedCostCny）→ 取保守成本估算

**计算公式：**
```
autonomy_rate = COUNT(agent_runs WHERE status='succeeded' OR status='finished' AND createdAt IN today)
              / COUNT(agent_runs WHERE createdAt IN today)
              → format as "82%"

accepted_today = COUNT(accepted_deliverable_changes WHERE createdAt IN today)
               → plain count, e.g., "5"

saved_hours_estimate = accepted_today * 0.25 (conservative factor)
                     → format as "1.25"，但显示时标为"约省 1.25 小时"
```

### 2. 新 Contract Schema

**文件：** `/Users/apple/Desktop/开发项目/WorkHub/packages/contracts/src/pages.ts`

添加到 `attentionHomeVmSchema`（现行 Line 39）：

```typescript
export const aiWorklogSummaryVmSchema = z.object({
  accepted_count: z.number().int().nonnegative(),
  autonomy_rate: z.string().regex(/^\d+%$/u),
  saved_hours_estimate: z.string().regex(/^\d+(\.\d+)?$/u),
  label_zh: z.string().optional()
});
export type AiWorklogSummaryVM = z.infer<typeof aiWorklogSummaryVmSchema>;

// 修改 attentionHomeVmSchema：
export const attentionHomeVmSchema = z.object({
  primary: attentionItemSchema.optional(),
  queue: z.array(attentionItemSchema),
  background_runs: z.array(z.object({
    run_id: idSchema,
    work_item_id: idSchema.optional(),
    title: z.string().min(1),
    state: z.enum(["queued", "running", "waiting_for_user", "failed"]),
    preview_text: z.string().min(1)
  })),
  cuu_state: cuuStateSchema,
  worklog: aiWorklogSummaryVmSchema.optional()  // 新增，OPTIONAL
});
export type AttentionHomeVM = z.infer<typeof attentionHomeVmSchema>;
```

**设计原则：**
- `worklog` 字段可选（graceful degradation）
- 保留所有现有 data-r4-home-* 标记与 React props/SSE 指纹
- 如数据缺失，home banner 不显示（不破坏既有 UI）

### 3. 新 API 端点

**GET `/api/ai-worklog/today`**

**响应 schema：**
```typescript
{
  "ok": true,
  "data": {
    "accepted_count": 5,
    "autonomy_rate": "82%",
    "saved_hours_estimate": "1.25",
    "generated_at": "2026-06-14T15:30:00Z"
  }
}
```

**错误处理：**
- 如果用户无权限（不应该，但防守）→ 200 OK with counts=0
- 如果数据库查询失败 → 500 或 warn silently，home 不显示 banner

### 4. 后端服务层

**新文件：** `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/services/ai-worklog-metrics.ts`

```typescript
export type AiWorklogMetrics = {
  accepted_count: number;
  autonomy_rate: string;
  saved_hours_estimate: string;
};

export type AiWorklogMetricsService = {
  getTodayMetrics: (input: { actor: AuthActor }) => Promise<AiWorklogMetrics>;
};

export function createAiWorklogMetricsService(
  repository: PilotMetricsRepository,
  options?: { now?: () => Date }
): AiWorklogMetricsService {
  const now = options?.now ?? (() => new Date());

  return {
    async getTodayMetrics(input) {
      // 使用 PilotMetricsRepository.readDay1MetricsRows() 获取数据
      // 计算 today 的时间范围（00:00–23:59:59）
      // 计算 autonomy_rate、accepted_count、saved_hours_estimate
      // 返回序列化后的值
    }
  };
}

export function getDefaultAiWorklogMetricsService() {
  // 使用已有的 PilotMetricsRepository
}
```

**复用现有基础设施：**
- `PilotMetricsRepository.readDay1MetricsRows()` 已提供 agentRuns、acceptedDeliverableChanges、costLedgerEntries
- 保用同一套数据库连接与日期范围逻辑

## 施工顺序

### Phase 1: Contract 与数据库（1 step）

**Step 1：添加 Contract schema**  
- **文件：** `/Users/apple/Desktop/开发项目/WorkHub/packages/contracts/src/pages.ts`
- **修改：**
  1. 在 `attentionHomeVmSchema` 前（Line 39）添加 `aiWorklogSummaryVmSchema` 定义
  2. 修改 `attentionHomeVmSchema.extend()` 或用新 object，追加 `worklog: aiWorklogSummaryVmSchema.optional()`
  3. 更新 `AttentionHomeVM` 类型推导
- **验证：** `pnpm build --filter="@workhub/contracts"`，无 zod 验证错误

### Phase 2: 后端服务（3 steps）

**Step 2：创建 AiWorklogMetricsService**  
- **文件：** `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/services/ai-worklog-metrics.ts` （新建）
- **内容：**
  1. 导入 `PilotMetricsRepository`, `AuthActor`
  2. 定义 `AiWorklogMetrics` type（3 字段）
  3. 实现 `createAiWorklogMetricsService(repository, options)`
     - 调用 `repository.readDay1MetricsRows()`
     - 筛选 `createdAt` 在今日范围内的 agentRuns（按 status 计数）
     - 筛选 `createdAt` 在今日范围内的 acceptedDeliverableChanges（计数）
     - `autonomy_rate = (succeeded + finished) / total * 100 → "82%"`
     - `saved_hours_estimate = accepted_count * 0.25 → "1.25"`（字符串格式）
  4. 实现 `getDefaultAiWorklogMetricsService()` helper
- **验证：** 单元测试 stub pass（TBD），type checking pass

**Step 3：创建 `/api/ai-worklog/today` 路由**  
- **文件：** `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/routes/pilot.ts` 或新建 `/routes/ai-worklog.ts`
- **修改：**
  1. 导入 `AiWorklogMetricsService`
  2. 在 `PilotRoutesDependencies` type 中追加 `worklogMetrics?: AiWorklogMetricsService`
  3. 在 `createPilotRoutes()` 中添加 GET `/api/ai-worklog/today`
  4. 中间件：`createCurrentUserMiddleware` （非 admin）
  5. 处理：调用 `service.getTodayMetrics({ actor })`，返回 `{ ok: true, data: ... }`
  6. 错误处理：catch 并 warn，不中断响应
- **验证：** `curl http://localhost:5173/api/ai-worklog/today`，返回 JSON

**Step 4：集成到 home VM 生成**  
- **文件：** `/Users/apple/Desktop/开发项目/WorkHub/apps/api/src/routes/pages.ts` 或相关 pages route
- **修改：**
  1. 查找调用 `attentionVmService.snapshot()` 的代码（生成 AttentionHomeVM）
  2. 在返回前，并行调用 `aiWorklogMetricsService.getTodayMetrics()`
  3. 将结果注入到 `attention_home_vm.worklog` 字段
  4. 如果 worklog 服务失败，设为 undefined（graceful）
- **验证：** home 路由返回含 worklog 字段的 JSON

### Phase 3: Web UI 集成（2 steps）

**Step 5：更新 metricsForSurface() 函数**  
- **文件：** `/Users/apple/Desktop/开发项目/WorkHub/apps/web/src/routes.ts`
- **修改：**
  1. 在 `metricsForSurface()` 的 `surface.key === "home"` 分支（现行 Line 591–596）
  2. 保留现有 3 个 metrics（primary, queue, running）
  3. 如果 `surface.attention.worklog` 存在，新增 2–3 个 metrics：
     - `metric(locale, "autonomy", surface.attention.worklog.autonomy_rate)`
     - `metric(locale, "tasks", String(surface.attention.worklog.accepted_count))`
     - 可选：`metric(locale, "saved_time", surface.attention.worklog.saved_hours_estimate + " h")`
- **验证：** home 路由的 shell metrics 数组包含新字段，无 type error

**Step 6：创建 home banner UI component（React）**  
- **位置：** `/Users/apple/Desktop/开发项目/WorkHub/apps/web/src/components/home/` （新增目录或现有目录）
- **文件名：** `AiWorklogBanner.tsx`
- **内容：**
  1. Props: `worklog?: AiWorklogSummaryVM`, `locale: WorkHubLocale`
  2. 如果 worklog 缺失 → return null（graceful）
  3. 渲染 HTML banner：
     ```
     <div class="ai-worklog-banner" data-r4-home-worklog="true">
       <span>今天 AI 干了 {worklog.accepted_count} 件</span>
       <span>·</span>
       <span>自主率 {worklog.autonomy_rate}</span>
       <span>·</span>
       <span>约省 {worklog.saved_hours_estimate} 小时</span>
       <span> ฅ(๑•́ ω •̀๑)ฅ</span>
     </div>
     ```
  4. 样式：插入 home 页面顶部（优先级在 primary attention item 下方，background_runs 上方）
  5. data-r4-* 标记：`data-r4-home-worklog="true"`, `data-r4-home-worklog-count="{count}"` 等（用于 smoke test 可见性）
- **集成位置：** 在 home route component（如 `HomeRouteComponent`）的 render 逻辑中调用
- **验证：** home 页面在浏览器中显示 banner，包含正确数字与 kaomoji

### Phase 4: QA 与验证（1 step）

**Step 7：添加 home banner smoke test 检查**  
- **文件：** `/Users/apple/Desktop/开发项目/WorkHub/apps/web/qa/r4-web-live-route-interaction.ts`
- **修改：**
  1. 在 `BrowserAudit` type 中追加：
     ```typescript
     worklogBannerVisible: boolean;
     worklogAcceptedCount: string | null;
     worklogAutonomyRate: string | null;
     ```
  2. 在浏览器审计脚本中添加选择器扫描：
     ```javascript
     worklogBannerVisible: !!document.querySelector('[data-r4-home-worklog="true"]'),
     worklogAcceptedCount: document.querySelector('[data-r4-home-worklog-count]')?.textContent ?? null,
     worklogAutonomyRate: document.querySelector('[data-r4-home-worklog-autonomy]')?.textContent ?? null,
     ```
  3. 输出到审计日志，确保 home route 的 70-step 检查不破裂
- **验证：** `pnpm run qa` 执行 smoke test，home 路由通过，worklog banner 数据可见

## QA Gate

### 保持现有 70-step 检查（apps/web/qa/r4-web-live-route-interaction.ts）绿色

**关键点：**
1. **data-r4-home-* 标记保留** — 现行 `BrowserAudit` 的所有 `routeData.home*` 字段保持不变，新增不破裂
2. **React props 指纹** — home 的 `AttentionHomeVM` type 扩展后，React 组件的 props fingerprint 会变（字段增加）
   - **处理：** 在 `fingerprint` 计算中包含 `worklog` 字段的 optional marker，确保指纹可追踪
   - **现行代码参考：** Line 88–94 的 `reactComponentFingerprint` — 需更新生成逻辑
3. **SSE 更新信号** — 如果 worklog 数据频繁变化（如秒级更新），需在 `propsUpdate: "sse-react-render"` 中体现
   - **建议：** 暂时保守，worklog 每分钟更新一次（lazy），不触发 SSE re-render

### 新增 gate checks

**Gate 1：Home banner 可见性**  
```
✓ worklogBannerVisible === true （当 surface.attention.worklog 存在时）
✓ worklogAcceptedCount 是数字型字符串（如 "5"）
✓ worklogAutonomyRate 包含 % 符号（如 "82%"）
```

**Gate 2：Contract 一致性**  
```
✓ AttentionHomeVM 的 worklog 字段是 optional
✓ aiWorklogSummaryVmSchema 通过 zod 验证
✓ API 响应的 JSON shape 符合 schema
```

**Gate 3：数据准确性**  
```
✓ autonomy_rate = (succeeded + finished runs today) / (all runs today)
✓ accepted_count >= 0
✓ saved_hours_estimate = accepted_count * 0.25（精确到小数点后 2 位）
```

**现行 gates 应继续适用：**
- `metrics_ready` — home 的 metrics 数组不为空（worklog metrics 可选增强）
- `feedback_log_ready` — 日志记录不变
- `request_count_fingerprint` — worklog API call 计数可见

### 测试用例

**TC1: worklog banner 显示正常**  
```
Given: user 访问 /
When: home page 加载完成
Then: 
  - banner 可见 (data-r4-home-worklog="true")
  - accepted_count = 实际数字
  - autonomy_rate = "XX%"
  - kaomoji 正确显示
```

**TC2: 数据缺失时优雅降级**  
```
Given: AI 工作日志服务暂时不可用（返回 error 或 timeout）
When: home page 加载
Then:
  - banner 不显示
  - home 页面其他功能正常（primary, queue, background_runs）
  - 无 console error
```

**TC3: 数据更新频率**  
```
Given: 用户在 home 页面停留 > 1 分钟
When: 后台新增 accepted_deliverable_changes
Then:
  - accepted_count 按需更新（可选 SSE 或定时轮询）
  - autonomy_rate 对应更新
```

## Handoff

### 下一阶段任务

1. **Advanced worklog 仪表板**  
   - 详细展示近 7 日、近 30 日的趋势
   - 按 project、work item 类别细分
   - 导出 CSV / PDF 报告
   - 文件：新建 `/dashboard/ai-worklog-detailed`

2. **自主率优化反馈循环**  
   - 自主率低的原因分析（escalation_count、conflict_count）
   - 推荐优化建议（阈值调整、模型选择）
   - 与 cost 仪表板联动

3. **团队级与企业级 worklog**  
   - 聚合多用户的 AI 战绩
   - permission model：owner/admin 可见所有用户，user 仅见自己
   - 排行榜与奖励体系（未来）

4. **集成 pilot-day1-metrics**  
   - 当前 pilot metrics 为 admin-only，考虑与非 admin worklog 的区分
   - 可能需统一 metrics service 架构

### 依赖清单

- ✓ `PilotMetricsRepository` — 已存在，可复用
- ✓ `AuthActor` — 已存在，current user middleware 依赖
- ✓ `attentionHomeVmSchema` — 正在修改
- ⏳ `HomeRouteComponent` — 需集成 worklog banner （等 Step 6 完成）
- ⏳ smoke test fixtures — 需更新 (Step 7)

### 文件清单

**新建：**
- `/apps/api/src/services/ai-worklog-metrics.ts`
- `/apps/web/src/components/home/AiWorklogBanner.tsx`

**修改：**
- `/packages/contracts/src/pages.ts` — attentionHomeVmSchema
- `/apps/api/src/routes/pilot.ts` 或 新建 `/routes/ai-worklog.ts`
- `/apps/api/src/routes/pages.ts` — home VM 生成逻辑
- `/apps/web/src/routes.ts` — metricsForSurface()
- `/apps/web/qa/r4-web-live-route-interaction.ts` — BrowserAudit & checks

**无修改：**
- `/packages/db/src/schema/core.ts` — agentRuns 表已有 status, finishedAt
- `/packages/db/src/repositories/pilot-metrics.ts` — readDay1MetricsRows() 已涵盖

---

**文档版本：** 1.0  
**最后更新：** 2026-06-14  
**作者：** 🤖 Claude Code  
**状态：** 待开工（ready for kick-off）
