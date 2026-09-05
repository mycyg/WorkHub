/**
 * `@workhub/mcp-client` 的**纯**入口：命名不变式、两个方向的翻译器、子进程 env 组装、静态体检。
 *
 * 这个包里没有一行 IO，也没有 MCP SDK。SDK Client、transport、握手与调用超时、per-server 重连预算、
 * 空闲回收、每次调用的审计，全部关在 `apps/api/src/services/mcp-client.ts` 一侧——
 * 照 `plugin-host/src/index.ts` 刻意不 re-export `./host.js` 的先例：SDK 在快速迭代，
 * 把它关在一个文件里，破坏性改版就只砸在那一个文件上，本包的契约不动。
 *
 * 与 `packages/plugin-host` 平级、不复用它的子进程：MCP 服务器**本来就是**独立进程，
 * 第三方代码从不进我们的模块图，再套一层自己的宿主只会多一跳。
 */
export * from "./names.js";
export * from "./content.js";
export * from "./to-tool-spec.js";
export * from "./env.js";
export * from "./precheck.js";
