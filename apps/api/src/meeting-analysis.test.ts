import assert from "node:assert/strict";
import test from "node:test";

import type { LlmActor, LlmCreateParams, ProviderRegistry, TaskClass } from "@workhub/agent/providers";
import type { BudgetPolicy } from "@workhub/cost";
import type {
  CreateNotificationInput,
  MeetingAnalysisCandidateRow,
  MeetingProjectRow,
  MeetingRecordRow,
  MeetingRepository
} from "@workhub/db";

import {
  createMeetingAnalysisService,
  parseMeetingAnalysisResponse,
  buildMeetingAnalysisSystemPrompt,
  buildMeetingAnalysisUserPrompt,
  MEETING_ANALYSIS_STALE_CLAIM_MS
} from "./services/meeting-analysis.js";
import { createMeetingAnalysisScheduler } from "./workers/meeting-analysis.js";

// SA-02：会议分析链路的单测。全程假 provider，绝不打真 key（模式照 project-planner.test.ts 的
// RecordingRegistry）。核心要守住四条：写纪要+洞察+通知、幂等、未配置时诚实、解析失败不留坏数据。

const now = new Date("2026-09-05T02:00:00.000Z");
const projectId = "a1000000-0000-4000-8000-000000000001";
const meetingId = "a1000000-0000-4000-8000-000000000002";
const workspaceId = "a1000000-0000-4000-8000-000000000003";
const uploaderId = "a1000000-0000-4000-8000-000000000004";

function projectRow(): MeetingProjectRow {
  return {
    id: projectId,
    workspaceId,
    name: "R23 会议链路",
    slug: "r23-meetings",
    description: null,
    ownerNickname: "PM",
    ownerUserId: uploaderId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 1,
    isPersonal: false,
    isDmContainer: false,
    instructionsMd: null,
    createdAt: now,
    updatedAt: now
  } as MeetingProjectRow;
}

function meetingRow(partial: Partial<MeetingRecordRow> = {}): MeetingRecordRow {
  return {
    id: meetingId,
    projectId,
    workItemId: null,
    uploadedByUserId: uploaderId,
    title: "Q3 定价评审",
    audioFilename: "transcript-import.md",
    audioMime: "text/markdown",
    audioSizeBytes: 512,
    audioPath: `imported/${meetingId}.md`,
    transcriptText: "王工：定价页要加阶梯档。李工：这跟已经排期的结算改造冲突，得改需求。",
    minutesMd: null,
    status: "transcribed",
    jobId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  } as MeetingRecordRow;
}

/** 内存版仓库：状态机与真仓库同构（认领 = 条件转移，认领不到返回 null）。 */
class FakeMeetingAnalysisRepo {
  meeting: MeetingRecordRow;
  savedInsights: Array<{ kind: string; title: string; description: string; confidenceReason: string }> = [];
  saveCalls = 0;
  releaseCalls = 0;
  failCalls: Array<{ reason: string }> = [];

  constructor(partial: Partial<MeetingRecordRow> = {}) {
    this.meeting = meetingRow(partial);
  }

  claimMeetingForAnalysis: NonNullable<MeetingRepository["claimMeetingForAnalysis"]> = async (input) => {
    if (this.meeting.id !== input.meetingId) {
      return null;
    }
    const claimable = input.force
      || this.meeting.status === "transcribed"
      || (this.meeting.status === "processing" && this.meeting.updatedAt < input.staleBefore);
    if (!claimable) {
      return null;
    }
    this.meeting = { ...this.meeting, status: "processing", updatedAt: input.at };
    return { project: projectRow(), meeting: this.meeting } satisfies MeetingAnalysisCandidateRow;
  };

  releaseMeetingAnalysisClaim: NonNullable<MeetingRepository["releaseMeetingAnalysisClaim"]> = async (input) => {
    this.releaseCalls += 1;
    if (this.meeting.status === "processing") {
      this.meeting = { ...this.meeting, status: "transcribed", updatedAt: input.at };
    }
  };

  saveMeetingAnalysis: NonNullable<MeetingRepository["saveMeetingAnalysis"]> = async (input) => {
    this.saveCalls += 1;
    this.savedInsights = input.insights.map((insight) => ({ ...insight }));
    this.meeting = {
      ...this.meeting,
      minutesMd: input.minutesMd,
      status: "ready",
      updatedAt: input.at
    };
    return { insightIds: input.insights.map((_, index) => `a1000000-0000-4000-8000-00000000001${index}`) };
  };

  markMeetingAnalysisFailed: NonNullable<MeetingRepository["markMeetingAnalysisFailed"]> = async (input) => {
    this.failCalls.push({ reason: input.reason });
    this.meeting = { ...this.meeting, status: "failed", updatedAt: input.at };
  };
}

