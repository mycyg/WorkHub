import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { launchChrome } from "./chrome-launch.js";

async function readMarker(pathname: string) {
  const deadline = Date.now() + 2_000;
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

    // The old test let the CDP timeout fire before the fake child had necessarily installed its TERM trap under full-suite load.
    // Wait for the child to reach its running marker, then keep the original termination assertion.
    const launchPromise = launchChrome(fakeChromePath, 65534, path.join(tmp, "profile"), { debugTargetTimeoutMs: 5_000 });
    try {
      await waitForMarker(markerPath, "running");
      await assert.rejects(launchPromise, /Timed out waiting for Chrome CDP target/u);
    } catch (error) {
      await launchPromise.catch(() => undefined);
      throw error;
    }
    assert.equal(await readMarker(markerPath), "terminated");
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

async function waitForMarker(pathname: string, expected: string) {
  const deadline = Date.now() + 4_000;
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
