---
module: R6-P3-cuu-pet-bubble-emotion-rework
layer: C-PET / CONTRACTS / UI
status: planned
owner: design+engineering
date: 2026-06-14
depends_on:
  - r6-compounding-ai-labor-plan-2026-06-14.md
---

# 桌宠 Cuu 气泡 + 情绪映射重做计划

> **范围**：缩减桌宠气泡形态（3 种）、重新映射情绪状态（10 个→5 个），保留全部 Live2D 黑猫/白猫资产与模型包，聚焦决策入口体验。
>
> **关键约束**：
> 1. **Live2D 资产不变** — `packages/cuu/src/model-pack.ts` 的 hijiki/tororo 模型包（lines 167–183）保持完全不变
> 2. **隔离独立** — 运行于 Tauri 桌宠进程（`apps/desktop-webview/src/`），Web 70 步 smoke 不受影响（`apps/web/qa/r4-web-live-route-interaction.ts`）
> 3. **契约兼容** — motion contract + Live2D 绑定保持有效

---

## 开工前必读

必读文件 + 行号：

1. **气泡渲染现状**：`/Users/apple/Desktop/开发项目/WorkHub/apps/desktop-webview/src/pet-surface.ts`
   - 第 1336–1374 行：`renderDesktopPetBubble()` 完整实现（现为大气泡，包含 chip / progress / sections / evidence / input hint）
   - 第 104–176 行：`desktopPetSurfaceCss` 所有气泡样式（`.wh-pet-bubble`, `.wh-pet-kicker`, `.wh-pet-title`, `.wh-pet-message`, `.wh-pet-actions` 等）
   - 第 131 行：`desktopPetWindowModeForCard()` 调用点（决定气泡打开/关闭窗口扩展）

2. **情绪状态定义**：`/Users/apple/Desktop/开发项目/WorkHub/packages/cuu/src/motion.ts`
   - 第 13–23 行：`CuuSpriteState` 类型（10 个状态 ⚠️ 需缩减到 5 个）
   - 第 70–131 行：`motionByState` 常量映射（idle/thinking/asking_approval/carrying_document/searching_evidence/syncing_files/worried/revision_requested/celebrating/offline）
   - 第 299–315 行：`bubbleModeForState()` 当前映射（确定每个状态用什么气泡形态）

3. **合同定义**：`/Users/apple/Desktop/开发项目/WorkHub/packages/contracts/src/experience.ts`
   - 第 12–23 行：`cuuStates` 数组（10 个状态，需与 `CuuSpriteState` 保持同步）
   - 第 24–25 行：`CuuState` 类型定义

4. **卡片生成逻辑**：`/Users/apple/Desktop/开发项目/WorkHub/packages/cuu/src/cards.ts`
   - 第 31–41 行：`CuuCardKind` 类型（bubble/question/approval/proposal/evidence/budget/sync/trace/completion/offline）
   - 第 134–144 行：`stateByAttentionKind` 映射（现状：clarification/approval→asking_approval，proposal_review/delivery_ready→carrying_document，等）
   - 第 303–323 行：`cardKindForAttention()` 确定卡片类型

5. **模型包验证**：`/Users/apple/Desktop/开发项目/WorkHub/packages/cuu/src/model-pack.ts`
   - 第 167–183 行：hijiki（黑猫）& tororo（白猫）模型包定义 ✅ **保留不动**
   - 第 185–188 行：`cuuModelPackRegistry`（两个模型包在此）

6. **测试基线**：
   - `apps/web/qa/r4-web-live-route-interaction.ts` — 70 步 web smoke（需保持绿）
   - `apps/api/src/qa/cuu-r3-*.ts` — 已有 cuu-r3 smokes（8 个，全需保持绿）

---

## 目标

**最小化可交付**：

1. **缩减气泡形态**（3 种）
   - **cream 审批气泡** `#FEFBF0` → `#F1DC9C`（暖黄）：summary 单行标题 + 2 个核心 action（批准/驳回）⚡
   - **white 对话气泡** `#FFFFFF`：summary + 1 个全宽 action（关闭/下一步）📝
   - **light-blue 检索气泡** `#EAF4FE` → `#B6D8F7`（天蓝）：summary + 1 个 action（应用/取消）🔍

