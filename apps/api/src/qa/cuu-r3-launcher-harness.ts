import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import type { AgentLoopClient } from "@workhub/agent/loop";
import type { WorkHubApiClient } from "@workhub/api-client";
import { settings, type Settings } from "@workhub/config";
import { cuuLauncherWorkItemSpecSchema, type AgentRunLiveVM, type WorkHubLocale } from "@workhub/contracts";
import { cardFromSessionVm, type CuuCard, type CuuLocaleOptions } from "@workhub/cuu";
import { defaultSeedIds, type ClientDeviceAuthRow, type UserAuthRow } from "@workhub/db";
import { InMemoryPresenceStore, InProcessPushBus } from "../broker/index.js";
import {
  createDesktopCuuAgentLauncherCard,
  resolveDesktopCuuAction,
  submitDesktopCuuAction
} from "../../../desktop-webview/src/desktop-cuu-runtime.js";
import { hashClientToken, type AuthActor, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import { createAgentRunRoutes } from "../routes/agent-runs.js";
import { createPushRoutes } from "../routes/push.js";
import { createAuthRoutes } from "../routes/auth.js";
import { createPageRoutes } from "../routes/pages.js";
import { toAgentRunLiveVm } from "../pages/replay.js";
import { createSessionRoutes } from "../routes/sessions.js";
import { createWorkItemRoutes } from "../routes/workitems.js";
import { createInMemoryWorkItemService } from "../services/work-items.js";
import { createInMemoryAgentRunQueue, type AgentRunQueue } from "../workers/agent-runner.js";

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
  mutedNotificationTypes: [],
  isAdmin: true,
  deletedAt: null,
  deletedByUserId: null,
  createdAt: cuuR3SmokeNow,
  updatedAt: cuuR3SmokeNow
};

export type CuuR3SmokeApp = {
  app: Hono<AuthEnv>;
  workItems: ReturnType<typeof createInMemoryWorkItemService>;
  queue: AgentRunQueue;
};

export type CuuR3RunOutcome = "succeeded" | "failed";
export type CuuR3ApiFault = "none" | "permission-401" | "permission-403" | "stream-offline" | "generic-502";
export type CuuR3ReloadRestoreSeedKind = "reload-session" | "reload-active-run" | "reload-terminal-run";

export type CuuR3SmokeAppOptions = {
  runStream?: boolean;
  runOutcome?: CuuR3RunOutcome;
  apiFault?: CuuR3ApiFault;
  runDelayMs?: number;
  modelDelayMs?: number;
  logRunStream?: boolean;
};

