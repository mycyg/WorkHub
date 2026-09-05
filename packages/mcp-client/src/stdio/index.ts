/**
 * `@workhub/mcp-client/stdio`：**带 IO** 的那一半——换行分隔的 JSON-RPC 2.0 线协议与
 * 一台 stdio MCP 服务器的会话（工包 M2）。
 *
 * 刻意走一条独立的子路径导出，而不是挂进 `../index.ts`：主入口的合同是「零 IO、可以在任何地方
 * import 而不会碰进程/文件/网络」，`packages/plugin-host/src/index.ts` 刻意不 re-export
 * `./host.js` 是同一条先例。连接监督、重连预算、审计再往上一层，在
 * `apps/api/src/services/mcp-client.ts`。
 */
export * from "./jsonrpc.js";
export * from "./session.js";
export * from "./spawn.js";
