# 桌面端删硬编码昵称首启 + 模式感知登录屏 + 首启落地卡（R24 S4/S6）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R24 侦察报告 `r24-S1-entry-connection.md` 第 3/4/6/7.1/7.4 节，S4+S6 切片）

## Problem

侦察报告 E-03 点名的根因：`browser.ts:113-117` / `workbench/boot.ts:102-106` 首启无 token 时
**盲打** `POST /api/auth/desktop-bootstrap`，请求体硬编码 `nickname: "WorkHub Desktop"`。服务端
`getOrCreateActiveByNickname`（`packages/db/src/repositories/users.ts`）按昵称查已有 active 用户，
命中即复用——全团队装同一个 `.app` 首启会静默塌成服务器上的同一个人：消息、审批、个人记忆全混，
且用户从来没被问过「你是谁」（问昵称的那张屏 `desktop-rebind.ts` 此前只在显式登出后才可达）。

密码/hybrid 模式桌面端也没有注册屏、没有接受邀请屏（E-05）：受邀用户必须先离开桌面端、开浏览器
接受邀请设密码，才能回桌面登录，README/DEPLOY 都没提这回事。

首次登录成功后落地页永远是空的能力网格（E-10），不提示先建一个项目；只用 Spotlight 聚焦盒的用户
（产品主推的用法）看不到「AI 服务未配置」这条事实——那条提示只存在于工作台聊天区（E-11）。

## Decision

**S4（模式感知登录，删硬编码昵称自动 bootstrap）**：

1. 新增 `desktop-login.ts` 的 `resolveDesktopFirstRunGate(WithLock)`：首启无 token 时，先读已记的
   `workhub_auth_mode` 提示，没有就探 `GET /api/health` 的 `auth_mode` 字段（按可选字段防御性读取——
   契约扩充是并行 S3 切片的施工范围，未落地也不影响这里工作）。探测本身**没有任何创建账号的副作用**，
   只决定该渲哪张登录门；跨窗锁复用既有 `runDesktopBootstrapWithLock`（`run()` 从「建设备的 bootstrap
   调用」换成「纯判定」），价值收窄为「另一扇窗口这段时间已经完成登录时直接沿用其 token」。
2. 昵称模式首启复用 `desktop-rebind.ts` 的重绑屏，加 `context: "first-run" | "logged-out"`
   （默认 `"logged-out"`，与既有「已登出」文案字节级不变）区分标题/说明；提交后如果探到 404
   （`isPasswordModeBootstrapError`，说明首启的默认假设猜错了、其实是密码模式），
   `onPasswordModeDetected` 回调让调用方就地切到凭据门，不需要用户自己诊断。
3. 密码/hybrid 凭据门（`desktop-login.ts` 的 `renderDesktopCredentialGateHtml`/
   `bindDesktopCredentialGate`）加两个页签：**注册**（`client.register`）与**我有邀请令牌**
   （`POST /api/auth/invites/accept`，走裸 `client.request`——同 web 端 `submitInviteAccept`
   的既有取舍，不为一次性端点扩大 `WorkHubApiClient` 具名方法面）。两者成功后都走既有
   `desktop-bootstrap` exchange 换 `client_token`，响应的 `identity.created` 落一个新的本地首启标记
   （`desktop-first-run.ts`）。
4. 三个窗口都接线：主窗（`browser.ts`）渲重绑屏/凭据门；工作台窗（`boot.ts`）密码模式同样渲凭据门，
   昵称模式首启复用既有「整窗登出态」机制（`shell.ts` 的 `showLoggedOut`/
   `renderWorkbenchLoggedOutHtml` 加 `context` 参数）——工作台本就不拥有登录 UI（既有注释：
   「那是主窗地盘」），首启同样只提示去主窗口；桌宠窗（`pet-surface.ts`）boot 前置探测结果传入
   `bootDesktopPetSurface` 的新 `signInNeededContext`，非 ready 直接亮「去主窗口登录」卡
   （`createDesktopPetLoggedOutCard` 加 `context` 参数），跳过卡片恢复/待拍板浮现。

**S6（首启落地卡 + AI 未配置横幅）**：

1. `desktop-first-run.ts`：单一标记 `workhub_desktop_identity_created`，登录/注册/邀请/重绑成功后
   照实落 `identity.created`（登录 `runDesktopCredentialLogin` 不摸这个标记——回到一个已有账号不是
   「首次」，但也不该替用户清掉一个可能仍然有效的「还没建过项目」事实）。Spotlight 落地页
   （`browser.ts` 的 `bootSpotlight`）据此算 `firstRun` 传入 `mountSpotlight`。
2. `spotlight/controller.ts`：launcher 空查询时，`firstRun` 为真则渲「建你的第一个项目」引导卡
   （新 `renderFirstRunCardHtml`，复用 `wh-spot-intake-*`/`wh-spot-freetext--line` 既有视觉词汇），
   而不是空网格/hello。提交调 `client.bootstrapProject({name})`，成功后 stash 深链目标 + invoke
   `open_workbench`（同 `spotlight/views/workbench-open.ts` 的既有手法）直接打开该项目，并回调
   `onFirstRunComplete`（`browser.ts` 落 `markDesktopOnboarded`）——同一次会话内立刻回落普通启动器，
   不需要 reload。非 Tauri 预览环境没有原生窗口可开，用 toast 如实说明，项目仍然建成功。
