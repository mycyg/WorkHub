---
module: 05-clients
layer: C-PET
status: concept
owner: workflow
---

# Cuu 桌宠形象与交互概念

> **Cuu** 是 WorkHub 桌宠客户端的默认形象：一只会动、会提醒、会陪用户处理工作的橘色卡通小猫。它不是冷冰冰的状态图标，而是 WorkHub AI-native 体验的常驻入口。
>
> **当前默认视觉路线**：见 [`cuu-bongo-style-runtime-plan.md`](./cuu-bongo-style-runtime-plan.md)。用户已明确反馈当前 PSD draft 有恐怖谷风险，因此 Cuu P1 默认改为参考 [BongoCat](https://github.com/ayangweb/BongoCat) 思路的低恐怖谷扁平小猫 renderer；当前默认模型包是 `cuu-bongo-p1`，由 `CuuModelPackManifest` 标记为 `approved_default`。PSD / Live2D 只保留为实验线，只有过美术 QA、真实桌宠录屏和 model pack 默认门禁后才能回到默认。
> **绿幕素材与独立窗口施工方案**：见 [`cuu-green-screen-desktop-pet-solution.md`](./cuu-green-screen-desktop-pet-solution.md)。该方案把 Cuu 明确为独立 Tauri `pet` 透明窗口，并规定 GPT Image 绿幕多帧素材、抠图裁切、sprite atlas、idle scheduler 与 QA 门禁。
> **Live2D 高表现力路线**：见 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md)。Cuu 的长期目标优先是 Live2D 分层 PSD + Cubism 绑定；GIF 只允许做临时预览，不能作为最终桌宠方案。
> **当前真实动作审计**：见 [`current-state-visual-audit-and-construction-plan-2026-06-07.md`](./current-state-visual-audit-and-construction-plan-2026-06-07.md)。2026-06-07 已对真实 Tauri `Cuu` 顶层窗口做 32 帧 `PrintWindow` 抓取并输出 GIF/MP4；首轮发现事件卡片被 body-only 小窗裁切，第一轮 card layout 又暴露“只露耳朵 / 局部”的失败样例，随后发现“只有静态 fallback 呼吸/缩放”也不合格。最终已补 card mode bridge 校验、compact fallback、full-body HiDPI 站位、离线人话卡、dev sprite asset 路径、运行态禁用静态 fallback 与 motion capture 脚本；最新抓帧中 body-only 第一屏可见摇尾动作，card mode 中 Cuu 全身可见。但 8 层裁片 Live2D prototype 仍因肉眼差异不足、非 PSD 分层、非 Cubism 绑定而不能算通过。2026-06-08 已补 `psd_draft_probe` 证明分层技术链路可行，但因视觉有恐怖谷风险，默认又切回 `bongo_cuu` 低恐怖谷 renderer；随后已补 Bongo P1b 动作增强、真实 Tauri GIF/MP4、P1c first-painted 首帧门禁、BONGO-REF model pack 默认门禁、P1d-b-a hide-on-hover 软隐藏 / 恢复真实录屏、P1e-b hover/tap/drag 真实录屏、P1e-c 连续看鼠标 / hover 避让真实录屏、P1e-d-a pointer smoothing / drag grip 真实录屏和 P1e-d-b 60s idle jitter / flicker 长驻 QA。下一步主线是 Bongo 动作二轮、窗口设置真实截图、多屏恢复、长驻性能采样、model pack loader 和 Live2D 精修并行。

## 1. 角色定位

Cuu 的职责是把「AI 在后台工作」变成用户能感知、能信任、愿意点击的桌面陪伴。

- **默认状态**：在桌面边缘活动、待命、睡觉或轻微呼吸，不打扰用户。
- **轻提醒**：有审批、澄清、交付、检索结果时，用动作和气泡提醒用户。
- **重要动作**：展开成清楚的审批卡、证据卡、澄清选项卡，用户一眼能判断。
- **复杂信息**：不直接铺满屏幕，先用一句话摘要和少量可点选项承接。

## 2. 视觉特征

参考用户提供的猫咪照片，Cuu 采用原创卡通化处理，保留如下识别点：

- 橘色虎斑毛色，脸部和爪子偏奶油色。
- 大而圆的好奇眼神，表情要明显、亲近。
- 白色蕾丝围兜，黑色蝴蝶结。
- 珍珠流苏与红色小珠点缀。
- WorkHub 状态色只作为小面积点缀：靛蓝、珊瑚、绿色。

不要提交参考原图到公开仓库；当前仓库只沉淀原创概念图。

## 3. 概念图

### 3.1 角色动效状态表

![Cuu 角色动效状态表](./assets/cuu/cuu-character-animation-states.png)

这张图定义 Cuu 的基础动作状态：

- idle：空闲呼吸，表示「我在」。
- walking：在桌面边缘走动，用于轻量存在感。
- sleeping：长时间无事时休眠。
- thinking：AI 正在整理/推理。
- asking approval：需要用户确认。
- carrying document：带着交付物或变更包来找用户。
- searching evidence：项目检索/知识库查证。
- syncing files：本地文件或项目网盘同步中。
- worried：低置信度或风险较高。
- revision requested：用户打回后继续修改。
- celebrating：审批通过或任务完成。
- offline：离线/重连中。

### 3.2 桌面审批与项目检索

![Cuu 桌面审批与项目检索](./assets/cuu/cuu-desktop-approval-search.png)

这张图定义 Cuu 的默认工作方式：

- Cuu 常驻桌面，不强制打开完整主窗。
- 审批事项以气泡提醒，用户点击后展开为透明 Tauri 卡片。
- 变更申请不是代码 PR，而是任意交付物的变更包，包含文档、表格、PPT、图片和文件夹。
- 项目检索属于桌宠能力，用建议 chips 发起，例如「找相关文件」「总结上次会议」「这次改了什么」。

### 3.3 选项优先澄清

![Cuu 选项优先澄清](./assets/cuu/cuu-option-first-clarify.png)

澄清不应默认让用户打字。Cuu 应该一次只问一个问题，并给出可点击选项。

- 主交互是选项卡，而不是大文本框。
- 推荐项可以突出显示。
- 「其他 / 补充」折叠在底部，只作为兜底。
- 右侧显示已经澄清的内容，帮助用户知道还剩几步。

