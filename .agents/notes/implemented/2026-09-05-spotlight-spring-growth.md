# 聚焦盒「灵动生长」：锚点稳定 + 逐帧补间

- Status: implemented
- Date: 2026-09-05
- Owner: Claude（R25 桌面端聚焦盒批）

## Problem

两条独立记录的缺口，根因都落在同一层「壳层怎么改窗口尺寸」：

**M-02（R24 S3 走查）聚焦盒一路往下漂。** 实测同一会话里顶边 Y 从 133 → 756 → 356 → 172。
根因是 `set_size` 在 macOS 上落到 AppKit 的 `setContentSize:`，它保持的是 **frame.origin（左下角）**：
盒子从 671 高收成 48 时顶边就往下掉 623（133 + 623 = 756，实测数字对得上）。也就是每次展开/收起
都以底边为锚点重排，几轮交互后「苹果聚焦盒」跑到屏幕中下部。原有的 `keep_window_bottom_in_work_area`
只在底边捅出工作区时救一把，救的方向也是往上——它治的是"够不着"，从来不治漂移。

**BX-06（R24 S4 健康清单，即 R8 apple-feel 复审的 M1/L4）resize 仍是硬跳变。** 自 2026-06 承诺的
「盒子 spring 生长」从未兑现：webview 量高 → `resizeDesktopMainWindow` → `set_spotlight_size` →
一次 `set_size`，一帧到位的矩形跳变。

## Decision

算术全部收进 `client-tauri/src-tauri/src/spotlight_window.rs`（不碰任何 tauri 类型，`cargo test`
在无窗口系统的 CI 上全覆盖，18 个单测）；`main.rs` 只留副作用编排。

### 1. 锚点规则（M-02）

锚点 = **顶边 + 水平中心**，即 macOS 聚焦搜索不动的那两条；生长/收缩只让底边伸缩。

- **每帧显式摆位置**，不去猜平台的锚定语义：`apply_spotlight_frame` 先 `set_size` 再 `set_position`。
  顺序不能反——改完尺寸顶边会先掉下去，紧跟的 `set_position` 把它摆回锚点；两条消息在同一轮事件
  循环里处理，看不到中间态。反过来（先摆位置再改尺寸）就是 M-02 那个老 bug 本身。
- **水平**：`x = center_x - width/2`，再夹进工作区（盒子比工作区还宽时贴左缘）。
- **垂直**：`top` 不动。**只有底边顶出工作区时才向上让位**，而且让位只改这一帧的落点、**不回写锚点**。
  这一条是关键：否则「长高一次就把顶边往上偷一点」会累积成另一种漂移，只是方向相反。
- **让位怎么与"用户拖窗口"区分**：`SpotlightAnchor.applied` 记着壳层上一次亲手摆下去的左上角。
  下一次调用拿窗口的真实位置与它对账（`reconcile_spotlight_anchor`，容差 1.5 逻辑像素，覆盖
  Retina/非 Retina 的物理↔逻辑取整抖动）：
  - 还停在我们摆的地方 → 沿用记住的锚点（含让位之前的原始顶边，所以收缩回去自然回到记住的顶边）；
  - 位置对不上（原生拖动 / `move_main_window_by` / 首次调用 / 记账丢失）→ 以窗口当前位置重记锚点。
    用户把盒子拖到哪，那就是新的偏好。
- **多显示器**：工作区取窗口 `current_monitor()`（拿不到退 `primary_monitor()`）的 `work_area()`
  转逻辑坐标。副屏原点非零时夹紧照常成立（有单测：锚点还停在主屏中线 → 盒子夹回副屏左缘而不是横跨
  两屏）。**两个显示器都拿不到时不夹紧**——宁可原样摆，也不要瞎猜一个显示器把窗口拽走。
  补间开跑前量一次工作区就够：180ms 内窗口不会换显示器，每帧再问一次要多 12 次跨线程往返。
- **隐藏/再显示**：`spotlight_show_anchor` = **记住的顶边 + 屏幕水平居中**。顶边保留是因为"盒子停在
  哪个高度"是用户偏好；水平回中线是因为聚焦盒的心智模型就是"屏幕中间那条"，而且横向漂移比纵向更
  容易把盒子推到副屏边缘。从没摆过（顶边非有限）时回落到工作区高度的 10%（`default_spotlight_top`，
  与启动落点同一处真相）。挂在 `execute_window_control` 里——托盘「打开 WorkHub」/ Option+Space /
  Dock 点击 / 深链所有唤起路径都在那儿汇合，不另造第二套窗口控制路；只在这次控制真的把窗口
  **亮出来**时才摆（`became_visible`），单纯的 Hide/Focus 不动位置（Focus 常发生在窗口本来就在
  用户放的地方时）。
