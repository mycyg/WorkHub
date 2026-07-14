import assert from "node:assert/strict";
import test from "node:test";

import { conversationMessageCreatedEventSchema, deliverableManifestFixtures } from "@workhub/contracts";

import { createApiClient, joinApiUrl, parseRunEventSse, parseWorkHubEventSse, parseWorkHubSse, WorkHubApiError } from "./index.js";

test("joinApiUrl preserves relative mode and absolute daemon base URLs", () => {
  assert.equal(joinApiUrl(undefined, "/api/health"), "/api/health");
  assert.equal(joinApiUrl("http://127.0.0.1:8787/", "/api/health"), "http://127.0.0.1:8787/api/health");
});

test("api client unwraps WorkHub envelopes and injects the desktop token headers", async () => {
  const seenHeaders: Record<string, string | null> = {};
  const client = createApiClient({
    baseUrl: "http://127.0.0.1:8787",
    getClientToken: () => "device-token",
    fetchFn: async (_input, init) => {
      const headers = new Headers(init?.headers);
      seenHeaders.workhub = headers.get("X-WorkHub-Client-Token");
      seenHeaders.legacy = headers.get("X-YQGL-Client-Token");
      return new Response(JSON.stringify({ ok: true, data: { ok: true, service: "workhub-api", runtime: "node", port: 8787 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const health = await client.health();
  assert.equal(health.service, "workhub-api");
  assert.equal(seenHeaders.workhub, "device-token");
  assert.equal(seenHeaders.legacy, "device-token");
});

test("api client preserves raw ok health payloads that are not WorkHub envelopes", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: true, service: "workhub-api", runtime: "node", port: 8787 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  });

  const health = await client.health();
  assert.deepEqual(health, { ok: true, service: "workhub-api", runtime: "node", port: 8787 });
});

test("api client converts error envelopes to WorkHubApiError", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "budget_exhausted", message: "预算用完了。" } }), {
        status: 402,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    () => client.request("/api/agent-runs/demo"),
    (error) => error instanceof WorkHubApiError && error.code === "budget_exhausted"
  );
});

test("api client surfaces inner error.details consistently on non-2xx errors", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(
        JSON.stringify({ ok: false, error: { code: "merge_conflict", message: "冲突", details: { conflicts: [{ id: "c1" }] } } }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
  });

  await assert.rejects(
    () => client.request("/api/proposals/demo/merge"),
    (error) => {
      assert.equal(error instanceof WorkHubApiError, true);
      const apiError = error as WorkHubApiError;
      assert.equal(apiError.code, "merge_conflict");
      // error.details 应是内层 details（{conflicts}），不是整个信封。
      assert.deepEqual(apiError.details, { conflicts: [{ id: "c1" }] });
      return true;
    }
  );
});

test("api client times out a hung request into a 408 WorkHubApiError", async () => {
  const client = createApiClient({
    requestTimeoutMs: 20,
    // 永远挂起的 fetch，只在 signal abort 时以 AbortError 拒绝。
    fetchFn: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })
  });

  await assert.rejects(
    () => client.request("/api/pages/home"),
    (error) => error instanceof WorkHubApiError && error.status === 408 && error.code === "request_timeout"
  );
});

test("api client propagates a caller abort without mislabeling it as a timeout", async () => {
  const controller = new AbortController();
  const client = createApiClient({
    requestTimeoutMs: 10_000,
    fetchFn: (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })
  });
  const pending = client.request("/api/pages/home", { signal: controller.signal });
  controller.abort();

  // 调用方主动 abort：不应被映射成 408 超时，保持原始 AbortError。
  await assert.rejects(pending, (error) => (error as { name?: string }).name === "AbortError");
});

