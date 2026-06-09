---
module: 05-clients
layer: C-PET / Cuu / Live2D
status: current-implementation-plan
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/cuu/cuu-character-animation-states.png
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
---

# Cuu Live2D 黑猫 / 白猫二选项实施说明

> 当前口径：Cuu 只保留 **黑猫 Hijiki** 与 **白猫 Tororo** 两个 Live2D Cubism 2 桌宠选项。所有未通过用户复核的临时形象、生成图、裁片、图集、主窗角色栏和实验 renderer 均已退出当前源码路线，不再作为可选模型、默认 fallback、文档入口或验收目标。

## 1. 产品边界

- Cuu 只存在于独立 Tauri `pet` 透明窗口。
- Web 与 desktop 主窗保持严肃工作界面，只显示页面、审批、证据、成本、trace 和设置。
- Cuu 偏好只展示两个按钮：`黑猫` / `白猫`。
- 未知或历史 `pet_model_pack_id` 会回落到黑猫。
- 主窗设置页不展示 Cuu 形象，也不展示旧模型入口。

## 2. 当前模型包

| 选项 | pack id | 来源 | 运行资产 | 默认 |
|---|---|---|---|---|
| 黑猫 | `cuu-hijiki-live2d-cubism2` | `https://github.com/imuncle/live2d/tree/master/model/hijiki` | `apps/desktop-webview/public/cuu/live2d/hijiki/` | 是 |
| 白猫 | `cuu-tororo-live2d-cubism2` | `https://github.com/imuncle/live2d/tree/master/model/tororo` | `apps/desktop-webview/public/cuu/live2d/tororo/` | 可选 |

授权备注：当前用于概念实现和本地验证；商用发布前必须取得明确授权，或替换为原创等效黑猫/白猫 Live2D 模型。

## 3. 概念图同步状态

2026-06-08 已把 Cuu 全部当前概念图同步为黑猫 / 白猫 Live2D 模型口径：

| 概念图 | 当前基准 | 说明 |
|---|---|---|
| `./assets/cuu/cuu-character-animation-states.png` | Hijiki + Tororo 实际浏览器运行帧 | 定义二选项外观和 motion state 语义 |
| `./assets/cuu/cuu-desktop-approval-search.png` | 黑猫 Hijiki 独立 pet window | 定义审批、项目检索、交付物摘要气泡 |
| `./assets/cuu/cuu-option-first-clarify.png` | 白猫 Tororo 气泡镜像 | 定义 option-first 澄清和“主窗无 Cuu 本体”边界 |
| `./assets/shared/ts-first-runtime-concept.png` | 黑猫独立 pet window | 定义 TS-first runtime 中 Cuu 只作为独立客户端 surface |
| `./assets/shared/endpoint-page-cuu-alignment.png` | 黑/白 CuuState pet column | 定义 endpoint/page 与 CuuState 分离，页面列不嵌 Cuu 本体 |
| `./assets/shared/prd-concept-gap-map.png` | 黑/白二选项 | 定义当前已建/部分/仍缺缺口，不再展示旧橘猫北极星 |
| `./assets/shared/shared-component-atlas.png` | 黑猫 Pet Bubble | 定义 pet bubble 是独立 Cuu surface，不是主窗组件 |
| `./assets/audit/2026-06-08-cuu-live2d-model-preview/hijiki/` | 黑猫源帧、DOM、report | 概念图源证据 |
| `./assets/audit/2026-06-08-cuu-live2d-model-preview/tororo/` | 白猫源帧、DOM、report | 概念图源证据 |

这一步只是“概念图与当前模型统一”。最终 Cuu 通过仍需要 Tauri `pet` window 真实多帧录屏，因为浏览器模型页不能证明透明窗口、右下角定位、拖拽、pass-through、hide-on-hover、card mode 都合格。

## 4. 代码落点

