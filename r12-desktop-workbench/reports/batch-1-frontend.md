# 批 1 完成汇报（工作台主窗外壳 · 仅前端切片）

日期: 2026-07-12 · 执行: Claude · 分支: `r12/batch1-frontend`（从 `r12/workbench-full` 拉出，HEAD 含批 0 全量 + `31f022c2` workbench window shell）

范围声明：本批只做前端（`apps/desktop-webview/**` + `packages/api-client/**` 补方法）。Rust 侧（workbench WebviewWindow、`open_workbench` command、`workhub://workbench` 深链路由）已在 `31f022c2` 交付，本批未改 `client-tauri/**` 任何文件。

## 做了什么

- `apps/desktop-webview/workbench.html`：新入口，`window.__WORKHUB_SURFACE__="workbench"`，`<script>` 直载 `src/workbench/boot.ts`（照 `pet.html` 模式，不走 1371 行的 `browser.ts`）。`vite.config.ts` 的 `rollupOptions.input` 加 `workbench` 条目；`vite build` 产出独立 26.7KB chunk（不含 `browser.ts` 的 374KB）。
- `apps/desktop-webview/src/workbench/` 新目录，纯 TS DOM，无框架：
  - `boot.ts`：本地 `clientToken()`/`resolveWorkbenchApiBase()`（照 `browser.ts:128/136`，不 import 它）；`ensureWorkbenchClientToken()` 复刻 `ensureDesktopClientToken` 的登出/陈旧 token 语义；`bindWorkbenchDeepLinkListener()` 订阅 Tauri `"deep-link"` 全局事件，只处理 `windowControl.label==="workbench"` 的 plan，解析 route 切项目上下文。
  - `shell.ts`：三栏骨架（`renderWorkbenchShellHtml`）+ 顶部纯 CSS 拖拽区（`-webkit-app-region:drag`，照 `.wh-cmd-home` 用法，不经 Tauri IPC）+ 自绘关闭/最小化按钮（接 `window-bridge.ts` 的真 Tauri Window API）+ 右栏收放 + 中栏按 store 状态渲染（空态/加载/错误/项目摘要）。
  - `rail.ts`：项目树（复用 `client.listProjects()`，与 `dashboards.ts` 的 `createProjectsView` 同一端点）+ 选中项目拉 `client.pages.workbench(id)` VM + 新建项目模态（接 `POST /api/projects/bootstrap`，真实端点，非发明）。
  - `store.ts`：极简订阅容器（当前项目/VM/侧栏/模态状态），未预铺批 2 事件流字段。
  - `route.ts`：深链 payload/route 纯函数解析器（`ShellDeepLinkPlan` 形状照 Rust `deep_link.rs`）。
  - `window-bridge.ts`：`getCurrentWindow().startDragging/minimize/hide` 解析（照 `pet-window-bridge.ts` 的 currentWindow 解析法）。
  - `icons.ts`：SVG 图标表，无 emoji。
  - `css.ts`：深色玻璃视觉（照 prototype 配色），token 复用 `design-system.ts` 的 `--ds-*` 体系，在 `.wh-ds.wh-wb` 作用域内重赋值颜色 token（间距/圆角/时长/字体不变）。
- `apps/desktop-webview/src/spotlight/views/workbench-open.ts`：Spotlight「打开工作台」「新建项目」两条的 view，`mount()` 直接 invoke 真实 Tauri command `open_workbench`（不渲染内联业务内容——工作台是独立窗口）；失败给重试，非 Tauri 环境给诚实的「桌面客户端才能用」提示。
- `apps/desktop-webview/src/command-palette.ts`：`CommandId` 加 `"workbench"` / `"new_project"` 两条 + registry 条目。
- `apps/desktop-webview/src/spotlight/registry.ts`：两条映射到 `createWorkbenchOpenView`。
- `apps/desktop-webview/src/browser.ts`：`COMMAND_ROUTE`（`Record<CommandId,string>`，穷举类型）补两个占位路由，机械性改动——这张表只喂已废弃的 `mountCommandHome()`（未被任何路径调用），不影响运行时行为。
- `packages/api-client`：`types.ts` 加 `PageClient.workbench?`（可选，见下方「改动细节」）；`client.ts` 实现 `GET /api/pages/workbench/:projectId`；`api-client.test.ts` 补测试。

## 改动细节 / 关键取舍

