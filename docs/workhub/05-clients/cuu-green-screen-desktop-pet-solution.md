---
module: 05-clients
layer: C-PET / Cuu
status: concept
owner: workflow
---

# Cuu 绿幕素材与独立桌宠方案

> 结论：Cuu 的最终形态不是主窗口里的符号化浮层，而是一个独立 Tauri `pet` 透明窗口。角色视觉用 GPT Image 生成绿幕多帧素材，再经本地抠图、裁切、对齐、打包成 sprite atlas。Cuu 必须有持续 idle、眨眼、尾巴、睡觉、醒来、思考、检索、审批、叼文件、庆祝、担心等动作，让用户感觉它在桌面右下角“活着”。

## 1. 目标体验

Cuu 应该像多年前 QQ 宠物那类“桌面常驻角色”，但行为更克制、工作化：

- 默认待在屏幕右下角或用户拖到的位置，主窗隐藏后仍存在。
- 没任务时也有低频生命感：呼吸、眨眼、看向鼠标、尾巴摆动、打盹。
- 有事时用动作先提醒，再出现气泡：审批、澄清、证据、交付物变更包。
- 用户可以拖动、收起、静音、勿扰；Cuu 不能挡住用户正在操作的区域。
- 复杂工作不在宠物窗里铺满，Cuu 只承接一个轻卡，必要时 deep-link 打开主窗。

## 2. 架构决策

| 层 | 决策 | 原因 |
|---|---|---|
| 视觉资产 | 绿幕生成 PNG 帧，抠图后打包成 atlas | 最快得到真实小猫形象，避免 procedural CSS 的符号感 |
| MVP renderer | CSS/Canvas sprite atlas | 简单、稳定、可测试，适合先让 Cuu 独立活起来 |
| 桌面载体 | Tauri 独立 `pet` window | 主窗隐藏后仍常驻，符合桌宠定位 |
| 状态调度 | TS `CuuController` + animation queue | 业务状态仍来自 daemon，动画不进 Rust |
| 后续升级 | Rive state machine, Live2D 评估 | Rive 用于自然过渡，Live2D 只在表现力收益足够时进入 |

不要把 Cuu 做成：

- 主窗口右下角固定 div。
- 只会显示一个 Bot 图标的状态灯。
- SVG 符号或渐变圆点。
- 依赖用户先打开页面才能看到的组件。

## 3. 绿幕生图管线

### 3.1 资产批次

第一批建议做 18 个动作，每个动作 6-12 帧：

| 动作 id | 帧数 | fps | 循环 | 用途 |
|---|---:|---:|---|---|
| `idle_breathe` | 8 | 8 | yes | 默认呼吸 |
| `idle_blink` | 4 | 10 | no | 随机眨眼 |
| `idle_tail_sway` | 8 | 8 | yes | 尾巴轻摆 |
| `look_at_mouse` | 6 | 10 | no | 鼠标靠近时看过去 |
| `sleeping_curl` | 8 | 6 | yes | 长时间无事睡觉 |
| `wake_up` | 8 | 10 | no | 从睡觉醒来 |
| `thinking_tail` | 10 | 10 | yes | AI 正在思考 |
| `searching_evidence_peek` | 10 | 10 | yes | 项目检索/知识库查证 |
| `asking_approval_bounce` | 8 | 12 | yes | 需要点选审批 |
| `carrying_document_step` | 10 | 10 | yes | 叼来交付物变更包 |
| `syncing_files_spin` | 8 | 10 | yes | 文件同步 |
| `worried_ears` | 8 | 8 | yes | 风险、预算、冲突 |
| `revision_requested_nod` | 8 | 10 | no | 收到打回原因，点头继续改 |
| `celebrating_jump` | 10 | 12 | no | 任务完成 |
| `offline_sleep` | 8 | 6 | yes | 断线/离线休眠 |
| `drag_hold` | 4 | 8 | yes | 被用户拖动 |
| `tap_bubble` | 6 | 12 | no | 轻敲气泡提醒 |
| `wave_hello` | 8 | 10 | no | 初次出现/唤醒 |

第一批大约 150-160 帧，足够让 Cuu 有生命感。不要只做 5 个状态帧。

### 3.2 统一生图 prompt

每次生成都必须复用角色锚点，避免动作之间变成不同猫：

```text
Use case: stylized-concept
Asset type: desktop pet sprite frame / sprite sheet
Primary request: Cuu, an original orange cartoon kitten desktop pet, performing <ACTION>.
Subject: orange tabby kitten, cream muzzle and paws, big curious eyes, white lace bib collar, black bow tie, pearl tassels with tiny red beads.
Style/medium: polished 2D cartoon game sprite, cute but reliable, clean outline, soft shading, consistent character proportions.
Composition/framing: full body, centered, generous padding, same scale across frames, feet/paws aligned to a consistent ground anchor.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background.
Constraints: no shadows, no floor plane, no gradients, no texture, no text, no watermark, no green on the subject, no cropped tail or ears.
Avoid: photorealism, symbol icon, abstract mascot, extra props unless the action requires one.
```

