# R13 批 V2 · 工作台窗口工艺原生化（macOS only）· 完成汇报

分支：`r13/v2-window-craft`（从 `origin/main` 头 `804ee276` 切出，`feat(r13): pin the workbench to
light glass at the native layer`——已含 V1 浅色玻璃改版）。未合并、未推送。

## 背景

规划见 `r13-workbench-refinement/00-plan.md` 批 V2：窗口工艺（角角 + 平台自适应控制 + 托盘入口）。
触发是 R12 人工验收报告（`r12-desktop-workbench/reports/r12-acceptance-2026-07-13/R12-acceptance-report.md`）
F-01/F-02 两项失败——F-01（浅色玻璃透景）已在 V1 修完；本批对应 00-plan.md 里诊断的另外两条病根：

- 圆角工艺三层打架：原生 vibrancy 圆角(24) + CSS `border-radius`(24) + CSS `box-shadow`（矩形投影
  在圆角外画出残角，用户截图实锤）。
- 窗口控制自绘，未按 mac/Windows 自适应：workbench 窗 `decorations:false` 全自绘 min/close，无平台
  分支；用户拍板本批 **macOS only**，Windows 保留自绘（不投调试）。

范围围栏：`client-tauri/**`（main.rs 窗口构建/托盘/事件、tauri.conf.json、capabilities）、
`apps/desktop-webview/src/workbench/{shell.ts,css.ts,window-bridge.ts}` 及测试、本报告。未碰
`apps/api`/`packages/chat`。

## 做了什么

### 1. 小角角修复（`apps/desktop-webview/src/workbench/css.ts` + `client-tauri/src-tauri/src/main.rs`）

- **删掉 `.wh-wb-window` 的 `box-shadow`**（矩形投影在原生裁剪出的圆角外画残角，这是真机截图实锤的
  bug，不是审美偏好）。`border-radius:24px` + `overflow:hidden` 保留，只做内容裁剪，不再画边界；
  原生 vibrancy 的圆角裁剪本就是最终可见形状的来源。
- **阴影交给原生**：`create_workbench_window_if_missing`（main.rs）的 `WebviewWindowBuilder` 链上
  显式加 `.shadow(true)`——不依赖 tao 的隐式默认值（虽然 `tauri-utils` 的 `WindowConfig::shadow`
  默认就是 `true`，但 `WebviewWindowBuilder::new()` 走的是全新 builder、不会自动读 tauri.conf.json
  里的字段，此前完全没有显式声明）。`.shadow(true)` 在 macOS 上映射到 `NSWindow.hasShadow(true)`
  （查过 tauri 2.11.2 源码：`tauri-runtime-wry` 的 `shadow()` 在 `#[cfg(target_os = "macos")]` 分支
  调 `with_has_shadow`）。
- 同步 `css.test.ts` 钉点：新增「`.wh-wb-window` 不再有自己的 `box-shadow`」的反向断言（`doesNotMatch`）。

### 2. macOS 原生红绿灯（`client-tauri/src-tauri/src/main.rs`）

`create_workbench_window_if_missing` 里给 builder 加了 `#[cfg(target_os = "macos")]` 分支（查过
tauri 2.11.2 源码确认 `title_bar_style`/`hidden_title`/`traffic_light_position` 三个 builder 方法本身
就是 `#[cfg(target_os = "macos")]` 门控的，非 macOS 平台编译期直接不存在，不需要额外 feature flag；
`macos-private-api` cargo feature 已经在 `Cargo.toml` 里开着）：

```rust
#[cfg(target_os = "macos")]
{
    builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 16.0));
}
```

- 非 macOS 维持原来的 `decorations(workbench_config.decorations)`（即 `false`，全自绘）不变——
  `windows.rs` 里 `workbench_window_plan().decorations == false` 这条声明式契约测试因此也不用改，
  macOS 的运行时覆盖只发生在 main.rs 的 builder 链里（跟 vibrancy material 的应用方式是同一个既有
  模式：声明式 plan 只表达跨平台基线，平台特化在窗口构建函数里叠加）。
- `traffic_light_position(18.0, 16.0)` 是保守估算（`.wh-wb-titlebar` 高 44px，红绿灯簇约 12px
  高、垂直居中取 y≈16；x=18 避开 24px 圆角的曲线起点），**真机像素值需要集成者核对微调**——见文末
  「集成者真机核对清单」。
- 对应 CSS：`.wh-wb-titlebar--native{padding-left:78px}`（新规则），给面包屑文字让出红绿灯占用的
  左侧空间（三个原生按钮起点 x≈18、每个直径约 12px + 间距约 8px，78px 留了约 6px 呼吸空间——同样待
  真机核对）。

### 3. 自绘控件平台隐藏

- **`apps/desktop-webview/src/workbench/window-bridge.ts`**：新增 `isMacOsWebview(input)` 纯函数。
  仓库里没有既有的 OS 判定先例（`tauri-plugin-os` 没进 `Cargo.toml` 依赖，不为一个布尔值新增插件），
  用 `navigator.userAgentData.platform` → `navigator.platform` → `navigator.userAgent` 三级降级判定
  （和这个文件本身「从 `globalThis` 读环境探测、拿不到就优雅降级」的既有写法一致）。6 条单测覆盖
  三级降级、大小写、空字符串当"缺失"处理等边界。
