import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import {
  createDatabaseClient,
  createUserRepository,
  createWorkbenchRepository,
  runMigrations,
  type UserAuthRow
} from "@workhub/db";

import { httpErrorCodeFor } from "./http-error-codes.js";
import {
  COOKIE_NAME,
  type AuthActor,
  type AuthDependencies,
  type AuthEnv
} from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";
import { createPageRoutes } from "./routes/pages.js";
import { ConversationServiceError, type ConversationService } from "./services/conversations.js";

const now = new Date("2026-07-12T09:00:00.000Z");
const workspaceId = "82aa0000-0000-4000-8000-000000000001";
const projectId = "82bb0000-0000-4000-8000-000000000002";
const userId = "82cc0000-0000-4000-8000-000000000003";
const ownerUserId = "82dd0000-0000-4000-8000-000000000004";
const conversationId = "82ee0000-0000-4000-8000-000000000005";
const fileId = "82ff0000-0000-4000-8000-000000000006";

type AccessRow = {
  project: {
    id: string;
    workspaceId: string;
    name: string;
    slug: string;
    description: string | null;
    ownerNickname: string;
    ownerUserId: string | null;
  };
  membershipRole: "member" | "admin" | "owner" | string;
};

type WorkbenchRepo = {
  findWorkbenchAccess(input: unknown): Promise<AccessRow | null>;
  listWorkspaceMembers(input: unknown): Promise<unknown>;
  countVisibleActivePlans(input: unknown): Promise<number>;
  listRecentVisibleFiles(input: unknown): Promise<unknown[]>;
};

type WorkbenchService = {
  page(input: { actor: AuthActor; projectId: string; locale?: "zh-CN" | "en-US" }): Promise<Record<string, unknown>>;
};

type WorkbenchModule = {
  WorkbenchPageServiceError: new (
    status: 404,
    code: "workbench_not_found",
    message: string
  ) => Error & { status: number; code: string };
  createWorkbenchPageService(deps: {
    repo: WorkbenchRepo;
    conversations: Pick<ConversationService, "listConversations">;
    now?: () => Date;
  }): WorkbenchService;
};

async function loadWorkbenchModule(): Promise<WorkbenchModule> {
  const module = await import("./services/workbench-pages.js") as unknown as Partial<WorkbenchModule>;
  assert.equal(typeof module.createWorkbenchPageService, "function", "missing createWorkbenchPageService export");
  assert.equal(typeof module.WorkbenchPageServiceError, "function", "missing WorkbenchPageServiceError export");
  return module as WorkbenchModule;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function actor(partial: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: userId,
    userId,
    label: "张三",
    isAdmin: false,
    orgId: "82ab0000-0000-4000-8000-000000000007",
    workspaceId,
    roleIds: ["member"],
    ...partial
  };
}

function access(partial: Partial<AccessRow> = {}): AccessRow {
  return {
    project: {
      id: projectId,
      workspaceId,
      name: "星尘短剧",
      slug: "stardust",
      description: null,
      ownerNickname: "阿曼",
      ownerUserId,
      ...(partial.project ?? {})
    },
    membershipRole: partial.membershipRole ?? "member"
  };
}

function conversationPage() {
  return {
    conversations: [{
      id: conversationId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "main" as const,
      title: "主区",
      parent_conversation_id: null,
      source_message_id: null,
      visibility: "project" as const,
      next_seq: 0,
      created_by: ownerUserId,
      participant_role: null,
      cuu_enabled: true,
      created_at: "2026-07-12T08:30:00.000Z",
      updated_at: "2026-07-12T08:30:00.000Z"
    }],
    capped: false,
    next_cursor: null
  };
}

function members() {
  return {
    total: 2,
    returned: 2,
    capped: false,
    items: [
      {
        userId,
        nickname: "张三",
        membershipRole: "member",
        isProjectOwner: false,
        isSelf: true
      },
      {
        userId: ownerUserId,
        nickname: "阿曼",
        membershipRole: "owner",
        isProjectOwner: true,
        isSelf: false
      }
    ]
  };
}

