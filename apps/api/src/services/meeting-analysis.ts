// SA-02（会议模块死胡同收口）：把「转写 → AI 纪要 → AI 洞察 → 需求草稿（人确认）」的中间两段真正接上。
//
// 在这之前：唯一的会议入口 importTranscript 只写一行 status="transcribed" 的 meeting_records，
// 全仓没有任何地方写 meeting_insights、也没有任何地方生成 minutes_md。于是页面叫「会议洞察」、
// 洞察卡挂着「生成草稿 / 忽略」、通知类型 meeting.insight.pending、搜索索引 minutes_md 全部空转。
//
// 形态照 apps/api/src/workers/conversation-observer.ts 的四条纪律：
//   1) provider isConfigured 门控——没配 key 就不动状态、不打日志噪音，由页面诚实告知（不是假装在处理）；
//   2) 结构化输出调用一律 disableThinking——thinking 模型的思维链计入 max_tokens，会把 JSON 截断；
//   3) 预算软闸——分析前用 decideRunBudget 读团队维度已用量快照，不足就把认领放回去，下轮再来；
//   4) 幂等——认领即条件 UPDATE（status 守卫 + RETURNING），并发只有一个能拿到行。
//
// 失败不吞错：任何异常都落 structured log（meeting_analysis_failed），并把会议置 failed，
// 让页面显示「处理失败」+ 一个真能点的「重新生成纪要」，而不是永远停在「还没有纪要」。

import { settings as runtimeSettings, type Settings } from "@workhub/config";
import type { ProviderRegistry } from "@workhub/agent/providers";
import {
  decideRunBudget,
  type BudgetPolicyStore,
  type CostLedgerStore
} from "@workhub/cost";
import {
  createMeetingRepository,
  createNotificationRepository,
  getSharedDatabaseClient,
  type MeetingAnalysisCandidateRow,
  type MeetingAnalysisInsightInput,
  type MeetingRepository,
  type NotificationRepository
} from "@workhub/db";
import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";
import { z } from "zod";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import { getDefaultCostLedgerStore } from "./cost-ledger-store.js";
import { getDefaultBudgetPolicyStore } from "./cost-policy-store.js";
import { getDefaultProviderRegistry } from "./provider-registry.js";

const MEETING_ANALYSIS_MAX_TOKENS = 3_000;
const MEETING_ANALYSIS_TIMEOUT_MS = 90_000;
// 提示词里带的转写上限。转写列没有长度上限（导入端口封顶 200k 字符），全量喂进去既超上下文
// 也把成本拉爆；截断到 24k 字符并在提示词里如实说明「已截断」，让模型不要假装读完了全文。
const MEETING_TRANSCRIPT_PROMPT_MAX = 24_000;
const MAX_INSIGHTS = 8;
// 认领租约视界：分析进程崩在 LLM 调用中途时状态会永远停在 processing。超过这个时长仍没动过的
// 认领视为死掉，允许 worker 重新认领。取值宽于单次分析超时（90s），不会误抢正在跑的那一个。
export const MEETING_ANALYSIS_STALE_CLAIM_MS = 15 * 60 * 1000;

export type MeetingAnalysisOutcome =
  | "analyzed"
  | "skipped_not_configured"
  | "skipped_budget"
  | "skipped_not_claimable"
  | "failed";

export type MeetingAnalysisResult = {
  outcome: MeetingAnalysisOutcome;
  meeting_id: string;
  insight_count: number;
  /** 非 analyzed 时的机器可读原因（结构化日志与端点错误码共用同一套字符串）。 */
  reason?: string;
};

export type MeetingAnalysisService = {
  analyzeMeeting: (input: {
    meetingId: string;
    /** 「重新生成纪要」用：无视当前状态强行认领（ready/failed 都能重跑）。 */
    force?: boolean;
    locale?: WorkHubLocale;
  }) => Promise<MeetingAnalysisResult>;
  /** 是否配了 LLM——页面用它决定说「还在生成」还是「AI 未配置，只保存了转写」。 */
  isConfigured: () => boolean;
};