### 3.4 Live2D 分层拆件

![Cuu Live2D 分层拆件概念](./assets/cuu/cuu-live2d-layer-breakdown-concept.png)

这张概念图固定 Live2D 方向：Cuu 需要从完整正面角色拆成可绑定部件，而不是把 GIF 当成最终动画。正式 PSD 要拆出耳朵、眼睛、眼皮、嘴型、头发/毛束、身体、爪子、围兜、蝴蝶结、珍珠流苏、尾巴分段，并补画所有遮挡区域。分层命名、Cubism 参数、运行时接入和 QA 门禁见 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md)。

### 3.5 Live2D 正面基准稿与 PSD 生产板

![Cuu Live2D 正面基准稿](./assets/cuu/cuu-live2d-front-model-concept.png)

![Cuu Live2D PSD 生产板](./assets/cuu/cuu-live2d-psd-production-board.png)

第一张图用于锁定 Cuu 的正面比例、脚底 anchor 和角色识别点；第二张图用于指导后续正式 PSD 拆层：中心是正面 Cuu，周围拆出耳朵、眼皮、眼睛、嘴型、爪子、围兜、蝴蝶结、珍珠流苏、身体块和尾巴段。它们不是运行时资产，但已经同步到文档目录，并由 `apps/desktop-webview/src/assets/cuu/live2d/source/cuu-live2d-v0-layer-manifest.json` 固定成可审计的图层合同。

### 3.5.1 Live2D 绿幕零件板与 PSD 草案

![Cuu Live2D 脸部零件编号表](./assets/cuu/cuu-live2d-generated-face-parts-v0-components.png)

![Cuu Live2D 身体零件编号表](./assets/cuu/cuu-live2d-generated-body-parts-v0-components.png)

![Cuu Live2D 饰品零件编号表](./assets/cuu/cuu-live2d-generated-accessory-parts-v0-components.png)

![Cuu Live2D generated PSD draft v1 preview](./assets/cuu/cuu-live2d-generated-psd-draft-v1-preview.png)

这组图是当前最接近施工资产的参考：绿幕零件板已经被脚本自动抠图、编号和裁切，`generated-psd-draft-v1` 已拼成 9 个顶层组、144 个叶子图层、144 个 layer PNG 的 PSD 草案。它回答了“不同分层素材能否通过生图批量生成并调整大小拼接”：可以，且已经落成可重复生成脚本。

![Cuu PSD draft runtime probe 多帧截图](./assets/audit/2026-06-08-cuu-psd-draft-probe/pet-psd-draft-cdp-contact-sheet-grid.png)

这张多帧图是 PSD draft 的运行探针：它曾让 `pet.html` / pet surface 挂载 `generated-psd-draft-v1` 中选出的 72 个 layer PNG，而不是 8 层 prototype 或静态 fallback。DOM 里能审计 `Eye_L_Closed`、`Tail_01`、`Tassel_L_01` 等真实 PSD layer；CSS 中眼睛、尾巴、耳朵、嘴型、蝴蝶结、流苏和爪子分别动。它证明“批量生成部件 -> 调整大小拼接 -> 分层运行”这条技术路线可行，但仍不是最终 Cubism 通过。

但这仍不是最终桌宠通过证据，也不再是默认视觉。最终 Live2D 通过必须满足：PSD 在 Cubism 中可导入；眼睛/眼皮/嘴型/耳朵/尾巴/蝴蝶结/流苏有连续参数和物理；桌面右下角独立 `pet` 窗口录屏中能看到眨眼、呼吸、看鼠标、尾巴、任务动作，而不是静态图或缩放变化。

### 3.5.2 Bongo-style 低恐怖谷默认 Cuu

![Cuu Bongo-style runtime contact sheet](./assets/audit/2026-06-08-cuu-bongo-runtime/pet-bongo-cuu-cdp-contact-sheet-grid.png)

这张图是 2026-06-08 新的默认 Cuu：参考 BongoCat 的低拟真、圆润、少状态强反馈思路，用 DOM/CSS 组件画出橘色小猫、围兜、黑蝴蝶结、红珠、桌面和文档。默认 pet surface 现在是 `data-cuu-visual-mode="bongo_cuu"`、`data-cuu-model-pack="cuu-bongo-p1"`、`data-cuu-live2d-status="experiment_hidden"`，DOM 中不再出现 `data-psd-layer`。P1b 已补挥手、抱文件、审批打回、检索、同步、庆祝和拖拽动作，P1c 已补 first-painted 首帧门禁，P1d-b-a 已补 hide-on-hover soft dodge；BONGO-REF 已让 PSD draft 默认候选在测试里失败。后续继续增强动作幅度、窗口体验和模型包加载器。

![Cuu Bongo / Live2D v2 low-uncanny style board](./assets/cuu/cuu-bongo-low-uncanny-v2-style-board.png)

这张图是后续 Cuu v2 的低恐怖谷风格基准。它保留参考猫的橘色虎斑、奶油脸和爪、白围兜、黑蝴蝶结、红珠，但把眼睛、毛发、爪子和尾巴都压成可绑定、可复用、低细节的 mascot 形状。它用于指导 Bongo 动作二轮和 Live2D Cubism v2 重绘，不代表最终 PSD 已通过。

![Cuu Bongo P1e look and avoidance real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1e-look-avoidance/cuu-motion-contact-sheet.png)

P1e-c 后，Cuu 不只是“靠近时切到看鼠标状态”：Rust 会返回 `look_x_percent/look_y_percent`，webview 统一成 `look_x/look_y/hover_avoidance`，Bongo renderer 用这些值驱动头、眼、鼻口、胡须方向和 hover 轻避让。未来 Live2D / Cubism 版本必须复用同一输入合同映射到 `ParamAngleX/Y`、`ParamEyeBallX/Y` 和物理链，而不是重新发明鼠标协议。

![Cuu Bongo P1e-d drag smoothing real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1e-d-drag-smoothing/cuu-motion-contact-sheet.png)

