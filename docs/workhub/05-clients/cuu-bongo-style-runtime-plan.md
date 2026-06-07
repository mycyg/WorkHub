---
module: 05-clients
layer: C-PET / Cuu / Bongo-style runtime
status: p1-default-low-uncanny
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/audit/2026-06-08-cuu-bongo-runtime/pet-bongo-cuu-cdp-contact-sheet-grid.png
  - ./assets/audit/2026-06-08-cuu-bongo-p1b-runtime/pet-bongo-p1b-idle-contact-sheet-grid.png
  - ./assets/audit/2026-06-08-cuu-bongo-p1b-runtime/pet-bongo-p1b-gallery-contact-sheet-grid.png
  - ./assets/audit/2026-06-08-cuu-bongo-p1b-tauri/cuu-motion-contact-sheet.png
  - ./assets/audit/2026-06-08-cuu-bongo-p1c-first-paint/cuu-motion-contact-sheet.png
---

# Cuu Bongo-style 低恐怖谷桌宠路线

> 结论：当前 `generated-psd-draft-v1` 只能作为技术探针，不应该默认展示给用户。Cuu P1 默认视觉改为 **BongoCat 式扁平、稳定、低恐怖谷 renderer**；PSD / Live2D 继续保留为实验线，只有精修 PSD + Cubism + 多秒录屏全部通过后，才允许回到默认。

参考项目：[ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)。本仓库只学习架构和交互思路，不复制它的模型或素材；本地参考代码放在 `reference/ayangweb-BongoCat/`，禁止提交。

---

## 0. 当前截图

![Cuu Bongo-style runtime contact sheet](./assets/audit/2026-06-08-cuu-bongo-runtime/pet-bongo-cuu-cdp-contact-sheet-grid.png)

本轮 browser pet surface 抓图确认：

| 检查项 | 结果 |
|---|---|
| 默认 renderer | `data-cuu-visual-mode="bongo_cuu"` |
| Bongo runtime | `data-cuu-bongo-runtime="bongo_cuu"` |
| 默认模型包 | `data-cuu-model-pack="cuu-bongo-p1"` |
| 低恐怖谷门 | `data-cuu-default-visual-gate="low_uncanny"` |
| 状态 | `p1_default_low_uncanny` |
| 组件数 | `31` 个 DOM/CSS 组件 |
| PSD 暴露 | `live2d=null`，`layers=[]`，默认 HTML 不含 `data-psd-layer` |
| 截图 | 全身可见，不是只露耳朵 / 局部 / 空白 |
| 动作 | 尾巴、头、眨眼、爪子、耳朵、文档卡状态由 CSS keyframes 驱动 |

2026-06-08 P1b/P1c 追加证据：

![Cuu Bongo P1b idle runtime](./assets/audit/2026-06-08-cuu-bongo-p1b-runtime/pet-bongo-p1b-idle-contact-sheet-grid.png)

![Cuu Bongo P1b state gallery](./assets/audit/2026-06-08-cuu-bongo-p1b-runtime/pet-bongo-p1b-gallery-contact-sheet-grid.png)

![Cuu Bongo P1b real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1b-tauri/cuu-motion-contact-sheet.png)

![Cuu Bongo P1c first-painted Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1c-first-paint/cuu-motion-contact-sheet.png)

| 检查项 | 结果 |
|---|---|
| 默认 idle 多帧 | 8 帧 browser CDP；尾巴/头/眼可见变化，最高 `18.97%` 像素相对首帧变化 |
| 状态墙多帧 | 12 个状态同屏；wave/search/sync/revise/celebrate 等动作可肉眼区分，最高 `25.17%` 像素相对首帧变化 |
| 真实 Tauri 录屏 | `scripts/qa/cuu-tauri-motion-capture.ps1` 通过；输出 contact sheet、GIF、MP4 和 diff report |
| first-painted gate | 通过；`first_frame_gate.passed=true`，第 7 次 probe 后达到 `orange_pixels=9408`、`visual_pixels=15530` |
| 真实窗口首帧 | 通过；P1c contact sheet 的 frame 000 已是 body-only Cuu 全身可见，不再把 blank 帧收进证据 |
| 当前结论 | BONGO-P1b 动作增强通过；BONGO-P1c 首帧稳定通过；下一步转向窗口体验和动作幅度二轮 |

证据文件：