生成方式有两种：

- **动作 sprite sheet**：一次生成 6-8 格同一动作，适合 `idle`、`thinking`、`searching`。优点是一致性高。
- **单帧补图**：补关键帧或修坏帧，适合 `celebrating`、`wake_up` 这类一次性动作。

### 3.3 抠图和裁切

绿幕素材不能直接进 runtime，必须经过四步：

1. **Chroma key**：用边缘采样去掉 `#00ff00`，输出 alpha PNG/WebP。
2. **Despill**：去掉毛边上的绿色污染，避免透明窗口里出现绿边。
3. **Trim**：按 alpha bounding box 裁切，但不能逐帧随意裁到不同尺寸。
4. **Anchor normalize**：同一动作内所有帧使用统一 canvas 和脚底 anchor，避免播放时抖动。

关键原则：**可以裁透明边，但不能让 Cuu 的脚底锚点漂移**。每个动作都要记录：

```json
{
  "action": "thinking_tail",
  "canvas": { "w": 256, "h": 256 },
  "anchor": { "x": 128, "y": 238 },
  "frames": [
    { "id": "thinking_tail_000", "x": 0, "y": 0, "w": 256, "h": 256, "duration_ms": 100 }
  ]
}
```

### 3.4 目录落点

运行时资产不放文档目录，文档目录只保留概念图和说明。

```text
apps/desktop-webview/src/assets/cuu/
  source-green/
    idle_breathe/
    thinking_tail/
  alpha/
    idle_breathe/
    thinking_tail/
  atlas/
    cuu-p1.png
    cuu-p1.webp
    cuu.sprite.json

docs/workhub/05-clients/assets/cuu/
  *.png  # 概念图、流程图、参考说明
```

后续如果 Tauri 前端迁到 `client-tauri/web-src`，同样保持 `assets/cuu/{source-green,alpha,atlas}` 结构。

## 4. Sprite Manifest

现有 `packages/cuu/src/sprite-manifest.ts` 是 MVP schema。生产版需要扩成可描述真实 atlas：

```ts
export type CuuSpriteAtlasManifest = {
  version: 1;
  character: "Cuu";
  art_pack: "cuu-p1-green-screen";
  atlas: {
    image: string;
    pixel_ratio: 1 | 2;
    format: "png" | "webp";
  };
  clips: Record<string, {
    state: string;
    fps: number;
    loop: boolean;
    interruptible: boolean;
    priority: "idle" | "normal" | "urgent";
    anchor: { x: number; y: number };
    frames: { id: string; x: number; y: number; w: number; h: number; duration_ms: number }[];
    reduced_motion_frame_id: string;
  }>;
};
```

manifest 必须能回答三件事：

- 每个 `CuuMotionHint.sprite_state` 是否有对应 clip。
- 每个 clip 是否有统一 anchor 和 reduced-motion fallback。
- 每个动作是否 loop / interruptible / priority 正确。

## 5. 独立 Pet Window

### 5.1 Tauri 窗口

`pet` window 是桌宠本体：

- `transparent:true`
- `decorations:false`
- `alwaysOnTop:true`
- `skipTaskbar:true`
- `focus:false`
- idle 尺寸：约 `160x180`
- 展开卡片尺寸：约 `380x560`
- 默认位置：当前主显示器 work area 的右下角，距边缘 24px

运行策略：

```text
app start
  -> Rust setup creates main + pet
  -> pet loads same desktop webview bundle with ?surface=pet
  -> pet starts hidden until assets and controller ready
  -> first ready event positions pet at bottom-right
  -> show_pet_window(source=startup) without stealing focus
```

### 5.2 Pet Webview Surface

不要让 `pet` 加载完整 Gold Path 主壳。它应该有自己的轻入口：

```text
apps/desktop-webview/src/pet.ts
  - load sprite atlas
  - create CuuController
  - bind Tauri push-event / sse-status
  - render CuuBody full-bleed transparent
  - render one bubble/card only when needed
```

同一个 Vite build 可以通过 query 分流：

```text
/?surface=main  -> Gold Path / desktop workbench
/?surface=pet   -> Cuu transparent pet window
```

### 5.3 点击和拖动

MVP 不做复杂 click-through，先用最小窗口避免挡事：

- idle 窗口只包住 Cuu 身体外接矩形。
- 展开轻卡时窗口扩大到左上方向，避免超出屏幕。
- Cuu 身体可拖动，拖动时播放 `drag_hold`。
- 拖动结束后保存 monitor id + logical position。
- 双击或托盘命令回到底部右下角。

## 6. 活着的行为调度

