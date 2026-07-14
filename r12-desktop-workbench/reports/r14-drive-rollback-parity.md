# R14 完成汇报：网盘回滚两端不对称

日期: 2026-07-14 · 执行: Claude · 分支: `r14/drive-rollback-parity`（基线 `afc792d1`，拉自 `origin/main`）
来源: R14 FIX 批第 3 项，立案自 R12 备忘「网盘回滚两端不对称」。

## 调查先行：两端各自的现状

### 桌面端（强侧，能力齐全）

- `apps/desktop-webview/src/workbench/drive/api.ts`：`fetchDriveItemVersions`（GET
  `/api/drive/projects/:id/items/:id/versions`）+ `rollbackDriveItemVersion`（POST
  `.../versions/:versionId/restore`）——两个批 6 端点的专用薄封装。
- `apps/desktop-webview/src/workbench/drive/side-panel.ts` + `render.ts`：右栏「版本历史」，每个
  非当前版本只要服务端给了 `restore_href` 就渲染「找回这个版本」按钮，点了立刻发 POST、成功后
  重新拉版本列表并显示「已找回 vN 的内容，追加成了新版本——原历史都还在」。
- **发现的真实缺口（施工前）**：点「找回这个版本」**没有任何二次确认**——`requestRollback`
  一收到点击就直接发请求。回滚是覆盖性动作（会把当前版本换成别的内容），却比删除文件（进回收站,
  软删可逆）还随手。这违反施工契约第 2 条「二次确认（不可逆动作要确认）」，且强侧本身也没做到。

### web 端（弱侧，此前完全没有回滚能力）

- `packages/ui/src/gold-path/route-components.ts` 的 `renderDriveRouteComponent`：「版本历史」卡片
  此前**纯只读**——只显示文件名/大小/日期/来源徽标/「当前」标签，不管 `DriveFileVersionVM.restore_href`
  字段是否有值都不渲染任何操作按钮。R13 批 P4 在这里加过一句诚实提示「找回历史版本需要桌面客户端」，
  但那句提示是**过度概括**：它把「桌面独有能力」当成了唯一真相，实际上服务端在 `versionToVm`
  （`apps/api/src/services/drive-pages.ts:254-291`）里，只要这一行版本背后有一个**未被取代**的已采纳
  交付物（`acceptedDeliverableVersionMarker` 会先剥掉被取代记录的 `restore_href`，见
  `apps/api/src/services/drive-pages.ts:325-333`），就会把 `restore_href` 填进这个版本条目——这个
  href 打的是 `apps/api/src/routes/workitems.ts` 的 `/api/workitems/:id/deliverables/:id/restore`
  端点，而这个端点**早就在 web 端完整接线**（`apps/web/src/browser.ts:1313` 的
  `acceptedDeliverableRestoreFromHref` 分支 → `client.restoreAcceptedDeliverable`），只是从没被「版本
  历史」这个卡片消费过（它只在「已采纳交付物」卡片里，通过 `driveActionLinks` 渲染）。
  也就是说：**桌面端的「拉版本历史+回滚」走的是批 6 新增的专用端点（GET/POST
  `.../items/:id/versions[/:id/restore]`，语义=追加一个新版本行、旧行原样保留）；web
  端此前完全没碰这两个专用端点**，但它其实可以复用另一条**已经全链路打通**的旧管线
  （`/deliverables/:id/restore`，语义=把 `current_version_id` 换回上一个已采纳版本，不新增行）
  把「当前这一版」的一步回滚做出来——只是没人接上。

### 不对称清单（施工前）

| 维度 | 桌面端 | web 端（施工前） |
|---|---|---|
| 回滚入口 | 每个非当前版本一个「找回这个版本」按钮 | 完全没有按钮，只有一句静态提示 |
| 二次确认 | **没有**（一点就发请求） | 不适用（没有入口） |
| 成功反馈 | 有（「已找回 vN…」+ 版本历史刷新） | 不适用 |
| 失败反馈 | 有（按版本行内联错误） | 不适用 |
| 回滚后刷新 | 有（`onRolledBack` 回调 + 重拉版本） | 不适用 |
| 文案语义 | 准确（真的是「新建版本，历史不丢」） | 提示句准确但把「桌面独有」当成了全部真相 |

## 范围围栏内做了什么

**服务端只读未改**（drive-pages.ts/drive-versions.ts/work-items.ts 均只读用于调查，未提交任何改动）。

