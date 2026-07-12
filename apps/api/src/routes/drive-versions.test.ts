import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { DrivePageVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "../middleware/auth.js";
import {
  DrivePageServiceError,
  type DrivePageService,
  type DriveVersionHistoryVM
} from "../services/drive-pages.js";
import { createDriveVersionRoutes } from "./drive-versions.js";

// R12 批 6（网盘整合 + git 化）：版本历史列表 + 回滚（追加新版本，不抹历史）两个新路由的路由层测试。
// 服务层（listVersions/rollbackVersion 的鉴权/组装逻辑）在 drive-pages.test.ts 覆盖；这里只钉死
// 路由层的合同：认证前置、uuid 守卫先于服务、query/body 透传、服务返回值原样转发、服务错误原样透传。

const now = new Date("2026-07-12T10:00:00.000Z");
const projectId = "32000000-0000-4000-8000-000000000001";
const itemId = "32000000-0000-4000-8000-000000000002";
const versionId = "32000000-0000-4000-8000-000000000003";
const userId = "32000000-0000-4000-8000-000000000004";

function settings(): Settings {
  return loadSettings({ APP_ENV: "test", COOKIE_SECRET: "r12-batch6-drive-versions-route-secret" });
}

function user(): UserAuthRow {
  return {
    id: userId,
    nickname: "r12-drive-versions-owner",
    cookieToken: "cookie-r12-drive-versions-owner",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    mutedNotificationTypes: [],
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
  async findActiveByCookieToken(token: string) {
    return token === "cookie-r12-drive-versions-owner" ? user() : null;
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

function authDeps(runtimeSettings: Settings): AuthDependencies {
  return {
    users: new MemoryUsers(),
    devices: new MemoryDevices(),
    settings: runtimeSettings,
    now: () => now
  };
}

async function cookie(runtimeSettings: Settings) {
  return generateSignedCookie(COOKIE_NAME, "cookie-r12-drive-versions-owner", runtimeSettings.auth.cookieSecret);
}

function withErrors(app: Hono<AuthEnv>) {
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

function unusedDrivePage(): never {
  throw new Error("not needed");
}

function unusedDriveFile(): never {
  throw new Error("not needed");
}

function versionHistoryVm(): DriveVersionHistoryVM {
  return {
    item_id: itemId,
    filename: "report.md",
    current_version_id: "32000000-0000-4000-8000-000000000005",
    versions: [
      {
        id: "32000000-0000-4000-8000-000000000005",
        version_no: 2,
        filename: "report.md",
        mime: "text/markdown",
        size_bytes: 2048,
        created_at: now.toISOString(),
        created_by_label: "阿曼",
        current: true
      },
      {
        id: versionId,
        version_no: 1,
        filename: "report.md",
        mime: "text/markdown",
        size_bytes: 1024,
        created_at: new Date("2026-07-10T00:00:00.000Z").toISOString(),
        created_by_label: "阿曼",
        current: false,
        restore_href: `/api/drive/projects/${projectId}/items/${itemId}/versions/${versionId}/restore`
      }
    ]
  };
}

function minimalDrivePage(): DrivePageVM {
  return {
    generated_at: now.toISOString(),
    project: { id: projectId, name: "R12 Drive", slug: "r12-drive", status: "active" },
    summary: {
      item_count: 0,
      file_count: 0,
      folder_count: 0,
      deleted_item_count: 0,
      version_count: 0,
      accepted_deliverable_count: 0,
      pending_comment_count: 0,
      operation_count: 0
    },
    can_manage: true,
    items: [],
    deleted_items: [],
    versions: [],
    accepted_deliverables: [],
    comments: [],
    operations: [],
    actions: {}
  };
}

function service(overrides: Partial<DrivePageService> = {}): DrivePageService {
  return {
    async page() {
      return unusedDrivePage();
    },
    async file() {
      return unusedDriveFile();
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async deleteItem() {
      throw new Error("not needed");
    },
    async restoreItem() {
      throw new Error("not needed");
    },
    async createComment(): Promise<never> {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    },
    ...overrides
  };
}

function routeApp(runtimeSettings: Settings, drivePages: DrivePageService) {
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveVersionRoutes({ auth: authDeps(runtimeSettings), drivePages }));
  return app;
}

// —— GET .../versions —— //

test("drive versions route requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async listVersions() {
      throw new Error("anonymous request must not reach the service");
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions`);

  assert.equal(response.status, 401);
});

test("drive versions route 404s a malformed item id before it reaches the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(runtimeSettings, service({
    async listVersions() {
      calls += 1;
      throw new Error("malformed item id must not reach the service");
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/not-a-uuid/versions`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "drive_file_not_found");
  assert.equal(calls, 0);
});

test("drive versions route forwards locale and limit, and returns the service VM verbatim", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async listVersions(input) {
      seen.push(input);
      return versionHistoryVm();
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions?locale=en-US&limit=5`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: versionHistoryVm(), meta: { locale: "en-US" } });
  assert.equal(seen.length, 1);
  const call = seen[0] as { projectId: string; itemId: string; limit?: number; locale?: string };
  assert.equal(call.projectId, projectId);
  assert.equal(call.itemId, itemId);
  assert.equal(call.limit, 5);
  assert.equal(call.locale, "en-US");
});

test("drive versions route ignores a non-positive or malformed limit instead of forwarding garbage", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async listVersions(input) {
      seen.push(input);
      return versionHistoryVm();
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions?limit=-5`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const call = seen[0] as { limit?: number };
  assert.equal(call.limit, undefined);
});

test("drive versions route reports drive_versions_unavailable when the service does not implement it", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service());

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "drive_versions_unavailable");
});

