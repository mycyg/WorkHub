import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import type { WorkItemService } from "./services/work-items.js";

const now = new Date("2026-06-09T00:00:00.000Z");
const userId = "12000000-0000-4000-8000-000000000001";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "workitem-reader",
    cookieToken: "cookie-workitem-reader",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

class MemoryUsers implements UserRepository {
  async findActiveById(id: string) {
    return id === userId ? user() : null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return cookieToken === "cookie-workitem-reader" ? user() : null;
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
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-workitem-reader", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function workItemServiceFor(file: Awaited<ReturnType<WorkItemService["acceptedDeliverableFile"]>>): WorkItemService {
  return {
    async createSession() {
      throw new Error("not needed");
    },
    async nextQuestion() {
      throw new Error("not needed");
    },
    async createWorkItem() {
      throw new Error("not needed");
    },
    async bindEvidence() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async detailPage() {
      throw new Error("not needed");
    },
    async acceptedDeliverableFile() {
      return file;
    }
  };
}

test("accepted deliverable routes download and preview text without exposing storage paths", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-"));
  const content = "R1 accepted deliverable preview body.";
  const storagePath = join(dir, "result.md");
  await writeFile(storagePath, content, "utf8");
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        id: "accepted-1",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: Buffer.byteLength(content),
        storagePath
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request("/api/workitems/work-1/deliverables/accepted-1/preview", { headers });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { data: { text: string; preview_type: string } };
    assert.equal(previewBody.data.preview_type, "text");
    assert.equal(previewBody.data.text, content);
    assert.equal(JSON.stringify(previewBody).includes(dir), false);

    const download = await app.request("/api/workitems/work-1/deliverables/accepted-1/download", { headers });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /result\.md/u);
    assert.equal(await download.text(), content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted deliverable preview rejects non-text files while download remains available", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-"));
  const storagePath = join(dir, "image.png");
  await writeFile(storagePath, "binary-ish", "utf8");
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        id: "accepted-2",
        filename: "image.png",
        mime: "image/png",
        sizeBytes: 10,
        storagePath
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request("/api/workitems/work-1/deliverables/accepted-2/preview", { headers });
    assert.equal(preview.status, 415);

    const download = await app.request("/api/workitems/work-1/deliverables/accepted-2/download", { headers });
    assert.equal(download.status, 200);
    assert.equal(await download.text(), "binary-ish");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted deliverable routes return 404 when the indexed storage file is missing", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-"));
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        id: "accepted-3",
        filename: "missing.md",
        mime: "text/markdown",
        sizeBytes: 100,
        storagePath: join(dir, "missing.md")
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request("/api/workitems/work-1/deliverables/accepted-3/preview", { headers });
    assert.equal(preview.status, 404);

    const download = await app.request("/api/workitems/work-1/deliverables/accepted-3/download", { headers });
    assert.equal(download.status, 404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