type RecordedCall = { actor: LlmActor | undefined; task: TaskClass; params: LlmCreateParams };

class RecordingRegistry {
  public readonly calls: RecordedCall[] = [];
  constructor(private readonly responses: string[], private readonly configured = true) {}
  isConfigured() {
    return this.configured;
  }
  get(actor: LlmActor | undefined, task: TaskClass) {
    return {
      messages: {
        create: async (params: LlmCreateParams) => {
          this.calls.push({ actor, task, params });
          const response = this.responses.shift();
          if (response === undefined) {
            throw new Error("unexpected LLM call");
          }
          return {
            id: `llm-${this.calls.length}`,
            content: [{ type: "text", text: response }],
            usage: { inputTokens: 40, outputTokens: 90 }
          };
        }
      }
    };
  }
}

function validAnalysis() {
  return JSON.stringify({
    minutes_md: "## 结论\n\n定价页加阶梯档。\n\n## 待办\n\n确认与结算改造的冲突。",
    insights: [
      {
        kind: "new_requirement",
        title: "定价页加阶梯档",
        description: "在定价页上增加按用量分档的价格表。",
        confidence_reason: "王工在会上直接提出「定价页要加阶梯档」，此前没有对应排期。"
      },
      {
        kind: "requirement_change",
        title: "结算改造需求要跟着改",
        description: "已排期的结算改造要覆盖阶梯计价。",
        confidence_reason: "李工指出这跟已经排期的结算改造冲突。"
      }
    ]
  });
}

function notificationRecorder() {
  const written: CreateNotificationInput[] = [];
  return {
    written,
    notifications: {
      createOrUpdateNotification: async (input: CreateNotificationInput) => {
        written.push(input);
        return { notification: { id: "n-1" }, created: true, resurfaced: false } as never;
      }
    }
  };
}

const exhaustedTeamDayPolicy: BudgetPolicy = {
  id: "team-day",
  scopeKind: "team",
  period: "day",
  maxTokens: 1,
  maxCostCny: "0.01",
  warningRatio: 0.7,
  criticalRatio: 0.9,
  onWarning: "notify",
  onExhausted: "block_new_run",
  enabled: true,
  version: 1
};

function makeService(repo: FakeMeetingAnalysisRepo, registry: RecordingRegistry, extra: {
  notifications?: ReturnType<typeof notificationRecorder>["notifications"];
  budgetAllowed?: boolean;
} = {}) {
  return createMeetingAnalysisService({
    repo,
    providerRegistry: registry as unknown as ProviderRegistry,
    ...(extra.notifications ? { notifications: extra.notifications as never } : {}),
    ...(extra.budgetAllowed === undefined ? {} : {
      // 与 conversation-observer.test.ts 的预算夹具同款：一条 maxTokens=1 的团队日策略 +
      // 一份已经越线的用量快照，decideRunBudget 即判 budget_exhausted。
      policyStore: { listPolicies: () => [exhaustedTeamDayPolicy] },
      ledgerStore: {
        usageSnapshots: async () => (extra.budgetAllowed
          ? []
          : [{
            scope: { kind: "team" as const, teamId: workspaceId },
            period: "day" as const,
            tokenIn: 10,
            tokenOut: 10,
            estimatedCostCny: "1"
          }])
      }
    }),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    now: () => now
  });
}

test("SA-02 分析成功：写纪要 + 洞察 + 待确认通知，会议置为已生成", async () => {
  const repo = new FakeMeetingAnalysisRepo();
  const registry = new RecordingRegistry([validAnalysis()]);
  const recorder = notificationRecorder();
  const service = makeService(repo, registry, { notifications: recorder.notifications });

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "analyzed");
  assert.equal(result.insight_count, 2);
  assert.equal(repo.meeting.status, "ready");
  assert.match(repo.meeting.minutesMd ?? "", /定价页加阶梯档/u);
  assert.equal(repo.savedInsights.length, 2);
  assert.deepEqual(repo.savedInsights.map((insight) => insight.kind), ["new_requirement", "requirement_change"]);
  // 每条洞察都必须带判断理由——仓库层没有理由就不让生成草稿，攒下无理由洞察等于攒死卡片。
  assert.equal(repo.savedInsights.every((insight) => insight.confidenceReason.length > 0), true);

  // 结构化输出调用必须关 thinking，否则思维链吃掉 max_tokens 把 JSON 截断。
  assert.equal(registry.calls.length, 1);
  assert.equal(registry.calls[0]?.params.disableThinking, true);
  assert.equal(registry.calls[0]?.actor?.workspaceId, workspaceId);
  assert.match(String(registry.calls[0]?.params.messages?.[0]?.content), /定价页要加阶梯档/u);

  // 通知走既有的 meeting.insight.pending 类型与 dedupe key，读路径补通知时不会重复出卡。
  assert.equal(recorder.written.length, 2);
  assert.equal(recorder.written[0]?.type, "meeting.insight.pending");
  assert.equal(recorder.written[0]?.userId, uploaderId);
  assert.equal(recorder.written[0]?.dedupeKey, "meeting_insight:a1000000-0000-4000-8000-000000000010");
  assert.match(String(recorder.written[0]?.targetUrl), /^\/meetings\?project_id=/u);
});