| 模块 | 文件 | 责任 |
|---|---|---|
| 模型白名单 | `packages/cuu/src/model-pack.ts` | 只注册黑猫/白猫；校验 default-ready、动作覆盖、窗口能力 |
| 偏好归一化 | `packages/cuu/src/controller.ts` | 只接受可选模型包 ID；旧 ID 归一化为 `undefined` |
| 桌宠渲染 | `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 根据模型包选择 Hijiki/Tororo iframe、model json 与状态动作 |
| 桌宠窗口 | `apps/desktop-webview/src/pet-surface.ts` | 只渲染 Live2D cat + 轻气泡；pointer/idle 变化走 DOM patch，不重建 iframe |
| Cuu 偏好 | `apps/desktop-webview/src/cuu-preferences.ts` | 中英双语二选项；选中为当前，另一项为可选择 |
| QA 合同 | `apps/desktop-webview/src/pet-surface-qa.ts` | 验证独立透明窗口、Live2D cat runtime、无旧实验 DOM |
| 主窗事件卡 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 只保留严肃通知桥接，不渲染 Cuu 形象 |
| QA 模型注入 | `scripts/qa/cuu-tauri-motion-capture.ps1` / `client-tauri/src-tauri/src/main.rs` | 允许 QA 用黑猫或白猫 pack id 启动 pet window；`look-only` 验证 hover 不移动窗口 |
| QA 业务场景注入 | `apps/desktop-webview/src/cuu-qa-scenarios.ts` / `WORKHUB_CUU_QA_SCENARIO` | 允许真实 Tauri pet window 录 `clarify` / `approval` / `search` / `sync` / `done` / `offline` |
| QA actual DOM / anchor | `apps/desktop-webview/src/cuu-qa-dom-report.ts` / `WORKHUB_CUU_QA_DOM_REPORT_PATH` | P1.8 已允许真实 Tauri pet window 把 runtime DOM attrs 写入 report；approval 气泡锚点贴近 Cuu |
| QA business matrix / framing | `scripts/qa/cuu-tauri-motion-capture.ps1` / `apps/desktop-webview/src/pet-surface.ts` | P1.9 已补黑猫业务 smoke 矩阵、白猫 approval、强 actual DOM gate；card 画布已校准为不裁猫、不裁气泡 |

## 5. 已清理范围

| 类别 | 处理 |
|---|---|
| 非黑/白模型包 | 不再注册，不再展示，未知请求回退黑猫 |
| 实验渲染源码 | 已从当前运行路径和测试期望中移除 |
| 生成/拆件脚本 | 已删除，不再作为素材生产路线 |
| public 静态猫图 | 已从 Web / desktop public 入口移除 |
| 历史截图资产 | 与已删除路线对应的审计资产已移除；保留的旧截图只作为“不能只露耳朵 / 不能只看单帧”的回归门 |
| QA 像素门 | 不再依赖某个颜色像素，改为 visual/foreground pixel 检查 |

## 6. 行为与状态映射

Cuu 保留业务状态和 idle 微动作语义：

| 状态 | 语义 | 当前映射 |
|---|---|---|
| `idle` | 待机、呼吸、眨眼 | Cubism idle motion |
| `thinking` | AI 正在整理/推理 | waiting/thinking motion |
| `asking_approval` | 需要用户确认 | alert motion + approval bubble |
| `carrying_document` | 交付物/变更包 | deliverable bubble |
| `searching_evidence` | 项目检索/知识库查证 | search bubble |
| `syncing_files` | 本地同步 | busy motion |
| `worried` | 低置信度或风险高 | worry motion |
| `revision_requested` | 用户打回 | revise motion |
| `celebrating` | 审批通过或任务完成 | celebration motion |
| `offline` | 离线/重连 | sleep/worry motion |

同一套语义服务黑猫和白猫。后续如果替换原创模型，也必须保持 pack id、motion key、window affordance 合同兼容。

窗口口径：`idle` 才使用 `body_only` 小透明窗口；只要出现业务气泡或任务提示，就使用透明 `card` canvas 承载气泡与 Cuu。`done` 的业务语义仍是轻提示，即 `bubble_mode=tip`，但窗口模式为 `card`，避免 body-only 小窗口把完成提示裁成残影。

### 6.1 VPet / Pixel Cat Reference Lessons

`reference/VPet-main.zip` 和两个像素猫素材包已经完成只读审查，详细结论见 [`desktop-pet-reference-package-audit-2026-06-08.md`](./desktop-pet-reference-package-audit-2026-06-08.md)。对 Cuu 当前路线的约束如下：

- 不引入第三套 Cuu 视觉。Cuu 仍然只有黑猫 Hijiki / 白猫 Tororo。
- 不把 VPet 或像素猫素材复制进 WorkHub 默认资产；仅参考运行时设计。
- Cuu 后续不能只靠静态首帧或 CSS 缩放，必须有独立行为 manifest。
- 动作切换采用 `enter` / `loop` / `exit` 三段式，参考 VPet 的 `A_Start` / `B_Loop` / `C_End`，避免任务态突然跳帧。
- idle 采用随机动作池，参考像素猫 `random_act`，但动作语义收敛到 WorkHub 的 AI 工作状态。
- 音效如果启用，必须默认静音、可配置、可审计，不进入 P1 默认验收。

### 6.2 `CuuBehaviorManifest` Target

目标文件：

| 文件 | 责任 |
|---|---|
| `packages/cuu/src/motion.ts` | 定义 `CuuBehaviorManifest`、状态优先级、start/loop/end slot、idle random pool |
| `packages/cuu/src/model-pack.ts` | 黑猫/白猫模型包挂载同构 manifest，声明 motion coverage |
| `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 暴露 `setDesktopCuuCatLive2DBehaviorState`，patch 现有 Live2D root 的 behavior attrs，不重建 iframe |
| `apps/desktop-webview/src/pet-surface.ts` | 把 AI 事件、用户 hover/tap/drag、气泡 card mode 接入状态机 |
| `scripts/qa/cuu-tauri-motion-capture.ps1` | 录制黑猫/白猫多状态 motion evidence |