2. **重映射情绪状态**（10 → 5）
   - `idle`（待命）← 当前 idle + offline hidden 时
   - `thinking`（思考）← 当前 thinking + carrying_document + searching_evidence + syncing_files（一并归为"忙碌思考"）
   - `approval`（求批准）← 当前 asking_approval
   - `worried`（担心）← 当前 worried + revision_requested（两者都是"有问题，需人工"）
   - `celebrating`（庆祝）← 当前 celebrating（保持）

3. **更新契约**
   - 更新 `cuuStates`（5 个）→ 审核 `motion.ts` 映射 → 验证 Live2D motion 覆盖率
   - 更新 `CuuSpriteState` 对应 motion clips（5 个基础 + 保留空闲微动作）
   - 更新 `stateByAttentionKind` 让 Attention 重新映射到新 5 态

4. **深链回 Web**
   - 每个气泡顶部加隐藏锚点 `[data-pet-payload-ref-href]`，用户点击"了解更多"时打开对应 web 路由（proposal / agent-run / workitem 等）
   - 气泡内 summary 限制字数（审批 100 字，对话 150 字），超限加"→ Web 查看完整"链接

5. **保留卖萌文案**
   - 气泡顶部"Cuu"标题 + state 标签（"审批中…"⏱️ / "思考中…" 🧠 / "检索中…" 🔎）
   - 各情绪状态的 `reduced_motion_fallback`（`motion.ts` lines 75–129）保留原有卖萌中文文案

---

## 数据流与契约

### 气泡种类决定逻辑

```
card.state (CuuState, 5 个之一)
  ↓
bubbleModeForState(state: CuuState) → BubbleMode
  ├─ "idle" → none （隐藏气泡，仅展示猫）
  ├─ "thinking" → tip （cream 窄气泡）
  ├─ "approval" → card （white 宽卡）
  ├─ "worried" → card （light-blue 宽卡）
  └─ "celebrating" → tip （cream 窄气泡）
  ↓
renderDesktopPetBubble({ card, ... }) 
  ├─ mode=tip → 仅 title(summary) + top-1 action（最推荐）
  └─ mode=card → title + summary + top-2 actions
```

### 情绪映射流

```
AttentionItem.kind（来自 API /attention）
  ↓
stateByAttentionKind[kind] → CuuState (v2)
  ├─ clarification, approval → "approval"
  ├─ proposal_review, delivery_ready → "thinking"（现在归为文档处理）
  ├─ escalation, sync_conflict, budget → "worried"（现在统一为"警告"）
  ├─ knowledge_result → "thinking"（搜索也是思考）
  ├─ system_health → "idle"
  └─ （offline 状态不再作为 AttentionItem，改为 window state）
```

### 合同与验证

**packages/contracts/src/experience.ts (lines 12–25)**
```ts
export const cuuStates = [
  "idle",
  "thinking", 
  "approval",
  "worried",
  "celebrating"
] as const;
export type CuuState = z.infer<typeof cuuStateSchema>;
```

**packages/cuu/src/motion.ts (lines 13–23 & 70–131)**

新 `CuuSpriteState`（只需 5 个核心 motion），空闲微动作保留独立：
```ts
export type CuuSpriteState =
  | "idle_breathe"
  | "thinking_tail"
  | "asking_approval_bounce"
  | "worried_ears"
  | "celebrating_jump";

// 空闲微动作保留（已有 cuuIdleMicroActionSpecs）
type CuuIdleMicroAction = 
  | "idle_breathe" | "idle_blink" | "idle_tail_sway" | "look_at_mouse" | "wave_hello"
  [保持不变]
```

