/**
 * `@workhub/plugin-host` 的**纯**入口：线协议、env 白名单、两个方向的翻译器。
 *
 * 刻意**不**在这里 re-export `./host.js`——那个模块 import `@deepseek-ai/cordis`，
 * 是插件宿主子进程独有的运行时。`apps/api` 只该拿到这里的东西，Cordis 与 dsh 的
 * 依赖面就永远关在子进程那一侧（报告风险 3 的缓解手段）。宿主入口走 `@workhub/plugin-host/host`。
 */
export * from "./protocol.js";
export * from "./env.js";
export * from "./translate.js";
export * from "./to-tool-spec.js";
