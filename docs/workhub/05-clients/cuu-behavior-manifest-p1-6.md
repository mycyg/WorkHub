---
module: 05-clients
layer: C-PET / Cuu / Live2D / Behavior Manifest
status: source-contract-landed
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/cuu/cuu-character-animation-states.png
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
---

# Cuu Behavior Manifest P1.6

> 本篇记录 P1.6 “鲜活动作状态机”源码合同。目标不是替换 Live2D 模型，也不是新增第三种视觉，而是把黑猫 Hijiki / 白猫 Tororo 的业务状态、idle 微动作、真实 `.mtn`、气泡模式和窗口模式放进同一份可审计 manifest。

## 1. PRD / Concept Alignment

| 要求 | P1.6 落点 |
|---|---|
| Cuu 只在独立桌宠窗口出现 | 只改 `packages/cuu` 与 `apps/desktop-webview` pet runtime；Web / desktop 主窗仍无 Cuu 本体 |
| 只允许黑猫 / 白猫 Live2D | `behavior_manifest.model_pack_id` 只允许 `cuu-hijiki-live2d-cubism2` / `cuu-tororo-live2d-cubism2` |
| 桌宠要有活着的动作 | manifest 增加 `idle_random`、`enter` / `loop` / `exit`、priority、interruptible |
| 审批 / 检索 / 澄清由气泡承接 | `asking_approval`、`searching_evidence` 等状态声明 `bubble_mode=card`、`window_mode=card` |
| 参考 VPet / 像素猫但不搬素材 | 只借鉴 Start/Loop/End、random action、动作 manifest；不复制 `reference` 资产 |
| QA 要能证明不是只缩放 | runtime 同时暴露 semantic motion state 与真实 renderer `.mtn`，供截图/录屏报告比对 |

## 2. Source Landing

| 文件 | 改动 |
|---|---|
| `packages/cuu/src/motion.ts` | 新增 `CuuBehaviorManifest`、`CuuMotionSlot`、`CuuBehaviorState`、`idle_random`、Live2D renderer state 统一映射 |
| `packages/cuu/src/motion.test.ts` | 覆盖全 CuuState、Start/Loop/End、approval/search card-first、idle random pool、`.mtn` 映射 |
| `packages/cuu/src/model-pack.ts` | 黑猫/白猫 model pack 挂 `behavior_manifest_version=1` 和 `behavior_manifest` |
| `packages/cuu/src/model-pack.test.ts` | 验证 behavior manifest 属于同一 pack，且黑猫/白猫都覆盖业务与 idle 动作 |
| `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` | 新增 `resolveDesktopCuuCatLive2DBehaviorState`、`setDesktopCuuCatLive2DBehaviorState`，输出真实 renderer `.mtn` |
| `apps/desktop-webview/src/cuu-cat-live2d-runtime.test.ts` | 验证 approval/idle 行为数据、黑白二选项、无旧实验视觉 |
| `apps/desktop-webview/src/pet-surface.ts` | pet surface 输出 `data-cuu-behavior-*`；idle tick patch 同步 behavior attrs，不重建 iframe |
| `apps/desktop-webview/src/pet-surface.test.ts` | 验证 pet HTML 中有 manifest version、behavior state/phase/window/bubble、renderer state |
| `apps/desktop-webview/src/cuu-qa-scenarios.ts` | P1.7 追加：把业务场景转成 env-gated scripted push-event / sse-status |
| `scripts/qa/cuu-tauri-motion-capture.ps1` | P1.7 追加：真实 Tauri capture 可选择 `clarify` / `approval` / `search` / `sync` / `done` / `offline` |

## 3. Manifest Contract

```ts
type CuuBehaviorManifest = {
  version: 1;
  model_pack_id: "cuu-hijiki-live2d-cubism2" | "cuu-tororo-live2d-cubism2";
  states: Record<CuuState, CuuBehaviorState>;
  idle_random: CuuIdleRandomMotionSlot[];
};
```

每个 `CuuBehaviorState` 至少包含：

| 字段 | 说明 |
|---|---|
| `state` | `idle` / `thinking` / `asking_approval` / `searching_evidence` 等业务语义 |
| `enter` | 非 idle 状态进入动作，对齐 VPet `A_Start` 思路 |
| `loop` | 状态主循环动作，对齐 VPet `B_Loop` |
| `exit` | 非 idle 状态退出回 idle，对齐 VPet `C_End` |
| `bubble_mode` | `none` / `tip` / `card` |
| `window_mode` | `body_only` / `card` |
| `priority` | 状态抢占优先级；approval 最高 |
| `coverage` | 当前为 `partial`，表示复用现有 `.mtn`，真实专用 motion 仍待原创/授权补齐 |

