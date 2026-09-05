# MCP 客户端接入：桌面设置页的服务器治理分区（工包 M7）

- Status: implemented
- Date: 2026-09-06
- Owner: claude-code

## Problem

M0 到 M6 把 MCP（Model Context Protocol，模型上下文协议）服务器从契约、翻译、连接监督、治理端点、
装配接线到冒烟门整条打通了，但**没有任何人能用**：往 `mcp_servers` 表里写一行的唯一入口是
`POST /api/mcp-servers`，而仓库里没有一处界面在调它。M3 的 Note 把这件事记成一句话——
「M7 要消费的字段」——然后就停在那里。

同时有三件只有界面能回答的事，端点本身答不了：

1. **服务器名的高风险词**。`serverNameRiskTokens()` 把名字逐词问过人工保留门的真实实现，结果放在
   每个动作回执的 `risk_tokens` 里。一台叫 `finance` 或 `publish` 的服务器，它的**每一个**工具都会
   被判成高风险、每次调用都停下来转人。这是设计属性而非故障，但只在回执里躺着没人看得到。
2. **`live` 与 `status` 是两件事**。空闲回收把子进程收掉之后 `live=false` 而 `status` 仍是
   `connected`。契约刻意把它们分成两个字段，就是为了让设置页不必在「刚回收过」和「连不上」之间
   二选一地说错话——前提是设置页真的分开说。
3. **`npx` 被拦之后该怎么办**。生态里几乎每篇官方文档都写 `npx -y @modelcontextprotocol/server-github`，
   而 `mcp_remote_exec_refused` 会把它们全部挡下。不给出「先在本机装好，再填装好之后的路径」这条
   出路，用户只会以为这个功能坏了。

## Decision

### 一、分区形状一比一照抄插件分区，只多两件 MCP 独有的事

「MCP 服务器」作为一个 `wh-spot-set-group` 长在「插件」之下、`serverSectionHtml` 之上。列表行、
两段式确认、结果卡、旧服务端安静降级，全部复用插件那一批已经定型的交互与 `armedKey` 机制
（`decidePolicyRevokeConfirmation` 是纯 armed/clicked 判定，直接复用而不重写一份等价函数）。

六个动作逐条对应 M3 的端点：

| 动作 | 端点 | 确认 |
|---|---|---|
| 清单 | `GET /api/mcp-servers` | — |
| 添加 | `POST /api/mcp-servers` | 表单提交 |
| 启用 / 停用 | `POST /api/mcp-servers/:id/{enable,disable}` | 两段 |
| 测试连接 | `POST /api/mcp-servers/:id/reload` | **单段** |
| 改信任级别 | `PATCH /api/mcp-servers/:id`（`trust_level`） | 只有放宽到只读断言要两段 |
| 改调用超时 | `PATCH /api/mcp-servers/:id`（`tool_call_timeout_ms`） | 离开字段即保存 |
| 移除 | `DELETE /api/mcp-servers/:id` | 两段 |

两处与插件不同：

- **测试连接是单段**。它不改任何配置，只是问一句「现在连得上吗」；给它加一道确认是在为一个只读
  的问询收费。连不上时端点仍然回 200（M3 Note 第 2 节），所以这条**成功**路径也可能渲出一行
  「连不上」，且不弹错误提示——把一次成功的问询当成客户端自己坏了，正是那条设计要避免的。
- **改超时走 focusout 即保存**，不额外给一个「保存」按钮。值没变就一次请求都不发：空 PATCH 是 422，
  不该由「点了别处」触发。

### 二、状态与连接分开说，四种说法

`mcpStatusLine` 按 `status` 与连接快照给四种说法，`mcpReasonLine` 只在有话说时才多一行：

| 情形 | 状态行 | 补充行 |
|---|---|---|
| `disabled` | 已停用 | 无 |
| `connected` + `live=true` | 已连接 · N 个工具 | 工具数为 0 时说「连上了但它没有提供工具」 |
| `connected` + `live=false` / 无快照 | 已连接（空闲，用到时再起） | 同上 |
| `connect_failed` | 连不上 | 产品句子 + 服务端诊断（括号里的次级信息） |
| `connect_failed` + `blocked_reason` | 连不上 | 「不自动重连了，点测试连接再试」+ 诊断 |