```text
docs/workhub/05-clients/assets/audit/2026-06-08-cuu-bongo-runtime/
  pet-bongo-cuu-cdp-contact-sheet-grid.png
  pet-bongo-cuu-cdp-frame-0000.png
  pet-bongo-cuu-cdp-frame-0700.png
  pet-bongo-cuu-cdp-frame-1400.png
  pet-bongo-cuu-cdp-frame-2100.png
  pet-bongo-cuu-cdp-frame-2800.png
  pet-bongo-cuu-cdp-frame-3500.png
  pet-bongo-cuu-cdp-frame-4200.png
  pet-bongo-cuu-cdp-frame-4900.png
  pet-bongo-cuu-cdp-dom.json
  pet-bongo-cuu-cdp-diff-report.json
  pet-bongo-cuu-cdp-report.json
```

---

## 1. 为什么转向 Bongo-style

用户复核后给出的判断非常明确：当前 PSD draft 有恐怖谷风险，不能默认展示。桌宠是常驻桌面角色，视觉失败比功能缺失更伤体验。

BongoCat 值得参考的不是“键盘猫”这个具体题材，而是这几个工程原则：

| 原则 | Cuu 落地 |
|---|---|
| 低拟真 | 用圆润扁平造型，不追求真实毛发、复杂五官和照片感 |
| 少状态、强反馈 | idle、tap、thinking、approval、worried、celebrate 等少量动作先做清楚 |
| 输入映射直观 | 键盘/鼠标映射手和眼；WorkHub 映射审批、证据、文件、离线 |
| 模型可替换 | 默认 renderer 简洁，后续可以换成 Live2D / Cubism / 自定义模型 |
| 窗口能力独立 | 透明、置顶、缩放、穿透、拖动、贴屏是桌宠底座能力 |
| 离线隐私友好 | 桌宠本体可离线运行，事件和数据由 WorkHub 安全通道提供 |

对 Cuu 来说，P1 的成功标准不是“像真猫”，而是“用户愿意让它待在右下角”。

### 1.1 BongoCat 参考实现吸收点

已下载到 `reference/ayangweb-BongoCat/` 的参考项目只用于学习，不提交进仓库。对 WorkHub 有价值的实现点如下：

| BongoCat 能力 | 参考落点 | WorkHub 当前状态 | 后续落点 |
|---|---|---|---|
| 可替换模型 | `src/stores/model.ts`、`src/composables/useModel.ts` | 新增 `packages/cuu/src/model-pack.ts` 作为 Cuu 模型包契约；默认包为 `cuu-bongo-p1` | P2 做 `Cuu model preset + custom model slot`，Live2D 通过后作为另一个 pack |
| 输入到动作参数 | `useDevice.ts`、`useModel.ts` 的键鼠/光标映射 | WorkHub 已有 hover / tap / drag / cursor_near 调度；业务事件映射审批、证据、同步、预算；P1d-a 已把 scale / opacity / pass-through 接成偏好和 Rust bridge；P1e-a 已把 cursor-near 进入事件映射为立即 `look_at_mouse`，并把 pointer state 写入 DOM | P1e-b 继续做鼠标平滑视线、hover 避让和真实截图 |
| 独立透明窗口 | Tauri window plugin、always-on-top、skip taskbar | WorkHub 已有 `pet` 透明顶层窗口、body/card mode、拖动、保存位置、缩放几何、CSS 透明度和点击穿透命令 | P1d-b 补 hide-on-hover、keep-in-screen 多屏实测、Settings 视觉页与截图 |
| 低恐怖谷默认 | BongoCat 低拟真角色动作 | WorkHub 默认 `bongo_cuu`，PSD draft 被降级为实验 | 默认候选必须过 `assertCuuModelPackCanBeDefault()` |
| 离线隐私友好 | README 明确离线运行 | Cuu 本体可在 webview 里离线渲染，数据从 WorkHub 安全通道来 | 设备输入监听只做本地手感，不采集无关数据 |

新增代码门禁：

```text
packages/cuu/src/model-pack.ts
packages/cuu/src/model-pack.test.ts
apps/desktop-webview/src/cuu-bongo-runtime.ts
```

`CuuModelPackManifest` 把“默认可展示”收敛为一个可测试合同：默认包必须低恐怖谷、非 PSD draft、全身可见、角色稳定、无 AI 肢体幻觉、有活体动作，并覆盖所有业务动作与 idle 微动作。`cuu-psd-draft-v1` 这类资产即使技术可挂载，也会因为 `default_not_approved`、`visual_gate_failed`、`psd_default_asset` 被拒绝为默认。

---

## 2. 当前实现落点

```text
apps/desktop-webview/src/cuu-bongo-runtime.ts
apps/desktop-webview/src/pet-surface.ts
apps/desktop-webview/src/pet-surface-qa.ts
apps/desktop-webview/src/pet-surface.test.ts
scripts/qa/cuu-pet-browser-capture.mjs
```

