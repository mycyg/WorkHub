# R13 批 V1 · 工作台固定浅色玻璃改版 · 完成汇报

分支：`r13/v1-light-glass`（从 `origin/main` 头 `94e331e7` 切出）。

## 背景

规划见 `r13-workbench-refinement/00-plan.md` 批 V1：工作台从深色玻璃改为**固定浅色玻璃**，与 Spotlight
聚焦盒同一视觉语言（用户拍板：固定浅色，不做跟随系统）。范围围栏：只动
`apps/desktop-webview/src/workbench/**`，不碰 Rust / spotlight / apps/api / packages。

## 做了什么

### 1. `apps/desktop-webview/src/workbench/css.ts`

- **删掉 `.wh-ds.wh-wb` 的深色 token 覆盖块**：原来这里重新定义了一整套 `--ds-ink/--ds-accent/
  --ds-success/--ds-warn/--ds-danger/--ds-glass*` 深色值，现在全部移除，级联自 `design-system.ts` 的
  浅色 `.wh-ds` 根。作用域内只保留 Cuu 品牌橙 `--wb-cuu:#ffab5e` / `--wb-cuu-soft`（按指示原样保留）。
  `--wb-bg0`/`--wb-bg1`（纯深色背景 token）已废弃删除，连同两条从未被任何标记引用的死代码
  `.wh-wb .ds-field{...}` 覆盖规则（design-system 自己的 `.ds-field` 已经是浅色适配的，删掉更干净）。
- **窗体外壳翻浅**：`.wh-wb-window` 背景从 `linear-gradient(180deg,rgba(30,34,46,.92),rgba(18,21,29,.94))`
  换成浅色薄透明兜底 `linear-gradient(180deg,rgba(250,251,253,.88),rgba(242,245,250,.92))`（真机上让
  vibrancy 透出来，浏览器降级也是浅色）；边框从 `rgba(255,255,255,.1)` 提到 `.7`（同 Spotlight 盒子的
  发丝高光描边取值）；投影从纯黑 `rgba(0,0,0,.5)` 换成 design-system 阴影色系 `rgba(60,60,67,.32)` +
  内高光。
- **不透明浮层统一翻浅**：新建项目模态（`.wh-wb-modal`）、模式五档弹层（`.wh-wb-mode-pop`）、@/#//
  picker（`.wh-wb-chat-picker`）——这三处原来都是深色 `linear-gradient(180deg,rgba(44,49,64,.97),
  rgba(28,32,43,.98))` 的不透明兜底（04 §4-2 铁律：透明 Tauri 窗里 backdrop-filter 是空操作，必须有真
  不透明兜底），现在统一换成浅色 `linear-gradient(180deg,rgba(255,255,255,.97/.98),rgba(248,250,253,
  .98/.99))`，投影同上换成 `rgba(60,60,67,...)` 系。模态遮罩层（`.wh-wb-modal-overlay`）保留深色
  scrim（弹窗遮罩通用惯例，跟壳体深浅无关），从 `rgba(5,7,12,.55)` 调淡到 `rgba(15,20,35,.3)`，避免在
  浅色壳体上显得突兀。
- **rail / 情境面板背景**：`rgba(0,0,0,.14)` 换成 design-system 的 `var(--ds-glass-quiet)`（浅色"退后
  一层"的既有 token，不发明新值）。
- **hover/active 白色半透翻深色半透**：`.wh-wb-winbtn:hover`（`rgba(255,255,255,.08)` →
  `rgba(20,30,50,.06)`）、`.wh-wb-project-row:hover`（`.05` 同色系）、`.wh-wb-chat-picker-row:hover`、
  `.wh-wb-mode-lvl:hover` 同样从白色半透（浅底不可见）换成深色半透。`.wh-wb-winbtn--close:hover` 原来
  写死 `rgba(255,122,136,.16)`，改用 `var(--ds-danger-soft)` token。
- **强调色/危险色/警示色的写死 RGB 三元组批量对齐**：原来一批边框/悬浮色是手写的 RGB 三元组，恰好对应
  旧深色 accent `#7aa2ff`(→`122,162,255`)/danger `#ff7a88`(→`255,122,136`)/warn `#f6c66b`(→
  `246,198,107`) 的色相。现在 token 已还原成 design-system 的浅色 accent `#0a84ff`(→`10,132,255`)/
  danger `#ff453a`(→`255,69,58`)/warn `#ff9f0a`(→`255,159,10`)，把这批写死三元组逐个对齐到新色相
  （leaf 选中态边框、文件卡/网盘上传/回滚按钮 hover 边框、发送失败提示框边框、模式档警示态边框等
  ~15 处）——不是发明新色，是让写死值追上 token 已经变了的事实。
