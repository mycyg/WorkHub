# MCP 客户端接入：纯翻译包 packages/mcp-client（工包 M1）

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code

## Problem

MCP（Model Context Protocol，模型上下文协议）服务器要接进 WorkHub，需要一层把「服务器自报的
工具定义」翻成 `ToolSpec` 的东西。这一层看着像胶水，实际上压着四件只要写错一次就很难发现的事：

1. **工具名会坍缩。** 跨服务器重名是常态不是意外——设计稿引的调查里，1470 台服务器出现 775 个
   重名工具，光 `search` 一个名字就出现在 32 台上。两台服务器的两个不同工具一旦拿到同一个公开名，
   模型以为在调 A 的 `search`、实际打到 B 上。这不是显示问题，是把调用送错了目的地。
2. **全按最高风险对待等于产品不可用。** `agent-runner.ts` 对 `external_effect` 会算出 external
   风险类，而 `human-reserved-guard.ts` 对**有风险类的调用一律开升级**，不管工单是否被标人工保留。
   照插件阶段 0 的口径把 MCP 工具全钉成 `external_effect`，等于管理员每装一台服务器、Cuu 每调用
   一次就停下来转人一次——而 MCP 生态里占大头的恰恰是只读检索。
3. **工具结果是第三方文本，且有一条二段式逃逸。** 结果本身进 tool_result 消息、不在围栏里，
   但它常被工人原样抄进 `outputs/` 与自述，那两条确实要进评审围栏。服务器回一行字面的
   `</outputs>` 就能在第二段提前闭合围栏。插件那侧的结果同样没过中和，也没有长度上限。
4. **凭据要给出去，又不能落库。** MCP 服务器与插件不同，它**必须**能拿到配置与凭据才有用，
   而插件宿主的 env 白名单是「一个配置键都不给」的形状。

这个工包只做纯函数那一半：零 IO、零 MCP SDK 依赖，SDK Client、连接监督、超时与审计留给 M2。

## Decision

新建 `packages/mcp-client`，与 `packages/plugin-host` 平级而不复用它的子进程（MCP 服务器本来就是
独立进程，第三方代码从不进我们的模块图，再套一层宿主只会多一跳）。五个纯模块：

- **`names.ts`**：`mcp__<服务器>__<工具>`，非法字符压 `_`；**只有改名有损时**（字符被压过或总长
  超 64）才追加 12 位 SHA-256 指纹。指纹喂的是原始输入而不是压缩后的串——否则压完同形的两个名字
  会得到同一个指纹，指纹就白加了。反方向刻意不提供：反解需要「压缩可逆」，而这件事本来就不可逆。
- **`to-tool-spec.ts`**：逐字段映射 + 读写分级真值表。最终 `sideEffect` = **管理员断言
  （`trust_level`）AND 服务器自述（`readOnlyHint === true` 且 `destructiveHint !== true`）**，
  任何缺省取最高风险。`inputSchema` 直通但设两条硬闸：序列化超 32KB、或含取不到的 `$ref`，
  丢弃该工具（截断一份 JSON Schema 只会产出无效 schema，让整轮请求 400）。
- **`content.ts`**：非 text 块留占位、过围栏中和、32KB 上限带截断标记。
- **`env.ts`**：白名单基座 + 引用式密钥（填指针不填值），引用只能指向 `WORKHUB_MCP_SECRET_`
  命名空间，解析不到就 fail-closed。
- **`precheck.ts`**：不执行任何东西的静态体检，命令存在性由调用方查好传进来。

三条**在设计稿之外收紧**的判断，逐条给理由：

1. **引用式密钥必须带 `WORKHUB_MCP_SECRET_` 前缀。** 设计稿只在正文里给了这个形状的例子。
   不把它提成硬规则，引用式密钥就是一个绕过整个白名单读任意环境变量的原语——管理员填一个指向
   `COOKIE_SECRET` / `DATABASE_URL` / `LLM_API_KEY` 的引用，就能把 API 进程的任何变量递给第三方
   服务器。也不能改用凭据形状黑名单兜底：`WORKHUB_MCP_SECRET_GITHUB` 自己就命中 `SECRET`。
   只能用显式命名空间来划。因此体检项是 8 条（多一条 `secret_ref_scope`），不是设计稿表里的 7 条。
2. **`$ref` 只放行同文档片段（`#` 开头）。** 设计稿点名的是 `http:` / `file:` 两种。收得更紧的
   理由是「拒绝一份我们解析不了的 schema」比「逐个 scheme 追着堵」稳——相对路径引用同样取不到。
