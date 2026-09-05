import type { GithubActivityKind } from "@workhub/contracts";

// R23 P3b（SA-03）：把 github-poll 已经落库的仓库动态摘成「Cuu 能读的几行人话」，供项目规划
// （project-planner）与会话观察（conversation-observer）当作项目上下文的一部分。
//
// 纪律（04 铁律#4「不无上限塞进 prompt」的落地）：
//   * 只取最近 windowDays 天（默认 7）——更早的动态对「现在该干什么」没有参考价值；
//   * 三类（提交 / 合并请求 / 议题）各自最多 perKindLimit 条（默认 3），总条数因此硬封顶 9；
//   * 单条标题截到 titleMaxChars（默认 100）；
//   * 全部纯函数、无 DB/网络依赖，调用方负责取数（复用 listRecentActivitiesByProject）。
// 与 buildObserverUserPrompt 的 referencedContext 分开成独立小节：仓库动态是「客观事实」，
// 和「被引用的聊天上下文」不是一类材料，混在一起会让模型分不清哪些是人说的、哪些是系统观测的。

export type GithubActivityContextRow = {
  kind: GithubActivityKind;
  title: string;
  occurredAt: Date;
  state?: string | null;
  authorLogin?: string | null;
};

export type BuildRepoActivityLinesOptions = {
  now: Date;
  windowDays?: number;
  perKindLimit?: number;
  titleMaxChars?: number;
};

const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_PER_KIND_LIMIT = 3;
const DEFAULT_TITLE_MAX_CHARS = 100;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// 面向模型也面向人：三类活动的人话名字（不用 commit/PR/issue 黑话——同一份措辞纪律贯到 prompt 里，
// 免得模型顺手把技术词照抄进给用户看的行动卡标题）。
const KIND_LABELS: Record<GithubActivityKind, string> = {
  commit: "提交",
  pull_request: "合并请求",
  issue: "议题"
};

const KIND_ORDER: readonly GithubActivityKind[] = ["commit", "pull_request", "issue"];

function truncateTitle(title: string, maxChars: number): string {
  const trimmed = title.trim().replace(/\s+/gu, " ");
  if (trimmed.length === 0) {
    return "(无标题)";
  }
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

function relativeDayLabel(occurredAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - occurredAt.getTime()) / ONE_DAY_MS);
  if (days <= 0) {
    return "今天";
  }
  if (days === 1) {
    return "昨天";
  }
  return `${days} 天前`;
}

/**
 * 把一个项目的仓库活动行摘成不超过 3×perKindLimit 行的上下文文本。
 * 输入不要求排序——本函数自己按发生时间倒序取每类最新的几条。
 */
export function buildRepoActivityLines(
  rows: readonly GithubActivityContextRow[],
  options: BuildRepoActivityLinesOptions
): string[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const perKindLimit = options.perKindLimit ?? DEFAULT_PER_KIND_LIMIT;
  const titleMaxChars = options.titleMaxChars ?? DEFAULT_TITLE_MAX_CHARS;
  const cutoff = options.now.getTime() - windowDays * ONE_DAY_MS;

  const lines: string[] = [];
  for (const kind of KIND_ORDER) {
    const recent = rows
      .filter((row) => row.kind === kind && row.occurredAt.getTime() >= cutoff)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, perKindLimit);
    for (const row of recent) {
      const state = row.state?.trim();
      // state 只有 PR/议题有（open/closed/merged）；提交没有，别硬凑一个空括号。
      const stateSuffix = kind !== "commit" && state ? `（${state}）` : "";
      const author = row.authorLogin?.trim();
      const authorSuffix = author ? ` · ${author}` : "";
      lines.push(
        `${KIND_LABELS[kind]} · ${relativeDayLabel(row.occurredAt, options.now)}：${truncateTitle(row.title, titleMaxChars)}${stateSuffix}${authorSuffix}`
      );
    }
  }
  return lines;
}

// 取数上限：一次最多回 perKindLimit×3 的若干倍原始行再在内存里按类切片——给足冗余（同一天可能全是
// 提交），但仍是常数上限，不会随仓库活跃度无界增长。
export const REPO_ACTIVITY_FETCH_LIMIT = 30;
