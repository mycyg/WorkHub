import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { launchChrome } from "./chrome-launch.js";

async function readMarker(pathname: string) {
  const deadline = Date.now() + 800;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await readFile(pathname, "utf8");
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

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
        "printf running > \"$MARKER\"",
        "trap 'printf terminated > \"$MARKER\"; exit 0' TERM",
        "while :; do sleep 1; done",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(fakeChromePath, 0o755);

    await assert.rejects(
      () => launchChrome(fakeChromePath, 65534, path.join(tmp, "profile"), { debugTargetTimeoutMs: 1_500 }),
      /Timed out waiting for Chrome CDP target/u
    );
    assert.equal(await readMarker(markerPath), "terminated");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