P1e-d-a 后，Cuu 的输入不再直接把 Rust cursor sample 硬切到新方向，而是参考 BongoCat 的阻尼思路，用 `desktopPetPointerSmoothingAlpha=0.58` 做低通平滑。hover / drag 期间本地 DOM pose 优先，拖拽时 Cuu 保持 `drag_hold` 抓握姿态直到 release。这个阶段仍是低恐怖谷 Bongo CSS pose，不是最终 Live2D；但它把“卡顿、像死图、拖拽动作被抢走”的问题往正确方向推进了一步。

![Cuu Bongo P1d-b hide-on-hover real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1d-b-hide-on-hover/cuu-motion-contact-sheet.png)

P1d-b-a 后，Cuu 支持可恢复的“悬停避让”：hover 时 soft hide，cursor 离开后恢复，再次 hover 再隐藏。它刻意不是全透明 pass-through，避免用户丢失桌宠；后续若要升级到 BongoCat 式完全隐藏，必须先设计托盘、快捷键、边缘热区和自动恢复。

![Cuu Bongo P1e-d-b 60s idle jitter real Tauri motion](./assets/audit/2026-06-08-cuu-bongo-p1e-60s-idle-jitter/cuu-motion-contact-sheet.png)

P1e-d-b 后，Cuu 有了真实 Tauri 长驻可见性门：31 帧约 60 秒内没有空白、只露耳朵、低可见帧或窗口漂移，`long_run.passed=true`。这证明它能稳定待在桌面右下角，但动作幅度仍偏克制，后续还要继续增强抱文件、庆祝、审批敲桌等演出。

### 3.6 当前实现差距

![Cuu runtime gap roadmap](./assets/cuu/cuu-runtime-gap-roadmap.png)

当前 WorkHub 仓库里，Cuu 已经有这些地基：

- `packages/cuu/src/cards.ts`：把 session、workitem、proposal、agent live、event 转成 `CuuCard`。
- `packages/cuu/src/motion.ts`：为每个 `CuuState` 提供 `sprite_state`、`emphasis`、`loop` 和 reduced-motion 文案。
- `packages/cuu/src/controller.ts`：提供纯 TS 的 show / replace / queue / badge / drop 决策，覆盖静音、勿扰、低优先级降级和 reduced-motion。
- `apps/desktop-webview/src/desktop-cuu-runtime.ts`：把 Tauri/mock 的 `push-event` 与 `sse-status` 转成 Cuu notice。
- `apps/desktop-webview/src/cuu-preferences.ts`：提供 Cuu 轻入口与偏好面板，面板默认隐藏，本地存储提醒模式、声音、减少动效和队列上限，并写回 `CuuController`。
- `apps/desktop-webview/src/browser.ts`：支持 `cuuDemo=1` / `cuuDemo=offline` 的 scripted event 预览；Cuu action 可把知识检索结果回显成 evidence card，并把 evidence card 的 `evidence_refs` 通过 POST action 带回当前任务。

但这些还不等于「桌宠已经完成」：

- 已有 18 clip 真实小猫绿幕 motion pack，业务状态与 idle / interaction 微动作均已覆盖；已有 Live2D 分层拆件概念图和施工专篇；但还没有正式分层 PSD、Cubism `.moc3` / `.model3.json` 或 Tauri Live2D runtime。
- 当前默认 pet surface 已切到 `bongo_cuu`：扁平、稳定、低恐怖谷，DOM/CSS 组件数 `31`，保留 Cuu 的围兜、蝴蝶结、红珠和尾巴识别点，并有 search-glass / sync-ring / spark 等业务道具层。
- `packages/cuu/src/model-pack.ts` 已把 `cuu-bongo-p1` 设为当前唯一 `approved_default`，并要求默认包低恐怖谷、非 PSD draft、全身可见、角色稳定、无 AI 肢体幻觉、有活体动作、覆盖全部业务动作和 idle 微动作。
- `psd_draft_probe` 从 144 层 PSD draft 中选出 72 个运行层渲染，能证明眼睛、尾巴、耳朵、流苏等层被真实挂载；但它仍是 `draft_created_not_visual_pass`，因恐怖谷风险只保留为实验线，不能替代精修 PSD / Cubism。
- `CuuController`、desktop-webview badge / 队列推进、偏好面板已有 MVP，仍缺真实 Tauri 设置页承接、拖拽位置偏好和长期 idle 行为。
- 已有真实 Tauri `pet` 透明窗口 runtime 的初版：`pet` window 在 Tauri config 中为 `create:false`，由 Rust setup 动态创建并注入 `window.__WORKHUB_SURFACE__="pet"`；启动期会恢复/夹取 body anchor、预定位 body-only Cuu，并由 pet surface 首屏后调用 `set_pet_window_mode` 显示；mode 切换时从小猫锚点展开卡片；HiDPI physical→logical 坐标换算和运行期 `always-on-top` 已接。2026-06-07 Windows debug smoke 已确认独立 `Cuu` window visible/topmost、右下角显示 Cuu 与气泡，并在主窗隐藏后仍可见；同日 card mode motion capture 已确认事件卡触发后窗口可从 `194 x 228` 扩到 `394 x 568`，最终 fresh 抓帧中 Cuu 完整身体可见、轻卡右侧有 HiDPI 留白；2026-06-08 P1c contact sheet 的 frame 000 已是 body-only Cuu 全身可见，不再依赖 inline 静态 fallback、缩放呼吸或 blank 首帧；仍缺多屏恢复、安装包 smoke、跨平台透明 capture 和长期运行性能 QA。
- 拖拽/hover 的 webview bridge 已落，并已接真实 Tauri `startDragging`、mode resize/position/show、cursor-near 采样和 body anchor 位置落盘；bridge 现在会校验 Rust placement，缺失 invoke 或 placement 时显式进入 diagnostic/compact fallback，不再静默裁切；仍缺收起、真实独立设置页、多屏实测恢复和低电量降帧。
- 证据卡已能触发 typed `knowledge-search` 并回显结果；「用这些证据继续」已通过 `POST /api/workitems/{id}/evidence-bindings` 绑定到当前任务上下文。仍缺真实知识库持久化、证据详情展开和完整检索页分页。
- 已有 Windows debug `PrintWindow` 自动 smoke 和多帧 motion capture，可对透明/layered WebView2 的 `Cuu` 顶层窗口做可见像素、尺寸变化和帧差检查；还没有自动化 alpha 边缘、真实帧率、HiDPI、多屏和点击区域 QA。

