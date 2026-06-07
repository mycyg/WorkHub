---
module: 05-clients
layer: C-PET / Cuu
status: concept
owner: workflow
---

# Cuu 绿幕素材与独立桌宠方案

> 结论：Cuu 的最终形态不是主窗口里的符号化浮层，而是一个独立 Tauri `pet` 透明窗口。P1 用 GPT Image 生成绿幕多帧素材，经本地抠图、裁切、对齐、打包成 sprite atlas，先让 Cuu 真实可见、会动、可测试；长期高表现力路线优先走 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md) 的 Live2D 分层 PSD + Cubism 绑定。GIF 只做临时预览，不作为最终桌宠目标。
>
> 2026-06-07 真实动作审计见 [`current-state-visual-audit-and-construction-plan-2026-06-07.md`](./current-state-visual-audit-and-construction-plan-2026-06-07.md)。本轮已对真实 Tauri `Cuu` 窗口做 32 帧抓取、GIF/MP4 与像素差异报告；首轮发现 `CUX-MOTION-001`：事件卡触发后 `pet` 窗口未扩到 card mode，气泡被 body-only 小窗裁切。第一轮 card layout 又暴露 Cuu 只露耳朵 / 局部的失败样例。同日已补 bridge placement 校验、compact fallback、full-body HiDPI 站位、离线人话卡和 motion capture 脚本，最终 card mode 可扩到 `394 x 568` 且 Cuu 完整身体可见；下一层重点是 Hatch Pack 鲜活动作、稳定 body anchor 与 Live2D。

## 1. 目标体验

Cuu 应该像多年前 QQ 宠物那类“桌面常驻角色”，但行为更克制、工作化：

- 默认待在屏幕右下角或用户拖到的位置，主窗隐藏后仍存在。
- 没任务时也有低频生命感：呼吸、眨眼、看向鼠标、尾巴摆动、打盹。
- 有事时用动作先提醒，再出现气泡：审批、澄清、证据、交付物变更包。
- 用户可以拖动、收起、静音、勿扰；Cuu 不能挡住用户正在操作的区域。
- 复杂工作不在宠物窗里铺满，Cuu 只承接一个轻卡，必要时 deep-link 打开主窗。

### 1.1 Cuu Alive Gate

Cuu 的鲜活感是硬门槛，不是美术加分项。后续任何 Cuu 相关模块不能只交一张漂亮静态图，必须证明它“平常会自己动，任务来时有对应动作”。

| 场景 | 必须表现 | 失败判定 |
|---|---|---|
| 0-10 秒 idle | 呼吸 + 眨眼至少出现一次 | 连续 5 秒像素变化只来自阴影/抗锯齿，或肉眼像静态贴纸 |
| 10-60 秒 idle | 尾巴、耳朵、看鼠标、打盹、醒来中至少两类随机出现 | 只有单一循环，用户一眼看穿是重复 GIF |
| 鼠标靠近 | 抬头/看向鼠标/轻摆尾巴 | 鼠标靠近只变 cursor，没有角色反应 |
| 轻任务 | Cuu 先做动作，再出现气泡 | 只弹卡片，不改变 Cuu 动作 |
| 审批/澄清 | `waiting` / `asking_approval_bounce` 明确表达“需要你点一下” | 动作与 idle 无差别 |
| 证据/检索 | `review` / `searching_evidence_peek` 明确表达“在看资料” | 只是换标题，不换动作 |
| 成功/完成 | `celebrating_jump` 或挥手 | 完成后没有庆祝反馈 |
| 离线/失败 | 温和的困惑/打盹/重连动作，不吓人 | 红叉、报错感强、像崩溃提示 |

运行时必须有一个动作队列，而不是只按状态切静态图：

```text
idle scheduler
  -> low-frequency random micro action
  -> pointer reaction
  -> event-driven foreground action
  -> bubble/card enter
  -> settle back to idle variant
```

