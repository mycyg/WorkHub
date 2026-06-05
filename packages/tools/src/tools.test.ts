import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

test("zip_path writes a real zip archive after snapshot succeeds", async () => {
  const workdir = await tempWorkdir();
  await mkdir(path.join(workdir, "outputs", "bundle"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "bundle", "a.txt"), "alpha", "utf8");
  await mkdir(path.join(workdir, "outputs", "bundle", "nested"), { recursive: true });
  await writeFile(path.join(workdir, "outputs", "bundle", "nested", "b.txt"), "beta", "utf8");

  const registry = createToolRegistry(createBuiltInFileTools());
  const result = await registry.execute(
    "zip_path",
    { src: "outputs/bundle", dest: "outputs/bundle.zip" },
    {
      workdir,
      snapshot: () => ({ snapshotId: "30000000-0000-4000-8000-000000000002" })
    }
  );

  const archive = await readFile(path.join(workdir, "outputs", "bundle.zip"));
  assert.equal(result.ok, true);
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  assert.equal(archive.includes(Buffer.from("a.txt", "utf8")), true);
  assert.equal(archive.includes(Buffer.from("nested/b.txt", "utf8")), true);
  assert.equal(archive.includes(Buffer.from("archive_manifest", "utf8")), false);
});
