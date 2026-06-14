import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { hydrateProjectWorkdir, type ProjectDriveFile, type ProjectHydrateDeps } from "./workers/project-hydrate.js";

// fake：readFileBytes 返回长度==声明 sizeBytes 的 buffer（与生产一致：预算预检用声明大小、累计用实际字节，两者吻合）。
function fakeDeps(files: ProjectDriveFile[]): ProjectHydrateDeps {
  const sizeByPath = new Map(files.map((file) => [file.storagePath, file.sizeBytes]));
  return {
    listProjectFiles: async () => files,
    readFileBytes: async (storagePath) => Buffer.alloc(sizeByPath.get(storagePath) ?? 8, 0x41),
    writeFile: async (absPath, data) => {
      await writeFile(absPath, data);
    },
    ensureDir: async (absDir) => {
      await mkdir(absDir, { recursive: true });
    }
  };
}

test("hydrateProjectWorkdir materializes project files under project/ with nested paths", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "wh-hydrate-"));
  try {
    const result = await hydrateProjectWorkdir(workdir, "proj-1", fakeDeps([
      { path: "复盘.md", storagePath: "/store/a", sizeBytes: 10 },
      { path: "数据/月报.csv", storagePath: "/store/b", sizeBytes: 20 }
    ]));
    assert.equal(result.files, 2);
    assert.equal(result.skipped, 0);
    assert.equal((await stat(path.join(workdir, "project", "复盘.md"))).size, 10);
    assert.equal((await stat(path.join(workdir, "project", "数据", "月报.csv"))).size, 20);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("hydrateProjectWorkdir refuses path escapes and never writes outside project/", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "wh-hydrate-"));
  try {
    const result = await hydrateProjectWorkdir(workdir, "proj-1", fakeDeps([
      { path: "../escape.md", storagePath: "/store/x", sizeBytes: 5 },
      { path: "ok.md", storagePath: "/store/y", sizeBytes: 5 }
    ]));
    assert.equal(result.files, 1); // only ok.md
    assert.equal(result.skipped, 1); // escape skipped
    const escaped = await stat(path.join(workdir, "..", "escape.md")).catch(() => null);
    assert.equal(escaped, null); // nothing written outside workdir
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("hydrateProjectWorkdir enforces file and byte caps", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "wh-hydrate-"));
  try {
    const byFileCap = await hydrateProjectWorkdir(workdir, "p", fakeDeps([
      { path: "a", storagePath: "/s/a", sizeBytes: 1 },
      { path: "b", storagePath: "/s/b", sizeBytes: 1 },
      { path: "c", storagePath: "/s/c", sizeBytes: 1 }
    ]), { maxFiles: 2, maxBytes: 1000 });
    assert.equal(byFileCap.files, 2);
    assert.equal(byFileCap.skipped, 1);

    const byByteCap = await hydrateProjectWorkdir(workdir, "p", fakeDeps([
      { path: "big1", storagePath: "/s/big1", sizeBytes: 900 },
      { path: "big2", storagePath: "/s/big2", sizeBytes: 900 }
    ]), { maxFiles: 50, maxBytes: 1000 });
    assert.equal(byByteCap.files, 1); // 900 fits, second 900 would exceed 1000
    assert.equal(byByteCap.skipped, 1);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("hydrateProjectWorkdir is fail-open per file (missing source skips, does not throw)", async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "wh-hydrate-"));
  try {
    const deps: ProjectHydrateDeps = {
      listProjectFiles: async () => [
        { path: "good.md", storagePath: "/s/good", sizeBytes: 4 },
        { path: "missing.md", storagePath: "/s/missing", sizeBytes: 4 }
      ],
      readFileBytes: async (sp) => {
        if (sp === "/s/missing") {
          throw new Error("ENOENT");
        }
        return Buffer.from("ok");
      },
      writeFile: async (absPath, data) => {
        await writeFile(absPath, data);
      },
      ensureDir: async (absDir) => {
        await mkdir(absDir, { recursive: true });
      }
    };
    const result = await hydrateProjectWorkdir(workdir, "p", deps);
    assert.equal(result.files, 1);
    assert.equal(result.skipped, 1);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
