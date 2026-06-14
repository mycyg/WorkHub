import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RevertSnapshotInput, SnapshotRef, SnapshotTakeInput } from "./types.js";

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, full));
    } else if (entry.isFile()) {
      files.push(path.relative(root, full));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function copyTree(sourceRoot: string, destRoot: string) {
  await mkdir(destRoot, { recursive: true });
  const files = await listFiles(sourceRoot);
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    const dest = path.join(destRoot, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(source));
  }
  return files;
}

export async function hashWorkdir(root: string) {
  const digest = createHash("sha256");
  const files = await listFiles(root);
  for (const file of files) {
    digest.update(file);
    digest.update("\0");
    digest.update(await readFile(path.join(root, file)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

export async function takeFileSnapshot(input: SnapshotTakeInput): Promise<SnapshotRef> {
  const now = input.now ?? (() => new Date());
  const id = input.id?.() ?? randomUUID();
  const snapshotDir = path.resolve(input.snapshotRoot, id);
  await mkdir(input.snapshotRoot, { recursive: true });
  const workdirStat = await stat(input.workdir);
  if (!workdirStat.isDirectory()) {
    throw new Error("snapshot workdir must be a directory");
  }
  const contentSha256 = await hashWorkdir(input.workdir);
  await copyTree(input.workdir, snapshotDir);

  const snapshot: SnapshotRef = {
    id,
    workItemId: input.workItemId,
    kind: input.kind ?? "pre_step",
    ref: snapshotDir,
    contentSha256,
    createdByKind: input.createdByKind,
    createdAt: now().toISOString()
  };
  if (input.branchId) {
    snapshot.branchId = input.branchId;
  }
  return snapshot;
}

// P-COLLAB M2：从一份 base 快照里按相对路径读出单个文件,作为三方合并的"共同祖先"内容。
// 快照是整棵目录拷贝(无逐文件 API),diff3 需要按路径取祖先文本。路径越界(..)一律视为不存在,
// 不抛错——调用方据此回退到旧的 accepted-history 祖先。
export async function readSnapshotFile(
  snapshot: { ref: string },
  relativePath: string
): Promise<{ text: string; sha256: string } | null> {
  const root = path.resolve(snapshot.ref);
  const cleaned = relativePath.replace(/^[\\/]+/, "");
  const resolved = path.resolve(root, cleaned);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  try {
    const bytes = await readFile(resolved);
    return {
      text: bytes.toString("utf8"),
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } catch {
    return null;
  }
}

async function clearDirectory(root: string) {
  await mkdir(root, { recursive: true });
  const entries = await readdir(root);
  for (const entry of entries) {
    await rm(path.join(root, entry), { recursive: true, force: true });
  }
}

export async function revertFileSnapshot(input: RevertSnapshotInput) {
  const snapshotStat = await stat(input.snapshot.ref);
  if (!snapshotStat.isDirectory()) {
    throw new Error("snapshot ref is not a directory");
  }
  await clearDirectory(input.workdir);
  await copyTree(input.snapshot.ref, input.workdir);
  return {
    ...input.snapshot,
    revertedAt: new Date().toISOString()
  };
}
