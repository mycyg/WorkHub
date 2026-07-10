# WorkHub Batch 0 Delegation Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approval delegation workspace-scoped and fail-closed from the member picker through the service mutation, notification, SSE, audit, and Web option rendering.

**Architecture:** The authenticated actor's workspace id is the only input to the member directory query. The approval service independently checks an active membership for the submitted target before any mutation or post-commit side effect. Web renders returned users as DOM option nodes with literal text rather than parsing nicknames as HTML.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Node test runner, WorkHub API client/Web runtime, PostgreSQL integration smoke.

## Global Constraints

- Cross-workspace delegate targets must fail before `delegatePending`, notification creation, SSE publication, or success audit.
- The member directory must never fall back to a global active-user list.
- A missing membership repository or workspace-directory capability is an explicit service-unavailable/unsupported error, never a permissive fallback.
- The target user and target membership checks are independent; an active user without an active membership is not eligible.
- The existing work-item visibility and requester checks remain defense-in-depth after membership eligibility.
- Nicknames are untrusted text. Web must assign them through `textContent`; no user value may enter `innerHTML`.
- Every production behavior change follows an observed RED test before implementation.
- Current OpenAPI and the user-facing audit report change with the implementation.

---

### Task 1: Workspace-scoped member directory

**Files:**

- Modify: `packages/db/src/repositories/users.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/auth.test.ts`

**Interfaces:**

- Consumes: `AuthActor.workspaceId` returned by `resolveHumanActor()`.
- Produces: `UserRepository.listActiveRefsForWorkspace(workspaceId)` returning `{ id, nickname, isAdmin }[]` for active users with an active membership in exactly that workspace.
- Preserves: `GET /api/users` response shape `{ users: [{ id, nickname, is_admin }] }`.

- [ ] **Step 1: Add a failing route test for workspace isolation**

In `apps/api/src/auth.test.ts`, import `createUserDirectoryRoutes`, add an optional workspace directory seam to `MemoryUsers`, and add this behavioral test after the existing multi-tenancy actor tests:

```ts
import { createAuthRoutes, createUserDirectoryRoutes } from "./routes/auth.js";

class MemoryUsers implements UserRepository {
  public readonly directoryWorkspaceCalls: string[] = [];
  public readonly directoryUserIdsByWorkspace = new Map<string, string[]>();

  async listActiveRefsForWorkspace(workspaceId: string) {
    this.directoryWorkspaceCalls.push(workspaceId);
    const allowed = new Set(this.directoryUserIdsByWorkspace.get(workspaceId) ?? []);
    return this.rows
      .filter((row) => allowed.has(row.id) && row.deletedAt === null)
      .map((row) => ({ id: row.id, nickname: row.nickname, isAdmin: row.isAdmin }));
  }

  // Keep the existing methods unchanged.
}

test("GET /api/users lists only active members from the authenticated actor workspace", async () => {
  const runtimeSettings = settings();
  const alice = user({ id: "10000000-0000-4000-8000-0000000000a1", nickname: "alice" });
  const teammate = user({ id: "10000000-0000-4000-8000-0000000000a2", nickname: "teammate" });
  const outsider = user({ id: "10000000-0000-4000-8000-0000000000b1", nickname: "outsider" });
  const actorWorkspaceId = "22220000-0000-4000-8000-0000000000a1";
  const actorOrgId = "11110000-0000-4000-8000-0000000000a1";
  const memberships = new MemoryMemberships({ [actorWorkspaceId]: actorOrgId });
  await memberships.create({
    workspaceId: actorWorkspaceId,
    userId: alice.id,
    role: "member",
    defaultWorkspace: true
  });
  const users = new MemoryUsers([alice, teammate, outsider]);
  users.directoryUserIdsByWorkspace.set(actorWorkspaceId, [alice.id, teammate.id]);
  const authDeps: AuthDependencies = {
    users,
    devices: new MemoryDevices([]),
    memberships,
    settings: runtimeSettings,
    now: () => now
  };
  const app = withProductionHttpErrors(new Hono<AuthEnv>());
  app.route("/api", createUserDirectoryRoutes(authDeps));

  const response = await app.request("/api/users", {
    headers: { Cookie: await signedCookie(alice.cookieToken, runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    data: {
      users: [
        { id: alice.id, nickname: "alice", is_admin: false },
        { id: teammate.id, nickname: "teammate", is_admin: false }
      ]
    }
  });
  assert.deepEqual(users.directoryWorkspaceCalls, [actorWorkspaceId]);
});
```

