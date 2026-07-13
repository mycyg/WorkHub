# 模式五档弹层 · 补做汇报

分支：`r12/mode-popover`（从 `r12/workbench-full` 推送头 `ecaadee5` 切出）。

## 背景

R12 视觉复审发现协同会话（单聊）composer 里缺一个功能：模式五档弹层。设计定稿见
`r12-desktop-workbench/00-interaction-design.md` §3（含 2026-07-12 纠偏：模式五档只属于协同单聊，
主区群聊固定走项目治理的静默观察者档，不放这个控件）。视觉基准是
`r12-desktop-workbench/prototype/index.html` 的 `.power` chip + `#powerPop` 弹层。

## 做了什么

1. `apps/desktop-webview/src/workbench/chat/api.ts`：新增 `fetchMyAiProfile` / `patchMyAiMode`，
   GET/PATCH `/api/me/ai-profile`（契约见 `apps/api/src/routes/ai-settings.ts` +
   `packages/contracts/src/domain/conversation.ts` 的 `userAiProfileVmSchema` /
   `patchUserAiProfileRequestSchema`）。照既有 `chat/api.ts` 的薄封装模式，走 `client.request<T>`，
   不新增 `WorkHubApiClient` 具名方法。
2. `apps/desktop-webview/src/workbench/chat/render.ts`：新增纯函数
   `renderModeChipHtml` / `renderModePopoverHtml` / `renderModeObserveOnlyHintHtml` /
   `renderModeErrorHintHtml` / `modePatchFailedText`；`renderComposerHtml` 新增可选参数
   `modeChipHtml`（省略即不渲染任何模式相关标记——这是"主区不渲染"的落地点，被
   colocated 测试锁死）与固定挂载点 `data-wb-chat-mode-pop-slot`。
   - 五档文案/描述逐字照抄原型（第 3 档弹层标题带"(默认)"、chip 短名不带）。
   - 第 5 档在弹层里选中时才切到警示色（同原型 `.lvl.warn.on` 的取舍，未选中只是普通行）；chip 本身
     只要当前档是第 5 档就直接是警示态（同原型 `.power.warn`）。
   - 「按能力细分」灰字照抄原型 `.gran`，但**渲染成纯文字、不给 cursor:pointer、不挂任何
     data-* 钩子**——这批范围不含真正的按能力粒度开关（`AiGranularSettings`），摆一个看起来能点
     却什么都不做的入口违反 04 §4 铁律 3。
   - 服务端下发说明行照抄原型 `.srv`（锁图标 + 加粗「服务端下发」+「桌面不保存任何 API key」）。
3. `apps/desktop-webview/src/workbench/css.ts`：新增 `.wh-wb-mode-*` 系列样式，复用既有
   `--ds-glass*/--ds-radius-*/--wb-cuu*/--ds-warn*/--ds-danger` token，没有写死不透明白底（深色
   `linear-gradient` 兜底同 `.wh-wb-chat-picker`/`.wh-wb-modal` 的既有做法一致）。reduced-motion
   覆盖追加为独立的 `@media` 块，没有改动既有那条被测试锁死的选择器列表。
4. `apps/desktop-webview/src/workbench/chat/view.ts`：
   - `isCollabConversation`（`input.conversationKind === 'collab'`）是整块功能唯一的读取点：composer
     chips 区只在协同会话渲染模式 chip，点击/数字键/PATCH 相关函数也都以它把关。
   - 挂载时（协同会话）调用 `fetchMyAiProfile` 取当前档；失败 `myMode` 保持 `undefined`，chip 显示
     「模式」而不是瞎猜一个默认档。
   - 点击 chip 开合弹层；点选项 = 乐观更新 `myMode` + 关弹层 + 后台 `patchMyAiMode`；失败回滚
     `myMode` 并在 composer 旁的 `data-wb-chat-mode-hint` 挂载点弹一句温和提示（不是阻断对话框）。
   - 弹层开着时文档级 `keydown` 监听数字键 1-5 快切、`Escape` 关闭；文档级 `click` 监听点外关闭
     （排除 chip 自身与弹层内部命中）。`dispose()` 里对称移除这两个文档监听器（`shell.ts` 的
     `mountChatView` 调用点确认了同一时刻只会挂载一个 `chat/view.ts` 实例，`disposeChat()` 总是先于
     下一次 `mountChatView` 调用，不会有多实例监听器打架的问题）。
   - `myMode === 1`（只观察档）时在 composer 旁给一行诚实预告「当前是只观察档，Cuu 不会回话」——
     跟 `turn.ts` 里已有的 409 `conversation_turn_mode_observe_only` 文案互补（一个是事前预告，一个
     是事后兜底），没有改动 `turn.ts`。

## 自查

```
pnpm --filter @workhub/desktop-webview test   # 611/611 通过（新增 22 个测试：589 → 611）
pnpm -r typecheck                             # 16/16 workspace 全绿，0 错误
git status                                    # 只有下列 7 个文件被改，均在范围内
```

改动文件清单：
- `apps/desktop-webview/src/workbench/chat/api.ts` / `api.test.ts`
- `apps/desktop-webview/src/workbench/chat/render.ts` / `render.test.ts`
- `apps/desktop-webview/src/workbench/chat/view.ts`（无直接单测——这个 workspace 的测试运行器没有
  真实 DOM，是既有事实，见 `view.test.ts` 顶部注释；纯逻辑已经在 `render.ts`/`api.ts` 里单测过）
- `apps/desktop-webview/src/workbench/css.ts` / `css.test.ts`

我改过的断言：无。唯一一次差点误改的是 `css.ts` 里既有的 `@media (prefers-reduced-motion:reduce)`
选择器列表——第一版实现把新选择器塞进了那条已被 `css.test.ts` 精确子串匹配锁死的字符串里，会让既有
测试失效；发现后撤回，改成新增一条独立的 `@media` 块，既有断言原样未动。

## 范围外发现（不修，只报）

- `ai-settings.ts` 的 `AiSettingsServiceError` 只有 403/404/422 三类，没有一个跟"切个人模式档"直接
  相关的错误码；PATCH 失败时前端只能给一句通用重试文案，不像 `turn.ts` 那样有逐 code 的专属文案表。
  不算 bug，只是现状——这批也没有新增专属错误码的授权。
- 模式弹层与 `@`/`#`/`/` 触发的 picker 没有做互斥（理论上用户先点开模式弹层、再输入 `@` 触发 mention
  picker，两个绝对定位的浮层可能视觉重叠）。这不在任务列表的四个要点里，为了不引入额外的、没有
  DOM 测试能覆盖的imperative 耦合逻辑，这批没有处理，留作可能的后续小修。

## 没做 / 存疑

- 真机视觉验收（桌面 vibrancy 玻璃质感、弹层实际定位是否遮挡右栏/溢出视口）需要人工在真实 `.app`
  里跑一遍——这个 workspace 的测试运行器没有真实 DOM/Tauri，浏览器 dev 预览也渲不出 vibrancy（仓库
  既有约束，见 04 §4 与多份历史报告）。
- 「按能力细分」灰字目前是纯说明文字，没有对应的真实交互（细分开关的 UI 是另一件事，`AiGranularSettings`
  已经在契约里但没有前端消费）。如果之后要做，需要新的任务/批次授权。