3. 聚焦盒顶部新增 AI 未配置横幅：把 `workbench/chat/render.ts` 里那句「AI 服务未配置…」抽成共享
   字符串（新 `ai-provider-banner-copy.ts`），Spotlight 与工作台聊天区共用同一句话；只在
   `health.ai_provider_configured === false` 时揭开，探测失败（`undefined`）不渲——同工作台聊天区
   `shouldShowNoAiProviderBanner` 的既有取舍，探测失败不等于没配置。

## Alternatives considered

- **继续用「盲打 bootstrap + catch 404」探测模式，只是把硬编码昵称换成一个随机值**：治标不治本——
  随机昵称依然会在昵称模式下真实建一个账号，用户依然没被问「你是谁」。被否。
- **首启也套用 DSK-07 的跨窗锁去保护"探测"本身，且探测失败时直接判定成密码模式（更保守）**：
  探测失败可能只是网络抖动，误判成密码模式会把 LAN 信任模式的用户（本仓库默认场景）扔进一个陌生的
  邮箱密码表单；照抄 `apps/web/src/auth-screen-mode.ts` 的 `detectAuthScreenMode` 既有取舍——
  不确定时按现状最常见的 nickname 处理，猜错了有 404 兜底纠正。
- **工作台窗昵称模式首启也建一张完整的输入昵称表单**：工作台本来就有明确的设计决策「不拥有重新
  登录 UI」（`shell.ts` 顶部注释），复刻一份等于推翻这个决策、还要多维护一份重复 UI。被否，改用
  既有的整窗替换态 + context 换文案。
- **邀请接受在 api-client 里加一个具名 `acceptInvite` 方法**：web 端已经为同一个端点选择了「走裸
  `client.request`，不扩大具名方法面」（`apps/web/src/browser.ts` 顶注 + `workbench/rail.ts`
  `submitNewPersonalSpace` 的同款先例）——跟随既有先例，不引入不一致。
- **首启判定单纯依赖 `identity.created`，reload 后靠传参延续**：`reload()` 会清空所有运行时状态，
  这个信号必须落本地存储才能跨 reload 存活；改用 `desktop-first-run.ts` 的持久标记。
- **`.wh-spot-intake` 首启卡直接扔进 `.wh-spot-grid` 不做任何调整**：两列网格会把单个卡片挤成半宽——
  实际验证发现后补了 `.wh-spot-grid>.wh-spot-intake{grid-column:1/-1}`。

## Consequences

- 首启不再有任何会创建账号的静默网络调用；`resolveDesktopFirstRunGate` 本身无副作用，纯粹是「读
  一次健康检查 + 读一次本地提示」，可以放心被多个窗口并发调用而不必担心竞态创建重复账号。
- `runDesktopBootstrapWithLock` 的语义从「保护会创建账号的调用」变成「省一次重复判定/尽早拿到旁窗
  的 token」——**日后任何新增的桌面首启信号判定都应该走这条锁**，不要再各写一份。
- 昵称首启默认假设猜错（真实是密码模式但探测失败）时，用户会先看到昵称屏、提交后才切到凭据门——
  多一次提交往返；这是「探测失败时保守偏向不吓用户」的既定取舍，接受这个小代价。
- 首启标记只对**这一次**成功建号生效；如果注册成功但设备令牌 exchange 因网络中断失败，标记不会落
  （函数在拿到 `client_token` 之前就已经抛出），用户之后改用「登录」重新进来会看到普通启动器而非
  引导卡——已知的、可接受的边界情况（用户仍可通过工作台既有「新建项目」CTA 手动建第一个项目）。
- `DesktopLoginClient` 类型从「仅 login+bootstrapDesktop」加宽为「login+bootstrapDesktop+register+
  request」——这是给 `bindDesktopCredentialGate` 用的组合型（同 `workbench/rail.ts`
  `WorkbenchRailApiClient` 的既有先例：一个类型服务一整块 UI 功能，不是每个子流程各拆一个）；
  两处既有测试的假客户端补了 `register`/`request` 桩字段。
- `mountSpotlight` 本身依旧没有任何直接单测（这个函数在本次改动前就是如此——DOM 编排类函数在这个
  代码库里统一靠 typecheck + 真机/浏览器验证兜底，不是本次改动引入的新缺口）；新增的纯函数
  （`renderFirstRunCardHtml`、`resolveDesktopFirstRunGate` 系列、`runDesktopCredentialRegister`/
  `runDesktopInviteAccept` 等）全部有单测覆盖。
- 并行 S3 切片（`/api/health` 扩 `auth_mode` 字段）落地前，`probeDesktopAuthMode` 读到的永远是
  `null`（字段不存在），首启会一律默认按昵称模式渲重绑屏——这是刻意的向后兼容默认值，S3 落地后
  无需改这份代码，`auth_mode` 一出现就会被正确识别。