motion capture 验收必须能看出这些变化。单帧 smoke 只能证明 Cuu 可见，不能证明 Cuu 活着。

## 2. 架构决策

| 层 | 决策 | 原因 |
|---|---|---|
| 视觉资产 | 绿幕生成 PNG 帧，抠图后打包成 atlas | 最快得到真实小猫形象，避免 procedural CSS 的符号感 |
| MVP renderer | CSS/Canvas sprite atlas | 简单、稳定、可测试，适合先让 Cuu 独立活起来，并作为 Live2D 失败降级 |
| 桌面载体 | Tauri 独立 `pet` window | 主窗隐藏后仍常驻，符合桌宠定位 |
| 状态调度 | TS `CuuController` + animation queue | 业务状态仍来自 daemon，动画不进 Rust |
| 后续升级 | Live2D 分层 PSD + Cubism runtime；Rive 可选 | Live2D 最符合“活着的小猫桌宠”；Rive 可作为中间路线但不替代 Live2D 主目标 |
| 宠物包补强 | Hatch Pet 8 x 9 spritesheet 规格 | 在 Live2D 前先得到更一致、更可爱的多动作 Cuu，并能形成固定 QA 合同 |

不要把 Cuu 做成：

- 主窗口右下角固定 div。
- 只会显示一个 Bot 图标的状态灯。
- SVG 符号或渐变圆点。
- 依赖用户先打开页面才能看到的组件。

### 2.1 Hatch Pet 补充路线

用户提到的 [Hatch Pet recipe](https://github.com/freestylefly/CodexGuide/blob/main/docs%2Frecipes%2Fhatch-pet-photo.md) 可作为 WorkHub Cuu P1.1 的补强路线。它不替代本文的绿幕 / 抠图 / 独立窗口方案，也不替代 Live2D 长期目标；它提供的是一套更规整的宠物包规格，适合快速把 Cuu 从“有素材”推进到“像一个完整桌宠”。

WorkHub 采用的 Hatch Pet 合同：

| 项 | 规格 |
|---|---|
| spritesheet | `1536 x 1872` PNG/WebP |
| grid | 8 列 x 9 行 |
| cell | `192 x 208` |
| 背景 | 透明；生成阶段可用绿幕，入包前必须抠成 alpha |
| unused cells | 完全透明 |
| states | `idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review` |
| metadata | `pet.json` 记录名称、帧率、状态行、锚点、预览和版本 |

WorkHub Cuu 映射：

| WorkHub Cuu state | Hatch state |
|---|---|
| `idle_breathe` / `idle_blink` / `idle_tail_sway` | `idle` |
| `thinking_tail` / `syncing_files_spin` | `running` |
| `asking_approval_bounce` / `tap_bubble` | `waiting` |
| `searching_evidence_peek` / `carrying_document_step` | `review` |
| `worried_ears` / `offline_sleep` | `failed` |
| `celebrating_jump` / `wave_hello` | `jumping` 或 `waving` |
| `drag_hold` / `look_at_mouse` | `idle` 的高优先变体 |

Hatch Pack 目标落点：

```text
apps/desktop-webview/src/assets/cuu/hatch/cuu-hatch-v1/
  spritesheet.png
  spritesheet.webp
  pet.json
  contact-sheet.png
  motion-preview.gif
  qa-report.json
packages/cuu/src/hatch-state-map.ts
apps/desktop-webview/src/cuu-hatch-assets.ts
apps/desktop-webview/src/cuu-hatch-runtime.ts
```

验收重点：

- 角色必须保持用户参考猫的原创 Q 版识别点：橘色虎斑、奶油脸/爪、白蕾丝围兜、黑蝴蝶结、珍珠流苏与红珠。
- 5 秒 idle 捕获中不能像静态贴图；至少有呼吸、眨眼、尾巴或看向鼠标中的两类变化。
- 60 秒 idle 捕获中必须出现随机微动作，不能只有固定循环；待机动作需要有概率、冷却和优先级。
- `waiting` 必须一眼看出“需要用户点选”，`review` 必须一眼看出“正在看交付物/证据”。
- 不出现文字、水印、额外动物、绿色边缘、裁耳裁尾或脚底 anchor 漂移。
- card mode 中 Cuu 必须完整出现在右下角；只露耳朵 / 裁尾 / 裁爪 / 局部出画一律判失败。
- Hatch sprite 可以成为 Live2D 加载失败时的长期 fallback。

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

- **动作 sprite sheet**：一次生成 6-8 格同一动作，适合 `idle`、`thinking`、`searching`。优点是一致性高，也能作为 Live2D motion storyboard。
- **单帧补图**：补关键帧或修坏帧，适合 `celebrating`、`wake_up` 这类一次性动作。
- **Live2D 拆件参考**：生成正面模型板和分层拆件图，不直接要求一次输出 PSD。正式图层树见 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md)。

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
    asking_approval_bounce/
    carrying_document_step/
    celebrating_jump/
    searching_evidence_peek/
    syncing_files_spin/
    worried_ears/
    revision_requested_nod/
    offline_sleep/
  alpha/
    idle_breathe/
    thinking_tail/
    asking_approval_bounce/
    carrying_document_step/
    celebrating_jump/
    searching_evidence_peek/
    syncing_files_spin/
    worried_ears/
    revision_requested_nod/
    offline_sleep/
  atlas/
    cuu-p1-motion-pack.png
    cuu.sprite.json
  live2d/
    source/
      cuu-live2d-v0.psd
      cuu-live2d-v0-layer-manifest.json
    exported/
      cuu.model3.json

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
  -> Tauri auto-creates main; pet is declared with create:false
  -> Rust setup builds pet from config and injects window.__WORKHUB_SURFACE__ = "pet"
  -> pet loads the same desktop webview bundle at /
  -> Rust restores and clamps saved body anchor, then positions body-only Cuu at bottom-right
  -> Rust converts monitor/window/cursor physical pixels to logical pixels for HiDPI screens
  -> Rust sets always-on-top at startup and whenever pet is shown or resized
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

