import assert from "node:assert/strict";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import type { WorkHubApiClient } from "@workhub/api-client";
import { settings, type Settings } from "@workhub/config";
import type { AgentRunLiveVM } from "@workhub/contracts";
import type { CuuCard, CuuLocaleOptions } from "@workhub/cuu";
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

export const cuuR3SmokeNow = new Date("2026-06-10T00:00:00.000Z");
export const cuuR3SmokeClientToken = "cuu-r3-local-client-token";
export const cuuR3SmokeOwner: UserAuthRow = {
  id: defaultSeedIds.adminUserId,
  nickname: "owner",
  cookieToken: "cuu-r3-cookie-token",
  preferredLocale: "zh-CN",
  availabilityStatus: "free",
  availabilityText: null,
  availabilityUpdatedAt: null,
  isAdmin: true,
  deletedAt: null,
  createdAt: cuuR3SmokeNow,
  updatedAt: cuuR3SmokeNow
};

export type CuuR3SmokeApp = {
  app: Hono<AuthEnv>;
  workItems: ReturnType<typeof createInMemoryWorkItemService>;
};

export type CuuR3LauncherSmokeResult = {
  ok: true;
  smoke: "cuu-r3-launcher-to-run";
  auth: "client-token";
  transport: "in-process-hono" | "http-dev-server";
  route_stack: string[];
  cards: {
    launcher: string;
    clarification: string | undefined;
    confirmation: string | undefined;
    run: string | undefined;
  };
  launcher_input: {
    mode: "single_choice";
    option_first: true;
    free_text_enabled: false;
  };
  run_id: string;
  status: AgentRunLiveVM["status"];
  stream_href: string;
  stream_url: string;
  planning_note: string | null;
  api_base_url?: string;
};

