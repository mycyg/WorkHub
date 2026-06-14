import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  deliverableChangeManifestSchema,
  type DeliverableChange,
  type DeliverableChangeManifest,
  type DeliverableCheck,
  type DeliverableTargetKind,
  type EvidenceRef
} from "@workhub/contracts";

type ManifestAuthor = DeliverableChangeManifest["author"];

export type BuildDeliverableChangeManifestInput = {
  workItemId: string;
  workdir: string;
  title?: string;
  proposalId?: string;
  branchId?: string;
  snapshotId?: string;
  branchHeadRef?: string;
  author?: ManifestAuthor;
  evidenceRefs?: EvidenceRef[];
  createdAt?: Date | string;
  downloadHrefForPath?: (relativePath: string) => string;
  previewHrefForPath?: (relativePath: string) => string | undefined;
};

type OutputEntry = {
  absolutePath: string;
  relativePath: string;
  isDirectory: boolean;
  sizeBytes: number;
};

const textExtensions = new Set([
  ".css",
  ".html",
  ".htm",
  ".js",
  ".jsx",
  ".md",
  ".mdx",
  ".sql",
  ".ts",
  ".tsx",
  ".txt"
]);
const structuredExtensions = new Set([".env", ".ini", ".json", ".jsonl", ".lock", ".toml", ".yaml", ".yml"]);
const binaryDocExtensions = new Set([".doc", ".docx", ".pdf", ".rtf"]);
const spreadsheetExtensions = new Set([".csv", ".tsv", ".xls", ".xlsx"]);
const slideExtensions = new Set([".ppt", ".pptx"]);
const imageExtensions = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const archiveExtensions = new Set([".7z", ".gz", ".rar", ".tar", ".tgz", ".zip"]);

function normalizeRelativePath(value: string) {
  return value.split(path.sep).join("/");
}

function outputHrefPath(relativePath: string) {
  return `/outputs/${normalizeRelativePath(relativePath)}`;
}

function defaultDownloadHref(relativePath: string) {
  return `/api/agent/outputs/download?path=${encodeURIComponent(outputHrefPath(relativePath))}`;
}

function defaultPreviewHref(relativePath: string) {
  return `/api/agent/outputs/preview?path=${encodeURIComponent(outputHrefPath(relativePath))}`;
}

