---
module: 05-clients
layer: C-PET / Cuu / Bongo-style runtime
status: p1-default-low-uncanny
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/audit/2026-06-08-cuu-bongo-runtime/pet-bongo-cuu-cdp-contact-sheet-grid.png
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
| 状态 | `p1_default_low_uncanny` |
| 组件数 | `24` 个 DOM/CSS 组件 |
| PSD 暴露 | `live2d=null`，`layers=[]`，默认 HTML 不含 `data-psd-layer` |
| 截图 | 全身可见，不是只露耳朵 / 局部 / 空白 |
| 动作 | 尾巴、头、眨眼、爪子、耳朵、文档卡状态由 CSS keyframes 驱动 |

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
| `drag_hold` | 后续补抓握/悬浮姿态；当前保持稳定形态 |
| `wave_hello` | 后续补单爪挥手 |

---

## 5. QA 门禁

默认 Cuu 必须先过这些低恐怖谷门：

- 全身可见，不允许只露耳朵、只露局部或被气泡裁切。
- 默认 HTML 不允许出现 `data-psd-layer`。
- DOM 必须出现 `data-cuu-bongo-runtime="bongo_cuu"`。
- 必须有 paws / eyes / tail 三类组件。
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

真实 Tauri 门：

- 后续必须用 `scripts/qa/cuu-tauri-motion-capture.ps1` 抓真实 `Cuu` 顶层窗口。
- browser CDP 只能作为快速视觉检查，不能替代最终透明窗口录屏。

---

## 6. 后续施工

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| BONGO-P1a | 默认低恐怖谷 renderer | `cuu-bongo-runtime.ts` | 已落；浏览器截图和 DOM 证明默认不是 PSD |
| BONGO-P1b | 加强动作可读性 | 更明显的眨眼、挥手、抱文件、检索、庆祝、拖拽姿态 | 多帧截图肉眼能分辨动作 |
| BONGO-P1c | 真实 Tauri 录屏 | Windows `PrintWindow` GIF/MP4/contact sheet | 右下角独立窗口全身可见、无裁切、动作流畅 |
| BONGO-P1d | 设置和窗口能力 | scale / opacity / pass-through / hide-on-hover / keep-in-screen | 对齐 BongoCat 的桌宠窗口体验 |
| BONGO-P2 | 可替换模型机制 | Cuu model preset + custom model slot | 可从默认 Bongo Cuu 切到未来 Live2D |
| L2D-P2+ | 精修 PSD / Cubism | `cuu-live2d-v0.psd`、`.model3.json` | 只有美术 QA 通过后才允许替换 Bongo 默认 |

当前取舍：**P1 先让 Cuu 可爱、稳定、愿意常驻；P2/P3 再追求 Live2D 高表现力。**