因此后续验收不能只看 Cuu 卡片是否生成，必须看 Cuu 是否真实可见、会动、可点、不挡事，并能在主窗隐藏后继续承接提醒。

### 3.6.1 当前真实动作审计（2026-06-07）

![Cuu motion contact sheet](./assets/audit/2026-06-07-cuu-motion/cuu-motion-contact-sheet.png)

本轮多帧捕获资产：

- GIF：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/cuu-motion-printwindow.gif`
- MP4：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/cuu-motion-printwindow.mp4`
- 原始帧：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/frames/frame-000.png` 到 `frame-031.png`
- 像素报告：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-motion/motion-diff-report.json`

审计结论：

- Cuu body-only 独立窗口可见，前半段有轻微呼吸/缩放/轮廓变化。
- 动作表现仍偏弱，离“QQ 宠物式活体入口”还有差距。
- `CUX-MOTION-001`：第 20 帧附近出现离线卡片，窗口仍为 `194 x 228` body-only 尺寸，卡片和 Cuu 被裁切；说明 `set_pet_window_mode("card")` 或前端 bridge fallback 需要 P0 修复。
- 单张 smoke 截图只能证明启动可见，不能证明长时间运行、事件触发和卡片展开正确；后续 Cuu 验收必须包含多帧截图、GIF/MP4 和 diff report。

这组现在保留为**历史不足证据**：它只能证明窗口有像素和轻微变化，不能证明动作资源真实加载，也不能证明 Cuu 已经“活着”。

### 3.6.2 Card mode 修复后审计（2026-06-07）

第一轮修复后失败证据：

![Cuu card mode 第一轮修复后失败证据](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png)

最终 HiDPI 修复后证据：

![Cuu card mode HiDPI 完整身体修复后动作抓取](./assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png)

修复后证据：

