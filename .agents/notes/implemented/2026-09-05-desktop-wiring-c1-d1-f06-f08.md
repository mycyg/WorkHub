# 桌面端接线四件（C1 死按钮 / D1 托盘语言 / F-06 一键回滚 / F-08 过时文案）

- Status: implemented
- Date: 2026-09-05
- Owner: claude（R23 侦察 D 施工，工位 wt-p1，分支 r23/p1-desktop-wiring）

## Problem

侦察 D（`scout-D-wiring.md`）核实出四条桌面端「接线断点」，端点/契约/服务层都已齐全，只是没被真实
UI 调用或文案落后于实况：

1. **C1**：Cuu 卡片在工作项 `spec_ready` 且无提议时产出 `start_agent` 动作（`packages/cuu/src/cards.ts:861-871`，
   `href: POST /api/workitems/:id/agent-runs`），但桌面分发穷举 `resolveDesktopCuuAction`
   （`desktop-cuu-runtime.ts`）没有这个分支——点了既不提交也不导航。
2. **D1**：Tauri 命令 `set_shell_locale`（main.rs:588，R19-13 专为「切语言后原生外壳跟随」加的）
   注册了但前端从没 `invoke` 过，桌面切语言只更新 webview 内偏好，托盘菜单/tooltip 停在启动语言。
3. **F-06**：`POST /api/agent-runs/:id/revert` 端点、`@workhub/ui` 的 `bindReplayRevertActions`
   二次确认状态机、`renderDesktopAgentRunReplay`/`bindDesktopAgentRunReplayRevert` 薄接线全部写好，
   但全仓只有 `main.ts`/`main.test.ts` 引用——桌面 Spotlight 的 `replay` 视图从没挂载它，README
   承诺的「一键回滚」是个点了没反应的按钮。
4. **F-08**：时间线空态文案「让 Cuu 起草整份计划的入口即将上线（E3）」——E3（project-planner）早已
   在「日程」标签真实落地，这句「即将上线」是过时占位。

同时，`apps/desktop-webview/src/main.ts`（含 F-06 那三个函数的原实现）是另一条并行侦察线
（`scout-B-simplify.md` D-01）判定的「死 barrel」，正被作为死码整体移除；本工位不承接 D-01，
必须绕开对 `main.ts` 的任何改动，避免和那条并行工作互相踩踏。

## Decision

1. **C1**：在 `resolveDesktopCuuAction`/`submitDesktopCuuAction` 里新增 `start-agent-run` 分支，
   正则匹配 `/^\/api\/workitems\/([^/]+)\/agent-runs$/`，直接调 `client.startAgentRun(workItemId)`——
   语义对齐 web 的 `start_agent_run` 分支与桌面看板 `dispatchWorkItem`（工作项已存在且已
   `spec_ready`，直接开工），**不**借道 `/api/cuu/start-agent` 那条会话式启动器分支（两者语义不同：
   后者是「Cuu 帮你新起一个会话式任务」，前者是「这个已就绪的工作项，现在就跑」）。复用既有 i18n
   键 `cuuStart.started`/`cuuStart.unavailable`（两个 locale 都已存在），不新增文案。确认
   `pet-surface.ts` 的 `stripUnsupportedPetActions` 只剥 `/delegate`，不影响这个新分支的卡片动作。
2. **D1**：`spotlight/views/settings.ts`（主窗）与 `pet-surface.ts`（桌宠窗）两处切语言成功回调里，
   在 `window.location.reload()` / 广播主窗之前，用仓库既有的 `resolveDesktopTauriInvoke()`
   （`desktop-window-controls.ts`）取 invoke 句柄，取到才调 `invoke("set_shell_locale", { locale })`，
   fire-and-forget（`.catch(() => undefined)`），非 Tauri 环境（web 预览/单测）invoke 句柄为
   `undefined` 时整段跳过，不阻塞后续 reload/广播。未新建 invoke 封装，直接复用既有函数。