Cuu 不能只等事件。它需要一个 idle scheduler：

```text
idle loop
  every 3-6s: small breath/tail frame variance
  every 8-20s: blink
  every 20-45s: look_at_mouse if cursor nearby
  after 5min no events: sleeping_curl
  on hover/click: wake_up or wave_hello
  on drag: drag_hold
```

事件动画优先级：

| 优先级 | 示例 | 行为 |
|---|---|---|
| urgent | 审批、预算耗尽、权限询问 | 立刻打断 idle，显示气泡 |
| high | 变更申请、冲突、失败 | 可替换低优先级卡 |
| normal | 检索结果、同步完成 | 入队或轻提醒 |
| low | 普通通知 | 只进 badge，安静模式不弹 |

动画队列规则：

- idle 动作永远可打断。
- `asking_approval_bounce`、`worried_ears` 可以循环到用户处理。
- `celebrating_jump` 播一次后回到 idle。
- `sleeping_curl` 被 urgent 事件唤醒时先播 `wake_up`，再播事件动作。

当前实现落点（2026-06-06）：

- `packages/cuu/src/idle-scheduler.ts` 已提供纯 TS `CuuIdleScheduler`，覆盖 `idle_breathe`、`idle_blink`、`idle_tail_sway`、`look_at_mouse`、`sleeping_curl`、`wake_up`、`drag_hold`、`tap_bubble`、`wave_hello`。
- `apps/desktop-webview/src/pet-surface.ts` 已接 scheduler：无卡片时按 tick 更新 `data-cuu-idle-action`，有卡片时由卡片 motion 接管，reduced-motion 下不主动播放复杂 idle 动作。
- `client-tauri/src-tauri/src/pet_window.rs` 已固定 `body_only` / `card` 双模式窗口几何、默认右下角定位、展开锚点、work area clamp、鼠标接近判定和拖拽 plan。
- `apps/desktop-webview/src/pet-window-bridge.ts` 已把 pointer hover / drag / release 接到 scheduler，并预留 Tauri `startDragging`、`set_pet_window_mode`、`save_pet_window_position`、`sample_pet_cursor_near` 端口。
- 当前仍缺真实 Tauri command、跨窗口鼠标距离采样、位置持久化和对应 full coverage atlas；scheduler 和 bridge 先把动作语义与端口固定下来。

## 7. 与 WorkHub 事件对齐

| WorkHub event / VM | Cuu action |
|---|---|
| `agent_run.started` | `thinking_tail` |
| `agent_run.step` | `thinking_tail` 或按 phase 切换 |
| `permission.ask` | `asking_approval_bounce` + approval card |
| `proposal.opened` | `carrying_document_step` + proposal card |
| `knowledge.evidence.ready` | `searching_evidence_peek` + evidence card |
| `sync.progress` | `syncing_files_spin` |
| `budget.warning` / `budget.exhausted` | `worried_ears` |
| `revision.fedback` | `revision_requested_nod` |
| `proposal.merged` / run succeeded | `celebrating_jump` |
| `sse-status:retrying/closed` | `offline_sleep` |

## 8. QA 门禁

资产门禁：

- 每张 alpha 图四角透明。
- 绿边残留低于肉眼可见阈值，必要时二次 despill。
- 同一动作内脚底 anchor 不漂移。
- 没有文字、水印、参考图残留、额外猫或额外道具。
- `CuuMotionHint.sprite_state` 全量覆盖。

运行时门禁：

- 主窗隐藏后 Cuu 仍在桌面右下角。
- 60 秒 idle 期间至少出现呼吸、眨眼、尾巴、睡觉/看鼠标中的两种微动作。
- 点击审批/证据/交付卡不需要打字。
- reduced-motion 下不播放复杂动作，但状态和按钮仍可用。
- idle CPU/GPU 不应持续高占用，离线/睡觉态降帧。
- 多显示器拔插后位置能回到可见区域。

## 9. 施工顺序

1. **Cuu Asset P1**：生成 18 个动作的绿幕 sprite sheets，完成 alpha、anchor、atlas 和 `cuu.sprite.json`。
2. **Cuu Runtime P1**：把 procedural CSS sprite 替换为 atlas renderer，继续复用现有 `CuuController`。
3. **Pet Window P1.5**：新增 `?surface=pet`，让 `pet` window 只加载 Cuu，不加载主壳。
4. **Pet Window P2**：Tauri setup 创建真实透明 pet window，按 `pet_window.rs` 默认右下角，接 `set_pet_window_mode`、`startDragging`、`save_pet_window_position`、`sample_pet_cursor_near`，支持拖动、收起、托盘显隐。
5. **Behavior P2**：idle scheduler 与 webview pointer bridge 已落；继续接真实跨窗口鼠标采样、睡觉/醒来视觉资产、事件动作优先级和 full coverage atlas。
6. **QA P2**：Playwright/Tauri screenshot + alpha pixel checks + 多屏/HiDPI/性能检查。
7. **Rive P3**：如果 sprite 切换仍显僵硬，再把高频动作迁到 Rive state machine。
8. **Live2D P4**：只有当 Cuu 需要明显表情/头部/身体形变时评估。