- GIF：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-printwindow-after-card-layout.gif`
- Contact sheet：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-card-layout.png`
- 关键帧：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/frame-012-card-mode.png`
- 像素报告：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/motion-diff-report-after-card-layout.json`
- 最终 GIF：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-printwindow-after-full-body-hidpi-fix.gif`
- 最终 Contact sheet：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/cuu-motion-contact-sheet-after-full-body-hidpi-fix.png`
- 最终关键帧：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/frame-012-full-body-hidpi-card-mode.png`
- 最终像素报告：`docs/workhub/05-clients/assets/audit/2026-06-07-cuu-card-mode-fix/motion-diff-report-after-full-body-hidpi-fix.json`

修复结论：

- `CUX-MOTION-001` 已完成：事件卡触发后，真实 Tauri `Cuu` 窗口从 `194 x 228` 扩到 `394 x 568`，卡片不再被 body-only 小窗裁切；最终 fresh 抓帧中 Cuu 完整身体可见，不再只露耳朵 / 头部。
- `pet-window-bridge.ts` 现在会校验 Rust `set_pet_window_mode` 的 placement 返回值，缺失 invoke / 缺失 placement / 尺寸不足都会显式失败。
- `pet-surface.ts` 现在只有在 card mode 确认后才渲染完整轻卡；未确认时走 compact fallback，避免长正文挤进小窗；card bubble 收窄以适配 HiDPI `PrintWindow` 物理截图安全边距。
- `shell-events.ts` 现在把 `sse-status` 映射成类型化 offline card，用户看到“连接有点不稳 / 重连中”，raw SSE error 只保留在诊断 payload 中。
- `scripts/qa/cuu-tauri-motion-capture.ps1` 可多帧抓取真实 `Cuu` 顶层窗口，输出 frames、contact sheet、diff JSON、GIF/MP4。

最新鲜活感修复证据：

![Cuu alive motion after dev asset path fix](./assets/audit/2026-06-07-cuu-alive-motion-fix/cuu-motion-contact-sheet-after-dev-asset-path-fix.png)

结论：

- `CUX-MOTION-002` 已完成 P1：真实 Tauri 窗口不再依赖 inline 静态 fallback，body-only 第一屏可见 `idle_tail_sway`，进入 card mode 后 Cuu 全身和 worried/offline 姿态仍可见。
- dev server `/src/assets/...` 不能被错误改写成 `./assets/...`；打包态 `/assets/...` 才相对化。这条已有测试覆盖。
- 只有大小变化 / 呼吸缩放不能算通过；只露耳朵 / 局部也不能算通过。

最新轻卡修复证据（2026-06-08 P1.2）：

![Cuu Pet card P1.2 approval light card](./assets/audit/2026-06-08-cuu-pet-card-p1-2-normal/cuu-pet-card-p1-2-contact-sheet.png)

结论：

- `apps/desktop-webview/src/pet-surface.ts` 已把 `CuuCard.sections`、`progress`、`evidence_refs` 和 `input` 渲染到 pet card，不再只显示标题、消息、chip 和按钮。
- P1.2 正常审批态能在 `380 x 560` card mode 中同时看到 Cuu 全身、主操作按钮、变更摘要和风险摘要；这比把 Web notice 原样塞进小窗更接近概念图里的 Cuu 气泡。
- 打回原因态另有抓帧：`assets/audit/2026-06-08-cuu-pet-card-p1-2/cuu-pet-card-p1-2-contact-sheet.png`。该状态优先展示原因按钮，下方 PR context 会被折叠，这是轻卡密度上限，不应继续往桌宠窗里塞完整证据页。
- 澄清卡已渲染 option button、本地选中态、progress 和折叠输入提示；P1.2b 已把选中项通过 `selected_option_ids` 提交到 session API。

剩余差距：

- 第一轮 card layout 失败图必须保留为回归样例：只露耳朵 / 局部不能算通过。
- 下一步 Hatch/sprite pack 不再是为修“只露耳朵”兜底，而是作为动作 storyboard / fallback；默认主线继续打磨 Bongo Cuu，Live2D 继续精修。
- 离线卡与审批 / 澄清轻卡已完成 P1.2 的人话化、选项优先和少文字化基线，P1.2b 已补真实 option payload 提交；证据详情、预算卡、sync conflict 和 Tauri 顶层窗口 P1.2 抓帧仍需继续。
- 当前默认动作仍是 Bongo DOM/CSS + sprite fallback，不是最终 Live2D 活体表现；P1e-d-b 已证明 60 秒长驻可见和防闪烁，Hatch Pack / Bongo 动作二轮仍要继续做更大幅度的待机、走动、看鼠标、抱文件、任务动作和情绪动作。

下一步不应先堆更多抽象状态，也不应回退恐怖谷 PSD；应先把 Bongo Cuu 的轻卡动作、真实设置截图、多屏恢复、长驻性能采样和 full hide/pass-through 安全恢复做到稳定可爱，同时并行推进 Live2D 分层 PSD / Cubism。

### 3.7 施工进展（2026-06-06）

已落一个 **sprite runtime MVP**，用于把 `CuuMotionHint` 真正接到可渲染的 Cuu 动画层：

- `packages/cuu/src/sprite-manifest.ts`：新增 `defaultCuuSpriteManifest`、`cuuSpriteClipForMotion`、`validateCuuSpriteManifest`、`assertValidCuuSpriteManifest`。
- `packages/cuu/src/controller.ts`：新增 `createCuuController`，把 Cuu 提醒收敛为 `show` / `replace` / `queue` / `badge` / `drop` 决策。
- `apps/desktop-webview/src/cuu-sprite-runtime.ts`：新增 procedural CSS sprite renderer，在 notice 中显示 Cuu 小猫视觉层。
- `packages/cuu/src/atlas-manifest.ts`：新增真实 PNG/WebP atlas manifest schema、grid frame helper、partial/full coverage 校验。
- `docs/workhub/05-clients/assets/cuu/cuu-live2d-layer-breakdown-concept.png`：GPT Image 生成的 Live2D 分层拆件概念板，用于指导正式 PSD 拆层。
- `docs/workhub/05-clients/assets/cuu/cuu-live2d-front-model-concept.png`：GPT Image 生成的 Live2D 正面基准稿，用于锁定角色比例、脚底 anchor 和装饰位置。
- `docs/workhub/05-clients/assets/cuu/cuu-live2d-psd-production-board.png`：GPT Image 生成的 Live2D PSD 生产板，把中心 Cuu 与周边可拆部件放在同一画布，用于指导补画、切层与 Cubism 导入前检查。
- `apps/desktop-webview/src/assets/cuu/live2d/source/cuu-live2d-v0-layer-manifest.json`：Live2D 分层 PSD 合同，状态为 `contract_only`；列出必需图层、遮挡补画、Cubism 参数、motion fallback 与 QA 门禁。
- `apps/desktop-webview/src/assets/cuu/source-green/{idle_breathe,thinking_tail,asking_approval_bounce,carrying_document_step,celebrating_jump,searching_evidence_peek,syncing_files_spin,worried_ears,revision_requested_nod,offline_sleep}/`：GPT Image 绿幕 sprite sheets，保留原始绿幕源图。
- `apps/desktop-webview/src/assets/cuu/alpha/{idle_breathe,thinking_tail,asking_approval_bounce,carrying_document_step,celebrating_jump,searching_evidence_peek,syncing_files_spin,worried_ears,revision_requested_nod,offline_sleep}/`：本地 chroma-key + despill + edge-contract 后的透明 PNG。
- `apps/desktop-webview/src/assets/cuu/atlas/cuu-p1-motion-pack.png`：P1 motion pack atlas，当前覆盖 18 个业务状态与 idle / interaction clip。
- `apps/desktop-webview/src/assets/cuu/atlas/cuu.sprite.json`：与 motion pack atlas 对齐的 JSON manifest，便于 Tauri bundle 读取。
- `apps/desktop-webview/src/cuu-atlas-assets.ts` / `cuu-atlas-runtime.ts`：desktop webview 可按 atlas frame rect 生成 clip sheet background sprite 或 `<img>` frame stack；dev server `/src/assets/...` 保持原路径，打包态 `/assets/...` 才相对化；非覆盖状态会标记 fallback。
- `apps/desktop-webview/src/assets/cuu/static/cuu-static-fallback-v1-alpha-clean.png`：从 idle Cuu alpha 帧生成的静态兜底图，只作为诊断/兜底资产；运行态 motion QA 不允许用它替代真实 clip sheet / atlas / Live2D 动作。
- `apps/desktop-webview/src/pet-surface.ts`：Rust injected surface flag、Tauri window label、`/pet`、`?surface=pet`、`#surface=pet` 或 `pet.html` 均能只渲染 Cuu 本体和轻气泡，不加载 Gold Path 主壳。
- `apps/desktop-webview/src/pet-surface-qa.ts`：新增 Cuu 独立桌宠静态视觉 QA 合同，检查透明窗口语义、右下角独立 surface、pet body 点击/拖拽区域、非主壳、真实多帧 atlas、轻气泡和选项优先卡片。
- `apps/desktop-webview/src/pet-window-bridge.ts`：新增 bridge diagnostics、legacy invoke 兼容和 Rust placement 校验，避免 `set_pet_window_mode("card")` 静默失败。
- `scripts/qa/cuu-tauri-motion-capture.ps1`：新增真实 Tauri `Cuu` 顶层窗口多帧捕获，输出 frames、contact sheet、diff JSON 和 GIF/MP4，用于回答“桌宠到底有没有动、事件卡有没有被裁、是否只是在显示静态 fallback”。
- `packages/cuu/src/idle-scheduler.ts`：新增 Cuu 活体 idle scheduler，覆盖呼吸、眨眼、尾巴、看鼠标、睡觉、醒来、拖动、轻敲和挥手等微动作语义。
- `client-tauri/src-tauri/src/pet_window.rs`：新增 Cuu 独立窗口几何合同，覆盖 body-only/card 双模式、右下角定位、展开锚点、屏幕内 clamp、鼠标接近判定和拖拽 plan。
- `client-tauri/src-tauri/src/pet_commands.rs`：新增 Cuu 独立窗口 command scaffold，固定 `set_pet_window_mode`、`start_pet_window_drag`、`save_pet_window_position`、`sample_pet_cursor_near`，并让 capability 开放最小 `core:window:allow-start-dragging`。
- `client-tauri/src-tauri/{build.rs,src/main.rs}`：新增最小 Tauri runtime scaffold，接 `tauri-build`、`tauri::Builder`、`generate_context!`、pet command handler；setup 会用 `WebviewWindowBuilder::from_config` 动态创建 `create:false` 的 `pet` window，并注入 `window.__WORKHUB_SURFACE__="pet"`；随后恢复/夹取 `pet-window-state.json` 的 body anchor，并在启动期按 body-only 模式预定位 Cuu；`set_pet_window_mode` 已执行 resize/position/show，显示/切换和 mode resize 时会显式保持 `pet` always-on-top；monitor work area、window outer position 与 cursor position 已做 HiDPI physical→logical 换算；`start_pet_window_drag` 已执行 `start_dragging`，`save_pet_window_position` 已读取真实窗口位置并保存 body anchor，`sample_pet_cursor_near` 已读取真实桌面 cursor 与 pet window rect。
- `client-tauri/src-tauri/src/deep_link.rs` + `main.rs` + `apps/desktop-webview/src/browser.ts`：已接 `tauri-plugin-deep-link`，`workhub://` / `yqgl://` 可安全映射到 WorkHub 主窗 route，并同时发 `navigate` 与 `deep-link` 事件；desktop webview 已消费 safe `navigate` route，Cuu 可把复杂轻卡动作交给主窗承接。
- `apps/desktop-webview/src/pet-window-bridge.ts`：新增 pet window bridge，支持 mock / Tauri-like 模式切换、`startDragging`、位置保存和 cursor-near 采样端口；`pet-surface.ts` 已把 pointer hover/drag/release 与 Rust cursor sample 喂给 idle scheduler。
- `apps/desktop-webview/src/desktop-cuu-runtime.ts`：Cuu notice 已嵌入 sprite render，并先经过 controller 判断是否弹出、排队或降级 badge。
- `apps/desktop-webview/src/cuu-preferences.ts`：新增默认隐藏的偏好面板，支持正常/安静/勿扰、开启/静音、减少动效、队列上限，并持久化到 localStorage。
- `apps/desktop-webview/src/browser.ts`：新增 queue badge 和偏好面板；启动时会按 Rust injected surface flag、Tauri window label、`/pet`、`?surface=pet`、`#surface=pet` 或 `pet.html` 分流到独立 pet surface，否则加载完整 Gold Path 主壳。
- `apps/desktop-webview/pet.html`：浏览器调试入口，显式设置 `window.__WORKHUB_SURFACE__="pet"`，用于不启动 Tauri 时预览独立桌宠 surface。
- `scripts/qa/cuu-tauri-smoke.ps1`：Windows debug runtime smoke，启动真实 Tauri app，定位 `Cuu` 顶层窗口，校验 visible/topmost/bottom-right，隐藏主窗，并用 `PrintWindow(PW_RENDERFULLCONTENT)` 对透明/layered WebView2 pet 窗口做像素检查。2026-06-07 严格 smoke 通过：`orange_pixels=8961`、`visual_pixels=11189`。
- 测试已覆盖：每个 `CuuMotionHint.sprite_state` 都有对应 procedural clip；atlas manifest 可校验真实 motion pack，业务状态可通过 `require_full_motion_coverage`，idle / interaction 微动作可通过 `require_idle_micro_action_coverage`；pet surface 无卡片时会按 scheduler `idle_action` 选择真实 atlas clip；`pet-surface-qa.ts` 会守住透明、右下角、独立 pet surface、真实多帧 atlas、轻气泡和选项优先；Rust pet window command plan 与 pet window bridge 可解析 body/card 模式、Tauri-like command 和拖拽 fallback；desktop notice 能输出 `data-cuu-sprite-state`；pet surface 不渲染 `wh-app-shell`；勿扰模式下 urgent 审批不会弹窗但会保留系统通知意图；queue badge CSS 有锚点；偏好加载/存储/归一化和面板 HTML 有测试；`knowledge-search` 可返回 evidence card；`use_for_current_task` 可提交证据并回显 WorkItem card；Rust `notify.rs` 已测试 high/urgent 私有事件才会形成 OS 通知 plan，并有进程内 dedupe 防 SSE 重放。

