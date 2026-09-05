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

test("login posts credentials to /api/auth/login in the body (never the URL) and returns identity", async () => {
  // P1-02（REL-5）：桌面密码/hybrid 模式先用凭据登录建会话，再走 bootstrapDesktop 换设备令牌。
  let seenUrl: string | undefined;
  let seenMethod: string | undefined;
  let seenBody: string | undefined;
  const client = createApiClient({
    baseUrl: "http://127.0.0.1:8787",
    fetchFn: async (input, init) => {
      seenUrl = typeof input === "string" ? input : String(input);
      seenMethod = init?.method;
      seenBody = typeof init?.body === "string" ? init.body : undefined;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "u1",
            nickname: "alice",
            display_name: "alice",
            created: false,
            locale: "zh-CN",
            preferences: { locale: "zh-CN" },
            is_admin: false,
            availability_status: "online"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  });

  const identity = await client.login({ email: "alice@example.com", password: "hunter2-strong-pass" });
  assert.equal(identity.id, "u1");
  assert.equal(identity.nickname, "alice");
  assert.equal(seenMethod, "POST");
  assert.equal(seenUrl, "http://127.0.0.1:8787/api/auth/login");
  assert.ok(!seenUrl?.includes("hunter2-strong-pass"), "password must never appear in the URL");
  assert.ok(!seenUrl?.includes("email="), "credentials must not be in the query string");
  assert.deepEqual(JSON.parse(seenBody ?? "{}"), {
    email: "alice@example.com",
    password: "hunter2-strong-pass"
  });
});

test("login surfaces a 401 from the backend as a WorkHubApiError (bad credentials, retryable)", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "auth_error", message: "邮箱或密码不正确" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
  });

  await assert.rejects(
    () => client.login({ email: "alice@example.com", password: "wrong" }),
    (error) => error instanceof WorkHubApiError && error.status === 401
  );
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

// UI-06：2xx 的非信封 body（SPA fallback HTML / 网关错误页）此前原样塞给调用方、渲染期才炸整页。
// 现在 fail-fast 抛带 path 的 contract_violation。
test("UI-06: api client rejects a 2xx non-JSON body as a contract violation naming the path", async () => {
  const client = createApiClient({
    fetchFn: async () =>
      new Response("<html><body>Not Found</body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      })
  });

  await assert.rejects(
    () => client.request("/api/pages/home"),
    (error) => {
      assert.equal(error instanceof WorkHubApiError, true);
      const apiError = error as WorkHubApiError;
      assert.equal(apiError.code, "contract_violation");
      assert.equal(apiError.message.includes("/api/pages/home"), true);
      return true;
    }
  );
});

test("UI-06: api client rejects malformed envelopes and non-envelope objects on 2xx", async () => {
  // ok:false 却缺 error 半边。
  const missingError = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: false }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  await assert.rejects(
    () => missingError.request("/api/pages/home?locale=zh-CN"),
    (error) => error instanceof WorkHubApiError && error.code === "contract_violation" && error.message.includes("/api/pages/home")
  );

  // 既非信封、也不在裸响应白名单里的普通对象。
  const noEnvelope = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ home: {} }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  await assert.rejects(
    () => noEnvelope.request("/api/pages/home"),
    (error) => error instanceof WorkHubApiError && error.code === "contract_violation"
  );

  // ok 非布尔——畸形信封。
  const weirdOk = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: "yes", data: {} }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  await assert.rejects(
    () => weirdOk.request("/api/pages/home"),
    (error) => error instanceof WorkHubApiError && error.code === "contract_violation"
  );
});