新 `motionByState` 映射（lines 70–131 改写为）：
```ts
const motionByState: Record<CuuState, Omit<CuuMotionHint, "state">> = {
  idle: { sprite_state: "idle_breathe", emphasis: "calm", loop: true, ... },
  thinking: { sprite_state: "thinking_tail", emphasis: "busy", loop: true, ... },
  approval: { sprite_state: "asking_approval_bounce", emphasis: "urgent", loop: true, ... },
  worried: { sprite_state: "worried_ears", emphasis: "urgent", loop: true, ... },
  celebrating: { sprite_state: "celebrating_jump", emphasis: "celebratory", loop: false, ... }
};
```

---

## 施工顺序

### 第 1 阶段：契约定义（2 个文件）

1. **更新合同**（`packages/contracts/src/experience.ts:12–25`）
   - 将 `cuuStates` 从 10 个缩到 5 个 ✅
   - 版本标记 `v1` → `v2`（或注释说明变更）
   - 验证：`npx tsc --noEmit`

2. **验证引用**
   - 检查 `packages/contracts/src/` 下有无其他硬编码 10 态列表 → 改为引用 `cuuStates`
   - 运行 `packages/contracts/package.json` 的 test 脚本

### 第 2 阶段：motion contract（`packages/cuu/src/motion.ts`，～150 行改写）

1. **更新 `CuuSpriteState` 类型**（line 13–23）
   - 从 10 态缩到 5 个：idle_breathe / thinking_tail / asking_approval_bounce / worried_ears / celebrating_jump
   - 保留 `CuuIdleMicroAction` 不动（idle_breathe / idle_blink / idle_tail_sway / look_at_mouse / wave_hello）

2. **更新 `motionByState` 常量**（line 70–131）
   - 新增 5 条映射条目：idle / thinking / approval / worried / celebrating
   - 调整 `emphasis`、`loop`、`reduced_motion_fallback` 文案
   - 删除旧的 10 条映射

3. **更新 `bubbleModeForState()`**（line 299–315）
   - idle → none
   - thinking → tip
   - approval → card
   - worried → card
   - celebrating → tip

4. **验证**
   - `createCuuBehaviorState()` 仍需遍历所有 cuuStates → 自动适配（无改动需）
   - `cuuBehaviorStateForState()` 获取 loop motion → 检查 5 个状态都在 manifest 里
   - 跑 `packages/cuu/src/motion.test.ts`

### 第 3 阶段：卡片重映射（`packages/cuu/src/cards.ts`，～15 行改写）

1. **更新 `stateByAttentionKind`**（line 134–144）
   ```ts
   const stateByAttentionKind: Record<AttentionItem["kind"], CuuState> = {
     clarification: "approval",
     approval: "approval",
     proposal_review: "thinking",      // ← 改：was "carrying_document"
     escalation: "worried",
     sync_conflict: "worried",
     knowledge_result: "thinking",     // ← 改：was "searching_evidence"
     budget: "worried",                // ← 改：was "worried"（保持）
     delivery_ready: "thinking",       // ← 改：was "carrying_document"
     system_health: "idle"
   };
   ```

2. **检查 `stateForWorkItem()`**（line 648–662）
   - 逻辑自动适配（已用 `CuuState` 类型）
   - 验证 workitem status 映射到新 5 态是否合理

3. **检查 `stateForAgentRun()`**（line 761–772）
   - 同上自动适配

4. **验证**
   - 跑 `packages/cuu/src/cards.test.ts`
   - 检查所有 `cardFrom*()` 函数生成的卡片 `.state` 合法

### 第 4 阶段：气泡模板缩减（`apps/desktop-webview/src/pet-surface.ts`，～100 行改写）