export type CuuR3ReloadRestoreSeedResult = {
  kind: CuuR3ReloadRestoreSeedKind;
  locale: WorkHubLocale;
  restore_state:
    | {
        version: 1;
        entity_type: "session";
        entity_id: string;
        href: string;
        card: CuuCard;
        updated_at_ms: number;
      }
    | {
        version: 1;
        entity_type: "agent_run";
        entity_id: string;
        href: string;
        updated_at_ms: number;
      };
  session_id?: string;
  work_item_id?: string;
  run?: AgentRunLiveVM;
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
  launcher_spec_delivery_kind: string;
  launcher_acceptance_count: number;
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

const cuuR3SmokeActor: AuthActor = {
  kind: "human",
  id: cuuR3SmokeOwner.id,
  label: cuuR3SmokeOwner.nickname,
  userId: cuuR3SmokeOwner.id,
  isAdmin: true,
  orgId: defaultSeedIds.orgId,
  workspaceId: defaultSeedIds.workspaceId
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
  const initialLocale: WorkHubLocale = process.env.WORKHUB_CUU_QA_LOCALE === "en-US" ? "en-US" : "zh-CN";
  let owner: UserAuthRow = { ...cuuR3SmokeOwner, preferredLocale: initialLocale };
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
        owner = { ...owner, preferredLocale: locale, updatedAt: cuuR3SmokeNow };
        return owner;
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

export function createCuuR3SmokeApp(options: CuuR3SmokeAppOptions = {}): CuuR3SmokeApp {
  let runSequence = 0;
  const runOutcome = options.runOutcome ?? "succeeded";
  const apiFault = options.apiFault ?? "none";
  const nextRunSequence = () => {
    runSequence += 1;
    return runSequence;
  };
  const workItems = createInMemoryWorkItemService({ now: () => cuuR3SmokeNow });
  const pushBus = new InProcessPushBus();
  const baseQueue = createInMemoryAgentRunQueue({
    now: () => cuuR3SmokeNow,
    id: () => `40000000-0000-4000-8000-${String(nextRunSequence()).padStart(12, "0")}`,
    ...(options.runStream
      ? {
          workdir: () => mkdtemp(path.join(os.tmpdir(), "workhub-cuu-r3-run-stream-")),
          client: () => cuuR3RunStreamAgentClient({
            delayMs: options.modelDelayMs ?? 650,
            outcome: runOutcome
          }),
          snapshot: () => ({ snapshotId: "60000000-0000-4000-8000-000000000312" }),
          eventBus: pushBus
        }
      : {
          eventBus: false
        }),
    proposals: false,
    notifications: false,
    confidence: false,
    humanReserved: false,
    persistence: false
  });
  const queue = options.runStream
    ? withDelayedRunExecution(baseQueue, options.runDelayMs ?? 900, options.logRunStream === true)
    : baseQueue;
  const auth = createAuth();
  const app = withErrors(new Hono<AuthEnv>());
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      service: options.runStream ? "workhub-cuu-r3-tauri-run-stream" : "workhub-cuu-r3-smoke",
      run_outcome: options.runStream ? runOutcome : undefined,
      api_fault: apiFault,
      runtime: "node-hono",
      port: 0
    })
  );
  app.post("/api/qa/cuu-r3-restore-seed", async (c) => {
    const payload = await c.req.json().catch(() => ({})) as { kind?: unknown; locale?: unknown };
    const kind = cuuR3ReloadRestoreSeedKind(payload.kind);
    const locale = payload.locale === "en-US" ? "en-US" : "zh-CN";
    const data = await createCuuR3ReloadRestoreSeed({
      kind,
      locale,
      workItems,
      queue: baseQueue,
      runDelayMs: options.runDelayMs ?? 900,
      logRunStream: options.logRunStream === true
    });
    return c.json({ ok: true, data });
  });
  app.use("/api/*", async (c, next) => {
    const fault = cuuR3ApiFaultForRequest(apiFault, c.req.method, new URL(c.req.url).pathname);
    if (fault) {
      return c.json(fault.body, fault.status as 400);
    }
    return next();
  });
  if (options.runStream) {
    app.route("/api/push", createPushRoutes({
      auth,
      bus: pushBus,
      presence: new InMemoryPresenceStore(),
      agentRuns: queue,
      workItems,
      proposals: false,
      stream: { heartbeatMs: 250 }
    }));
  }
  app.route("/api/auth", createAuthRoutes(auth));
  app.route("/api/pages", createPageRoutes({
    auth,
    queue,
    workItems,
    allowUnauthenticatedGoldPath: true
  }));
  app.route("/api", createSessionRoutes({ auth, workItems }));
  app.route("/api", createWorkItemRoutes({ auth, workItems }));
  app.route("/api", createAgentRunRoutes({ auth, queue, workItems, autoRun: false }));
  return { app, workItems, queue };
}

function cuuR3ReloadRestoreSeedKind(value: unknown): CuuR3ReloadRestoreSeedKind {
  return value === "reload-session" || value === "reload-active-run" || value === "reload-terminal-run"
    ? value
    : "reload-session";
}