test("findings: a hung response-body read also times out into a 408", async () => {
  const client = createApiClient({
    requestTimeoutMs: 20,
    // fetch 立即返回，但 body 读取永久挂起，只在 signal abort 时以 AbortError 拒绝。
    fetchFn: (_input, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          new Promise<string>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("aborted");
              error.name = "AbortError";
              reject(error);
            });
          })
      } as unknown as Response)
  });

  await assert.rejects(
    () => client.request("/api/pages/home"),
    (error) => error instanceof WorkHubApiError && error.status === 408 && error.code === "request_timeout"
  );
});

test("findings: caller abort is honored even when AbortSignal.any is unavailable", async () => {
  const original = (globalThis.AbortSignal as unknown as { any?: unknown }).any;
  (globalThis.AbortSignal as unknown as { any?: unknown }).any = undefined;
  try {
    const controller = new AbortController();
    const client = createApiClient({
      requestTimeoutMs: 10_000,
      fetchFn: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        })
    });
    const pending = client.request("/api/pages/home", { signal: controller.signal });
    controller.abort();
    // 无 AbortSignal.any 时，调用方 abort 仍被转发，保持原始 AbortError（不误判 408）。
    await assert.rejects(pending, (error) => (error as { name?: string }).name === "AbortError");
  } finally {
    (globalThis.AbortSignal as unknown as { any?: unknown }).any = original;
  }
});