同一个 Vite build 的生产 Tauri 入口不依赖静态 SPA fallback。生产 pet 由 Rust 初始化脚本注入 `window.__WORKHUB_SURFACE__ = "pet"`；浏览器调试和自动化预览继续保留 `/pet`、`?surface=pet`、`#surface=pet` 与 `pet.html`：

```text
/               -> Gold Path / desktop workbench, unless Rust injected pet surface flag
/pet            -> browser/debug Cuu transparent pet surface
/?surface=pet   -> browser/debug Cuu transparent pet surface
#surface=pet    -> browser/debug Cuu transparent pet surface
pet.html        -> browser/debug Cuu transparent pet surface
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

当前实现落点（2026-06-07）：

- `packages/cuu/src/idle-scheduler.ts` 已提供纯 TS `CuuIdleScheduler`，覆盖 `idle_breathe`、`idle_blink`、`idle_tail_sway`、`look_at_mouse`、`sleeping_curl`、`wake_up`、`drag_hold`、`tap_bubble`、`wave_hello`。
- `apps/desktop-webview/src/pet-surface.ts` 已接 scheduler：无卡片时按 tick 更新 `data-cuu-idle-action` 并按该 action 选择真实 atlas clip，有卡片时由卡片 motion 接管，reduced-motion 下不主动播放复杂 idle 动作。
- `client-tauri/src-tauri/src/pet_window.rs` 已固定 `body_only` / `card` 双模式窗口几何、默认右下角定位、展开锚点、work area clamp、鼠标接近判定和拖拽 plan；`client-tauri/src-tauri/src/main.rs` 会用 `WebviewWindowBuilder::from_config` 动态创建 `create:false` 的 `pet` window，并通过 initialization script 标记 pet surface，避免 Tauri 静态 asset protocol 下的 SPA route fallback 问题。
- `apps/desktop-webview/src/pet-window-bridge.ts` 已把 pointer hover / drag / release 接到 scheduler，并接入 Tauri `startDragging`、`set_pet_window_mode`、`save_pet_window_position`、`sample_pet_cursor_near` 端口。
- `client-tauri/src-tauri/src/pet_commands.rs` 已固定 `set_pet_window_mode`、`start_pet_window_drag`、`save_pet_window_position`、`sample_pet_cursor_near` 的 command 名称和 typed plan；`client-tauri/src-tauri/src/main.rs` 已用 `tauri::Builder` 注册这些 command，并把 mode resize/position/show、drag、save-position、cursor sampling 执行到真实 Tauri window / AppHandle API；capability 已开放最小 `core:window:allow-start-dragging`。
- `apps/desktop-webview/src/cuu-atlas-runtime.ts` 已改为 clip sheet `<img>` frame stack，并加入内联静态 Cuu fallback；Tauri/WebView2 若加载大 PNG 资产失败，仍能显示一只呼吸态 Cuu，不会变成空透明窗口。
- 当前已具备跨窗口鼠标距离采样、body anchor 位置落盘和启动期 Cuu body-only 显示；位置保存到 Tauri Config 目录下的 `pet-window-state.json`，启动时会按当前 work area clamp 防离屏并恢复到右下角/保存位置；Rust 侧已把 monitor work area、window outer position、cursor position 做 physical→logical 换算，修复高 DPI 屏幕离屏问题；运行期会显式设置 `set_always_on_top(true)`，修复主窗盖住 pet 的层级问题；2026-06-07 Windows debug smoke 已确认独立 `Cuu` window visible/topmost，右下角透明浮层能显示 Cuu 与气泡。`scripts/qa/cuu-tauri-smoke.ps1` 已能隐藏主窗并用 `PrintWindow` 对 `Cuu` 窗口做像素检查；仍缺多显示器 work-area 实测/恢复、安装包 smoke、长期运行性能 QA 和 atlas 体积压缩；scheduler、bridge、command scaffold 和最小 runtime 已把动作语义与端口固定下来。

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
| `revision.feedback` | `revision_requested_nod` |
| `proposal.merged` / run succeeded | `celebrating_jump` |
| `sse-status:retrying/closed` | `offline_sleep` |

## 8. QA 门禁

资产门禁：

- 每张 alpha 图四角透明。
- 绿边残留低于肉眼可见阈值，必要时二次 despill。
- 同一动作内脚底 anchor 不漂移。
- 没有文字、水印、参考图残留、额外猫或额外道具。
- `CuuMotionHint.sprite_state` 与 idle / interaction micro action 全量覆盖。

运行时门禁：

- 主窗隐藏后 Cuu 仍在桌面右下角。
- 60 秒 idle 期间至少出现呼吸、眨眼、尾巴、睡觉/看鼠标中的两种微动作；其中眨眼必须是短促非循环，不能把整段 idle 都做成同一个 GIF 循环。
- 任务事件必须触发对应 foreground action，再进入轻卡；不得只换气泡文字。
- motion capture / 多帧截图必须能证明 Cuu 不是一张死图：需要输出 contact sheet、GIF/MP4 和 diff JSON，并人工审查动作是否有语义。
- 点击审批/证据/交付卡不需要打字。
- reduced-motion 下不播放复杂动作，但状态和按钮仍可用。
- idle CPU/GPU 不应持续高占用，离线/睡觉态降帧。
- 多显示器拔插后位置能回到可见区域。
- 当前已落静态门禁：`apps/desktop-webview/src/pet-surface-qa.ts` 会检查透明 root、右下角 `pet` surface、非主壳、多帧 atlas、card mode 轻气泡、点击选项和打回理由按钮；该门禁随 `pnpm --filter @workhub/desktop-webview test` 执行。
- 当前已落 Windows debug runtime 门禁：`scripts/qa/cuu-tauri-smoke.ps1` 会启动真实 Tauri debug app、定位 `Cuu` 顶层窗口、校验 visible/topmost/bottom-right、隐藏主窗，并通过 `PrintWindow(PW_RENDERFULLCONTENT)` 截取透明/layered WebView2 窗口后统计橘色/奶油/暗色可见像素。2026-06-07 严格 smoke 通过：`orange_pixels=8961`、`visual_pixels=11189`。脚本现在会在 1420 端口未监听时自动启动 desktop webview dev server，避免误抓 WebView 错误页。
- 当前已落 Windows motion 门禁：`scripts/qa/cuu-tauri-motion-capture.ps1` 会连续抓取真实 `Cuu` 顶层窗口 frames，生成 contact sheet、GIF/MP4 和 diff JSON。2026-06-07 最终 fresh 抓帧确认事件卡触发后窗口从 `194 x 228` 扩到 `394 x 568`，不再把卡片塞进 body-only 小窗；Cuu 在 card mode 中完整身体可见，轻卡右侧有 HiDPI 安全留白。第一轮只露耳朵 / 局部截图保留为回归失败样例，不能再被当作通过证据。
- Windows 全屏桌面截图对透明/layered WebView2 不可靠，可能捕不到独立窗口内容；Cuu runtime QA 以 pet hwnd 的 `PrintWindow` 或后续平台专用 compositor capture 为准。

## 9. 施工顺序

1. **Cuu Asset P1**：生成 18 个动作的绿幕 sprite sheets，完成 alpha、anchor、atlas 和 `cuu.sprite.json`。
2. **Cuu Runtime P1**：把 procedural CSS sprite 替换为 atlas renderer，继续复用现有 `CuuController`。
3. **Pet Window P1.5**：已新增 pet surface 分流。生产 Tauri 通过 Rust injected surface flag 进入 pet；`/pet`、`?surface=pet`、`#surface=pet` 与 `pet.html` 作为调试入口。
4. **Pet Window P2**：Tauri setup 动态创建真实透明 pet window，按 `pet_window.rs` 默认右下角/保存位置启动显示 body-only Cuu，已接 `set_pet_window_mode`、`startDragging`、`save_pet_window_position`、`sample_pet_cursor_near`、`pet-window-state.json` 位置落盘、托盘显隐和 Windows debug smoke；继续补收起细节、多屏恢复实测和安装包 smoke。
5. **Behavior P2**：idle scheduler、webview pointer bridge、Rust cursor sample、18 clip full coverage atlas 和静态 fallback 已接；继续接系统 idle 策略、长驻性能降级、任务 foreground action 队列和主窗 notice 替换策略。此项必须优先保证 Cuu 平常会自己动、会眨眼、会待机，不允许退回静态图。
6. **QA P2**：已落 pet surface 静态视觉合同和 Windows `PrintWindow` runtime smoke；继续补 Playwright/Tauri alpha 边缘 fixture、多屏/HiDPI/性能检查和 Linux/macOS capture。
7. **Live2D P2/P3**：按 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md) 生成正面基准稿、分层 PSD、Cubism 绑定和 `.model3.json` 导出；sprite atlas 作为降级。
8. **Rive 可选**：如果 Live2D 许可/工具链阻塞，而 sprite 切换又显僵硬，再把高频动作临时迁到 Rive state machine。