P1.6 源码合同已经落地，详见 [`cuu-behavior-manifest-p1-6.md`](./cuu-behavior-manifest-p1-6.md)。当前状态：

| 项 | 状态 |
|---|---|
| `CuuBehaviorManifest` 类型与生成 | 已落 `packages/cuu/src/motion.ts` |
| 黑猫/白猫 model pack manifest | 已挂 `behavior_manifest_version=1` |
| `enter` / `loop` / `exit` | 已落源码合同，coverage 标记为 `partial` |
| `idle_random` | 已落 breathe / blink / tail / look / wave 池 |
| desktop runtime attrs | 已输出 `data-cuu-behavior-*` 与 `data-cuu-live2d-renderer-state` |
| 真实 Tauri motion evidence | P1.7 已落业务录屏入口；P1.8 已落 actual DOM / approval anchor smoke；P1.9 已落黑猫业务 smoke 矩阵 + 白猫 approval；32 帧正式矩阵待补 |

最小字段：

| 字段 | 说明 |
|---|---|
| `version` | manifest 版本，P1 固定为 `1` |
| `model_pack_id` | 只允许黑猫/白猫 pack id |
| `states` | `idle`、`thinking`、`asking_approval`、`searching_evidence`、`syncing_files`、`worried`、`celebrating`、`offline` |
| `enter` / `loop` / `exit` | 每个状态的 Live2D motion slot |
| `expression` | 可选表情 key |
| `priority` | 状态抢占顺序，用户拖拽/点击高于后台 idle |
| `interruptible` | 是否允许新事件打断 |
| `bubble_mode` | `none` / `tip` / `card` |
| `window_mode` | `body_only` / `card` |
| `idle_random` | 带 `probability` 和 `cooldown_ms` 的随机微动作池 |
| `coverage` | `full` / `partial`，记录当前模型是否有专用 motion |

P1.6 验收口径：即使 motion coverage 仍是 `partial`，也必须能证明状态机存在、不会重建 iframe、不会移动全身锚点、不会只做整体缩放。

## 7. 验收门

必须通过：

- `pnpm --filter @workhub/cuu test`
- `pnpm --filter @workhub/desktop-webview test`
- `git diff --check`
- `git diff --name-only` 中不得出现 `reference/` 或 `references/`

视觉验收必须满足：

- pet window 首帧非空，全身可见，不是只露耳朵。
- Cuu 有持续动作，不只是缩放。
- 鼠标靠近不移动整只 Cuu，不闪烁，不重建 iframe；黑猫/白猫 `look-only` capture 的窗口 rect 必须稳定。
- 审批 / 检索 / 澄清 / 完成气泡必须围绕 Cuu 出现，不能回到窗口左上角；P1.9 business matrix 是当前回归门。
- 黑猫/白猫切换后 iframe、model json、data attrs 一致。
- Web / desktop 主窗没有 Cuu 形象 DOM。
- 旧实验 class、runtime data attribute 或模型 ID 不出现在运行态 HTML。

## 8. 后续施工计划（冻结后重排）

R1 真实纵切通过前，不再把 Cuu 外观矩阵作为当前施工任务。以下事项按优先级重排：

1. 当前立即项：主窗无 Cuu 截图复核、透明 pet smoke、文档资产对账、真实回归修复。
2. 当前工程主线：继续 R1/R2 后端缺口；真实 `sessions/workitems/knowledge/page workitem` service、CostLedger/BudgetPolicy 默认 store、merge accepted deliverable ledger、persistent merge audit、AgentRun-backed delivery 正式文件落盘、WorkItem page / AgentRun replay accepted deliverables、下载/文本预览、最小 restore、AI fusion text/spec 正文直写、真实 current/incoming/base 文本上下文、数据层 patch preview 与 Replay patch preview 渲染已接入，下一批优先 `ai_fusion` v2 自动 text diff3、Proposal 采用前富 patch viewer、字段级结构化 patch、多冲突工作台、PG queue claim 与多 worker。
3. R3 后恢复：把 P1.9 的 8 帧 smoke 升级为 32 帧正式矩阵，覆盖黑猫 `clarify/search/sync/done/offline/approval` 与白猫同等场景。
4. R3 后恢复：录 tap、drag、hide-on-hover、pass-through、scale、opacity settings matrix，证明二选项都真实可用；不能只依赖浏览器模型页源帧。
5. R3 后恢复：输出 contact sheet、GIF/MP4、DOM dump、diff report 到 `docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime/`，并回写当前审计文档。
6. 发布前必须完成授权评估；若不能商用，按同一接口替换原创黑猫/白猫模型。
7. P1.6 `CuuBehaviorManifest` 源码合同已落，P1.7 业务录屏入口已落，P1.8 actual DOM / 气泡锚点首证据已落，P1.9 黑猫业务 smoke 矩阵与白猫 approval 已落；这些是冻结前回归证据，不能当作最终视觉通过，也不能作为 R1 前继续外观扩面的理由。
