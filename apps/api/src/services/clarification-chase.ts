import { settings as runtimeSettings } from "@workhub/config";
import {
  getSharedDatabaseClient,
  listStaleClarificationWorkItems,
  type StaleClarificationWorkItemRow
} from "@workhub/db";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import { createNotificationService, type NotificationService } from "./notifications.js";

// CHAT-8（澄清待答兜底）：澄清会话「建了就没人答」此前无任何兜底——工作项永远停在 ai_clarifying，
// 用户自己都忘了。最低成本修复：pulse 周期扫「ai_clarifying + 超过阈值（默认 24h，可配
// CLARIFICATION_PENDING_AFTER_MS）+ 零澄清回答」的工作项，给提交人落一条通知。
// 刻意不做升级机：dedupe_key（clarification_pending:{workItemId}）由 createOrUpdateNotification
// 幂等兜底——同一事项只留一条通知，重复 tick 不刷屏；用户答了/事项离澄清态后自然退出扫描。
// 纯规则、无 LLM，与 ddl-chase 同档（DB 驱动巡检）。

export const CLARIFICATION_PENDING_NOTIFICATION_TYPE = "workitem.clarification_pending";

const DEFAULT_MAX_PER_TICK = 200;

export type ClarificationChaseRunResult = {
  scanned: number;
  delivered: number;
  // 通知服务按收件人静音偏好跳过（与所有通知同口径的 DEFAULT-OFF 语义）。
  suppressed_muted: number;
  started_at: string;
  finished_at: string;
};

export type ClarificationChaseServiceDeps = {
  listStale: (input: { olderThan: Date; limit: number }) => Promise<StaleClarificationWorkItemRow[]>;
  notifications: Pick<NotificationService, "createNotification">;
  // 「待答滞留」阈值（默认 24h）。可配——pulse 装配时从 settings.pulse.clarificationPendingAfterMs 注入。
  pendingAfterMs?: number;
  now?: () => Date;
  maxPerTick?: number;
  logger?: Pick<StructuredLogger, "info" | "warn">;
};

export type ClarificationChaseService = ReturnType<typeof createClarificationChaseService>;

// work_items.title 与 notifications.title 都是 varchar(256)——拼上前缀会撑破列宽，
// 与 ddl-chase 的 displayTitle 同口径夹断。
const DISPLAY_TITLE_MAX = 200;

function displayTitle(candidate: StaleClarificationWorkItemRow): string {
  const title = candidate.title?.trim();
  const base = title && title.length > 0 ? title : candidate.code;
  return base.length > DISPLAY_TITLE_MAX ? `${base.slice(0, DISPLAY_TITLE_MAX - 1)}…` : base;
}

export function createClarificationChaseService(deps: ClarificationChaseServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const pendingAfterMs = deps.pendingAfterMs ?? 24 * 60 * 60 * 1000;
  const maxPerTick = deps.maxPerTick ?? DEFAULT_MAX_PER_TICK;
  const logger = deps.logger ?? getDefaultStructuredLogger();

  return {
    async runOnce(): Promise<ClarificationChaseRunResult> {
      const startedAt = now();
      const stale = await deps.listStale({
        olderThan: new Date(startedAt.getTime() - pendingAfterMs),
        limit: maxPerTick
      });
      let delivered = 0;
      let muted = 0;
      for (const candidate of stale) {
        // 逐条投递容错：一条通知写失败不该连累本 tick 其余候选（pulse 任务错误隔离在调度器层，
        // 这里是候选级的第二层——与 ddl-chase 的逐候选 try/catch 同姿态）。
        try {
          const name = displayTitle(candidate);
          const notification = await deps.notifications.createNotification({
            userId: candidate.submitterUserId,
            type: CLARIFICATION_PENDING_NOTIFICATION_TYPE,
            severity: "normal",
            title: `「${name}」的澄清还等你回答`,
            body: "这个事项的澄清问题一直没有收到回答，去会话里补一句就能继续推进。",
            // 深链到接入会话页（/intake/:sessionId，sessionId 即 workItemId）——落地就能作答。
            targetUrl: `/intake/${candidate.workItemId}`,
            workItemId: candidate.workItemId,
            projectId: candidate.projectId,
            dedupeKey: `clarification_pending:${candidate.workItemId}`
          });
          if (notification) {
            delivered += 1;
          } else {
            muted += 1;
          }
        } catch (error) {
          logger.warn("clarification_chase_deliver_failed", { workItemId: candidate.workItemId, error });
        }
      }
      const finishedAt = now();
      return {
        scanned: stale.length,
        delivered,
        suppressed_muted: muted,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString()
      };
    }
  };
}

export function getDefaultClarificationChaseService(): ClarificationChaseService {
  const client = getSharedDatabaseClient();
  return createClarificationChaseService({
    listStale: (input) => listStaleClarificationWorkItems(client.db, input),
    notifications: createNotificationService(),
    pendingAfterMs: runtimeSettings.pulse.clarificationPendingAfterMs
  });
}
