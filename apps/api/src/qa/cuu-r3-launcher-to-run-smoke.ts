import assert from "node:assert/strict";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { createApiClient } from "@workhub/api-client";
import { settings, type Settings } from "@workhub/config";
import type { AgentRunLiveVM } from "@workhub/contracts";
import type { CuuCard } from "@workhub/cuu";
import { defaultSeedIds, type ClientDeviceAuthRow, type UserAuthRow } from "@workhub/db";
import {
  createDesktopCuuAgentLauncherCard,
  resolveDesktopCuuAction,
  submitDesktopCuuAction
} from "../../../desktop-webview/src/desktop-cuu-runtime.js";
import { hashClientToken, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createAgentRunRoutes } from "../routes/agent-runs.js";
import { createSessionRoutes } from "../routes/sessions.js";
import { createWorkItemRoutes } from "../routes/workitems.js";
import { createInMemoryWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue } from "../workers/agent-runner.js";

const now = new Date("2026-06-10T00:00:00.000Z");
const clientToken = "cuu-r3-local-client-token";
const owner: UserAuthRow = {
  id: defaultSeedIds.adminUserId,
  nickname: "owner",
  cookieToken: "cuu-r3-cookie-token",
  preferredLocale: "zh-CN",
  availabilityStatus: "free",
  availabilityText: null,
  availabilityUpdatedAt: null,
  isAdmin: true,
  deletedAt: null,
  createdAt: now,
  updatedAt: now
};
const clientDevice: ClientDeviceAuthRow = {
  id: "30000000-0000-4000-8000-000000000301",
  userId: owner.id,
  deviceName: "Cuu R3 smoke",
  clientTokenHash: hashClientToken(clientToken),
  platform: "desktop-webview",
  lastSeenAt: now,
  revokedAt: null,
  createdAt: now,
  updatedAt: now
};

function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof HTTPException) {
      return c.json(
        { ok: false, error: { code: "http_error", message: error.message } },
        error.status as 400
      );
    }
    return c.json(
      { ok: false, error: { code: "internal_error", message: error instanceof Error ? error.message : String(error) } },
      500
    );
  });
  return app;
}

function createAuth(settingsOverride: Settings = settings): AuthDependencies {
  return {
    settings: settingsOverride,
    users: {
      async findActiveById(id) {
        return id === owner.id ? owner : null;
      },
      async findActiveByCookieToken(cookieToken) {
        return cookieToken === owner.cookieToken ? owner : null;
      },
      async findActiveByNickname(nickname) {
        return nickname === owner.nickname ? owner : null;
      },
      async createUser() {
        return owner;
      },
      async getOrCreateActiveByNickname() {
        return { user: owner, created: false };
      },
      async rotateCookieToken() {
        return owner;
      },
      async updatePreferredLocale(_userId, locale) {
        return { ...owner, preferredLocale: locale };
      }
    },
    devices: {
      async findActiveByTokenHash(tokenHash) {
        return tokenHash === clientDevice.clientTokenHash ? clientDevice : null;
      },
      async findActiveByTokenHashForUser(tokenHash, userId) {
        return tokenHash === clientDevice.clientTokenHash && userId === owner.id ? clientDevice : null;
      },
      async createClientDevice() {
        return clientDevice;
      },
      async listByUser(userId) {
        return userId === owner.id ? [clientDevice] : [];
      },
      async touchLastSeen(_deviceId, at) {
        return { ...clientDevice, lastSeenAt: at, updatedAt: at };
      },
      async revokeByIdForUser() {
        return null;
      },
      async revokeByTokenHash() {
        return null;
      }
    }
  };
}

function createSmokeApp() {
  const workItems = createInMemoryWorkItemService({ now: () => now });
  const queue = createInMemoryAgentRunQueue({
    now: () => now,
    id: () => `40000000-0000-4000-8000-${String(nextRunSequence()).padStart(12, "0")}`,
    eventBus: false,
    proposals: false,
    notifications: false,
    confidence: false,
    humanReserved: false,
    persistence: false
  });
  const auth = createAuth();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createSessionRoutes({ auth, workItems }));
  app.route("/api", createWorkItemRoutes({ auth, workItems }));
  app.route("/api", createAgentRunRoutes({ auth, queue, workItems, autoRun: false }));
  return app;
}