1. **简化 `renderDesktopPetBubble()`**（line 1336–1374）
   - 移除 compact 时的 progress / sections / evidence / input hint 渲染
   - 仅保留：
     - **tip 模式（thinking / celebrating）**：title + top-1 action
     - **card 模式（approval / worried）**：title + summary + top-2 actions
     - **none 模式（idle）**：不渲染气泡 DOM（返回 `""` 空字符串）
   
   ```ts
   function renderDesktopPetBubble(input: {
     card?: CuuCard | undefined;
     status_text?: string | undefined;
     window_mode_error?: string | undefined;  // 保留
   }, locale: WorkHubLocale) {
     if (!input.card && !input.status_text) {
       return "";  // 不显示气泡
     }
     
     const card = input.card;
     const bubbleMode = card?.motion.state; // idle→none, thinking→tip, etc.
     
     if (bubbleMode === "idle") return ""; // 隐藏
     
     const isNarrow = bubbleMode === "tip"; // thinking / celebrating
     const actions = (card?.actions ?? [])
       .slice(0, isNarrow ? 1 : 2)
       .map(renderPetAction)
       .join("");
     
     return `<aside class="wh-pet-bubble" ...>
       <div class="wh-pet-kicker">...</div>
       <strong class="wh-pet-title">${escapeHtml(card?.title ?? "")}</strong>
       ${!isNarrow ? `<p class="wh-pet-message">${escapeHtml(card?.message ?? "")}</p>` : ""}
       ${actions}
       ${input.window_mode_error ? `<p class="wh-pet-status">${escapeHtml(input.window_mode_error)}</p>` : ""}
     </aside>`;
   }
   ```

2. **更新气泡 CSS**（line 104–176）
   - 添加 3 种气泡颜色变体：
     ```css
     .wh-pet-bubble[data-bubble-kind="approval"] { background: #FEFBF0; border-color: #F1DC9C; }
     .wh-pet-bubble[data-bubble-kind="chat"] { background: #FFFFFF; border-color: rgba(...); }
     .wh-pet-bubble[data-bubble-kind="search"] { background: #EAF4FE; border-color: #B6D8F7; }
     ```
   - 添加 tip/card 尺寸变体

3. **关键数据属性保留**
   - ✅ `[data-pet-bubble-kind]` 改为映射：approval/thinking → "approval", worried → "search", celebrating → "approval"（或各自"chat"）
   - ✅ `[data-cuu-card-id]`、`[data-pet-payload-ref-*]` 保留（web deep-link）
   - ✅ `[data-pet-bubble-priority]` 保留

### 第 5 阶段：Web 深链支持（`apps/desktop-webview/src/pet-surface.ts` 第 944–1010 行）

1. **气泡点击处理**
   - 已有 action 链接处理（`renderPetAction()` line 1402–1407）
   - 确保 `card.actions[0].href` 指向 web 路由（`/proposals/xxx`, `/agent-runs/xxx/replay` 等）✅

2. **"了解更多" 按钮**（可选，第二阶段优化）
   - 如果 summary 被截断，自动在末尾加隐藏 action：
     ```ts
     const moreAction = card?.payload_ref?.href ? {
       id: "more_details",
       label: "了解更多 →",
       tone: "secondary",
       href: card.payload_ref.href
     } : null;
     ```

### 第 6 阶段：模型包验证（`packages/cuu/src/model-pack.ts`）

1. **确认 Live2D motion binding**（line 445–456）
   - `createCatLive2DMotionBindings()` 遍历 `requiredCuuModelPackMotionStates()`
   - 该函数汇总：业务 motion（new 5 态）+ idle micro actions（5 个）
   - **结果应该是 10 个 motions 总数**（5 业务 + 5 micro），与现状相同 ✅

2. **验证 behavior manifest**
   - `behavior_manifest.states` 需有新 5 态的全部条目
   - `behavior_manifest.idle_random` 保留 5 个 micro action
   - 调用 `assertCuuModelPackCanBeDefault()` 验证两个模型包

3. **运行**
   ```bash
   packages/cuu/src/model-pack.test.ts
   ```

### 第 7 阶段：桌宠 smoke 测试绿线（`apps/api/src/qa/cuu-r3-*.ts`，全 8 个）

1. **覆盖范围**
   - `cuu-r3-launcher-harness.ts` — agent launcher 卡片 → 新映射确保 state 合法
   - `cuu-r3-run-stream-smoke.ts` — run stream cardFromAgentRunEvent → 新 5 态
   - `cuu-r3-run-failure-smoke.ts` — escalated/failed runs → "worried" 态
   - `cuu-r3-reload-restore-smoke.ts` — restore 卡片 → 新态兼容
   - `cuu-r3-error-fault-smoke.ts` — error cards → "worried" 态
   - 其余 3 个 smoke（dev-server, launcher-to-run, tauri-server）验证不破