async function createCuuR3ReloadRestoreSeed(input: {
  kind: CuuR3ReloadRestoreSeedKind;
  locale: WorkHubLocale;
  workItems: ReturnType<typeof createInMemoryWorkItemService>;
  queue: AgentRunQueue;
  runDelayMs: number;
  logRunStream: boolean;
}): Promise<CuuR3ReloadRestoreSeedResult> {
  const updatedAtMs = cuuR3SmokeNow.getTime();
  if (input.kind === "reload-session") {
    const session = await input.workItems.createSession({
      actor: cuuR3SmokeActor,
      payload: {
        title: input.locale === "en-US"
          ? "Cuu reload session restore QA task"
          : "Cuu reload session 恢复验收任务",
        intent_text: input.locale === "en-US"
          ? "Restore the option-first session card after the Tauri pet window reloads."
          : "Tauri pet window 重载后恢复 option-first 澄清卡。"
      }
    });
    const card = cardFromSessionVm(session, { locale: input.locale });
    return {
      kind: input.kind,
      locale: input.locale,
      session_id: session.session_id,
      ...(session.work_item_id ? { work_item_id: session.work_item_id } : {}),
      restore_state: {
        version: 1,
        entity_type: "session",
        entity_id: session.session_id,
        href: session.next_question_href,
        card,
        updated_at_ms: updatedAtMs
      }
    };
  }

  const detail = await input.workItems.createWorkItem({
    actor: cuuR3SmokeActor,
    payload: {
      title: input.locale === "en-US"
        ? "Cuu reload run restore QA task with a deliberately long English title"
        : "Cuu reload run 恢复验收任务",
      raw_description: input.locale === "en-US"
        ? "The restored card must keep Run progress, Budget, actions, and long copy inside the Cuu bubble."
        : "恢复后的卡片必须让执行进度、预算、按钮和长文案留在 Cuu 气泡边界内。",
      selected_option_ids: ["document-draft"],
      kickoff_agent: true
    }
  });
  const run = await input.queue.enqueue({
    workItemId: detail.workitem.id,
    actorId: cuuR3SmokeOwner.id,
    title: input.locale === "en-US"
      ? "Cuu reload restored active run with long English progress copy"
      : "Cuu reload 恢复中的执行任务",
    mode: "worker"
  });
  let live = run;
  if (input.kind === "reload-terminal-run") {
    live = await input.queue.run(run.run_id);
  } else {
    setTimeout(() => {
      if (input.logRunStream) {
        console.log(JSON.stringify({ service: "workhub-cuu-r3-run-stream", event: "restore_seed_run_start", run_id: run.run_id }));
      }
      void input.queue.run(run.run_id)
        .then((executed) => {
          if (input.logRunStream) {
            console.log(JSON.stringify({ service: "workhub-cuu-r3-run-stream", event: "restore_seed_run_done", run_id: executed.run_id, status: executed.status }));
          }
        })
        .catch((error) => {
          console.warn("Cuu R3 reload restore seed execution failed", error);
        });
    }, Math.max(0, input.runDelayMs));
  }

  return {
    kind: input.kind,
    locale: input.locale,
    work_item_id: detail.workitem.id,
    run: toAgentRunLiveVm(live),
    restore_state: {
      version: 1,
      entity_type: "agent_run",
      entity_id: live.run_id,
      href: `/agent-runs/${live.run_id}/replay`,
      updated_at_ms: updatedAtMs
    }
  };
}

function cuuR3ApiFaultForRequest(fault: CuuR3ApiFault, method: string, path: string) {
  if (fault === "none") {
    return undefined;
  }
  const methodUpper = method.toUpperCase();
  const isRunRead = methodUpper === "GET" && /^\/api\/agent-runs\/[^/]+$/u.test(path);
  const isRunStream = methodUpper === "GET" && /^\/api\/push\/stream\/run\/[^/]+$/u.test(path);
  if (fault === "permission-401" && isRunRead) {
    return cuuR3ApiFaultResponse(401, "unauthorized", "Cuu R3 QA forced 401 permission failure.");
  }
  if (fault === "permission-403" && isRunRead) {
    return cuuR3ApiFaultResponse(403, "permission_denied", "Cuu R3 QA forced 403 permission failure.");
  }
  if (fault === "stream-offline" && (isRunRead || isRunStream)) {
    return cuuR3ApiFaultResponse(503, "network_unavailable", "Cuu R3 QA forced network unavailable.");
  }
  if (fault === "generic-502" && isRunRead) {
    return cuuR3ApiFaultResponse(502, "provider_failed", "Cuu R3 QA forced generic provider failure with a long diagnostic message.");
  }
  return undefined;
}

function cuuR3ApiFaultResponse(status: 401 | 403 | 502 | 503, code: string, message: string) {
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message
      }
    }
  };
}

