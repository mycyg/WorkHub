import { createHash } from "node:crypto";

import type { TextHunkApplyOverrides, TextHunkOverrideDecision } from "@workhub/contracts";

type TextDiffHunk = {
  baseStart: number;
  baseEnd: number;
  original: string[];
  replacement: string[];
};

type ConflictRange = {
  hunkIndex: number;
  startLine: number;
  endLine: number;
};

export type TextHunkMaterializationDecision = {
  hunkIndex: number;
  startLine: number;
  endLine: number;
  decision: TextHunkOverrideDecision;
};

export type TextHunkMaterializationResult = {
  content: string;
  sha256: string;
  decisions: TextHunkMaterializationDecision[];
  conflictRanges: ConflictRange[];
};

export class TextHunkMaterializationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function splitTextLines(value: string) {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
}

function sameLines(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function diffHunksFromBase(baseText: string, changedText: string) {
  const base = splitTextLines(baseText);
  const changed = splitTextLines(changedText);
  const lcs = Array.from({ length: base.length + 1 }, () =>
    Array.from({ length: changed.length + 1 }, () => 0)
  );
  for (let baseIndex = base.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let changedIndex = changed.length - 1; changedIndex >= 0; changedIndex -= 1) {
      lcs[baseIndex]![changedIndex] = base[baseIndex] === changed[changedIndex]
        ? lcs[baseIndex + 1]![changedIndex + 1]! + 1
        : Math.max(lcs[baseIndex + 1]![changedIndex]!, lcs[baseIndex]![changedIndex + 1]!);
    }
  }

  const hunks: TextDiffHunk[] = [];
  let baseIndex = 0;
  let changedIndex = 0;
  let pendingStart: number | undefined;
  let original: string[] = [];
  let replacement: string[] = [];

  function ensurePending() {
    pendingStart ??= baseIndex;
  }

  function flush() {
    if (pendingStart === undefined) {
      return;
    }
    hunks.push({
      baseStart: pendingStart,
      baseEnd: pendingStart + original.length,
      original,
      replacement
    });
    pendingStart = undefined;
    original = [];
    replacement = [];
  }

  while (baseIndex < base.length || changedIndex < changed.length) {
    if (
      baseIndex < base.length
      && changedIndex < changed.length
      && base[baseIndex] === changed[changedIndex]
    ) {
      flush();
      baseIndex += 1;
      changedIndex += 1;
      continue;
    }
    if (
      changedIndex < changed.length
      && (
        baseIndex === base.length
        || lcs[baseIndex]![changedIndex + 1]! >= lcs[baseIndex + 1]![changedIndex]!
      )
    ) {
      ensurePending();
      replacement.push(changed[changedIndex]!);
      changedIndex += 1;
      continue;
    }
    if (baseIndex < base.length) {
      ensurePending();
      original.push(base[baseIndex]!);
      baseIndex += 1;
    }
  }
  flush();
  return hunks;
}

function hunkDuplicates(left: TextDiffHunk, right: TextDiffHunk) {
  return left.baseStart === right.baseStart
    && left.baseEnd === right.baseEnd
    && sameLines(left.replacement, right.replacement);
}

function hunkOverlaps(left: TextDiffHunk, right: TextDiffHunk) {
  if (hunkDuplicates(left, right)) {
    return false;
  }
  const leftInsert = left.baseStart === left.baseEnd;
  const rightInsert = right.baseStart === right.baseEnd;
  if (leftInsert && rightInsert) {
    return left.baseStart === right.baseStart;
  }
  if (leftInsert) {
    return left.baseStart >= right.baseStart && left.baseStart <= right.baseEnd;
  }
  if (rightInsert) {
    return right.baseStart >= left.baseStart && right.baseStart <= left.baseEnd;
  }
  return left.baseStart < right.baseEnd && right.baseStart < left.baseEnd;
}

function rangeAsHunk(range: ConflictRange): TextDiffHunk {
  return {
    baseStart: range.startLine - 1,
    baseEnd: range.endLine,
    original: [],
    replacement: []
  };
}

function hunkOverlapsRange(hunk: TextDiffHunk, range: ConflictRange) {
  return hunkOverlaps(hunk, rangeAsHunk(range))
    || hunkDuplicates(hunk, rangeAsHunk(range));
}

function applyDiffHunks(baseText: string, hunks: TextDiffHunk[]) {
  const merged = splitTextLines(baseText);
  const sorted = [...hunks].sort((left, right) =>
    right.baseStart - left.baseStart || right.baseEnd - left.baseEnd
  );
  for (const hunk of sorted) {
    merged.splice(hunk.baseStart, hunk.baseEnd - hunk.baseStart, ...hunk.replacement);
  }
  return merged.join("\n");
}

