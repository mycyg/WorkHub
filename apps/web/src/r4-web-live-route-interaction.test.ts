import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { launchChrome } from "./chrome-launch.js";

test("launchChrome terminates the child process when CDP never becomes reachable", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "workhub-r4-chrome-cleanup-"));
  try {
    const markerPath = path.join(tmp, "fake-chrome-state.txt");
    const fakeChromePath = path.join(tmp, "fake-chrome.mjs");
    await writeFile(
      fakeChromePath,
      [
        "#!/bin/sh",
        `MARKER=${JSON.stringify(markerPath)}`,
        // trap 必须先于 running 标记安装：测试等到 "running" 即可确定 TERM 一定会被 trap 接住,
        // 关掉「CDP 超时的 TERM 打在 trap 安装前」这扇竞态窗(哪怕它只有微秒级)。
        "trap 'printf terminated > \"$MARKER\"; exit 0' TERM",
        "printf running > \"$MARKER\"",
        "while :; do sleep 1; done",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeChromePath, 0o755);

    const launchPromise = launchChrome(fakeChromePath, 65534, path.join(tmp, "profile"), { debugTargetTimeoutMs: 5_000 });
    try {
      await waitForMarker(markerPath, "running");
      await assert.rejects(launchPromise, /Timed out waiting for Chrome CDP target/u);
    } catch (error) {
      await launchPromise.catch(() => undefined);
      throw error;
    }
    // stopChrome 发 TERM 后最多等 1200ms 就放手 reject,而 POSIX sh 的 trap 要等前台 sleep 1 走完
    // 才执行——满负载下"收到 TERM → 写 terminated"轻松晚于 launchPromise 落定。这里必须带重试地等
    // (而不是 reject 后立读一次),否则就是全仓并行测试下的偶发红(R15 终验复现过一次)。8s 上限=
    // sleep 粒度 1s + 重负载调度余量,常态毫秒级返回。
    await waitForMarker(markerPath, "terminated", 8_000);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

async function waitForMarker(pathname: string, expected: string, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = "";
  while (Date.now() < deadline) {
    try {
      lastValue = await readFile(pathname, "utf8");
      if (lastValue === expected) {
        return;
      }
    } catch {
      // The fake process may not have created the marker file yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(lastValue, expected);
}

// R20 P2-11（根因）：launchChrome 失败此前只抛一句笼统的「Timed out waiting for Chrome CDP target:
// <fetch 错误>」——fetch 错误几乎总是 ECONNREFUSED，从不告诉你 Chrome 进程是不是根本没起来、秒退了、
// 退出码/信号是什么、stderr 里到底写了什么真正原因。下面两个测试注入假 chrome 可执行文件（同上一个
// 测试的手法：用一个可控的 shell 脚本冒充 chrome 二进制，而不是真的起 Chrome），分别覆盖「进程压根没
// 起来（ENOENT）」和「进程起来了但立刻带着诊断信息退出（典型的缺共享库/沙箱权限/profile 损坏）」两类
// 根因，断言抛出的错误里带着这些根因信息，而不是只有超时提示。

test("launchChrome surfaces the spawn error (e.g. ENOENT) instead of just timing out silently", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "workhub-r20-chrome-spawn-error-"));
  try {
    const missingChromePath = path.join(tmp, "does-not-exist-chrome-binary");
    await assert.rejects(
      launchChrome(missingChromePath, 65533, path.join(tmp, "profile"), { debugTargetTimeoutMs: 5_000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /failed to spawn/u, "must name the failure mode, not just 'timed out'");
        assert.match(error.message, /ENOENT/u, "must surface the OS-level spawn error code");
        assert.ok(
          error.message.includes(missingChromePath),
          "must surface the chromePath that was attempted, for fast root-causing"
        );
        return true;
      }
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("launchChrome surfaces exit code and captured stderr when Chrome dies immediately instead of timing out silently", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "workhub-r20-chrome-early-exit-"));
  try {
    const fakeChromePath = path.join(tmp, "fake-chrome-crash.sh");
    await writeFile(
      fakeChromePath,
      [
        "#!/bin/sh",
        // Simulate a real Chrome crash: writes a diagnosable reason to stderr, then exits non-zero
        // before ever opening its CDP debug port.
        "echo 'error while loading shared libraries: libfoo.so.1: cannot open shared object file' 1>&2",
        "exit 17",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeChromePath, 0o755);

    await assert.rejects(
      launchChrome(fakeChromePath, 65532, path.join(tmp, "profile"), { debugTargetTimeoutMs: 5_000 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /exited before its CDP debug target came up/u, "must name the failure mode");
        assert.match(error.message, /exit code 17/u, "must surface the process exit code");
        assert.match(
          error.message,
          /libfoo\.so\.1/u,
          "must surface captured stderr so the real root cause (missing shared library, in this example) is visible without a local re-run"
        );
        return true;
      }
    );
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
