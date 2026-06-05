import type { AttentionHomeVM } from "@workhub/contracts";

import type { AgentRunQueueRecord } from "../workers/agent-runner.js";

function toBackgroundRun(run: AgentRunQueueRecord): AttentionHomeVM["background_runs"][number] | undefined {
  if (run.status === "succeeded" || run.status === "cancelled") {
    return undefined;
  }
  const state =
    run.status === "escalated"
      ? "waiting_for_user"
      : run.status === "failed"
        ? "failed"
        : run.status;
  return {
    run_id: run.run_id,
    work_item_id: run.work_item_id,
    title: run.title,
    state,
    preview_text: run.handoff?.blockers[0] ?? (run.status === "running" ? "AI 正在处理这个事项。" : "AI 已排队等待开始。")
  };
}

export function buildAttentionHomePage(input: {
  queue?: AttentionHomeVM["queue"];
  backgroundRuns?: AgentRunQueueRecord[];
} = {}): AttentionHomeVM {
  const queue = input.queue ?? [];
  const background_runs = (input.backgroundRuns ?? [])
    .map(toBackgroundRun)
    .filter((run): run is AttentionHomeVM["background_runs"][number] => Boolean(run));

  return {
    primary: queue[0],
    queue,
    background_runs,
    cuu_state: queue[0]?.cuu_state ?? (background_runs.length > 0 ? "thinking" : "idle")
  };
}