function withDelayedRunExecution(queue: AgentRunQueue, delayMs: number, logEvents: boolean): AgentRunQueue {
  const log = (event: string, data: Record<string, unknown>) => {
    if (logEvents) {
      console.log(JSON.stringify({ service: "workhub-cuu-r3-run-stream", event, ...data }));
    }
  };
  return {
    ...queue,
    async enqueue(input) {
      const run = await queue.enqueue(input);
      log("queued", { run_id: run.run_id, delay_ms: delayMs });
      setTimeout(() => {
        log("run_start", { run_id: run.run_id });
        void queue.run(run.run_id)
          .then((executed) => {
            log("run_done", { run_id: executed.run_id, status: executed.status });
          })
          .catch((error) => {
            log("run_error", { run_id: run.run_id, message: error instanceof Error ? error.message : String(error) });
            console.warn("Cuu R3 run-stream QA execution failed", error);
          });
      }, Math.max(0, delayMs));
      return run;
    }
  };
}

function cuuR3RunStreamAgentClient(input: { delayMs: number; outcome: CuuR3RunOutcome }): AgentLoopClient {
  const responses = [
    {
      id: "cuu-r3-run-stream-tool",
      stopReason: "tool_use",
      usage: { inputTokens: 8, outputTokens: 14 },
      usageRecord: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        task: "worker",
        inputTokens: 8,
        outputTokens: 14,
        estimatedCostCny: "0.001",
        source: "agent_step",
        createdAt: cuuR3SmokeNow.toISOString()
      },
      content: [
        {
          type: "tool_use",
          id: "cuu-r3-tool-1",
          name: "write_file",
          input: {
            path: "outputs/cuu-r3-run-stream.md",
            content: "Cuu R3 run-stream QA completed."
          }
        }
      ]
    },
    {
      id: "cuu-r3-run-stream-final",
      stopReason: "end_turn",
      usage: { inputTokens: 6, outputTokens: 10 },
      usageRecord: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        task: "worker",
        inputTokens: 6,
        outputTokens: 10,
        estimatedCostCny: "0.001",
        source: "agent_step",
        createdAt: cuuR3SmokeNow.toISOString()
      },
      content: [{ type: "text", text: "Cuu 已完成桌面 run stream 验收。" }]
    }
  ] satisfies Awaited<ReturnType<AgentLoopClient["messages"]["create"]>>[];

  return {
    model: "deepseek-v4-flash",
    messages: {
      async create(params) {
        await new Promise((resolve) => setTimeout(resolve, input.delayMs));
        if (input.outcome === "failed") {
          throw new Error(
            cuuR3RunStreamPromptLooksEnglish(params)
              ? "Cuu R3 run-failure QA forced provider failure."
              : "Cuu R3 run-failure QA 模拟执行失败。"
          );
        }
        const response = responses.shift();
        if (!response) {
          throw new Error("Cuu R3 run-stream QA client exhausted.");
        }
        if (response.id === "cuu-r3-run-stream-final" && cuuR3RunStreamPromptLooksEnglish(params)) {
          return {
            ...response,
            content: [{ type: "text", text: "Cuu completed the desktop run-stream QA." }]
          };
        }
        return response;
      }
    }
  };
}

function cuuR3RunStreamPromptLooksEnglish(params: Parameters<AgentLoopClient["messages"]["create"]>[0]) {
  return params.messages.some((message) =>
    typeof message.content === "string" && /desktop entry task|workhub item/iu.test(message.content)
  );
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
  const planningNote = workItemReadback.workitem.planning_note ?? "";
  assert.match(planningNote, /^selected_options: document-draft,create-workitem$/mu);
  const launcherSpecLine = planningNote.split("\n").find((line) => line.startsWith("cuu_launcher_spec: "));
  assert.ok(launcherSpecLine, "Expected Cuu launcher spec JSON in planning_note.");
  const launcherSpec = cuuLauncherWorkItemSpecSchema.parse(
    JSON.parse(launcherSpecLine.slice("cuu_launcher_spec: ".length))
  );
  assert.equal(launcherSpec.selected_options[0]?.id, "document-draft");
  assert.equal(launcherSpec.selected_options[0]?.delivery_kind, "document_draft");
  const launcherAcceptanceCount = workItemReadback.acceptance.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const description = (item as { description?: unknown }).description;
    return typeof description === "string" && description.includes("delivery_kind=document_draft");
  }).length;
  assert.equal(launcherAcceptanceCount, 2);

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
    planning_note: workItemReadback.workitem.planning_note ?? null,
    launcher_spec_delivery_kind: launcherSpec.selected_options[0]?.delivery_kind ?? "",
    launcher_acceptance_count: launcherAcceptanceCount,
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