- 启动落点（`position_main_window_top_center`）种进锚点记账，第一次生长就有顶边可守。

### 2. 曲线与时长（BX-06）

- **180ms / 每帧 16ms（12 帧）**。低于 ~140ms 眼睛读不出"生长"、只觉得闪了一下；高于 ~220ms 在每
  敲一个键就可能重排的搜索框里会拖泥带水（用户输入比动画快，下一帧目标就来了）。16ms 对齐 60Hz；
  ProMotion 上只是多丢几帧，不会更抖。
- **ease-out cubic，刻意不用带回弹的弹簧**。窗口高度过冲意味着盒子比内容高，在透明窗里那几帧就是
  一截空玻璃（内容还没那么长），而且过冲会顶出工作区触发让位。生长要的是"迅速铺开再稳住"。
- **末帧精确等于目标**，不留亚像素残差（帧序列由 `spotlight_growth_frames` 生成，`step == steps`
  时直接取 `to`）。
- **直落（不补间）的三种情况**：系统「减弱动态效果」、高度差 < 4px（肉眼看不见，却要多 12 次
  `set_size`）、数值非有限。
- **新目标到来从当前中间值重新起跑**：`SpotlightGeometry.generation`（AtomicU64）每次
  `set_spotlight_size` 自增；补间线程每帧比对代际，不符即退场。新的一次调用读的是窗口**此刻**的
  高度（中间值），曲线从那里重新算——旧线程不会把窗口拽回它那条旧曲线。
- 补间跑在独立线程（命令立刻返回，webview 的 invoke 不必等 180ms）；`set_size`/`set_position` 从
  任意线程调用都由 tauri 的事件循环代理转投主线程。

### 3. reduced-motion 从哪来

由 webview 递：`applyResize` 每次量高现问一遍 `matchMedia("(prefers-reduced-motion: reduce)")`，
经 `resize(width, height, reducedMotion)` → `set_spotlight_size` 的 `reduced_motion` 参数。
WKWebView 的这条媒体查询直接映射 macOS 的「减弱动态效果」，壳层不必为此多挂一个 AppKit 依赖
（NSWorkspace 的 `accessibilityDisplayShouldReduceMotion` 要多引一个 objc2-app-kit feature）。
每次现问而不是启动缓存：用户在系统设置里改完立刻生效，也不必挂 change 监听。
参数是 `Option<bool>`，缺席按"照常补间"处理，老调用点（`desktop-boot-screen-fit.ts` 的 boot 屏）
不必逐个改。

### 4. webview 侧：盒子跟住窗口 + 内容淡入

- `.wh-spot` 加 `max-height:100vh`。DOM 里的盒子在第一帧就已经是目标高度，补间途中它比透明窗高，
  圆角底边与边框落在窗口外——屏幕上是一条**直角断口在往下爬**。钳到 100vh（＝当前这一帧的窗口高）
  后盒子与窗口同高，圆角始终完整，内容由 `.wh-spot-body` 的 overflow 收着，观感就是"盒子在长"。
- `applyResize` 量高前把这条 100vh 临时摘成 `none`（与既有的 `body.style.maxHeight` 同款手法），
  量完还给 CSS。不摘的话测出来的自然高被窗口反向钳住，盒子再也长不回内容的真实高度。
- 内容淡入挂在 `.wh-spot-grid`（每次重渲都是新节点，CSS 动画天然重放）而不是常驻的 `.wh-spot-body`
  （动画只会在挂载时跑一次）。时长 `--ds-dur-fast`(140ms) 短于壳层的 180ms：淡入先收尾、生长后收尾，
  读起来是"内容先到、盒子跟上"。顺序本来就是**先渲内容 → 量高 → 请求生长**，所以不存在"先空白
  再长出"；淡入只是让内容不在窗口还在长的时候硬生生弹出来。减弱动态效果由 design-system.ts 既有的
  `.wh-ds *{animation-duration:1ms!important}` 统一压平，不再单独写一条。

### 5. 与 lastSent 去重的关系

`applyResize` 的 `lastSentW/lastSentH` 去重（原 M1，防 `set_size → resize 事件 → requestResize →
set_size` 抖动）在补间下依然成立，而且**中间尺寸不会回写 lastSent**：量高只看内容（`box`/`body`
的 maxHeight 在量之前都被摘成 `none`，`screenMax` 取 `screen.availHeight` 而非窗口高），所以补间
途中每一帧回弹的 resize 事件算出的 `winH` 与目标一致，在去重那一行就返回了。`lastSent` 记的因此
始终是**目标**尺寸。

