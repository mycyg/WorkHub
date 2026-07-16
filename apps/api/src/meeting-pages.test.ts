import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  MeetingInsightDraftRows,
  MeetingPageRows,
  MeetingRepository,
  WorkItemAccessRow,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { DeliverableChangeManifest, MeetingPageVM, WorkItemDetailVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createMeetingRoutes } from "./routes/meetings.js";
import { createPageRoutes } from "./routes/pages.js";
import { createMeetingPageService, MeetingPageServiceError, type MeetingPageService } from "./services/meeting-pages.js";
import { WorkItemServiceError } from "./services/work-items.js";

const now = new Date("2026-06-11T02:00:00.000Z");
const projectId = "96000000-0000-4000-8000-000000000001";
const meetingId = "96000000-0000-4000-8000-000000000002";
const insightId = "96000000-0000-4000-8000-000000000003";
const workItemId = "96000000-0000-4000-8000-000000000004";
const userId = "96000000-0000-4000-8000-000000000005";
const proposalId = "96000000-0000-4000-8000-000000000006";

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "meeting-user",
    cookieToken: "cookie-meeting",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function actor() {
  return {
    kind: "human" as const,
    id: userId,
    label: "meeting-user",
    userId,
    isAdmin: false,
    orgId: "96000000-0000-4000-8000-000000000011",
    workspaceId: "96000000-0000-4000-8000-000000000012"
  };
}

function projectRow(): NonNullable<MeetingPageRows["project"]> {
  return {
    id: projectId,
    workspaceId: "96000000-0000-4000-8000-000000000012",
    name: "Meeting Workspace",
    slug: "meeting-workspace",
    description: null,
    ownerNickname: "meeting-user",
    ownerUserId: userId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 7,
    // R13 批 S3：projects 加了 is_personal 列——机械补齐，不是本文件测的功能改动。
    isPersonal: false,
    // R15 批 B：projects 加了 is_dm_container 列——机械补齐（普通项目固定 false）。
    isDmContainer: false,
    // R16 批 W4a：projects 加了 instructions_md 列——机械补齐（这份 fixture 不关心它，默认空）。
    instructionsMd: null,
    createdAt: now,
    updatedAt: now
  };
}

function meetingRow(): MeetingPageRows["meetings"][number]["meeting"] {
  return {
    id: meetingId,
    projectId,
    workItemId: null,
    uploadedByUserId: userId,
    title: "Q2 Client Proposal Review",
    audioFilename: "q2-review.txt",
    audioMime: "text/plain",
    audioSizeBytes: 2048,
    audioPath: "meetings/q2-review.txt",
    transcriptText: "Priya Shah: update the proposal pricing model with tiered usage.",
    minutesMd: "## Summary\n\nPricing and timeline changes need review.",
    status: "ready",
    jobId: null,
    createdAt: now,
    updatedAt: now
  };
}

