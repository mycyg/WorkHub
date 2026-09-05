# MCP 客户端接入：稳定错误码、网页只读清单与三条文案遗留（工包 M8）

- Status: implemented
- Date: 2026-09-06
- Owner: claude-code

## Problem

M7 把桌面设置页接通之后，留下三件互相咬合的事：

1. **连不上的原因没有码**。`describeMcpSessionFailure()` 在 M3 就把八条会话失败原因翻成了
   `mcp_handshake_timeout` 这样的稳定码，但没有一个字段把码带出去——`McpServerVM.last_error` 与
   `McpServerConnectionVM.last_error` 都是自由文本。于是设计稿里那句「握手超时」桌面端**给不出**，
   只能回落到通用的「连不上 +（英文诊断）」。M7 的 Note 把这一条明写成建议留给后续工包。
2. **网页端一台服务器都看不见**。`mcpServerSummaryVmSchema`（网页只读行的裁剪口径）从 M0 起就在契约里
   躺着，没有任何一处填它、也没有任何一处渲它。一个只有网页的管理员无从知道这个部署接了什么。
3. **F2 的两条遗留**。设置页「系统诊断」分区对普通成员仍然渲染（A2-45）；五个 service 里还有约 10 处
   「事项 / 工单」没按 glossary §11 收口成「任务」。

## Decision

### 一、码从内存来，因为表里没有存码的列

`last_error_code` 加在三个读形状上（`McpServerVM` / `McpServerConnectionVM` / `McpServerSummaryVM`），
枚举是 M3 那八条 `mcp_*` 加上 `mcp_connect_failed` 兜底。**没有加 DB 列**：那需要一次迁移，而
`packages/db` 不在本工位的改动范围；更重要的是加了列也只是把同一份信息存两遍——行上的 `last_error`
已经是那次失败的诊断，码是它的分类。

于是码来自**本进程的连接快照**：`McpServerStatusSnapshot` 多一个 `lastErrorReason`（原因枚举），
`toMcpServerVm(row, snapshot?)` 与 `toConnectionVm(snapshot)` 在有诊断文本时把它翻成码。
**行上有诊断、这个进程却没有那台服务器的连接记录时（重启之后、或从没启用过），码缺席**——
那是如实的「这一次的原因这个进程说不出来」，界面回落到通用的一句话，而不是编一个它并不知道的原因。
契约注释与两处测试都把这条写死了。

**翻码固定发生在 `services/mcp-servers.ts`**，M2 的连接监督只回原因枚举。理由是循环：
`mcp-servers.ts` import `mcp-client.ts`，反过来去取那份映射会绕成一个环；复制一份则是第二份会漂移的
词表。新导出的 `mcpSessionFailureCode(reason)` 与既有的 `describeMcpSessionFailure(error)` 共用同一张
`SESSION_FAILURES`，测试里有一行断言两个出口给同一个码。

### 二、网页只读清单：结构性缺席，而不是隐藏

`settingsPageVmSchema` 加 `mcp_servers?: McpServerSummaryVM[]`，路由与插件清单**同一道管理员门**：
非管理员时服务端不取不填，字段结构性缺席（不是空数组——空数组会被读成「一台都没接」），整区不渲。
取数失败降级为不渲这一区，不拖垮整页设置。

行的形状是裁剪过的 summary：命令、参数、环境变量、密钥引用、工作目录**结构性没有位置**，
`last_error` 也没有——它是宿主机的现场诊断（可执行文件路径、stderr 尾巴），和命令、工作目录属于同一类
不该上网页的事实。**只有码能上网页**：码本身不含宿主机信息，却足以让这一行说出「服务器没有在规定
时间内应答。」而不是笼统的「连不上」。

状态四种说法各说各的，与桌面端同一套判据：已停用 / 已连接 · N 个工具 / 已连接 · 它没有提供工具 /
连不上。第三种是刻意与第四种分开的——「连上了但一个工具都没有」和「连不上」下一步动作完全不同。
空态一句话加一句去处（添加、启停和移除在桌面客户端的设置里操作），与插件区同款分工。

### 三、A2-45：系统诊断整段不进 HTML

并发处理能力、消息通道、数据存储、用哪个模型、密钥配没配——这几行是部署的运行事实，普通成员既判断
不了也调不动。与成员 / 预算策略 / 工作区审计三区同一道门（`isAdmin`），整段不渲染而不是 `hidden`。
分区抬头随之从「系统诊断（管理员关注；普通成员只读参考）」改成「系统诊断（仅管理员）」——旧那句话
在成员看不到这一区之后就不成立了。

