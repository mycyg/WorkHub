# R14 修复批 D · 聚焦盒（Spotlight）视觉验收缺陷 · 完成汇报

分支：`r14fix/spotlight-glass`（从 main `9d362c72` 切出）。

## 背景

用户真机反馈两个聚焦盒视觉问题（工作台窗本身 OK，只有聚焦盒/main 窗有问题）：

1. 圆角异常：打开聚焦盒时上面圆角正常，下面有一个直角阴影边缘。
2. 透明度过高：肉眼看聚焦盒和其页面透明度过高（背景穿透强），但 `screencapture` 截图又是预期
   的半透明。

范围围栏：只动 `apps/desktop-webview/src/spotlight/**` 及 `client-tauri/src-tauri`（main.rs 主窗口
建窗/vibrancy 段、windows.rs 主窗口 plan 注释、tauri.conf.json 主窗口条目、tauri_scaffold.rs）。未碰
`workbench/**`、`apps/api`、`apps/web`、`packages/db`。

## 根因

两个问题都不是新 bug——是同一类"工作台窗曾经踩过、已经修过，但当时的修复范围只盖了 workbench 窗，
没有回抄到 main/聚焦盒窗"的历史债。证据链：`r13-workbench-refinement/00-plan.md` +
`r12-desktop-workbench/reports/r13-v2-window-craft.md`（工作台窗 R13 V2 批次的完整诊断+修复记录）。

### 问题 1：圆角/直角阴影残角

`r13-v2-window-craft.md` 对工作台窗的原始诊断：「圆角工艺三层打架：原生 vibrancy 圆角(24) + CSS
`border-radius`(24) + CSS `box-shadow`（矩形投影在圆角外画出深色残角，用户截图实锤）」。修法是把阴影
交还给原生 `NSWindow.hasShadow`，CSS 侧删掉自己的 outer box-shadow，`border-radius`+`overflow:hidden`
只做内容裁剪。这个修复当时只动了 `apps/desktop-webview/src/workbench/css.ts` 的 `.wh-wb-window` 规则
和 `create_workbench_window_if_missing` 里显式的 `.shadow(true)`。

聚焦盒的 `.wh-spot` 规则（`apps/desktop-webview/src/spotlight/css.ts`）在这次修复之前从未被碰过，
box-shadow 一直是：

```
box-shadow:0 24px 64px -26px rgba(31,35,53,.42),inset 0 1px 0 rgba(255,255,255,.75)
```

第一项就是同一个"矩形投影画到原生裁剪圆角外"的 bug 本体——用户描述的「上面圆角正常，下面有一个
直角阴影边缘」和当年工作台窗用户截图实锤的现象一致（该阴影 y 偏移 24px、几乎全部落在盒子下方，恰好
对应"下面有直角残影"）。

主窗（label `"main"`）的原生阴影侧其实已经具备条件：`tauri.conf.json` 里主窗条目此前没有声明
`"shadow"` 字段，`tauri-utils` 的 `WindowConfig::shadow` 默认值就是 `true`（已查
`tauri-utils-2.9.3/src/config.rs` 源码确认），且主窗是声明式建窗（config 里没有 `"create": false`），
不像 workbench/pet 走运行时 `WebviewWindowBuilder::new()`（那条路径不读 config 默认值，所以 workbench
批次才需要显式 `.shadow(true)`）。也就是说主窗原生阴影本来就是开着的——真正需要修的只有 CSS 侧那道
多余的 outer box-shadow。

### 问题 2：肉眼太透，截图看不出来

用户描述的"screencapture 截图是预期的半透明，肉眼却太透"完全符合项目已知的 vibrancy 特性
（见 `desktop-glass-frost-constraint` 记忆：vibrancy 是窗口服务器原生合成，多数截图管线捕获不到它的
真实模糊/材质，只有肉眼能看真实观感）——所以这个问题基本只能从 Rust 侧原生材质配置去找，CSS 层面能做
的是把自己的不透明度基线抬高，减少对材质选型误差的敏感度。

对比 main.rs 里两个窗口当时用的材质：

- 主窗（聚焦盒）：`window_vibrancy::NSVisualEffectMaterial::HudWindow`，且从未 `set_theme` 钉外观。
- 工作台窗：`window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground` + `set_theme(Light)`
  钉死浅色。

