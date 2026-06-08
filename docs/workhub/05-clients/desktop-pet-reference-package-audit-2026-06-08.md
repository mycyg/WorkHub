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

## 2. Reuse Value

### 2.1 VPet

高参考价值：

- 桌宠动作分类与状态机。
- ABC 三段式动画组织。
- MOD 包生命周期和资源加载结构。
- 多语言包组织。
- 鼠标交互、拖拽、点击穿透、屏幕边界修正。
- 透明窗口和长期常驻体验。

不适合直接迁移：

- 技术栈是 WPF / .NET，WorkHub 当前桌宠是 Tauri + Rust shell + TS webview。
- 内置动画、图片、插件和 Steam 相关代码有版权与执行风险。
- 包内 ChatGPT / EdgeTTS / Live2D 相关内容更像路径占位，不构成 WorkHub AI-native 实现参考。

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

## 3. WorkHub Adaptation Plan

| 借鉴点 | WorkHub 落点 | 验收 |
|---|---|---|
| 动作状态机 | `packages/cuu/src/motion.ts` 扩展 motion state 到 Live2D motion key / optional PNG fallback contract | 不改变黑猫/白猫模型白名单；业务状态能触发不同 `.mtn` |
| 资源包 schema | `packages/cuu/src/model-pack.ts` 增加 pack manifest 字段：motions、sounds、license、capabilities | 模型包仍只暴露黑猫/白猫；未知包回退黑猫 |
| 点击穿透 / 边界修正 | `client-tauri/src-tauri/src/pet_window.rs` / `pet_commands.rs` | settings matrix 覆盖 pass-through、hide-on-hover、scale、card mode |
| 右键设置入口 | `apps/desktop-webview/src/pet-surface.ts` + Tauri bridge | zh-CN/en-US 右键菜单截图或 DOM dump；菜单不移动 Cuu、不重建 iframe |
| 多语言包经验 | 继续使用 WorkHub `WorkHubLocale` 合同，不引入第三方语言包格式 | Web、desktop、pet 共享 `workhub.locale` |
| 音效偏好 | 后续扩展 `CuuControllerPreferences.sound_mode` | 默认静音可控；任务审批不扰民 |

## 4. Next Construction Slice

下一块 Cuu 施工建议：

1. 实现独立 pet window 的右键 / 设置轻菜单。
2. 菜单只包含黑猫、白猫、中文、EN、点击穿透、悬停避让、隐藏 Cuu、打开设置。
3. 语言切换复用 P1.3 的 `PATCH /api/auth/preferences` 与 `workhub.locale`。
4. 模型切换复用当前 `CuuControllerPreferences.pet_model_pack_id`。
5. 录制 settings matrix，证明设置入口真实可用而不是文档选项。
