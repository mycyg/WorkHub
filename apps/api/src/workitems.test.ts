import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type { AcceptedDeliverableVM } from "@workhub/contracts";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { jsonObjectMessage, malformedJsonMessage } from "./routes/json-body.js";
import { createWorkItemRoutes } from "./routes/workitems.js";
import { WorkItemServiceError, type WorkItemService } from "./services/work-items.js";

const now = new Date("2026-06-09T00:00:00.000Z");
const userId = "12000000-0000-4000-8000-000000000001";
// R3 routes-layer 加固后路由 uuid 形参会先校验：交付物路径段必须是合法 uuid，否则在到达被 mock 的服务前
// 就以 404 收口。这里用稳定的合法 uuid 作为路径段，让下方各测试继续命中真实处理逻辑（预览/下载/还原）。
const wiPathId = "73000000-0000-4000-8000-000000000001";
const acPathId = "73000000-0000-4000-8000-000000000002";

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "workitem-reader",
    cookieToken: "cookie-workitem-reader",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
    avatarWebp: null,
    avatarUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
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
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof WorkItemServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      const code = error.status === 400 && error.message === malformedJsonMessage
        ? "malformed_json"
        : error.status === 400 && error.message === jsonObjectMessage
          ? "json_object_required"
          : error.status === 400
            ? "bad_request"
            : "http_error";
      return c.json({ ok: false, error: { code, message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

function acceptedDeliverableVm(partial: Partial<AcceptedDeliverableVM> = {}): AcceptedDeliverableVM {
  return {
    id: "72000000-0000-4000-8000-000000000001",
    work_item_id: "72000000-0000-4000-8000-000000000002",
    proposal_id: "72000000-0000-4000-8000-000000000003",
    change_id: "72000000-0000-4000-8000-000000000004",
    target_kind: "delivery",
    target_key: "delivery:/outputs/result.md",
    change_type: "generated",
    accepted_version: 2,
    target_path: "/outputs/result.md",
    filename: "result.md",
    mime: "text/markdown",
    size_bytes: 42,
    download_href: `/api/workitems/${wiPathId}/deliverables/${acPathId}/download`,
    preview_href: `/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`,
    restore_href: `/api/workitems/${wiPathId}/deliverables/${acPathId}/restore`,
    accepted_at: now.toISOString(),
    ...partial
  };
}

function sha256Text(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function workItemServiceFor(input: {
  file: Awaited<ReturnType<WorkItemService["acceptedDeliverableFile"]>>;
  restored?: AcceptedDeliverableVM;
  restoreError?: Error;
}): WorkItemService {
  return {
    async projectNamesForWorkItems() {
      return new Map<string, string>();
    },
    async createSession() {
      throw new Error("not needed");
    },
    async getSession() {
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
    // routes-a-2 fallout: canReadWorkItems is a new required WorkItemService method (R9 批次1-1); this fixture
    // only exercises accepted-deliverable download/restore routes, not approval-center visibility.
    async canReadWorkItems() {
      throw new Error("not needed");
    },
    async assertCanMutateWorkItem() {
      return;
    },
    async assertCanMutateArtifacts() {
      return;
    },
    async acceptedDeliverableFile() {
      return input.file;
    },
    async restoreAcceptedDeliverable() {
      if (input.restoreError) {
        throw input.restoreError;
      }
      return {
        accepted_deliverable: input.restored ?? acceptedDeliverableVm()
      };
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
        file: {
          id: "accepted-1",
          filename: "result.md",
          mime: "text/markdown",
          sizeBytes: Buffer.byteLength(content),
          storagePath
        }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`, { headers });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { data: { text: string; preview_type: string } };
    assert.equal(previewBody.data.preview_type, "text");
    assert.equal(previewBody.data.text, content);
    assert.equal(JSON.stringify(previewBody).includes(dir), false);

    const download = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/download`, { headers });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition") ?? "", /result\.md/u);
    assert.equal(await download.text(), content);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted deliverable preview supports yaml files like Drive preview", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-yaml-"));
  const content = "checks:\n  - id: smoke\n";
  const storagePath = join(dir, "acceptance.yaml");
  await writeFile(storagePath, content, "utf8");
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        file: {
          id: "accepted-yaml",
          filename: "acceptance.yaml",
          mime: "application/yaml",
          sizeBytes: Buffer.byteLength(content),
          storagePath
        }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`, { headers });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { data: { text: string; preview_type: string; download_href: string } };
    assert.equal(previewBody.data.preview_type, "text");
    assert.equal(previewBody.data.text, content);
    assert.equal(previewBody.data.download_href, `/api/workitems/${wiPathId}/deliverables/${acPathId}/download`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findings: download Content-Length comes from the real bytes, not a stale DB sizeBytes", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-"));
  const content = "five!"; // 5 bytes
  const storagePath = join(dir, "result.md");
  await writeFile(storagePath, content, "utf8");
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        file: {
          id: "accepted-1",
          filename: "result.md",
          mime: "text/markdown",
          sizeBytes: 999, // 故意与真实字节数不一致
          storagePath
        }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };
    const download = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/download`, { headers });
    assert.equal(download.status, 200);
    // header 取实际发出的字节数（5），不是过期的 DB sizeBytes（999）。
    assert.equal(download.headers.get("content-length"), String(Buffer.byteLength(content)));
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
        file: {
          id: "accepted-2",
          filename: "image.png",
          mime: "image/png",
          sizeBytes: 10,
          storagePath
        }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`, { headers });
    assert.equal(preview.status, 415);
    assert.deepEqual(await preview.json(), {
      ok: false,
      error: {
        code: "deliverable_preview_unsupported",
        message: "这类正式交付物暂不支持在线预览，请下载查看。"
      }
    });

    const download = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/download`, { headers });
    assert.equal(download.status, 200);
    assert.equal(await download.text(), "binary-ish");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted deliverable routes fall back to complete parsed text when the indexed storage file is missing", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-parsed-"));
  const cachedText = "cached accepted deliverable body";
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        file: {
          id: "accepted-parsed",
          filename: "cached.md",
          mime: "text/markdown",
          sizeBytes: Buffer.byteLength(cachedText),
          storagePath: join(dir, "missing.md"),
          parsedText: cachedText,
          sha256: sha256Text(cachedText)
        } as Awaited<ReturnType<WorkItemService["acceptedDeliverableFile"]>> & { parsedText: string; sha256: string }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`, { headers });
    assert.equal(preview.status, 200);
    const previewBody = await preview.json() as { data: { text: string } };
    assert.equal(previewBody.data.text, cachedText);

    const download = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/download`, { headers });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-length"), String(Buffer.byteLength(cachedText)));
    assert.equal(await download.text(), cachedText);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accepted deliverable preview and download reject incomplete parsed text fallback", async () => {
  const runtimeSettings = settings();
  const dir = await mkdtemp(join(tmpdir(), "workhub-deliverable-parsed-truncated-"));
  const cachedText = "cached accepted deliverable preview only";
  try {
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api", createWorkItemRoutes({
      auth: authDeps(runtimeSettings),
      workItems: workItemServiceFor({
        file: {
          id: "accepted-parsed-truncated",
          filename: "cached.md",
          mime: "text/markdown",
          sizeBytes: Buffer.byteLength(cachedText) + 100,
          storagePath: join(dir, "missing.md"),
          parsedText: cachedText,
          sha256: sha256Text(`${cachedText} full`)
        } as Awaited<ReturnType<WorkItemService["acceptedDeliverableFile"]>> & { parsedText: string; sha256: string }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`, { headers });
    assert.equal(preview.status, 404);
    const previewBody = await preview.json() as { error: { code: string } };
    assert.equal(previewBody.error.code, "deliverable_file_missing");

    const download = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/download`, { headers });
    assert.equal(download.status, 404);
    const downloadBody = await download.json() as { error: { code: string } };
    assert.equal(downloadBody.error.code, "deliverable_file_missing");
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
        file: {
          id: "accepted-3",
          filename: "missing.md",
          mime: "text/markdown",
          sizeBytes: 100,
          storagePath: join(dir, "missing.md")
        }
      })
    }));
    const headers = { Cookie: await cookie(runtimeSettings) };

    const preview = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/preview`, { headers });
    assert.equal(preview.status, 404);
    assert.deepEqual(await preview.json(), {
      ok: false,
      error: {
        code: "deliverable_file_missing",
        message: "正式交付物文件已不存在，请重新生成或查看历史记录。"
      }
    });

    const download = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/download`, { headers });
    assert.equal(download.status, 404);
    assert.deepEqual(await download.json(), {
      ok: false,
      error: {
        code: "deliverable_file_missing",
        message: "正式交付物文件已不存在，请重新生成或查看历史记录。"
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("work item create route returns malformed_json for malformed request bodies", async () => {
  const runtimeSettings = settings();
  let createCalls = 0;
  const service = {
    ...workItemServiceFor({
      file: {
        id: "not-read",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read"
      }
    }),
    async createWorkItem() {
      createCalls += 1;
      throw new Error("service must not be reached for malformed JSON");
    }
  } satisfies WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({ auth: authDeps(runtimeSettings), workItems: service }));

  const response = await app.request("/api/workitems", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "malformed_json",
      message: malformedJsonMessage
    }
  });
  assert.equal(createCalls, 0);
});

