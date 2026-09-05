# R24-D 工作台聊天头部视觉打磨：会话页签条 / 成员条 / 空态

- Status: implemented
- Date: 2026-09-05
- Owner: claude（r24/d-workbench-chat-header-polish 工位）

## Problem

用户对着桌面工作台「项目主群聊」顶部这一屏的截图说「好丑」，三条具体现象：

1. 会话页签条：激活页签是一枚厚重灰药丸，关闭 x 是漂在页签右侧、错位的另一个小灰块，
   再加一根蓝色下划线——三个元素互相打架，像三个不同组件拼在一起。
2. 成员行「1 member + Cuu · everyone」：头像组与文字的对齐/间距粗糙，整行像临时占位。
3. 空态：图标/标题/说明居中，但与上面两层的层级关系松散，三层各自为政。

根因不是「审美偏好」而是三处可指认的实现事实：`.wh-wb-sess-open` / `.wh-wb-sess-close`
两个 `<button>` 从未复位浏览器默认按钮外观（灰底 + 边框 + 圆角就是那两个「小灰块」），
而页签容器又自带玻璃底色 + `inset 0 -2px` 下划线；`.wh-wb-chat-head` 的 `border-bottom`
画在只有内容那么宽的元素上，于是分隔线在成员条中途就断了；`.wh-wb-chat-empty` 用
`margin:10vh auto 0`，10vh 量的是**整个窗口**高度而不是聊天区。

## Decision

**页签激活态：底部 2px 强调线，不是浅底色胶囊。** 二选一里选下划线，因为条底本来就有一根
hairline，激活线是「同一根线在这一段加粗」，比再叠一层玻璃底色更克制；`::after` 用
`bottom:-1px` 盖住那根 hairline，读起来是这段线属于这条页签。相应地
`.wh-wb-sess-tab.is-active` 的 `background` 与 `box-shadow` 全部删掉，并写了
`doesNotMatch` 测试锁死「激活态只有一件事」。

**关闭 x 的显现规则：`opacity:0` + `pointer-events:none`，hover / 激活 / `:focus-visible`
三种情况显现，且始终占位。** 三点取舍：
- 用 opacity 而不是 `display:none`——出现时不推挤文字，页签宽度不跳。
- 一起关掉 `pointer-events`，避免留下「看不见但能点」的隐形陷阱（04 §4 铁律的反面同样成立）。
- 激活页签的 x 常驻可见：当前这条是最可能被关掉的一条，鼠标不必先悬停才发现关得掉。
  非激活页签保持隐形，整条 strip 才安静。
- `:focus-visible` 进同一条选择器 → 纯键盘用户 Tab 到那个按钮时它会现形（真实渲染里
  按 Tab 验证过：`matches(':focus-visible')` 为真、opacity 1、accent 聚焦环）。因为它平时
  隐形，关闭按钮的无障碍名字改成带会话名的「关闭「Ops Pilot」」——读屏里一串同名的「关闭」
  等于没说。会话名是用户输入，进属性同样 `escapeHtml`（补了注入回归测试）。

**没有加 `role="tablist"/"tab"/"tabpanel"`。** 这一层没有可关联的 panel id，半套 ARIA 比
现状（每条 `aria-current` + 原生 button 可 Tab/Enter）更糟；方向键循环也没有既有实现，
按工单口径「若已有」不新增行为。已有的 Cmd/Ctrl+W 关当前、Cmd/Ctrl+1..9 切第 N 条一字未动。

**成员条「+ Cuu」由文字改为头像 tile 承担。** 她的 tile 本来就排在头像组末尾，文案再拼
一次「+ Cuu」是同一件事说两遍、还把这行挤长；改为给 cuu tile 加 `role="img"` +
`aria-label`/`title` «Cuu»，信息不丢。三处旧断言（`2 位成员 \+ Cuu` 等）同步改成新文案 +
新增「cuu tile 带 aria-label」的断言。

**头像堆叠顺序改成靠前的压在后一枚之上**（`nth-child` 逐位写死 z-index，最多 6 位成员 +
Cuu 共 7 枚，不需要运行时算）——默认的后压前会让首位成员的中文首字被下一枚 tile 的白描边
切掉一角，这正是「像临时占位」的一半来源。

**分隔线挪到 `[data-wb-chat-head]:not(:empty)`。** 用 `:not(:empty)` 而不是给外壳无条件加边框，
是为了退群终态——那时 `headEl.innerHTML = ""`，不该在聊天区顶上留一根孤零零的线。

**空态改成 `min-height:100%` + flex 居中的一组。** 不改 `.wh-wb-chat-scroll` 的 display
（那是消息列表的容器，改成 flex 会牵动正常聊天布局）；百分比万一解析不了也只是回落成顶对齐，
不会塌。猫图标进品牌橙圆底 tile 让图标/标题/说明收成一组；共用同一套类的「无权限」空态
（锁图标）沿用中性灰底，橙色的锁会被读成 Cuu 的东西。

## Alternatives considered

- **激活态用浅底色胶囊**（另一个候选）——否决：中栏顶上已经有 rail/情境面板两片玻璃，再加
  一枚胶囊底色会让这条 strip 重新变「厚」；下划线是这一屏里唯一需要的强调。
- **关闭 x 只在 hover 时出现（激活页签也隐藏）**——否决：桌面端最常见的动作是关掉当前这条，
  让它必须先悬停才发现是多一步。
- **保留「+ Cuu」文字、只调间距**——否决：工单明确要求用头像 tile 承担；而且这行同时出现
  猫头像和「+ Cuu」三个字本来就是重复。
- **把 `.wh-wb-chat-avatar` 的直径/描边一起加大**——否决：这个 tile 类被 roster / DM 行 /
  建群选人器 / 资料卡共用，改尺寸会外溢到本工单范围之外的四处界面。
- **给成员条「成员」「加人」两枚 pill 一起调字号**——未做：它们是次级入口，11px 胶囊与 13px
  正文并置在真实渲染里读得清，属于工单没点名的范围。

## Consequences

- `.wh-wb-chat-head` 不再自带 `border-bottom`；未来若有新的会话头形态挂到
  `[data-wb-chat-head]` 之外的地方，需要自己补分隔线。
- `.wh-wb-chat-empty-icon` 现在默认中性灰底，Cuu 语境要显式加 `--cuu` 修饰类；新增空态
  直接复用这两个类即可，不要再各写一套图标底色。
- `.wh-wb-chat-avs` 的 `padding-right:6px` 与 nth-child z-index 是这一组头像的专属约定；
  其它复用 `.wh-wb-chat-avatar` 的行（roster/dm）本来就把 `-6px` 负边距抵成 0，不受影响。
- 页签关闭按钮的 `aria-label` 文案从常量变成按会话名拼装——依赖固定字符串「关闭」定位这个
  按钮的测试/QA 脚本需要改用 `data-wb-tab-close` 钩子（仓库内现有调用点已全部走 data 钩子）。
- 真实渲染验证走的是「真 CSS（`renderWorkbenchDocumentHead`）+ 真渲染函数 + vite dev +
  headless Chrome CDP 截图」的临时工装页，未起 PG/API：这一屏的三个渲染函数都是纯字符串
  函数，工装页与生产走的是同一份 CSS 和同一份 HTML。未在真 Tauri 窗口（原生 vibrancy）下
  复核，与既有 desktop-webview 的验证口径一致。
