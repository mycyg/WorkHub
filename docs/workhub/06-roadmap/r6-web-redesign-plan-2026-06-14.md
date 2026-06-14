---
module: R6-web-redesign
layer: C-WEB / Design system
status: planned
owner: design+engineering
date: 2026-06-14
depends_on:
  - r6-compounding-ai-labor-plan-2026-06-14.md
---

# R6 Web 设计重做：V0 设计 token + W1 决策收件箱首页 + W2 审批中心三栏 + 卖萌文案

## 开工前必读

### 代码现状与约束
- **设计 token CSS 位置**：`packages/ui/src/gold-path/render.ts:45-64`（`goldPathCss` 数组）、`route-components.ts:103-133`（`webRouteComponentCss`）、`product-shell.ts`（CSS 变量映射）
- **HOME 页核心实现**：`route-components.ts:717-781` 中 `renderHomeRouteComponent()`，返回 `WebRouteComponent`；数据源 `AttentionHomeVM` 包含 `primary`（主要决策项）、`background_runs`（≤4 AI 进行中任务）、`queue`（队列）；标记 `data-r4-home-primary`/`data-r4-home-decision`/`data-r4-home-ai-working`/`data-r4-home-queue`/`data-r4-home-evidence-list`
- **APPROVALS 页核心实现**：`route-components.ts:920-980` 中 `renderApprovalsRouteComponent()`；数据源 `ApprovalCenterVM` 包含 `items`（待审批列表）、`requests`（路由记录）、`counts`；标记 `data-r4-route-component="approvals"`、`data-r4-approval-queue`、`data-r4-approval-action-panel`、`data-r4-approval-item`、`data-r4-approval-request`
- **React 指纹保护**：`createHomeReactRouteComponent()`（`route-react-components.ts`）须保留；HTML 回退和 React 组件间必须保持 `primaryHrefs` 一致，SSE 下只推 data 不推 HTML
- **70 步 web smoke 约束**（`apps/web/qa/r4-web-live-route-interaction.ts`）：只检验 `data-*` 结构标记 + 请求计数 + notice 语义，**不卡可见文案和颜色值**；fixture 字符串（如 decision title / action label）被 smoke 测试用例硬编码，改文案需同步 smoke 里的 `fixture:*` 字符串比对
- **CSS 变量现状**：已有 `--ink`/`--muted`/`--line`/`--paper`/`--soft`/`--blue`/`--green`/`--coral`/`--amber`/`--violet`（`render.ts:46`）以及 product 层的 `--wh-product-*` 变量族（`route-components.ts:108-131`）

## 目标

完成 R6 视觉重做的前三阶段（V0 → W1 → W2），建立高保真设计系统并重写两个核心 Web 页面。

**V0 设计 token**
- 将高保真调色板（靛蓝 `#4F46E5`、绿色 `#15A05A`、红色 `#E5484D`、琥珀色 `#E0892A`）和圆角 token 落地到 CSS 变量
- 只改变量值和类样式，**绝不动 DOM 结构或 class 名**
- 验证：所有 data-r4-* marker 与 React fingerprint 保持原样

**W1 决策收件箱首页（概念图①方向）**
- 将 `renderHomeRouteComponent()` HTML 改造为：
  - 一张**大决策卡**（CR 变更申请：kicker 变更申请+编号 / AI 摘要在 grid（改了什么、为何重要、涉及文件、用到证据）/ status row（检查数/风险/置信度/可回滚）/ actions 批准/打回/转交/记住我的审批）
  - **AI 进行中状态表**（≤4 行：任务名 / 状态✕4（调研中/处理数据/分析中/已完成）/ 进度条 / avatar / ETA）
  - **3 个 metric chip**（需要你决定 / AI 进行中 / 风险）
  - 保留 `data-r4-home-*` 标记与 React 组件指纹
- 卖萌文案整合：首页文案 kicker/title/summary + 背景运行任务名称

**W2 审批中心三栏（概念图④方向）**
- 将 `renderApprovalsRouteComponent()` 改为左中右三栏布局：
  - **左栏**：待审批列表（优先级/kind/title/SLA 截止）
  - **中栏**：变更详情（变更项目、影响分析表、接受标准检查、AI 解释）
  - **右栏**：我的操作（batch 批准/打回按钮、置信环、审批流程 timeline、讨论区）
  - 保留 `data-r4-approval-*` 标记