test("api client exposes P0.5 gold path page and replay endpoints", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      const body = (
        String(input).includes("/next-question") ||
        String(input).includes("/auth/preferences") ||
        String(input).includes("/task-plan") ||
        String(input).includes("/memory-conflicts/")
      ) && typeof init?.body === "string"
        ? ` ${init.body}`
        : "";
      calls.push(`${init?.method ?? "GET"} ${input}${body}`);
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.pages.goldPath();
  await client.pages.settings();
  await client.pages.drive();
  await client.pages.meetings({ projectId: "project-1", meetingId: "meeting-1" });
  await client.pages.notifications();
  await client.pages.calendar({ date: "2026-06-11", view: "week" });
  await client.me();
  await client.updatePreferences({ locale: "en-US" });
  await client.markNotificationRead("notification-1");
  await client.markAllNotificationsRead();
  await client.dismissNotification("notification-1");
  await client.completeNotification("notification-1");
  await client.bootstrapProject({ name: "Day 0 Pilot Project" });
  await client.pages.workItem("work-1");
  await client.pages.proposal("proposal-1");
  await client.createSession({ intent_text: "帮我整理客户周报模板。" });
  await client.getSession("session-1");
  await client.createWorkItem({ session_id: "session-1", selected_option_ids: ["risk-first"] });
  await client.startAgentRun("work-1", { title: "AI 开始整理周报" });
  await client.createTaskPlan("work-1", {}, { locale: "en-US" });
  await client.getAgentRun("run-1");
  await client.getAgentRunTrace("run-1", 2);
  await client.getAgentRunHandoff("run-1");
  await client.abortAgentRun("run-1");
  await client.resolveMemoryConflict("memory-conflict-1", {
    resolution: "merge_both",
    value_md: "合并后的偏好。",
    expected_updated_at: "2026-07-03T10:40:00.000Z"
  });
  await client.createProposalFromManifest("work-1", { manifest: deliverableManifestFixtures[0]! });
  await client.listWorkItemProposals("work-1");
  await client.listWorkItemConflicts("work-1");
  await client.getProposal("proposal-1");
  await client.nextQuestion("session-1", { selected_option_ids: ["risk-first"] });
  await client.searchKnowledge({ q: "weekly" });
  await client.useEvidenceForWorkItem("work-1", {
    evidence_refs: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        source_type: "meeting",
        source_id: "weekly-sync",
        title: "周会纪要"
      }
    ]
  });
  await client.restoreAcceptedDeliverable("work-1", "accepted-1");
  await client.uploadDriveFile("project-1", { filename: "r5.md", parsed_text: "hello" });
  await client.deleteDriveItem("project-1", "drive-item-1");
  await client.restoreDriveItem("project-1", "drive-item-1");
  await client.createDriveCommentDraft("project-1", "comment-1");
  await client.createDriveDraftProposal("work-1");
  await client.createMeetingInsightDraft("project-1", "insight-1");
  await client.dismissMeetingInsight("project-1", "insight-1");
  await client.createMeetingDraftProposal("work-1");
  await client.costUsage();
  await client.costPolicies();
  await client.updateCostPolicy("user", "pcost-user-day-v0", { max_tokens: 250000 });
  await client.pilotDay1Metrics({ from: "2026-06-13T00:00:00.000Z", to: "2026-06-14T00:00:00.000Z" });
  await client.reviewProposal("proposal-1", { decision: "approve", remember: "once" });
  await client.mergeProposal("proposal-1");
  await client.chooseMergeProposalCandidate("merge-proposal/1", { option_key: "ai_fusion" });
  await client.applyMergeProposalCandidate("merge-proposal/1");
  await client.replayAgentRun("run-1");

  assert.deepEqual(calls, [
    "GET /api/pages/gold-path",
    "GET /api/pages/settings",
    "GET /api/pages/drive",
    "GET /api/pages/meetings?project_id=project-1&m=meeting-1",
    "GET /api/pages/notifications",
    "GET /api/pages/calendar?date=2026-06-11&view=week",
    "GET /api/auth/me",
    'PATCH /api/auth/preferences {"locale":"en-US"}',
    "POST /api/notifications/notification-1/read",
    "POST /api/notifications/read-all",
    "POST /api/notifications/notification-1/dismiss",
    "POST /api/notifications/notification-1/complete",
    "POST /api/projects/bootstrap",
    "GET /api/pages/workitems/work-1",
    "GET /api/pages/proposals/proposal-1",
    "POST /api/sessions",
    "GET /api/sessions/session-1",
    "POST /api/workitems",
    "POST /api/workitems/work-1/agent-runs",
    'POST /api/workitems/work-1/task-plan?locale=en-US {}',
    "GET /api/agent-runs/run-1",
    "GET /api/agent-runs/run-1/trace?after=2",
    "GET /api/agent-runs/run-1/handoff",
    "POST /api/agent-runs/run-1/abort",
    // R9.7 review: the old assertion put `expected_updated_at` in the JSON body,
    // but durable memory-conflict cards and OpenAPI document the stale-version token as a query parameter.
    'POST /api/memory-conflicts/memory-conflict-1/resolve/merge_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z {"value_md":"合并后的偏好。"}',
    "POST /api/workitems/work-1/proposals",
    "GET /api/workitems/work-1/proposals",
    "GET /api/workitems/work-1/conflicts",
    "GET /api/proposals/proposal-1",
    'POST /api/sessions/session-1/next-question {"selected_option_ids":["risk-first"]}',
    "POST /api/knowledge/search",
    "POST /api/workitems/work-1/evidence-bindings",
    "POST /api/workitems/work-1/deliverables/accepted-1/restore",
    "POST /api/drive/projects/project-1/files",
    "POST /api/drive/projects/project-1/items/drive-item-1/delete",
    "POST /api/drive/projects/project-1/items/drive-item-1/restore",
    "POST /api/drive/projects/project-1/comments/comment-1/draft",
    "POST /api/drive/workitems/work-1/proposal-draft",
    "POST /api/meetings/projects/project-1/insights/insight-1/draft",
    "POST /api/meetings/projects/project-1/insights/insight-1/dismiss",
    "POST /api/meetings/workitems/work-1/proposal-draft",
    "GET /api/cost/usage",
    "GET /api/cost/policies",
    "PUT /api/cost/policies/user/pcost-user-day-v0",
    "GET /api/pilot/day1/metrics?from=2026-06-13T00%3A00%3A00.000Z&to=2026-06-14T00%3A00%3A00.000Z",
    "POST /api/proposals/proposal-1/review",
    "POST /api/proposals/proposal-1/merge",
    "POST /api/merge-proposals/merge-proposal%2F1/choose",
    "POST /api/merge-proposals/merge-proposal%2F1/apply",
    "GET /api/agent-runs/run-1/replay"
  ]);
});