export type MeetingAnalysisServiceDependencies = {
  repo: Pick<MeetingRepository,
    | "claimMeetingForAnalysis"
    | "releaseMeetingAnalysisClaim"
    | "saveMeetingAnalysis"
    | "markMeetingAnalysisFailed"
  >;
  providerRegistry: Pick<ProviderRegistry, "isConfigured" | "get">;
  notifications?: Pick<NotificationRepository, "createOrUpdateNotification">;
  policyStore?: Pick<BudgetPolicyStore, "listPolicies">;
  ledgerStore?: Pick<CostLedgerStore, "usageSnapshots">;
  settings?: Settings;
  logger?: Pick<StructuredLogger, "info" | "warn" | "error">;
  now?: () => Date;
};

// ── LLM 输出契约 ────────────────────────────────────────────────────────────────────
//
// kind 三值直接沿用 db schema / packages/contracts 里已有的枚举（meetingInsightVmSchema），
// 不新造。confidence_reason 是硬要求：仓库层 insightToDraft 明确「缺少判断理由就不能生成草稿」
// （meetings.ts 的 meeting_insight_rationale_missing），所以这里在解析阶段就把没理由的条目挡掉，
// 免得攒下一堆点「生成草稿」必然 409 的死洞察。

const analysisResponseSchema = z.object({
  minutes_md: z.string().trim().min(1),
  insights: z.array(z.object({
    kind: z.enum(["new_requirement", "requirement_change", "normal_note"]),
    title: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1),
    confidence_reason: z.string().trim().min(1)
  })).max(MAX_INSIGHTS).default([])
});

export type MeetingAnalysisResponse = z.infer<typeof analysisResponseSchema>;

