export type TextDiff3Excerpt = {
  text: string;
  truncated: boolean;
};

export type TextDiff3Context = {
  current?: TextDiff3Excerpt;
  incoming?: TextDiff3Excerpt;
  base?: TextDiff3Excerpt;
};

export type TextDiffHunk = {
  baseStart: number;
  baseEnd: number;
  original: string[];
  replacement: string[];
};

const MAX_DIFF3_LINES = 5000;

export function containsGitConflictMarkers(value: string): boolean {
  return /(^|\n)(<<<<<<<[ \t].*|=======$|>>>>>>>[ \t].*)/u.test(value);
}

export function splitTextLines(value: string) {
  return value.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").split("\n");
}

export function changedLineIndexesFromBase(baseText: string, changedText: string) {
  const base = splitTextLines(baseText);
  const changed = splitTextLines(changedText);
  const indexes = new Set<number>();
  const max = Math.max(base.length, changed.length);
  for (let index = 0; index < max; index += 1) {
    if ((base[index] ?? "") !== (changed[index] ?? "")) {
      indexes.add(index);
    }
  }
  return indexes;
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

function overlappingDiffHunkPairs(left: TextDiffHunk[], right: TextDiffHunk[]) {
  const pairs: Array<{ current: TextDiffHunk; incoming: TextDiffHunk }> = [];
  for (const current of left) {
    for (const incoming of right) {
      if (hunkOverlaps(current, incoming)) {
        pairs.push({ current, incoming });
      }
    }
  }
  return pairs;
}

function mergeUniqueHunks(currentHunks: TextDiffHunk[], incomingHunks: TextDiffHunk[]) {
  const merged = [...currentHunks];
  for (const incoming of incomingHunks) {
    if (!merged.some((existing) => hunkDuplicates(existing, incoming))) {
      merged.push(incoming);
    }
  }
  return merged;
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

export function textDiff3Analysis(input: TextDiff3Context | undefined) {
  if (
    !input?.base?.text
    || !input.current?.text
    || !input.incoming?.text
    || input.base.truncated
    || input.current.truncated
    || input.incoming.truncated
  ) {
    return undefined;
  }
  if (
    splitTextLines(input.base.text).length > MAX_DIFF3_LINES
    || splitTextLines(input.current.text).length > MAX_DIFF3_LINES
    || splitTextLines(input.incoming.text).length > MAX_DIFF3_LINES
  ) {
    return undefined;
  }
  const currentHunks = diffHunksFromBase(input.base.text, input.current.text);
  const incomingHunks = diffHunksFromBase(input.base.text, input.incoming.text);
  const conflictPairs = overlappingDiffHunkPairs(currentHunks, incomingHunks);
  return {
    currentHunks,
    incomingHunks,
    conflictPairs
  };
}

export function textDiff3Merge(input: TextDiff3Context) {
  if (input.current?.text === input.incoming?.text) {
    return undefined;
  }
  const analysis = textDiff3Analysis(input);
  if (!analysis) {
    return undefined;
  }
  const { currentHunks, incomingHunks, conflictPairs } = analysis;
  if (incomingHunks.length === 0 || conflictPairs.length > 0) {
    return undefined;
  }
  const baseText = input.base?.text;
  const currentText = input.current?.text;
  if (!baseText || !currentText) {
    return undefined;
  }
  const mergedText = applyDiffHunks(baseText, mergeUniqueHunks(currentHunks, incomingHunks));
  if (mergedText === currentText || containsGitConflictMarkers(mergedText)) {
    return undefined;
  }
  return {
    mergedText,
    currentHunks,
    incomingHunks
  };
}

export function textDiff3HunkBaseRange(current: TextDiffHunk, incoming: TextDiffHunk) {
  const start = Math.min(current.baseStart, incoming.baseStart);
  const end = Math.max(current.baseEnd, incoming.baseEnd);
  return {
    start_line: start + 1,
    end_line: Math.max(start + 1, end)
  };
}

// R16-W3（变更编辑器 · tracked changes 视图）：把「base 与 proposed 两份全量文本」摊成一串按顺序排列的
// 行级段落——context（未变更，编辑器可折叠成「…未变更 N 行」）/ del（红底删除线）/ add（绿底新增）。
// 这是「变更审阅器」右栏 diff 端点与桌面编辑器共享的唯一 diff 语义来源：复用本文件既有的 LCS
// diffHunksFromBase（P-COLLAB 三方合并同一套逐 hunk 算法），不另造一份 diff。纯函数、无副作用、可单测。
export type TrackedTextSegment =
  | { type: "context"; lines: string[] }
  | { type: "del"; lines: string[] }
  | { type: "add"; lines: string[] };

// 超过这个行数就不做 O(base×changed) 的 LCS（与 MAX_DIFF3_LINES 同精神，铁律#4「循环不发无上限重活」）——
// 调用方据 undefined 回退到「只展示 proposed 全文、不逐行比对」的诚实降级，不硬算把编辑器卡死。
const MAX_TRACKED_DIFF_LINES = 5000;

export function trackedTextSegments(baseText: string, changedText: string): TrackedTextSegment[] | undefined {
  // 空 base（新建文件）= 全量新增；空 proposed（删空）= 全量删除——不落进 LCS 里把一个空行当成
  // 「删了一行空的」这种误导性噪声。两边都空 = 无段落。
  if (baseText.length === 0) {
    return changedText.length === 0 ? [] : [{ type: "add", lines: splitTextLines(changedText) }];
  }
  if (changedText.length === 0) {
    return [{ type: "del", lines: splitTextLines(baseText) }];
  }
  const baseLines = splitTextLines(baseText);
  const changedLines = splitTextLines(changedText);
  if (baseLines.length > MAX_TRACKED_DIFF_LINES || changedLines.length > MAX_TRACKED_DIFF_LINES) {
    return undefined;
  }
  const hunks = diffHunksFromBase(baseText, changedText);
  const segments: TrackedTextSegment[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    if (hunk.baseStart > cursor) {
      segments.push({ type: "context", lines: baseLines.slice(cursor, hunk.baseStart) });
    }
    if (hunk.original.length > 0) {
      segments.push({ type: "del", lines: hunk.original });
    }
    if (hunk.replacement.length > 0) {
      segments.push({ type: "add", lines: hunk.replacement });
    }
    cursor = hunk.baseEnd;
  }
  if (cursor < baseLines.length) {
    segments.push({ type: "context", lines: baseLines.slice(cursor) });
  }
  return segments;
}