- [ ] **Step 2: Run the route test and observe RED**

Run:

```bash
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="GET /api/users lists only active members" \
  src/auth.test.ts
```

Expected: FAIL because the current route looks for global `listActiveRefs` and returns `501 users_unsupported`; it does not call `listActiveRefsForWorkspace`.

- [ ] **Step 3: Replace the global directory repository method with a workspace join**

In `packages/db/src/repositories/users.ts`, import `workspaceMemberships`, replace the optional global method in `UserRepository`, and implement the scoped query:

```ts
import { users, workspaceMemberships } from "../schema/index.js";

export type UserRepository = {
  // Existing methods remain unchanged.
  listActiveRefsForWorkspace?: (
    workspaceId: string
  ) => Promise<Array<Pick<UserAuthRow, "id" | "nickname" | "isAdmin">>>;
};

export function createUserRepository(db: WorkHubDb): UserRepository {
  return {
    async listActiveRefsForWorkspace(workspaceId) {
      return db
        .select({ id: users.id, nickname: users.nickname, isAdmin: users.isAdmin })
        .from(users)
        .innerJoin(workspaceMemberships, eq(workspaceMemberships.userId, users.id))
        .where(
          and(
            eq(workspaceMemberships.workspaceId, workspaceId),
            isNull(workspaceMemberships.deletedAt),
            isNull(users.deletedAt)
          )
        )
        .orderBy(users.nickname)
        .limit(200);
    },
    // Existing methods remain unchanged.
  };
}
```

Delete `listActiveRefs` from the interface and implementation so no future caller can accidentally reintroduce the global directory.

- [ ] **Step 4: Make the route derive and pass the authenticated workspace**

Replace the body of `createUserDirectoryRoutes()` in `apps/api/src/routes/auth.ts` with:

```ts
export function createUserDirectoryRoutes(source: AuthDependencySource = getDefaultAuthDependencies) {
  const routes = new Hono<AuthEnv>();
  routes.get("/users", async (c) => {
    const deps = resolveAuthDependencies(source);
    const currentUser = await resolveCurrentUser(c, deps);
    const actor = await resolveHumanActor(deps, currentUser);
    if (!deps.users.listActiveRefsForWorkspace) {
      return c.json({
        ok: false,
        error: {
          code: "users_unsupported",
          message: "当前存储不支持工作区成员清单。"
        }
      }, 501);
    }
    const refs = await deps.users.listActiveRefsForWorkspace(actor.workspaceId);
    return c.json({
      ok: true,
      data: {
        users: refs.map((member) => ({
          id: member.id,
          nickname: member.nickname,
          is_admin: member.isAdmin
        }))
      }
    });
  });
  return routes;
}
```

- [ ] **Step 5: Run the targeted API tests and typecheck**

Run:

```bash
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="GET /api/users lists only active members|resolveHumanActor" \
  src/auth.test.ts
pnpm --filter @workhub/api typecheck
```

Expected: all selected tests pass and typecheck exits 0.

- [ ] **Step 6: Commit the scoped directory**

```bash
git add packages/db/src/repositories/users.ts apps/api/src/routes/auth.ts apps/api/src/auth.test.ts
git commit -m "fix(auth): scope member directory to actor workspace"
```

---

### Task 2: Fail-closed approval delegate authorization

**Files:**

- Modify: `apps/api/src/services/approvals.ts`
- Modify: `apps/api/src/approvals.test.ts`
- Modify: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: `WorkspaceMembershipRepository.findActiveForUserWorkspace(toUserId, actor.workspaceId)`.
- Produces: `delegate_membership_unavailable` with HTTP 503 when the authorization capability is absent.
- Preserves: existing `delegate_target_not_found`, `delegate_to_requester`, `delegate_target_cannot_view`, and `approval_race` behavior after membership authorization succeeds.

- [ ] **Step 1: Add a failing cross-workspace membership regression**

In `apps/api/src/approvals.test.ts`, add this test immediately after the existing delegate tests:

```ts
test("delegate rejects an active user without an actor-workspace membership before mutation or side effects", async () => {
  const approvals = new MemoryApprovals();
  const auditLogs = new MemoryAuditLogs();
  const policies = new MemoryPolicies();
  const bus = new RecordingBus();
  const notificationCalls: unknown[] = [];
  const targetUserId = "10000000-0000-4000-8000-0000000000d3";
  const seeded = await approvals.createApprovalRequest({
    actionPattern: "tool.write_file",
    workItemId: "50000000-0000-4000-8000-0000000000d3",
    routedToUserId: approverId
  });
  const service = createApprovalService({
    approvals,
    auditLogs,
    policies,
    bus,
    users: {
      findActiveById: async (id) => id === targetUserId ? user({ id }) : null
    },
    memberships: {
      findActiveForUserWorkspace: async () => null
    },
    workItems: {
      findWorkItemAccessRecord: async () => ({
        id: seeded.workItemId!,
        status: "in_review",
        submitterUserId: userId,
        claimedByUserId: null,
        workspaceId,
        project: {
          id: "70000000-0000-4000-8000-0000000000d3",
          workspaceId,
          orgId,
          ownerUserId: userId,
          archived: false,
          deletedAt: null
        },
        assignments: []
      }) as never
    },
    notifications: {
      createMentionNotification: async () => undefined as never,
      createNotification: async (input) => {
        notificationCalls.push(input);
        return undefined as never;
      },
      archiveByDedupeKey: async () => undefined
    },
    now: () => now
  });

  await assert.rejects(
    () => service.delegate(seeded.id, actor, targetUserId),
    (error) => error instanceof ApprovalServiceError
      && error.status === 404
      && error.code === "delegate_target_not_found"
  );

  assert.equal((await approvals.findById(seeded.id))?.routedToUserId, approverId);
  assert.equal(auditLogs.rows.some((entry) => entry.action === "approval.delegated"), false);
  assert.deepEqual(bus.events, []);
  assert.deepEqual(notificationCalls, []);
});
```

- [ ] **Step 2: Run the membership regression and observe RED**

Run:

```bash
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="delegate rejects an active user without an actor-workspace membership" \
  src/approvals.test.ts
```

Expected: FAIL because the current service ignores `memberships`, delegates the row, and emits post-commit side effects.

- [ ] **Step 3: Add the membership dependency and guard before visibility checks**

In `apps/api/src/services/approvals.ts`, import the membership repository factory/type, extend the dependency type, wire the default repository, and resolve the seam once:

```ts
import {
  createWorkspaceMembershipRepository,
  type WorkspaceMembershipRepository
} from "@workhub/db";

export type ApprovalServiceDependencies = {
  // Existing dependencies remain unchanged.
  memberships?: Pick<WorkspaceMembershipRepository, "findActiveForUserWorkspace"> | false;
};

export function getDefaultApprovalServiceDependencies(): ApprovalServiceDependencies {
  defaultDbClient ??= getSharedDatabaseClient();
  return {
    // Existing dependencies remain unchanged.
    memberships: createWorkspaceMembershipRepository(defaultDbClient.db)
  };
}

export function createApprovalService(deps: ApprovalServiceDependencies = getDefaultApprovalServiceDependencies()) {
  const now = deps.now ?? (() => new Date());
  const memberships = deps.memberships === false ? undefined : deps.memberships;

  // Existing service implementation remains unchanged outside delegate().
}
```

Inside `delegate()`, after `findActiveById()` succeeds and before the work-item visibility check, add:

```ts
if (!memberships) {
  throw new ApprovalServiceError(
    503,
    "delegate_membership_unavailable",
    "成员资格暂时无法校验，审批没有被转交。"
  );
}
const targetMembership = await memberships.findActiveForUserWorkspace(toUserId, actor.workspaceId);
if (!targetMembership) {
  throw new ApprovalServiceError(404, "delegate_target_not_found", "找不到要转交的成员。");
}
```

Do not catch either error. The call to `delegatePending()` must remain after this guard.

- [ ] **Step 4: Update all existing successful delegate fixtures to declare active membership**

Add this helper near the delegate tests in `apps/api/src/approvals.test.ts`:

```ts
function eligibleDelegate(targetUserIds: readonly string[]) {
  const eligible = new Set(targetUserIds);
  return {
    users: {
      findActiveById: async (id: string) => eligible.has(id) ? user({ id }) : null
    },
    memberships: {
      findActiveForUserWorkspace: async (id: string, targetWorkspaceId: string) =>
        eligible.has(id) && targetWorkspaceId === workspaceId
          ? ({ id: `membership-${id}`, userId: id, workspaceId } as never)
          : null
    }
  };
}
```

Spread `...eligibleDelegate([toUserId])` into the service dependencies for every existing test that calls `service.delegate()`. For the TOCTOU test, include both intended target ids required by the scenario. Do not use `memberships: false` in a successful delegate test.

- [ ] **Step 5: Replace the misleading old workspace test**

