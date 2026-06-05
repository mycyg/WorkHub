import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import {
  deliverableManifestFixtures,
  type DeliverableChangeManifest
} from "@workhub/contracts";
import type {
  ClientDeviceAuthRow as DbClientDeviceAuthRow,
  ClientDeviceRepository as DbClientDeviceRepository,
  UserAuthRow as DbUserAuthRow,
  UserRepository as DbUserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { buildProposalDetailPage } from "./pages/proposals.js";
import { createPageRoutes } from "./routes/pages.js";
import { createProposalRoutes, createWorkItemProposalRoutes } from "./routes/proposals.js";
import { createInMemoryProposalService } from "./services/proposals.js";

const now = new Date("2026-06-06T00:00:00.000Z");
const userId = "91000000-0000-4000-8000-000000000001";

function user(): DbUserAuthRow {
  return {
    id: userId,
    nickname: "proposal-reviewer",
    cookieToken: "cookie-proposal-reviewer",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements DbUserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-proposal-reviewer" ? user() : null;
  }

  async findActiveByNickname() {
    return null;
  }

  async createUser(): Promise<DbUserAuthRow> {
    throw new Error("not needed");
  }

  async getOrCreateActiveByNickname(): Promise<{ user: DbUserAuthRow; created: boolean }> {
    throw new Error("not needed");
  }

  async rotateCookieToken() {
    return null;
  }
}

class MemoryDevices implements DbClientDeviceRepository {
  async findActiveByTokenHash() {
    return null;
  }

  async findActiveByTokenHashForUser() {
    return null;
  }

  async createClientDevice(): Promise<DbClientDeviceAuthRow> {
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
    users: new MemoryUsers(),
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
  return generateSignedCookie(COOKIE_NAME, "cookie-proposal-reviewer", runtimeSettings.auth.cookieSecret);
}

function manifest(index = 0): DeliverableChangeManifest {
  const fixture = deliverableManifestFixtures[index] ?? deliverableManifestFixtures[0];
  if (!fixture) {
    throw new Error("missing deliverable manifest fixture");
  }
  return structuredClone(fixture);
}

function ids() {
  const values = [
    "91000000-0000-4000-8000-000000000101",
    "91000000-0000-4000-8000-000000000102",
    "91000000-0000-4000-8000-000000000103",
    "91000000-0000-4000-8000-000000000104",
    "91000000-0000-4000-8000-000000000105",
    "91000000-0000-4000-8000-000000000106"
  ];
  return () => values.shift() ?? "91000000-0000-4000-8000-000000000199";
}

function appWithProposalRoutes() {
  const runtimeSettings = settings();
  const auth = authDeps(runtimeSettings);
  const proposals = createInMemoryProposalService({ now: () => now, id: ids() });
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemProposalRoutes({ auth, proposals }));
  app.route("/api/proposals", createProposalRoutes({ auth, proposals, allowUnauthenticatedGoldPath: false }));
  app.route("/api/pages", createPageRoutes({ auth, proposals, allowUnauthenticatedGoldPath: false }));
  return { app, runtimeSettings };
}

async function createProposal(app: Hono<AuthEnv>, runtimeSettings: Settings, itemManifest = manifest()) {
  const response = await app.request(`/api/workitems/${itemManifest.work_item_id}/proposals`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await cookie(runtimeSettings)
    },
    body: JSON.stringify({ manifest: itemManifest })
  });
  assert.equal(response.status, 201);
  return response.json() as Promise<{ ok: true; data: { id: string; diff_manifest: DeliverableChangeManifest } }>;
}