function textFromContent(content: unknown[]) {
  return content
    .map((block) => {
      if (typeof block === "string") {
        return block;
      }
      if (block && typeof block === "object") {
        const text = (block as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("\n")
    .trim();
}

// 模型偶尔会把 JSON 包在 ```json 围栏里。围栏是唯一容忍的偏差——别的畸形一律按解析失败处理，
// 不做「尽力猜一下」的补救（猜错了会把幻觉当成纪要写进库，比失败更糟）。
function stripJsonFence(text: string) {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/u.exec(text.trim());
  return fenced?.[1]?.trim() ?? text.trim();
}

function parseJsonObject(text: string): unknown {
  const parsed = JSON.parse(stripJsonFence(text));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM response was not a JSON object");
  }
  return parsed;
}

export function parseMeetingAnalysisResponse(text: string): MeetingAnalysisResponse {
  return analysisResponseSchema.parse(parseJsonObject(text));
}

export function buildMeetingAnalysisSystemPrompt(locale: WorkHubLocale): string {
  const zh = normalizeWorkHubLocale(locale) !== "en-US";
  return [
    "You are WorkHub's meeting analyst. Return strict JSON only — no prose, no code fences.",
    "Shape: {\"minutes_md\":\"...\",\"insights\":[{\"kind\":\"new_requirement|requirement_change|normal_note\",\"title\":\"...\",\"description\":\"...\",\"confidence_reason\":\"...\"}]}",
    // 三条硬约束。第三条是这条链路的宪法：AI 永不静默改需求，只产出待人确认的建议
    // （docs/workhub/04-modules/meetings-and-insights.md §0.2）。
    "Rules:",
    "1. Ground every sentence in the transcript. Never invent decisions, owners, dates or numbers that are not in it. If the transcript is too thin to summarise, still write minutes_md saying so and return an empty insights array.",
    "2. Every insight must carry confidence_reason: plain language explaining why you think it is that kind, quoting or paraphrasing the transcript. An insight without a reason is dropped.",
    `3. Never propose changing project state directly. Insights are suggestions a human confirms. At most ${MAX_INSIGHTS} insights, highest signal first.`,
    "4. kind meanings: new_requirement = the meeting asks for work that does not exist yet; requirement_change = it changes work already agreed; normal_note = worth recording but not actionable work.",
    zh
      ? "5. minutes_md、title、description、confidence_reason 全部写中文，用人话，不要 snake_case、不要术语黑话、不要 emoji。minutes_md 用 Markdown 小标题分「结论 / 待办 / 风险」等段落。"
      : "5. Write minutes_md, title, description and confidence_reason in English, in plain language — no snake_case, no jargon, no emoji. Use Markdown headings in minutes_md."
  ].join("\n");
}

export function buildMeetingAnalysisUserPrompt(input: {
  projectName: string;
  meetingTitle: string;
  transcript: string;
}): string {
  const transcript = input.transcript.trim();
  const truncated = transcript.length > MEETING_TRANSCRIPT_PROMPT_MAX;
  const body = truncated ? transcript.slice(0, MEETING_TRANSCRIPT_PROMPT_MAX) : transcript;
  return [
    `Project: ${input.projectName}`,
    `Meeting: ${input.meetingTitle}`,
    truncated
      ? `Transcript (truncated to the first ${MEETING_TRANSCRIPT_PROMPT_MAX} characters — say so in the minutes if it matters):`
      : "Transcript:",
    body
  ].join("\n\n");
}

// ── 通知文案 ────────────────────────────────────────────────────────────────────────
//
// 与读路径 apps/api/src/services/schedule-notify-pages.ts 的 ensureMeetingInsightNotifications
// 共用同一个 dedupeKey（meeting_insight:<insightId>）。分析完成时先推给上传者，读路径之后为
// 每个有权查看的人补齐——同 key 的 upsert 在内容一致时是 no-op，两条路径不会互相刷掉对方。
export function buildMeetingInsightNotificationCopy(locale: WorkHubLocale, input: {
  insightTitle: string;
  meetingTitle: string;
}) {
  if (normalizeWorkHubLocale(locale) === "en-US") {
    return {
      title: "Meeting insight needs review",
      body: `${input.meetingTitle} mentions "${input.insightTitle}". Decide whether to create a work draft.`
    };
  }
  return {
    title: "会议建议等待确认",
    body: `${input.meetingTitle} 里提到「${input.insightTitle}」，需要你决定是否生成工作草稿。`
  };
}

// ── 服务本体 ────────────────────────────────────────────────────────────────────────

type MeetingAnalysisLlmClient = {
  messages: {
    create: (params: {
      maxTokens: number;
      disableThinking: boolean;
      source: string;
      timeoutMs: number;
      system: string;
      messages: Array<{ role: "user"; content: string }>;
    }) => Promise<{ content: unknown[] }>;
  };
};

export function createMeetingAnalysisService(
  deps: MeetingAnalysisServiceDependencies
): MeetingAnalysisService {
  const now = deps.now ?? (() => new Date());
  const logger = deps.logger ?? getDefaultStructuredLogger();

  async function budgetAllows(candidate: MeetingAnalysisCandidateRow, at: Date) {
    // 预算闸与观察者同款「软闸」：会议分析同样发生在任何 agent_run 之前，没有可挂靠的 run_id 做
    // 原子预留（budget_reservations.run_id 是 NOT NULL 外键），所以读团队已用量快照做门槛判断。
    // 真实成本仍由 ProviderRegistry 的 usageSink 计入 cost_ledger_entries。
    // 项目没有 workspace（历史数据 / 个人空间未归属）时没有可用的团队预算口径——不拿一个假 scope
    // 去问闸门（那会按「团队 null」聚合出无意义的结果），直接放行，成本仍照常计入 ledger。
    const teamId = candidate.project.workspaceId;
    if (!deps.ledgerStore || !deps.policyStore || !teamId) {
      return true;
    }
    const settings = deps.settings ?? runtimeSettings;
    const scopeIds = { teamId };
    const usage = await deps.ledgerStore.usageSnapshots(scopeIds, { now: at });
    const decision = decideRunBudget({
      settings,
      scopeIds,
      policies: await deps.policyStore.listPolicies(settings),
      usage,
      now: at
    });
    return decision.allowed;
  }

  async function notifyUploader(input: {
    candidate: MeetingAnalysisCandidateRow;
    insightIds: string[];
    insights: MeetingAnalysisInsightInput[];
    locale: WorkHubLocale;
    at: Date;
  }) {
    if (!deps.notifications || input.insightIds.length === 0) {
      return;
    }
    const { meeting, project } = input.candidate;
    for (const [index, insightId] of input.insightIds.entries()) {
      const insight = input.insights[index];
      if (!insight) {
        continue;
      }
      const copy = buildMeetingInsightNotificationCopy(input.locale, {
        insightTitle: insight.title,
        meetingTitle: meeting.title
      });
      try {
        await deps.notifications.createOrUpdateNotification({
          userId: meeting.uploadedByUserId,
          type: "meeting.insight.pending",
          severity: "high",
          title: copy.title,
          body: copy.body,
          targetUrl: `/meetings?project_id=${project.id}&m=${meeting.id}&insight_id=${insightId}`,
          projectId: project.id,
          dedupeKey: `meeting_insight:${insightId}`
        }, input.at);
      } catch (error) {
        // 通知是尽力而为的旁路：洞察已经落库、页面已经能看见，推送失败不该把整次分析判失败。
        logger.warn?.("meeting_analysis_notification_failed", {
          meeting_id: meeting.id,
          insight_id: insightId,
          error
        });
      }
    }
  }

  return {
    isConfigured: () => deps.providerRegistry.isConfigured(),

    async analyzeMeeting(input) {
      const locale = normalizeWorkHubLocale(input.locale ?? "zh-CN");
      // 门控放在认领之前：没配 key 时绝不动会议状态——保持 transcribed，页面照实说「AI 未配置」。
      if (!deps.providerRegistry.isConfigured()) {
        return {
          outcome: "skipped_not_configured",
          meeting_id: input.meetingId,
          insight_count: 0,
          reason: "llm_provider_not_configured"
        };
      }
      if (!deps.repo.claimMeetingForAnalysis || !deps.repo.saveMeetingAnalysis) {
        return {
          outcome: "skipped_not_claimable",
          meeting_id: input.meetingId,
          insight_count: 0,
          reason: "repository_unsupported"
        };
      }

      const at = now();
      const candidate = await deps.repo.claimMeetingForAnalysis({
        meetingId: input.meetingId,
        at,
        staleBefore: new Date(at.getTime() - MEETING_ANALYSIS_STALE_CLAIM_MS),
        ...(input.force ? { force: true } : {})
      });
      if (!candidate) {
        // 已经在分析中 / 已分析过 / 会议不存在——三种都不该重复烧一次 LLM。
        return {
          outcome: "skipped_not_claimable",
          meeting_id: input.meetingId,
          insight_count: 0,
          reason: "not_claimable"
        };
      }

      const transcript = candidate.meeting.transcriptText?.trim() ?? "";
      if (!transcript) {
        await deps.repo.markMeetingAnalysisFailed?.({
          meetingId: candidate.meeting.id,
          reason: "transcript_empty",
          at
        });
        logger.warn?.("meeting_analysis_transcript_empty", { meeting_id: candidate.meeting.id });
        return {
          outcome: "failed",
          meeting_id: candidate.meeting.id,
          insight_count: 0,
          reason: "transcript_empty"
        };
      }

      if (!await budgetAllows(candidate, at)) {
        // 认领已经写进库了，这里必须放回去，否则要等 15 分钟租约到期才会被重扫。
        await deps.repo.releaseMeetingAnalysisClaim?.({ meetingId: candidate.meeting.id, at });
        logger.warn?.("meeting_analysis_skipped_budget", {
          meeting_id: candidate.meeting.id,
          workspace_id: candidate.project.workspaceId
        });
        return {
          outcome: "skipped_budget",
          meeting_id: candidate.meeting.id,
          insight_count: 0,
          reason: "budget_exhausted"
        };
      }

      try {
        const client = deps.providerRegistry.get({
          id: candidate.meeting.uploadedByUserId,
          userId: candidate.meeting.uploadedByUserId,
          ...(candidate.project.workspaceId ? { workspaceId: candidate.project.workspaceId } : {})
        }, "assistant") as unknown as MeetingAnalysisLlmClient;
        const response = await client.messages.create({
          maxTokens: MEETING_ANALYSIS_MAX_TOKENS,
          // E2E-03：thinking 模型的思维链计入 max_tokens，结构化输出调用关闭 thinking 防截断。
          disableThinking: true,
          source: "agent_step",
          timeoutMs: MEETING_ANALYSIS_TIMEOUT_MS,
          system: buildMeetingAnalysisSystemPrompt(locale),
          messages: [{
            role: "user",
            content: buildMeetingAnalysisUserPrompt({
              projectName: candidate.project.name,
              meetingTitle: candidate.meeting.title,
              transcript
            })
          }]
        });

        let parsed: MeetingAnalysisResponse;
        try {
          parsed = parseMeetingAnalysisResponse(textFromContent(response.content));
        } catch (error) {
          // 解析失败绝不落半截数据：不写 minutes_md、不插洞察、不置 ready。会议落到 failed，
          // 页面显示「处理失败」并给出「重新生成纪要」，人可以点着重跑；worker 不会自动重试，
          // 免得一个稳定畸形的模型输出把 token 烧穿（这是刻意的取舍，见 Agent Note）。
          await deps.repo.markMeetingAnalysisFailed?.({
            meetingId: candidate.meeting.id,
            reason: "invalid_response",
            at
          });
          logger.warn?.("meeting_analysis_invalid_response", {
            meeting_id: candidate.meeting.id,
            error
          });
          return {
            outcome: "failed",
            meeting_id: candidate.meeting.id,
            insight_count: 0,
            reason: "invalid_response"
          };
        }

        const insights: MeetingAnalysisInsightInput[] = parsed.insights.map((insight) => ({
          kind: insight.kind,
          title: insight.title,
          description: insight.description,
          confidenceReason: insight.confidence_reason
        }));
        const saved = await deps.repo.saveMeetingAnalysis({
          meetingId: candidate.meeting.id,
          minutesMd: parsed.minutes_md,
          insights,
          at,
          actorUserId: candidate.meeting.uploadedByUserId
        });
        if (!saved) {
          logger.warn?.("meeting_analysis_save_missed", { meeting_id: candidate.meeting.id });
          return {
            outcome: "failed",
            meeting_id: candidate.meeting.id,
            insight_count: 0,
            reason: "save_missed"
          };
        }
        await notifyUploader({
          candidate,
          insightIds: saved.insightIds,
          insights,
          locale,
          at
        });
        logger.info?.("meeting_analysis_completed", {
          meeting_id: candidate.meeting.id,
          project_id: candidate.project.id,
          insight_count: saved.insightIds.length
        });
        return {
          outcome: "analyzed",
          meeting_id: candidate.meeting.id,
          insight_count: saved.insightIds.length
        };
      } catch (error) {
        // 失败不吞错：置 failed + 结构化 error 日志。终态而非自动重试，人工「重新生成纪要」是出路。
        await deps.repo.markMeetingAnalysisFailed?.({
          meetingId: candidate.meeting.id,
          reason: "analysis_error",
          at
        });
        logger.error?.("meeting_analysis_failed", {
          meeting_id: candidate.meeting.id,
          project_id: candidate.project.id,
          error
        });
        return {
          outcome: "failed",
          meeting_id: candidate.meeting.id,
          insight_count: 0,
          reason: "analysis_error"
        };
      }
    }
  };
}

let defaultMeetingAnalysisService: MeetingAnalysisService | undefined;

export function getDefaultMeetingAnalysisService(): MeetingAnalysisService {
  if (!defaultMeetingAnalysisService) {
    const db = getSharedDatabaseClient().db;
    defaultMeetingAnalysisService = createMeetingAnalysisService({
      repo: createMeetingRepository(db),
      providerRegistry: getDefaultProviderRegistry(),
      notifications: createNotificationRepository(db),
      policyStore: getDefaultBudgetPolicyStore(),
      ledgerStore: getDefaultCostLedgerStore()
    });
  }
  return defaultMeetingAnalysisService;
}