test("api client carries locale on typed page VM requests", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.pages.goldPath({ locale: "en-US" });
  await client.pages.attention({ locale: "en-US" });
  await client.pages.approvals({ locale: "en-US" });
  await client.pages.cost({ locale: "en-US" });
  await client.pages.agents({ locale: "en-US" });
  await client.pages.settings({ locale: "en-US" });
  await client.pages.drive({ locale: "en-US", projectId: "project 1" });
  await client.pages.meetings({ locale: "en-US", project_id: "project 1", meeting_id: "meeting 1" });
  await client.pages.notifications({ locale: "zh-CN" });
  await client.pages.calendar({ locale: "en-US", date: "2026-06-11", view: "day" });
  await client.pages.workItem("work/1", { locale: "zh-CN" });
  await client.pages.proposal("proposal 1", { locale: "en-US" });
  await client.replayAgentRun("run/1", { locale: "en-US" });
  await client.getSession("session 1", { locale: "en-US" });
  await client.searchKnowledge({ q: "weekly" }, { locale: "zh-CN" });
  await client.uploadDriveFile("project 1", { filename: "r5.md" }, { locale: "en-US" });
  await client.deleteDriveItem("project 1", "item 1", {}, { locale: "zh-CN" });
  await client.restoreDriveItem("project 1", "item 1", { locale: "en-US" });
  await client.createDriveCommentDraft("project 1", "comment 1", { locale: "zh-CN" });
  await client.createDriveDraftProposal("work 1", { locale: "en-US" });
  await client.createMeetingInsightDraft("project 1", "insight 1", { locale: "zh-CN" });
  await client.dismissMeetingInsight("project 1", "insight 1", { locale: "en-US" });
  await client.createMeetingDraftProposal("work 1", { locale: "zh-CN" });
  await client.resolveEscalation("esc 1", { action: "retry" }, { locale: "en-US" });
  await client.resolveBudgetDecision("esc 1", "finish_current_output", { locale: "en-US" });
  await client.delegateEscalation("esc 1", { to_user_id: "user 1" }, { locale: "en-US" });
  await client.reviewProposal("proposal 1", { decision: "approve" }, { locale: "en-US" });
  await client.mergeProposal("proposal 1", {}, { locale: "zh-CN" });
  await client.applyMergeProposalCandidate("merge proposal/1", {}, { locale: "en-US" });

  assert.deepEqual(calls, [
    "/api/pages/gold-path?locale=en-US",
    "/api/pages/attention?locale=en-US",
    "/api/pages/approvals?locale=en-US",
    "/api/pages/cost?locale=en-US",
    // R9.6 adds the Agent Army dashboard Page VM; the old locale-call list was pre-dashboard.
    "/api/pages/agents?locale=en-US",
    "/api/pages/settings?locale=en-US",
    "/api/pages/drive?locale=en-US&project_id=project+1",
    "/api/pages/meetings?locale=en-US&project_id=project+1&m=meeting+1",
    "/api/pages/notifications?locale=zh-CN",
    "/api/pages/calendar?locale=en-US&date=2026-06-11&view=day",
    "/api/pages/workitems/work%2F1?locale=zh-CN",
    "/api/pages/proposals/proposal%201?locale=en-US",
    "/api/agent-runs/run%2F1/replay?locale=en-US",
    "/api/sessions/session%201?locale=en-US",
    "/api/knowledge/search?locale=zh-CN",
    "/api/drive/projects/project%201/files?locale=en-US",
    "/api/drive/projects/project%201/items/item%201/delete?locale=zh-CN",
    "/api/drive/projects/project%201/items/item%201/restore?locale=en-US",
    "/api/drive/projects/project%201/comments/comment%201/draft?locale=zh-CN",
    "/api/drive/workitems/work%201/proposal-draft?locale=en-US",
    "/api/meetings/projects/project%201/insights/insight%201/draft?locale=zh-CN",
    "/api/meetings/projects/project%201/insights/insight%201/dismiss?locale=en-US",
    "/api/meetings/workitems/work%201/proposal-draft?locale=zh-CN",
    "/api/escalations/esc%201/resolve?locale=en-US",
    "/api/escalations/esc%201/budget-actions/finish_current_output?locale=en-US",
    "/api/escalations/esc%201/delegate?locale=en-US",
    "/api/proposals/proposal%201/review?locale=en-US",
    "/api/proposals/proposal%201/merge?locale=zh-CN",
    "/api/merge-proposals/merge%20proposal%2F1/apply?locale=en-US"
  ]);
});