仍未完成：

- 18 个动作的正式透明 PNG / WebP 已落 P1 pack；pet surface 静态视觉 QA 和 Windows debug `PrintWindow` runtime smoke / motion capture 已落；2026-06-07 已修复 dev sprite asset path 并验证真实 `idle_tail_sway` / card worried/offline 姿态可见；后续仍需做体积压缩、anchor 微调、alpha 边缘、跨平台透明 capture 和长时间性能 QA。
- `cuu.sprite.json` 已有运行时 JSON manifest，并覆盖业务状态与 idle / interaction 微动作。
- 独立 Tauri `pet` window runtime 已有初版；生产 Tauri 通过 Rust injected surface flag 分流，浏览器调试保留 `/pet` / `?surface=pet` / `#surface=pet` / `pet.html`；Rust window plan / config scaffold、pet 几何合同、command scaffold、最小 Tauri `main.rs`、前端 bridge 已落，并已把启动期 Cuu body-only 预定位、first-painted 后 show、mode/drag/save-position/cursor-sample 执行到真实 Tauri window / AppHandle API；位置会保存到 Tauri Config 目录下的 `pet-window-state.json`，启动时会 clamp 回当前 work area；HiDPI 坐标换算和 runtime topmost 已接；基础托盘显隐、deep-link 主窗唤起、single-instance 聚焦/协议 URL 处理和 high/urgent 系统通知已落；2026-06-08 P1c 已通过 Windows `PrintWindow` first-frame gate，仍缺多显示器实测、通知点击联动、跨平台透明 capture 和 alpha 边缘 QA。
- 真实 Tauri 设置页承接、系统通知偏好/去重、收起/恢复、多屏监视器恢复策略和透明窗口长驻 QA。
- 正式 Live2D 分层 PSD、Cubism 绑定、`.model3.json` 导出和 Tauri Live2D runtime。
- 主窗 notice 仍使用 procedural sprite 作为轻量占位；后续需要评估是否替换为同一套 atlas 或保持主窗轻量、桌宠用真实 atlas。

## 4. 交互原则