- 文案规范化：action label（批准/打回/转交）一致

**卖萌文案与颜文字语气规范（全文贯穿）**
- 气质定位：**暖、一人称**，用可爱颜文字如 `٩(◜◡◝)۶`、`(๑˃ᴗ˂)ﻭ`、`(=^･ω･^=)` 在合适位置修饰
- 规范文案 keys 和实施规则（见下文）
- 同步 fixture 字符串与 smoke 测试

## 数据流与契约

### V0 CSS Token 架构

**变量层次（自下而上）**
```
底层原色              中间语义                   组件消费层
--color-ink           --wh-product-ink           .wh-r4-route-head h2 { color }
  #1A1D26             (ref)                      .wh-pill { color }
--color-secondary                                
  #5B616E             --wh-product-muted         .wh-r4-route-row p { color }
--color-primary                                  
  #4F46E5             --wh-product-blue          .wh-btn-primary { background }
--color-success                                  
  #15A05A             --wh-product-green         .wh-check { border-color }
--color-error                                    
  #E5484D             --wh-product-red           .wh-btn-danger { background }
--color-warning                                  
  #E0892A             --wh-product-amber         .wh-warning { border-color }
--color-page                                     
  #F7F8FA             --wh-product-page          .wh-shell { background }
--color-panel                                    
  #fff                --wh-product-panel         .wh-panel { background }
--color-border                                   
  #E6E7EB             --wh-product-line          .wh-r4-route { border }
--color-border-alt                               
  #EEF0F3                                        
--color-indigo-light                             
  #EEF0FE             --wh-product-blue-light    .wh-r4-route-card[data-intake-option-selected]
--color-indigo-tint                              
  #F5F5FE                                        
--color-indigo-pale                              
  #D9DBF5                                        
--color-success-light                            
  #E7F0EA             --wh-product-green-light   (approval accept state)
--color-success-lighter                          
  #E7F6EE                                        
--color-error-light                              
  #FCECEC             --wh-product-red-light     (approval reject state)
--color-warning-light                            
  #FCF3E6             --wh-product-amber-light   (risk warning state)
--radius-card         12-16px                    border-radius 卡片
--radius-button       9-13px                     border-radius 按钮
--shadow-sm           0 2px 8px rgba(...)        
--shadow-md           0 12px 28px rgba(...)      
```

### W1 HOME 页 VM 扩展

新增可选字段至 `AttentionHomeVM`（`packages/contracts/src/pages.ts:39`）：

```typescript
// 已有字段保留
type AttentionHomeVM = {
  primary?: AttentionItem;           // 主要决策卡
  background_runs: BackgroundRun[];  // AI 进行中 ≤4 行
  queue: AttentionItem[];            // 队列
  cuu_state: CuuState;
  
  // ✅ 新增可选字段（缺失时优雅降级，不破 smoke）
  worklog?: {
    autonomy_rate: number;           // 0-100 自主率 %
    accepted_today: number;          // 今日直出件数
    saved_hours_estimate: number;    // 估算省时 h
  };
};

// BackgroundRun 细化（≤4 行展示）
type BackgroundRun = {
  run_id: string;
  title: string;                     // AI 任务名
  preview_text: string;              // 简短摘要
  state: "researching"|"processing"|"analyzing"|"completed";
  progress_percent?: number;         // 进度条 0-100
  avatar_url?: string;              // 执行人头像
  eta_minutes?: number;              // 预计剩余分钟
};
```

### W2 APPROVALS 页 VM 扩展

现有 `ApprovalCenterVM` 增强（`packages/contracts/src/pages.ts`）：

```typescript
type ApprovalCenterVM = {
  items: ApprovalItem[];
  requests: ApprovalRequest[];
  counts: Record<string, number>;
  
  // ✅ 新增字段（三栏布局）
  selected_item_id?: string;         // 当前选中待审批项
  
  // ApprovalItem 细化
  details?: {
    changes: DeliverableChange[];
    impact_table?: ChangeImpactRow[];
    acceptance_checks: AcceptanceCheck[];
    ai_rationale_md?: string;        // AI 解释
  };
};

type ChangeImpactRow = {
  domain: string;                    // "database" | "api" | "ui"
  what_changed: string;              // 简述
  risk_level: "low"|"medium"|"high";
  affected_teams?: string[];
};

type AcceptanceCheck = {
  id: string;
  label: string;                     // 检查项描述
  status: "passed"|"warning"|"review_required";
  detail?: string;
};
```