## 4. Runtime Data Attributes

Pet surface 与 Live2D root 现在会输出：

| Attribute | 用途 |
|---|---|
| `data-cuu-behavior-manifest-version` | QA 确认进入 P1.6 manifest 合同 |
| `data-cuu-behavior-state` | 业务状态，例如 `asking_approval` |
| `data-cuu-behavior-phase` | `enter` / `loop` / `exit` / `idle_random` |
| `data-cuu-behavior-coverage` | `partial` / `full` |
| `data-cuu-behavior-expected-window-mode` | 行为期望窗口模式，`body_only` / `card` |
| `data-cuu-behavior-expected-bubble-mode` | 行为期望气泡模式，`none` / `tip` / `card` |
| `data-cuu-live2d-motion` | 语义 motion state，例如 `asking_approval_bounce` |
| `data-cuu-live2d-renderer-state` | 真实 `.mtn`，例如 `mtn/01.mtn` |

兼容约定：旧 QA 可继续读 `data-cuu-live2d-motion`；新 QA 应同时读 `data-cuu-live2d-renderer-state`，防止把语义状态误当作真实 Live2D motion 文件。实际窗口状态仍以 pet surface 的 `data-pet-window-mode` 为准；`data-cuu-behavior-expected-window-mode` 只表达 manifest 期望，避免 card mode 同步失败或 compact fallback 时混淆。

动画约定：CSS 仍以 `data-cuu-live2d-state` 选择轻量外层动画，Live2D iframe 内部以 `.mtn` 播放为准；`data-cuu-live2d-motion` 是给 QA / Replay / capture report 看的语义字段。

## 5. Current Coverage

| 状态 | Window | Bubble | Renderer |
|---|---|---|---|
| `idle` | `body_only` | `none` | `mtn/00_idle.mtn` |
| `thinking` | `body_only` | `tip` | `mtn/04.mtn` |
| `asking_approval` | `card` | `card` | `mtn/01.mtn` |
| `carrying_document` | `card` | `card` | `mtn/00_idle.mtn` |
| `searching_evidence` | `card` | `card` | `mtn/04.mtn` |
| `syncing_files` | `card` | `card` | `mtn/04.mtn` |
| `worried` | `card` | `card` | `mtn/08.mtn` |
| `revision_requested` | `card` | `card` | `mtn/00_idle.mtn` |
| `celebrating` | `body_only` | `tip` | `mtn/06.mtn` |
| `offline` | `card` | `card` | `mtn/08.mtn` |

说明：当前 `coverage=partial` 是刻意诚实标记，因为 Hijiki/Tororo 可用 `.mtn` 有限。P1.6 通过的是“状态机合同已落”，不是“每个业务状态都有独家精修动作”。

## 6. Verification

已通过：

- `pnpm --filter @workhub/cuu test`
- `pnpm --filter @workhub/desktop-webview test`

仍需在提交前执行完整门：

- `pnpm --filter @workhub/desktop-webview build`
- `pnpm --filter @workhub/web test`
- `cargo test --manifest-path client-tauri\src-tauri\Cargo.toml`
- `git diff --check`
- `git diff --name-only` 不含 `reference/` / `references/`

## 7. Remaining Visual Acceptance

P1.6 不替代真实视觉验收。后续必须补：

1. 黑猫 idle 10s、hover、tap、drag、approval、search、done 多帧录屏；其中 approval 已有 P1.7 短版 smoke，仍需正式长录。
2. 白猫同场景多帧录屏。
3. `data-cuu-behavior-state` 与 `data-cuu-live2d-renderer-state` 写入 capture report；P1.7 当前写入 `expected_behavior_contract`，actual DOM attrs 待 WebView2/CDP 或 SSE fixture 补齐。
4. 确认 hover look-only 不改变窗口 rect、不重建 iframe。
5. 确认 card mode 不裁切 Cuu 和轻气泡。

后续业务录屏方案见 [`cuu-tauri-business-motion-capture-p1-7.md`](./cuu-tauri-business-motion-capture-p1-7.md)。