`cuu-bongo-runtime.ts` 使用 DOM/CSS 画出 Cuu 的低恐怖谷版本：

| 组件 | 作用 |
|---|---|
| head / body / cream muzzle | 保持小猫识别，不追求写实 |
| ears | idle 轻动，worried/offline 压耳 |
| eyes | idle 眨眼，offline 眯眼 |
| tail | idle / thinking / search 时独立摆动 |
| paws | approval / tap 时敲桌面 |
| bib / bow / beads | 保留参考照的围兜、黑蝴蝶结、红珠识别点 |
| desk / doc | BongoCat 式桌面动作，approval / carrying document 时出现 |
| search glass / rays | 检索状态的放大镜和短光线 |
| sync ring | 同步状态的绿色旋转环 |
| sparks | 完成/庆祝状态的跳跃反馈 |

默认 pet surface 现在只渲染 Bongo Cuu：

```text
renderDesktopPetSurface()
  -> renderDesktopCuuAtlasState/Sprite(...)   # fallback 诊断仍保留
  -> renderDesktopCuuBongo...                 # 默认主视觉
  -> data-cuu-visual-mode="bongo_cuu"
  -> data-cuu-live2d-status="experiment_hidden"
```

PSD / Live2D 文件仍保留，但不进入默认 HTML：

```text
apps/desktop-webview/src/cuu-live2d-psd-draft-runtime.ts  # 实验探针
apps/desktop-webview/src/cuu-live2d-runtime.ts            # 8 层 regression fixture
packages/cuu/src/live2d-psd-draft.ts                      # PSD draft validator
```

---

## 3. Runtime Contract

当前默认 renderer 的字段：

```ts
type DesktopCuuBongoRender = {
  runtime_kind: "bongo_cuu";
  status: "p1_default_low_uncanny";
  model_pack_id: "cuu-bongo-p1";
  state: CuuSpriteAtlasClipState | CuuIdleMicroAction;
  motion_state: CuuSpriteAtlasClipState;
  component_count: number;
  duration_ms: number;
  html: string;
  css: string;
};
```

默认 surface 必须满足：

| 字段 | 目标 |
|---|---|
| `visual_mode` | `bongo_cuu` |
| `data-cuu-bongo-runtime` | `bongo_cuu` |
| `data-cuu-model-pack` | `cuu-bongo-p1` |
| `data-cuu-default-visual-gate` | `low_uncanny` |
| `data-cuu-bongo-status` | `p1_default_low_uncanny` |
| `data-cuu-live2d-status` | `experiment_hidden` |
| `data-cuu-live2d-layer-count` | `0` |
| PSD layer DOM | 默认不得出现 |
| atlas fallback | 仍保留，且 `data-cuu-atlas-fallback="false"` 表示 fallback 资产可用 |

---

## 4. Motion Mapping

| WorkHub / Cuu state | Bongo Cuu 表现 |
|---|---|
| `idle_breathe` | 头部轻浮动，尾巴低幅度摆动 |
| `idle_blink` | 眨眼 |
| `idle_tail_sway` | 尾巴明显摆动 |
| `look_at_mouse` | 后续补眼球/头部朝向；当前保留 idle 可爱表情 |
| `asking_approval_bounce` | 双爪敲桌，文档卡弹出 |
| `thinking_tail` | 尾巴更快摆动 |
| `searching_evidence_peek` | 尾巴/眼睛状态变为检索感，后续补放大镜/文件动作 |
| `carrying_document_step` | 文档卡出现，双爪托住 |
| `worried_ears` | 压耳，低头感 |
| `celebrating_jump` | 整体轻跳 |
| `offline_sleep` | 眯眼、压耳、低存在感 |
| `tap_bubble` | 单次爪击反馈 |
| `drag_hold` | 双爪压住桌面，尾巴收紧，表达正在拖动/抓握 |
| `wave_hello` | 单爪抬起挥手，头和尾巴同步更大幅度动作 |

---

## 5. QA 门禁

默认 Cuu 必须先过这些低恐怖谷门：

- 全身可见，不允许只露耳朵、只露局部或被气泡裁切。
- 默认 HTML 不允许出现 `data-psd-layer`。
- DOM 必须出现 `data-cuu-bongo-runtime="bongo_cuu"`。
- DOM 必须出现 `data-cuu-model-pack="cuu-bongo-p1"` 和 `data-cuu-default-visual-gate="low_uncanny"`。
- 必须有 paws / eyes / tail 三类组件。
- 搜索、同步、庆祝三类状态必须有对应道具层：`search-glass` / `sync-ring` / `spark`。
- 任何多腿、多眼、尾巴断裂、脸部拟真漂移都直接失败。
- reduced-motion 必须关闭 keyframes。
- Bongo Cuu 可以简单，但不能冷冰冰；至少要有待机、眨眼、尾巴、爪击和担心动作。