### web（`packages/ui/src/gold-path/route-components.ts`）

给「版本历史」里**每一条服务端已经给出 `restore_href` 的版本行**接一个真按钮（新增
`driveVersionRestoreHtml`）：用 `<details>` 做零 JS 的二次确认——折叠态只有「找回这个版本」摘要按钮，
点开才看到真实语义说明（「找回后，当前版本会换回这一版的内容——现在的当前版本不会被删除，仍留在版本
历史里」，按 `restoreAcceptedDeliverable` 的真实实现如实写，**不是**照抄桌面「新建版本」那句——两条
路径服务端实现不同）和真正的提交按钮（`data-action-id="drive_restore" data-method="POST"`，href 直接
是服务端给的 `restore_href`）。这个 action-id/href 形状是 `acceptedDeliverableRestoreFromHref` 早就
认识的既有正则，**不需要碰 `apps/web/src/browser.ts`**——点击后走的是已经在生产环境跑着的
`client.restoreAcceptedDeliverable` 全链路（含成功刷新页面、失败提示）。

对没有 `restore_href` 的非当前版本（比如没有关联已采纳交付物的手动上传旧文件），保留「需要桌面客户端」
提示，但把条件从「只要有非当前版本就提示」收紧成「只有非当前版本里真没给 restore_href 的那些才提示」，
措辞也从「找回历史版本需要桌面客户端」改成「这里的更早版本找回需要桌面客户端」——不再对已经能在网页上
做的那一版重复喊「需要桌面客户端」。

### 桌面（`apps/desktop-webview/src/workbench/drive/{side-panel.ts,render.ts}` + `workbench/css.ts`）

补上此前缺失的二次确认：新增纯函数 `decideRollbackConfirmation`（不碰任何 DOM/网络，第一次点某个版本
只「武装」它、5 秒内对同一版本再点一次才真正执行 POST；点了别的版本则重新开始武装那一个——照
`apps/web/src/browser.ts` 里 `r9ConfirmArmed` 的既有两段式确认先例）。`render.ts` 的按钮在武装态下
换成「确定？再点一次找回」并在下方补一句真实语义提示（「会把这一版的内容存成一个新的当前版本，原来的
版本历史都还在。5 秒内再点一次确认，否则自动取消」——这条路径确实会插入新版本行，与 web 那条不同，
文案分别写实）。`workbench/css.ts` 加了两条纯新增的 drive 专属规则（武装态按钮变色 + 提示文字样式），
未触碰 chat/rail/spotlight 设置视图相关规则。

## 自查

```
pnpm --filter @workhub/ui test              → 145 tests, 145 pass, 0 fail
pnpm --filter @workhub/web test              → 68 tests, 68 pass, 0 fail（未改动 web 源码，回归确认）
pnpm --filter @workhub/desktop-webview test  → 866 tests, 866 pass, 0 fail（+9 新增：3 render.test.ts
                                                 armed 态 + 3 side-panel.test.ts 纯判定 + 3 R14 版本行为）
pnpm -r typecheck                            → 16/17 workspaces, 0 错误
git status                                   → 只有本批改过的 6 个文件（含 1 个新建的
                                                 side-panel.test.ts），无范围外改动
```

新增/改动测试清单：
- `packages/ui/src/gold-path/route-components.test.ts`：改写 R13 那两条「只提示不接线」的测试为
  R14「服务端给了 restore_href 就必须是真按钮」+ 新增「服务端没给 restore_href 的版本仍然诚实
  （无按钮+仍显示桌面提示）」+ 补一条「全都当前/可回滚时不提示」；顺带修了「Drive route explains
  restricted accepted deliverables without action links」这条既有测试里的一个 fixture 不一致（见下）。
- `apps/desktop-webview/src/workbench/drive/render.test.ts`：+4 条，覆盖武装态按钮文案/CSS 类、
  未点击时不武装、英文翻译、busy 优先于陈旧的武装标记。
- `apps/desktop-webview/src/workbench/drive/side-panel.test.ts`（新建）：+3 条，覆盖
  `decideRollbackConfirmation` 的三个分支（武装/执行/切换目标重新武装）。`mountDriveSidePanel`
  本身仍未直接单测——这个 workspace 的测试运行器没有真实 DOM（`node --import tsx --test`，无
  jsdom），`sideBodyEl` 点击处理器里的 `event.target instanceof HTMLElement` 判断在纯 Node 环境下会
  直接抛 `ReferenceError`，这是 `chat/view.test.ts`/`shell.test.ts`/`rail.test.ts` 早就记录过的既有
  环境限制，不是本批引入的新缺口。