function repo(overrides: Partial<WorkbenchRepo> = {}): WorkbenchRepo {
  return {
    async findWorkbenchAccess() {
      return access();
    },
    async listWorkspaceMembers() {
      return members();
    },
    async countVisibleActivePlans() {
      return 0;
    },
    async listRecentVisibleFiles() {
      return [];
    },
    ...overrides
  };
}

function conversations(overrides: Partial<Pick<ConversationService, "listConversations">> = {}) {
  return {
    async listConversations() {
      return conversationPage();
    },
    ...overrides
  } as Pick<ConversationService, "listConversations">;
}

test("R12 workbench service fully awaits access, starts all bounded sources, awaits all, then rechecks", async () => {
  const module = await loadWorkbenchModule();
  const calls: Array<{ source: string; input: unknown }> = [];
  const accessRow = access();
  const firstAccess = deferred<AccessRow | null>();
  const conversationRead = deferred<ReturnType<typeof conversationPage>>();
  const memberRead = deferred<ReturnType<typeof members>>();
  const planRead = deferred<number>();
  const fileRead = deferred<Array<{ id: string; name: string; updatedAt: Date }>>();
  let accessReads = 0;
  const service = module.createWorkbenchPageService({
    repo: repo({
      async findWorkbenchAccess(input) {
        accessReads += 1;
        calls.push({ source: accessReads === 1 ? "access:first" : "access:recheck", input });
        return accessReads === 1 ? firstAccess.promise : accessRow;
      },
      async listWorkspaceMembers(input) {
        calls.push({ source: "members", input });
        return memberRead.promise;
      },
      async countVisibleActivePlans(input) {
        calls.push({ source: "plans", input });
        return planRead.promise;
      },
      async listRecentVisibleFiles(input) {
        calls.push({ source: "files", input });
        return fileRead.promise;
      }
    }),
    conversations: conversations({
      async listConversations(input) {
        calls.push({ source: "conversations", input });
        return conversationRead.promise;
      }
    }),
    now: () => now
  });

  const pendingPage = service.page({ actor: actor(), projectId, locale: "en-US" });
  await flushAsyncWork();
  assert.deepEqual(calls.map((call) => call.source), ["access:first"], "child reads started before access resolved");

  firstAccess.resolve(accessRow);
  await flushAsyncWork();
  assert.deepEqual(new Set(calls.slice(1).map((call) => call.source)), new Set([
    "conversations",
    "members",
    "plans",
    "files"
  ]));
  assert.equal(calls.some((call) => call.source === "access:recheck"), false);

  conversationRead.resolve(conversationPage());
  memberRead.resolve(members());
  planRead.resolve(1);
  await flushAsyncWork();
  assert.equal(calls.some((call) => call.source === "access:recheck"), false, "recheck started before every source settled");

  fileRead.resolve([{ id: fileId, name: "brief.docx", updatedAt: now }]);
  const page = await pendingPage as {
    generated_at: string;
    project: { id: string; workspace_id: string };
    viewer: { user_id: string; membership_role: string; is_project_owner: boolean };
    army_summary: { active_plan_count: number; empty_state?: string };
    recent_project_files: { items: Array<{ id: string; href: string }>; empty_state?: string };
  };

  assert.equal(calls.at(-1)?.source, "access:recheck");
  assert.equal(accessReads, 2);
  assert.deepEqual(calls[0]?.input, { workspaceId, viewerUserId: userId, projectId });
  assert.deepEqual(calls.find((call) => call.source === "conversations")?.input, {
    actor: actor(),
    projectId,
    query: { limit: 50 }
  });
  assert.deepEqual(calls.find((call) => call.source === "members")?.input, {
    workspaceId,
    viewerUserId: userId,
    projectOwnerUserId: ownerUserId,
    limit: 100
  });
  assert.deepEqual(calls.find((call) => call.source === "plans")?.input, {
    workspaceId,
    projectId,
    viewerUserId: userId,
    isAdmin: false
  });
  assert.deepEqual(calls.find((call) => call.source === "files")?.input, {
    workspaceId,
    projectId,
    viewerUserId: userId,
    isAdmin: false,
    limit: 5
  });
  assert.equal(page.generated_at, now.toISOString());
  assert.deepEqual(page.project, { id: projectId, workspace_id: workspaceId, name: "星尘短剧", slug: "stardust", description: null, owner_label: "阿曼" });
  assert.deepEqual(page.viewer, { user_id: userId, membership_role: "member", is_project_owner: false });
  assert.deepEqual(page.army_summary, { active_plan_count: 1 });
  assert.deepEqual(page.recent_project_files.items, [{
    id: fileId,
    name: "brief.docx",
    updated_at: now.toISOString(),
    href: `/drive?project_id=${projectId}&item_id=${fileId}`
  }]);
});