## 10. 当前实现与目标差距

当前已落的是 Cuu 的“逻辑层”、桌面 surface 分流和一批真实图形资产 seed：

- `CuuController` 已能处理 show / replace / queue / badge / drop。
- desktop webview 已能把 SSE / mock event 转成 Cuu notice。
- evidence card 已能执行 `knowledge-search` 和 `use_for_current_task`。
- procedural CSS sprite 仍保留在主窗 notice 中，用于验证状态映射和 fallback。
- `packages/cuu/src/atlas-manifest.ts` 已新增真实 atlas manifest schema、grid frame helper、partial/full coverage 校验。
- `apps/desktop-webview/src/cuu-atlas-runtime.ts` 已能按 atlas frame rect 生成 CSS keyframes。
- `apps/desktop-webview/src/pet-surface.ts` 已支持 Rust injected surface flag、Tauri window label、`/pet`、`?surface=pet`、`#surface=pet` 和 `pet.html` 只加载 Cuu 本体和轻气泡，不加载 Gold Path 主壳。
- 已生成 18 个动作的绿幕 sprite sheet，完成 alpha 抠图，并合成 `cuu-p1-motion-pack.png`。
- 2026-06-07 已修复 Tauri dev server 下 `/src/assets/...` 被误归一为 `./assets/...` 的资源路径问题；真实 `Cuu` 顶层窗口 motion capture 已看到 body-only `idle_tail_sway` 和 card mode worried/offline 姿态。静态 fallback 不再作为运行态通过依据。