1. **`PageClient.workbench` 做成可选字段，不是必填**。最初按其它 page 方法的惯例做成必填，`pnpm -r typecheck` 当场炸出 `apps/web/src/main.test.ts` 有一个完整 `PageClient` 字面量 mock（早于本批就存在，不在我范围内）少了这个新键。`apps/web` 不在本批「只许改」清单里，不能顺手补。改成可选字段后：
   - 真实 `createApiClient()` 仍无条件实现它（真接线，不是摆设）。
   - `apps/desktop-webview` 侧（`shell.ts`）取用前判空，判空分支给真实的错误态（不是静默假装成功）。
   - `packages/api-client/src/api-client.test.ts` 里对应两次调用用非空断言 `!`（真实现一定有，mock 才可能没有）。
2. **左栏「主区/网盘」树叶、「军团总览」都做成只读、非按钮**。这两块的真实功能（群聊、网盘视图、军团聚合端点）分别是批 2/6/5 的活，本批没有能接的目标。铁律 3「不许假接线」要求「做不完就不要渲染这个按钮」——所以它们渲染的是 VM 里的真数据（真会话标题、真消息数、真文件数），但没有 `cursor:pointer`/hover 反馈/点击事件，视觉上不暗示可点。批 2/6/5 把对应视图接进这个窗口时再升级。
3. **中栏「新建项目」CTA 复用 rail 的模态开关逻辑**（`WorkbenchRailHandle.openNewProjectModal()`），没有在 `shell.ts` 里重复拼一份——避免两处入口的模态残留状态（上次输入的文本/错误提示）不一致。
4. **关闭按钮语义是「隐藏」不是「销毁」**：工作台窗口 Rust 侧是 `create:false` 复用同一实例，关闭按钮调 `window.hide()` 而非 `window.close()`，与主窗/桌宠窗一致，避免下次 `open_workbench` 要重新起窗口。

## 已知缺口（范围外，写清楚不是漏做）

- **`client-tauri/src-tauri/capabilities/default.json` 的 `"windows"` 只有 `["main","pet"]`，没有 `"workbench"`**。这是本批发现的、真实存在的 Rust/配置缺口：
  - Tauri v2 的 core 插件命令（`window.*`、`event.*`）按 capability 的 `windows` 字段逐窗口发权限；`"workbench"` 不在名单里意味着这个窗口目前拿不到任何 core 权限。
  - 具体影响：`boot.ts` 里对 `"deep-link"` 事件的 `event.listen` 订阅，以及 `window-bridge.ts` 里的 `minimize()`/`hide()`/`startDragging()`，在真机大概率会被 ACL 拒绝（reject）。
  - 我已经把这些调用写成「真实 API + 优雅降级」（`.catch` 吞掉拒绝、`resolveWorkbenchTauriListen` 返回 undefined 时 no-op），不会崩，但**不会真的生效**，直到 capabilities 文件补上 `"workbench"` 到 `windows` 列表 + `core:event:default`/`core:window:allow-close`/`core:window:allow-hide`/`core:window:allow-minimize`/`core:window:allow-start-dragging` 等权限。
  - 这是 `client-tauri/**`，明确在我「禁止碰」清单里，没有修，写在这里等人工在下一个碰 Rust 的批次里补上，**并在补上后重新做一次真机验收**（下面「待人工」也会提这条）。
  - 顶部拖拽区不受影响——`-webkit-app-region:drag` 是 CSS/webview 原生行为，不经 Tauri IPC，不需要这个权限。
- **深链冷启动的潜在丢事件竞态**：`main.rs` 的 `handle_deep_link_url` 是先 `create_workbench_window_if_missing` 再 `app.emit("deep-link", plan)`——如果窗口刚创建、`workbench.html` 的 JS 还没跑到 `bindWorkbenchDeepLinkListener()` 就完成订阅，这次 `emit` 会被错过（Tauri 的 `emit` 只广播给当前已订阅的监听器）。后果是：从 Spotlight「打开工作台」带 `projectId` 冷启动时，窗口可能落在空项目列表而不是自动选中该项目（用户仍可手动点选，不是死锁，但体验有缺口）。这个和上面的 capabilities 缺口一样是 Rust 侧改动，不在本批范围，写进来供下一个 Rust 批次判断是否需要在 Rust 侧加一次「窗口就绪后重放最后一条 deep-link」的机制。
- **`bootstrapProject` 语义是「按 slug 建或复用」，不是「总是新建」**：如果用户在新建项目模态里输入的名字和已有项目撞了自动生成的 slug，`created` 会是 `false`（复用了已有项目），当前 UI 不会特别提示这一点，只是照常带你进那个项目。这是复用既有端点的既有行为，不是本批引入的 bug；如果要给「撞名」更明确的提示，需要产品决策（提示文案/是否要求手动改名）。

## 自查输出（关键行）

