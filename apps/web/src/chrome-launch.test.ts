import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { launchChrome } from "./chrome-launch.js";

// BUG-09：Chrome 起不来时诊断不能被吞——stderr/退出状态/启动参数/版本/端口探测都要出现在错误报告里，
// 且子进程已退出时立即失败，不傻等整个 CDP 超时窗把真因冲淡成 fetch timeout。
test("launchChrome fails fast with full diagnostics when Chrome exits before the debug port comes up", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "workhub-chrome-launch-diag-"));
  try {
    const fakeChromePath = path.join(tmp, "fake-chrome.sh");
    await writeFile(
      fakeChromePath,
      [
        "#!/bin/sh",
        "if [ \"$1\" = \"--version\" ]; then",
        "  echo \"FakeChrome 0.0.1\"",
        "  exit 0",
        "fi",
        "echo \"fake chrome cannot start: boom\" >&2",
        "exit 3",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeChromePath, 0o755);

    const startedAt = Date.now();
    await assert.rejects(
      launchChrome(fakeChromePath, 65533, path.join(tmp, "profile"), { debugTargetTimeoutMs: 20_000 }),
      (error: Error) => {
        assert.match(error.message, /Chrome exited \(code 3, signal null\) before the CDP debug port 65533 came up/u);
        assert.match(error.message, /Chrome launch diagnostics:/u);
        assert.match(error.message, /fake chrome cannot start: boom/u, "stderr tail is preserved");
        assert.match(error.message, /FakeChrome 0\.0\.1/u, "chrome --version is captured");
        assert.match(error.message, /--remote-debugging-port=65533/u, "launch args are reported");
        assert.match(error.message, /port_probes/u, "port probe trace is reported");
        return true;
      }
    );
    // 子进程秒退,不许烧完 20s 超时窗:快速失败是这条修复的一半。
    assert.ok(Date.now() - startedAt < 10_000, "fails fast instead of waiting out the CDP timeout");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
