---
module: 05-clients
layer: C-PET / Cuu
status: current-concept
owner: workflow
date: 2026-06-08
visuals:
  - ./assets/cuu/cuu-character-animation-states.png
  - ./assets/cuu/cuu-desktop-approval-search.png
  - ./assets/cuu/cuu-option-first-clarify.png
---

# Cuu 桌宠形象与交互概念

> 当前权威口径：Cuu 只存在于独立 Tauri `pet` 透明窗口里；Web 与 desktop 主窗是严肃工作界面，不出现 Cuu 形象、角色栏、角色卡或主窗模型选择入口。Cuu 当前只允许两个 Live2D Cubism 2 模型包：黑猫 `cuu-hijiki-live2d-cubism2` 和白猫 `cuu-tororo-live2d-cubism2`。黑猫默认，白猫可选。

## 1. 角色定位

Cuu 是 WorkHub 的桌面陪伴入口，不是页面装饰。它负责把后台 AI 工作变成用户能感知、能点击、能信任的桌面交互。

| 场景 | Cuu 做什么 | 主窗做什么 |
|---|---|---|
| 空闲 | 在右下角独立存在，轻微待机、眨眼、尾巴动作、看鼠标 | 不展示 Cuu |
| 澄清 | 弹出一问一答的选项气泡，默认让用户点击 | 需要完整上下文时打开澄清页 |
| 审批 | 用动作和小卡提醒，展开为证据、风险、推荐动作 | 承载完整审批中心 |
| 项目检索 | 用气泡 chips 发起检索、总结、找文件 | 展示完整搜索结果和引用 |
| 交付物变更 | 摘要“改了什么”，给同意/打回/查看详情 | 展示 GitHub-like 变更说明、diff、证据 |
| 离线/异常 | 睡觉、担心、重连提示 | 展示诊断和设置 |

设计目标是“像一个活着的小助手”，不是“一个带猫图标的通知系统”。每次出现都要有动作原因：正在想、正在找、需要确认、完成了、出错了。

## 2. 当前形象规范

| 选项 | pack id | 视觉定位 | 用途 |
|---|---|---|---|
| 黑猫 | `cuu-hijiki-live2d-cubism2` | 默认 Cuu，稳定、可爱、低干扰 | 默认桌宠 |
| 白猫 | `cuu-tororo-live2d-cubism2` | 唯一替代形象，动作合同一致 | 用户偏好切换 |

硬性规则：

- Cuu 必须完整显示在右下角独立 `pet` window，不能只露耳朵、只露头、只露局部。
- Cuu 的窗口锚点和脚底位置必须稳定；鼠标靠近只能触发表情、视线、Live2D 动作或轻微视觉强调，不能让整只 Cuu 平移、旋转、闪烁或重建。
- Cuu 本体不承载 WorkHub 状态色；状态色只出现在气泡、卡片、按钮、徽标中。
- Cuu 偏好只展示“黑猫 / 白猫”两个选项。
- 未知或历史模型包 ID 统一回退黑猫。
- 商用发布前必须确认现有模型授权，或用同一合同替换为原创黑猫/白猫模型。

## 3. 明确废弃

以下路线不得再作为当前源码、默认 fallback、用户选项或验收目标：

- 主窗 / Web 内嵌 Cuu 形象。
- 手绘几何猫、静态图片猫、生成图右侧栏。
- 多帧贴图、图集、裁片、临时分层草案。
- 未通过用户复核的改色稿与实验形象。

这些路线可以作为“为什么失败”的背景知识，但不再保留专篇作为施工入口。新的施工入口是 [`cuu-live2d-cat-options-current-plan.md`](./cuu-live2d-cat-options-current-plan.md) 与本篇。

## 4. 概念图索引

> 2026-06-08 同步：本节三张概念图已原位替换为黑猫 Hijiki / 白猫 Tororo Live2D 版。图中模型来自真实浏览器运行帧，源帧保存在 `./assets/audit/2026-06-08-cuu-live2d-model-preview/`；旧橘猫、手绘几何猫、改色实验图不再是概念目标。

### 4.1 动效状态表

![Cuu 角色动效状态表](./assets/cuu/cuu-character-animation-states.png)

这张概念图用黑猫/白猫真实 Live2D 帧建立视觉基准，同时定义动作语义。当前黑猫/白猫都必须承接这些状态：

| 状态 | 触发 | Cuu 表现 | 验收方式 |
|---|---|---|---|
| idle | 无任务 | 呼吸、眨眼、尾巴轻动 | 多帧截图能看到非缩放变化 |
| thinking | AI 正在推理 | 低头、轻晃、等待感 | run 事件触发动作 |
| asking approval | 需要审批 | 抬头、靠近、气泡展开 | approval card 出现 |
| carrying document | 有交付物 | 带交付摘要气泡 | proposal payload 触发 |
| searching evidence | 检索项目/知识库 | 看向气泡、等待结果 | search action 触发 |
| syncing files | 同步文件 | 持续但不抢眼的忙碌动作 | sync event 触发 |
| worried | 低置信度/风险 | 慢动作、提醒用户 | risk/escalation event |
| revision requested | 用户打回 | 收回气泡、继续工作 | rejection event |
| celebrating | 完成/通过 | 短促庆祝 | approved/done event |
| offline | 离线/重连 | 睡觉或担心 | SSE status 触发 |