test("UI-06: bare {ok:true} acks and empty 200 bodies stay valid", async () => {
  // logout/revoke 一族的裸 ack（无 data 半边）是既有合法形状。
  const ack = createApiClient({
    fetchFn: async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  await assert.doesNotReject(() => ack.logout());

  // /api/auth/me 未识别时回 200 空 body——null 原样透传。
  const empty = createApiClient({
    fetchFn: async () => new Response("", { status: 200, headers: { "Content-Type": "application/json" } })
  });
  assert.equal(await empty.me(), null);
});

// UI-06 修正（web-live-route-smoke 红）：auth 与 client-devices 两族端点在 openapi.ts 里就是
// rawJsonResponse/rawJsonStatusResponse 声明的裸 JSON 契约，被 web/desktop/QA 按裸形状直接消费。
// 一刀切的信封校验会把注册后的 /api/auth/identify 误杀成 contract_violation，把用户永久钉在
// onboarding 页——这些路径必须放行。
test("UI-06 fix: raw-JSON contract endpoints (auth + client-devices) pass the envelope check untouched", async () => {
  const identity = {
    id: "u-1",
    nickname: "阿真",
    display_name: "阿真",
    created: true,
    locale: "zh-CN",
    preferences: { locale: "zh-CN" },
    is_admin: false,
    availability_status: "available"
  };
  const jsonOf = (body: unknown, status = 200) =>
    createApiClient({
      fetchFn: async () =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    });

  // 出问题的那一条：注册/识别回裸 identity（201 新建 / 200 已存在），必须原样透传。
  assert.deepEqual(await jsonOf(identity, 201).identify({ nickname: "阿真" }), identity);
  assert.deepEqual(await jsonOf({ ...identity, created: false }).login({ email: "a@b.c", password: "x" }), {
    ...identity,
    created: false
  });

  // /api/auth/me 已识别时是 identity + 内嵌 identity 块（同样裸形状）。
  const meBody = { ...identity, created: false, identity: { actor_kind: "human", actor_id: "u-1" } };
  assert.deepEqual(await jsonOf(meBody).me(), meBody);

  // 偏好更新、桌面引导、邀请一族。
  assert.deepEqual(await jsonOf(identity).updatePreferences({ locale: "zh-CN" }), identity);
  const bootstrap = { identity, device: { id: "d-1" }, client_token: "tok" };
  assert.deepEqual(await jsonOf(bootstrap, 201).bootstrapDesktop({ nickname: "阿真", device_name: "mac" }), bootstrap);
  const invite = { invite_id: "i-1", token: "t", email: "a@b.c", expires_at: "2026-09-06T00:00:00.000Z" };
  await assert.doesNotReject(() => jsonOf(invite, 201).request("/api/auth/invites", { method: "POST" }));
  await assert.doesNotReject(() => jsonOf({ invites: [] }).request("/api/auth/invites?status=pending"));
  await assert.doesNotReject(() => jsonOf(identity, 201).request("/api/auth/invites/accept", { method: "POST" }));

  // client-devices 五端点：register/me（裸数组！）/current/:id revoke/revoke-current。
  const device = { id: "d-1", user_id: "u-1", device_name: "mac", platform: "desktop" };
  assert.deepEqual(await jsonOf({ device, client_token: "tok" }, 201).registerClientDevice({ device_name: "mac" }), {
    device,
    client_token: "tok"
  });
  assert.deepEqual(await jsonOf([device]).listClientDevices(), [device]);
  assert.deepEqual(await jsonOf(device).currentClientDevice(), device);
  assert.deepEqual(await jsonOf(device).revokeClientDevice("d-1"), device);
  assert.deepEqual(await jsonOf(device).revokeCurrentClientDevice(), device);
});

test("UI-06 fix: the raw-JSON allowlist stays narrow and still catches malformed envelopes", async () => {
  const jsonOf = (body: unknown, status = 200) =>
    createApiClient({
      fetchFn: async () =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    });

  // 带信封端点的正常形状：{ok:true,data} 照常拆包出 data。
  assert.deepEqual(await jsonOf({ ok: true, data: { users: [{ id: "u-1" }] } }).listUsers(), {
    users: [{ id: "u-1" }]
  });

  // 同一个带信封端点的畸形信封仍必须被逮住——放行名单没把 auth 之外的路径带偏。
  for (const bad of [{ users: [] }, { ok: "yes", data: {} }, { ok: false }]) {
    await assert.rejects(
      () => jsonOf(bad).listUsers(),
      (error) =>
        error instanceof WorkHubApiError && error.code === "contract_violation" && error.message.includes("/api/users"),
      `bare ${JSON.stringify(bad)} on /api/users must stay a contract violation`
    );
  }

  // 名单按整条路径匹配，不是前缀——auth/client-devices 之下的非契约路径不被顺带放行。
  for (const path of [
    "/api/auth/identify/extra",
    "/api/client-devices/me/extra",
    "/api/client-devices",
    "/api/authx/identify"
  ]) {
    await assert.rejects(
      () => jsonOf({ some: "vm" }).request(path),
      (error) => error instanceof WorkHubApiError && error.code === "contract_violation",
      `${path} must not inherit the raw-JSON exemption`
    );
  }

  // 裸响应端点上的 HTML（SPA fallback / 网关错误页）仍然 fail-fast，不因放行而漏网。
  const html = createApiClient({
    fetchFn: async () =>
      new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } })
  });
  await assert.rejects(
    () => html.identify({ nickname: "阿真" }),
    (error) =>
      error instanceof WorkHubApiError &&
      error.code === "contract_violation" &&
      error.message.includes("/api/auth/identify")
  );
});