test("proposal routes create, read, and render a page VM from a DeliverableChangeManifest", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(0));
  const proposalId = created.data.id;

  assert.equal(created.data.diff_manifest.proposal_id, proposalId);
  assert.equal(created.data.diff_manifest.changes[0]?.target_kind, "binary_doc");

  const raw = await app.request(`/api/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const list = await app.request(`/api/workitems/${created.data.diff_manifest.work_item_id}/proposals`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const page = await app.request(`/api/pages/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(raw.status, 200);
  assert.equal(list.status, 200);
  assert.equal(page.status, 200);
  const rawBody = await raw.json() as { ok: true; data: { diff_manifest: DeliverableChangeManifest } };
  const listBody = await list.json() as { ok: true; data: { id: string }[] };
  const pageBody = await page.json() as { ok: true; data: ReturnType<typeof buildProposalDetailPage> };

  assert.equal(rawBody.data.diff_manifest.proposal_id, proposalId);
  assert.equal(listBody.data.some((proposal) => proposal.id === proposalId), true);
  assert.equal(pageBody.data.proposal_id, proposalId);
  assert.equal(pageBody.data.manifest.review.reason_required_on_reject, true);
  assert.equal(pageBody.data.review_actions.request_changes.requires_reason, true);
});

test("proposal review requires reasons for changes and feeds them back into the next agent context", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(2));
  const proposalId = created.data.id;
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const missingReason = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes" })
  });
  assert.equal(missingReason.status, 422);

  const response = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "request_changes", reason_md: "请补齐数据来源和口径说明。" })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    ok: true;
    data: {
      status: string;
      next_agent_context?: { correction: string; reason_fed_back: boolean };
      attention: { cuu_state?: string };
      event: { type: string };
      feedback_event?: { type: string; cuu_state?: string; data: { reason_fed_back?: boolean } };
      audit_logs?: { action: string; detail_json: { reason_fed_back?: boolean } }[];
    };
  };
  assert.equal(body.data.status, "revision_requested");
  assert.equal(body.data.next_agent_context?.correction, "请补齐数据来源和口径说明。");
  assert.equal(body.data.next_agent_context?.reason_fed_back, true);
  assert.equal(body.data.attention.cuu_state, "revision_requested");
  assert.equal(body.data.event.type, "proposal.reviewed");
  assert.equal(body.data.feedback_event?.type, "revision.fedback");
  assert.equal(body.data.feedback_event?.cuu_state, "revision_requested");
  assert.equal(body.data.feedback_event?.data.reason_fed_back, true);
  assert.equal(body.data.audit_logs?.some((log) => log.action === "reason_fed_back"), true);
  assert.equal(body.data.audit_logs?.[0]?.detail_json.reason_fed_back, true);
});

test("approved proposal can be merged with proposal events, audit facts, and rollback payload", async () => {
  const { app, runtimeSettings } = appWithProposalRoutes();
  const created = await createProposal(app, runtimeSettings, manifest(3));
  const proposalId = created.data.id;
  const headers = {
    "Content-Type": "application/json",
    Cookie: await cookie(runtimeSettings)
  };

  const review = await app.request(`/api/proposals/${proposalId}/review`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "approve" })
  });
  assert.equal(review.status, 200);

  const reviewedPage = await app.request(`/api/pages/proposals/${proposalId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  const reviewedPageBody = await reviewedPage.json() as {
    ok: true;
    data: { status: string; review_actions: { merge?: { href: string } } };
  };
  assert.equal(reviewedPageBody.data.status, "reviewed");
  assert.equal(reviewedPageBody.data.review_actions.merge?.href, `/api/proposals/${proposalId}/merge`);

  const merge = await app.request(`/api/proposals/${proposalId}/merge`, {
    method: "POST",
    headers,
    body: JSON.stringify({})
  });

  assert.equal(merge.status, 200);
  const mergeBody = await merge.json() as {
    ok: true;
    data: {
      status: string;
      rollback_available: boolean;
      rollback: { available: boolean };
      events: { type: string }[];
      audit_logs: { action: string; snapshot_id?: string }[];
      attention: { cuu_state?: string };
    };
  };
  assert.equal(mergeBody.data.status, "merged");
  assert.equal(mergeBody.data.rollback_available, true);
  assert.equal(mergeBody.data.rollback.available, true);
  assert.equal(mergeBody.data.events.some((event) => event.type === "proposal.merged"), true);
  assert.equal(mergeBody.data.events.some((event) => event.type === "notification.created"), true);
  assert.equal(mergeBody.data.audit_logs.some((log) => log.action === "proposal.merged" && log.snapshot_id), true);
  assert.equal(mergeBody.data.attention.cuu_state, "celebrating");
});
