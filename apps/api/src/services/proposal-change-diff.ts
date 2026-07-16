// R16-W3（变更编辑器 · 后端最小 additive）：把一份提议里某个变动文件的「base vs proposed」摊成
// tracked-changes 视图 VM。纯函数——base 全文/proposed 全文由调用方（routes/proposals.ts）在 IO 层
// 备好（base 走 findMergeContext→readSnapshotFile 快照读，proposed 走 manifest change 的
// machine_summary.generated_content_md），这里只负责截断守卫 + 调 contracts 共享的 trackedTextSegments
// + 组 VM，故可脱离 DB/文件系统单测（与 deliverable-diff-stats 的分工同精神）。

import {
  proposalChangeDiffVmSchema,
  splitTextLines,
  trackedTextSegments,
  type DeliverableChange,
  type ProposalChangeDiffSegment,
  type ProposalChangeDiffVM
} from "@workhub/contracts";

// 与 proposal-change preview 的 200000 上限对齐——超大文件不逐行比对（编辑器审阅场景，几十万字的
// 单文件已经远超「人审一份变更」的合理边界），截断后仍给出诚实的 truncated 标注。
const MAX_DIFF_CHARS = 200_000;

export type ProposalChangeDiffBuildInput = {
  proposalId: string;
  status: "opened" | "reviewed" | "merged" | "rejected";
  title: string;
  change: DeliverableChange;
  // 改动前全文；null = 没能解析出 base（快照读不到 / 非 created 变更但快照缺失）。created 变更传 null
  // 也会被当成空 base（全新增），因为它的 base 天然为空、不算「解析失败」。
  baseText: string | null;
};

function filenameFromPath(path: string, fallback: string): string {
  const leaf = path.split("/").filter(Boolean).pop();
  return leaf && leaf.length > 0 ? leaf : fallback;
}

export function buildProposalChangeDiffVm(input: ProposalChangeDiffBuildInput): ProposalChangeDiffVM {
  const rawProposed = input.change.machine_summary?.generated_content_md ?? "";
  const proposedTruncated = rawProposed.length > MAX_DIFF_CHARS;
  const proposed = proposedTruncated ? rawProposed.slice(0, MAX_DIFF_CHARS) : rawProposed;

  const created = input.change.change_type === "created";
  // created 的 base 天然为空且诚实（不是「读失败」）；其它变更类型只有真读到 base 才算可比对。
  const baseResolved = created ? "" : input.baseText;
  const baseAvailable = created || baseResolved !== null;
  const rawBase = baseResolved ?? "";
  const baseTruncated = rawBase.length > MAX_DIFF_CHARS;
  const base = baseTruncated ? rawBase.slice(0, MAX_DIFF_CHARS) : rawBase;

  const path = input.change.target_ref.path ?? "";
  const filename = filenameFromPath(path, input.change.target_ref.entity_type);

  let segments: ProposalChangeDiffSegment[];
  let diffTruncated = false;
  if (baseAvailable) {
    const computed = trackedTextSegments(base, proposed);
    if (computed) {
      segments = computed;
    } else {
      // 行数超上限，trackedTextSegments 拒绝硬算——降级成「仅显示 proposed 全文（不高亮）」，标 truncated
      // 让编辑器诚实说明这份改动太大没有逐行比对。
      segments = proposed.length === 0 ? [] : [{ type: "context", lines: splitTextLines(proposed) }];
      diffTruncated = true;
    }
  } else {
    // 改动前版本不可得：只把 proposed 当作 context 平铺，编辑器渲染「无法比对改动前版本」横幅，
    // 绝不把整份 proposed 涂成全绿新增（那会误导审阅人以为这是一份全新文件）。
    segments = proposed.length === 0 ? [] : [{ type: "context", lines: splitTextLines(proposed) }];
  }

  return proposalChangeDiffVmSchema.parse({
    proposal_id: input.proposalId,
    change_id: input.change.id,
    path,
    filename,
    change_type: input.change.change_type,
    status: input.status,
    title: input.title,
    base_available: baseAvailable,
    truncated: proposedTruncated || baseTruncated || diffTruncated,
    segments
  });
}