test("api client surfaces inner error.details consistently on non-2xx errors", async () => {  const client = createApiClient({
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
  await client.abortAgentRun("run-1");
  await client.resolveMemoryConflict("memory-conflict-1", {
    resolution: "merge_both",
    value_md: "合并后的偏好。",
    expected_updated_at: "2026-07-03T10:40:00.000Z"
  });
  await client.createProposalFromManifest("work-1", { manifest: deliverableManifestFixtures[0]! });
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
    "POST /api/agent-runs/run-1/abort",
    // R9.7 review: the old assertion put `expected_updated_at` in the JSON body,
    // but durable memory-conflict cards and OpenAPI document the stale-version token as a query parameter.
    'POST /api/memory-conflicts/memory-conflict-1/resolve/merge_both?expected_updated_at=2026-07-03T10%3A40%3A00.000Z {"value_md":"合并后的偏好。"}',
    "POST /api/workitems/work-1/proposals",
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

// R20 wave4（R19-1 OKR 前端接线）：objectives 创建 + 挂链两个既有服务端端点此前没有任何类型化
// 客户端方法能调用（前端完全不可达）。这里锁死 URL/方法/body 构造，逐字对齐
// apps/api/src/routes/objectives.ts 的 POST /api/objectives 与 POST /api/objectives/:id/link。
test("api client exposes the objective create + link endpoints (R19-1 OKR wiring)", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(JSON.stringify({ ok: true, data: { objective_id: "objective-1", title: "ok", status: "active", progress_percent: 0 } }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.createObjective({ title: "R20 稳定性目标", key_results: [{ title: "P0 缺陷清零" }] });
  await client.linkObjective("objective-1", { work_item_id: "work-1" });

  assert.deepEqual(calls, [
    {
      url: "/api/objectives",
      method: "POST",
      body: JSON.stringify({ title: "R20 稳定性目标", key_results: [{ title: "P0 缺陷清零" }] })
    },
    {
      url: "/api/objectives/objective-1/link",
      method: "POST",
      body: JSON.stringify({ work_item_id: "work-1" })
    }
  ]);
});

// R20 R19-27（工作项跨 run 审计时间线）：后端早有 GET /api/workitems/:id/audit（快照 + 审计事实 +
// manifest 校验，packages/db audit-repository 有测试覆盖），但此前客户端没有任何类型化方法能调用
// 它——web 端因此从没拉过这份数据、更别提渲染。锁定 URL/方法与信封解包（envelope → data）正确。
test("api client exposes the work item cross-run audit timeline endpoint (R19-27 wiring)", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const timeline = {
    work_item_id: "work-1",
    snapshots: [],
    audit_logs: [
      {
        id: "audit-1",
        actor: { actor_kind: "human", actor_nickname: "小拓" },
        entity: { entity_type: "work_item", entity_id: "work-1" },
        action: "work_item.created",
        detail_json: {},
        created_at: "2026-07-10T09:00:00.000Z"
      }
    ],
    manifest_facts: {
      checks: { snapshot_exists: "failed", revert_available: "warning" },
      rollback: { available: false, description: "无可回滚快照。" },
      risk: { reversible: true, irreversible_reasons: [] },
      evidence_refs: []
    }
  };
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return new Response(JSON.stringify({ ok: true, data: timeline }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.getWorkItemAuditTimeline("work-1");

  assert.deepEqual(calls, [{ url: "/api/workitems/work-1/audit", method: "GET" }]);
  assert.deepEqual(result, timeline);
});

// R14 批 MEM（记忆可见可治理）：用户记忆 + 团队技能两个治理面的客户端方法——URL/方法/body 构造要
// 与服务端路由（apps/api/src/routes/{user-memory-governance,team-skill-governance}.ts）逐字对齐。
// 这两组方法在 WorkHubApiClient 上是可选字段（同上面 pages.workbench? 的既有先例，不强迫
// apps/desktop-webview 的完整 mock 字面量跟着补桩），真实 createApiClient() 一定实现它们。
test("api client exposes the user memory governance endpoints (list/patch/delete)", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.listUserMemories!();
  await client.listUserMemories!({ category: "preference" });
  await client.patchUserMemory!("mem-1", { value_md: "喜欢简洁的回复", expected_updated_at: "2026-07-10T00:00:00.000Z" });
  await client.deleteUserMemory!("mem-1");

  assert.deepEqual(calls, [
    { url: "/api/me/memories", method: "GET", body: undefined },
    { url: "/api/me/memories?category=preference", method: "GET", body: undefined },
    {
      url: "/api/me/memories/mem-1",
      method: "PATCH",
      body: JSON.stringify({ value_md: "喜欢简洁的回复", expected_updated_at: "2026-07-10T00:00:00.000Z" })
    },
    { url: "/api/me/memories/mem-1", method: "DELETE", body: undefined }
  ]);
});

test("api client exposes the team skill governance endpoints (list/patch/deactivate)", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(JSON.stringify({ ok: true, data: { id: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.listTeamSkillsManage!();
  await client.patchTeamSkillManage!("skill-1", {
    ops: [{ op: "modify_section", section: "边界情况", content_md: "补充边界说明" }],
    base_version: 3,
    rationale_md: "管理员手动编辑"
  });
  await client.deactivateTeamSkillManage!("skill-1");
  await client.deactivateTeamSkillManage!("skill-1", { reason: "已过时" });

  assert.deepEqual(calls, [
    { url: "/api/team-skills/manage", method: "GET", body: undefined },
    {
      url: "/api/team-skills/manage/skill-1",
      method: "PATCH",
      body: JSON.stringify({
        ops: [{ op: "modify_section", section: "边界情况", content_md: "补充边界说明" }],
        base_version: 3,
        rationale_md: "管理员手动编辑"
      })
    },
    { url: "/api/team-skills/manage/skill-1/deactivate", method: "POST", body: JSON.stringify({}) },
    { url: "/api/team-skills/manage/skill-1/deactivate", method: "POST", body: JSON.stringify({ reason: "已过时" }) }
  ]);
});

test("R14 batch FEEDBACK: api client PUTs/DELETEs proposal feedback against the single shared endpoint", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      // 204 No Content — 服务端不回响应体（apps/api/src/routes/proposal-feedback.ts）。
      return new Response(null, { status: 204 });
    }
  });

  await client.putProposalFeedback!("proposal-1", { verdict: "useful" });
  await client.putProposalFeedback!("proposal-1", { verdict: "not_useful", note: "缺了回滚说明" });
  await client.deleteProposalFeedback!("proposal-1");

  assert.deepEqual(calls, [
    { url: "/api/proposals/proposal-1/feedback", method: "PUT", body: JSON.stringify({ verdict: "useful" }) },
    {
      url: "/api/proposals/proposal-1/feedback",
      method: "PUT",
      body: JSON.stringify({ verdict: "not_useful", note: "缺了回滚说明" })
    },
    { url: "/api/proposals/proposal-1/feedback", method: "DELETE", body: undefined }
  ]);
});

test("R20 DSK-UX (R19-3): api client POSTs the revert to /api/agent-runs/:id/revert with the snapshot in the body", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            status: "reverted",
            snapshot: {
              id: "snap-1",
              work_item_id: "wi-1",
              kind: "pre_step",
              ref: "runs/run-1/pre",
              created_by_kind: "ai",
              reverted_at: "2026-07-17T09:00:00.000Z",
              created_at: "2026-07-17T08:00:00.000Z"
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  });

  const result = await client.revertAgentRun!("run-1", { snapshot_id: "snap-1" });
  assert.equal(result.status, "reverted");
  assert.equal(result.snapshot.id, "snap-1");
  assert.deepEqual(calls, [
    { url: "/api/agent-runs/run-1/revert", method: "POST", body: JSON.stringify({ snapshot_id: "snap-1" }) }
  ]);
  // runId is URL-encoded, and the snapshot id never leaks into the URL.
  assert.ok(!calls[0]!.url.includes("snap-1"), "snapshot id must travel in the body, not the URL");
});

test("R20 DSK-UX (R19-5): api client DELETEs a permission policy against /api/permissions/:id", async () => {
  const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
  const client = createApiClient({
    fetchFn: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "policy-1",
            scope_kind: "user",
            scope_id: "u1",
            action_pattern: "drive.write:*",
            effect: "allow",
            priority: 0,
            learned_from_session: true,
            created_at: "2026-07-17T08:00:00.000Z",
            updated_at: "2026-07-17T08:00:00.000Z"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  });

  const policy = await client.revokePermissionPolicy!("policy-1");
  assert.equal(policy.id, "policy-1");
  assert.deepEqual(calls, [{ url: "/api/permissions/policy-1", method: "DELETE", body: undefined }]);
});