function insightRow(partial: Partial<MeetingPageRows["insights"][number]> = {}): MeetingPageRows["insights"][number] {
  return {
    id: insightId,
    meetingId,
    kind: "requirement_change",
    title: "Update proposal pricing model",
    description: "Create a draft update to the pricing section with tiered usage.",
    targetWorkItemId: null,
    confidenceReason: "The meeting explicitly asks Finance to update the model before review.",
    status: "pending",
    createdWorkItemId: null,
    confirmedByUserId: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

function readableWorkItemAccessRow(id: string): WorkItemAccessRow {
  return {
    id,
    status: "spec_ready",
    submitterUserId: userId,
    claimedByUserId: null,
    workspaceId: actor().workspaceId,
    project: {
      archived: false,
      deletedAt: null,
      ownerUserId: userId,
      workspaceId: actor().workspaceId
    },
    assignments: []
  };
}

function rows(insight = insightRow()): MeetingPageRows {
  return {
    project: projectRow(),
    meetings: [{ meeting: meetingRow(), uploadedBy: user() }],
    insights: [insight],
    insightProposals: []
  };
}

class MutableMeetingRepo implements MeetingRepository {
  insight = insightRow();
  draftCalls: Array<{ projectId: string; insightId: string; actorUserId: string }> = [];
  dismissCalls: Array<{ projectId: string; insightId: string; actorUserId: string }> = [];
  proposalCalls: Array<{ workItemId: string; proposalId: string; actorUserId: string }> = [];

  async readPage() {
    return rows(this.insight);
  }

  async insightToDraft(input: Parameters<MeetingRepository["insightToDraft"]>[0]): Promise<MeetingInsightDraftRows | null> {
    this.draftCalls.push({
      projectId: input.projectId,
      insightId: input.insightId,
      actorUserId: input.actorUserId
    });
    this.insight = {
      ...this.insight,
      status: "confirmed",
      createdWorkItemId: workItemId,
      confirmedByUserId: input.actorUserId,
      confirmedAt: input.at ?? now,
      updatedAt: input.at ?? now
    };
    return {
      insight: this.insight,
      meeting: meetingRow(),
      workItem: null,
      created: true
    };
  }

  async dismissInsight(input: Parameters<MeetingRepository["dismissInsight"]>[0]): Promise<MeetingInsightDraftRows | null> {
    this.dismissCalls.push({
      projectId: input.projectId,
      insightId: input.insightId,
      actorUserId: input.actorUserId
    });
    this.insight = {
      ...this.insight,
      status: "dismissed",
      confirmedByUserId: input.actorUserId,
      confirmedAt: input.at ?? now,
      updatedAt: input.at ?? now
    };
    return {
      insight: this.insight,
      meeting: meetingRow(),
      workItem: null,
      created: true
    };
  }

  async recordDraftProposal(input: Parameters<MeetingRepository["recordDraftProposal"]>[0]): Promise<MeetingInsightDraftRows | null> {
    this.proposalCalls.push({
      workItemId: input.workItemId,
      proposalId: input.proposalId,
      actorUserId: input.actorUserId
    });
    return {
      insight: this.insight,
      meeting: meetingRow(),
      workItem: null,
      created: true
    };
  }
}

const deepLinkedMeetingId = "96000000-0000-4000-8000-0000000000aa";

function deepLinkedMeetingRow(): MeetingPageRows["meetings"][number]["meeting"] {
  return {
    ...meetingRow(),
    id: deepLinkedMeetingId,
    title: "Older Retrospective Deep Link",
    createdAt: new Date("2026-06-01T02:00:00.000Z"),
    updatedAt: new Date("2026-06-01T02:00:00.000Z")
  };
}

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<UserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: UserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements ClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<ClientDeviceAuthRow> {
    throw new Error("not needed");
  }

  async listByUser() {
    return [];
  }

  async touchLastSeen() {
    return null;
  }

  async revokeByIdForUser() {
    return null;
  }

  async revokeByTokenHash() {
    return null;
  }
}

function settings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "test-cookie-secret"
  });
}

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers([user()]),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-meeting", runtimeSettings.auth.cookieSecret);
}

function minimalMeetingPage(): Promise<MeetingPageVM> {
  return createMeetingPageService({
    repo: new MutableMeetingRepo(),
    now: () => now
  }).page({ actor: actor(), projectId });
}

function minimalWorkItemDetail(): WorkItemDetailVM {
  return {
    workitem: {
      id: workItemId,
      code: "R5-9",
      project_id: projectId,
      submitter_user_id: userId,
      title: "Update proposal pricing model",
      raw_description: "Create a draft update to the pricing section with tiered usage.",
      summary_md: "Create a draft update to the pricing section with tiered usage.",
      status: "ai_clarifying",
      priority: "normal",
      sync_state: "synced",
      version: 1,
      mode: "worker",
      human_reserved: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    },
    acceptance: [],
    agent_trace_preview: [],
    accepted_deliverables: [],
    evidence_refs: [],
    source_context: {
      source_type: "meeting_insight",
      project_id: projectId,
      meeting_id: meetingId,
      insight_id: insightId,
      meeting_title: "Q2 Client Proposal Review",
      insight_kind: "requirement_change",
      title: "Update proposal pricing model",
      description: "Create a draft update to the pricing section with tiered usage.",
      confidence_reason: "The meeting explicitly asks Finance to update the model before review.",
      status: "confirmed",
      evidence_refs: [],
      created_at: now.toISOString(),
      proposal_id: proposalId,
      proposal_href: `/proposals/${proposalId}`,
      proposal_status: "opened"
    },
    approval_decisions: [],
    actions: {}
  };
}

