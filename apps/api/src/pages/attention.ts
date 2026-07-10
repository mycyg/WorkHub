import { attentionHomeVmSchema, type AttentionHomeVM, type AttentionItem, type WorkHubLocale } from "@workhub/contracts";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";
import { pageT } from "./i18n.js";
import { parseOutputContract } from "./output-contract.js";

const decisionKindRank: Partial<Record<AttentionItem["kind"], number>> = {
  escalation: 0,
  budget: 1,
  sync_conflict: 2,
  approval: 3,
  plan_review: 4,
  proposal_review: 5
};

function sortDecisionQueue(queue: AttentionHomeVM["queue"]): AttentionHomeVM["queue"] {
  return queue
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const rankDelta = (decisionKindRank[left.item.kind] ?? 99) - (decisionKindRank[right.item.kind] ?? 99);
      return rankDelta || left.index - right.index;
    })
    .map(({ item }) => item);
}

function toBackgroundRun(
  run: AgentRunQueueRecord,
  locale: WorkHubLocale
): AttentionHomeVM["background_runs"][number] | undefined {
  if (run.status === "succeeded" || run.status === "cancelled") {
    return undefined;
  }
  const state =
    run.status === "escalated"
      ? "waiting_for_user"
      : run.status === "failed"
        ? "failed"
        : run.status;
  // findings[#low]：?? 只挡 null/undefined——空串 blocker 会让 preview_text='' 撞上
  // schema 的 .min(1)、把整页打成 500。取第一个非空 blocker，否则回退本地化文案。
  const blocker = run.handoff?.blockers.find((entry) => entry.length > 0);
  return {
    run_id: run.run_id,
    work_item_id: run.work_item_id,
    title: run.title,
    state,
    preview_text: blocker ?? pageT(locale, run.status === "running" ? "attention.running" : "attention.queued")
  };
}

export function buildAttentionHomePage(input: {
  queue?: AttentionHomeVM["queue"];
  sourceWarnings?: AttentionHomeVM["source_warnings"];
  backgroundRuns?: AgentRunQueueRecord[];
  locale?: WorkHubLocale;
  worklog?: AttentionHomeVM["worklog"];
} = {}): AttentionHomeVM {
  const locale = input.locale ?? "zh-CN";
  const queue = sortDecisionQueue(input.queue ?? []);
  const background_runs = (input.backgroundRuns ?? [])
    .map((run) => toBackgroundRun(run, locale))
    .filter((run): run is AttentionHomeVM["background_runs"][number] => Boolean(run));

  // L10：与其余 page builder 一致，返回前过 zod parse（fail-closed：装配出错就报错而非渲染走样 VM）。
  // findings[#79]：输出边界 parse 失败是服务端装配 bug → InternalContractError(500)，不是客户端 422。
  return parseOutputContract(attentionHomeVmSchema, {
    primary: queue[0],
    queue,
    source_warnings: input.sourceWarnings ?? [],
    background_runs,
    cuu_state: queue[0]?.cuu_state ?? (background_runs.length > 0 ? "thinking" : "idle"),
    ...(input.worklog ? { worklog: input.worklog } : {})
  }, "attention-home");
}
