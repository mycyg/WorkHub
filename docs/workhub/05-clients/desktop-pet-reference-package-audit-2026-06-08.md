---
module: 05-clients
layer: C-PET / Reference Study
status: current-audit
owner: workflow
date: 2026-06-08
---

# Desktop Pet Reference Package Audit

> 用户在 `D:\WorkHub\reference` 放入了几个压缩包。本审查只记录可借鉴方向，不提交 `reference` 内容，不把未授权素材纳入 WorkHub 默认资产。

## 1. Packages

| 压缩包 | 内容规模 | 技术 / 形态 | 安全结论 |
|---|---:|---|---|
| `VPet-main.zip` | 约 931.83 MiB，约 6955 项，解压约 974.84 MiB | VPet-Simulator；C# / .NET 8 / WPF / WinForms / SkiaSharp / LinePutScript / Steam Workshop / MOD | 可在 `reference` 下解压研究；不执行 `.dll` / `.bat` / Steam 相关二进制 |
| `像素猫meme.zip` | 约 9.42 MiB，约 201 项，主要是 PNG / WAV / JSON | 像素猫序列帧素材包 | 可在 `reference` 下解压研究；无明显代码执行面 |
| `像素猫meme_扩充版.zip` | 约 13.87 MiB，约 397 项，更多 PNG / WAV / JSON | 扩展像素猫动作与音效 | 可在 `reference` 下解压研究；无明显代码执行面 |

路径穿越审查结果：三者中央目录均未发现路径穿越条目。

本轮只做 ZIP 中央目录、README、配置 JSON 和源码文本的只读审查；不执行包内二进制，不把包内素材复制进 WorkHub 默认运行资产，不把 `reference` 路径加入提交。

## 2. Reuse Value

### 2.1 VPet

高参考价值：

- 桌宠动作分类与状态机。
- ABC 三段式动画组织。
- MOD 包生命周期和资源加载结构。
- 多语言包组织。
- 鼠标交互、拖拽、点击穿透、屏幕边界修正。
- 透明窗口和长期常驻体验。

已确认的具体参考点：

| VPet 证据 | WorkHub 启发 |
|---|---|
| `README_en.md` 明确拆分 `VPet-Simulator.Windows`、`VPet-Simulator.Core`、`Graph`、`Display`、`Handle` | WorkHub 应继续保持 Rust shell / desktop webview / Cuu runtime 分层，不把业务状态机塞进 Rust |
| `MainWindow.xaml.cs` 使用 `AllowsTransparency`、`WS_EX_LAYERED`、`WS_EX_TRANSPARENT`、`WS_EX_TOOLWINDOW` 和 `MouseHitThrough` | Cuu 的透明、穿透、恢复必须由 Rust/Tauri 窗口层统一管理，并保留托盘恢复门 |
| `GraphCore.cs` 用 `GraphType + AnimatType + ModeType` 建动画索引，查不到时有降级策略 | Cuu 需要 motion registry，不应在 UI 中散落字符串和 fallback 逻辑 |
| `PNGAnimation.cs` 把多帧 PNG 合成缓存图集，并按帧时间播放 | 如果 Live2D 某些动作缺失，PNG/GIF fallback 也应走显式 manifest 和缓存，而不是临时静态图 |
| `MainDisplay.cs` 把动作拆成 `A_Start` / `B_Loop` / `C_End` | Cuu 任务态应该有 start/loop/end，避免状态切换突然跳帧或只做缩放 |
| `MainLogic.cs` 把 `Say`、消息气泡和动作触发连接起来 | Cuu 气泡不是普通 toast，应该能触发对应动作、表情和窗口 card mode |
| `Load_2_TouchEvent` 定义头部、身体、拖拽等触区 | Cuu 应保留 Live2D canvas 上的点击/拖拽热区，hover 默认只看向鼠标，不移动全身 |

不适合直接迁移：

- 技术栈是 WPF / .NET，WorkHub 当前桌宠是 Tauri + Rust shell + TS webview。
- 内置动画、图片、插件和 Steam 相关代码有版权与执行风险。
- 包内 ChatGPT / EdgeTTS / Live2D 相关内容更像路径占位，不构成 WorkHub AI-native 实现参考。
- 即使源码协议可研究，动画资产仍需单独确认授权；WorkHub 当前不能把 VPet 图像资产作为 Cuu 默认素材。

### 2.2 Pixel Cat Packages

中等参考价值：

- `act_conf.json` 的动作到帧率/序列帧映射。
- `pet_conf.json` 的随机动作概率、交互动作入口。
- `note/note.json` 的动作与音效绑定。
- 扩充版的 `cry`、`giveup`、`drinkmilk`、`work/focus` 等情绪动作，可映射到 Cuu 的业务状态。

不适合直接作为 Cuu：

- 没有明确许可证。
- meme 风格强，不符合 WorkHub 默认身份的稳重桌面助手定位。
- 当前 Cuu 口径已收束为黑猫 / 白猫 Live2D 二选项，不应再引入第三种默认视觉路线。

已确认的具体参考点：