function proposalManifest(): DeliverableChangeManifest {
  return {
    version: 0,
    proposal_id: proposalId,
    work_item_id: workItemId,
    branch_id: "96000000-0000-4000-8000-000000000099",
    title: "Meeting draft proposal",
    summary_md: "Create a reviewable proposal from a meeting insight.",
    author: {
      actor_kind: "human",
      actor_user_id: userId,
      label: "meeting-user"
    },
    base: {
      created_at: now.toISOString()
    },
    changes: [
      {
        id: "96000000-0000-4000-8000-000000000098",
        target_kind: "text_doc",
        target_ref: {
          entity_type: "work_item",
          entity_id: workItemId,
          path: "/workitems/R5-9/meeting-insight.md"
        },
        change_type: "generated",
        human_summary: "Generate a proposal draft from the meeting insight."
      }
    ],
    checks: [
      {
        id: "meeting_insight_source",
        label: "Meeting insight source is attached",
        status: "passed"
      }
    ],
    evidence_refs: [
      {
        id: "96000000-0000-4000-8000-000000000097",
        source_type: "meeting",
        source_id: meetingId,
        title: "Q2 Client Proposal Review",
        confidence_hint: "found"
      }
    ],
    risk: {
      level: "low",
      human_label: "Preview-only proposal",
      reversible: true
    },
    rollback: {
      available: true,
      description: "Discard the proposal."
    },
    review: {
      suggested_decision: "needs_human",
      reason_required_on_reject: true
    }
  };
}

test("meeting page service creates a draft from a pending insight and returns a refreshed page", async () => {
  const repo = new MutableMeetingRepo();
  const service = createMeetingPageService({
    repo,
    now: () => now
  });

  const initial = await service.page({ actor: actor(), projectId, locale: "en-US" });
  assert.equal(initial.meetings[0]?.insights[0]?.actions.create_draft?.href, `/api/meetings/projects/${projectId}/insights/${insightId}/draft`);

  const refreshed = await service.insightToDraft({ actor: actor(), projectId, insightId });

  assert.deepEqual(repo.draftCalls, [{ projectId, insightId, actorUserId: userId }]);
  assert.equal(refreshed.meetings[0]?.insights[0]?.status, "confirmed");
  assert.equal(refreshed.meetings[0]?.insights[0]?.draft_href, `/workitems/${workItemId}`);
  assert.equal(refreshed.meetings[0]?.insights[0]?.actions.create_draft, undefined);
});

test("meeting page service hides draft and proposal links when the actor cannot open the backing work item", async () => {
  const pageRows = rows(insightRow({
    status: "confirmed",
    createdWorkItemId: workItemId,
    confirmedByUserId: userId,
    confirmedAt: now
  }));
  pageRows.insightProposals.push({
    id: proposalId,
    workItemId,
    branchId: "96000000-0000-4000-8000-000000000099",
    round: 1,
    title: "Meeting draft proposal",
    status: "opened",
    diffManifest: proposalManifest(),
    // R13 批 P1.5 ripple：proposals 加了 diffStatsJson 列（nullable），这份 fixture 满足的
    // ProposalRow 类型形状要求这个 key 存在——null=还没跑过右栏"变动文件"统计，无行为断言变化。
    diffStatsJson: null,
    confidenceId: null,
    mergeSnapshotId: null,
    openedByKind: "human",
    openedByUserId: userId,
    reviewedAt: null,
    mergedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return pageRows;
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "ai_clarifying",
          submitterUserId: "96000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "96000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createMeetingPageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), projectId, locale: "en-US" });
  const insight = page.meetings[0]?.insights[0];

  assert.equal(insight?.created_work_item_id, workItemId);
  assert.equal(insight?.draft_href, undefined);
  assert.equal(insight?.proposal_id, undefined);
  assert.equal(insight?.proposal_href, undefined);
  assert.equal(insight?.proposal_status, undefined);
});