- **`apps/desktop-webview/src/workbench/shell.ts`**：`renderWorkbenchShellHtml(locale, chrome?)`
  新增第二个可选参数 `{ nativeWindowChrome?: boolean }`；为真时**整个不渲染**自绘的 min/close 按钮
  （不是 CSS `display:none` 藏起来——04 手册 §4 铁律 3 反过来用：有原生控件接管时，自绘控件本身就是
  会重叠的假控件,不该留在 DOM 里),并给 `.wh-wb-titlebar` 加 `wh-wb-titlebar--native` 类。默认值
  `false`，既有的单参数调用（`renderWorkbenchShellHtml("zh-CN")`)行为不变，既有测试未改动。
  `mountWorkbenchShell` 里用 `isMacOsWebview(doc.defaultView ?? globalThis)` 算出这个布尔值再传入。
- **关闭语义拦截（`client-tauri/src-tauri/src/main.rs`)**：macOS 原生红绿灯的关闭按钮默认会真正
  销毁 NSWindow（Tauri v2 默认行为）,workbench 窗是 `create:false` 复用同一个实例——销毁一次下次
  `open_workbench`/深链/托盘唤起都会先撞见"窗口不存在"。照 main 窗口已有的 `findings[#132/H15]`
  先例（`CloseRequested` 时 `prevent_close()` + `hide()`),把 `on_window_event` 里的判断从
  `window.label() == "main"` 扩成同时覆盖 `"workbench"`,并抽成纯函数 `should_hide_instead_of_close`
  （此前完全没有测试覆盖,顺手补了单测)。这样原生红绿灯的关闭按钮和 shell.ts 自绘关闭按钮
  （一直调的是 `hide()` 不是 `close()`)语义一致。
- **拖拽**：`shell.ts` 里 `titlebarEl` 的 `mousedown → startDragging` 监听保留不动——原生 Overlay
  标题栏只有系统自动识别的那一小条（通常远小于我们 44px 高的自绘标题栏行）是免手写的可拖拽区,
  剩下的高度仍需要这段 JS 兜底,对非 macOS 也仍是唯一的拖拽实现,两边都需要,没有必要区分平台。

### 4. 托盘菜单加「打开工作台」

- **`client-tauri/src-tauri/src/tray.rs`**：新增 `TRAY_OPEN_WORKBENCH_ID`/
  `TrayMenuActionKind::OpenWorkbench`/中英文 label（"打开工作台"/"Open workbench"）。这个 kind 的
  `window_control` 留空（`None`,同 `Quit` 的先例)——因为通用的 `ShellWindowControlPlan` /
  `execute_window_control` 假定目标窗口已存在,且 `focus_main_route` 那套只认 main 窗的 `/`-前缀
  前端路由,不适用于 workbench 的"按需建窗 + 无参数=复用上次选中项目/前端默认态"语义（这个语义已经在
  `open_workbench` 自己的深链管线里定义好了,不重造第二条控制路)。
- **`client-tauri/src-tauri/src/main.rs`**：`install_workhub_tray` 里跟 `open_settings` 同款挂法
  建 `MenuItemBuilder`、塞进 `MenuBuilder`（放在 open_settings 之后、quit 分隔线之前)；
  `handle_tray_action` 特判 `TRAY_OPEN_WORKBENCH_ID`,直接调
  `open_workbench(app.clone(), None, None)`（跟已有的 `TRAY_RESTORE_PET_INTERACTION_ID` 特判直接调
  `restore_pet_window_interaction_state` 是同一个既有模式)。

## 测试

- **`cargo test --manifest-path client-tauri/src-tauri/Cargo.toml`**：106 个测试全绿（lib 82 +
  bin 13 + `tauri_scaffold.rs` 11)。本机是 macOS（Platform: darwin),`#[cfg(target_os = "macos")]`
  分支真的被编译并跑过单测,不是只在 Linux CI 上被跳过——`cargo build --bins` 也确认 0 warning。
  新增/改动的测试：
  - `tray.rs`：`keeps_tray_ids_stable_and_unique`(7→8 项) 改为断言 8 项并含
    `TRAY_OPEN_WORKBENCH_ID`；新增
    `open_workbench_action_claims_no_generic_window_control_and_does_not_exit_the_app`（锁 id/
    label/kind 契约,不锁 main.rs 里的具体调用——那部分没有 mock runtime 可测,同
    `TRAY_RESTORE_PET_INTERACTION_ID` 的既有测试覆盖深度)。
  - `main.rs`：新增
    `should_hide_instead_of_close_covers_main_and_workbench_but_not_pet_or_unknown_labels`。
- **`pnpm --filter @workhub/desktop-webview test`**：661 个测试全绿（本批新增 16 条：
  `window-bridge.test.ts` 6 条 `isMacOsWebview`、`shell.test.ts` 2 条渲染分支、`css.test.ts` 2 条
  钉点)。