下一步必须从“会显示”升级到“独立活着”：

- 18 个动作的完整绿幕素材批次已落，`CuuMotionHint.sprite_state` 与 scheduler micro action 均已 full coverage。
- 继续做 anchor 微调、WebP/PNG 压缩、长时间 idle 性能检查和主窗 notice 是否替换 atlas 的取舍；pet surface 静态视觉 QA 已由 `pet-surface-qa.ts` 覆盖，真实 motion QA 已由 `cuu-tauri-motion-capture.ps1` 覆盖。
- 真实 Tauri runtime 已在启动期显示独立透明 `pet` window 的 body-only Cuu，并消费已落的 `pet_window.rs` 几何 plan；2026-06-07 已用 Windows debug smoke 证明 `Cuu` window 位于右下角、visible/topmost，并能在主窗隐藏后显示 Cuu 与气泡。
- Live2D 正式 PSD 与 Cubism runtime 尚未落；当前已有 `cuu-live2d-layer-breakdown-concept.png`、`cuu-live2d-front-model-concept.png`、`cuu-live2d-psd-production-board.png`、`cuu-live2d-v0-layer-manifest.json` 和专篇作为施工合同。
- 真实 Tauri commands：启动期 body-only 显示、`set_pet_window_mode`、`startDragging`、`save_pet_window_position`、`sample_pet_cursor_near` 已把 webview bridge 接到 Rust runtime，并已保存 `pet-window-state.json`；HiDPI 坐标换算和 runtime topmost 已接；下一步补多屏恢复实测、拖拽后截图、安装包 smoke 和跨平台透明 capture。
- idle scheduler 已落基础语义，并能把呼吸、眨眼、尾巴、睡觉、看鼠标、拖动反应落到真实 atlas 视觉资产。
- 真实透明窗口 QA：当前已完成 Windows debug `PrintWindow` 像素 smoke；下一步仍需把 alpha 边缘、HiDPI、多屏、拖拽后位置和性能纳入自动化门禁。