test("meeting page service hides meeting work item ids when the actor cannot open the linked private work item", async () => {
  const pageRows = rows();
  pageRows.meetings = [{
    meeting: {
      ...meetingRow(),
      workItemId
    },
    uploadedBy: user()
  }];
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return pageRows;
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "spec_ready",
          submitterUserId: "96000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "96000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createMeetingPageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), projectId, locale: "en-US" });

  assert.equal(page.meetings[0]?.id, meetingId);
  assert.equal(page.meetings[0]?.work_item_id, undefined);
});

test("meeting page service hides target work item ids when the actor cannot open the linked private work item", async () => {
  const pageRows = rows(insightRow({ targetWorkItemId: workItemId }));
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return pageRows;
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "spec_ready",
          submitterUserId: "96000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "96000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createMeetingPageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), projectId, locale: "en-US" });
  const insight = page.meetings[0]?.insights[0];

  assert.equal(insight?.id, insightId);
  assert.equal(insight?.target_work_item_id, undefined);
});

test("meeting page service batches linked work item visibility checks", async () => {
  const meetingWorkItemId = "96000000-0000-4000-8000-000000000041";
  const targetWorkItemId = "96000000-0000-4000-8000-000000000042";
  const createdWorkItemId = "96000000-0000-4000-8000-000000000043";
  const pageRows = rows(insightRow({
    targetWorkItemId,
    createdWorkItemId,
    status: "confirmed",
    confirmedByUserId: userId,
    confirmedAt: now
  }));
  pageRows.meetings = [{
    meeting: {
      ...meetingRow(),
      workItemId: meetingWorkItemId
    },
    uploadedBy: user()
  }];

  let batchCalls = 0;
  let singleCalls = 0;
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return pageRows;
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        singleCalls += 1;
        throw new Error("meeting page read path must not fall back to per-id access queries");
      },
      async findWorkItemAccessRecords(ids: string[]) {
        batchCalls += 1;
        return new Map(ids.map((id) => [id, readableWorkItemAccessRow(id)]));
      }
    },
    now: () => now
  } as Parameters<typeof createMeetingPageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), projectId, locale: "en-US" });
  const insight = page.meetings[0]?.insights[0];

  assert.equal(batchCalls, 1);
  assert.equal(singleCalls, 0);
  assert.equal(page.meetings[0]?.work_item_id, meetingWorkItemId);
  assert.equal(insight?.target_work_item_id, targetWorkItemId);
  assert.equal(insight?.draft_href, `/workitems/${createdWorkItemId}`);
});

test("meeting page service dismisses a pending insight without creating a draft", async () => {
  const repo = new MutableMeetingRepo();
  const service = createMeetingPageService({
    repo,
    now: () => now
  });

  const refreshed = await service.dismissInsight({ actor: actor(), projectId, insightId });

  assert.deepEqual(repo.dismissCalls, [{ projectId, insightId, actorUserId: userId }]);
  assert.equal(refreshed.meetings[0]?.insights[0]?.status, "dismissed");
  assert.equal(refreshed.meetings[0]?.insights[0]?.draft_href, undefined);
  // findings[#low-F39]：被驳回的洞见即便底层列残留 confirmedByUserId/At，也绝不在 VM 暴露 confirmed_by/at(误导)。
  assert.equal(refreshed.meetings[0]?.insights[0]?.confirmed_by_user_id, undefined);
  assert.equal(refreshed.meetings[0]?.insights[0]?.confirmed_at, undefined);
  // findings[#low-F40]：can_manage 是项目级权限——owner 即便项目里有/无会议都为 true。
  assert.equal(refreshed.can_manage, true);
});