test("R12 workbench service fails closed before child reads and for direct non-human actors", async () => {
  const module = await loadWorkbenchModule();
  let childReads = 0;
  const inaccessible = module.createWorkbenchPageService({
    repo: repo({
      async findWorkbenchAccess() {
        return null;
      },
      async listWorkspaceMembers() {
        childReads += 1;
        return members();
      }
    }),
    conversations: conversations({
      async listConversations() {
        childReads += 1;
        return conversationPage();
      }
    })
  });

  await assert.rejects(
    inaccessible.page({ actor: actor(), projectId }),
    (error: unknown) => error instanceof module.WorkbenchPageServiceError
      && error.status === 404
      && error.code === "workbench_not_found"
  );
  assert.equal(childReads, 0);

  let accessReads = 0;
  const nonHuman = module.createWorkbenchPageService({
    repo: repo({
      async findWorkbenchAccess() {
        accessReads += 1;
        return access();
      }
    }),
    conversations: conversations()
  });
  await assert.rejects(
    nonHuman.page({ actor: actor({ kind: "system" }), projectId }),
    (error: unknown) => error instanceof module.WorkbenchPageServiceError
      && error.status === 404
      && error.code === "workbench_not_found"
  );
  assert.equal(accessReads, 0);
});

test("R12 workbench service normalizes conversation 403/404 but preserves child contract and unknown failures", async () => {
  const module = await loadWorkbenchModule();
  for (const status of [403, 404] as const) {
    const conversationDenied = module.createWorkbenchPageService({
      repo: repo(),
      conversations: conversations({
        async listConversations() {
          throw new ConversationServiceError(status, "conversation_project_not_found", "missing");
        }
      })
    });
    await assert.rejects(
      conversationDenied.page({ actor: actor(), projectId }),
      (error: unknown) => error instanceof module.WorkbenchPageServiceError
        && error.status === 404
        && error.code === "workbench_not_found"
    );
  }

  const contractSentinel = new InternalContractError("conversation.child", new ZodError([]));
  const childContractFailure = module.createWorkbenchPageService({
    repo: repo(),
    conversations: conversations({
      async listConversations() {
        throw contractSentinel;
      }
    })
  });
  await assert.rejects(
    childContractFailure.page({ actor: actor(), projectId }),
    (error: unknown) => error === contractSentinel
  );

  const sentinel = new Error("member source down");
  const sourceFailure = module.createWorkbenchPageService({
    repo: repo({
      async listWorkspaceMembers() {
        throw sentinel;
      }
    }),
    conversations: conversations()
  });
  await assert.rejects(
    sourceFailure.page({ actor: actor(), projectId }),
    (error: unknown) => error === sentinel
  );
});