`data-r4-settings-runtime-status` 留在外壳那一层（它是路由自检读的标记，不是渲给人看的一行），
成员那一侧仍然有，`apps/web/qa` 的实时冒烟以管理员身份登录，两处都不受影响。

### 四、五个 service 的「事项 / 工单」：搬进词典再改词，不就地改

门禁按「文件 + 归一化片段」记棘轮，就地改一句话会同时产生「基线条目已消失」与「新增违规」。所以改到的
每一句都搬进 `services/locales.ts`（F2 建的那份），基线**只删不加**：净减 13 条，
`work-item-comments.ts` 整份从基线里消失。「及其余 N 项」在停滞段与临期段本来是同一句话写了两遍，
一并改成共用一条词典条目。

**只改用户可见文案**。`conversation-turns.ts` 里那几句 `content` 是回填给模型的 `tool_result` 文本，
与 `packages/agent` 的提示词（`turn-system-prompt` 等 golden 基线里仍写着「工单」）是同一片文本，
要改得一起改；`auditSummary` 走的是 `tool_note` 透明日志，用户在聊天里看得见，所以改。

## Alternatives considered

- **给 `mcp_servers` 表加一列存错误码**。否决：需要迁移（`packages/db` 不在本工位范围），而且行上的
  `last_error` 已经是那次失败的诊断，码只是它的分类——存两遍必然有一天对不上。代价是重启后码缺席，
  但那一条被明确写进契约注释并有测试钉住，比一个可能过期的持久化码诚实。
- **让 `mcp-client.ts` 自己算码**（把 `SESSION_FAILURES` 复制过去或反向 import）。否决：反向 import 绕成
  循环，复制则是第二份会漂移的词表。回原因枚举、由上一层翻码，两边都只有一份事实源。
- **网页只读行也带 `last_error`**。否决：那是宿主机现场诊断，与结构性不给 `command` / `cwd` 位置是同一条
  理由。码不含宿主机信息，够用。
- **网页也给「已连接（空闲，用到时再起）」那种说法**（桌面端有）。否决：网页只读行拿的是行上的状态，
  拿不到「此刻还有没有活着的子进程」；硬渲一个它不知道的区别只会说错话。
- **A2-45 用服务端结构性缺席**（`buildSettingsPage` 对非管理员不填 `runtime` / `llm_runtime`）。否决：
  两个字段在 `settingsPageVmSchema` 里是必填的，改成可选会波及所有读它们的地方，而收益只是把一道已经
  存在于渲染层的门再挪一次位置。成员 / 预算策略 / 工作区审计三区的先例就在渲染层。
- **五个 service 就地改词、把基线条目改名**。否决：那不叫「基线只减」，只是把同一笔账换个写法记着。

## Consequences

- **桌面端还没消费 `last_error_code`**。M7 已定型，本工包没有动 `apps/desktop-webview`。
  `settings-mcp.ts` 的 `mcpReasonLine` 现在可以按码出话（`mcp_handshake_timeout` 那句人话就是 M7 的
  Note 里说「给不出」的那一句），但那是下一个动桌面端的工包的事。
- **M7 借来的管理员门可以换掉了**。`settings.ts` 里 `visible: vm.plugins !== undefined` 现在有了同款的
  `vm.mcp_servers !== undefined`，换成后者更贴切；同样留给下一个动桌面端的工包。
- **OpenAPI 里设置页响应此前结构性不合法**：`settingsPageResponseSchema` 是
  `additionalProperties: false`，却没有列 `permission_policies` 与 `plugins`——一份真实的管理员响应
  按这份文档是不合法的。补 `mcp_servers` 时把那两条一并补上。
- **`apps/web/qa/r4-web-live-route-interaction.ts` 断言 `[data-r4-settings-runtime]` 与
  `[data-r4-settings-llm]` 存在**，它以管理员身份登录（`is_admin: nickname === "R4 Live Reviewer"`），
  A2-45 之后仍然成立，未改 qa。
- **模型可见文本零变化**：`pnpm gen:expected` 两次运行都无 diff。
- **棘轮基线只减**：ui-i18n 2808 → 2795（净减 13）；禁词基线 49 条不变。