test("meeting page service asks the repository to include a requested deep-linked meeting", async () => {
  let readInput: (Parameters<MeetingRepository["readPage"]>[0] & { targetMeetingId?: string }) | undefined;
  const service = createMeetingPageService({
    repo: {
      async readPage(input) {
        readInput = input as typeof readInput;
        return readInput?.targetMeetingId === deepLinkedMeetingId
          ? {
              ...rows(),
              meetings: [{ meeting: deepLinkedMeetingRow(), uploadedBy: user() }],
              insights: []
            }
          : rows();
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), projectId, meetingId: deepLinkedMeetingId });

  assert.equal(readInput?.targetMeetingId, deepLinkedMeetingId);
  assert.equal(page.selected_meeting_id, deepLinkedMeetingId);
  assert.equal(page.meetings[0]?.title, "Older Retrospective Deep Link");
});

test("meeting page service does not silently select the first meeting when a requested meeting is absent", async () => {
  const service = createMeetingPageService({
    repo: new MutableMeetingRepo(),
    now: () => now
  });

  await assert.rejects(
    () => service.page({ actor: actor(), projectId, meetingId: deepLinkedMeetingId }),
    (error) => {
      assert.equal(error instanceof MeetingPageServiceError, true);
      assert.equal((error as MeetingPageServiceError).status, 404);
      assert.equal((error as MeetingPageServiceError).code, "meeting_not_found");
      return true;
    }
  );
});

test("meeting insight mutation can authorize an insight from an older deep-linked meeting", async () => {
  const olderInsight = insightRow({ meetingId: deepLinkedMeetingId });
  const draftCalls: Array<{ projectId: string; insightId: string; actorUserId: string }> = [];
  const service = createMeetingPageService({
    repo: {
      async readPage(input) {
        if (input?.targetMeetingId === deepLinkedMeetingId) {
          return {
            ...rows(),
            meetings: [{ meeting: deepLinkedMeetingRow(), uploadedBy: user() }],
            insights: [olderInsight]
          };
        }
        return {
          ...rows(),
          insights: []
        };
      },
      async findInsightContext() {
        return {
          project: projectRow(),
          meeting: deepLinkedMeetingRow(),
          insight: olderInsight
        };
      },
      async insightToDraft(input) {
        draftCalls.push({
          projectId: input.projectId,
          insightId: input.insightId,
          actorUserId: input.actorUserId
        });
        return {
          insight: {
            ...olderInsight,
            status: "confirmed",
            createdWorkItemId: workItemId,
            confirmedByUserId: input.actorUserId,
            confirmedAt: now,
            updatedAt: now
          },
          meeting: deepLinkedMeetingRow(),
          workItem: null,
          created: true
        };
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    } as MeetingRepository & {
      findInsightContext: () => Promise<{ project: ReturnType<typeof projectRow>; meeting: ReturnType<typeof deepLinkedMeetingRow>; insight: ReturnType<typeof insightRow> }>;
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), projectId, meetingId: deepLinkedMeetingId });
  assert.equal(page.meetings[0]?.insights[0]?.actions.create_draft?.href, `/api/meetings/projects/${projectId}/insights/${insightId}/draft`);

  await service.insightToDraft({ actor: actor(), projectId, insightId });

  assert.deepEqual(draftCalls, [{ projectId, insightId, actorUserId: userId }]);
});

test("meeting page service returns 404 when an explicit project id is absent", async () => {
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return { project: null, meetings: [], insights: [], insightProposals: [] };
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  await assert.rejects(
    () => service.page({ actor: actor(), projectId }),
    (error) => {
      assert.equal(error instanceof MeetingPageServiceError, true);
      assert.equal((error as MeetingPageServiceError).status, 404);
      assert.equal((error as MeetingPageServiceError).code, "meeting_not_found");
      return true;
    }
  );
});

test("meeting page route authenticates and passes project and selected meeting query", async () => {
  const runtimeSettings = settings();
  const calls: Array<{ projectId?: string; meetingId?: string; locale?: string; actorId?: string }> = [];
  const meetingPages: MeetingPageService = {
    async page(input) {
      calls.push({
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.meetingId ? { meetingId: input.meetingId } : {}),
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
      });
      return minimalMeetingPage();
    },
    async insightToDraft() {
      throw new Error("not needed");
    },
    async dismissInsight() {
      throw new Error("not needed");
    },
    async importTranscript() {
      throw new Error("importTranscript not stubbed in this test");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    meetingPages
  }));

  const response = await app.request(`/api/pages/meetings?locale=en-US&project_id=${projectId}&m=${meetingId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: MeetingPageVM };
  assert.equal(body.data.selected_meeting_id, meetingId);
  assert.deepEqual(calls, [{ projectId, meetingId, locale: "en-US", actorId: userId }]);
});

test("meeting page route rejects a malformed selected meeting id before loading the page", async () => {
  const runtimeSettings = settings();
  const calls: unknown[] = [];
  const meetingPages: MeetingPageService = {
    async page(input) {
      calls.push(input);
      return minimalMeetingPage();
    },
    async insightToDraft() {
      throw new Error("not needed");
    },
    async dismissInsight() {
      throw new Error("not needed");
    },
    async importTranscript() {
      throw new Error("importTranscript not stubbed in this test");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    meetingPages
  }));

  const response = await app.request(`/api/pages/meetings?project_id=${projectId}&m=not-a-meeting`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "meeting_not_found");
  assert.deepEqual(calls, []);
});

test("meeting mutation route authenticates and returns a refreshed meeting page", async () => {
  const runtimeSettings = settings();
  const calls: Array<{ projectId: string; insightId: string; actorId?: string }> = [];
  const meetingPages: MeetingPageService = {
    async page() {
      throw new Error("not needed");
    },
    async insightToDraft(input) {
      calls.push({
        projectId: input.projectId,
        insightId: input.insightId,
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
      });
      return minimalMeetingPage();
    },
    async dismissInsight() {
      throw new Error("not needed");
    },
    async importTranscript() {
      throw new Error("importTranscript not stubbed in this test");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/meetings", createMeetingRoutes({
    auth: authDeps(runtimeSettings),
    meetingPages
  }));

  const response = await app.request(`/api/meetings/projects/${projectId}/insights/${insightId}/draft?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: MeetingPageVM; meta: { locale: string } };
  assert.equal(body.ok, true);
  assert.equal(body.meta.locale, "en-US");
  assert.deepEqual(calls, [{ projectId, insightId, actorId: userId }]);
});