test("R12 workbench service recheck prevents a partial 200 after membership revocation", async () => {
  const module = await loadWorkbenchModule();
  let reads = 0;
  const service = module.createWorkbenchPageService({
    repo: repo({
      async findWorkbenchAccess() {
        reads += 1;
        return reads === 1 ? access() : null;
      }
    }),
    conversations: conversations()
  });

  await assert.rejects(
    service.page({ actor: actor(), projectId }),
    (error: unknown) => error instanceof module.WorkbenchPageServiceError
      && error.status === 404
      && error.code === "workbench_not_found"
  );
  assert.equal(reads, 2);
});

test("R12 workbench service uses canonical access identities and rejects security identity drift", async () => {
  const module = await loadWorkbenchModule();
  const calls: Array<{ source: string; input: unknown }> = [];
  let accessReads = 0;
  const canonical = module.createWorkbenchPageService({
    repo: repo({
      async findWorkbenchAccess(input) {
        calls.push({ source: "access", input });
        return access();
      },
      async listWorkspaceMembers(input) {
        calls.push({ source: "members", input });
        return members();
      },
      async countVisibleActivePlans(input) {
        calls.push({ source: "plans", input });
        return 0;
      },
      async listRecentVisibleFiles(input) {
        calls.push({ source: "files", input });
        return [{ id: fileId, name: "brief.docx", updatedAt: now }];
      }
    }),
    conversations: conversations({
      async listConversations(input) {
        calls.push({ source: "conversations", input });
        return conversationPage();
      }
    }),
    now: () => now
  });
  const page = await canonical.page({
    actor: actor({
      id: userId.toUpperCase(),
      userId: userId.toUpperCase(),
      workspaceId: workspaceId.toUpperCase()
    }),
    projectId: projectId.toUpperCase()
  }) as { project: { id: string; workspace_id: string }; viewer: { user_id: string }; recent_project_files: { items: Array<{ href: string }> } };

  assert.deepEqual(page.project, { id: projectId, workspace_id: workspaceId, name: "星尘短剧", slug: "stardust", description: null, owner_label: "阿曼" });
  assert.equal(page.viewer.user_id, userId);
  assert.equal(page.recent_project_files.items[0]?.href, `/drive?project_id=${projectId}&item_id=${fileId}`);
  for (const call of calls) {
    const input = call.input as { workspaceId?: string; viewerUserId?: string; projectId?: string; actor?: AuthActor };
    assert.equal(input.workspaceId ?? input.actor?.workspaceId, workspaceId, `${call.source} workspace was not canonical`);
    assert.equal(input.viewerUserId ?? input.actor?.userId, userId, `${call.source} viewer was not canonical`);
    if (call.source !== "members") {
      assert.equal(input.projectId, projectId, `${call.source} project was not canonical`);
    }
  }

  const drifted = module.createWorkbenchPageService({
    repo: repo({
      async findWorkbenchAccess() {
        accessReads += 1;
        return accessReads === 1 ? access() : access({ membershipRole: "admin" });
      }
    }),
    conversations: conversations()
  });
  await assert.rejects(
    drifted.page({ actor: actor(), projectId }),
    (error: unknown) => error instanceof module.WorkbenchPageServiceError
      && error.status === 404
      && error.code === "workbench_not_found"
  );
  assert.equal(accessReads, 2);
});

test("R12 workbench service turns corrupt assembled rows into InternalContractError", async () => {
  const module = await loadWorkbenchModule();
  const corrupt = module.createWorkbenchPageService({
    repo: repo({
      async listWorkspaceMembers() {
        return {
          ...members(),
          items: [{ ...members().items[0], membershipRole: "superadmin" }, members().items[1]]
        };
      }
    }),
    conversations: conversations(),
    now: () => now
  });

  await assert.rejects(
    corrupt.page({ actor: actor(), projectId }),
    (error: unknown) => error instanceof InternalContractError && error.context === "workbench.page"
  );
});

function runtimeSettings(): Settings {
  return loadSettings({
    APP_ENV: "test",
    COOKIE_SECRET: "workbench-test-secret",
    DEFAULT_ORG_ID: "82ab0000-0000-4000-8000-000000000007",
    DEFAULT_WORKSPACE_ID: workspaceId
  });
}