test("api client carries locale on session next-question requests", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.nextQuestion("session 1", { selected_option_ids: ["risk-first"] }, { locale: "zh-CN" });

  assert.deepEqual(calls, [
    'POST /api/sessions/session%201/next-question?locale=zh-CN {"selected_option_ids":["risk-first"]}'
  ]);
});

test("api client carries locale on session creation and launch requests", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${input}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.createSession({ intent_text: "整理 R9 记录" }, { locale: "zh-CN" });
  await client.createWorkItem({ session_id: "session 1" }, { locale: "zh-CN" });
  await client.startAgentRun("work 1", { title: "整理 R9 记录" }, { locale: "zh-CN" });

  assert.deepEqual(calls, [
    'POST /api/sessions?locale=zh-CN {"intent_text":"整理 R9 记录"}',
    'POST /api/workitems?locale=zh-CN {"session_id":"session 1"}',
    'POST /api/workitems/work%201/agent-runs?locale=zh-CN {"title":"整理 R9 记录"}'
  ]);
});

test("R14 batch SEARCH: api client builds the global search query string (q required, scopes csv, limit optional)", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { query: "", groups: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.search?.({ q: "预算" });
  await client.search?.({ q: "50%", scopes: ["drive", "work_items"], limit: 5 });

  assert.deepEqual(calls, [
    "/api/search?q=%E9%A2%84%E7%AE%97",
    "/api/search?q=50%25&scopes=drive%2Cwork_items&limit=5"
  ]);
});

test("api client carries approval paging options on the typed approvals page request", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.pages.approvals({ locale: "zh-CN", offset: 100, limit: 50 });

  assert.deepEqual(calls, [
    "/api/pages/approvals?locale=zh-CN&offset=100&limit=50"
  ]);
});