test("meeting mutation routes reject malformed insight ids before calling the service", async () => {
  const runtimeSettings = settings();
  const calls: string[] = [];
  const meetingPages: MeetingPageService = {
    async page() {
      throw new Error("not needed");
    },
    async insightToDraft(input) {
      calls.push(`draft:${input.insightId}`);
      return minimalMeetingPage();
    },
    async dismissInsight(input) {
      calls.push(`dismiss:${input.insightId}`);
      return minimalMeetingPage();
    },
    async importTranscript() {
      throw new Error("importTranscript not stubbed in this test");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/meetings", createMeetingRoutes({
    auth: authDeps(runtimeSettings),
    meetingPages
  }));

  for (const action of ["draft", "dismiss"] as const) {
    const response = await app.request(`/api/meetings/projects/${projectId}/insights/not-an-insight/${action}`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings) }
    });
    assert.equal(response.status, 404);
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "meeting_insight_not_found");
  }
  assert.deepEqual(calls, []);
});

test("meeting draft proposal route authenticates and returns a refreshed work item VM", async () => {
  const runtimeSettings = settings();
  const calls: Array<{ workItemId: string; locale?: string; actorId?: string }> = [];
  const meetingPages: MeetingPageService = {
    async page() {
      throw new Error("not needed");
    },
    async insightToDraft() {
      throw new Error("not needed");
    },
    async dismissInsight() {
      throw new Error("not needed");
    },
    async importTranscript() {
      throw new Error("importTranscript not stubbed in this test");
    },
    async draftToProposal(input) {
      calls.push({
        workItemId: input.workItemId,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
      });
      return minimalWorkItemDetail();
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/meetings", createMeetingRoutes({
    auth: authDeps(runtimeSettings),
    meetingPages
  }));

  const response = await app.request(`/api/meetings/workitems/${workItemId}/proposal-draft?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: WorkItemDetailVM };
  assert.equal(body.data.source_context?.source_type, "meeting_insight");
  assert.deepEqual(calls, [{ workItemId, locale: "en-US", actorId: userId }]);
});

test("meeting draftToProposal requires artifact mutation access before creating a proposal", async () => {
  let createFromManifestCalls = 0;
  let recordDraftProposalCalls = 0;
  const workItems = {
    async detailPage() {
      return minimalWorkItemDetail();
    },
    async assertCanMutateArtifacts() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项的正式交付物。");
    }
  };
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return rows(insightRow({
          status: "confirmed",
          createdWorkItemId: workItemId,
          confirmedByUserId: userId,
          confirmedAt: now
        }));
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        recordDraftProposalCalls += 1;
        throw new Error("must not record when artifact mutation is forbidden");
      }
    },
    proposals: {
      async createFromManifest(input) {
        createFromManifestCalls += 1;
        return {
          id: input.manifest.proposal_id ?? proposalId,
          work_item_id: input.workItemId,
          branch_id: input.manifest.branch_id ?? proposalId,
          round: 1,
          title: input.manifest.title,
          status: "opened",
          diff_manifest: input.manifest,
          opened_by_kind: "human",
          opened_by_user_id: userId,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          reviews: []
        };
      },
      async get() {
        return null;
      }
    },
    workItems,
    now: () => now
  });

  await assert.rejects(
    () => service.draftToProposal({ actor: actor(), workItemId }),
    (error) => error instanceof WorkItemServiceError
      && error.status === 403
      && error.code === "forbidden"
      && error.message === "你没有权限修改这个事项的正式交付物。"
  );
  assert.equal(createFromManifestCalls, 0);
  assert.equal(recordDraftProposalCalls, 0);
});

test("meeting draftToProposal lets assigned work item leads create the proposal without project meeting manage rights", async () => {
  const pageRows = rows(insightRow({
    status: "confirmed",
    createdWorkItemId: workItemId,
    confirmedByUserId: "96000000-0000-4000-8000-00000000feed",
    confirmedAt: now
  }));
  pageRows.project = {
    ...pageRows.project!,
    ownerUserId: "96000000-0000-4000-8000-00000000feed"
  };
  pageRows.meetings[0]!.meeting.uploadedByUserId = "96000000-0000-4000-8000-00000000feed";
  const records: Array<{ workItemId: string; proposalId: string; actorUserId: string }> = [];
  const manifests: DeliverableChangeManifest[] = [];
  const sourceDetail = minimalWorkItemDetail();
  // R13 批 P4: source_context is a 3-way union now; this fixture is always meeting_insight-shaped,
  // so narrow before destructuring fields that only exist on that variant.
  const sourceContext = sourceDetail.source_context as Extract<
    NonNullable<WorkItemDetailVM["source_context"]>,
    { source_type: "meeting_insight" }
  >;
  const {
    proposal_id: _proposalId,
    proposal_href: _proposalHref,
    proposal_status: _proposalStatus,
    ...sourceContextWithoutProposal
  } = sourceContext;
  const service = createMeetingPageService({
    repo: {
      async readPage() {
        return pageRows;
      },
      async insightToDraft() {
        throw new Error("not needed");
      },
      async dismissInsight() {
        throw new Error("not needed");
      },
      async recordDraftProposal(input) {
        records.push({
          workItemId: input.workItemId,
          proposalId: input.proposalId,
          actorUserId: input.actorUserId
        });
        return null;
      }
    },
    proposals: {
      async createFromManifest(input) {
        manifests.push(input.manifest);
        return {
          id: input.manifest.proposal_id ?? proposalId,
          work_item_id: input.workItemId,
          branch_id: input.manifest.branch_id ?? proposalId,
          round: 1,
          title: input.manifest.title,
          status: "opened",
          diff_manifest: input.manifest,
          opened_by_kind: "human",
          opened_by_user_id: userId,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
          reviews: []
        };
      },
      async get() {
        return null;
      }
    },
    workItems: {
      async detailPage() {
        return {
          ...sourceDetail,
          source_context: sourceContextWithoutProposal
        };
      },
      async assertCanMutateArtifacts() {
        return undefined;
      }
    },
    now: () => now
  });

  const result = await service.draftToProposal({ actor: actor(), locale: "zh-CN", workItemId });

  assert.equal(manifests.length, 1);
  assert.deepEqual(records, [{
    workItemId,
    proposalId: manifests[0]!.proposal_id!,
    actorUserId: userId
  }]);
  assert.equal(result.workitem.id, workItemId);
});