function conflictRangesFromQualityGate(qualityGate: Record<string, unknown> | undefined): ConflictRange[] {
  const diff3 = objectRecord(qualityGate?.["text_diff3"]);
  if (diff3?.["type"] !== "line_text_diff3") {
    return [];
  }
  const ranges = diff3["conflict_ranges"];
  if (!Array.isArray(ranges)) {
    return [];
  }
  return ranges.flatMap((raw, hunkIndex) => {
    const record = objectRecord(raw);
    const startLine = record?.["start_line"];
    const endLine = record?.["end_line"];
    return typeof startLine === "number"
      && Number.isInteger(startLine)
      && startLine > 0
      && typeof endLine === "number"
      && Number.isInteger(endLine)
      && endLine >= startLine
      ? [{ hunkIndex, startLine, endLine }]
      : [];
  });
}

function assertOverridesCoverRanges(input: {
  ranges: ConflictRange[];
  overrides: TextHunkApplyOverrides;
}) {
  if (input.ranges.length === 0) {
    throw new TextHunkMaterializationError(
      "text_hunk_ranges_missing",
      "Text hunk apply requires text_diff3 conflict ranges."
    );
  }
  const rangesByIndex = new Map(input.ranges.map((range) => [range.hunkIndex, range] as const));
  const seen = new Set<number>();
  const decisions: TextHunkMaterializationDecision[] = [];
  for (const override of input.overrides.hunks) {
    if (seen.has(override.hunk_index)) {
      throw new TextHunkMaterializationError(
        "text_hunk_override_duplicate",
        "The same text hunk was selected more than once."
      );
    }
    seen.add(override.hunk_index);
    const expected = rangesByIndex.get(override.hunk_index);
    if (!expected || expected.startLine !== override.start_line || expected.endLine !== override.end_line) {
      throw new TextHunkMaterializationError(
        "text_hunk_range_mismatch",
        "Text hunk selection does not match the reviewed conflict range."
      );
    }
    decisions.push({
      hunkIndex: override.hunk_index,
      startLine: override.start_line,
      endLine: override.end_line,
      decision: override.decision
    });
  }
  if (seen.size !== input.ranges.length) {
    throw new TextHunkMaterializationError(
      "text_hunk_override_missing",
      "Every reviewed text hunk must be selected before materializing the final text."
    );
  }
  return decisions.sort((left, right) => left.hunkIndex - right.hunkIndex);
}

function hunkKey(hunk: TextDiffHunk) {
  return `${hunk.baseStart}:${hunk.baseEnd}:${JSON.stringify(hunk.replacement)}`;
}

function materializedHunks(input: {
  ranges: ConflictRange[];
  decisions: TextHunkMaterializationDecision[];
  currentHunks: TextDiffHunk[];
  incomingHunks: TextDiffHunk[];
  aiFusionHunks: TextDiffHunk[];
}) {
  const selected: TextDiffHunk[] = [];
  const selectedKeys = new Set<string>();
  const rangesByIndex = new Map(input.ranges.map((range) => [range.hunkIndex, range] as const));
  const conflictRangeSet = input.ranges;

  function add(hunk: TextDiffHunk) {
    const key = hunkKey(hunk);
    if (!selectedKeys.has(key)) {
      selectedKeys.add(key);
      selected.push(hunk);
    }
  }

  function addNonConflict(hunks: TextDiffHunk[]) {
    for (const hunk of hunks) {
      if (!conflictRangeSet.some((range) => hunkOverlapsRange(hunk, range))) {
        add(hunk);
      }
    }
  }

  addNonConflict(input.currentHunks);
  addNonConflict(input.incomingHunks);

  for (const decision of input.decisions) {
    const range = rangesByIndex.get(decision.hunkIndex);
    if (!range) {
      continue;
    }
    const source = decision.decision === "keep_current"
      ? input.currentHunks
      : decision.decision === "accept_incoming" ? input.incomingHunks : input.aiFusionHunks;
    for (const hunk of source) {
      if (hunkOverlapsRange(hunk, range)) {
        add(hunk);
      }
    }
  }

  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const left = selected[leftIndex]!;
      const right = selected[rightIndex]!;
      if (hunkOverlaps(left, right)) {
        throw new TextHunkMaterializationError(
          "text_hunk_materialize_overlap_conflict",
          "Selected text hunk decisions overlap and cannot be safely materialized."
        );
      }
    }
  }
  return selected;
}

export function materializeTextHunkOverrides(input: {
  baseText: string;
  currentText: string;
  incomingText: string;
  aiFusionText: string;
  qualityGate?: Record<string, unknown>;
  overrides: TextHunkApplyOverrides;
}): TextHunkMaterializationResult {
  const ranges = conflictRangesFromQualityGate(input.qualityGate);
  const decisions = assertOverridesCoverRanges({
    ranges,
    overrides: input.overrides
  });
  const currentHunks = diffHunksFromBase(input.baseText, input.currentText);
  const incomingHunks = diffHunksFromBase(input.baseText, input.incomingText);
  const aiFusionHunks = diffHunksFromBase(input.baseText, input.aiFusionText);
  const hunks = materializedHunks({
    ranges,
    decisions,
    currentHunks,
    incomingHunks,
    aiFusionHunks
  });
  const content = applyDiffHunks(input.baseText, hunks);
  return {
    content,
    sha256: sha256Text(content),
    decisions,
    conflictRanges: ranges
  };
}
