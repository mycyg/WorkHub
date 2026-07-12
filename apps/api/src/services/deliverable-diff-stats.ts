// R12 批 4b：产出卡系统消息要报「+N -M」——目前 DeliverableChangeManifest 的 changes[] 完全没有行级
// 增删统计字段（manifest 构建时只落 after 内容的 sha256/摘录，from-excerpt 太短且经常没有 before 版本，
// 硬凑出来的数字会比真实改动小得多、误导人）。这里改用「sandbox workdir 里两份全量文件」直接比：
// P-COLLAB M1 把项目现有文件物化进 workdir/project/（只读参考区，改动前的版本）；AI 的产出落在
// workdir/outputs/（改动后的版本）。两边按 manifest 记录的相对路径直接读全量内容比行，比摘录准。
// 尽最大努力：单条改动读不到（新建文件没有 project/ 版本、被删文件没有 outputs/ 版本、非文本、超限）
// 都不报错，只是那一条不计入统计，不拖垮已经成功的 run。
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DeliverableChangeManifest } from "@workhub/contracts";

// 单条改动最多读这么多字符参与比较，避免超大文件把这条「锦上添花」的播报拖成性能问题。
const MAX_DIFF_CHARS = 500_000;
// 单张产出卡最多统计这么多条变更，其余仍计入 change 总数（外层可用 manifest.changes.length），
// 只是不逐行 diff——铁律#4「所有循环不许发无上限的重活」的同精神应用到本地文件 IO。
const MAX_CHANGES_DIFFED = 20;

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split(/\r?\n/u);
}

// 极简行级增删计数：裁掉共同前缀/后缀，中段行数直接算增删。不是真正的 LCS/Myers diff（那是
// merge-fusion-candidates.ts 在冲突场景要解决的更难问题），但足够撑起产出卡「+N -M」这一粗粒度标签。
function lineDiffCounts(before: string, after: string): { added: number; removed: number } {
  if (before === after) {
    return { added: 0, removed: 0 };
  }
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    added: Math.max(afterLines.length - prefix - suffix, 0),
    removed: Math.max(beforeLines.length - prefix - suffix, 0)
  };
}

async function readSmallTextFile(filePath: string): Promise<string | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return content.length > MAX_DIFF_CHARS ? undefined : content;
  } catch {
    // 文件不存在（新建/已删除）、非文本、权限问题——静默跳过，只影响这一条变更的计数。
    return undefined;
  }
}

function safeRelativePath(rawPath: string | undefined): string | undefined {
  if (!rawPath) {
    return undefined;
  }
  const trimmed = rawPath.replace(/^\/+/u, "");
  // 防路径穿越：manifest 里的 path 理论上已经是 sandbox 内相对路径，这里再兜底一层，
  // 不让 ../ 逃出 workdir/project 或 workdir/outputs。
  const normalized = path.normalize(trimmed);
  if (!trimmed || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

export async function estimateDeliverableDiffStats(input: {
  workdir: string;
  manifest: Pick<DeliverableChangeManifest, "changes">;
}): Promise<{ adds: number; dels: number }> {
  let adds = 0;
  let dels = 0;
  const changes = input.manifest.changes.slice(0, MAX_CHANGES_DIFFED);
  for (const change of changes) {
    // manifest 里的 target_ref.path 已经是 workdir 相对路径、带 "outputs/" 前缀（例如
    // "/outputs/result.md"，见 buildDeliverableChangeManifestFromOutputs）——直接拼 workdir 就是
    // 改动后的文件。物化进 workdir/project/ 的改动前镜像用的是原始项目文件路径（没有 "outputs/"
    // 前缀），按约定去掉这一段前缀去 project/ 底下找同名文件；找不到（新建文件）就当纯新增。
    const relPath = safeRelativePath(change.target_ref.path);
    if (!relPath) {
      continue;
    }
    const projectRelPath = relPath.replace(/^outputs\//u, "");
    const [afterText, beforeText] = await Promise.all([
      readSmallTextFile(path.join(input.workdir, relPath)),
      readSmallTextFile(path.join(input.workdir, "project", projectRelPath))
    ]);
    if (afterText === undefined && beforeText === undefined) {
      continue;
    }
    const counts = lineDiffCounts(beforeText ?? "", afterText ?? "");
    adds += counts.added;
    dels += counts.removed;
  }
  return { adds, dels };
}
