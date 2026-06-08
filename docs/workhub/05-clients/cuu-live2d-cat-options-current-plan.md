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

## 3. 代码落点

| 模块 | 文件 | 责任 |
|---|---|---|
| 模型白名单 | `packages/cuu/src/model-pack.ts` | 只注册黑猫/白猫；校验 default-ready、动作覆盖、窗口能力 |
| 偏好归一化 | `packages/cuu/src/controller.ts` | 只接受可选模型包 ID；旧 ID 归一化为 `undefined` |
| 桌宠渲染 | `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 根据模型包选择 Hijiki/Tororo iframe、model json 与状态动作 |
| 桌宠窗口 | `apps/desktop-webview/src/pet-surface.ts` | 只渲染 Live2D cat + 轻气泡 |
| Cuu 偏好 | `apps/desktop-webview/src/cuu-preferences.ts` | 中英双语二选项；选中为当前，另一项为可选择 |
| QA 合同 | `apps/desktop-webview/src/pet-surface-qa.ts` | 验证独立透明窗口、Live2D cat runtime、无旧实验 DOM |
| 主窗事件卡 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 只保留严肃通知桥接，不渲染 Cuu 形象 |

## 4. 已清理范围

| 类别 | 处理 |
|---|---|
| 非黑/白模型包 | 不再注册，不再展示，未知请求回退黑猫 |
| 实验渲染源码 | 已从当前运行路径和测试期望中移除 |
| 生成/拆件脚本 | 已删除，不再作为素材生产路线 |
| public 静态猫图 | 已从 Web / desktop public 入口移除 |
| 历史截图资产 | 与已删除路线对应的审计资产已移除；保留的旧截图只作为“不能只露耳朵 / 不能只看单帧”的回归门 |
| QA 像素门 | 不再依赖某个颜色像素，改为 visual/foreground pixel 检查 |

## 5. 行为与状态映射

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

## 6. 验收门

必须通过：

- `pnpm --filter @workhub/cuu test`
- `pnpm --filter @workhub/desktop-webview test`
- `git diff --check`
- `git diff --name-only` 中不得出现 `reference/` 或 `references/`

视觉验收必须满足：

- pet window 首帧非空，全身可见，不是只露耳朵。
- Cuu 有持续动作，不只是缩放。
- 黑猫/白猫切换后 iframe、model json、data attrs 一致。
- Web / desktop 主窗没有 Cuu 形象 DOM。
- 旧实验 class、runtime data attribute 或模型 ID 不出现在运行态 HTML。

## 7. 后续施工计划

1. 录黑猫真实 Tauri motion：idle、hover、tap、drag、approval、search、sync、done、offline。
2. 录白猫同等场景，证明二选项都真实可用。
3. 输出 contact sheet、GIF/MP4、DOM dump、diff report 到 `docs/workhub/05-clients/assets/audit/2026-06-08-cuu-live2d-cat-runtime/`。
4. 更新 [`current-state-visual-audit-and-construction-plan-2026-06-07.md`](./current-state-visual-audit-and-construction-plan-2026-06-07.md) 的真实证据表。
5. 完成多屏恢复、full hide/pass-through 安全恢复、托盘显隐和通知点击 deep-link。
6. 完成授权评估；若不能商用，按同一接口替换原创黑猫/白猫模型。