### 卖萌文案 key 清单与规范

**Home 页文案**（`goldPathT(locale, key)`）
```typescript
type GoldPathCopyKey = 
  | "home.kicker"           // "变更申请" 或修饰为 "变更申请 ٩(◜◡◝)۶" 
  | "home.decisionTitle"    // "需要你决定"
  | "home.aiWorkingTitle"   // "AI 进行中"
  | "home.entryTitle"       // "待处理队列"
  | "home.emptyTitle"       // "一切就绪 (=^･ω･^=)"
  | "home.emptySummary"     // "暂无待决事项，AI 在后台安静运行。"
```

**Approvals 页文案**（`goldPathT(locale, key)` + `routeT(locale, key)`）
```typescript
type RouteCopyKey =
  | "approvals.kicker"      // "审批中心"
  | "approvals.pendingTitle"// "待决定"
  | "approvals.slaTitle"    // "截止时间"
  | "approvals.factsTitle"  // "流转信息"
  | "approvals.ruleText"    // "人审批、AI 改进"
```

**Product shell 导航文案**（`productShellCopy`）
```typescript
ProductShellCopyKey = 
  | "nav.home"              // "总览"
  | "nav.approvals"         // "审批"
  | "rail.nextApprovals"    // "打回理由会回灌给 AI 继续改。"
  | "masthead.approvals"    // "把需要你拍板的审批..."
```

**规则**
1. **新增卖萌文案**的地方：
   - 空态提示（"一切就绪"、"暂无"）
   - 时间提醒（"截止时间"、"逾期"）
   - 鼓励语（审批完成后、AI 自主完成后）
   - 导航说明（sidebar hint）
