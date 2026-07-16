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