### 4.2 桌面审批与项目检索

![Cuu 桌面审批与项目检索](./assets/cuu/cuu-desktop-approval-search.png)

这张概念图定义 Cuu 的工作方式：

- Cuu 常驻桌面，不要求用户先打开主窗。
- 图中的主窗只是严肃页面示意；Cuu 本体只在独立 pet window，不进入 Web / desktop 主窗。
- 审批事项先用轻气泡提醒，再展开为可操作卡片。
- 项目检索属于桌宠功能：用户通过 chips 选择“找相关文件”“总结上次会议”“解释这次改动”。
- 变更申请可以是文档、PPT、表格、图片、文件夹或代码，不局限于 PR。

### 4.3 选项优先澄清

![Cuu 选项优先澄清](./assets/cuu/cuu-option-first-clarify.png)

澄清页和 Cuu 气泡都遵循同一个原则：让用户点击，不默认让用户打字。

- 一次只问一个问题。
- 推荐项排第一并可高亮。
- 兜底输入折叠在底部，只在选项无法表达时使用。
- 已确认信息以简短 chips 展示，用户知道还剩几步。
- 图中白猫代表可选 Tororo 模型；交互合同与黑猫完全一致。

## 5. 当前视觉资产基准

| 资产 | 当前内容 | 用途 |
|---|---|---|
| `./assets/cuu/cuu-character-animation-states.png` | Hijiki / Tororo 真实帧 + 状态语义表 | Cuu 动作状态和二选项视觉基准 |
| `./assets/cuu/cuu-desktop-approval-search.png` | 黑猫独立 pet window + 审批/检索气泡 | 桌面右下角工作方式 |
| `./assets/cuu/cuu-option-first-clarify.png` | 白猫气泡 + option-first 澄清页 | 澄清交互和主窗边界 |
| `./assets/audit/2026-06-08-cuu-live2d-model-preview/hijiki/` | 黑猫浏览器模型帧与 DOM/report | 证明概念图使用真实模型源 |
| `./assets/audit/2026-06-08-cuu-live2d-model-preview/tororo/` | 白猫浏览器模型帧与 DOM/report | 证明白猫不是配置文字假切换 |

这些资产只证明“当前概念图已经同步到黑/白 Live2D 模型”。它们不能替代后续 Tauri `pet` window 多场景录屏；桌宠最终通过仍以真实窗口 motion capture、settings matrix 和主窗无 Cuu 截图为准。

## 6. 交互合同

### 6.1 Cuu 气泡

| 字段 | 说明 |
|---|---|
| `card.kind` | `approval`、`clarify`、`deliverable`、`search`、`sync`、`offline` |
| `card.title` | 一句话说明发生了什么 |
| `card.summary` | 80 字以内摘要 |
| `card.actions` | 2-4 个选项按钮，优先可点击动作 |
| `card.evidence_refs` | 可选，指向文件、会议、需求、trace |
| `card.motion` | 绑定 Cuu 动作语义 |
| `card.priority` | `low`、`normal`、`high`、`urgent` |

### 6.2 用户输入

| 输入 | 行为 |
|---|---|
| 点击 Cuu | 展开当前最高优先级气泡；无事项时打开最近状态 |
| hover | 看向鼠标或触发表情，窗口和全身锚点保持固定；只有用户开启 hide-on-hover 时允许 soft hide |
| 拖拽 | Rust `start_pet_window_drag`，释放后保存位置 |
| 点击气泡选项 | 发送 typed action，不要求输入文本 |
| 长时间无事 | 进入睡眠或低频 idle |

### 6.3 与主窗边界

主窗可以显示同一事件的完整页面，但不显示 Cuu 本体。允许的入口是：

- 系统托盘菜单：显示/隐藏 Cuu、打开主窗、打开收件箱。
- Cuu 气泡按钮：查看详情、打开审批、打开检索结果。
- 主窗设置页：只显示严肃的桌面客户端设置，不放 Cuu 形象。

## 7. 验收门

视觉验收：

- 黑猫和白猫都能在独立 `pet` window 里完整显示。
- 多帧录屏能证明眨眼、待机、尾巴、看鼠标或模型动作真实存在。
- 动作不能只是整体缩放。
- 鼠标靠近不能造成整只 Cuu 位移、快速跳位或 iframe 黑屏重载。
- 不允许出现肢体错误、五条腿、局部裁切、只露耳朵。
- Web / desktop 主窗截图中不出现 Cuu 形象。

源码验收：

- `packages/cuu/src/model-pack.ts` 只暴露黑猫/白猫。
- `apps/desktop-webview/src/cuu-preferences.ts` 只展示黑猫/白猫。
- `apps/desktop-webview/src/pet-surface.ts` 只渲染 Live2D cat runtime。
- QA 禁止旧实验 runtime/class/data attribute 回流。

## 8. 后续施工

1. 为黑猫录制真实 Tauri idle、hover、tap、drag、approval、search、offline 多帧素材。
2. 为白猫录制同等素材，验证模型切换不是只换配置文本。
3. 把录屏 contact sheet、GIF/MP4、DOM dump、diff report 写回审计文档。
4. 补多屏恢复、全隐藏恢复、点击穿透恢复、托盘显隐和通知点击 deep-link。
5. 做授权评估；若授权不足，按同一 pack contract 制作原创黑猫/白猫替换包。
