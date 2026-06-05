import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBuiltInFileTools, createToolRegistry, ensureCommandAllowed, safeResolvePath } from "./index.js";

async function tempWorkdir() {
  return mkdtemp(path.join(os.tmpdir(), "workhub-tools-"));
}

test("safeResolvePath rejects path escapes", async () => {
  const workdir = await tempWorkdir();
  assert.throws(() => safeResolvePath(workdir, "../outside.txt"), /path escapes workdir/);
});

test("dependency install commands are disabled", () => {
  assert.throws(() => ensureCommandAllowed(["npm", "install"]), /dependency installation is disabled/);
  assert.throws(() => ensureCommandAllowed(["pnpm", "add", "left-pad"]), /dependency installation is disabled/);
  assert.doesNotThrow(() => ensureCommandAllowed(["node", "--version"]));
});

test("side-effect tools fail closed without a snapshot hook", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute("write_file", { path: "outputs/a.txt", content: "hello" }, { workdir });

  assert.equal(result.ok, false);
  assert.match(result.content, /requires a snapshot gate/);
});

test("write_file executes only after snapshot succeeds", async () => {
  const workdir = await tempWorkdir();
  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute(
    "write_file",
    { path: "outputs/a.txt", content: "hello" },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-000000000001" })
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.snapshotId, "30000000-0000-4000-8000-000000000001");
  assert.equal(await readFile(path.join(workdir, "outputs", "a.txt"), "utf8"), "hello");
});
