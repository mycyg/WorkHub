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

> 当前口径：Cuu 只保留 **黑猫 Hijiki** 与 **白猫 Tororo** 两个 Live2D Cubism 2 桌宠选项。橘猫改色、Bongo/CSS、PSD draft、sprite/atlas、Web rail 和主窗 Cuu notice 都已退出源码路线；它们只作为历史失败证据或交互参考，不再作为可选模型、默认 fallback 或验收目标。

## 1. 产品边界

- Cuu 只存在于独立 Tauri `pet` 透明窗口。
- Web 与 desktop 主窗保持严肃工作界面，只显示页面、审批、证据、成本、trace 等业务内容，不内嵌 Cuu 形象。
- Cuu 偏好只展示两个按钮：`黑猫` / `白猫`，不展示 Bongo、Live2D V2、PSD draft、sprite atlas。
- 未知或历史 `pet_model_pack_id` 会回落到黑猫，不展示旧模型。

## 2. 当前模型包

| 选项 | pack id | 来源 | 运行资产 | 默认 |
|---|---|---|---|---|
| 黑猫 | `cuu-hijiki-live2d-cubism2` | `https://github.com/imuncle/live2d/tree/master/model/hijiki` | `apps/desktop-webview/public/cuu/live2d/hijiki/` | 是 |
| 白猫 | `cuu-tororo-live2d-cubism2` | `https://github.com/imuncle/live2d/tree/master/model/tororo` | `apps/desktop-webview/public/cuu/live2d/tororo/` | 可选 |

授权备注：当前用于概念实现和本地验证；商用发布前必须取得明确授权，或替换为原创等效 Live2D 模型。

## 3. 代码落点

| 模块 | 文件 | 责任 |
|---|---|---|
| 模型白名单 | `packages/cuu/src/model-pack.ts` | 只注册黑猫/白猫；校验 default-ready、动作覆盖、窗口能力 |
| 偏好归一化 | `packages/cuu/src/controller.ts` | 只接受可选模型包 ID；旧 ID 归一化为 `undefined` |
| 桌宠渲染 | `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 根据模型包选择 Hijiki/Tororo iframe、model json 与状态动作 |
| 桌宠窗口 | `apps/desktop-webview/src/pet-surface.ts` | 只渲染 Live2D cat + 轻气泡，不再挂旧 fallback DOM |
| Cuu 偏好 | `apps/desktop-webview/src/cuu-preferences.ts` | 中英双语二选项；选中为当前，另一项为可选择 |
| QA 合同 | `apps/desktop-webview/src/pet-surface-qa.ts` | 验证独立透明窗口、Live2D cat runtime、无旧 Bongo/atlas/PSD DOM |
| 主窗事件卡 | `apps/desktop-webview/src/desktop-cuu-runtime.ts` | 只保留严肃通知卡，不渲染 Cuu 形象 |

## 4. 已废弃并清理的源码路线

- `apps/desktop-webview/src/cuu-bongo-runtime.ts`
- `apps/desktop-webview/src/cuu-atlas-assets.ts`
- `apps/desktop-webview/src/cuu-atlas-runtime.ts`
- `apps/desktop-webview/src/cuu-sprite-runtime.ts`
- `apps/desktop-webview/src/cuu-live2d-assets.ts`
- `apps/desktop-webview/src/cuu-live2d-runtime.ts`
- `apps/desktop-webview/src/cuu-live2d-psd-draft-assets.ts`
- `apps/desktop-webview/src/cuu-live2d-psd-draft-runtime.ts`
- `apps/desktop-webview/src/assets/cuu/`
- `packages/cuu/src/sprite-manifest.ts`
- `packages/cuu/src/atlas-manifest.ts`
- `packages/cuu/src/live2d-manifest.ts`
- `packages/cuu/src/live2d-psd-draft.ts`

这些删除不代表历史审计图片失效；审计图片留在 `docs/workhub/05-clients/assets/` 中，用于说明为什么这些路线被放弃。

## 5. 行为与状态映射

Cuu 仍保留业务状态和 idle 微动作语义：

- 业务状态：idle、thinking、asking approval、carrying document、searching evidence、syncing files、worried、revision requested、celebrating、offline。
- idle 微动作：呼吸、眨眼、尾巴、看鼠标、睡觉、醒来、拖动、轻敲、挥手。
- 当前 Cubism 2 模型通过 `.mtn` 文件承接这些动作语义；同一套映射服务黑猫/白猫。

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
- 历史 Bongo、PSD draft、sprite/atlas class 或 runtime data attribute 不出现在运行态 HTML。

## 7. 后续施工计划

1. 补真实 Tauri 录屏：分别录黑猫和白猫 idle、审批、检索、同步、完成、离线、hover、tap、drag。
2. 录屏验收要输出 contact sheet、GIF/MP4、DOM dump 和 diff report，写回 `current-state-visual-audit-and-construction-plan-2026-06-07.md`。
3. 增加模型授权替换计划：若 Hijiki/Tororo 不能商用，按相同接口替换为原创黑猫/白猫 Cubism 2/3 模型。
4. 继续完善 Rust `pet` window：多屏恢复、full hide/pass-through 安全恢复、托盘显隐、通知点击 deep-link。
5. 后续若重启原创 Live2D，只能作为新的 `cuu-original-black-cat-live2d` / `cuu-original-white-cat-live2d` 候选进入同一白名单，不恢复 PSD draft 或 Bongo 默认路线。