2. **禁区**：action label（批准/打回）、状态字（已完成/进行中）、数据值（数字、日期、件数）
3. **字体**：颜文字来自以下活跃库：
   - `٩(◜◡◝)۶` - 高兴、满足
   - `(๑˃ᴗ˂)ﻭ` - 撒娇、温暖
   - `(=^･ω･^=)` - 宠物般可爱、陪伴
   - `(´；ω；`)` - 感动、惭愧（审批打回时）
4. **同步**：文案改动后必须更新 `apps/web/qa/r4-web-live-route-interaction.ts` 中 fixture 硬编码字符串（如果 smoke 里有 `expect(html).toContain(goldPathT(...))`）

## 施工顺序

### 1. V0 设计 token 落地（原子变更，零 gate 冲击）

#### 1.1 提取现有 CSS 变量并定义高保真调色板
- **位置**：`packages/ui/src/gold-path/render.ts:45-46` 的 `:root` 段
- **改动**：
  ```typescript
  // 原
  ":root{color-scheme:light;--ink:#182033;--muted:#5e6a86;--line:#dfe5f1;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--coral:#ee6b5f;--amber:#d98b16;--violet:#7863e6}"
  
  // 新
  ":root{color-scheme:light;--ink:#1A1D26;--secondary:#5B616E;--muted:#9AA0AC;--line:#E6E7EB;--line-alt:#EEF0F3;--paper:#F7F8FA;--panel:#fff;--soft:#fff;--blue:#4F46E5;--blue-light:#EEF0FE;--blue-tint:#F5F5FE;--blue-pale:#D9DBF5;--green:#15A05A;--green-light:#E7F0EA;--green-lighter:#E7F6EE;--red:#E5484D;--red-light:#FCECEC;--coral:#ee6b5f;--amber:#E0892A;--amber-light:#FCF3E6;--violet:#7863e6;--radius-card:12px;--radius-button:9px}"
  ```
  
#### 1.2 同步 product shell 变量映射
- **位置**：`product-shell.ts` 中 `.wh-r4-route-*` 相关 CSS
- **改动**：map 新变量到 `--wh-product-*` 族
  ```typescript
  ".wh-r4-route-head{...;color:var(--wh-product-ink,#1A1D26)}"
  ".wh-r4-route-row p{...;color:var(--wh-product-muted,#9AA0AC)}"
  ".wh-r4-route-kicker{...;color:var(--wh-product-blue,#4F46E5)}"
  ".wh-r4-route-card--accent{border-color:rgba(79,70,229,.22)}"  // #4F46E5
  ".wh-r4-route-meter span{...;background:linear-gradient(90deg,#15A05A,#E0892A)}"
  ```

#### 1.3 验证 data-r4-* marker 与 React fingerprint
- **检验清单**：
  - `data-r4-route-component` 标记存在
  - `data-r4-home-primary`/`data-r4-home-decision`/`data-r4-home-ai-working`/`data-r4-home-queue`/`data-r4-home-evidence-list` 完整
  - `createHomeReactRouteComponent()` 返回的 `reactComponent` 对象结构不变
  - `webRouteComponentCss` 中 `.wh-r4-*` 类全数保留
  - 测试：`pnpm verify` smoke 通过且 0 visual regression

### 2. W1 决策收件箱首页（核心页面重写）

#### 2.1 扩展 HOME 页 VM（contracts）
- **文件**：`packages/contracts/src/pages.ts:39`
- **改动**：`AttentionHomeVM` 增加可选 `worklog` 字段与 `BackgroundRun` 细化
  ```typescript
  export type AttentionHomeVM = {
    primary?: AttentionItem;
    background_runs: BackgroundRun[];
    queue: AttentionItem[];
    cuu_state: CuuState;
    worklog?: {
      autonomy_rate: number;
      accepted_today: number;
      saved_hours_estimate: number;
    };
  };
  ```
- **验证**：smoke 中 `data-r4-home-*` marker 检验仍通过（worklog 字段缺失时回退）

#### 2.2 重写 renderHomeRouteComponent() HTML 输出
- **文件**：`packages/ui/src/gold-path/route-components.ts:717-781`
- **改动**：
  - 输出结构重组为：
    1. **header** 含 kicker "变更申请 ٩(◜◡◝)۶" + 主要决策卡 title + summary
    2. **metric chips grid**（3 列）：需要你决定、AI 进行中、风险（改用新调色板）
    3. **大决策卡**（.wh-r4-route-card--primary）：
       - kicker "变更申请"
       - title（CR 编号 + 紧急度）
       - **AI 摘要 grid**（4 列）：改了什么、为何重要、涉及文件、用到证据
       - **status row**：检查 X/Y、风险等级、置信度 X%、可回滚 yes/no
       - **action row**：批准（绿）、打回（红）、转交、记住我的审批
    4. **AI 进行中表**（≤4 行）：
       - 列：任务名、状态（调研中→进度条、处理数据→进度条、分析中→进度条、已完成✓）、avatar、ETA
       - marker `data-r4-home-background-run` 保留
    5. **队列与证据并排**：
       - 左列：待处理队列（marker `data-r4-home-queue`）
       - 右列：证据列表（marker `data-r4-home-evidence-list`，≤3 条）
  - **保留约束**：
    - 所有 `data-r4-home-*` 标记位置不变
    - `primaryHrefs` 导出逻辑（action href）一致
    - React 指纹（`createHomeReactRouteComponent()` 返回对象）保持

#### 2.3 可选字段优雅降级
- 若 `vm.worklog` 缺失，metric chips 显示"需要你决定"、"AI 进行中"、"待处理"（无数字）
- 若 `background_runs` 为空，显示空态文案"暂无 AI 进行中任务"

#### 2.4 文案规范化与 fixture 同步
- **新增文案 keys**（`route-components.ts` 顶部 `RouteCopyKey` union）：
  ```typescript
  "home.changeRequest"      // "变更申请"
  "home.decideTitle"        // "需要你决定"
  "home.checkCount"         // "检查 {x}/{y}"
  "home.acceptAction"       // "批准"（+绿色）
  "home.rejectAction"       // "打回"（+红色）
  "home.routeAction"        // "转交"
  "home.rememberMe"         // "记住我的选择"
  "home.aiWorkingEmpty"     // "暂无 AI 进行中任务"（修饰版本）
  ```
- **Smoke 同步**：若 fixture 中有硬编码字符串（如 `expect(html).toContain("变更申请")`），改为 `expect(html).toContain(goldPathT(locale, "home.changeRequest"))`

### 3. W2 审批中心三栏（核心页面重写）

#### 3.1 扩展 APPROVALS 页 VM（contracts）
- **文件**：`packages/contracts/src/pages.ts`
- **改动**：`ApprovalCenterVM` 增加详情字段与选中项追踪
  ```typescript
  export type ApprovalCenterVM = {
    items: ApprovalItem[];
    requests: ApprovalRequest[];
    counts: Record<string, number>;
    selected_item_id?: string;
    items_detail?: Record<string, {
      changes: DeliverableChange[];
      impact_table?: ChangeImpactRow[];
      acceptance_checks: AcceptanceCheck[];
      ai_rationale_md?: string;
    }>;
  };
  ```

#### 3.2 重写 renderApprovalsRouteComponent() HTML 输出
- **文件**：`packages/ui/src/gold-path/route-components.ts:920-980`
- **改动**：
  - 布局从单栏改为**三栏**（`.wh-r4-approvals-grid`）：
    1. **左栏**（.wh-r4-approval-list）：待审批列表，.wh-r4-approval-item 可点击/选中
       - 优先级 badge、kind badge、title、summary、SLA 截止时间
       - 选中项高亮（`data-r4-approval-selected="true"`）
    2. **中栏**（.wh-r4-approval-details）：详情面板
       - 变更项 table（domain / what_changed / risk_level）
       - 接受标准 checklist（passed/warning/review_required）
       - AI 解释（markdown 文本）
    3. **右栏**（.wh-r4-approval-actions）：操作面板
       - **batch 按钮**：批准（绿）、打回（红），下方显示已选数量
       - **置信环**（SVG 圆环，中间 %）
       - **审批流程 timeline**（vertically stacked）：提交、1st review、merge 或 rejected
       - **讨论区**（折叠的评论卡）
  - **保留约束**：
    - `data-r4-route-component="approvals"` marker
    - `data-r4-approval-queue` / `data-r4-approval-action-panel` / `data-r4-approval-item` / `data-r4-approval-request` 完整
    - `primaryHrefs` 导出（action href）逻辑一致

#### 3.3 文案规范化
- **新增文案 keys**：
  ```typescript
  "approvals.changedTitle"  // "变更详情"
  "approvals.impactTable"   // "影响分析"
  "approvals.acceptChecks"  // "接受标准"
  "approvals.aiRationale"   // "AI 解释"
  "approvals.myActions"     // "我的操作"
  "approvals.confidence"    // "置信度"
  "approvals.timeline"      // "审批流程"
  "approvals.comments"      // "讨论"
  "approvals.acceptAll"     // "批准"（绿）
  "approvals.rejectAll"     // "打回"（红）
  "approvals.routed"        // "已路由"
  ```

### 4. 卖萌文案整体落地

#### 4.1 更新 i18n 文案表
- **文件**：`packages/ui/src/gold-path/i18n.ts` 中 `goldPathT` 定义
- **改动**：涉及以下 key 的中文文案，加入颜文字修饰
  ```typescript
  // zh-CN
  {
    "home.emptyTitle": "一切就绪 (=^･ω･^=)",
    "home.emptySummary": "暂无待决事项，AI 在后台安静运行。",
    "home.aiWorkingEmpty": "暂无 AI 进行中任务 (๑˃ᴗ˂)ﻭ",
    "approvals.emptyTitle": "待审批清空 ٩(◜◡◝)۶",
    "approvals.reasonFallback": "暂无新待审批，继续完成其他任务吧。",
    // 其他新 key...
  }
  ```

#### 4.2 Product shell 导航文案卖萌
- **文件**：`product-shell.ts:100-167` 中 `productShellCopy`
- **改动**：导航 hint（`rail.next*`）、masthead 说明文案，加入暖心语气
  ```typescript
  "rail.nextApprovals": "打回理由会回灌给 AI 继续改，(´；ω；`) 一起加油。",
  "rail.nextHome": "先处理最该你拿主意的，其他的 AI 在后台安静运行。",
  ```

#### 4.3 Smoke 测试 fixture 同步
- **文件**：`apps/web/qa/r4-web-live-route-interaction.ts`
- **改动**：若 fixture 中硬编码了任何上述文案字符串，改为通过 `goldPathT()` 或 `routeT()` 动态比对
  ```typescript
  // 原：expect(html).toContain("待审批清空")
  // 新：expect(html).toContain(goldPathT(locale, "approvals.emptyTitle"))
  ```

## QA Gate

### 70 步 Web Smoke 保护
**必须条件**：
- ✅ 所有 `data-r4-*` 结构标记位置与数量不变（smoke 扫 DOM 验证）
- ✅ `primaryHrefs` 数组长度与内容一致（smoke 计数指纹）
- ✅ notice 类型与 actionId 语义正确（smoke 字段验证）
- ✅ React 组件指纹（`createHomeReactRouteComponent()` 返回的 `reactComponent` 对象）保持

**验证方法**：
```bash
pnpm --filter @workhub/web verify
# 特别关注 r4-web-live-route-interaction.ts 中的断言
```

### 新增测试（设计 token + 布局验证）
- **V0 CSS token 测试**：
  - 新建 `packages/ui/qa/design-tokens.test.ts`
  - 验证所有 CSS 变量定义完整（`:root` 段包含 `--ink`、`--blue`、`--green` 等）
  - 验证无 DOM class 名改动（通过 AST parse 检查）

- **W1 HOME 页布局测试**：
  - 新建 `apps/web/qa/home-redesign.test.ts`
  - 验证新结构（metric chips、大决策卡、AI 进行中表）存在
  - 验证 `data-r4-home-*` marker 位置不变
  - 验证 worklog 字段缺失时回退至原有输出（graceful degradation）
  - 验证 action href 列表导出正确

- **W2 APPROVALS 页布局测试**：
  - 新建 `apps/web/qa/approvals-redesign.test.ts`
  - 验证三栏布局（list/details/actions）各栏 marker 存在
  - 验证 `data-r4-approval-*` marker 完整
  - 验证选中项状态（`data-r4-approval-selected`）

- **文案 fixture 同步测试**：
  - `apps/web/qa/copy-fixture-sync.test.ts`
  - 遍历 `goldPathT()` 和 `routeT()` 所有 key，检查 fixture 中的硬编码字符串
  - 标记需要更新的 fixture 位置

### 现有门禁应用
- **contract 向后兼容**：新增字段（如 `worklog`）均为可选，缺失时 smoke 仍过
- **CSS class 名零改动**：只改变量值，不改 class 名
- **HTML 回退与 React 指纹一致**：`createHomeReactRouteComponent()` 的 fallback 模式保持

## Handoff

### V0 完成后
- 所有新 CSS 变量定义在 `render.ts:45-46` 的 `:root` 段
- `webRouteComponentCss`、`productShellCss` 中的 `var(--wh-product-*)` 引用更新
- 70 步 smoke 通过，zero visual regression（外观变化在预期范围内）

### W1 完成后
- `AttentionHomeVM` 加 `worklog` 可选字段（contracts）
- `renderHomeRouteComponent()` 输出新布局（大决策卡 + metric chips + AI 进行中表 + 队列证据）
- 所有 `data-r4-home-*` marker 保留，React fingerprint 正常
- 文案 keys 新增与 fixture 同步完毕
- 单页 smoke 通过

### W2 完成后
- `ApprovalCenterVM` 加 `selected_item_id` 与 `items_detail` 字段（contracts）
- `renderApprovalsRouteComponent()` 输出三栏布局
- 所有 `data-r4-approval-*` marker 保留
- 三栏对应的 CSS 类（`.wh-r4-approvals-grid`、`.wh-r4-approval-list`、`.wh-r4-approval-details`、`.wh-r4-approval-actions`）定义完整
- 单页 smoke 通过

### 文案卖萌完成后
- i18n.ts 与 product-shell.ts 所有涉及文案均包含颜文字或暖心语气
- fixture 字符串与实际输出完全同步，smoke 中的文案比对通过
- 下一阶段（A0 AI 战绩、M1 Memory、S2 Skill、S3 闲时自迭代）可独立推进

---

**Note**：本文档规范化了 V0 → W1 → W2 的分阶段施工步骤，每阶段都独立可验证，且与 70 步 web smoke 的约束完全对齐。HTML 回退、React 指纹、data-* marker、fixture 同步都有显式检验点。颜文字与卖萌文案的规范避免了自由发挥导致的 tone 不一致，同时保护了数据字段与状态标记的准确性。
