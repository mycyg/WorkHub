# 桌面端连接自托管服务器：放开 CSP connect-src + 连接服务器屏

- Status: implemented
- Date: 2026-09-05
- Owner: R24 A1（桌面入口与连接链路）

## Problem

桌面端是产品核心，而团队的 WorkHub 服务器几乎从来不在本机——README 三步走部署出来的地址是
`http://<这台机器的IP>:8787`，公司部署则是 `https://…`。这条主场景此前 100% 走不通，三处硬阻断叠加：

1. **CSP 拦死出口**：`client-tauri/src-tauri/tauri.conf.json` 的 `connect-src` 只放行
   `'self' ipc: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`。局域网 IP 不匹配
   `127.0.0.1:*`/`localhost:*`，公网 https 连 `https:` 都没有——两位受检用户全部被浏览器层拒绝，
   改地址也没用。开发期从不暴露：devUrl 是 `http://127.0.0.1:1420`，Vite 把 `/api` 代理到回环，
   这个缺陷只在真实 `.app` 里发作。
2. **「连不上」不渲任何东西**：`ensureDesktopClientToken` 把所有网络失败吞成 `"unavailable"` → gate
   `"offline"`，而主窗 `bootSpotlight` 只处理 `needs-credentials`/`logged-out`，工作台 `boot()` 更是直接挂外壳。
   用户看到的是一条"正常"的空搜索条：输入什么都没结果、没有一句错误。唯一那个「服务器地址」输入框
   藏在离线卡里，而离线卡只在未捕获异常时才渲——这条路径根本不抛异常，所以那个输入框实际不可达。
3. **健康端点信息不够**：`GET /api/health` 只有 `{ok,service,env,runtime,port,ai_provider_configured}`。
   客户端想知道「这台服务器叫什么、什么版本、怎么登」只能靠「拿 identify 的 404 当探针」这类取巧手段
   （`apps/web/src/auth-screen-mode.ts` 自陈是权衡之举），版本与实例名则根本无处可取。

## Decision

**CSP 走方案 a：放开 `connect-src` 到 `http: https: ws: wss:`，把「连哪台主机」的判断交给应用层，
同批落地三道补偿控制。** 入口方向的指令一字未动（`script-src 'self'`、`object-src 'none'`、
`frame-ancestors 'none'`、无 `unsafe-eval`）；capabilities（`default.json`/`workbench.json`）只授权
window/事件权限，与网络出口无关，无需改动。

三道补偿控制（缺一不可，本批全部落地）：

- **C1 单 origin 钉死**。`packages/api-client` 新增 `resolveWorkHubApiUrl(baseUrl, path)`：拒绝带 scheme
  的绝对地址路径、拒绝协议相对地址（`//host/x`，在相对基址模式下会解析到外部主机），并断言拼出的目标
  origin 与配置的 baseUrl origin 逐字节相等。所有会带设备令牌头的出口都改走它——普通请求、`streamUrl`、
  `streams.*`（自制 fetch EventSource 也注入令牌头）。网盘资源另有一条独立 fetch（href 来自服务端响应
  的 `download_href`/`preview_href`），补 `assertDriveResourceSameOrigin` 同口径闸。先例是 DSK-08 给 run
  流 URL 加的同源校验。
- **C2 地址只能来自用户键盘输入**。连接服务器屏的输入框是唯一来源，绝不从深链、剪贴板、`window.name`
  或任何服务端响应体里自动采纳。改地址必须走「测试连接 → 看到这台服务器的信息 → 显式确认」三步：
  「使用这台服务器」在探测成功前禁用，地址一被编辑立刻重新锁上（堵死"测的是 A、确认的却是 B"）。
  探测用的客户端**不带设备令牌**（`/api/health` 无需鉴权），令牌不会被送给一台还没被确认的服务器。
- **C3 换服务器即清身份**。确认时的副作用顺序固定为：清设备令牌（含旧 `yqgl_*` 键）+ 重写认证模式提示
  → 写 `workhub_api_base` → `invoke("set_server_url", { url })`。顺序即安全属性，单测直接断言调用序列。
  壳层命令不存在/失败（浏览器 dev 态、旧壳层）时本屏照常继续，只记一行日志，绝不因此阻断用户。

**屏与触发**：新建 `apps/desktop-webview/src/desktop-connect-screen.ts`。触发条件是 gate `"offline"`
（主窗与工作台窗同层）以及主窗 boot 抛错的兜底路径。`desktop-offline-card.ts` **退役**——服务器地址
入口全仓只留连接屏这一处，不留两套。鉴权门 → 屏幕的映射收敛成 `desktopBootScreenForGate(gate, surface)`，
两个 surface 共用一张表（此前各写一遍 if 链，已经实际漂移过）。

**跨窗**：webview 侧唯一真相仍是 localStorage 的 `workhub_api_base`（三窗同源天然共享）。壳层那份
`server_url` 靠 `set_server_url` 跟随，随后广播 `workhub-server-changed`（payload `{url}`），三窗订阅后
自行 reload——复用 `workhub-logged-out` 那条既有广播模式，不另起协议。