test("SA-02 幂等：同一场会议不会被分析两次", async () => {
  const repo = new FakeMeetingAnalysisRepo();
  const registry = new RecordingRegistry([validAnalysis()]);
  const service = makeService(repo, registry);

  assert.equal((await service.analyzeMeeting({ meetingId })).outcome, "analyzed");
  const second = await service.analyzeMeeting({ meetingId });

  assert.equal(second.outcome, "skipped_not_claimable");
  assert.equal(second.reason, "not_claimable");
  // 第二次连 LLM 都没打——重复分析既烧钱又会把同一件事变成两张卡。
  assert.equal(registry.calls.length, 1);
  assert.equal(repo.saveCalls, 1);
});

test("SA-02 幂等：正在分析中的会议不会被并发的第二次调用抢走", async () => {
  const repo = new FakeMeetingAnalysisRepo({ status: "processing", updatedAt: now });
  const registry = new RecordingRegistry([validAnalysis()]);
  const service = makeService(repo, registry);

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "skipped_not_claimable");
  assert.equal(registry.calls.length, 0);
  assert.equal(repo.meeting.status, "processing");
});

test("SA-02 卡死回收：认领超过视界没动静的会议可以被重新认领", async () => {
  const repo = new FakeMeetingAnalysisRepo({
    status: "processing",
    updatedAt: new Date(now.getTime() - MEETING_ANALYSIS_STALE_CLAIM_MS - 1000)
  });
  const registry = new RecordingRegistry([validAnalysis()]);
  const service = makeService(repo, registry);

  assert.equal((await service.analyzeMeeting({ meetingId })).outcome, "analyzed");
  assert.equal(repo.meeting.status, "ready");
});

test("SA-02 未配置 AI：状态一动不动，也不打 LLM——由页面诚实告知", async () => {
  const repo = new FakeMeetingAnalysisRepo();
  const registry = new RecordingRegistry([], false);
  const service = makeService(repo, registry);

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "skipped_not_configured");
  assert.equal(result.reason, "llm_provider_not_configured");
  assert.equal(registry.calls.length, 0);
  // 关键：不能被置成 processing 或 failed——那会让用户以为「在处理 / 处理坏了」，
  // 真相是这个部署压根没配 AI。
  assert.equal(repo.meeting.status, "transcribed");
  assert.equal(repo.meeting.minutesMd, null);
  assert.equal(repo.failCalls.length, 0);
  assert.equal(service.isConfigured(), false);
});

test("SA-02 解析失败：不写纪要、不写洞察、不置为已生成", async () => {
  const repo = new FakeMeetingAnalysisRepo();
  const registry = new RecordingRegistry(["这不是 JSON，只是一段闲聊。"]);
  const service = makeService(repo, registry);

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "invalid_response");
  assert.equal(repo.saveCalls, 0);
  assert.equal(repo.savedInsights.length, 0);
  assert.equal(repo.meeting.minutesMd, null);
  assert.notEqual(repo.meeting.status, "ready");
  assert.equal(repo.meeting.status, "failed");
  assert.deepEqual(repo.failCalls, [{ reason: "invalid_response" }]);
});

test("SA-02 解析失败：缺判断理由的洞察会让整份输出被拒，不落半截数据", async () => {
  const repo = new FakeMeetingAnalysisRepo();
  const registry = new RecordingRegistry([JSON.stringify({
    minutes_md: "## 结论\n\n有结论。",
    insights: [{ kind: "new_requirement", title: "缺理由", description: "没有 confidence_reason。" }]
  })]);
  const service = makeService(repo, registry);

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "failed");
  assert.equal(repo.saveCalls, 0);
  assert.equal(repo.meeting.minutesMd, null);
});

test("SA-02 转写为空：不打 LLM，直接判失败", async () => {
  const repo = new FakeMeetingAnalysisRepo({ transcriptText: "   " });
  const registry = new RecordingRegistry([validAnalysis()]);
  const service = makeService(repo, registry);

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "failed");
  assert.equal(result.reason, "transcript_empty");
  assert.equal(registry.calls.length, 0);
});

