import { attentionHomeVmSchema, type AttentionHomeVM, type WorkHubLocale } from "@workhub/contracts";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";
import { pageT } from "./i18n.js";
import { parseOutputContract } from "./output-contract.js";

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
  const queue = input.queue ?? [];
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
