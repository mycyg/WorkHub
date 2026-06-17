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
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { MeetingPageVM, WorkItemDetailVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createMeetingRoutes } from "./routes/meetings.js";
import { createPageRoutes } from "./routes/pages.js";
import { createMeetingPageService, type MeetingPageService } from "./services/meeting-pages.js";

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
    isAdmin: false,
    deletedAt: null,
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
    actions: {}
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