3. **F-06**：新增独立模块 `apps/desktop-webview/src/desktop-agent-run-replay.ts`，把
   `loadDesktopAgentRunReplay`/`renderDesktopAgentRunReplay`/`bindDesktopAgentRunReplayRevert`
   三个函数**原样复制**（不是 import，不是移动）过来，`main.ts` 保持原状不动。Spotlight 的
   `replay.ts` 详情态在既有 trace 之外新渲一块「改动快照」区（`snapshotsSectionHtml`），复用
   `packages/ui/src/replay/render.ts` 里 `bindReplayRevertActions` 认的同一套 `data-replay-revert-*`
   / `data-revert-label-*` 属性契约，但**不**复用那个渲染器的整页 HTML/CSS——改用 Spotlight 自己的
   `wh-spot-*` 玻璃视觉词汇画同一份数据，只给 `.wh-spot-act--danger` 补两条武装态/禁用态样式。
   撤销成功后回调 `refreshSnapshots` 重新拉一次 `replayAgentRun` 让详情态整体重渲（不只信任按钮
   自身的乐观 DOM patch），并在换 run/离开详情态/能力卸载时统一 teardown 撤销 binder。
4. **F-08**：时间线空态文案从「即将上线（E3）」改成指向真入口的一句话（「切到左侧『日程』标签，
   点『用 Cuu 起草计划』」/ 英文对应），与 `workbench/schedule/render.ts:421` 的按钮文案原样一致。

## Alternatives considered

- **C1**：让 `start_agent` 改走 `/api/cuu/start-agent`（该分支已存在于 `resolveDesktopCuuAction`）。
  否决——那条分支是会话式启动器（要走 Cuu 的选项/launcher spec 拼装），这里工作项已经
  `spec_ready`，语义更接近直接调度，硬套会话式分支反而引入不必要的间接层。
- **F-06**：直接复用 `packages/ui/src/replay/render.ts` 的整页 `renderAgentRunReplay` HTML 输出，
  塞进 Spotlight 盒子。否决——那是给独立回放整页用的 gold-path 旧卡片视觉语言，和 Spotlight 盒子
  的玻璃卡片/圆角/间距体系不一致，会在同一个视图里制造两套视觉语言；改为只复用其 binder 认的
  data-* 契约（行为层），视觉层各自独立。
- **F-06**：把三个函数从 `main.ts` **移动**（剪切）过来，顺手删掉 `main.ts` 里的旧代码。否决——
  `main.ts` 整体死 barrel 的移除是 `scout-B-simplify.md` D-01 的范围，由并行工位承接；本工位若
  先动了 `main.ts`，会和 D-01 的整体删除互相冲突/踩踏合并顺序。复制（暂时重复）换来两条工作线
  互不阻塞，D-01 落地时会连带删掉 `main.ts` 里这份现已冗余的拷贝，无需协调。
- **D1**：新建一个桌面专用的「切语言」封装函数统一两处调用。未做——两处上下文（主窗 vs 桌宠窗）
  各自的重渲染/广播逻辑不同，硬抽会引入一个只有两个调用点、还得传一堆回调的抽象，性价比低；
  两处各自复用 `resolveDesktopTauriInvoke()` 这一层已经够薄。

## Consequences

- `main.ts` 与 `desktop-agent-run-replay.ts` 短期内存在字面重复的三个函数（各自独立、无 import
  关系）。这是**有意为之的临时状态**：D-01（`scout-B-simplify.md`）落地删除 `main.ts` 时会连带删掉
  这份重复，届时 `desktop-agent-run-replay.ts` 成为唯一实现，无需再改调用方（`replay.ts` 已经只
  import 新模块）。若 D-01 长期不落地，需要有人再发一条 Note 决定是否反向让 `main.ts` 改 import
  新模块以消灭重复。
- Spotlight 回放视图的轮询 tick 与「快照区撤销」共享同一套 `renderDetailNow` 整体重渲，代价是
  轮询恰好撞上撤销按钮的二次确认武装窗口时会把武装态重置回未武装（用户需要再点一次确认）——
  不丢数据，只是多一次点击，接受这个权衡以换取实现简单（不用维护子槽位局部更新）。
- C1 新分支复用 `cuuStart.started`/`cuuStart.unavailable` 文案，意味着「已就绪工作项直接开工」与
  「Cuu 会话式启动」在气泡里读到的成功提示文案相同（都是「Cuu 已启动：{title}」）——可接受，
  用户关心的是「AI 开始干活了」这个事实，不是启动路径的内部区分。