function deterministicUuid(...parts: string[]) {
  const bytes = Buffer.from(createHash("sha256").update(parts.join("\0")).digest().subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function walkOutputs(root: string, current: string, entries: OutputEntry[]) {
  const dirEntries = await readdir(current, { withFileTypes: true });
  for (const entry of dirEntries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
    const entryStat = await stat(absolutePath);
    entries.push({
      absolutePath,
      relativePath,
      isDirectory: entry.isDirectory(),
      sizeBytes: entryStat.size
    });
    if (entry.isDirectory()) {
      await walkOutputs(root, absolutePath, entries);
    }
  }
}

async function listDirectoryChildren(root: string, directory: string, limit = 20, acc: string[] = []) {
  if (acc.length >= limit) {
    return acc;
  }
  const children = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    if (acc.length >= limit) {
      break;
    }
    const absolutePath = path.join(directory, child.name);
    const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
    acc.push(child.isDirectory() ? `child_added:${relativePath}/` : `child_added:${relativePath}`);
    if (child.isDirectory()) {
      await listDirectoryChildren(root, absolutePath, limit, acc);
    }
  }
  return acc;
}

async function listOutputEntries(workdir: string) {
  const outputsRoot = path.join(workdir, "outputs");
  const outputStat = await stat(outputsRoot).catch(() => undefined);
  if (!outputStat?.isDirectory()) {
    throw new Error("No deliverables found under outputs/.");
  }

  const entries: OutputEntry[] = [];
  await walkOutputs(outputsRoot, outputsRoot, entries);
  const deliverables = entries.filter((entry) => entry.relativePath !== ".");
  if (deliverables.length === 0) {
    throw new Error("No deliverables found under outputs/.");
  }
  return deliverables.sort((a, b) => {
    if (a.relativePath === b.relativePath) {
      return 0;
    }
    return a.relativePath < b.relativePath ? -1 : 1;
  });
}

function detectTargetKind(entry: OutputEntry): DeliverableTargetKind {
  if (entry.isDirectory) {
    return "folder";
  }
  const ext = path.extname(entry.relativePath).toLowerCase();
  const basename = path.basename(entry.relativePath).toLowerCase();
  if (structuredExtensions.has(ext) || basename.includes("config")) {
    return "structured_record";
  }
  if (spreadsheetExtensions.has(ext)) {
    return "spreadsheet";
  }
  if (slideExtensions.has(ext)) {
    return "slide_deck";
  }
  if (imageExtensions.has(ext)) {
    return "image";
  }
  if (archiveExtensions.has(ext)) {
    return "archive";
  }
  if (binaryDocExtensions.has(ext)) {
    return "binary_doc";
  }
  if (basename.includes("spec") || basename.includes("requirements")) {
    return "spec_doc";
  }
  if (textExtensions.has(ext)) {
    return "text_doc";
  }
  return "binary_doc";
}

async function sha256File(absolutePath: string) {
  const buffer = await readFile(absolutePath);
  return createHash("sha256").update(buffer).digest("hex");
}

function isTextPreviewKind(kind: DeliverableTargetKind, relativePath: string) {
  const ext = path.extname(relativePath).toLowerCase();
  return kind === "text_doc" || kind === "structured_record" || kind === "spec_doc" || ext === ".csv" || ext === ".tsv";
}

async function readTextExcerpt(absolutePath: string) {
  try {
    const text = await readFile(absolutePath, "utf8");
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return undefined;
  }
}

function countRows(text: string) {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function pngSize(buffer: Buffer) {
  if (buffer.length < 24) {
    return undefined;
  }
  if (
    buffer.readUInt8(0) !== 0x89 ||
    buffer.toString("ascii", 1, 4) !== "PNG" ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return undefined;
  }
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

function jpegSize(buffer: Buffer) {
  if (buffer.length < 4 || buffer.readUInt8(0) !== 0xff || buffer.readUInt8(1) !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer.readUInt8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer.readUInt8(offset + 1);
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      return undefined;
    }
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb)) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return `${width}x${height}`;
    }
    offset += 2 + segmentLength;
  }
  return undefined;
}

async function imageSize(absolutePath: string, relativePath: string) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
    return undefined;
  }
  const buffer = await readFile(absolutePath);
  return ext === ".png" ? pngSize(buffer) : jpegSize(buffer);
}

function targetLabel(kind: DeliverableTargetKind) {
  const labels: Record<DeliverableTargetKind, string> = {
    archive: "压缩包",
    binary_doc: "文档",
    folder: "文件夹",
    image: "图片",
    slide_deck: "演示文稿",
    spreadsheet: "表格",
    spec_doc: "规格文档",
    structured_record: "结构化记录",
    text_doc: "文本稿"
  };
  return labels[kind];
}

