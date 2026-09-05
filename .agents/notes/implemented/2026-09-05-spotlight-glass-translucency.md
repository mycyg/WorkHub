# R24-M 聚焦盒液态玻璃通透度：材质换 Popover + 白底降到 .5/.39

- Status: implemented
- Date: 2026-09-05
- Owner: claude（r24/m-glass-translucency 工位）

## Problem

用户把一个深色终端窗口放到聚焦盒后面，盒子仍然是一块实灰，一句话概括：「桌面版怎么不透明了」。

真机复现（本文档同批截图 `A-under-window-078.png`）确认现象成立：720×50 的 idle 搜索条压在
红/米/蓝三色块与黑底终端上，盒内底色在四种背景下几乎是同一个近白灰，看不出背后有任何东西。

根因是两档一起收紧了，而不是某一处写错：

1. **原生材质**。`main.rs` 给主窗与工作台窗贴的是
   `NSVisualEffectMaterial::UnderWindowBackground`——AppKit 里最不透的一档衬底材质，
   它基本只吃桌面壁纸，几乎不显示背后的**窗口**。
2. **盒子白底**。`spotlight/css.ts` 的 `.wh-spot` 底色是 `.78 → .6` 的白渐变，压在已经不透的
   材质上，等于又糊了一层。

两处都是 R14 定的：当时用户的反馈恰好相反（「肉眼看太透」），于是材质从深色 `HudWindow` 换成
`UnderWindowBackground`，白底从 `.52/.36` 提到 `.78/.6`。R24 的反馈把这个结论反转了。

顺带纠正一处过期注释：`spotlight/css.ts` 一直写着「真毛玻璃由盒子的 `ds-glass-strong` 工具类提供」，
但 `.wh-spot` 从来没有挂过那个类（`controller.ts` 挂的是 `wh-spot ds-anim-spring-in`），
真正生效的一直是 `.wh-spot` 自己那条硬编码渐变。

## Decision

**材质默认值 `UnderWindowBackground` → `Popover`，盒子白底 `.78/.6` → `.5/.39`。**

判据是任务给的两条：能看见背后窗口的模糊轮廓；黑字仍清楚可读（AA 4.5:1）。两条都在真机截图上
量出来，不靠肉眼碰运气——`screencapture` 的**区域**截图拍的是窗口服务器合成后的画面，vibrancy
拍得到（只有 `-l <windowid>` 单窗截图拍不到，R14 当年就是被这一点误导，才留下「截图看不到差异」
的结论）。

### 真机对比表

背景是一扇深色终端窗，顶部铺红 / 米白 / 蓝三块高饱和色块，盒子横跨三块并延伸到右侧黑底。
「见背后」= 盒内「压在蓝块上」与「压在黑底上」两处采样的 RGB 通道差之和，越大越通透；
对比度按采样到的**合成后底色**与前景 token 算 WCAG 比值，取盒内最差的一处。

| 组合 | 材质 × 白底 | 见背后 | 黑字 `--ds-ink` | 次级 `--ds-ink-soft` | 观感 |
| --- | --- | --- | --- | --- | --- |
| A | UnderWindowBackground × .78 | 6.9 | 13.2:1 | 8.9:1 | 基线。四种背景下几乎同一个近白灰，背后色块完全看不见——就是用户说的「一块实灰」 |
| B | **Popover × .50** | **67.6** | **9.8:1** | **6.6:1** | **入选。**红/米/蓝清楚透出来，右段压黑底时转灰；黑字仍然扎实 |
| C | Sidebar × .45 | 25.7 | 11.0:1 | 7.4:1 | 白底比 B 还低一档，却明显更闷——Sidebar 本身比 Popover 不透 |
| D | Menu × .45 | 51.7 | 10.7:1 | 7.2:1 | 介于 B、C 之间，同样是白底更低却更不通透 |
| E | HudWindow × .40 | 97.0 | 7.4:1 | 5.0:1 | 最通透，但深色 HUD 材质不跟随外观，整条泛冷蓝灰、与浅色前景打架 |
| 补测 | Popover × .42 | 75.8 | 9.1:1 | 6.1:1 | 再透一档，占位提示明显发白，收益不抵代价 |