## Alternatives considered

- **让壳层自己问 macOS 要 reduced-motion**（NSWorkspace）：要多引一个 objc2-app-kit feature，而
  WKWebView 的媒体查询已经是同一个系统开关的直连映射。不值。
- **用弹簧曲线（带回弹）**：见上，过冲＝空玻璃 + 触发底边让位。聚焦盒不是卡片，回弹不服务任何信息。
- **只在 `set_size` 之后补一次 `set_position`（不逐帧）**：能修 M-02 但修不了 BX-06，且中间那一帧的
  跳变正是用户抱怨的东西。
- **改用平台的 `set_size_with_anchor` 之类的 API**：tauri/tao 没有这层抽象；去猜 AppKit 的锚定语义
  本身就是 M-02 的成因。显式摆位置是唯一可移植、可单测的解。
- **在 webview 侧用 CSS transition 做生长，窗口一步到位**：透明窗里窗口先长到目标，盒子还小 →
  盒子周围一圈"透明但会吃点击"的空窗，且窗口阴影/圆角是原生画的，会先于内容出现。观感更差。
- **保留 `keep_window_bottom_in_work_area`**：它的职责（底边不越界）已被
  `anchored_spotlight_position` 的工作区夹紧完全覆盖，留着就是第二个会改窗口位置的地方，
  与锚点记账打架。删除。

## Consequences

- **`set_spotlight_size` 从此拥有窗口位置**：任何别处再去改主窗位置都必须同步锚点记账
  （`remember_spotlight_placement`），否则下一次生长会把窗口摆回锚点、看起来像"位置被吞了"。
  `move_main_window_by`（手工拖动）**刻意不写 applied**——它就是要让下一次对账判定"被拖走了"从而重记锚点。
- 每次生长会 spawn 一个短命线程（≤180ms）。用户快速输入时可能并存几个，但被代际立刻作废、下一帧
  就退场；真正会连发的场景（每敲一键重排）在 webview 侧已被 lastSent 去重挡住了。
- 补间期间窗口尺寸每 16ms 变一次，webview 会收到同频的 `resize` 事件。目前它们全部落在去重里，
  但**任何未来改动只要让 `applyResize` 的量高依赖窗口高度**（例如给 `.wh-spot-body` 的 max-height
  换成依赖 `100vh` 的表达式而不在量高前摘掉），就会立刻变成"补间与量高互相追着跑"的抖动。
  `.wh-spot` 的 `max-height:100vh` 与 `applyResize` 里那两行"量前摘 none"是绑定的，改一处必须改另一处。
- 单测覆盖锚点/曲线的算术；「先 set_size 再 set_position 看不到中间态」「12 帧在真机上读起来是生长
  而不是跳变」这两条只能靠真机验证（本批已做：Option+Space × 5 轮坐标不漂 + 生长连拍）。

## 真机验证（2026-09-05，本机 macOS，release 包，无后端）

坐标全部来自 `CGWindowListCopyWindowInfo`（并与 `System Events` 的 `position of window 1` 逐相位对账）。

- **锚点不漂**：两轮各 5 次交互循环、共 35 个相位样本，主窗左上角**恒为 (504, 133)**，
  期间高度在 48 / 128 / 168 / 252 / 671 之间来回。其中「全网格 671 → idle 细条 48，窗口全程可见」
  正是 M-02 的原始复现——修复前这一收缩会把顶边从 133 推到 756。
- **生长是补间不是跳变**（4ms 轮询、只记变化）：
  `128 → 253 → 357 → 442 → 511 → 564 → 604 → 632 → 663 → 669 → 671`，
  步长 125/104/85/69/53/40/28/31/6/2 逐级收窄（ease-out 形状），末帧精确落在 671。
- **新目标从中间值重新起跑**：同一次采样窗口里抓到上行 `252→…→665` 走到一半时点了盒外，
  下行从 **665**（不是目标 671）起跑：`665→524→406→309→231→171→126→93→71→58→51→49→48`，
  末帧精确落到 48。
- 生长过程每 30ms 连拍 8 帧，中间态可见盒子逐级长高、圆角底边始终完整（`max-height:100vh` 生效），
  内容随 `ds-fade-in` 淡入。证据（坐标表 + 截图）在 `scratchpad/spotlight-growth/`。
- 未在真机上覆盖：手工把盒子拖到别处后再隐藏/显示（应回到「拖后的顶边 + 屏幕水平居中」）——
  这条只有纯函数单测覆盖（`dragging_the_window_reseats_the_anchor` +
  `showing_again_keeps_the_remembered_top_and_recentres_horizontally`）。