截图门：

```text
node scripts/qa/cuu-pet-browser-capture.mjs
```

默认输出到：

```text
docs/workhub/05-clients/assets/audit/2026-06-08-cuu-bongo-runtime/
```

P1b 动作增强输出到：

```text
docs/workhub/05-clients/assets/audit/2026-06-08-cuu-bongo-p1b-runtime/
  pet-bongo-p1b-idle-contact-sheet-grid.png
  pet-bongo-p1b-gallery-contact-sheet-grid.png
  pet-bongo-p1b-idle-diff-report.json
  pet-bongo-p1b-gallery-diff-report.json
```

真实 Tauri 门：

- 已用 `scripts/qa/cuu-tauri-motion-capture.ps1 -WaitSeconds 12 -FrameCount 24 -IntervalMs 180` 抓真实 `Cuu` 顶层窗口。
- 证据目录：`docs/workhub/05-clients/assets/audit/2026-06-08-cuu-bongo-p1c-first-paint/`。
- browser CDP 只能作为快速视觉检查，不能替代最终透明窗口录屏。
- motion capture 会先用 `first-frame-probe.png` 等到 `orange_pixels>=8000` 且 `visual_pixels>=12000`，通过后才开始写入 `frame-000.png`。

模型包门：

```text
pnpm --filter @workhub/cuu test
```

必须通过：

- `Cuu Bongo model pack is the approved low-uncanny default`
- `Cuu default model pack covers all business and idle actions`
- `Cuu PSD draft packs are blocked from becoming the default surface`

---

## 6. 后续施工

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| BONGO-P1a | 默认低恐怖谷 renderer | `cuu-bongo-runtime.ts` | 已落；浏览器截图和 DOM 证明默认不是 PSD |
| BONGO-P1b | 加强动作可读性 | 更明显的眨眼、挥手、抱文件、检索、庆祝、拖拽姿态 | **已落**：多帧截图中 wave/search/sync/revise/celebrate 可辨 |
| BONGO-P1c | 真实 Tauri 录屏 | Windows `PrintWindow` GIF/MP4/contact sheet | **已通过**：Rust 启动只预定位，pet surface 首屏后同步窗口模式；motion QA 首帧像素门槛通过，frame 000 不再空白 |
| BONGO-P1d-a | 设置和窗口能力契约 | scale / opacity / pass-through 偏好、DOM/CSS、TS bridge、Rust command、几何缩放 | **已落**：`set_pet_window_settings`、`pet_scale_percent` / `pet_opacity_percent` / `pet_pass_through`、scaled body/card placement 和静态 QA 均已可测 |
| BONGO-P1d-b | 设置体验与窗口手感 QA | hide-on-hover / keep-in-screen / 多屏恢复 / 设置页截图 | 对齐 BongoCat 的桌宠窗口体验；需要真实 Tauri 设置页、录屏和跨平台截图 |
| BONGO-P1e-a | 输入手感合同 | `cursor_near` interaction、立即 `look_at_mouse`、DOM pointer QA attrs | **已落单测**：靠近不再等几秒；`data-pet-cursor-near` / `hovered` / `dragging` 可被截图脚本读取 |
| BONGO-P1e-b | 输入手感真实 QA | cursor smoothing / look-at-mouse 参数 / hover 避让 / 拖拽录屏 | 吸收 BongoCat 的 `Ticker` 平滑思路，但只驱动 Cuu，不采集无关输入 |
| BONGO-P2 | 可替换模型机制 | Cuu model preset + custom model slot + `CuuModelPackManifest` loader | 可从默认 Bongo Cuu 切到未来 Live2D；任何 pack 都先跑 default gate |
| L2D-P2+ | 精修 PSD / Cubism | `cuu-live2d-v0.psd`、`.model3.json` | 只有美术 QA 通过后才允许替换 Bongo 默认 |

当前取舍：**P1 先让 Cuu 可爱、稳定、愿意常驻；P2/P3 再追求 Live2D 高表现力。**

### 6.1 P1d 详细施工路径