test("work item create checks session mutation before unrelated schema errors", async () => {
  const runtimeSettings = settings();
  let createCalls = 0;
  let mutationChecks = 0;
  const service = {
    ...workItemServiceFor({
      file: {
        id: "not-read",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read"
      }
    }),
    async assertCanMutateWorkItem(input: Parameters<WorkItemService["assertCanMutateWorkItem"]>[0]) {
      mutationChecks += 1;
      assert.equal(input.workItemId, wiPathId);
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    },
    async createWorkItem() {
      createCalls += 1;
      throw new Error("service must not finalize a readonly session");
    }
  } satisfies WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({ auth: authDeps(runtimeSettings), workItems: service }));

  const response = await app.request("/api/workitems", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: wiPathId,
      project_id: "not-a-uuid"
    })
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "forbidden",
      message: "你没有权限修改这个事项。"
    }
  });
  assert.equal(mutationChecks, 1);
  assert.equal(createCalls, 0);
});

test("accepted deliverable restore returns the restored current deliverable VM", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({
    auth: authDeps(runtimeSettings),
    workItems: workItemServiceFor({
      file: {
        id: "accepted-restore",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read-by-restore"
      },
      restored: acceptedDeliverableVm({
        id: "72000000-0000-4000-8000-000000000099",
        drive_version_id: "72000000-0000-4000-8000-000000000088"
      })
    })
  }));

  const response = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/restore`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { data: { accepted_deliverable: AcceptedDeliverableVM } };
  assert.equal(body.data.accepted_deliverable.id, "72000000-0000-4000-8000-000000000099");
  assert.equal(body.data.accepted_deliverable.restore_href?.endsWith("/restore"), true);
});

test("accepted deliverable restore reports version conflicts as a business 409", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({
    auth: authDeps(runtimeSettings),
    workItems: workItemServiceFor({
      file: {
        id: "accepted-conflict",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read-by-restore"
      },
      restoreError: new WorkItemServiceError(
        409,
        "deliverable_no_previous_version",
        "这份正式交付物还没有上一版可还原。"
      )
    })
  }));

  const response = await app.request(`/api/workitems/${wiPathId}/deliverables/${acPathId}/restore`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 409);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "deliverable_no_previous_version");
  assert.match(body.error.message, /上一版/u);
});

test("R3 guard: a non-uuid deliverable path id yields 404 (not a 500 from PG 22P02) before hitting the service", async () => {
  const runtimeSettings = settings();
  const app = withErrors(new Hono<AuthEnv>());
  // 服务被命中即抛——证明 uuid 守卫在到达服务（→ DB uuid 列）之前就以 404 短路了。
  const service = {
    ...workItemServiceFor({
      file: {
        id: "should-not-be-reached",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read"
      }
    }),
    async acceptedDeliverableFile() {
      throw new Error("service must not be reached for a malformed uuid path id");
    }
  } satisfies WorkItemService;
  app.route("/api", createWorkItemRoutes({ auth: authDeps(runtimeSettings), workItems: service }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  // 工作项 id 非法 → 404
  const badWorkItem = await app.request(`/api/workitems/not-a-uuid/deliverables/${acPathId}/preview`, { headers });
  assert.equal(badWorkItem.status, 404);

  // acceptedChangeId 非法 → 404
  const badAccepted = await app.request(`/api/workitems/${wiPathId}/deliverables/not-a-uuid/preview`, { headers });
  assert.equal(badAccepted.status, 404);
});

test("R3 guard: evidence binding validates work item path id before parsing the body", async () => {
  const runtimeSettings = settings();
  let bindCalls = 0;
  const service = {
    ...workItemServiceFor({
      file: {
        id: "not-read",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read"
      }
    }),
    async bindEvidence() {
      bindCalls += 1;
      throw new Error("service must not be reached for a malformed work item path id");
    }
  } satisfies WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({ auth: authDeps(runtimeSettings), workItems: service }));

  const response = await app.request("/api/workitems/not-a-uuid/evidence-bindings", {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 404);
  assert.equal(bindCalls, 0);
});

test("evidence binding checks mutation access before parsing the body", async () => {
  const runtimeSettings = settings();
  let bindCalls = 0;
  let genericMutationChecks = 0;
  let artifactMutationChecks = 0;
  const service = {
    ...workItemServiceFor({
      file: {
        id: "not-read",
        filename: "result.md",
        mime: "text/markdown",
        sizeBytes: 42,
        storagePath: "not-read"
      }
    }),
    async assertCanMutateWorkItem() {
      genericMutationChecks += 1;
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项。");
    },
    async assertCanMutateArtifacts() {
      artifactMutationChecks += 1;
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项的正式交付物。");
    },
    async bindEvidence() {
      bindCalls += 1;
      throw new Error("service must not bind evidence for a readonly work item");
    }
  } satisfies WorkItemService;
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api", createWorkItemRoutes({ auth: authDeps(runtimeSettings), workItems: service }));

  const response = await app.request(`/api/workitems/${wiPathId}/evidence-bindings`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "forbidden",
      message: "你没有权限修改这个事项。"
    }
  });
  assert.equal(genericMutationChecks, 1);
  assert.equal(artifactMutationChecks, 0);
  assert.equal(bindCalls, 0);
});
