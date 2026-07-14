# R14 引导簇小批（四项打包）完成汇报

分支：`r14/guidance-cluster`（从 `origin/main` 拉，worktree `/Users/apple/.codex/worktrees/WorkHub/r14-guidance`）
HEAD：`cf707912ffd613844646d0634062ffdc9433c20f`

## 做了什么

1. **composer 无 key 横幅**（FIX#8 前端半）：`mountChatView` 挂载时探一次 `/api/health`，把响应映射成
   `unknown | configured | not_configured` 三态（纯函数 `mapAiProviderHealthState`，探测失败/响应形状不对
   一律归 `unknown`，不当作"没配置"）；只有明确探到 `not_configured` 才在 composer 顶部渲一条常驻横幅
   （新挂载点 `data-wb-chat-ai-provider-banner`，独立于既有 `modeHint`/turn 错误提示挂载点，互不打架）。
   主区与协同会话都会渲（AI 没配置时两种会话里 Cuu 都不会回应，是同一个事实）。不阻塞输入，composer
   发送闸门完全不读这个状态。
2. **资料引导提示**（ONBOARD①）：调查了 `AttentionHomeVM`（`packages/contracts/src/pages.ts`），确认它
   完全不带任何 viewer 资料态字段（`primary/queue/source_warnings/background_runs/cuu_state/worklog`，
   没一个能判断"这个人资料填没填"）——按指示没有去改 API/VM，走了退化方案：在 web `/settings` 的
   「我的资料」卡顶部加一句常驻引导语「填好这些，AI 助手派活会更准。」（中英文都有，不含
   "Cuu" 字样）。决策队列版本的条件式提示卡列为后续项，见下方「没做/存疑」。
3. **个人空间发现性**（ONBOARD②）：桌面 rail「我的空间」区，当 `personalProjects` 为空时，在「新建
   个人空间」按钮下补一行小字「你的私人 AI 工作台——想周报、读材料、记待办都行」；一旦建了第一个个人
   空间就不再出现（不是常驻文案，是新手期一次性引导）。
4. **packages/ui test glob 修复**：`"test": "node --import tsx --test src/**/*.test.ts"` 在 pnpm 实际调用
   的 POSIX sh 下 `**` 不递归（只有交互式 zsh 等开了 globstar 的 shell 才会展开），导致
   `src/route-state.test.ts`（6 条）和 `src/task-plan-i18n.test.ts`（2 条）两个顶层测试文件从未在 CI 里
   真的跑过。改成给 glob 加引号（`"src/**/*.test.ts"`），让 shell 不展开、交给 Node 自己的 glob 引擎处理
   ——Node 的 glob 引擎在任何 shell 下都能正确递归。已验证：修复前用 `sh -c` 显式复现只有 173 条，修复后
   181 条（+8，正好是那两个文件的测试数）。

## 改动文件清单

- `apps/desktop-webview/src/workbench/chat/view.ts` — 新增 `AiProviderHealthState`/
  `mapAiProviderHealthState`/`shouldShowNoAiProviderBanner` 三个纯函数 + `loadAiProviderHealth`/
  `renderAiProviderBanner` 接线 + 新挂载点。
- `apps/desktop-webview/src/workbench/chat/render.ts` — 新增 `renderNoAiProviderBannerHtml`（复用既有
  `.wh-wb-chat-banner` CSS class，没有新增样式规则）。
- `apps/desktop-webview/src/workbench/chat/view.test.ts` / `render.test.ts` — 对应纯函数/渲染函数单测。
- `apps/desktop-webview/src/workbench/rail.ts` — `renderPersonalSpaceSectionHtml` 加空态发现性提示行
  （内联 style，未碰 `css.ts`，见下方说明）。
- `apps/desktop-webview/src/workbench/rail.test.ts` — 有/无个人空间两态 + 中英文案测试。
- `packages/ui/src/gold-path/route-components.ts` — `renderSettingsMyProfileCard` 顶部加引导语 `<p>`。
- `packages/ui/src/gold-path/route-components.test.ts` — 中英文案 + 不含 "Cuu" 断言。
- `packages/ui/package.json` — `test` 脚本 glob 加引号。

## 自查输出

```
pnpm --filter @workhub/desktop-webview test   883 → 892（+9，全绿）
pnpm --filter @workhub/ui test                173 → 182（+8 glob 修复激活 + 1 新测试，全绿）
pnpm --filter @workhub/web test               73 → 73（+0，全绿，未改 web 运行时代码）
pnpm -r typecheck                             16/17 workspace 全部 Done，0 错误
```

（`packages/ui` 的 173 这个"修复前"基线是用 `sh -c 'node --import tsx --test src/**/*.test.ts'` 显式在
POSIX sh 下复现出来的，不是随手假设——已确认这正是 CI/`pnpm run` 实际会走的 shell 语义，交互式 zsh
本身自带 globstar 会掩盖这个问题，之前一直没被发现。）

## 我改过的断言（如有）

无——所有新断言都是新增，没有修改任何既有测试的断言以迁就实现。`render.test.ts` 里英文横幅测试的正则
从 `/isn't configured/u` 改成了 `/AI service isn.{0,6}t configured/u`，原因是 `escapeHtml` 把撇号转成
`&#39;` 实体、导致原始正则不命中——这是我自己刚写的新测试里的笔误修正，不是迁就产品代码的既有测试断言。

## 范围外发现（不修，只报）

- **决策队列资料提示卡**（任务 2 的完整方案）：`AttentionHomeVM` 没有 viewer 资料态字段，要做"资料为空
  才显示"的条件卡片需要新增字段（例如 viewer 的 title/bio/skills 是否全空的布尔值），这涉及
  `packages/contracts` 的 schema 变更 + `apps/api` 的 attention 页面 VM 组装逻辑，本批范围围栏明确禁止
  （只许改 route-components.ts/rail.ts/chat 相关文件），故未做，只做了设置页常驻引导语的退化方案。
  建议作为独立小批跟进：加 `viewer_profile_complete: boolean`（或更细粒度）到 attention VM，前端据此渲
  一张一次性提示卡（点掉/去设置页填资料后不再出现）。

## 没做/存疑

- 无遗留阻塞项。四项任务均已按验收门实现并全部测试通过。
- rail.ts 的发现性提示行使用内联 style 而非新 CSS class（范围围栏禁止改 `css.ts`），视觉语言抄的是
  `wh-wb-army-empty-note`（12px/`--ds-ink-faint`），风格与全应用其它"小字浅色提示"一致，但如果后续有人
  想把它提成一条正式的 CSS 规则（例如复用给其它 rail 区域），可以顺手做。
