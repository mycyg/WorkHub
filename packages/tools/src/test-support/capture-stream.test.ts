import assert from "node:assert/strict";
import test from "node:test";

import { captureStderrLines, captureStdoutLines } from "./capture-stream.js";

test("captureStdoutLines 捕获窗口内写出的行，且透传给真正的 stdout（报告器的 TAP 行不会被吞）", async () => {
  const original = process.stdout.write;
  const forwarded: string[] = [];
  // 外层先包一层记录「真的写出去了什么」，模拟 node --test 报告器所在的那条流。
  process.stdout.write = ((chunk: string | Uint8Array) => { // test-conventions-allow：测的就是这条流本身，模拟报告器所在的外层
    forwarded.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const { result, lines } = await captureStdoutLines(async () => {
      process.stdout.write("inner-line\n");
      return 42;
    });
    assert.equal(result, 42);
    assert.deepEqual(lines, ["inner-line\n"]);
    assert.deepEqual(forwarded, ["inner-line\n"], "捕获的同时必须透传");
    process.stdout.write("after\n");
    assert.deepEqual(forwarded, ["inner-line\n", "after\n"], "窗口结束后 write 已还原");
  } finally {
    process.stdout.write = original; // test-conventions-allow：还原上面那层模拟
  }
});

test("captureStderrLines 同款；run 抛错时也还原", async () => {
  const original = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write; // test-conventions-allow：测的就是这条流本身
  const patched = process.stderr.write;
  try {
    await assert.rejects(
      () =>
        captureStderrLines(async () => {
          process.stderr.write("x\n");
          throw new Error("boom");
        }),
      /boom/u
    );
    assert.equal(process.stderr.write, patched, "抛错路径也要还原到进入前的 write");
  } finally {
    process.stderr.write = original; // test-conventions-allow：还原上面那层模拟
  }
});