```
$ pnpm --filter @workhub/desktop-webview test
1..322
# tests 322
# pass 322
# fail 0

$ pnpm --filter @workhub/api-client test
1..19
# tests 19
# pass 19
# fail 0

$ pnpm -r typecheck
（16/16 workspace 全 Done，含 apps/web / apps/api / apps/desktop-webview / packages/api-client，0 error）

$ pnpm --filter @workhub/desktop-webview build
✓ 219 modules transformed
dist/workbench.html                     0.49 kB
dist/assets/workbench-*.js             26.7 kB │ gzip: 8.6 kB   ← 独立 chunk，未拖入 browser.ts

$ git status --porcelain
（全部改动落在 apps/desktop-webview/** 与 packages/api-client/**，无范围外文件）
```

测试数量对比：`@workhub/desktop-webview` 269 → 322（+53：`src/workbench/` 8 个新模块的 colocated test 共 49 条 + `spotlight/views/workbench-open.test.ts` 4 条；`command-palette.test.ts`/`vite-config.test.ts`/`main.test.ts` 只扩了已有 test 内部的断言/mock 字段，不新增 test 计数）。`@workhub/api-client` 18 → 19（+1，`pages.workbench` 端点测试）。

涉 Rust 批次（本批不算，未改 `client-tauri/**`，未跑 `cargo test`）。真机 `.app` 起窗截图（vibrancy/frameless 视觉）本环境无法做，见下方「待人工」。

## 我改过的断言

- `apps/desktop-webview/src/command-palette.test.ts`：`test("registry covers every backend capability surface")` 的穷举 id 列表加了 `"workbench"` / `"new_project"` 两项——这是任务指令里预告过的「计数门」，新增两条 Spotlight 命令必须体现在这张穷举清单里，否则测试会（正确地）红。
- `apps/desktop-webview/src/vite-config.test.ts`：在原有测试里追加一条 `assert.match(input?.workbench, /workbench\.html$/u)` 断言，没有删改原有断言。
- `apps/desktop-webview/src/main.test.ts`：给已有的完整 `pages` mock 补了 `workbench` 桩（`throw new Error("not needed")`，和其它 13 个未用到的方法同款），纯粹为了让 TS 结构类型对上，不改变任何测试期望的行为。
- 以上三处都是「因为我新增了字段/命令，穷举型的 mock/断言需要同步补齐」，不是为了让红测试变绿而放宽断言。

## 范围外发现（不修，只报）

- 见上方「已知缺口」两条 Rust/配置项（`capabilities/default.json` 缺 `"workbench"`；深链冷启动竞态）。
- `apps/desktop-webview/src/browser.ts` 里的 `boot()`/`mountCommandHome()`（约 265-333、875-... 行）是死代码——没有任何调用点（真正跑的是 `bootSpotlight()`）。我因为 `COMMAND_ROUTE: Record<CommandId,string>` 穷举类型的缘故，往这段死代码里加了两个占位路由才能过 `tsc`。这段死代码本身值得在未来某个清理批次删掉，但不在本批范围，只报告不动。

## 没做 / 存疑

- **真机验收（.app vibrancy + frameless 视觉 + 拖拽/关闭/最小化真实效果）**：桌面 UI 无法在浏览器/CDP 预览里渲染 Tauri 的原生 vibrancy 与 frameless 窗口效果，按手册 04 §0 的既定约束，本批验收 = typecheck + 单测 + 构建产物核验，真机截图需要人工用 `screencapture` CLI 在真正的 `.app` 里做。**做真机验收前请先确认/修复上面「已知缺口」里的 capabilities 缺口**，否则深链订阅、关闭/最小化按钮在真机会看起来「点了没反应」（其实是 ACL 拒绝，不是前端没接线——前端代码是真实调用）。
- **军团总览、主区/网盘树叶的真实交互**：批 1 故意做成只读预告（见上「改动细节」第 2 条），批 2/5/6 把对应视图接进来后需要把这些元素从只读升级为可点，并删掉 `css.ts` 里对应的 `cursor:default` 覆盖。
- **`bootstrapProject` 撞 slug 复用提示**：见上「已知缺口」最后一条，需要产品拍板要不要做。

## 结论

批 1 前端切片完成：三栏外壳 + 项目树（吃真实批 0 workbench VM）+ 空态 + 新建项目模态（真接线）+ Spotlight 两条入口（真 invoke）落地，`pnpm -r typecheck` 与相关 workspace 测试全绿，`git status` 无范围外文件。真机验收与 `client-tauri` capabilities 缺口留给人工/下一个碰 Rust 的批次。不进批 2，等待人工验收。