- **按钮主色**：`.wh-wb-btn--primary` 和圆形发送按钮 `.wh-wb-chat-send` 原来是「浅蓝渐变配深字」（
  `#7aa2ff→#9db8ff` 配 `#0b0d12`，深色主题下的正确搭配），现在照 design-system 自己的
  `.ds-btn-primary` 惯例换成「主蓝渐变配白字」（`#0a84ff→#64d2ff` 配 `#fff`），并复用
  `var(--ds-shadow-glow)` token。
- **交互文字对比度**：`--ds-accent-2`（浅青色，深色底上够亮，浅色底上前景文字对比不足）原本用在四处
  真正要读的可交互文字——@提及高亮、发送失败重试链接、长文本展开/收起链接、composer chip 里的
  `@`/`#`/`/` 加粗字母——全部换成 `var(--ds-accent)`（design-system 自己给"高亮/可点文字"用的主蓝
  token，不是新发明颜色）。
- **头像堆叠描边**：`.wh-wb-chat-avatar` 的重叠描边原来引用已废弃的 `var(--wb-bg1)`（深色页面底色，
  用来做"切出来"的轮廓感），现在换成 `#fff`（新窗体底色本就是近白的浅色玻璃，白色描边同样能做出
  轮廓感，且不是新发明颜色——是页面背景色的自然延伸）。

### 2. 顺手修的一个既有 CSS 语法 bug

`.wh-wb-chat-actioncard` / `.wh-wb-chat-actioncard--deliverable` 那一段（批 4b 遗留）此前是错位的字符串
拼接：`.wh-wb-chat-actioncard{...` 那条规则少了闭合 `}`，导致 join 之后
`.wh-wb-chat-actioncard--deliverable{...}` 整段被当成前一条规则声明体里的垃圾内容（花括号仍然配平，
但选择器语义全错，产出卡的背景色实际上从未生效）。既然我必须逐条核对这个区块的颜色值，顺手按上下文
（其余属性完全对应）拆回四条独立、闭合正确的规则：
`.wh-wb-chat-actioncard` / `.wh-wb-chat-actioncard--deliverable` /
`.wh-wb-chat-actioncard--deliverable .wh-wb-chat-actioncard-h` / `.wh-wb-chat-actioncard-h`。
修完用 `npx tsx` 实际 import 出 `workbenchCss` 字符串核对花括号配平（252 开 / 252 闭）且
`.wh-wb-chat-actioncard{...}` 现在正确闭合。这是范围内文件的既有缺陷，不是本批引入的。

### 3. `apps/desktop-webview/src/workbench/css.test.ts`

三条钉点测试同步改成浅色断言（04 §4 铁律 1 允许的"预批行为性样式变更"，理由如下）：

- `does not rely on CSS backdrop-filter alone...`：正则从匹配深色 `rgba(30,34,46,.92)` 改成浅色
  `rgba(250,251,253,.88)`。
- `dark theme tokens are scoped under .wh-ds.wh-wb...` → 改写成
  `only the Cuu brand color is scoped under .wh-ds.wh-wb...`：断言 `.wh-ds.wh-wb` 只定义 `--wb-cuu`，
  不再重新定义任何 `--ds-ink`，且 `--wb-bg0`/`--wb-bg1` 已彻底不存在。
- `the mode popover has an opaque-enough gradient fallback background...`：正则从深色 `rgba(44,49,64,
  .97)` 改成浅色 `rgba(255,255,255,.97)`。

其余测试（titlebar drag region / 侧栏收放 / emoji 禁用 / chat 布局 / composer tag / reduced-motion /
mode chip warn token / mode gran 非按钮 / mode hint danger token）逻辑未变，原样通过。

## 没动的地方（按范围围栏 + 指示）

- `chat/render.ts` 的 `avatarTileHtml`：`hsl(hue,55%,42%)` 深色头像块 + 白字保留不变——深色块配白字
  在浅色系里依然成立，已核对（该函数本身不在本批"翻浅"清单里，只是任务里点名核对过）。
- Rust / `window_controls.rs` 的 vibrancy material：不碰，交给集成者换成浅色 vibrancy。
- `spotlight/**`：完全没碰，它本来就是本批的浅色基准。

## 自查

```
pnpm --filter @workhub/desktop-webview test   → 652 pass / 0 fail
pnpm -r typecheck                              → 16/17 workspace 全绿（0 错，第 17 个是没有
                                                  typecheck 脚本的包，非本批改动）
git status                                     → 只有 css.ts / css.test.ts 两个文件，干净
```