`last_error` 与 `blocked_reason` 都是**诊断串**（`mcp server 'gh' failed 4 times…` 这种），不是界面
文案。所以走 `withErrorDetail` 的既有口径：产品句子在前，原始诊断只作为括号里的次级信息，
而不是把一句英文直接当结论渲上去。

英文单复数拆成 `mcpToolCountOne` / `mcpToolCountMany` 两条词典条目，而不是在句子里拼 `s`——
词典条目要保持纯字符串才撑得住那条 `satisfies Record<keyof typeof zh, string>` 的编译期对齐。

### 三、管理员门借 `vm.plugins !== undefined`

`settingsPageVmSchema` 目前**没有** `mcp_servers` 字段（那是工包 M8 的网页只读行要加的），所以
设计稿里写的 `vm.mcp_servers !== undefined` 这个门现在还不存在。借 `vm.plugins`：服务端只给管理员
填那个字段，而 `/api/mcp-servers` 整条端点也是管理员门（403 `mcp_admin_required`）——两者是同一个
身份判定的两个出口。非管理员连清单都不去拉，省一次注定 403 的请求。M8 落地后可原地换成同款判定。

### 四、名字里的高风险词说两次：表单上一句通则，回执上回显具体命中的词

添加表单里名字字段下方常驻一句：名字里的词会先拿去判风险，叫 `finance`、`publish` 这类名字的
服务器，它的每个工具每次都要转人确认，**和信任级别无关**。动作回执回来之后，那一行与结果卡
按 `risk_tokens` 回显**真正命中的那几个词**（不是重复一遍通则）。清单端点不带这个字段，所以
`riskTokens` 是一次次攒下来的：没做过动作的行就没有这一句，不凭空编。

同一条纪律对插件也成立——插件工具 id 是 `plugin__<插件名>__<工具名>`，`classifyHumanReservedToolCall`
对整个 id 分词——所以插件分区的信任级别说明旁补了同一句（`pluginNameRiskNote`）。

### 五、工具名前缀预览：常量复制一份，不 import `@workhub/mcp-client`

填名字时就显示 `mcp__<名字>__…` 与「工具名本身还剩 N 个字符」。算术是 `mcp__`(5) + 名字(≤32) +
`__`(2) = 最多 39 字符，64 的预算只剩 25 给服务器自己的工具名；超了就会挂指纹后缀变得难认。
预览会自然把人推向 `gh`、`fs` 这种短名。

**不 import 那个包**：① 它不是 `@workhub/desktop-webview` 的依赖，加依赖要动 package.json 与
lockfile（不在本工包允许改动的范围）；② `names.ts` 顶层 `import { createHash } from "node:crypto"`，
进浏览器包会在打包期就炸。三个常量（前缀 / 名字上限 / 工具名总长上限）复制过来，
`settings-mcp.test.ts` 有一条把三个值写死的断言，那边改了这边会想起来跟。

### 六、密钥引用：两边都只是名字

下拉只列 `available_secret_refs`（服务端上已有的变量名，**只有名字没有值**），左边填「服务器读的
变量名」，加进去之后以 `子进程变量名 → 服务端变量名` 的形式列出、可单条删掉。提交时进
`secret_refs`，值从不经过这一层——这不是省事，是这一层结构性拿不到值。

### 七、纯渲染面单独成文件

`spotlight/views/settings-mcp.ts` 只放纯函数（状态行 / 原因行 / 错误码人话 / 表单解析 / 整段 HTML），
有状态的那半（拉清单、发动作、两段式确认）仍住在 `createSettingsView` 的闭包里。理由是可证伪性：
堆进那个已经 2400 行的文件里，单测就只能从整份 `innerHTML` 里捞正则；分出来之后 30 条纯函数测试
直接对着判定写。文案纪律不变——`settings-mcp.ts` 一个中文字面量都没有，全部走 `./locales.ts`。

## Alternatives considered

- **把 MCP 分区并进 `pluginsSectionHtml`**（共用一个「扩展」标题下的两组行）。否决：两者的错误码
  空间完全不相交、动作也不一样（插件没有「测试连接」，MCP 没有「体检报告」那几条），合成一个
  渲染函数只会得到一个带模式开关的四不像。共用的是**交互模式**（两段式确认、结果卡、降级），
  那部分已经复用了。