## 10. 当前实现与目标差距

当前已落的是 Cuu 的“逻辑层”、桌面 surface 分流和首张真实图形资产样张：

- `CuuController` 已能处理 show / replace / queue / badge / drop。
- desktop webview 已能把 SSE / mock event 转成 Cuu notice。
- evidence card 已能执行 `knowledge-search` 和 `use_for_current_task`。
- procedural CSS sprite 仍保留在主窗 notice 中，用于验证状态映射和 fallback。
- `packages/cuu/src/atlas-manifest.ts` 已新增真实 atlas manifest schema、grid frame helper、partial/full coverage 校验。
- `apps/desktop-webview/src/cuu-atlas-runtime.ts` 已能按 atlas frame rect 生成 CSS keyframes。
- `apps/desktop-webview/src/pet-surface.ts` 已支持 `/pet` 或 `?surface=pet` 只加载 Cuu 本体和轻气泡，不加载 Gold Path 主壳。
- 已生成一张 Cuu idle/breathe 绿幕 sprite sheet，并抠图为透明 PNG sample atlas。

下一步必须从“会显示”升级到“独立活着”：

- 18 个动作的完整绿幕素材批次，而不是只有 idle sample。
- 完整 alpha atlas / `cuu.sprite.json`，全量覆盖 `CuuMotionHint.sprite_state`。
- 真实 Tauri runtime 创建独立透明 `pet` window，主窗隐藏后仍常驻，并消费已落的 `pet_window.rs` 几何 plan。
- 真实 Tauri commands：`set_pet_window_mode`、`startDragging`、`save_pet_window_position`、`sample_pet_cursor_near`，把已落的 webview bridge 接到 Rust runtime。
- idle scheduler 已落基础语义；继续把呼吸、眨眼、尾巴、睡觉、看鼠标、拖动反应落到 full coverage atlas 视觉资产。
- 真实透明窗口 QA：截图、alpha 像素、HiDPI、多屏和性能。

## 11. P1 样张落地记录（2026-06-06）

本轮已经把“绿幕生成 -> 本地抠图 -> atlas runtime”跑通一遍：

| 项 | 落点 |
|---|---|
| 绿幕源图 | `apps/desktop-webview/src/assets/cuu/source-green/idle_breathe/cuu-idle-breathe-sheet-v1-green.png` |
| 透明 alpha | `apps/desktop-webview/src/assets/cuu/alpha/idle_breathe/cuu-idle-breathe-sheet-v1-alpha-clean.png` |
| sample atlas | `apps/desktop-webview/src/assets/cuu/atlas/cuu-p1-idle-breathe.png` |
| sample JSON manifest | `apps/desktop-webview/src/assets/cuu/atlas/cuu.sprite.json` |
| manifest schema | `packages/cuu/src/atlas-manifest.ts` |
| desktop asset manifest | `apps/desktop-webview/src/cuu-atlas-assets.ts` |
| atlas renderer | `apps/desktop-webview/src/cuu-atlas-runtime.ts` |
| pet surface | `apps/desktop-webview/src/pet-surface.ts` |
| idle scheduler | `packages/cuu/src/idle-scheduler.ts` |
| pet geometry contract | `client-tauri/src-tauri/src/pet_window.rs` |
| pet pointer/window bridge | `apps/desktop-webview/src/pet-window-bridge.ts` |

像素验收结果：

```text
size: 1536x1024
corners_alpha: [0, 0, 0, 0]
transparent_pixels: 1022776
partially_transparent_pixels: 11983
visible_pixels: 550088
greenish_visible_pixels: 0
```

这张样张用于证明管线可行，不等于正式资产包完成。它当前只覆盖 `idle_breathe`，非 idle 状态会在 atlas renderer 中标记 `data-fallback="true"` 并回退到 idle clip。生产门禁仍要求：

- 补齐 `thinking_tail`、`asking_approval_bounce`、`carrying_document_step`、`searching_evidence_peek`、`syncing_files_spin`、`worried_ears`、`revision_requested_nod`、`celebrating_jump`、`offline_sleep` 等业务状态。
- 补齐 blink、tail、sleep、wake、look_at_mouse、drag_hold、tap_bubble、wave_hello 等生命感微动作。
- 为每个动作记录统一 anchor、fps、loop、interruptible、priority、reduced motion frame。
- 通过 `validateCuuSpriteAtlasManifest(..., { require_full_motion_coverage: true })` 后，才允许替换主窗 notice 的 procedural sprite。