2. **逐个跑通**
   ```bash
   npm test -- cuu-r3-launcher-harness.test.ts
   npm test -- cuu-r3-run-stream-smoke.ts
   # ... 等等
   ```

### 第 8 阶段：Web 70 步 smoke 保绿（`apps/web/qa/r4-web-live-route-interaction.ts`）

1. **smoke 覆盖桌宠吗？**
   - r4-web 是 **web 路由 only**，不覆盖 `/pet` surface → 不受此重做影响 ✅
   - 但 CuuCard 来自同一 contracts → 需验证卡片类型生成在 web 端也合法

2. **关键验证点**
   - home 首页 attention items → 新 stateByAttentionKind 映射 → state 合法
   - 各 route 的 page VM 中 CuuCard（如有）→ 新 state 合法
   - **data-r4-home-\* 等 70 step 标记保留**（不涉及）

3. **运行**
   ```bash
   npm test -- r4-web-live-route-interaction.ts
   ```

### 第 9 阶段：集成 smoke（端到端）

1. **桌宠 × Web 同时启动**
   - Tauri dev: `npm run tauri dev`
   - 验证：卡片从 API → agent-run event → cardFromAgentRunEvent → 新 state → 气泡绘制
   - 点击气泡深链 → web 打开对应路由 ✅

2. **手工验证视觉**
   - 5 态气泡颜色、大小、action 数量对应
   - 卖萌文案未丢失
   - Live2D 动作与状态同步

---

## QA Gate

### Web 70 步 smoke 保绿

**现状**：`apps/web/qa/r4-web-live-route-interaction.ts` 运行 70 个交互步骤，卡的是 data-* 标记 + 请求计数指纹 + notice 语义。

**本变更影响范围**：
- ✅ **zero impact on web smoke**（web smoke 是 web routes only，`/pet` surface 是桌宠进程隔离运行）
- ⚠️ **但需验证**：如果 web 路由有 CuuCard 字段（如 home VM 的 attention），新 state 映射必须合法

**保绿策略**：
1. 跑 smoke 前，先确保 `packages/contracts/src/experience.ts` 的 cuuStates 定义与 `motion.ts` 同步
2. smoke 中若有卡片生成（如 `cardFromAttentionItem()`），新映射必须不生成非法 state
3. **不改 web fixture**（fixture 中的 AttentionItem 不变），只改 state 映射逻辑 → smoke 过

### 新增 cuu smoke 测试

**现有 cuu-r3-* smokes**（8 个，全需保绿）：
- `cuu-r3-launcher-harness.test.ts`
- `cuu-r3-run-stream-smoke.ts`
- `cuu-r3-run-failure-smoke.ts`
- `cuu-r3-reload-restore-smoke.ts`
- `cuu-r3-error-fault-smoke.ts`
- `cuu-r3-dev-server-launcher-smoke.ts`
- `cuu-r3-launcher-to-run-smoke.ts`
- `cuu-r3-tauri-run-stream-server.ts`

**新增**（可选，第二阶段）：
- `cuu-r3-emotion-mapping-smoke.ts` — 验证 10 种 AttentionItem.kind → 新 5 态映射无误
- `cuu-r3-bubble-render-smoke.ts` — 验证气泡 tip/card/none 3 种形态渲染正确

### 单元测试保绿

需保绿的单元测试：
- `packages/cuu/src/motion.test.ts` — motion contract（新 CuuSpriteState + motionByState）
- `packages/cuu/src/cards.test.ts` — card generation（新 stateByAttentionKind）
- `packages/cuu/src/model-pack.test.ts` — model pack validation（Live2D motion binding）
- `apps/desktop-webview/src/pet-surface.ts` 无专属单元测试（smoke 覆盖）

