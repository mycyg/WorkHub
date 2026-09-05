// SA-02：会议分析调度器——把导入的转写排队送去分析。
//
// 队列就是 meeting_records.status 本身（不新建 job 表、不加迁移）：listMeetingsForAnalysis 扫
// `transcribed`（导入落库的初始态）以及认领后卡死超过租约视界的 `processing`（进程崩在 LLM 调用
// 中途留下的孤儿）。逐条走 meeting-analysis 服务，认领是条件 UPDATE，所以多实例并跑也安全。
//
// 骨架仿 apps/api/src/workers/conversation-observer.ts：running 守卫 + 独立可测的 tick()，
// 定时器 unref 不挡进程退出。与观察者同档受 provider isConfigured 门控（见 server.ts）——
// 没配 key 时压根不启动，会议就诚实停在「转写已导入 / AI 未配置」。

import { settings as runtimeSettings } from "@workhub/config";
import {
  createMeetingRepository,
  getSharedDatabaseClient,
  type MeetingRepository
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import {
  getDefaultMeetingAnalysisService,
  MEETING_ANALYSIS_STALE_CLAIM_MS,
  type MeetingAnalysisService
} from "../services/meeting-analysis.js";

const DEFAULT_INTERVAL_MS = 30_000;
// 每 tick 最多分析这么多场会议——一场会议 = 一次 LLM 调用，批量导入时不能一口气把预算打空。
const DEFAULT_MAX_MEETINGS_PER_TICK = 3;

export type MeetingAnalysisTickResult = {
  scanned: number;
  analyzed: number;
  insights_created: number;
  skipped_not_claimable: number;
  skipped_budget: number;
  skipped_not_configured: number;
  failed: number;
  started_at: string;
  finished_at: string;
};

export type MeetingAnalysisScheduler = {
  tick: () => Promise<MeetingAnalysisTickResult>;
  start: () => void;
  stop: () => void;
  stats: () => {
    running: boolean;
    tick_count: number;
    analyzed_count: number;
    failed_count: number;
    error_count: number;
    last_tick_at?: string;
    last_error_message?: string;
  };
};

export type MeetingAnalysisSchedulerDependencies = {
  repo: Pick<MeetingRepository, "listMeetingsForAnalysis">;
  analysis: Pick<MeetingAnalysisService, "analyzeMeeting">;
  logger?: Pick<StructuredLogger, "warn" | "error">;
  now?: () => Date;
  intervalMs?: number;
  maxMeetingsPerTick?: number;
  onError?: (error: unknown) => void;
};

export function createMeetingAnalysisScheduler(
  deps: MeetingAnalysisSchedulerDependencies
): MeetingAnalysisScheduler {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxMeetingsPerTick = deps.maxMeetingsPerTick ?? DEFAULT_MAX_MEETINGS_PER_TICK;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  let tickCount = 0;
  let analyzedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let lastTickAt: string | undefined;
  let lastErrorMessage: string | undefined;

  function zeroResult(startedAt: Date): MeetingAnalysisTickResult {
    return {
      scanned: 0,
      analyzed: 0,
      insights_created: 0,
      skipped_not_claimable: 0,
      skipped_budget: 0,
      skipped_not_configured: 0,
      failed: 0,
      started_at: startedAt.toISOString(),
      finished_at: startedAt.toISOString()
    };
  }

  async function tick(): Promise<MeetingAnalysisTickResult> {
    const startedAt = now();
    if (running) {
      return zeroResult(startedAt);
    }
    running = true;
    tickCount += 1;
    try {
      const candidates = await deps.repo.listMeetingsForAnalysis?.({
        limit: maxMeetingsPerTick,
        staleBefore: new Date(startedAt.getTime() - MEETING_ANALYSIS_STALE_CLAIM_MS)
      }) ?? [];
      let analyzed = 0;
      let insightsCreated = 0;
      let skippedNotClaimable = 0;
      let skippedBudget = 0;
      let skippedNotConfigured = 0;
      let failed = 0;
      for (const candidate of candidates) {
        // 服务内部自己 try/catch 并落 structured log；这里再兜一层是为了「一场会议炸了不拖垮整个 tick」。
        let result;
        try {
          result = await deps.analysis.analyzeMeeting({ meetingId: candidate.meeting.id });
        } catch (error) {
          failed += 1;
          logger.warn?.("meeting_analysis_worker_meeting_failed", {
            meeting_id: candidate.meeting.id,
            error
          });
          continue;
        }
        if (result.outcome === "analyzed") {
          analyzed += 1;
          insightsCreated += result.insight_count;
        } else if (result.outcome === "skipped_budget") {
          skippedBudget += 1;
        } else if (result.outcome === "skipped_not_configured") {
          skippedNotConfigured += 1;
        } else if (result.outcome === "skipped_not_claimable") {
          skippedNotClaimable += 1;
        } else {
          failed += 1;
        }
      }
      const finishedAt = now();
      analyzedCount += analyzed;
      failedCount += failed;
      lastTickAt = finishedAt.toISOString();
      return {
        scanned: candidates.length,
        analyzed,
        insights_created: insightsCreated,
        skipped_not_claimable: skippedNotClaimable,
        skipped_budget: skippedBudget,
        skipped_not_configured: skippedNotConfigured,
        failed,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString()
      };
    } catch (error) {
      errorCount += 1;
      lastErrorMessage = error instanceof Error ? error.message : String(error);
      deps.onError?.(error);
      throw error;
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || intervalMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      void tick().catch((error) => {
        logger.error?.("meeting_analysis_tick_failed", { error });
      });
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) {
      return;
    }
    clearInterval(timer);
    timer = undefined;
  }

  return {
    tick,
    start,
    stop,
    stats: () => ({
      running,
      tick_count: tickCount,
      analyzed_count: analyzedCount,
      failed_count: failedCount,
      error_count: errorCount,
      ...(lastTickAt ? { last_tick_at: lastTickAt } : {}),
      ...(lastErrorMessage ? { last_error_message: lastErrorMessage } : {})
    })
  };
}

let defaultScheduler: MeetingAnalysisScheduler | undefined;

export function getDefaultMeetingAnalysisScheduler(): MeetingAnalysisScheduler {
  if (defaultScheduler) {
    return defaultScheduler;
  }
  defaultScheduler = createMeetingAnalysisScheduler({
    repo: createMeetingRepository(getSharedDatabaseClient().db),
    analysis: getDefaultMeetingAnalysisService(),
    intervalMs: runtimeSettings.agentRun.recoveryIntervalMs
  });
  return defaultScheduler;
}