- **`pnpm -r typecheck`**：16 个 workspace 全部 Done,0 错误。

## 我改过的断言（如有）

无。`css.test.ts`/`shell.test.ts` 只新增断言,没有修改任何既有断言的期望值；`tray.rs` 的
`keeps_tray_ids_stable_and_unique` 把 `7` 改成 `8` 是因为菜单项数量真实增加了一项（新增功能导致的
必然变化,不是迁就实现去弱化断言)。

## 范围外发现（不修,只报)

- `client-tauri/src-tauri/gen/schemas/capabilities.json` 是 Tauri 构建脚本的自动生成产物,本机跑
  `cargo build`/`cargo test` 时被自动重新生成,发现它此前是**过期**的——只含 `default` 一个
  capability,缺了 `workbench.json`（`capabilities/workbench.json` 已经存在,授予了
  `core:window:allow-start-dragging`/`allow-hide`/`allow-minimize`,应该早就被生成过一次)。这个
  过期状态和本批任务无关（是更早的批次加 `workbench.json` 时忘了提交重新生成的产物),我在本次收工前
  用 `git checkout --` 把它还原回了修改前的（过期）状态,没有带着这个"顺手修"进本批提交——按 04 手册
  §4 铁律 7,范围外问题只报不修。**建议下次任何涉及 capabilities 的批次里带一次
  `cargo build` 把这个文件刷新提交。**
- `apps/desktop-webview/src/workbench/window-bridge.ts` 顶部注释此前说"capabilities/default.json
  目前只有 main/pet,不含 workbench,是已知缺口"——实地核查发现这个说法已经**过期**：
  `client-tauri/src-tauri/capabilities/workbench.json` 单独文件早就存在并覆盖了 hide/minimize/
  start-dragging 三个权限。本批没有改这段注释（不在改动范围内的文件段落,且改注释本身没有代码效果），
  但集成者如果要顺手清理这处过期文档,提醒一下这个发现。

## 没做/存疑

- **真机观感（红绿灯位置、角角是否真的消失）完全没有验证渠道**——本 agent 无法启动 GUI/`.app`、无法
  截屏比对,只能保证 Rust 侧编译通过 + 单测覆盖了"能测的纯逻辑"部分。见下方「集成者真机核对清单」。
- `traffic_light_position(18.0, 16.0)` 和 CSS `padding-left:78px` 都是基于 `.wh-wb-titlebar` 44px
  高度和红绿灯簇尺寸的估算值,不是真机测量值。
- 用户拍板本批只做 macOS,Windows/Linux 维持现有全自绘方案,未做任何 Windows 分支的改动或测试。
- `tauri.conf.json` 未改动——workbench 窗口条目沿用现有 `"decorations": false`
  （macOS 的运行时覆盖只在 Rust 代码里发生,JSON 里的静态声明保持"非 macOS 基线"的语义,和
  `windows.rs` 里 `workbench_window_plan()` 的声明式契约测试保持一致)。`capabilities/*.json`
  未改动——`on_window_event` 的 `CloseRequested` 拦截是 Tauri 核心运行时事件,不经过 JS/ACL 层,
  不需要 capabilities 授权。

## 集成者真机核对清单

1. **角角**：真机截图工作台四角（尤其用户原始截图指出的右下角),确认原来矩形投影的残角确实消失,
   同时确认原生窗口阴影（`NSWindow.hasShadow`）依然可见、不是"完全没阴影"。
2. **红绿灯位置**：确认 `traffic_light_position(18.0, 16.0)` 在 44px 高的自绘标题栏行里视觉居中、
   不贴边、不被圆角裁掉;不满意就调整 main.rs 里这一个坐标（同步调 css.ts 的
   `.wh-wb-titlebar--native{padding-left:78px}` 让文字不被压住)。
3. **红绿灯功能**：hover 展开红/黄/绿三态正常;点绿色是否触发系统标准的"进入全屏"（Overlay 风格下
   通常如此,是否符合工作台窗口的产品预期需要人确认——00-plan.md 没有明确这一点)；点红色确认窗口
   隐藏而不是销毁（再从托盘"打开工作台"或 Spotlight 深链验证能再次唤起、状态不丢)。
4. **标题栏拖拽**：确认原生 Overlay 条以下、`.wh-wb-titlebar` 剩余高度部分仍可通过
   `mousedown → startDragging` 拖动（这段逻辑未改动,理论上不受影响,但引入原生标题栏后建议重新过
   一遍)。
5. **托盘「打开工作台」**：点击后确认无参数时行为符合预期（复用上次选中项目,或落到前端的空态"选一个
   项目/新建项目"),且工作台窗口此前已隐藏时能正确重新显示（不是新开一个)。
6. **非 macOS 回归**：如有 Windows/Linux 环境,确认自绘 min/close 按钮和之前一样正常显示、可点
   （本批不应该改变非 macOS 行为,但请至少过一遍确认没有意外的 CSS/JS 分支泄漏)。