选 B 的理由，按权重排：

1. **在「跟随外观的浅色材质」里 Popover 最通透**（67.6 vs Menu 51.7 / Sidebar 25.7 /
   UnderWindowBackground 6.9）。注意 C、D 的白底比 B 还低一档却更闷——说明这一档的主导变量是
   材质而不是白底，先换材质是对症的。
2. **E 更通透但不能要。** `HudWindow` 正是 R14 换掉的那个：深色 HUD 材质、不跟随系统外观，
   在钉死 Light 的浅色前景下把整条染成冷蓝灰，黑字掉到 7.4:1、次级掉到 5.0:1，
   `⌥Space` 蓝色角标也发灰。为了通透把 R14 修过的坑再踩一遍不划算。
3. **`.50` 而不是 `.42`。** 补测确认再降一档确实更透（75.8），但占位提示肉眼可见发白，
   而 `.50` 已经「一眼就是透的」。R14 的反馈是反方向的（太透），落在中间一档比落在极端稳。

**工作台窗（`apply_workbench_glass`）同步用同一个默认值，不分叉。** 两扇窗是同一套玻璃语言、
经常同屏，材质不同只会让人觉得不是一家的；工作台也没有「必须更实」的理由——它自己的内容层本来
就有实底，通透度只体现在窗口边缘与空白处。

**`set_theme(Some(Theme::Light))` 保留钉死，不跟随系统深色。** 深色外观下复验过一张
（`F-popover-050-dark-appearance.png`）：钉死之后画面与浅色外观下逐像素级一致，仍然可读。
聚焦盒 CSS 是硬编码浅色（`--ds-ink` 系列全是深色字），一旦让材质跟随系统翻黑，深色字压在深色
材质上会直接不可读——这个钉子必须留着。

## Alternatives considered

**只降白底、不换材质。** 这是最小改动，但 C/D 两组数据直接否掉了它：Sidebar×.45 与 Menu×.45
的白底都比入选的 B 更低，通透度却更差（25.7 / 51.7 vs 67.6）。这一档的主导变量是材质，
只压白底是在给最不透的那层材质做无用功，而且会白白牺牲文字的立足感。

**换 HudWindow 追求最大通透（E 组）。** 通透度最高（97.0），但它是 R14 明确换掉的那个材质：
深色 HUD、不跟随系统外观，把整条染成冷蓝灰，黑字掉到 7.4:1、次级 5.0:1，`⌥Space` 蓝角标发灰。
为了这一档通透把已经修过的坑再踩一遍不划算。

**让材质跟随系统外观（去掉 `set_theme(Light)`）。** 否掉：聚焦盒 CSS 是硬编码浅色，
没有 `prefers-color-scheme` 分支，材质一翻黑就是深色字压深色底。深色外观下专门复验了一张，
钉死之后画面与浅色外观一致——这个钉子是对的，留着。

**工作台窗用更实的材质。** 考虑过（工作台内容更密、更需要文字立足感），但否掉：两扇窗经常同屏，
材质分叉会让它们看起来不是同一个应用；而且工作台的内容层本来就有实底，通透度只体现在窗口边缘
与空白处，没有「必须更实」的实际压力。

**把 alpha 覆写做成 `localStorage` 一条路（不加 Rust 侧注入）。** 否掉：那样每换一个候选值都要
先把值写进 WKWebView 的存储里，真机上没有顺手的入口；`WORKHUB_GLASS_ALPHA` + `on_page_load`
让「一次构建跑完全部组合」成立，而 `localStorage` 这条路仍然保留着，两者不互斥。

## Consequences

- 聚焦盒与工作台窗现在会**真的透出背后的窗口**（模糊色块，不是清晰轮廓——AppKit vibrancy 是
  大半径模糊，本来就只给「背后大致是什么颜色」）。用户报的「一块实灰」不再复现。
- 盒内所有内容都坐在更暗、更多变的底色上。正文与次级文字有足够余量（9.8:1 / 6.6:1），
  但最弱的 `--ds-ink-faint` 一档掉到 1.9:1（见 Known follow-up）。