1. **Cuu 先动，用户再点**：有事时 Cuu 用动作、表情和小气泡发起，不要求用户主动找页面。
2. **一次只处理一件事**：桌宠展开后默认只呈现一个审批、一个问题或一个检索结果。
3. **选项优先**：澄清、审批原因、检索入口都优先给按钮/chips，打字只作为「其他」。
4. **证据随手可见**：凡是 AI 建议、变更说明、项目检索，都必须能展开来源证据。
5. **可爱但可靠**：Cuu 的外观可以活泼，审批卡、风险、回滚、权限说明必须清楚。
6. **不挡事**：Cuu 需要可拖动、可收起、可静音，长时间无事应进入低存在感状态。

## 5. 实现提示

- **窗口**：独立 `pet` Tauri 窗口，`transparent:true`、`decorations:false`、`alwaysOnTop:true`、`skipTaskbar:true`。
- **动效**：MVP 必须用 GPT Image 绿幕生成的真实小猫多帧 PNG/WebP，抠图后打成 sprite atlas；CSS procedural sprite 只能作为占位，不算完成。空闲态降帧，避免持续占 GPU。
- **事件映射**：继续使用 Rust SSE worker 转发的 `push-event`，由前端将正式 `WorkHubEvent.type` 映射到 Cuu 状态；映射表与 payload 形状以 [`_experience-deliverable-contracts.md`](../../plans/p0-foundation/_experience-deliverable-contracts.md) §4 为准。
- **轻卡类型**：审批、澄清、证据、项目检索、交付物变更包统一消费 `AttentionItem` / `QuestionCard` / `EvidenceRef` / `DeliverableChangeManifest`，避免桌宠、主窗、Web 各自手写结构。
- **主窗关系**：Cuu 可单独展开轻卡；复杂操作再通过 deep-link 打开主客户端。
- **隐私**：项目检索卡只显示用户有权限看到的证据，私有通知走 user-scoped 事件。

## 6. 端侧归属

- **Web 端**：项目、审批、负责人视角，适合结构化管理。
- **Rust 客户端**：本地执行、同步、交付、设备令牌、权限确认。
- **Cuu 桌宠**：提醒、澄清、项目检索、证据气泡、轻审批和陪伴。

结论：Cuu 是 WorkHub 的 AI-native 入口。用户不应该先学会看板或复杂页面，而是先看到 Cuu 把当前需要处理的一件事递到面前。

## 7. 动画实现架构选型

![Cuu 动画架构选型](./assets/cuu/cuu-animation-architecture-options.png)

桌宠动画不要一开始锁死单一技术。Cuu 建议按阶段选择运行时：

| 方案 | 资产形态 | 优点 | 风险/代价 | 建议阶段 |
|---|---|---|---|---|
| **PNG Sprite Atlas** | 多帧透明 PNG + JSON 帧配置 | 最简单、最可靠、最容易由 GPT Image 生成，适合先跑起来，也能做 Live2D 失败降级 | 文件体积偏大，状态切换不够丝滑 | **MVP/P1 + fallback** |
| **Lottie** | After Effects/Bodymovin JSON，Web 端 `lottie-web` 渲染 | 轻量、SVG/Canvas/HTML 多渲染器，适合简单循环和 UI 动效 | 角色形变/交互状态有限，美术需 AE 流程 | P1 兜底 |
| **Rive** | `.riv` 文件 + state machine | Web/React 运行时支持 state machine input，适合把 `push-event` 映射成动作 | 需要 Rive 制作流程，初期资产准备成本高于 sprite | **P2 推荐** |
| **Live2D Cubism** | 分层 PSD -> `.moc3` + texture + physics/motion config | 表现力强，适合呼吸、眼神、耳朵、尾巴、流苏、脸部与身体轻形变，最符合“活着的桌宠”目标 | 美术拆层/补画/绑定/许可/运行时复杂度最高，Cubism Core 需官方包 | **高表现力主线 P2/P3** |

推荐路线：**先 sprite，让 Cuu 真的出现在桌面；同时按 Live2D 专篇推进分层 PSD；再让 Cubism 模型接管主要表现力。Rive 可作为可选中间路线，但不应挤掉 Live2D 的长期目标。**

P1 sprite 不是抽象图标，而是绿幕生图后的透明小猫动作帧。完整动作批次、prompt、抠图、anchor 对齐、atlas manifest 与独立窗口策略见 [`cuu-green-screen-desktop-pet-solution.md`](./cuu-green-screen-desktop-pet-solution.md)。Live2D 的图层树、PSD 交付、Cubism 参数和 runtime 接线见 [`cuu-live2d-layered-asset-plan.md`](./cuu-live2d-layered-asset-plan.md)。

官方资料锚点：