| JSON | 关键字段 | WorkHub 启发 |
|---|---|---|
| `act_conf.json` | `images`、`act_num`、`frame_refresh`、`need_move`、`direction` | Cuu 行为 manifest 应把动作名、帧率/时长、是否移动、移动方向写清楚 |
| `pet_conf.json` | `default`、`drag`、`fall`、`patpat`、`random_act`、`act_prob`、`act_type`、`sound` | Cuu idle 需要随机动作池、概率、优先级和可打断规则 |
| `note/note.json` | `image`、`sound`、`sound_priority` | Cuu 后续音效必须默认静音、可配置，并能按动作优先级触发 |
| 扩充版动作 | `focus/work`、`cry`、`giveup`、`drinkmilk`、`crazylaugh` 等 | 可作为业务状态命名参考，但不引入梗图视觉 |

## 3. WorkHub Adaptation Plan

| 借鉴点 | WorkHub 落点 | 验收 |
|---|---|---|
| 动作状态机 | `packages/cuu/src/motion.ts` 新增 `CuuBehaviorManifest`，把业务状态映射到 Live2D motion key / expression / optional PNG fallback | 不改变黑猫/白猫模型白名单；业务状态能触发不同动作，不只是缩放 |
| Start / Loop / End | `packages/cuu/src/motion.ts` 支持 `enter`、`loop`、`exit` 三段 motion slot | `asking_approval -> idle` 不突兀，录屏能看到过渡动作 |
| 随机 idle 池 | `packages/cuu/src/motion.ts` 增加 `idle_random`、`probability`、`cooldown_ms`、`interruptible` | 10s idle 录屏中能看到眨眼/尾巴/轻微看向，不是死图 |
| 资源包 schema | `packages/cuu/src/model-pack.ts` 增加 pack manifest 字段：motions、expressions、sounds、license、capabilities、behavior_manifest_version | 模型包仍只暴露黑猫/白猫；未知包回退黑猫 |
| 任务事件绑定 | `apps/desktop-webview/src/pet-surface.ts` 把 `workhub:approval.required`、`agent.run.thinking`、`evidence.searching`、`sync.progress` 映射到 manifest 状态 | 任务态截图/录屏能证明 Cuu 与 AI 工作状态同步 |
| 点击穿透 / 边界修正 | `client-tauri/src-tauri/src/pet_window.rs` / `pet_commands.rs` | settings matrix 覆盖 pass-through、hide-on-hover、scale、card mode |
| 右键设置入口 | `apps/desktop-webview/src/pet-surface.ts` + Tauri bridge | zh-CN/en-US 右键菜单截图或 DOM dump；菜单不移动 Cuu、不重建 iframe；点击穿透留给 `/settings` 和托盘恢复门 |
| 多语言包经验 | 继续使用 WorkHub `WorkHubLocale` 合同，不引入第三方语言包格式 | Web、desktop、pet 共享 `workhub.locale` |
| 音效偏好 | 后续扩展 `CuuControllerPreferences.sound_mode`、`sound_volume_percent`、`sound_event_allowlist` | 默认静音可控；任务审批不扰民 |

计划接口草案：

```ts
type CuuMotionSlot = {
  motion: string;
  expression?: string;
  min_duration_ms?: number;
  max_duration_ms?: number;
  interruptible: boolean;
};

type CuuBehaviorManifest = {
  version: 1;
  model_pack_id: "cuu-hijiki-live2d-cubism2" | "cuu-tororo-live2d-cubism2";
  states: Record<
    "idle" | "thinking" | "asking_approval" | "searching_evidence" | "syncing_files" | "worried" | "celebrating" | "offline",
    {
      enter?: CuuMotionSlot;
      loop: CuuMotionSlot[];
      exit?: CuuMotionSlot;
      bubble_mode?: "none" | "tip" | "card";
      window_mode?: "body_only" | "card";
      priority: number;
    }
  >;
  idle_random: Array<CuuMotionSlot & { probability: number; cooldown_ms: number }>;
};
```

## 4. Next Construction Slice

下一块 Cuu 施工建议从“设置恢复门”推进到“鲜活动作运行时”：

1. 新增 `packages/cuu/src/motion.ts`，定义 `CuuBehaviorManifest`、状态优先级、start/loop/end slot 和 idle random pool。
2. 在 `packages/cuu/src/model-pack.ts` 为黑猫/白猫分别挂同构 manifest；没有真实 motion 的状态先映射到最近似 Live2D motion，但必须在 manifest 中显式标记 `coverage: partial`。
3. 在 `apps/desktop-webview/src/cuu-cat-live2d-runtime.ts` 增加 `setCuuBehaviorState(state, reason)`，只向已有 iframe/runtime 发送 motion 请求，不重建 iframe。
4. 在 `apps/desktop-webview/src/pet-surface.ts` 把 approval/search/sync/done/offline 等事件接入行为状态机，并保留用户 hover/tap/drag 的高优先级临时动作。
5. 增加录屏验收：idle 10s、hover look-only 5s、tap、drag、approval card、search bubble、done celebration，黑猫/白猫各一组。
6. 保留 `reference` 只读；不得把 VPet 或像素猫素材复制到 `apps/desktop-webview/public`。