## 11. P1 资产落地记录（2026-06-06）

本轮已经把“绿幕生成 -> 本地抠图 -> atlas runtime”推进到 18 个动作 full coverage motion pack：

| 项 | 落点 |
|---|---|
| 绿幕源图 | `apps/desktop-webview/src/assets/cuu/source-green/{18 action ids}/` |
| 透明 alpha | `apps/desktop-webview/src/assets/cuu/alpha/{18 action ids}/` |
| runtime atlas | `apps/desktop-webview/src/assets/cuu/atlas/cuu-p1-motion-pack.png` |
| runtime JSON manifest | `apps/desktop-webview/src/assets/cuu/atlas/cuu.sprite.json` |
| inline static fallback | `apps/desktop-webview/src/assets/cuu/static/cuu-static-fallback-v1-alpha-clean.png`，仅诊断/兜底，不作为运行态 motion pass |
| manifest schema | `packages/cuu/src/atlas-manifest.ts` |
| desktop asset manifest | `apps/desktop-webview/src/cuu-atlas-assets.ts` |
| atlas renderer | `apps/desktop-webview/src/cuu-atlas-runtime.ts` |
| pet surface | `apps/desktop-webview/src/pet-surface.ts` |
| pet visual QA contract | `apps/desktop-webview/src/pet-surface-qa.ts` |
| idle scheduler | `packages/cuu/src/idle-scheduler.ts` |
| pet geometry contract | `client-tauri/src-tauri/src/pet_window.rs` |
| pet command scaffold | `client-tauri/src-tauri/src/pet_commands.rs` |
| Tauri runtime scaffold | `client-tauri/src-tauri/{build.rs,src/main.rs}` |
| pet pointer/window bridge | `apps/desktop-webview/src/pet-window-bridge.ts` |
| Windows runtime smoke | `scripts/qa/cuu-tauri-smoke.ps1` |
| Windows motion capture | `scripts/qa/cuu-tauri-motion-capture.ps1` |