- [Tauri v2 window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/) / [window customization](https://v2.tauri.app/learn/window-customization/)：支持 `transparent`、`decorations`、`alwaysOnTop` 等窗口属性；多窗口创建需要相应 capability。
- [Rive Web runtime](https://rive.app/docs/runtimes/web) / [Rive React runtime](https://rive.app/docs/runtimes/react)：支持 canvas/WebGL 渲染、state machine 和 input trigger。
- [`lottie-web`](https://github.com/airbnb/lottie-web)：支持 SVG/Canvas/HTML renderer，并可通过 `playSegments` 播放片段。
- [Live2D Cubism SDK manual](https://docs.live2d.com/en/cubism-sdk-manual/top/) / [CubismWebFramework](https://github.com/Live2D/CubismWebFramework)：可作为高表现力路线；注意 Cubism Core 与许可/分发约束。
- [OpenAI image generation guide](https://platform.openai.com/docs/guides/image-generation)：用于规划正式图片生成接口；若当前生成链路不支持原生透明，则走 chroma-key + 本地抠图兜底。

## 8. 美术资产生产流水线

![Cuu 资产生产流水线](./assets/cuu/cuu-asset-production-pipeline.png)

建议把美术流水线分成 6 步：

1. **风格定稿**：固定 Cuu 的橘猫毛色、蕾丝围兜、黑色蝴蝶结、珍珠/红珠、眼睛比例、轮廓比例。
2. **GPT Image 生图**：用统一 prompt 生成状态帧，不直接要求透明背景时，优先生成纯色 chroma-key 背景。
3. **抠图/去底**：
   - 如果调用的图片模型/接口支持透明背景，直接输出 PNG/WebP 透明图。
   - 如果当前工具链不支持原生透明，用纯色背景 + 本地 `remove_chroma_key.py` 做 alpha，必要时人工修边。
4. **一致性修正**：统一眼睛大小、围兜位置、蝴蝶结朝向、红珠数量、阴影边缘和色温。
5. **打包**：
   - MVP：`cuu.sprite.json` + `*.png` frames。
   - P2/P3：Live2D 分层 PSD -> Cubism `.moc3` + texture + physics/motion。
   - Rive：作为可选中间路线，不阻塞 Live2D 主目标。
6. **运行时验收**：在 Tauri 透明窗口中检查边缘、帧率、CPU/GPU、点击区域、HiDPI、多显示器和低电量表现。

### 8.1 目录建议

```text
apps/desktop-webview/src/assets/cuu/
  source-green/
    idle_breathe/
    thinking_tail/
  alpha/
    idle_breathe/
    thinking_tail/
  atlas/
    cuu-p1-motion-pack.png
    cuu.sprite.json
  rive/
    cuu.riv
  live2d/
    source/
      cuu-live2d-v0.psd
      cuu-live2d-v0-layer-manifest.json
    cuu.model3.json
    textures/
docs/workhub/05-clients/assets/cuu/
  *.png  # 概念图与设计说明用，不作为运行时生产资产
```

如果后续 Tauri 前端目录从 `apps/desktop-webview` 迁到 `client-tauri/web-src`，仍保持 `assets/cuu/{source-green,alpha,atlas}` 结构，不改变 manifest 语义。

### 8.2 Sprite 配置草案

```json
{
  "version": 1,
  "defaultState": "idle",
  "states": {
    "idle": { "frames": ["idle-000.png", "idle-001.png"], "fps": 8, "loop": true },
    "approval": { "frames": ["approval-000.png"], "fps": 8, "loop": false },
    "syncing": { "frames": ["sync-000.png", "sync-001.png"], "fps": 10, "loop": true }
  }
}
```

## 9. 事件到 Cuu 状态映射

| WorkHub 事件/状态 | Cuu 状态 | UI 呈现 | 用户动作 |
|---|---|---|---|
| `agent_run.started` / `agent_run.step` | thinking | Cuu 思考/转圈 | 可点开看执行步骤 |
| `permission.ask` | asking approval | Cuu 轻敲审批气泡 | 通过 / 打回 / 委派 / 永远允许 |
| `proposal.opened` | carrying document | Cuu 抱文件出现 | 查看变更包 |
| `knowledge.evidence.ready` | searching evidence | Cuu 放大镜/证据气泡 | 打开证据 / 用于当前任务 |
| `sync.progress` | syncing files | Cuu 同步动作 | 查看同步队列 |
| `sync.conflict` | worried / sync conflict | Cuu 紧张 + 冲突卡 | 应用 AI 合并 / 保留本地 / 保留云端 |
| `revision.requested` | revision requested | Cuu 委屈/拿笔 | 查看打回原因 |
| `proposal.merged` | celebrating | Cuu 庆祝 | 查看交付物 |
| `sse-status:retrying/closed` | offline | Cuu 灰态/重连 | 打开诊断 |

## 10. Tauri 部署与运行时边界

Cuu 应是独立 `pet` window，而不是主窗内固定浮层。

- `pet` 窗口：透明、无边框、always-on-top、skip-taskbar、记忆位置。
- `main` 窗口：承载完整客户端页面；复杂操作由 Cuu deep-link 唤起。
- Rust 侧：SSE worker（基础 global stream 已落）/ reminders / tray / deep-link（基础 handler 已落）发事件；不承担动画逻辑。
- TS/React 侧：`packages/cuu` 的纯 controller 管打扰策略与队列，React/Webview 层管动画 runtime、气泡卡片和用户输入。
- 资源加载：生产资产打入 Tauri bundle；概念图只放文档目录。
- 更新：Cuu 资产版本跟随客户端版本；未来可做独立 asset manifest，但 P1 不需要。

## 11. 施工顺序建议

1. P1：绿幕生成 PNG/WebP sprite 版 Cuu，至少 18 个动作，能 idle、blink、tail、sleep、wake、thinking、approval、searching、carrying、celebrating、offline（procedural MVP 只算占位，待正式资产）。
2. P1：Cuu 气泡承接选项式澄清和项目检索 chips（审批/澄清/知识检索回显/证据带回当前任务已落，待证据详情展开、完整检索页和真实持久化）。
3. P2：独立 `pet` Tauri window，支持拖动、收起、托盘显隐（基础菜单已落，待跨平台 smoke 和动态状态），并把已有偏好面板迁入真实 Settings / pet window。
4. P2：并行推进 Live2D 正面基准稿、分层 PSD 和 Cubism 绑定，让呼吸、眨眼、看鼠标、耳朵、尾巴、流苏先动起来。
5. P3：接 Tauri Live2D runtime，优先加载 `.model3.json`，失败降级 sprite；Rive 仅作为可选中间路线。
6. P4：性能/电量/多屏/HiDPI/透明边缘 QA，形成桌宠发布 checklist。

### 11.1 施工验收门

| 门禁 | 必须证明 |
|---|---|
| Motion hint 不漂移 | `allCuuMotionHints()` 的每个 `sprite_state` 都能在 sprite manifest 找到对应资产 |
| Cuu 真会动 | `idle → thinking → asking_approval → carrying_document → celebrating` 能由 scripted event 触发 |
| Cuu 像活物 | 60 秒 idle 内至少出现呼吸、眨眼、尾巴、睡觉/看鼠标中的两类微动作 |
| 选项优先 | 澄清、审批、打回理由都有可点击 chips；长文本只作为兜底 |
| 桌宠独立 | 主窗隐藏后 `pet` window 仍能显示提醒 |
| 不挡事 | 支持拖动、收起、静音、勿扰和低存在感 idle |
| 可访问 | reduced-motion 模式下不播放复杂动画，但保留状态文案和可点动作 |
| 可部署 | 运行时资产进入 Tauri bundle；概念图只留在 `docs/workhub/05-clients/assets/cuu` |

更多当前差距和跨端路线见 [`prd-concept-reproduction-gap-audit.md`](./prd-concept-reproduction-gap-audit.md)。