- `.wh-spot` 的底色从此是 token 而不是字面量，css.test.ts 相应改成断言 token 与默认值两件事；
  以后再调这一档只改 `:root` 那一行。
- 多了两个真机调试开关与一个 `on_page_load` 钩子。两者都在不置位时完全短路（`on_page_load`
  只在 `WORKHUB_GLASS_ALPHA` 置位时才生成脚本），生产路径零行为变化。
- `tests/tauri_scaffold.rs` 的材质断言从「grep 到 UnderWindowBackground 字面量」改成
  「`#[default]` 落在 Popover 上 + 两扇窗都走同一个 `workhub_glass_material_from_env`」，
  比原来那条更贴近真正要守的不变量（默认值 + 不分叉）。

## Implementation

- `client-tauri/src-tauri/src/main.rs`
  - 新增跨平台可测的 `GlassMaterial` 纯枚举（`Popover` 为 `#[default]`）+ `GlassMaterial::parse`
    别名解析；映射到 `NSVisualEffectMaterial` 的 `ns_material()` 是唯一 macOS 专属的一步，
    非 macOS 平台用 `#[cfg_attr(not(target_os = "macos"), allow(dead_code))]` 兜住。
  - 主窗 setup 与 `apply_workbench_glass` 都改成从 `workhub_glass_material_from_env` 取材质。
  - 新增 `.on_page_load` 钩子：`WORKHUB_GLASS_ALPHA` 置位时，把 alpha 递给带聚焦盒外壳的两个窗
    （`main` / `workbench`）。桌宠窗没有玻璃盒，不掺和。
- `apps/desktop-webview/src/spotlight/css.ts`：`.wh-spot` 的硬编码渐变抽成
  `--wh-spot-glass-top/bottom` 两个 token，默认值 `.5 / .39`；顺带修掉上面说的过期注释。
- `apps/desktop-webview/src/desktop-glass-alpha.ts`（新）+ `controller.ts` 挂载处：运行期覆写。
  写在宿主元素（`.wh-ds.wh-spot-stage`）的内联样式上而不是 `:root`——宿主同时带着 `.wh-ds`，
  只有内联自定义属性才压得住 `.wh-ds` 上的 `--ds-glass-strong`。

## 调试开关（保留）

两个都是「与 `WORKHUB_DISABLE_VIBRANCY` 同族」的真机调试开关，都不置位 = 走上面的默认值、
生产零行为变化。留着的理由是这一档只有肉眼/真机截图能判，下次再调时不该为每个候选各编一次：

- `WORKHUB_GLASS_MATERIAL=popover|sidebar|menu|header|under_window|hud`
  （大小写与空白都收，认不出的值静默退回默认材质——调试开关拼错不该让窗口失去玻璃）
- `WORKHUB_GLASS_ALPHA=0.5`（只认 `(0,1]`；`0` 与越界值当作没置位，全透明的盒子读不了字）
- 本机也可以不经 Rust，直接写 `localStorage["workhub.glass.alpha"]`；全局值优先于本地存储。

一次构建跑完全部六个组合就是靠这两个开关。

## Known follow-up（本批不修）

盒内最弱的一档文字 `--ds-ink-faint`（`#8e8e93`，用在 `.wh-spot-field::placeholder` 等处）
在新底色上掉到 1.9:1。它在**旧**底色上也只有 2.6:1，本来就低于 AA——这是那一档 token 的既有问题，
不是这次通透度改动引入的，但确实被放大了一档。正文 `--ds-ink` 9.8:1、次级 `--ds-ink-soft` 6.6:1
都远高于 4.5:1，本批只动通透度、不顺手改文字层级（那是设计系统范围的决定，且会牵动视觉语言测试）。

## Verification

- `cargo fmt --check` / `cargo test` / `cargo clippy --all-targets -- -D warnings`
- `pnpm --filter @workhub/desktop-webview typecheck` / `test`
- `pnpm audit:agent-notes` / `pnpm audit:copy-terms`
- 真机：`pnpm build:desktop-macos` 出 `.app`，六个组合逐个起停截图（区域截图含背后的深色终端窗），
  外加深色系统外观一张；最后按默认值（不带任何 env）再跑一张确认默认路径与 B 一致。