## 我改过的断言

见上面「§3」——3 条钉点测试的正则从深色字面量改成浅色字面量，理由是本批就是要把这些字面量从深改浅
（预批授权的行为性变更），没有为了迁就实现而放松任何断言的"强度"（仍然是精确字面量匹配，只是换了
要匹配的颜色）。

## 范围外发现（不修，只报）

- 见下方"需真机核对清单"——凡是"看起来可能对比度不够/层次不够"的地方，我都选择在报告里列出来
  交给真机截图判断，没有自己发明新色值去"感觉修好"它们，因为设计取舍应该由能看见真实渲染效果的人来定。

## 需真机核对清单（我在纯文本层面验证不了这些）

1. **Cuu 橙 `--wb-cuu:#ffab5e` 作为文字/图标前景色的对比度**（按指示原样保留，未改动数值）：
   - `.wh-wb-tile--cuu`（rail 项目图标）、`.wh-wb-army-sum svg`（军团总览图标）、
     `.wh-wb-chat-avatar--cuu`（Cuu 头像）、`.wh-wb-chat-empty-icon`（空态猫图标）、
     `.wh-wb-mode-chip-lv`（模式 chip 上的档位文字，非警示态时）——这橙色在浅色玻璃底上算出来的
     WCAG 对比度大约只有 ~1.9:1（远低于正文 4.5:1/大字体 3:1 的门槛）。图标类的影响相对较小，但
     `.wh-wb-mode-chip-lv` 是一段真正要读的短文字（如"分级自动"），真机看一眼判断是否需要请集成者
     决定要不要单独出一档「浅色模式下更深的 Cuu 橙」token（我没有擅自发明这个值）。
   - 类似地 `.wh-wb-chat-msg--cuu .wh-wb-chat-txt` / `.wh-wb-tile--cuu` 的 `background:var(--wb-cuu-soft)`
     背景本身没问题（正文用 `var(--ds-ink)` 深字），只有上面列的"橙色本身当前景字/图标色"这几处需要看。

2. **玻璃气泡/卡片在浅色窗底上的层次感**：`.wh-wb-chat-txt`（其它成员消息气泡）、
   `.wh-wb-chat-filecard`、`.wh-wb-chat-attachment-chip`、`.wh-wb-chat-cbox`（composer 输入框）、
   `.wh-wb-drive-row:hover` 等大量沿用 `var(--ds-glass)`/`var(--ds-glass-strong)`（半透明白）作背景，
   现在坐在同样偏白的窗体渐变上——文本层面这是"跟 Spotlight 同一套 token"的正确做法，但白上白的
   实际视觉区分度需要真机看一眼，尤其是"其它成员"消息气泡（自己/Cuu 的气泡有独立色调,不受此影响）。
   如果区分度不够，可能需要给这几个"读者最常盯着看"的气泡单独找一个比 `--ds-glass` 略深的 token
   （design-system 目前没有现成的"中等强度"token 介于 `ds-glass` 和 `ds-glass-strong` 之间）。

3. **多处 hover 态仍用 `var(--ds-glass-strong)` 做纯背景色反馈**（如 `.wh-wb-leaf--live:hover`、
   `.wh-wb-chat-ctag:hover`、`.wh-wb-act:hover`、`.wh-wb-drive-upload-label` 默认态背景）：这些是
   token 驱动、按指示"不发明新色值"的选择，但在真正不透明的浅色面板上可能偏弱。留意到 Spotlight 自己
   的可点行/卡片（`.wh-spot-cap:hover`/`a.wh-spot-row:hover`）走的是「背景保持 transparent，纯靠
   `transform:translateY(-1px)` + `box-shadow` 提升做反馈」的模式，跟工作台现有的"背景色变化"套路不是
   完全一样。本批没有把这类交互模式改成 Spotlight 的 lift+shadow 套路（那已经超出"翻色值"范围，是
   交互设计改动），如果真机看下来 hover 反馈不够明显，这是一个可以对齐 Spotlight 做法的候选项，
   留给集成者判断要不要在后续批次动。

4. **模态遮罩 scrim 深浅**（`.wh-wb-modal-overlay` 从 `rgba(5,7,12,.55)` 调到 `rgba(15,20,35,.3)`）：
   这是我按"浅色壳体上深色 scrim 别太重"的直觉调的一个具体数值，不是从某个既有 token 机械推导出来的，
   建议真机看一眼新建项目模态弹出时的观感是否合适。

## 提交

targeted add（只加 `css.ts` / `css.test.ts`），commit message 按仓库惯例 `feat(desktop-webview): ...`。
未合并 main，未 push。