**健康端点**：`GET /api/health` 增 `auth_mode` / `version` / `instance_name`。契约落
`packages/contracts/src/health.ts`（`serverHealthSchema`，三个新字段声明为**可选**：新客户端会连到还没
升级的旧服务端，读取端按「未知」降级，绝不因缺字段判定服务器不可用）。实例名来自新 env
`WORKHUB_INSTANCE_NAME`（默认 `WorkHub`）；版本优先取构建注入的 `WORKHUB_VERSION`，回落仓库根
`package.json`，再兜底常量。

## Alternatives considered

- **方案 b：所有 API/SSE 改由 Rust 侧代理，CSP 维持只放行 `ipc:`。** 残余风险最小（令牌可完全不进
  webview），但 Tauri v2 的 CSP 是打包期静态串，没有「按用户配置动态生成 origin 白名单」这条路——b 的
  白名单只能靠 Rust 代理强制执行，成本是重写整个数据层（所有 fetch/SSE、网盘下载、头像 blob 都要改走
  IPC，流式语义/CORS/Range 全部重验）。**作为终局保留，不阻塞 a**：它与
  `.agents/notes/proposed/2026-08-20-desktop-client-token-shell-storage.md`（令牌迁壳层，状态 proposed）
  是同一件事的两面，那份 Note 落地后 `connect-src` 的松紧对令牌外泄的影响趋近于零。
- **方案 c：宣布「打包后连远端」不支持，产品退回 web。** 等于作废桌面端作为产品核心的定位，不选。
- **只放开 `https:`、不放开 `http:`。** 挡掉了 README 三步走部署出来的局域网 `http://<IP>:8787`——
  自托管团队的第一现实形态，不可接受。
- **保留离线卡、在它旁边再加一个连接屏。** 服务器地址就会有两个入口、两套校验与两套文案，是本轮要清的
  账而不是新增的账；离线卡的能力（当前地址、原始错误、重试）已被连接屏完整覆盖，故退役。
- **让「测试连接」用当前带令牌的客户端探测。** 省一次对象构造，但等于把设备令牌发给一台用户还没确认的
  服务器——与 C1/C3 的立意直接冲突，拒。

## Consequences

- **DSK-05 的净影响**：短期风险上升（从「难以外泄」变成「可外泄」），但基线本来就是「同进程 JS 可读明文
  令牌」（`desktop-client-token.ts` 自陈）；C1/C2/C3 按住的是「被诱导连到攻击者服务器」这条更现实的攻击
  面。台账 DSK-05 原始描述是「`connect-src` 全开 + `workhub_api_base` 无校验」两件事——**校验那一半保留
  且加强，只放开 CSP 那一半**，不是回退到修复前。
- `desktop-api-base.ts` / `desktop-client-token.ts` 里「CSP 只放行本机回环」的注释已经失真，本批同步改写；
  今后任何引用「CSP 兜底」作为安全论据的地方都要先看这两处。
- 新增出口点（新的 fetch/EventSource/资源下载）必须过 `resolveWorkHubApiUrl` 或同口径的同源断言，
  否则就是 C1 的破口。
- 壳层侧的 `set_server_url` 命令、SSE 换 base、`workhub-server-changed` 广播由另一条线实现。webview 侧
  按契约 `invoke("set_server_url", { url: string }) → { url: string }`（归一化后的地址）、失败抛字符串错误
  编码，且对「命令不存在」是容错的——两条线可以独立合入，先合哪条都不会让桌面端变得更差。
- `/api/health` 的三个新字段在 openapi 里是 `required`（服务端无条件返回），但在客户端类型里是可选。
  这个不对称是刻意的，改任一侧前先读 `packages/contracts/src/health.ts` 的顶部说明。
- **三张首启屏统一到同一套液态玻璃面板（R24 I，走查 M-09）**：这张连接屏落地时是唯一用液态玻璃面板的
  boot 屏，而同一条链路上的「昵称首启/重绑屏」（`desktop-rebind.ts`）与「密码模式凭据门」
  （`desktop-login.ts`）仍是 `rgba(255,255,255,.86)` 的平白卡、420px 宽、靠 `backdrop-filter` 起毛玻璃
  ——后者在透明 + 原生 vibrancy 的 Tauri 主窗里是空操作，用户在同一次首启里会先后看到「灰底上一张白纸」
  和「一块玻璃」，与聚焦盒断层。现已抽出 `apps/desktop-webview/src/desktop-boot-panel.ts` 作为三张屏
  唯一的面板实现（字体/玻璃层/高光描边/内容层、`width:min(540px,100%)`、圆角 22px、内边距 30px、
  输入与按钮语言、页签语言，以及量高锚点 `data-desktop-boot-fit` 与继续同源于
  `desktopBootScreenFitPaddingPx` 的外壳 padding），三张屏只提供内容与自己那点补充样式；同批注入
  `appleGlassDesignSystemCss` 并给外壳挂 `.wh-ds`（模板里早就写着的 `ds-pressable` 等工具类此前从未
  注入过设计系统，一直是死类），颜色改走 `CanvasText`/`color-mix` 并补一段深色外观补偿。改面板样式时
  注意：面板里的 `p` 规则是「类 + 标签」（0,1,1），任何修饰类都必须带面板前缀才压得住它——不带前缀的
  `.wh-connect-hint` / `.wh-connect-manual` 此前就是这么被静默盖掉的。