## 我改过的断言（如有）

1. `packages/ui/src/gold-path/route-components.test.ts` 的「R13 P4 Drive route version history notes
   that restoring an older version needs the desktop client」——这条测试的前提正是本批要修的那个
   缺口本身（「服务端给了 restore_href 但 web 硬是只给提示」），按施工契约要求把它改写成「服务端给了
   restore_href 就要渲染真按钮」，理由已在上面小节写清楚，请核验。
2. 同文件「Drive route explains restricted accepted deliverables without action links」——这条测试
   只把 `vm.accepted_deliverables[0].restore_href` 置空模拟「受限」，但没有同步清空
   `vm.versions[0].restore_href`（两个数组在这份测试 fixture 里是各自独立的字面量，不像真实服务端
   那样由同一个 `accepted` 记录派生）。本批新代码会读 `vm.versions[]` 里的 `restore_href`，于是这个
   本来不该同时成立的组合（「交付物受限」但「版本历史仍标着可找回」）被测试暴露了出来——按真实服务端
   语义补上 `vm.versions[0] = { ...vm.versions[0], restore_href: undefined }`，让 fixture 回到真实
   可能出现的状态组合，断言（`length === 0`）本身没有减弱。

## 范围外发现（不修，只报）

- **`versionToVm`（`apps/api/src/services/drive-pages.ts:254-291`）目前只在版本对应一个未被取代的
  已采纳交付物时才给 `restore_href`**，纯手动上传（无关联交付物）的历史版本永远拿不到这个字段——
  这些文件在 web 端仍然只能看「需要桌面客户端」的诚实提示，没有真正的网页回滚出路。要在网页上完整
  覆盖桌面那种「任选一个历史版本回滚」的能力，需要 web 端接上批 6 新增的专用端点（GET/POST
  `.../items/:id/versions[/:id/restore]`），这需要：①`apps/web/src/browser.ts`
  加一个新的 action-id 分支（当前只有 `drive_preview` 一个特判分支类似）；②可能需要
  `packages/web-runtime/src/action-payload.ts` 加一个新的 href 匹配函数，或直接复用
  `client.request<T>` 泛型转发口（desktop 侧的 `api.ts` 就是这么做的，不需要新增
  `packages/api-client` 具名方法）。这两个文件都**不在本批的范围围栏内**（围栏只列了
  `apps/web/src/drive-actions.ts`/`drive-preview.ts`，没有 `browser.ts`），本批严格遵守围栏未碰。
- 建议后续单开一批（明确把 `apps/web/src/browser.ts` 纳入范围）来补齐这条真正的“任意历史版本回滚”
  能力；本批用已经全链路打通的「恢复已采纳交付物」管线，先把「最近一次改动」这个最常见场景的回滚
  在网页上做到有真实入口、有确认、有反馈——覆盖了绝大多数实际会被点开的文件（AI 交付物），但不是
  100% capability parity。

## 没做/存疑

- 桌面「二次确认」用的是 5 秒后自动复原的两段式点击（照 web `r9ConfirmArmed` 先例），不是弹窗/
  Confirm+Cancel 按钮对——如果人工验收希望改成常驻的「确认/取消」按钮对（对可及性更友好，无时间
  压力），这是一个可讨论的产品选择，未做决定就没改。
- 未做真机 `.app` vibrancy 截图验收（这批不涉及桌面视觉主题，只是交互逻辑），已用浏览器渲染
  `renderWebRouteComponent` 的真实产出并手工点击验证过 `<details>` 展开/收起与真实 href 拼装正确
  （见下方“视觉验证”）。

## 视觉验证（web 端，无需后端）

用真实的 `renderWebRouteComponent` 函数（非手写 HTML）渲染一份 drive 页面 VM（当前版本带
`restore_href`，历史版本不带），在浏览器里点击「找回这个版本」摘要按钮：`<details>` 正确展开，显示
准确的语义说明与一个指向 `/api/workitems/w1/deliverables/ac1/restore`（`data-action-id="drive_restore"
data-method="POST"`）的「确定找回」按钮；未带 `restore_href` 的历史版本行只显示「这里的更早版本找回
需要桌面客户端」，无按钮。

## 提交

分批 targeted commit（见下方分支历史）。