**运行**：
```bash
npm test -- packages/cuu/src/motion.test.ts
npm test -- packages/cuu/src/cards.test.ts
npm test -- packages/cuu/src/model-pack.test.ts
npm test -- cuu-r3-*.test.ts
npm test -- cuu-r3-*.ts  # smokes
npm test -- r4-web-live-route-interaction.ts
```

---

## Handoff

### 第二阶段优化方向

1. **气泡样式优化**（V0 后）
   - 动画进入/退出 transition（200ms，ease-out）
   - hover state on action buttons
   - 响应式文本截断（mobile vs desktop）

2. **卖萌文案全量**（V0 后，对接 i18n）
   - 各 state 的卖萌 icon 与文案（目前已有 `reduced_motion_fallback` 文案，可直接用）
   - 关键 action 按钮文案本地化（"批准"、"下一步"等）

3. **深链与 web 路由联动**（V0.5）
   - 气泡"了解更多"按钮跳转到 web 对应页面（proposal / workitem / agent-run）
   - 跟进 window bridge 是否支持 `focusMainRoute()`（已有，line 42）

4. **emotion state 与 motion clip 的实时同步**
   - 确保 motion.ts 的 `cuuMotionForState()` 与 Live2D renderer binding 始终对齐
   - 后续如增新 sprite state，自动验证模型包覆盖率

### 数据流衔接

后续阶段（如 S2 Skill 自迭代或 W1 决策收件箱）无需改动此处：
- `cards.ts` 的卡片生成逻辑 ✅ 完全兼容新 5 态
- `motion.ts` 的 Live2D binding ✅ 不变
- `model-pack.ts` ✅ 资产不动

### 文档同步

完成后，更新：
- `docs/workhub/05-clients/cuu-r3-agent-entry.md` — 补充新 5 态定义（可选）
- `CHANGELOG.md` — 记录 CuuState 从 10→5 的迁移（可选）

---

## 附：当前 10 态 → 新 5 态映射表

| 当前状态 | 新映射 | 理由 |
|---------|-------|------|
| `idle` | `idle` | 保持 |
| `thinking` | `thinking` | 保持 |
| `asking_approval` | `approval` | 求批准，归为 `approval` |
| `carrying_document` | `thinking` | 处理文档也是忙碌思考 |
| `searching_evidence` | `thinking` | 搜索也是思考 |
| `syncing_files` | `thinking` | 同步也是等待 |
| `worried` | `worried` | 保持 |
| `revision_requested` | `worried` | 需修改的问题，归为 `worried` |
| `celebrating` | `celebrating` | 保持 |
| `offline` | `idle`（隐藏） | offline 改为 window state，不映射为卡片状态 |

---

## 附：气泡形态参考

### Cream 审批气泡（#FEFBF0）

```
┌─ Cuu 审批中 ⏱️ ─┐
│ 请批准变更：      │
│ 新增首页模块      │
│                   │
│ [批准]  [驳回]    │
└───────────────────┘
```

**宽度**：~180px | **最大行数**：title 1 行 + summary 1 行 | **action**：2 个

### White 对话气泡（#FFFFFF）

```
┌─ Cuu 下一步 →  ─┐
│ 请选择下列方案   │
│                 │
│ ☑ 方案 A        │
│ ☐ 方案 B        │
│ ☐ 方案 C        │
│                 │
│    [提交]       │
└─────────────────┘
```

**宽度**：~260px | **最大行数**：title 1 + summary 1 + chips 3–4 + action 1 | **action**：1 个全宽

### Light-Blue 检索气泡（#EAF4FE）

```
┌─ Cuu 搜索结果 🔍 ─┐
│ 找到 3 份相关文档  │
│                   │
│ [应用到任务]  [✕] │
└───────────────────┘
```

**宽度**：~180px | **最大行数**：title 1 + summary 1 | **action**：2 个（主 + 次）

---

**编制日期**：2026-06-14 | **预计周期**：1–2 周（V0） | **风险**：中（隔离 smoke 覆盖，Live2D 资产保留）