function authUser(): UserAuthRow {
  return {
    id: userId,
    nickname: "张三",
    cookieToken: "workbench-cookie",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    mutedNotificationTypes: [],
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
}

function authDependencies(settings: Settings): AuthDependencies {
  const row = authUser();
  return {
    settings,
    users: {
      async findActiveByCookieToken(token: string) {
        return token === row.cookieToken ? row : null;
      }
    } as never,
    devices: {
      async findActiveByTokenHash() {
        return null;
      }
    } as never,
    now: () => now
  };
}

function routeTestApp(
  workbenchPages: { page(input: unknown): Promise<Record<string, unknown>> },
  auth: AuthDependencies = authDependencies(runtimeSettings())
) {
  const app = new Hono<AuthEnv>();
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: httpErrorCodeFor(error), message: error.message } }, error.status);
    }
    if (error instanceof InternalContractError) {
      return c.json({
        ok: false,
        error: { code: "internal_contract_error", message: "WorkHub hit an unexpected server error." }
      }, 500);
    }
    return c.json({
      ok: false,
      error: { code: "internal_error", message: "WorkHub hit an unexpected server error." }
    }, 500);
  });
  app.route("/api/pages", createPageRoutes({
    auth,
    workbenchPages
  } as never));
  return app;
}

async function authCookie(
  settings: Settings = runtimeSettings(),
  cookieToken = "workbench-cookie"
) {
  return generateSignedCookie(COOKIE_NAME, cookieToken, settings.auth.cookieSecret);
}

function routedPage() {
  return {
    generated_at: now.toISOString(),
    project: { id: projectId, workspace_id: workspaceId, name: "星尘短剧", slug: "stardust", description: null, owner_label: "阿曼" },
    viewer: { user_id: userId, membership_role: "member", is_project_owner: false },
    conversations: conversationPage(),
    workspace_members: {
      scope: "workspace",
      total: 2,
      returned: 2,
      capped: false,
      items: members().items.map((item) => ({
        user_id: item.userId,
        nickname: item.nickname,
        membership_role: item.membershipRole,
        is_project_owner: item.isProjectOwner,
        is_self: item.isSelf
      }))
    },
    army_summary: { active_plan_count: 0, empty_state: "no_active_armies" },
    recent_project_files: { items: [], empty_state: "no_recent_files" }
  };
}

test("R12 workbench page route rejects malformed UUIDs before service access", async () => {
  const calls: unknown[] = [];
  const app = routeTestApp({
    async page(input) {
      calls.push(input);
      return routedPage();
    }
  });

  const response = await app.request("/api/pages/workbench/not-a-uuid", {
    headers: { Cookie: await authCookie() }
  });

  assert.equal(response.status, 404);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "workbench_not_found");
  assert.deepEqual(calls, []);
});