`HudWindow` 是 macOS 的深色 HUD 材质，语义上就是"暗色高对比、常年不跟随系统浅色/深色外观"的材质，
这和聚焦盒的硬编码浅色 CSS 前景（白色渐变+白描边+暗色文字，`spotlight/css.ts` 里完全没有
`prefers-color-scheme` 分支）是错配的。工作台窗踩过同一类"材质和玻璃前景配色不搭"的坑
（`r13-workbench-refinement/00-plan.md` F-01：「深色近实底(.92/.94)叠 HudWindow」），修法是换成
跟随外观的 `UnderWindowBackground` 并把外观钉死 Light。聚焦盒此前从未做这次修复，且聚焦盒还有一个
工作台窗当时没有的额外风险：完全没有 `set_theme` 钉外观，系统深色模式下 `HudWindow` 本就偏暗、叠加
未钉定的外观，观感上"背景穿透强"是一致的方向。

## 已改（CSS，已用测试验证）

**`apps/desktop-webview/src/spotlight/css.ts`**

- `.wh-spot` 的 `box-shadow` 删掉了 outer 矩形投影项（`0 24px 64px -26px rgba(31,35,53,.42)`），
  只保留 `inset 0 1px 0 rgba(255,255,255,.75)` 顶部内高光——inset 阴影天然被 `border-radius` 裁得
  干净，不会画到圆角外面。阴影深度交还给原生 `NSWindow.hasShadow`（见下方 tauri.conf.json 改动）。
- `.wh-spot` 的背景渐变从 `rgba(255,255,255,.52)→rgba(255,255,255,.36)` 提到
  `rgba(255,255,255,.78)→rgba(255,255,255,.6)`，让内容在原生 vibrancy 模糊之上有更扎实的立足点，
  不完全依赖肉眼碰运气才能验证的原生材质渲染。
- 顺手修了两处过期注释（`html,body,#root` 上方 + `.wh-spot` 上方）：原文说"不叠原生 material"，
  但 main.rs 实际早就在对主窗调用 `apply_vibrancy`，注释和代码脱节；改成准确描述当前管线
  （webview 背景清零 → 原生 vibrancy 贴材质 → SVG/backdrop 层叠加）。

**`apps/desktop-webview/src/spotlight/css.test.ts`**

- 背景渐变断言更新为新的 `.78`/`.6` 值。
- box-shadow 断言拆成两条：`assert.match` 只保留 inset 高光；新增 `assert.doesNotMatch` 反向钉住
  outer 矩形投影项不能回归（同 R13 V2 给 `.wh-wb-window` 做的钉点手法）。

**`client-tauri/src-tauri/tauri.conf.json`**

- 主窗（`label: "main"`）条目显式加 `"shadow": true`——此前依赖 tauri-utils 的隐式默认值，现在和
  pet 窗的显式 `"shadow": false` 对称，不再让"要不要原生阴影"这件事悬在默认值上。

**`client-tauri/src-tauri/tests/tauri_scaffold.rs`**

- 新增 `main_window_declares_native_shadow_explicitly`：钉住 `tauri.conf.json` 主窗 `shadow: true`。

## 已改（Rust vibrancy material，编译+纯逻辑测试已过，真机观感待人工）

**`client-tauri/src-tauri/src/main.rs`**（`main()` 里主窗启动分支，`#[cfg(target_os = "macos")]`）

- 材质从 `NSVisualEffectMaterial::HudWindow` 换成 `NSVisualEffectMaterial::UnderWindowBackground`
  （抄工作台窗已验证过的选型）。
- 新增 `main_window.set_theme(Some(tauri::Theme::Light))`，在 `apply_vibrancy` 之前调用，失败走同一
  个 `MainWindowStartupFallbackStep::MacosVibrancy` 诊断日志路径（不新增枚举项，复用既有的"vibrancy
  相关失败"分类，和 workbench 那边 `set_theme` 失败只 `eprintln` 不新增分类是同一个既有模式）。
- `NSVisualEffectState::Active` 和圆角半径 `24.0` 不变（都是之前已经验证过的独立决定，和这次的材质/
  外观改动正交）。

**`client-tauri/src-tauri/src/windows.rs`**

- 修了 `main_window_plan()` 里的过期注释（同 css.ts 那处，声明层"透明"和运行时"贴原生材质"是两件
  事，注释此前把两者混为一谈，说成"不叠原生 material"）。

**`client-tauri/src-tauri/tests/tauri_scaffold.rs`**

- `macos_main_window_restores_native_vibrancy_for_real_frosted_glass`：断言从要求 `HudWindow` 改成
  要求 `UnderWindowBackground`，新增反向断言禁止再出现 `HudWindow`，新增断言要求
  `main_window.set_theme(Some(tauri::Theme::Light))` 存在。

**这部分为什么标"待真机"**：vibrancy 是 macOS 窗口服务器原生合成，这个 agent 环境没有 GUI、无法起
`.app`、无法截屏比对材质渲染出来到底是不是"更实一档"——只能保证：(a) 材质名/API 调用编译通过且被
`cargo test` 覆盖的纯字符串/契约断言锁住，(b) 这个材质选型是照抄工作台窗**已经过真机验收**（R13 V2
报告有真机截图验证记录）的方案，不是凭空猜的新组合。真正"肉眼是否还透"这件事，只有真机能给答案。