- **整段写进 `settings.ts`**（照插件的先例一比一）。否决：见上一节的可证伪性理由。
- **改超时给一个「保存」按钮**。否决：这一层是全量 innerHTML 重绘，每个按钮都要一份 busy 态；
  而「我的资料」三个字段与插件安装路径都已经在用 focusout 收值，多一种交互模式不划算。
- **表单不做本地校验，全部交给服务端**。否决：名字/命令为空、环境变量行写成 `GITHUB_TOKEN`
  （没有等号）、超时填 10 —— 这三种填法服务端只会回一个 422，而用户要的是「哪一行不对」。
  本地拦这三种，其余（命令能不能找到、是不是 `npx`、变量名像不像凭据）一概交给服务端的启动前
  检查，界面绝不自己复制那套判定。
- **把服务端的 `last_error` 直接当状态行渲出来**（M3 Note 的字面写法「原因取 `server.last_error`」）。
  否决：它多数时候是英文诊断串，直接当结论会让中文界面突然冒出半句英文。改成产品句子在前、
  诊断在括号里。
- **给「测试连接」也加两段式确认**。否决：确认是为不可逆或撤门的动作准备的，一次只读问询不该收费。

## Consequences

- **契约缺一个字段：会话失败没有稳定码传到客户端**。`McpServerVM.last_error` /
  `McpServerConnectionVM.last_error` 都是自由文本，而 M3 的 `describeMcpSessionFailure()` 明明已经
  把 `handshake_timeout` → `mcp_handshake_timeout` 这八条映射算出来了——只是没有一个字段把码带出去。
  于是设计稿 4.5 错误态表里的 `mcp_handshake_timeout` / `mcp_no_tools` 这两条，桌面端**给不出**
  按码写的那句人话：`mcp_no_tools` 靠结构判（`connected` 且工具数为 0，这条已经落地），
  `mcp_handshake_timeout` 只能落回通用的「连不上 +（诊断）」。
  **建议后续工包给 `mcpServerVmSchema` / `mcpServerConnectionVmSchema` 各加一个
  `last_error_code`**（M3 那侧已经有现成的映射，两端 UI 按码出话的纪律才算真的贯通）。
  本工包按「契约只读」的范围纪律没有改它。
- **管理员门是借来的**。M8 给 settings VM 加上 `mcp_servers` 之后，这里的
  `visible: vm.plugins !== undefined` 应当换成 `vm.mcp_servers !== undefined`；在那之前，
  一个「有插件管理权但没有 MCP 管理权」的身份（当前服务端不存在这种身份）会看到一个必然 403 的分区。
- **真机未验**（本工包只跑了单测与类型/文案门）。浏览器预览没有 Tauri 运行时，`desktop-webview`
  渲染不出，所以以下几条只有 `.app` 走查才能确认：
  1. 添加表单在快捷入口那个会生长的玻璃盒里的高度——它比现有任何一个分区都长（九个字段 + 密钥引用
     列表），`ctx.requestResize()` 之后是否需要滚动、滚动条是否被玻璃裁掉；
  2. `<select>`（密钥引用下拉）在 macOS WKWebView 里的原生外观与 `wh-spot-delegate-select` 的
     透明背景配不配——`attention.ts` 的委派选人器是同一个类，但那是在另一种背景上；
  3. `<textarea rows="2">`（参数 / 环境变量）在 `wh-spot-freetext` 的 `min-height:64px` 下实际有多高；
  4. focusout → click 的先后顺序：表单靠「点按钮时浏览器先派 focusout」才能读到刚敲进去的值。
     这条在插件安装路径上已经真机验过，WKWebView 里应当一致，但 MCP 表单一次有九个字段，
     值得再看一眼；
  5. 一台真的连不上的服务器（比如命令指向一个非 MCP 的可执行文件），行内那句「连不上 +（诊断）」
     在窄栏里的换行。
- **`window-bridge.ts` 一个字没改**。这一分区全部走 `ctx.client` 的 HTTP 面，不需要任何壳层能力
  （不像头像预览那样要走授权 fetch，也不像登出那样要清 Rust 侧令牌）。
- **新增文件两个**（`settings-mcp.ts` / `settings-mcp.test.ts`），`docs/workhub/*.md` 一篇没加，
  `qa:r2-release-gate` 的 `docs.count` 门不受影响。
