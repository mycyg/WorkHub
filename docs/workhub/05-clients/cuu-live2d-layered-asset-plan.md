---
module: 05-clients
layer: C-PET / Cuu / Live2D
status: concept
owner: workflow
---

# Cuu Live2D 分层资产与建模施工方案

> **结论**：Cuu 的长期高表现力目标应优先走 **Live2D 分层 PSD -> Cubism 绑定 -> Tauri pet window runtime**。现有 sprite atlas 继续保留为 P1 可运行资产和降级层；GIF 只允许作为临时预览/沟通稿，不能作为最终桌宠方案。  
> **参考**：拆图方法参考 [Moonku 的 Live2D PSD 拆图教程](https://moonku44.com/live2d-psd/)，运行时边界参考 Live2D 官方 [Cubism SDK for Web](https://docs.live2d.com/en/cubism-sdk-manual/cubism-sdk-for-web/) 与 [model3.json Web 模型说明](https://docs.live2d.com/en/cubism-sdk-manual/model-web/)。

---

## 0. 概念图

![Cuu Live2D 分层拆件概念](./assets/cuu/cuu-live2d-layer-breakdown-concept.png)

这张图是 **Live2D 分层参考概念图**，不是最终运行时资产。它用于固定 Cuu 的正面基准、拆件方向和美术细节：橘色虎斑、奶油脸和爪、白蕾丝围兜、黑蝴蝶结、珍珠流苏、红色小珠、尾巴分段。后续正式 PSD 必须重新按图层规范输出，不能直接把概念图裁成模型。

---

## 1. 原则

1. **Live2D 是主目标**：Cuu 要像活的桌宠，不是 GIF 或状态图标。
2. **Sprite 是降级层**：当前 18 clip atlas 负责先跑通窗口、事件、QA；Live2D 就绪后替换主要表现层。
3. **GIF 只做无奈兜底**：只用于建模前的 motion storyboard、PR 预览或 Cubism runtime 暂时不可用时的演示，不进入最终验收。
4. **正面基准优先**：先做纯正面可绑定模型，再扩展 3/4 角度、侧身走动和复杂动作。
5. **拆件比整帧重要**：Live2D 的价值来自眼睛、耳朵、嘴、围兜、流苏、尾巴等部件可变形，而不是用一串帧硬切。
6. **遮挡处必须补画**：围兜后面的身体、前爪后面的胸毛、尾巴根部、蝴蝶结后面的蕾丝都要画完整，避免转头/摆动时露洞。
7. **运行时不承担美术修补**：Web/Tauri 只加载 `.model3.json`、`.moc3`、texture、motion、physics；坏图层不在代码里补救。

---

## 2. 从参考教程转成 Cuu 规则

Moonku 教程的核心经验可以转成 Cuu 的施工规则：

| 教程要点 | Cuu 落地 |
|---|---|
| 大画布、正面立绘 | `4096x4096` 或 `4096x5120` 透明/中性底正面小猫，脚底 anchor 固定 |
| 部件越细越自然 | 眼睛、眼皮、嘴型、耳朵、围兜、蝴蝶结、流苏、尾巴必须拆 |
| 遮挡处要补画 | 蕾丝、蝴蝶结、前爪、尾巴遮挡的身体都要补齐 |
| 图层命名清晰 | 使用英文稳定名，便于脚本、Cubism、TS manifest 对齐 |
| PSD 交付前检查 | 无同名图层、无隐藏废层、无杂点、图层模式 normal、透明度 100% |
| 配件单独拆 | 红珠、珍珠、流苏绳、蝴蝶结左右翼都拆出物理摆动层 |

---

## 3. 资产目录

```text
apps/desktop-webview/src/assets/cuu/
  live2d/
    source/
      cuu-live2d-v0.psd              # 正式 PSD 源文件，若体积过大后续迁 Git LFS
      cuu-live2d-v0-layer-preview.png
      cuu-live2d-v0-layer-manifest.json
    exported/
      cuu.model3.json
      cuu.moc3
      cuu.physics3.json
      cuu.pose3.json
      textures/
        texture_00.png
      motions/
        idle.motion3.json
        thinking.motion3.json
        approval.motion3.json
        search.motion3.json
        celebrate.motion3.json
      expressions/
        happy.exp3.json
        worried.exp3.json
        sleepy.exp3.json
docs/workhub/05-clients/assets/cuu/
  cuu-live2d-layer-breakdown-concept.png
```

文档目录只放概念图；运行时模型必须进入 `apps/desktop-webview/src/assets/cuu/live2d/exported/`，随 Tauri bundle 发布。

---

## 4. 图层树

命名采用 `Part_Side_Subpart_Index`，左右以 **Cuu 自己的左右** 为准。图层名必须稳定，禁止空格、中文、重复名。

### 4.1 Root

```text
CuuRoot
  00_Guide_DoNotExport
  10_Back
  20_Body
  30_Tail
  40_Head
  50_Face
  60_Collar
  70_Accessories
  80_Expressions
```

### 4.2 Body

| 图层 | 说明 | 必须补画 |
|---|---|---|
| `Body_BackFur` | 背部/臀部毛色底层 | 被尾巴遮住区域 |
| `Body_ChestCream` | 胸口奶油色毛 | 被围兜、前爪遮住区域 |
| `Body_BellyStripe` | 身体虎斑纹 | 被围兜遮住区域 |
| `Paw_L_FrontUpper` | 左前爪上段 | 爪根完整 |
| `Paw_L_FrontLower` | 左前爪下段/脚掌 | 脚趾完整 |
| `Paw_R_FrontUpper` | 右前爪上段 | 爪根完整 |
| `Paw_R_FrontLower` | 右前爪下段/脚掌 | 脚趾完整 |
| `Paw_L_Back` | 左后爪 | 被前爪遮住区域 |
| `Paw_R_Back` | 右后爪 | 被前爪遮住区域 |

### 4.3 Tail

| 图层 | 说明 | 绑定用途 |
|---|---|---|
| `Tail_Base` | 尾巴根部，接身体 | 跟随身体转动 |
| `Tail_01` | 第一段 | 摆动骨架 |
| `Tail_02` | 第二段 | 摆动骨架 |
| `Tail_03` | 第三段 | 摆动骨架 |
| `Tail_Tip` | 尾尖 | 物理回弹 |
| `Tail_ShadowOnBody` | 尾巴投影，可选 | 随尾巴透明度/角度调整 |

### 4.4 Head / Ears

| 图层 | 说明 |
|---|---|
| `Head_BackFur` | 后脑完整毛团 |
| `Head_FaceBase` | 脸和头型底色 |
| `Head_CreamMuzzle` | 奶油嘴套 |
| `Head_Stripes` | 额头与脸颊虎斑 |
| `FurTuft_Front_01` | 前额毛束左 |
| `FurTuft_Front_02` | 前额毛束中 |
| `FurTuft_Front_03` | 前额毛束右 |
| `Ear_L_Outer` / `Ear_R_Outer` | 外耳 |
| `Ear_L_Inner` / `Ear_R_Inner` | 内耳粉色 |
| `Ear_L_Fur` / `Ear_R_Fur` | 耳内毛 |

### 4.5 Eyes

每只眼至少拆这些层：

```text
Eye_L_White
Eye_L_Iris
Eye_L_Pupil
Eye_L_Highlight_01
Eye_L_Highlight_02
Eye_L_UpperLid
Eye_L_LowerLid
Eye_L_UpperLine
Eye_L_LowerLine
Eye_L_Shadow
Eye_L_Closed
```

右眼同理。眼睛反光不能简单镜像，左右高光要保持自然。

### 4.6 Mouth

| 图层 | 说明 |
|---|---|
| `Mouth_Line_Closed` | 闭嘴线 |
| `Mouth_UpperLip` | 上唇/鼻下线 |
| `Mouth_LowerLip` | 下唇 |
| `Mouth_Inside` | 口腔内 |
| `Mouth_Tongue` | 舌头 |
| `Mouth_Tooth_Upper` | 上牙，可选 |
| `Mouth_Tooth_Lower` | 下牙，可选 |
| `Mouth_MaskSkin` | 嘴型遮盖皮肤 |

嘴型目标：闭嘴、微笑、惊讶、小声说话、吐舌、委屈。

### 4.7 Collar / Bow / Tassels

| 图层 | 说明 | 动效 |
|---|---|---|
| `LaceBib_Back` | 围兜后层 | 身体转动时保持遮挡 |
| `LaceBib_Front` | 围兜主体 | 轻微摆动 |
| `LaceBib_Edge_L` / `LaceBib_Edge_R` | 左右蕾丝边 | 细微物理 |
| `Bow_Center` | 蝴蝶结中心 | 稳定锚点 |
| `Bow_L_Wing` / `Bow_R_Wing` | 左右翼 | 轻摆 |
| `Tassel_L_String_01..03` | 左流苏绳 | 物理链 |
| `Tassel_R_String_01..03` | 右流苏绳 | 物理链 |
| `Pearl_L_01..03` / `Pearl_R_01..03` | 珍珠 | 跟随绳摆动 |
| `RedBead_L_01..02` / `RedBead_R_01..02` | 红珠 | 跟随绳摆动 |

---

## 5. GPT Image 生成策略

### 5.1 两条并行线

| 线 | 目标 | 产物 |
|---|---|---|
| `model-sheet` | 锁定完整正面 Cuu | `cuu-live2d-v0-front.png` |
| `layer-parts` | 生成可分层/补画部件参考 | `layer-preview.png` + 分件 PNG |

不能直接要求模型“一次输出 PSD”。正确路线是：先让生成图固定角色和拆件参考，再用人工/脚本/编辑器装配 PSD。

### 5.2 正面模型 prompt

```text
Use case: stylized-concept
Asset type: Live2D front model source art
Primary request: Cuu, an original orange cartoon kitten desktop pet, pure front-facing full body pose for Live2D rigging.
Subject: orange tabby kitten, cream muzzle and paws, big curious eyes, white lace bib collar, black bow tie, pearl tassels with tiny red beads.
Style/medium: polished 2D game character model, crisp line art, soft shading, detailed but clean fur.
Composition/framing: full body centered, symmetrical neutral pose, paws aligned to one baseline, tail visible and separated from body, large canvas, generous padding.
Constraints: no cropped ears or tail, no extra animals, no text, no watermark, no background detail, no cast shadow.
```

### 5.3 分层参考 prompt

```text
Use case: stylized-concept
Asset type: Live2D layer breakdown reference
Primary request: Show Cuu as a front-facing full character with separated Live2D parts around it: ears, eyes, eyelids, mouth shapes, lace bib, bow tie, pearl tassels, front paws, torso, tail segments.
Style/medium: clean model sheet for 2D rigging, readable cut parts, soft shading, crisp outlines.
Constraints: separated parts must match the main Cuu design, no final production labels required, no watermark, no extra characters.
```

### 5.4 透明/抠图策略

优先级：

1. 生成中性背景模型板，用作人工拆件参考。
2. 生成单个部件时，使用纯色 chroma-key 背景，本地抠图。
3. 如果毛边、蕾丝或流苏复杂到 chroma-key 质量不足，再转人工精修或原生透明生成链路。

蕾丝和毛发是高风险区域，不能只靠自动抠图通过验收。

---

## 6. PSD 装配流程

### 6.1 工具

| 工具 | 用途 |
|---|---|
| Photoshop / CLIP STUDIO PAINT | 正式 PSD 装配与人工精修 |
| Krita / Photopea | 可选开源/在线检查 |
| Python + Pillow | 抠图、边缘检查、alpha bbox、manifest 生成 |
| Live2D Cubism Editor | 导入 PSD、建模、物理、导出 `.moc3` / `.model3.json` |

### 6.2 步骤

1. 生成 `front model` 和 `layer breakdown`。
2. 在绘图工具中重绘或清理 Cuu 正面稿。
3. 按第 4 节图层树拆件。
4. 对所有遮挡处补画。
5. 合并每个部件的线稿、底色、阴影、高光为可导入图层。
6. 保持图层模式 `normal`、透明度 `100%`。
7. 删除隐藏废层、测试草图、参考图层。
8. 导出 `cuu-live2d-v0.psd`。
9. 在 Cubism Editor 导入 PSD，确认部件无错位、无同名、无杂点。
10. 绑定参数、物理、表情和动作。
11. 导出 `cuu.model3.json` 套件。

### 6.3 PSD 交付检查

| 检查 | 通过标准 |
|---|---|
| 图层名 | 全部唯一，英文稳定名，无空格 |
| 背景 | 无背景层或背景层放在 `00_Guide_DoNotExport` 并导出前删除 |
| 隐藏层 | 不需要的隐藏层全部删除 |
| 图层模式 | normal |
| 图层透明度 | 100% |
| 遮罩/效果 | 已 rasterize，避免导入丢失 |
| 杂点 | alpha 边界外无孤立像素 |
| 遮挡补画 | 转头/摆尾/围兜摆动不会露洞 |
| 画布 | 脚底 anchor 固定，角色居中 |

---

## 7. Cubism 建模参数

### 7.1 基础参数

| 参数 | 用途 | Cuu 目标 |
|---|---|---|
| `ParamAngleX` | 左右转头 | 小幅看向气泡/鼠标 |
| `ParamAngleY` | 抬头低头 | 低头看文件、抬头看用户 |
| `ParamAngleZ` | 头部倾斜 | 卖萌、疑惑 |
| `ParamBodyAngleX` | 身体左右 | 配合头部，但幅度小 |
| `ParamBodyAngleY` | 身体上下 | 呼吸/打盹 |
| `ParamEyeLOpen` / `ParamEyeROpen` | 睁闭眼 | 眨眼、睡觉 |
| `ParamEyeBallX` / `ParamEyeBallY` | 眼球 | 看鼠标、看气泡 |
| `ParamMouthOpenY` | 张嘴 | 说话/喵一下 |
| `ParamMouthForm` | 嘴形 | 微笑、担心、惊讶 |

### 7.2 Cuu 专属参数

| 参数 | 用途 |
|---|---|
| `ParamEarLWiggle` / `ParamEarRWiggle` | 耳朵轻动、担心时压耳 |
| `ParamTailSway` | 尾巴自然摆动 |
| `ParamTailCurl` | 睡觉卷尾 |
| `ParamBibSway` | 蕾丝围兜随身体动 |
| `ParamBowBounce` | 蝴蝶结轻弹 |
| `ParamTasselSwingL` / `ParamTasselSwingR` | 珍珠流苏物理摆动 |
| `ParamPawTap` | 轻敲气泡 |
| `ParamPawHoldDoc` | 叼/抱文件时前爪姿态 |

### 7.3 物理

必须启用：

- 耳朵回弹。
- 尾巴摆动。
- 围兜和蕾丝边轻摆。
- 蝴蝶结左右翼轻摆。
- 流苏绳、珍珠、红珠链式摆动。

不能过度：

- Cuu 是工作桌宠，不是舞台角色；物理要轻，不要一直晃。
- idle 时 CPU/GPU 占用必须低。

---

## 8. Motion 与 WorkHub 事件映射

| WorkHub / Cuu state | Live2D motion | 表情 | 循环 |
|---|---|---|---|
| idle | `idle.motion3.json` | normal | yes |
| idle_blink | eye blink auto | normal | no |
| look_at_mouse | parameter tween | curious | no |
| sleeping_curl | `sleep.motion3.json` | sleepy | yes |
| wake_up | `wake.motion3.json` | normal | no |
| thinking_tail | `thinking.motion3.json` | focused | yes |
| asking_approval_bounce | `approval.motion3.json` | asking | yes |
| searching_evidence_peek | `search.motion3.json` | curious | yes |
| carrying_document_step | `carry_doc.motion3.json` | proud | yes |
| syncing_files_spin | `sync.motion3.json` | focused | yes |
| worried_ears | `worried.motion3.json` | worried | yes |
| revision_requested_nod | `revision.motion3.json` | sorry | no |
| celebrating_jump | `celebrate.motion3.json` | happy | no |
| offline_sleep | `offline.motion3.json` | sleepy_gray | yes |

运行时仍由 `packages/cuu` 的 controller 决定打扰策略；Live2D 只负责视觉表现。

---

## 9. Web / Tauri Runtime 接入

### 9.1 TS 模块

目标文件：

```text
packages/cuu/src/live2d-manifest.ts
apps/desktop-webview/src/cuu-live2d-assets.ts
apps/desktop-webview/src/cuu-live2d-runtime.ts
apps/desktop-webview/src/pet-surface.ts
```

计划类型：

```ts
export type CuuLive2DManifest = {
  version: 1;
  model: {
    model3_json: string;
    moc3: string;
    textures: string[];
    physics3_json?: string;
    pose3_json?: string;
  };
  motions: Record<string, { file: string; loop: boolean; priority: "idle" | "normal" | "urgent" }>;
  expressions: Record<string, { file: string }>;
  fallback_sprite_clip: Record<string, string>;
};
```

### 9.2 Runtime 策略

1. `pet-surface` 启动时优先检测 Live2D manifest。
2. Live2D 资源加载成功：使用 Live2D renderer。
3. Live2D 加载失败：自动降级到当前 atlas renderer。
4. reduced-motion：不播放复杂 motion，只做 blink/微参数或直接降到静态 reduced frame。
5. `sse-status:retrying/closed`：Live2D 可切 `offline` 表情；如果 runtime 失败，sprite 显示离线。

### 9.3 许可与依赖风险

Live2D 官方文档说明 Web SDK 需要 Cubism SDK / Cubism Core 组件；Cubism Core 不在 GitHub 源码中公开，需要从官方 SDK 获取。施工时必须确认：

- SDK / Cubism Core 许可是否允许当前 WorkHub 分发方式。
- Tauri bundle 内是否可以携带 wasm/js runtime。
- Web / macOS / Windows / Linux 打包路径是否一致。
- 如果许可或包体阻碍 P1 发布，则 sprite atlas 保持默认，Live2D 留在 P2/P3。

---

## 10. GIF 兜底规则

GIF 不是目标，只能在这些场景使用：

- 给非技术协作者预览一个 motion storyboard。
- PR / 文档里展示 “大概会怎么动”。
- Live2D runtime 还没接好，但需要临时验收 Cuu 节奏。

GIF 不允许：

- 作为 Tauri pet window 的最终 renderer。
- 替代图层拆分、参数绑定和物理。
- 绕过透明边缘、点击区域、HiDPI、性能 QA。

若必须生成 GIF，来源也必须是同一套 Cuu 角色资产，不能另画一只风格漂移的小猫。

---

## 11. 施工切片

| 阶段 | 目标 | 产物 | 验收 |
|---|---|---|---|
| L2D-P0 | 分层规范与概念图 | 本文 + `cuu-live2d-layer-breakdown-concept.png` | 角色和拆件方向明确 |
| L2D-P1 | 正面基准稿 | `cuu-live2d-v0-front.png` | Cuu 外观与概念图一致 |
| L2D-P2 | 分层 PSD | `cuu-live2d-v0.psd` + layer manifest | Cubism 可导入，无同名/杂点/丢层 |
| L2D-P3 | Cubism 绑定 | `.cmo3` 源 + exported `.model3.json` 套件 | 呼吸、眨眼、看鼠标、耳朵、尾巴、流苏可动 |
| L2D-P4 | Tauri runtime | `cuu-live2d-runtime.ts` | `pet` window 优先加载 Live2D，失败降级 sprite |
| L2D-P5 | 事件动作 | motion / expression map | approval/search/carry/worried/celebrate 可由事件触发 |
| L2D-QA | 透明窗口验收 | 截图、像素、性能、HiDPI、多屏报告 | 无绿边/黑底/离屏/高占用 |

---

## 12. 验收门

### 12.1 美术

- 正面 Cuu 与概念图一致，不漂成另一只猫。
- 蕾丝围兜、蝴蝶结、珍珠流苏、红珠都可识别。
- 拆件后的单个部件边缘干净，无绿边、白边、锯齿和孤立像素。
- 遮挡处补画完整。
- 图层结构可读，命名稳定。

### 12.2 建模

- 呼吸、眨眼、看鼠标、耳朵轻动、尾巴摆动、流苏摆动全部可触发。
- `asking_approval` 能有明显但不吵的提醒动作。
- `worried` 能压耳/低头，不靠文字表达。
- `celebrating` 播一次后自然回 idle。
- `offline` 能低存在感休眠。

### 12.3 工程

- `pet` window 使用透明背景，主窗隐藏后仍显示。
- Live2D 加载失败自动降级 sprite atlas。
- reduced-motion 有静态/低动效路径。
- 资源随 Tauri bundle 打包。
- 不把 PSD/Cubism 源误放到 `reference` / `references`。

---

## 13. 与现有文档关系

| 文档 | 关系 |
|---|---|
| [`cuu-desktop-pet-concept.md`](./cuu-desktop-pet-concept.md) | 角色、交互、事件状态总纲 |
| [`cuu-green-screen-desktop-pet-solution.md`](./cuu-green-screen-desktop-pet-solution.md) | sprite / 绿幕 P1 可运行资产与降级层 |
| [`desktop-pet-tauri.md`](./desktop-pet-tauri.md) | Tauri pet window、SSE、tray、deep-link、通知等端能力 |
| [`prd-concept-reproduction-gap-audit.md`](./prd-concept-reproduction-gap-audit.md) | 当前实现与最终概念差距 |

本篇只负责 **Live2D 分层资产、建模、运行时接入计划**。业务卡片、审批、知识检索、交付物变更包仍由 Page VM / Cuu card / event contract 决定。