function previewKind(kind: DeliverableTargetKind, relativePath: string): NonNullable<DeliverableChange["preview_ref"]>["kind"] {
  const ext = path.extname(relativePath).toLowerCase();
  if (kind === "image") {
    return "image";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if (isTextPreviewKind(kind, relativePath)) {
    return "text";
  }
  if (kind === "binary_doc") {
    return binaryDocExtensions.has(ext) ? "office_preview" : "download";
  }
  if (kind === "slide_deck" || kind === "spreadsheet") {
    return "office_preview";
  }
  return "download";
}

async function buildMachineSummary(entry: OutputEntry, kind: DeliverableTargetKind, outputsRoot: string): Promise<DeliverableChange["machine_summary"]> {
  if (entry.isDirectory) {
    const children = await listDirectoryChildren(outputsRoot, entry.absolutePath);
    return {
      changed_fields: ["folder_created", ...children]
    };
  }

  const summary: NonNullable<DeliverableChange["machine_summary"]> = {};
  const ext = path.extname(entry.relativePath).toLowerCase();
  if (isTextPreviewKind(kind, entry.relativePath)) {
    const excerpt = await readTextExcerpt(entry.absolutePath);
    if (excerpt) {
      summary.after_excerpt = excerpt;
    }
    if (ext === ".csv" || ext === ".tsv") {
      const text = await readFile(entry.absolutePath, "utf8").catch(() => "");
      summary.row_count_delta = countRows(text);
    }
  }
  if (kind === "image") {
    const size = await imageSize(entry.absolutePath, entry.relativePath);
    if (size) {
      summary.image_size_after = size;
    }
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function buildHumanSummary(entry: OutputEntry, kind: DeliverableTargetKind) {
  const label = targetLabel(kind);
  const pathText = outputHrefPath(entry.relativePath);
  if (entry.isDirectory) {
    return `${label}已生成：${pathText}`;
  }
  return `${label}已生成：${pathText}（${entry.sizeBytes} bytes）`;
}

function buildPreviewRef(input: BuildDeliverableChangeManifestInput, entry: OutputEntry, kind: DeliverableTargetKind) {
  if (entry.isDirectory) {
    return undefined;
  }
  const explicit = input.previewHrefForPath?.(entry.relativePath);
  const href = explicit ?? (previewKind(kind, entry.relativePath) === "download"
    ? input.downloadHrefForPath?.(entry.relativePath) ?? defaultDownloadHref(entry.relativePath)
    : defaultPreviewHref(entry.relativePath));
  return {
    kind: previewKind(kind, entry.relativePath),
    href
  };
}

function buildCheck(
  id: string,
  label: string,
  status: DeliverableCheck["status"],
  detail?: string,
  evidenceRefs: EvidenceRef[] = []
): DeliverableCheck {
  const check: DeliverableCheck = { id, label, status };
  if (detail) {
    check.detail = detail;
  }
  if (evidenceRefs.length > 0) {
    check.evidence_refs = evidenceRefs;
  }
  return check;
}

function buildChecks(input: BuildDeliverableChangeManifestInput, changes: DeliverableChange[]) {
  const evidenceRefs = input.evidenceRefs ?? [];
  return [
    buildCheck(
      "snapshot_exists",
      "基线快照",
      input.snapshotId ? "passed" : "warning",
      input.snapshotId ? "交付物生成前已有可追溯快照。" : "本次 Manifest 草案没有收到 snapshot_id，需要人工确认回滚边界。"
    ),
    buildCheck(
      "artifact_exists",
      "交付物存在",
      changes.length > 0 ? "passed" : "failed",
      `已发现 ${changes.length} 个 outputs/ 交付物。`
    ),
    buildCheck(
      "evidence_linked",
      "证据引用",
      evidenceRefs.length > 0 ? "passed" : "skipped",
      evidenceRefs.length > 0 ? "已关联真实证据引用。" : "本次没有传入证据引用，Manifest 保持空证据，不编造来源。",
      evidenceRefs
    ),
    buildCheck(
      "revert_available",
      "回滚能力",
      input.snapshotId ? "passed" : "warning",
      input.snapshotId ? "可通过 snapshot_id 回滚。" : "缺少 snapshot_id，回滚能力需要审批或人工补充。"
    )
  ];
}

function createdAtIso(value: Date | string | undefined) {
  if (!value) {
    return new Date().toISOString();
  }
  return value instanceof Date ? value.toISOString() : value;
}

function buildSummary(input: BuildDeliverableChangeManifestInput, changes: DeliverableChange[]) {
  const kindCounts = new Map<DeliverableTargetKind, number>();
  for (const change of changes) {
    kindCounts.set(change.target_kind, (kindCounts.get(change.target_kind) ?? 0) + 1);
  }
  const kinds = [...kindCounts.entries()]
    .map(([kind, count]) => `${targetLabel(kind)} ${count}`)
    .join("、");
  const evidenceLine = (input.evidenceRefs?.length ?? 0) > 0
    ? `已关联 ${input.evidenceRefs?.length ?? 0} 条证据。`
    : "未传入证据引用，等待人工补证或确认。";
  const snapshotLine = input.snapshotId ? `基线快照：${input.snapshotId}` : "缺少基线快照：需人工确认回滚边界。";
  return [
    "## 变更摘要",
    `本次 AgentRun 从 outputs/ 生成 ${changes.length} 个交付物变更草案：${kinds}。`,
    "",
    "## 审查提示",
    evidenceLine,
    snapshotLine
  ].join("\n");
}

async function buildChange(input: BuildDeliverableChangeManifestInput, entry: OutputEntry): Promise<DeliverableChange> {
  const kind = detectTargetKind(entry);
  const targetRef: DeliverableChange["target_ref"] = {
    entity_type: entry.isDirectory ? "folder" : "delivery",
    path: outputHrefPath(entry.relativePath)
  };
  if (!entry.isDirectory) {
    targetRef.sha256_after = await sha256File(entry.absolutePath);
  }

  const change: DeliverableChange = {
    id: deterministicUuid(input.workItemId, entry.relativePath),
    target_kind: kind,
    target_ref: targetRef,
    change_type: "generated",
    human_summary: buildHumanSummary(entry, kind)
  };

  const outputsRoot = path.join(input.workdir, "outputs");
  const machineSummary = await buildMachineSummary(entry, kind, outputsRoot);
  if (machineSummary) {
    change.machine_summary = machineSummary;
  }
  const previewRef = buildPreviewRef(input, entry, kind);
  if (previewRef) {
    change.preview_ref = previewRef;
  }
  if ((input.evidenceRefs?.length ?? 0) > 0) {
    change.evidence_refs = input.evidenceRefs;
  }
  return change;
}

// L#66：有界并发，避免一次把所有输出文件全读进内存（文件多/大时峰值内存不受控）。
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index] as T, index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export async function buildDeliverableChangeManifestFromOutputs(
  input: BuildDeliverableChangeManifestInput
): Promise<DeliverableChangeManifest> {
  const entries = await listOutputEntries(input.workdir);
  const changes = await mapWithConcurrency(entries, 6, (entry) => buildChange(input, entry));
  const base: DeliverableChangeManifest["base"] = {
    created_at: createdAtIso(input.createdAt)
  };
  if (input.snapshotId) {
    base.snapshot_id = input.snapshotId;
  }
  if (input.branchHeadRef) {
    base.branch_head_ref = input.branchHeadRef;
  }

  const rollback = input.snapshotId
    ? {
      available: true,
      snapshot_id: input.snapshotId,
      description: "可通过基线快照恢复到 AgentRun 写入交付物之前的状态。"
    }
    : {
      available: false,
      description: "Manifest 草案缺少 snapshot_id，需要人工确认或重新运行带快照门禁的 AgentRun。"
    };

  const manifest = {
    version: 0,
    work_item_id: input.workItemId,
    title: input.title ?? "AgentRun 交付物变更草案",
    summary_md: buildSummary(input, changes),
    author: input.author ?? {
      actor_kind: "ai",
      label: "WorkHub Agent"
    },
    base,
    changes,
    checks: buildChecks(input, changes),
    evidence_refs: input.evidenceRefs ?? [],
    risk: input.snapshotId
      ? {
        level: "low",
        human_label: "交付物由 outputs/ 生成，且已有可回滚快照。",
        reversible: true
      }
      : {
        level: "medium",
        human_label: "交付物已生成，但缺少可验证快照。",
        reversible: false,
        irreversible_reasons: ["No snapshot_id was supplied for this manifest draft."]
      },
    rollback,
    review: {
      suggested_decision: "needs_human",
      reason_required_on_reject: true
    }
  };

  if (input.proposalId) {
    Object.assign(manifest, { proposal_id: input.proposalId });
  }
  if (input.branchId) {
    Object.assign(manifest, { branch_id: input.branchId });
  }

  return deliverableChangeManifestSchema.parse(manifest);
}