| 子任务 | TS/Rust 落点 | 验收 |
|---|---|---|
| 缩放 | `CuuPreferencePanel` 新增 75/100/125/150；`packages/cuu/src/controller.ts` 写入 `pet_scale_percent`；`pet-surface.ts` 输出 CSS 变量和缩放后的 body/card size；Rust `pet_window.rs` / `pet_commands.rs` 按 scale 计算窗口尺寸 | **P1d-a 已落单测**；下一步补 4 档真实 Tauri 截图，Cuu 不裁切，card mode 仍从 body anchor 向左上扩 |
| 透明度 | preference 写入 `pet_opacity_percent`；pet surface root 设置 `--wh-pet-opacity`；Rust command 返回 settings plan，暂不依赖平台窗口 opacity | **P1d-a 已落单测**；下一步截图对比 60/80/100，bubble 文本仍可读 |
| 点击穿透 | Rust command `set_pet_window_settings` 调用 Tauri `set_ignore_cursor_events(pass_through)`；TS bridge 校验 settings plan | **P1d-a 已落单测**；下一步实测桌宠不挡鼠标，并设计 hover/card 时临时关闭穿透的安全规则 |
| hover / cursor near | `sample_pet_cursor_near` + idle scheduler；P1e-a 已新增 `cursor_near` interaction，进入附近区域立即 `look_at_mouse`，surface 输出 `data-pet-cursor-near` / `data-pet-hovered` / `data-pet-dragging` | P1e-b 录屏能看到靠近反应，不是只变 cursor；后续再做平滑视线与 hover 避让 |
| 屏幕边界 | 已有 `clamp_position`，补多显示器/缩放 QA | 贴边不出屏，重启恢复位置 |

P1d-a 已落代码路径：

```text
packages/cuu/src/controller.ts
apps/desktop-webview/src/cuu-preferences.ts
apps/desktop-webview/src/pet-window-bridge.ts
apps/desktop-webview/src/pet-surface.ts
apps/desktop-webview/src/pet-surface-qa.ts
client-tauri/src-tauri/src/pet_window.rs
client-tauri/src-tauri/src/pet_commands.rs
client-tauri/src-tauri/src/main.rs
```

P1d-a 当前测试门：

```text
pnpm --filter @workhub/cuu test
pnpm --filter @workhub/desktop-webview test
pnpm --filter @workhub/cuu typecheck
pnpm --filter @workhub/desktop-webview typecheck
cargo test
```

### 6.2 P1e 输入手感施工路径

| 子任务 | TS/Rust 落点 | 验收 |
|---|---|---|
| cursor-near 立即反应 | `packages/cuu/src/idle-scheduler.ts` 新增 `CuuIdleInteraction="cursor_near"`，reason 为 `cursor_near_start`，动作映射 `look_at_mouse` | **P1e-a 已落单测**：首次进入附近区域立即转头看；睡着时仍先 `wake_up` |
| pointer state 可观测 | `apps/desktop-webview/src/pet-surface.ts` 接收 `DesktopPetPointerSnapshot`，输出 `data-pet-cursor-near`、`data-pet-hovered`、`data-pet-dragging` 和可选 `data-pet-last-pointer-ms` | **P1e-a 已落单测**：DOM 和 CSS contract 可被 browser CDP / Tauri capture 脚本读取 |
| Bongo model pack 手感状态 | `packages/cuu/src/model-pack.ts` 将 `scale` / `opacity` / `pass_through` 更新为 `supported`，保持默认门禁与真实窗口能力一致 | **P1e-a 已落单测**：`defaultCuuBongoModelPack` 不再把已实现窗口能力标成 planned |
| 真实录屏 | `scripts/qa/cuu-tauri-motion-capture.ps1` 后续增加 hover / near / drag scenario，并把 DOM pointer attrs 写入 report | P1e-b：录屏中必须能看出靠近、悬停、点击、拖拽分别触发 `look_at_mouse` / `wave_hello` / `tap_bubble` / `drag_hold` |

### 6.2 P2 模型包详细路径

`CuuModelPackManifest` 不是 UI 文档，而是后续资产加载器的源合同：

```text
Cuu model pack
  -> manifest.json
  -> renderer kind: bongo_cuu | sprite_atlas | live2d_cubism
  -> visual_gate
  -> motions map
  -> window_affordances
  -> assets
```

加载顺序：

1. 读取内置 `cuu-bongo-p1`，跑 `assertCuuModelPackCanBeDefault()`。
2. 如果用户选择自定义 pack，只能在设置页预览；未通过 default gate 只能标 `experimental`，不能设为默认。
3. Live2D Cubism pack 必须包含 `.model3.json` / `.moc3` / texture / physics / motions，并通过多秒桌宠录屏。
4. PSD draft 只能作为 source/probe，不得作为 renderer default。
5. 加载失败时回退 `cuu-bongo-p1`，再回退 sprite atlas；绝不回退到未验收 PSD。
