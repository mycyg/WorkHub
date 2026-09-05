# 测试捕获日志改为「捕获且透传」，禁止整段替换 process.stdout.write

- Status: implemented
- Date: 2026-09-06
- Owner: claude-code

## Problem

三处测试（`apps/api/src/agent-runs.test.ts` 两处、`apps/api/src/broker.test.ts` 一处，另有 `packages/tools/src/migration-audit.test.ts` 一处替换 stderr）为了断言「某条结构化日志确实发出」，把 `process.stdout.write` 整段换成往数组里推、`return true`，finally 再还原。M4 工包照抄这个写法时发现同文件里没患过 stdout 的相邻测试从汇总里消失（定义 7 条、报告 5 条，`# fail 0`、退出码 0）。

机制：`node --test` 把每个测试文件放子进程跑，父进程解析子进程 stdout 的 TAP 行（`ok N`）计数；报告器对上一条测试的 `ok N` 行是异步写出的，若恰好落在下一条测试替换 `process.stdout.write` 的窗口里，就被吞进数组、到不了父进程。既有的两处现场在 `agent-runs.test.ts` 单文件直跑三次都是 115/115，没有掉数——只是时序凑巧（上一条测试的报告行在窗口打开前已经刷出），不是写法安全。

## Decision

- `@workhub/tools/test-support`（`packages/tools/src/test-support/capture-stream.ts`）提供 `captureStreamLines` / `captureStdoutLines` / `captureStderrLines`：捕获窗口内写出的每一块，同时原样调用原 `write` 透传；finally 只在没有被再包一层时还原。
- 四处现场全部改用它；断言方式不变（仍按事件名过滤捕获到的行）。
- 新门禁 `scripts/dev/check-test-conventions.ts`（`pnpm audit:test-conventions`，进 `lint` 链与 `test:scripts`）：`apps/**`、`packages/**` 下 `*.test.ts` 出现 `process.stdout.write =` / `process.stderr.write =` 赋值即红，指路助手。
- AGENTS.md 测试纪律加一条。

## Alternatives considered

- 只改断言为可观测行为、放弃日志断言：M4 在自己的文件里这么做了；但「关键失败必须进结构化日志管道」本身就是 R4 缺口①的产品要求，日志断言值得保留。
- 给结构化 logger 加可替换的默认单例（测试注入 sink）：要在产线代码里开测试专用口子，且解决不了其它直接写 stdout 的来源；透传包装覆盖面更广、零产线改动。
- 用 `t.mock.method(process.stdout, "write")`：mock 默认不调用原实现，同样吞行；要配 `{ implementation }` 手写透传，等于把助手在每处再写一遍。

## Consequences

- 捕获数组里会混进报告器的 TAP 行，按内容过滤即可（现有断言都是 `includes(event)` / `JSON.parse` 后按 `event` 过滤，不受影响）。
- 门禁只认赋值语法，认不出其它形式的吞流（比如 `Object.defineProperty`）；出现时按同一条纪律处理。
- 助手经 `@workhub/tools` 的 `./test-support` 子路径导出，`tsconfig.base.json` 加了同名 alias。