test("drive versions route preserves the service's typed error status and code", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async listVersions() {
      throw new DrivePageServiceError(403, "你没有权限查看这个项目网盘。", "drive_forbidden");
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "drive_forbidden", message: "你没有权限查看这个项目网盘。" }
  });
});

// —— POST .../versions/:versionId/restore (rollback) —— //

test("drive version restore route requires authentication before reaching the service", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async rollbackVersion() {
      throw new Error("anonymous request must not reach the service");
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions/${versionId}/restore`, {
    method: "POST"
  });

  assert.equal(response.status, 401);
});

test("drive version restore route 404s a malformed version id before it reaches the service", async () => {
  const runtimeSettings = settings();
  let calls = 0;
  const app = routeApp(runtimeSettings, service({
    async rollbackVersion() {
      calls += 1;
      throw new Error("malformed version id must not reach the service");
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions/not-a-uuid/restore`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "drive_version_not_found");
  assert.equal(calls, 0);
});

test("drive version restore route forwards the target version id and returns the refreshed drive page", async () => {
  const runtimeSettings = settings();
  const seen: unknown[] = [];
  const app = routeApp(runtimeSettings, service({
    async rollbackVersion(input) {
      seen.push(input);
      return minimalDrivePage();
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions/${versionId}/restore?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: minimalDrivePage(), meta: { locale: "en-US" } });
  assert.equal(seen.length, 1);
  const call = seen[0] as { projectId: string; itemId: string; targetVersionId: string };
  assert.equal(call.projectId, projectId);
  assert.equal(call.itemId, itemId);
  assert.equal(call.targetVersionId, versionId);
});

test("drive version restore route reports drive_versions_unavailable when the service does not implement it", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service());

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions/${versionId}/restore`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "drive_versions_unavailable");
});

test("drive version restore route surfaces the 'already current' conflict from the service verbatim", async () => {
  const runtimeSettings = settings();
  const app = routeApp(runtimeSettings, service({
    async rollbackVersion() {
      throw new DrivePageServiceError(409, "这已经是当前版本，无需找回。", "drive_version_is_current");
    }
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/versions/${versionId}/restore`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { code: "drive_version_is_current", message: "这已经是当前版本，无需找回。" }
  });
});