test("R12 workbench page route canonicalizes a mixed-case UUID and returns the standard localized page envelope", async () => {
  const calls: unknown[] = [];
  const app = routeTestApp({
    async page(input) {
      calls.push(input);
      return routedPage();
    }
  });

  const response = await app.request(`/api/pages/workbench/${projectId.toUpperCase()}?locale=en-US`, {
    headers: { Cookie: await authCookie() }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: { project: { id: string } }; meta: { locale: string } };
  assert.equal(body.ok, true);
  assert.equal(body.data.project.id, projectId);
  assert.equal(body.meta.locale, "en-US");
  assert.equal((calls[0] as { projectId?: string; locale?: string })?.projectId, projectId);
  assert.equal((calls[0] as { projectId?: string; locale?: string })?.locale, "en-US");
});

test("R12 workbench page route distinguishes unauthenticated, inaccessible, contract, and unknown failures", async () => {
  const module = await loadWorkbenchModule();
  const cases = [
    {
      name: "missing cookie",
      error: null,
      headers: {},
      expectedStatus: 401,
      expectedCode: "not_identified"
    },
    {
      name: "inaccessible project",
      error: new module.WorkbenchPageServiceError(404, "workbench_not_found", "Workbench not found."),
      headers: { Cookie: await authCookie() },
      expectedStatus: 404,
      expectedCode: "workbench_not_found"
    },
    {
      name: "assembled VM drift",
      error: new InternalContractError("workbench.page", new ZodError([])),
      headers: { Cookie: await authCookie() },
      expectedStatus: 500,
      expectedCode: "internal_contract_error"
    },
    {
      name: "unknown service failure",
      error: new Error("source down"),
      headers: { Cookie: await authCookie() },
      expectedStatus: 500,
      expectedCode: "internal_error"
    }
  ] as const;

  for (const scenario of cases) {
    let serviceCalls = 0;
    const app = routeTestApp({
      async page() {
        serviceCalls += 1;
        if (scenario.error) {
          throw scenario.error;
        }
        return routedPage();
      }
    });
    const response = await app.request(`/api/pages/workbench/${projectId}`, {
      headers: scenario.headers
    });
    const body = await response.json() as { ok: false; error: { code: string } };

    assert.equal(response.status, scenario.expectedStatus, scenario.name);
    assert.equal(body.ok, false, scenario.name);
    assert.equal(body.error.code, scenario.expectedCode, scenario.name);
    assert.equal(serviceCalls, scenario.name === "missing cookie" ? 0 : 1, scenario.name);
  }
});

test("R12 workbench page route keeps invalid desktop credentials distinct from project access", async () => {
  const app = routeTestApp({
    async page() {
      return routedPage();
    }
  });

  const response = await app.request(`/api/pages/workbench/${projectId}`, {
    headers: {
      Cookie: await authCookie(),
      "x-workhub-client-token": "invalid"
    }
  });

  assert.equal(response.status, 403);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "invalid_client_token");
});

