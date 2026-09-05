/**
 * 测试里捕获一段异步代码期间写到 stdout / stderr 的内容（结构化日志走的就是这两条流），**同时原样透传**给真正的流。
 *
 * 为什么不能整段替换 `process.stdout.write` 再在 finally 里还原：`node --test` 把每个测试文件放在子进程里跑，
 * 父进程靠解析子进程 stdout 里的 TAP 行（`ok N` / `not ok N`）来计数与判定；报告器对**上一条**测试的 `ok N` 行是
 * 异步写出的——它一旦落在下一条测试整段替换 `process.stdout.write` 的窗口里，就被吞进测试自己的数组、永远到不了
 * 父进程，那条测试便从汇总里悄悄消失（`# tests` 变少，`# fail` 仍是 0，退出码仍是 0）。透传写法下报告器的行照常
 * 流出，捕获方按内容过滤自己关心的日志行即可。stderr 不承载 TAP，但同一套写法同样会吞掉别人的输出，统一走这里。
 *
 * 门禁 `scripts/dev/check-test-conventions.ts`（`pnpm audit:test-conventions`）会拒绝测试文件里对这两条流 `write` 的赋值。
 */
export async function captureStreamLines<T>(
  stream: NodeJS.WriteStream,
  run: () => Promise<T> | T
): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = stream.write;
  const tee = function (this: unknown, chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return (original as (...args: unknown[]) => boolean).apply(stream, [chunk, ...rest]);
  } as unknown as typeof stream.write;
  stream.write = tee;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    // 只在没人在我们之后再包一层的情况下还原，避免把别人的包装一起拆掉。
    if (stream.write === tee) {
      stream.write = original;
    }
  }
}

export function captureStdoutLines<T>(run: () => Promise<T> | T): Promise<{ result: T; lines: string[] }> {
  return captureStreamLines(process.stdout, run);
}

export function captureStderrLines<T>(run: () => Promise<T> | T): Promise<{ result: T; lines: string[] }> {
  return captureStreamLines(process.stderr, run);
}