Change the old test named `delegate rejects a target outside the actor workspace even when the work item is otherwise public` so the work item stays in `workspaceId`, the target user is active, and `findActiveForUserWorkspace()` returns `null`. Assert `delegate_target_not_found`, not `delegate_target_cannot_view`. This makes the test model target membership rather than moving the protected resource to another workspace.

- [ ] **Step 6: Add and test the explicit unavailable dependency error**

Add a focused test with `memberships: false` and an active target. Assert HTTP/service status 503, code `delegate_membership_unavailable`, unchanged routed user, no bus event, and no success audit.

Run:

```bash
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="delegate.*membership|FIX#3 delegate|delegate returns the committed|delegatePending CAS" \
  src/approvals.test.ts
```

Expected: all selected delegate tests pass.

- [ ] **Step 7: Publish the new 503 contract in OpenAPI**

In `apps/api/src/openapi.ts`, add:

```ts
const approvalDelegateMembershipUnavailableResponse = jsonErrorStatusResponse(
  "503",
  "Approval delegation membership could not be verified",
  ["delegate_membership_unavailable"]
).responses["503"];
```

Add it to `approvalDelegateResponse.responses` as `"503"`.

In `apps/api/src/app.test.ts`, assert:

```ts
assertJsonErrorCodes(body.paths, "/api/approvals/{id}/delegate", "post", "503", [
  "delegate_membership_unavailable"
]);
```

- [ ] **Step 8: Run approval, OpenAPI, and type checks**

Run:

```bash
pnpm --filter @workhub/api exec node --import tsx --test \
  --test-name-pattern="delegate|OpenAPI" \
  src/approvals.test.ts src/app.test.ts
pnpm --filter @workhub/api typecheck
```

Expected: selected tests pass and typecheck exits 0.

- [ ] **Step 9: Commit the server authorization guard**

```bash
git add apps/api/src/services/approvals.ts apps/api/src/approvals.test.ts apps/api/src/openapi.ts apps/api/src/app.test.ts
git commit -m "fix(approvals): require workspace membership for delegation"
```

---

### Task 3: Literal DOM option rendering

**Files:**

- Create: `apps/web/src/delegate-options.ts`
- Create: `apps/web/src/delegate-options.test.ts`
- Modify: `apps/web/src/browser.ts`

**Interfaces:**

- Consumes: the existing `listUsers()` response `{ id, nickname, is_admin }[]`.
- Produces: `buildDelegateOptionNodes(documentLike, users, locale)` and `buildDelegateStatusOption(documentLike, message)`.
- Guarantees: one returned user creates exactly one option node whose value is the server id and whose label is literal text.

- [ ] **Step 1: Write the malicious-nickname RED test**

Create `apps/web/src/delegate-options.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { buildDelegateOptionNodes } from "./delegate-options.js";

type FakeOption = { value: string; textContent: string | null };

test("delegate option builder keeps an HTML-shaped nickname as one literal option", () => {
  const created: FakeOption[] = [];
  const fakeDocument = {
    createElement(tag: "option") {
      assert.equal(tag, "option");
      const option: FakeOption = { value: "", textContent: null };
      created.push(option);
      return option;
    }
  };
  const nickname = "Alice</option><option value=attacker selected>Attacker";

  const nodes = buildDelegateOptionNodes(fakeDocument, [{
    id: "10000000-0000-4000-8000-0000000000aa",
    nickname,
    is_admin: false
  }], "zh-CN");

  assert.equal(nodes.length, 1);
  assert.equal(created.length, 1);
  assert.equal(nodes[0]?.value, "10000000-0000-4000-8000-0000000000aa");
  assert.equal(nodes[0]?.textContent, nickname);
});
```

- [ ] **Step 2: Run the Web test and observe RED**

Run:

```bash
pnpm --filter @workhub/web exec node --import tsx --test \
  --test-name-pattern="delegate option builder" \
  src/delegate-options.test.ts
```

Expected: FAIL with module-not-found because `delegate-options.ts` does not exist.

- [ ] **Step 3: Implement the typed node builder**

Create `apps/web/src/delegate-options.ts`:

```ts
import type { WorkHubLocale } from "@workhub/contracts";

export type DelegateUserOption = {
  id: string;
  nickname: string;
  is_admin: boolean;
};

type OptionLike = {
  value: string;
  textContent: string | null;
};

type OptionDocument<T extends OptionLike> = {
  createElement(tag: "option"): T;
};

export function buildDelegateOptionNodes<T extends OptionLike>(
  documentLike: OptionDocument<T>,
  users: readonly DelegateUserOption[],
  locale: WorkHubLocale
): T[] {
  return users.map((user) => {
    const option = documentLike.createElement("option");
    option.value = user.id;
    option.textContent = `${user.nickname}${user.is_admin
      ? locale === "en-US" ? " (admin)" : "（管理员）"
      : ""}`;
    return option;
  });
}

export function buildDelegateStatusOption<T extends OptionLike>(
  documentLike: OptionDocument<T>,
  message: string
): T {
  const option = documentLike.createElement("option");
  option.value = "";
  option.textContent = message;
  return option;
}
```

- [ ] **Step 4: Replace both success and error `innerHTML` writes**

Import the helpers in `apps/web/src/browser.ts`. Replace the success block with:

```ts
const options = buildDelegateOptionNodes(document, result.users, locale);
select.replaceChildren(...options);
```

Replace the catch block's static `innerHTML` with:

```ts
select.replaceChildren(buildDelegateStatusOption(
  document,
  locale === "en-US"
    ? "Couldn't load members — reopen to retry"
    : "成员没加载出来，收起再展开重试"
));
```

- [ ] **Step 5: Run Web tests and typecheck**

Run:

```bash
pnpm --filter @workhub/web exec node --import tsx --test \
  --test-name-pattern="delegate option builder" \
  src/delegate-options.test.ts
pnpm --filter @workhub/web typecheck
```

Expected: the malicious nickname remains one literal option and typecheck exits 0.

- [ ] **Step 6: Commit safe option rendering**

```bash
git add apps/web/src/delegate-options.ts apps/web/src/delegate-options.test.ts apps/web/src/browser.ts
git commit -m "fix(web): render delegate members as literal options"
```

---

### Task 4: Batch verification and living audit update

**Files:**

- Modify: `docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md`

**Interfaces:**

- Consumes: commits and fresh test output from Tasks 1-3.
- Produces: a remediation entry that preserves the original finding and records exact evidence without declaring the whole release ready.

- [ ] **Step 1: Run the complete affected package suites**

Run:

```bash
pnpm --filter @workhub/api test
pnpm --filter @workhub/web test
pnpm --filter @workhub/api typecheck
pnpm --filter @workhub/web typecheck
pnpm --filter @workhub/db typecheck
```

Expected: all commands exit 0 with zero failed tests.

- [ ] **Step 2: Run database-backed membership evidence**

Start the repository's PostgreSQL/Redis dependencies using the documented Pilot environment, then run:

```bash
pnpm qa:r2-pg-redis-smoke
```

Expected: the smoke exits 0. If the environment cannot start, record the exact environmental failure and keep the batch open; do not replace this evidence with a unit test.

- [ ] **Step 3: Verify the old unsafe handles are gone**

Run:

```bash
rg -n "listActiveRefs\b|select\.innerHTML = result\.users" packages/db/src apps/api/src apps/web/src
```

Expected: no matches. This is supporting evidence only; behavioral tests remain authoritative.

- [ ] **Step 4: Update the audit remediation table**

Add a `Remediation loop status` section near the top of the audit report with one row for P0-1. Record:

- status `FIXED_PENDING_REVIEW` until independent review completes;
- the three task commit hashes;
- exact API/Web test commands and pass counts;
- the PostgreSQL/Redis smoke result;
- a statement that a fresh cross-workspace exploit regression produced no mutation, notification, SSE, or success audit.

Do not change the historical P0 finding text or the report's original review baseline.

- [ ] **Step 5: Run documentation and repository checks**

Run:

```bash
git diff --check
pnpm audit:portable-config
pnpm audit:target-paths
pnpm audit:migrations
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit the verified remediation record**

```bash
git add docs/workhub/05-clients/workhub-user-facing-systematic-review-r10-follow-up-2026-07-10.md
git commit -m "docs: record Batch 0 delegation remediation evidence"
```

- [ ] **Step 7: Request independent task and whole-batch review**

Generate a review package from the branch point through the current HEAD. The reviewer must independently check:

- scope derivation uses the authenticated actor workspace;
- repository join filters both membership and user tombstones;
- membership authorization precedes every mutation and side effect;
- absent membership capability fails closed;
- the misleading old test was replaced rather than retained as false proof;
- nickname rendering never parses user-controlled HTML;
- OpenAPI matches runtime errors;
- no Critical or Important finding remains.

Any Critical or Important result reopens the relevant task and requires another RED-GREEN-review cycle.
