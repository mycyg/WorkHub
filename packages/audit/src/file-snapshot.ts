import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RevertSnapshotInput, SnapshotRef, SnapshotTakeInput } from "./types.js";

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    // L24：显式跳过符号链接（不跟随、不快照）——跟随会有目录环 / 越出快照根的路径穿越风险。
    // 此前它们恰好既非 isDirectory 也非 isFile 而被默默漏掉；这里把意图显式化、并防御未来 API 变化。
    if (entry.isSymbolicLink()) {
      continue;
    }
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

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function revertFileSnapshot(input: RevertSnapshotInput) {
  const snapshotStat = await stat(input.snapshot.ref);
  if (!snapshotStat.isDirectory()) {
    throw new Error("snapshot ref is not a directory");
  }
  // R2 audit#34：原子化 revert——先把快照拷进同级临时目录(失败不动原 workdir)，再用 rename 换入。
  // 旧实现先 clearDirectory(workdir) 再 copyTree，若 copy 中途失败工作区被留成空/残缺且无回滚（破坏性数据丢失）。
  // staging 与 workdir 同父目录→同文件系统→rename 原子；换入失败尽力把退役目录搬回。
  const workdir = path.resolve(input.workdir);
  const parent = path.dirname(workdir);
  const token = randomUUID();
  const staging = path.join(parent, `.revert-staging-${token}`);
  const retired = path.join(parent, `.revert-retired-${token}`);
  await mkdir(parent, { recursive: true });
  try {
    await copyTree(input.snapshot.ref, staging);
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  let retiredMoved = false;
  try {
    if (await pathExists(workdir)) {
      await rename(workdir, retired);
      retiredMoved = true;
    }
    await rename(staging, workdir);
  } catch (error) {
    if (retiredMoved && !(await pathExists(workdir))) {
      await rename(retired, workdir).catch(() => undefined);
    }
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await rm(retired, { recursive: true, force: true }).catch(() => undefined);
  return {
    ...input.snapshot,
    revertedAt: new Date().toISOString()
  };
}
