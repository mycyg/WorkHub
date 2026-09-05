# @workhub/mcp-client

MCP（Model Context Protocol，模型上下文协议）服务器接进 WorkHub 的**纯翻译层**。

一台 MCP 服务器把一组工具通过 JSON-RPC 暴露出来，我们把它们翻成 `ToolSpec` 喂给模型。
本包只做翻译与判定：工具名的命名空间与不变式（`names.ts`）、工具定义到 `ToolSpec` 的逐字段映射
与读写分级（`to-tool-spec.ts`）、结果内容块到模型可见文本的中和与上限（`content.ts`）、
子进程环境变量的白名单与引用式密钥（`env.ts`）、添加服务器前不执行任何东西的静态体检（`precheck.ts`）。

**零 IO、零 MCP SDK 依赖。** 连接、超时、重连、审计属于 `apps/api/src/services/mcp-client.ts`，
不在这里。翻出来的 `ToolSpec` 走既有注册表通道，于是自动继承 `canUse` 双检、快照门、
人工保留拦截与审批链——授权判断始终在 API 进程这一侧，服务器只提供能力实现。

`qa/fixtures/` 是常量夹具（一台假服务器的 `tools/list` 样例），供跨包的 golden 测试离线复用。