const clientDevice: ClientDeviceAuthRow = {
  id: "30000000-0000-4000-8000-000000000301",
  userId: cuuR3SmokeOwner.id,
  deviceName: "Cuu R3 smoke",
  clientTokenHash: hashClientToken(cuuR3SmokeClientToken),
  platform: "desktop-webview",
  lastSeenAt: cuuR3SmokeNow,
  revokedAt: null,
  createdAt: cuuR3SmokeNow,
  updatedAt: cuuR3SmokeNow
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
        return id === cuuR3SmokeOwner.id ? cuuR3SmokeOwner : null;
      },
      async findActiveByCookieToken(cookieToken) {
        return cookieToken === cuuR3SmokeOwner.cookieToken ? cuuR3SmokeOwner : null;
      },
      async findActiveByNickname(nickname) {
        return nickname === cuuR3SmokeOwner.nickname ? cuuR3SmokeOwner : null;
      },
      async createUser() {
        return cuuR3SmokeOwner;
      },
      async getOrCreateActiveByNickname() {
        return { user: cuuR3SmokeOwner, created: false };
      },
      async rotateCookieToken() {
        return cuuR3SmokeOwner;
      },
      async updatePreferredLocale(_userId, locale) {
        return { ...cuuR3SmokeOwner, preferredLocale: locale };
      }
    },
    devices: {
      async findActiveByTokenHash(tokenHash) {
        return tokenHash === clientDevice.clientTokenHash ? clientDevice : null;
      },
      async findActiveByTokenHashForUser(tokenHash, userId) {
        return tokenHash === clientDevice.clientTokenHash && userId === cuuR3SmokeOwner.id ? clientDevice : null;
      },
      async createClientDevice() {
        return clientDevice;
      },
      async listByUser(userId) {
        return userId === cuuR3SmokeOwner.id ? [clientDevice] : [];
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

export function createCuuR3SmokeApp(): CuuR3SmokeApp {
  let runSequence = 0;
  const nextRunSequence = () => {
    runSequence += 1;
    return runSequence;
  };
  const workItems = createInMemoryWorkItemService({ now: () => cuuR3SmokeNow });
  const queue = createInMemoryAgentRunQueue({
    now: () => cuuR3SmokeNow,
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
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: "workhub-cuu-r3-smoke",
      runtime: "node-hono",
      port: 0
    })
  );
  app.route("/api", createSessionRoutes({ auth, workItems }));
  app.route("/api", createWorkItemRoutes({ auth, workItems }));
  app.route("/api", createAgentRunRoutes({ auth, queue, workItems, autoRun: false }));
  return { app, workItems };
}

export async function runCuuR3LauncherToRunSmoke(input: {
  client: WorkHubApiClient;
  workItems: CuuR3SmokeApp["workItems"];
  transport: CuuR3LauncherSmokeResult["transport"];
  apiBaseUrl?: string | undefined;
  locale?: CuuLocaleOptions["locale"] | undefined;
}): Promise<CuuR3LauncherSmokeResult> {
  const locale = input.locale ?? "zh-CN";
  const launcher = selectChip(createDesktopCuuAgentLauncherCard({ locale }), "document-draft");
  assert.deepEqual(launcher.input, {
    mode: "single_choice",
    option_first: true,
    free_text_enabled: false,
    free_text_collapsed_by_default: true
  });

  const launcherAction = resolveDesktopCuuAction(firstActionHref(launcher), {
    actionId: "start_agent_from_cuu",
    card: launcher
  });
  assert.ok(launcherAction, "Expected launcher card to resolve to a desktop Cuu action.");
  assert.equal(launcherAction.kind, "cuu-start-agent");

  const clarification = await submitDesktopCuuAction({
    client: input.client,
    action: launcherAction,
    locale
  });
  assert.equal(clarification.agentRun, undefined);
  assertSessionCard(clarification.card);

  const scopeCard = selectChip(clarification.card, "document-draft");
  const scopeAction = resolveDesktopCuuAction(firstActionHref(scopeCard), {
    actionId: "submit_option",
    card: scopeCard
  });
  assert.ok(scopeAction, "Expected scope question card to resolve to a desktop Cuu action.");
  assert.equal(scopeAction.kind, "session-next-question");

  const confirmation = await submitDesktopCuuAction({
    client: input.client,
    action: scopeAction,
    locale
  });
  assert.equal(confirmation.agentRun, undefined);
  assertSessionCard(confirmation.card);
  assert.ok(
    confirmation.card.chips?.some((chip) => chip.id === "create-workitem"),
    "Expected confirmation card to include create-workitem."
  );

  const confirmCard = selectChip(confirmation.card, "create-workitem");
  const confirmAction = resolveDesktopCuuAction(firstActionHref(confirmCard), {
    actionId: "submit_option",
    card: confirmCard
  });
  assert.ok(confirmAction, "Expected confirmation card to resolve to a desktop Cuu action.");
  assert.equal(confirmAction.kind, "session-next-question");

  const started = await submitDesktopCuuAction({
    client: input.client,
    action: confirmAction,
    locale
  });
  assert.ok(started.agentRun, "Expected confirmed Cuu session to start an AgentRun.");
  assertRunCard(started.card, started.agentRun);

  const apiReadback = await input.client.getAgentRun(started.agentRun.run_id);
  assert.equal(apiReadback.run_id, started.agentRun.run_id);
  assert.equal(apiReadback.status, "queued");
  assert.ok(apiReadback.stream_href.includes(started.agentRun.run_id));
  const streamUrl = input.client.streamUrl(apiReadback.stream_href);
  assert.ok(streamUrl.includes(started.agentRun.run_id));

  const workItemReadback = await input.workItems.detailPage({
    workItemId: started.agentRun.work_item_id,
    actor: {
      kind: "human",
      id: cuuR3SmokeOwner.id,
      label: cuuR3SmokeOwner.nickname,
      userId: cuuR3SmokeOwner.id,
      isAdmin: true,
      orgId: defaultSeedIds.orgId,
      workspaceId: defaultSeedIds.workspaceId
    }
  });
  assert.equal(workItemReadback.workitem.planning_note, "selected_options: document-draft,create-workitem");

  return {
    ok: true,
    smoke: "cuu-r3-launcher-to-run",
    auth: "client-token",
    transport: input.transport,
    route_stack: ["health", "sessions", "workitems", "agent-runs"],
    cards: {
      launcher: launcher.id,
      clarification: clarification.card.payload_ref?.entity_type,
      confirmation: confirmation.card.payload_ref?.entity_type,
      run: started.card?.payload_ref?.entity_type
    },
    launcher_input: {
      mode: "single_choice",
      option_first: true,
      free_text_enabled: false
    },
    run_id: started.agentRun.run_id,
    status: apiReadback.status,
    stream_href: apiReadback.stream_href,
    stream_url: streamUrl,
    planning_note: workItemReadback.workitem.planning_note,
    ...(input.apiBaseUrl ? { api_base_url: input.apiBaseUrl } : {})
  };
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

function assertSessionCard(card: CuuCard | undefined): asserts card is CuuCard {
  assert.ok(card, "Expected Cuu session card.");
  assert.equal(card.payload_ref?.entity_type, "session");
  assert.equal(card.kind, "question");
  assert.ok(card.chips?.length, "Expected Cuu session card to expose option chips.");
}

function assertRunCard(card: CuuCard | undefined, run: AgentRunLiveVM): asserts card is CuuCard {
  assert.ok(card, "Expected Cuu run card.");
  assert.equal(card.payload_ref?.entity_type, "agent_run");
  assert.equal(card.payload_ref?.entity_id, run.run_id);
  assert.equal(card.kind, "trace");
}