let runSequence = 0;
function nextRunSequence() {
  runSequence += 1;
  return runSequence;
}

function selectChip(card: CuuCard, chipId: string): CuuCard {
  const chips = card.chips?.map((chip) => ({ ...chip, selected: chip.id === chipId }));
  return chips ? { ...card, chips } : card;
}

function firstActionHref(card: CuuCard): string {
  const href = card.actions?.[0]?.href;
  if (typeof href !== "string") {
    throw new Error(`Expected card ${card.id} to expose a primary href action.`);
  }
  return href;
}

function assertSessionCard(card: CuuCard) {
  assert.equal(card.payload_ref?.entity_type, "session");
  assert.equal(card.kind, "question");
  assert.ok(card.chips?.length, "Expected Cuu session card to expose option chips.");
}

function assertRunCard(card: CuuCard, run: AgentRunLiveVM) {
  assert.equal(card.payload_ref?.entity_type, "agent_run");
  assert.equal(card.payload_ref?.entity_id, run.run_id);
  assert.equal(card.kind, "trace");
}

async function main() {
  const app = createSmokeApp();
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    return app.request(`${url.pathname}${url.search}`, init);
  };
  const client = createApiClient({
    baseUrl: "http://workhub-cuu-r3-smoke.local",
    fetchFn,
    getClientToken: () => clientToken
  });

  const launcher = selectChip(createDesktopCuuAgentLauncherCard({ locale: "zh-CN" }), "document-draft");
  const launcherAction = resolveDesktopCuuAction(firstActionHref(launcher), {
    actionId: "start_agent_from_cuu",
    card: launcher
  });
  assert.ok(launcherAction, "Expected launcher card to resolve to a desktop Cuu action.");
  assert.equal(launcherAction.kind, "cuu-start-agent");

  const clarification = await submitDesktopCuuAction({
    client,
    action: launcherAction,
    locale: "zh-CN"
  });
  assert.equal(clarification.agentRun, undefined);
  assertSessionCard(clarification.card!);

  const scopeCard = selectChip(clarification.card!, "document-draft");
  const scopeAction = resolveDesktopCuuAction(firstActionHref(scopeCard), {
    actionId: "submit_option",
    card: scopeCard
  });
  assert.ok(scopeAction, "Expected scope question card to resolve to a desktop Cuu action.");
  assert.equal(scopeAction.kind, "session-next-question");

  const confirmation = await submitDesktopCuuAction({
    client,
    action: scopeAction,
    locale: "zh-CN"
  });
  assert.equal(confirmation.agentRun, undefined);
  assertSessionCard(confirmation.card!);
  assert.ok(
    confirmation.card!.chips?.some((chip) => chip.id === "create-workitem"),
    "Expected confirmation card to include create-workitem."
  );

  const confirmCard = selectChip(confirmation.card!, "create-workitem");
  const confirmAction = resolveDesktopCuuAction(firstActionHref(confirmCard), {
    actionId: "submit_option",
    card: confirmCard
  });
  assert.ok(confirmAction, "Expected confirmation card to resolve to a desktop Cuu action.");
  assert.equal(confirmAction.kind, "session-next-question");

  const started = await submitDesktopCuuAction({
    client,
    action: confirmAction,
    locale: "zh-CN"
  });
  assert.ok(started.agentRun, "Expected confirmed Cuu session to start an AgentRun.");
  assertRunCard(started.card!, started.agentRun);

  const apiReadback = await client.getAgentRun(started.agentRun.run_id);
  assert.equal(apiReadback.run_id, started.agentRun.run_id);
  assert.equal(apiReadback.status, "queued");
  assert.ok(apiReadback.stream_href.includes(started.agentRun.run_id));

  console.log(JSON.stringify({
    ok: true,
    smoke: "cuu-r3-launcher-to-run",
    auth: "client-token",
    route_stack: ["sessions", "workitems", "agent-runs"],
    cards: {
      launcher: launcher.id,
      clarification: clarification.card?.payload_ref?.entity_type,
      confirmation: confirmation.card?.payload_ref?.entity_type,
      run: started.card?.payload_ref?.entity_type
    },
    run_id: started.agentRun.run_id,
    status: apiReadback.status
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
