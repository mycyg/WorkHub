import { randomUUID, createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RevertSnapshotInput, SnapshotRef, SnapshotTakeInput } from "./types.js";

const NO_EXCLUDES: ReadonlySet<string> = new Set();

/**
 * 把调用方给的排除清单规范成顶层目录名集合。含路径分隔符或 `.`/`..` 的条目直接拒绝——静默忽略会让
 * 调用方以为排除生效了，而快照仍在悄悄把那棵目录拷进去。
 */
export function normalizeExcludeDirs(excludeDirs: readonly string[] | undefined): ReadonlySet<string> {
  if (!excludeDirs || excludeDirs.length === 0) {
    return NO_EXCLUDES;
  }
  const names = new Set<string>();
  for (const raw of excludeDirs) {
    const name = raw.trim();
    if (!name || name === "." || name === ".." || name.includes("/") || name.includes("\\")) {
      throw new Error(`snapshot excludeDirs must be top-level directory names, got: ${JSON.stringify(raw)}`);
    }
    names.add(name);
  }
  return names;
}

async function listFiles(
  root: string,
  current = root,
  excludeDirs: ReadonlySet<string> = NO_EXCLUDES
): Promise<string[]> {
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
      // 快照范围之外的目录只在顶层按名字排除（如 agent run 的 .spill/）；深层同名目录不受影响。
      if (current === root && excludeDirs.has(entry.name)) {
        continue;
      }
      files.push(...await listFiles(root, full, excludeDirs));
    } else if (entry.isFile()) {
      files.push(path.relative(root, full));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

async function copyTree(sourceRoot: string, destRoot: string, excludeDirs: ReadonlySet<string> = NO_EXCLUDES) {
  await mkdir(destRoot, { recursive: true });
  const files = await listFiles(sourceRoot, sourceRoot, excludeDirs);
  for (const file of files) {
    const source = path.join(sourceRoot, file);
    const dest = path.join(destRoot, file);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, await readFile(source));
  }
  return files;
}

export async function hashWorkdir(root: string, excludeDirs: ReadonlySet<string> = NO_EXCLUDES) {
  const digest = createHash("sha256");
  const files = await listFiles(root, root, excludeDirs);
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
  const excludeDirs = normalizeExcludeDirs(input.excludeDirs);
  const contentSha256 = await hashWorkdir(input.workdir, excludeDirs);
  // CORE-04：内容零变化（contentSha256 与上一份相同）→ 复用上一份的 ref，不再整树拷贝。
  const reused = input.reuseIfUnchanged && input.reuseIfUnchanged.contentSha256 === contentSha256;
  const ref = reused ? input.reuseIfUnchanged!.ref : snapshotDir;
  if (!reused) {
    await copyTree(input.workdir, snapshotDir, excludeDirs);
  }

  const snapshot: SnapshotRef = {
    id,
    workItemId: input.workItemId,
    kind: input.kind ?? "pre_step",
    ref,
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
  const excludeDirs = normalizeExcludeDirs(input.excludeDirs);
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
  // 快照范围之外的目录（如 .spill/）从来不在快照里：换入完成后从退役的旧工作目录原样搬回，
  // 还原不该把它们删掉。搬回失败只丢这些中间产物，不影响已经完成的还原，所以尽力而为。
  if (retiredMoved) {
    for (const name of excludeDirs) {
      const from = path.join(retired, name);
      if (!(await pathExists(from))) {
        continue;
      }
      const to = path.join(workdir, name);
      await rm(to, { recursive: true, force: true }).catch(() => undefined);
      await rename(from, to).catch(() => undefined);
    }
  }
  await rm(retired, { recursive: true, force: true }).catch(() => undefined);
  return {
    ...input.snapshot,
    revertedAt: new Date().toISOString()
  };
}