3. **`minScope` 里的服务器名要先压过一遍。** 一个含 `*` 或 `:` 的名字能伪造出 `mcp:*:read` 这样的
   scope 字面量，把封禁规则的语义整个绕过去。治理层已经拦过一道，这里是第二道：scope 字符串是
   安全判断的输入，不该依赖上游拦干净。

## Alternatives considered

- **复用 `packages/plugin-host` 的子进程宿主。** 否决：会变成两跳 RPC、两层超时叠加，而且宿主的
  env 白名单连覆盖 `PATH` 都拒，MCP 服务器根本拿不到它需要的配置与凭据。生命周期也不同——
  插件宿主可随时 LRU 关掉重建，MCP 是有状态长连接，照「清单一变就换进程」管会反复掐断在飞调用。
- **照 harness 用黑名单过滤父进程 env。** 否决：`env.ts` 里已经写下过这条判断，黑名单漏一个
  `MY_COMPANY_PAT` 就全给出去了。测试里专门钉了这条（那个键不像凭据、也不在白名单里，所以拿不到）。
- **每个公开名都挂指纹。** 否决：会让 `mcp__gh__create_issue` 变成带 12 位十六进制尾巴的名字，
  白吃掉本就只剩 25 字符的预算，也让人对不上服务器文档里的名字。只在有损时挂，是本包最容易写反的
  一条，所以正反两向各有测试。
- **把 `human-reserved-guard` 的高风险词表复制进本包。** 否决：两份词表迟早漂移，而漂移的后果是
  预告与真实判定不一致。改成只镜像**分词逻辑**，词表由调用方传进来。
- **阶段 0 全 `external_effect`、分级留到阶段 1。** 由指挥者拍板合并交付（见 Problem 第 2 条）。
- **在本包重实现一份 JSON Schema 校验器。** 否决：服务器自己声明了 `inputSchema`，重实现既重复又
  容易和服务器不一致。入参只要求「是个对象」加一个 256KB 上限，模型看到的形状走 `jsonSchema` 旁路。

## Consequences

- **模型可见文本零变化。** 本包还没有任何消费者，`pnpm gen:expected` 后 `git status` 干净。
  MCP 工具的 golden 由 M6 用本包的常量夹具新建，且不许改动任何既有 expected 文件。
- **M1b 的合并点（本包留了两处复制）**：`content.ts` 的 `sanitizeModelFacingText` 与
  `neutralizeMcpFenceTags` 分别复制自 `plugin-host/src/to-tool-spec.ts` 的 `sanitizePluginText`
  与 `packages/agent/src/loop/loop.ts` 的 `neutralizeFenceTags`。三者的归宿都是 `packages/tools`，
  M1b 一起收进去，本包与 plugin-host 各改一处 import。在那之前，`content.test.ts` 有一条**对着
  loop.ts 源码核对围栏标签表**的漂移守卫：那边加了新围栏标签而这边没跟上，测试会红。
  loop.ts 挪了位置就改那条测试里的路径，别删它。
- **给后续工包的三条硬信息**：① 体检项枚举 8 条，M0 的契约与 M3 的错误码映射要按 8 条写；
  ② 错误码里有 4 条是设计稿表外补齐的（`mcp_server_name_invalid` / `mcp_args_invalid` /
  `mcp_env_overrides_base` / `mcp_secret_ref_out_of_scope`），`mcpPrecheckErrorCode` 已经实现好，
  M3 直接用不要再 derive 一份；③ 描述符类型留在本包内、不进 `packages/contracts`，照
  `PluginToolDescriptor` 留在 plugin-host 的先例。
- **服务器名会参与人工保留门的分词。** 一台叫 `finance` 的服务器，它的每个工具都会被归到财务类、
  每次调用都升级。这是设计属性（起名等于打风险标签），但 M7 必须在添加服务器的界面上写出来，
  否则一台叫 `publish` 的服务器会让所有工具无差别升级，用户只会以为坏了。本包出了
  `mcpServerNameRiskTokens` 给那句提示用。
- **本包自己不碰 IO**，但为了复用凭据形状黑名单而依赖 `@workhub/plugin-host`，它的 barrel 里
  `bundled-versions` 用到 `node:fs`（惰性、我们从不调用）。想要一张完全无 fs 的模块图，正确做法是
  给 plugin-host 加一个 `./env` 深路径导出，而不是在这里复制一份黑名单——那属于 M1b 的范围。
- **代价说清**：某些 MCP 服务器依赖 `HTTPS_PROXY` / `NO_PROXY` 才能出网，白名单里没有这两个键。
  要加就显式加进白名单并过一条 Agent Note，不能顺手加。