test("api client sends drive file uploads as multipart form data", async () => {
  let seenBody: RequestInit["body"] | null | undefined;
  let seenContentType: string | null = null;
  const client = createApiClient({
    fetchFn: async (_input, init) => {
      seenBody = init?.body;
      seenContentType = new Headers(init?.headers).get("Content-Type");
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.uploadDriveFile("project-1", {
    file: new Blob(["hello drive"], { type: "text/plain" }),
    filename: "hello.txt",
    parent_id: "folder-1"
  });

  assert.equal(seenBody instanceof FormData, true);
  assert.equal(seenContentType, null);
  const file = (seenBody as FormData).get("file");
  assert.equal(file instanceof Blob, true);
  assert.equal(await (file as Blob).text(), "hello drive");
  assert.equal((seenBody as FormData).get("parent_id"), "folder-1");
});

test("api client exposes typed push stream URLs for web and desktop clients", () => {
  const relative = createApiClient();
  const daemon = createApiClient({ baseUrl: "http://127.0.0.1:8787/" });

  assert.equal(relative.streams.all(), "/api/push/stream");
  assert.equal(relative.streams.me(), "/api/push/stream/me");
  assert.equal(relative.streams.workItem("work/1"), "/api/push/stream/workitem/work%2F1");
  assert.equal(relative.streams.run("run/1"), "/api/push/stream/run/run%2F1");
  assert.equal(relative.streams.session("session 1"), "/api/push/stream/session/session%201");
  assert.equal(relative.streams.proposal("proposal:1"), "/api/push/stream/proposal/proposal%3A1");
  assert.equal(
    relative.streams.conversation("conversation/一"),
    "/api/push/stream/conversation/conversation%2F%E4%B8%80"
  );
  assert.equal(daemon.streams.run("run-1"), "http://127.0.0.1:8787/api/push/stream/run/run-1");
  assert.equal(
    daemon.streams.conversation("conversation-1"),
    "http://127.0.0.1:8787/api/push/stream/conversation/conversation-1"
  );
});

test("SSE parser keeps event names and parses JSON payloads", () => {
  const events = parseWorkHubSse<{ topic: string }>('event: connected\ndata: {"topic":"user:1"}\n\n: ping\n\n');
  assert.equal(events.length, 1);
  assert.equal(events[0]?.event, "connected");
  assert.equal(events[0]?.json?.topic, "user:1");
});

test("SSE parser extracts WorkHubEvent envelopes and run-specific event streams", () => {
  const input = [
    'event: agent_run.step\ndata: {"event_id":"event-1","type":"agent_run.step","topic":"run:run-1","ts":"2026-06-05T01:00:00.000Z","run_id":"run-1","data":{"kind":"step","summary":"读取文档"}}',
    'event: budget.warning\ndata: {"event_id":"event-2","type":"budget.warning","topic":"workitem:work-1","ts":"2026-06-05T01:00:01.000Z","data":{"message":"预算提醒"}}',
    'id: 41000000-0000-4000-8000-000000000003\nevent: conversation.message.created\ndata: {"event_id":"41000000-0000-4000-8000-000000000003","type":"conversation.message.created","topic":"conversation:30000000-0000-4000-8000-000000000003","ts":"2026-07-12T01:00:02.000Z","actor":{"actor_kind":"human","actor_user_id":"60000000-0000-4000-8000-000000000006","label":"R12 owner"},"project_id":"20000000-0000-4000-8000-000000000002","preview_text":"hello","data":{"id":"40000000-0000-4000-8000-000000000004","conversation_id":"30000000-0000-4000-8000-000000000003","seq":9,"sender_type":"user","sender_user_id":"60000000-0000-4000-8000-000000000006","kind":"text","content":{"text":"hello"},"thread_root_id":null,"created_at":"2026-07-12T01:00:02.000Z"}}',
    "event: message\ndata: not-json"
  ].join("\n\n");

  const events = parseWorkHubEventSse(input);
  const runEvents = parseRunEventSse("run-1", input);

  assert.equal(events.length, 3);
  assert.equal(events[0]?.type, "agent_run.step");
  assert.equal(events[2]?.type, "conversation.message.created");
  const created = conversationMessageCreatedEventSchema.parse(events[2]);
  assert.equal(created.data.seq, 9);
  assert.equal(runEvents.length, 1);
  assert.equal(runEvents[0]?.topic, "run:run-1");
});

// R12 批 1：desktop 工作台外壳消费 GET /api/pages/workbench/:projectId 拿 bootstrap VM。
test("api client exposes the workbench bootstrap page VM endpoint", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    fetchFn: async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  // workbench 是 PageClient 上的可选方法（其它 workspace 的完整 PageClient 字面量 mock 不必跟着补桩），
  // 但真实 createApiClient() 一定实现它——非空断言反映这个契约，不是绕过类型检查。
  await client.pages.workbench!("project-1");
  await client.pages.workbench!("project 1", { locale: "en-US" });

  assert.deepEqual(calls, [
    "/api/pages/workbench/project-1",
    "/api/pages/workbench/project%201?locale=en-US"
  ]);
});