## 测试

- **`pnpm --filter @workhub/desktop-webview test`**：1130 个测试全绿（本批新增/改动的断言都在
  `spotlight/css.test.ts` 里，`Spotlight shell keeps a translucent liquid-glass surface` 单测通过）。
- **`pnpm -r typecheck`**：16 个 workspace 全部 Done，0 错误。
- **`cargo test`（`client-tauri/src-tauri`，本机 macOS，`#[cfg(target_os = "macos")]` 分支真的被编译
  并跑过）**：lib 82 + bin 13 + `tauri_scaffold.rs` 12（新增 1 条 `main_window_declares_native_shadow_
  explicitly`）全绿，含更新后的 `macos_main_window_restores_native_vibrancy_for_real_frosted_glass`。
- **`cargo build --bins`**：0 warning。
- `cargo build`/`cargo test` 按已知规律会把 `client-tauri/src-tauri/gen/schemas/capabilities.json`
  自动重新生成（这个文件此前就是过期状态，缺 workbench capability 条目，`r13-v2-window-craft.md` 已经
  报告过一次同样的现象）。本批同样用 `git checkout --` 把它还原回改动前的（过期）状态，没有带着这个
  范围外的"顺手修"进本批提交。

## 我改过的断言（如有）

`css.test.ts` 的两条断言（背景渐变、box-shadow）改的是**期望值本身**，不是放宽或删除校验——旧断言钉
的就是本次要修的 bug（太透的低 alpha、会画残角的 outer box-shadow），必须原地改成新值,否则测试会继续
钉住 bug 本身。`tauri_scaffold.rs` 的 `macos_main_window_restores_native_vibrancy_for_real_frosted_
glass` 同理：材质名从 `HudWindow` 改成 `UnderWindowBackground` 是功能变更的直接结果,新增的反向断言
（禁止回归到 `HudWindow`）和外观钉定断言是本批新增的校验点,没有削弱原有测试意图（"main window must
re-apply native vibrancy" 和 "WORKHUB_DISABLE_VIBRANCY 门控" 两条原样保留）。

## 集成者真机核对清单

1. **圆角/阴影**：真机打开聚焦盒，确认下方不再有直角残影，四角圆润；同时确认窗口仍然有明显的原生
   投影（不是"完全没阴影"变成一个平贴在桌面上的扁平盒子）。
2. **透明度**：真机肉眼观察聚焦盒（不要只看 screencapture 截图——按用户原话，截图看不出问题），
   对比修改前的观感，确认背景穿透感明显收敛、内容可读性提升。
3. **材质 A/B（如果第 2 步真机观感仍不理想）**：`UnderWindowBackground` 是照抄工作台窗的选型,如果
   真机验证发现聚焦盒和工作台窗在同一材质下呈现出不同观感（例如聚焦盒窗口更小、始终置顶、常年
   `state=Active` 强制常亮，工作台窗是普通非置顶窗口——使用场景不完全一致，材质在小窗口/常驻置顶场景
   下的观感可能和工作台窗不同）,可考虑真机再 A/B 其他候选材质（`Sidebar`/`Popover`/`HeaderView`，
   `r13-workbench-refinement/00-plan.md` 里列过的候选序列）,但先看 CSS alpha 提升
   （`.52/.36`→`.78/.6`）是否已经足够,材质是否还需要再调。
4. **深色系统外观下的回归检查**：聚焦盒 CSS 完全是硬编码浅色（没有 dark 分支），新加的
   `set_theme(Light)` 应该让聚焦盒在系统深色模式下依然保持浅色玻璃观感,不要出现"外观翻黑但 CSS
   还是白字白底"的错配——建议真机切一次系统深色模式验证。
5. **`Active` vibrancy 常亮回归**：确认聚焦盒未获得焦点时玻璃感依然存在（这是更早批次已经修过的
   行为，本批未改 `NSVisualEffectState::Active` 参数，但材质换了之后建议顺手复查一遍，防止材质切换
   带来意外的状态相关渲染差异）。
6. **`gen/schemas/capabilities.json` 陈旧提醒（范围外,不是本批引入）**：本机 `cargo build`/`cargo
   test` 都会把这个文件自动刷成含 `workbench` capability 的正确版本,但仓库里检入的仍是缺
   `workbench` 条目的旧版本（`r13-v2-window-craft.md` 已经报告过一次）。建议下次任何涉及
   `capabilities` 的批次里带一次 `cargo build` 把这个文件刷新提交。