本轮像素验收结果（所有 clip 可见绿边统计均为 0）：

```text
atlas: 1776x16120
clips: idle_breathe, thinking_tail, asking_approval_bounce, carrying_document_step, celebrating_jump, searching_evidence_peek, syncing_files_spin, worried_ears, revision_requested_nod, offline_sleep, idle_blink, idle_tail_sway, look_at_mouse, sleeping_curl, wake_up, drag_hold, tap_bubble, wave_hello
idle_breathe: 1536x1024, visible=550088, partial=11983, greenish_visible=0
thinking_tail: 1776x888, visible=535770, partial=12502, greenish_visible=0
asking_approval_bounce: 1776x888, visible=533992, partial=16453, greenish_visible=0
carrying_document_step: 1776x888, visible=480759, partial=13256, greenish_visible=0
celebrating_jump: 1776x888, visible=433997, partial=11469, greenish_visible=0
searching_evidence_peek: 1776x888, visible=515903, partial=20764, greenish_visible=0
syncing_files_spin: 1776x888, visible=496776, partial=10523, greenish_visible=0
worried_ears: 1776x888, visible=574405, partial=12924, greenish_visible=0
revision_requested_nod: 1776x888, visible=503304, partial=10329, greenish_visible=0
offline_sleep: 1776x888, visible=442821, partial=7090, greenish_visible=0
idle_blink: 1776x888, visible=543653, partial=12584, greenish_visible=0
idle_tail_sway: 1776x888, visible=521457, partial=8818, greenish_visible=0
look_at_mouse: 1776x888, visible=460812, partial=8767, greenish_visible=0
sleeping_curl: 1776x888, visible=455579, partial=6505, greenish_visible=0
wake_up: 1776x888, visible=502394, partial=10913, greenish_visible=0
drag_hold: 1776x888, visible=515240, partial=10758, greenish_visible=0
tap_bubble: 1776x888, visible=509808, partial=11686, greenish_visible=0
wave_hello: 1776x888, visible=585108, partial=11280, greenish_visible=0
```

这个 motion pack 已让 `CuuMotionHint.sprite_state` 业务状态与 scheduler micro action 都 full coverage，`validateCuuSpriteAtlasManifest(..., { require_full_motion_coverage: true, require_idle_micro_action_coverage: true })` 应通过。生产门禁仍要求：

- 为每个动作记录统一 anchor、fps、loop、interruptible、priority、reduced motion frame。
- 同时通过 `require_full_motion_coverage` 与 `require_idle_micro_action_coverage` 后，才允许评估替换主窗 notice 的 procedural sprite。
- 在真实 Tauri 透明窗口中截图确认非空、无绿边、无黑底泄漏、无离屏，并且必须看到非缩放动作；只显示静态 fallback、只露耳朵、只有大小变化都判失败。根据结果做 WebP/PNG 体积优化。