test("R12 workbench real PostgreSQL endpoint returns 200 then uniform 404 after membership revocation", {
  skip: process.env.WORKHUB_R12_WORKBENCH_REAL_PG !== "1",
  timeout: 120_000
}, async () => {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL is required for the opt-in R12 workbench PostgreSQL endpoint chain");
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  assert.match(
    databaseName,
    /^workhub_r12_0c4_[a-z0-9_]+$/u,
    "real-PG endpoint chain refuses to write unless DATABASE_URL points at a dedicated workhub_r12_0c4_* scratch database"
  );

  const realOrgId = "87aa0000-0000-4000-8000-000000000001";
  const realWorkspaceId = "87bb0000-0000-4000-8000-000000000002";
  const realUserId = "87cc0000-0000-4000-8000-000000000003";
  const realProjectId = "87dd0000-0000-4000-8000-000000000004";
  const realConversationId = "87ee0000-0000-4000-8000-000000000005";
  const realMembershipId = "87ff0000-0000-4000-8000-000000000006";
  const realCookieToken = "r12-workbench-real-pg-cookie";
  const realSettings = loadSettings({
    APP_ENV: "test",
    DATABASE_URL: databaseUrl,
    COOKIE_SECRET: "r12-workbench-real-pg-secret",
    DEFAULT_ORG_ID: realOrgId,
    DEFAULT_WORKSPACE_ID: realWorkspaceId
  });
  await runMigrations(realSettings);
  const client = createDatabaseClient(realSettings);
  try {
    await client.pool.query(
      `insert into orgs (id, name, slug, plan) values ($1, $2, $3, $4)`,
      [realOrgId, "R12 API PG Org", "r12-api-pg-org", "lan"]
    );
    await client.pool.query(
      `insert into workspaces (id, org_id, name, slug) values ($1, $2, $3, $4)`,
      [realWorkspaceId, realOrgId, "R12 API PG Workspace", "r12-api-pg-workspace"]
    );
    await client.pool.query(
      `insert into users (id, nickname, cookie_token, is_admin) values ($1, $2, $3, false)`,
      [realUserId, "R12 API Owner", realCookieToken]
    );
    await client.pool.query(
      `insert into workspace_memberships (id, workspace_id, user_id, role, default_workspace)
       values ($1, $2, $3, 'owner', true)`,
      [realMembershipId, realWorkspaceId, realUserId]
    );
    await client.pool.query(
      `insert into projects (id, workspace_id, name, slug, description, owner_nickname, owner_user_id)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        realProjectId,
        realWorkspaceId,
        "R12 API PG Project",
        "r12-api-pg-project",
        "Endpoint revocation proof",
        "R12 API Owner",
        realUserId
      ]
    );
    await client.pool.query(
      `insert into project_conversations
         (id, workspace_id, project_id, kind, title, visibility, next_seq, created_by)
       values ($1, $2, $3, 'main', $4, 'project', 0, $5)`,
      [realConversationId, realWorkspaceId, realProjectId, "主区", realUserId]
    );

    const module = await loadWorkbenchModule();
    let conversationReads = 0;
    const service = module.createWorkbenchPageService({
      repo: createWorkbenchRepository(client.db),
      conversations: {
        async listConversations() {
          conversationReads += 1;
          return {
            conversations: [{
              id: realConversationId,
              workspace_id: realWorkspaceId,
              project_id: realProjectId,
              kind: "main",
              title: "主区",
              parent_conversation_id: null,
              source_message_id: null,
              visibility: "project",
              next_seq: 0,
              created_by: realUserId,
              participant_role: null,
              cuu_enabled: true,
              created_at: now.toISOString(),
              updated_at: now.toISOString()
            }],
            capped: false,
            next_cursor: null
          };
        }
      },
      now: () => now
    });
    const realAuth: AuthDependencies = {
      settings: realSettings,
      users: createUserRepository(client.db),
      devices: {
        async findActiveByTokenHash() {
          return null;
        }
      } as never,
      now: () => now
    };
    const app = routeTestApp(service, realAuth);
    const cookie = await authCookie(realSettings, realCookieToken);

    const beforeRevocation = await app.request(`/api/pages/workbench/${realProjectId}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(beforeRevocation.status, 200);
    const beforeBody = await beforeRevocation.json() as {
      ok: true;
      data: {
        project: { id: string; workspace_id: string };
        viewer: { user_id: string; membership_role: string; is_project_owner: boolean };
        workspace_members: { total: number; returned: number; items: unknown[] };
      };
    };
    assert.equal(beforeBody.ok, true);
    assert.deepEqual(beforeBody.data.project, {
      id: realProjectId,
      workspace_id: realWorkspaceId,
      name: "R12 API PG Project",
      slug: "r12-api-pg-project",
      description: "Endpoint revocation proof",
      owner_label: "R12 API Owner"
    });
    assert.deepEqual(beforeBody.data.viewer, {
      user_id: realUserId,
      membership_role: "owner",
      is_project_owner: true
    });
    assert.equal(beforeBody.data.workspace_members.total, 1);
    assert.equal(beforeBody.data.workspace_members.returned, 1);
    assert.equal(beforeBody.data.workspace_members.items.length, 1);
    assert.doesNotMatch(
      JSON.stringify(beforeBody),
      /cookie_token|storage_path|parsed_text|sha256|background_tasks|conversation_outputs|"runs"|"steps"/iu
    );
    assert.equal(conversationReads, 1);

    await client.pool.query(
      `update workspace_memberships set deleted_at = now() where id = $1`,
      [realMembershipId]
    );
    const afterRevocation = await app.request(`/api/pages/workbench/${realProjectId}`, {
      headers: { Cookie: cookie }
    });
    assert.equal(afterRevocation.status, 404);
    assert.deepEqual(await afterRevocation.json(), {
      ok: false,
      error: {
        code: "workbench_not_found",
        message: "没有找到这个桌面工作台。"
      }
    });
    assert.equal(conversationReads, 1, "revoked request reached child sources after the access preflight failed");
  } finally {
    await client.close();
  }
});