test("SA-02 预算闸：用量到顶时放回认领，不打 LLM，下一轮还能重来", async () => {
  const repo = new FakeMeetingAnalysisRepo();
  const registry = new RecordingRegistry([validAnalysis()]);
  const service = makeService(repo, registry, { budgetAllowed: false });

  const result = await service.analyzeMeeting({ meetingId });

  assert.equal(result.outcome, "skipped_budget");
  assert.equal(registry.calls.length, 0);
  assert.equal(repo.releaseCalls, 1);
  // 放回 transcribed 才能在下一轮巡检里被重新捡起；留在 processing 会白等一个视界。
  assert.equal(repo.meeting.status, "transcribed");
  assert.equal(repo.failCalls.length, 0);
});

test("SA-02 输出契约：容忍围栏包裹的 JSON，拒绝越界的 kind", () => {
  const parsed = parseMeetingAnalysisResponse("```json\n" + validAnalysis() + "\n```");
  assert.equal(parsed.insights.length, 2);
  assert.throws(() => parseMeetingAnalysisResponse(JSON.stringify({
    minutes_md: "x",
    insights: [{ kind: "brand_new_kind", title: "t", description: "d", confidence_reason: "r" }]
  })));
  // 没有洞察是合法结果：一场没产出行动项的会议也该有纪要。
  assert.deepEqual(parseMeetingAnalysisResponse(JSON.stringify({ minutes_md: "只是同步进展。" })).insights, []);
});

test("SA-02 提示词：说明去哪取事实、要求带理由、超长转写如实标注截断", () => {
  const system = buildMeetingAnalysisSystemPrompt("zh-CN");
  assert.match(system, /Never invent decisions/u);
  assert.match(system, /confidence_reason/u);
  assert.match(system, /new_requirement/u);

  const short = buildMeetingAnalysisUserPrompt({ projectName: "P", meetingTitle: "M", transcript: "短转写" });
  assert.match(short, /Transcript:/u);
  assert.equal(short.includes("truncated"), false);

  const long = buildMeetingAnalysisUserPrompt({
    projectName: "P",
    meetingTitle: "M",
    transcript: "x".repeat(30_000)
  });
  assert.match(long, /truncated/u);
});

// ── worker ─────────────────────────────────────────────────────────────────────────

test("SA-02 巡检：把待分析的会议逐场送去分析并汇总结果", async () => {
  const analyzed: string[] = [];
  const scheduler = createMeetingAnalysisScheduler({
    repo: {
      listMeetingsForAnalysis: async () => [
        { project: projectRow(), meeting: meetingRow({ id: meetingId }) },
        { project: projectRow(), meeting: meetingRow({ id: "a1000000-0000-4000-8000-000000000009" }) }
      ]
    },
    analysis: {
      analyzeMeeting: async ({ meetingId: id }) => {
        analyzed.push(id);
        return id === meetingId
          ? { outcome: "analyzed" as const, meeting_id: id, insight_count: 2 }
          : { outcome: "skipped_budget" as const, meeting_id: id, insight_count: 0 };
      }
    },
    logger: { warn: () => undefined, error: () => undefined },
    now: () => now,
    intervalMs: 0
  });

  const result = await scheduler.tick();

  assert.deepEqual(analyzed, [meetingId, "a1000000-0000-4000-8000-000000000009"]);
  assert.equal(result.scanned, 2);
  assert.equal(result.analyzed, 1);
  assert.equal(result.insights_created, 2);
  assert.equal(result.skipped_budget, 1);
  assert.equal(result.failed, 0);
  assert.equal(scheduler.stats().analyzed_count, 1);
});

test("SA-02 巡检：一场会议炸了不拖垮整轮", async () => {
  const scheduler = createMeetingAnalysisScheduler({
    repo: {
      listMeetingsForAnalysis: async () => [
        { project: projectRow(), meeting: meetingRow({ id: meetingId }) },
        { project: projectRow(), meeting: meetingRow({ id: "a1000000-0000-4000-8000-000000000009" }) }
      ]
    },
    analysis: {
      analyzeMeeting: async ({ meetingId: id }) => {
        if (id === meetingId) {
          throw new Error("boom");
        }
        return { outcome: "analyzed" as const, meeting_id: id, insight_count: 1 };
      }
    },
    logger: { warn: () => undefined, error: () => undefined },
    now: () => now,
    intervalMs: 0
  });

  const result = await scheduler.tick();

  assert.equal(result.failed, 1);
  assert.equal(result.analyzed, 1);
});
