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
  DriveAcceptedDeliverableRow,
  DrivePageRows,
  DriveRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { DrivePageVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createPageRoutes } from "./routes/pages.js";
import { createDrivePageService, type DrivePageService } from "./services/drive-pages.js";

const now = new Date("2026-06-11T01:00:00.000Z");
const projectId = "91000000-0000-4000-8000-000000000001";
const folderId = "91000000-0000-4000-8000-000000000002";
const itemId = "91000000-0000-4000-8000-000000000003";
const currentVersionId = "91000000-0000-4000-8000-000000000004";
const previousVersionId = "91000000-0000-4000-8000-000000000005";
const workItemId = "91000000-0000-4000-8000-000000000006";
const proposalId = "91000000-0000-4000-8000-000000000007";
const acceptedChangeId = "91000000-0000-4000-8000-000000000008";
const changeId = "91000000-0000-4000-8000-000000000009";
const userId = "91000000-0000-4000-8000-000000000010";

function projectRow(): DrivePageRows["project"] {
  return {
    id: projectId,
    workspaceId: "91000000-0000-4000-8000-000000000011",
    name: "R5 Workspace",
    slug: "r5-workspace",
    description: null,
    ownerNickname: "owner",
    ownerUserId: userId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 7,
    createdAt: now,
    updatedAt: now
  };
}

function rows(): DrivePageRows {
  const folder = {
    id: folderId,
    projectId,
    parentId: null,
    name: "复盘包",
    kind: "folder",
    currentVersionId: null,
    createdByUserId: userId,
    updatedByUserId: null,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
  const file = {
    id: itemId,
    projectId,
    parentId: folderId,
    name: "客户复盘.md",
    kind: "file",
    currentVersionId,
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
  const currentVersion = {
    id: currentVersionId,
    itemId,
    versionNo: 2,
    filename: "客户复盘.md",
    mime: "text/markdown",
    sizeBytes: 2048,
    storagePath: "drive/r5/current.md",
    sha256: "a".repeat(64),
    parsedText: "正式复盘内容",
    parsedTextPath: null,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const previousVersion = {
    id: previousVersionId,
    itemId,
    versionNo: 1,
    filename: "客户复盘.md",
    mime: "text/markdown",
    sizeBytes: 1024,
    storagePath: "drive/r5/previous.md",
    sha256: "b".repeat(64),
    parsedText: "上一版内容",
    parsedTextPath: null,
    createdByUserId: userId,
    createdAt: new Date("2026-06-10T00:00:00.000Z"),
    updatedAt: new Date("2026-06-10T00:00:00.000Z")
  };
  const accepted: DriveAcceptedDeliverableRow = {
    accepted: {
      id: acceptedChangeId,
      workItemId,
      proposalId,
      branchId: null,
      changeId,
      targetKind: "text_doc",
      targetEntityType: "drive_item",
      targetEntityId: itemId,
      targetPath: "/复盘包/客户复盘.md",
      targetKey: "drive:/复盘包/客户复盘.md",
      changeType: "updated",
      acceptedVersion: 2,
      baseVersionRef: previousVersionId,
      acceptedRef: currentVersionId,
      driveItemId: itemId,
      driveVersionId: currentVersionId,
      sha256Before: "b".repeat(64),
      sha256After: "a".repeat(64),
      previewRefJson: { kind: "text", href: "/preview/current" },
      manifestChangeJson: {
        id: changeId,
        target_kind: "text_doc",
        target_ref: {
          entity_type: "drive_item",
          entity_id: itemId,
          path: "/复盘包/客户复盘.md",
          sha256_after: "a".repeat(64)
        },
        change_type: "updated",
        human_summary: "更新客户复盘",
        machine_summary: { changed_fields: ["body"] }
      },
      supersededAt: null,
      createdAt: now,
      updatedAt: now
    },
    driveItem: file,
    driveVersion: currentVersion
  };
  return {
    project: projectRow(),
    items: [folder, file],
    versions: [currentVersion, previousVersion],
    acceptedDeliverables: [accepted],
    comments: [
      {
        id: "91000000-0000-4000-8000-000000000012",
        projectId,
        folderId,
        authorUserId: userId,
        authorNickname: "PM",
        body: "把这条评论转成后续行动草稿。",
        status: "draft_created",
        llmKind: "task",
        llmReason: "用户请求生成任务",
        draftWorkItemId: workItemId,
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}

function actor() {
  return {
    kind: "human" as const,
    id: userId,
    label: "drive-user",
    userId,
    isAdmin: false,
    orgId: "91000000-0000-4000-8000-000000000013",
    workspaceId: "91000000-0000-4000-8000-000000000011"
  };
}

test("drive page service builds project files, version history, accepted deliverable links, and comment draft state", async () => {
  let seenProjectId: string | undefined;
  const repo: DriveRepository = {
    async readPage(input) {
      seenProjectId = input?.projectId;
      return rows();
    }
  };
  const service = createDrivePageService({ repo, now: () => now });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(seenProjectId, projectId);
  assert.equal(page.project?.name, "R5 Workspace");
  assert.equal(page.summary.item_count, 2);
  assert.equal(page.summary.file_count, 1);
  assert.equal(page.summary.version_count, 2);
  assert.equal(page.summary.accepted_deliverable_count, 1);
  assert.equal(page.items[1]?.path, "/复盘包/客户复盘.md");
  assert.equal(page.items[1]?.current_version?.source, "accepted_deliverable");
  assert.equal(page.items[1]?.accepted_deliverable?.id, acceptedChangeId);
  assert.equal(page.versions[0]?.download_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/download`);
  assert.equal(page.versions[0]?.preview_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/preview`);
  assert.equal(page.versions[0]?.restore_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/restore`);
  assert.equal(page.comments[0]?.folder_path, "/复盘包");
  assert.equal(page.comments[0]?.draft_href, `/api/pages/workitems/${workItemId}`);
});

test("drive page service exposes a no-project empty state instead of throwing", async () => {
  const service = createDrivePageService({
    repo: {
      async readPage() {
        return { project: null, items: [], versions: [], acceptedDeliverables: [], comments: [] };
      }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN" });

  assert.equal(page.empty_state, "no_project");
  assert.equal(page.summary.item_count, 0);
  assert.deepEqual(page.items, []);
});

function user(partial: Partial<UserAuthRow> = {}): UserAuthRow {
  return {
    id: userId,
    nickname: "drive-user",
    cookieToken: "cookie-drive",
    preferredLocale: "zh-CN",
    availabilityStatus: "free",
    availabilityText: null,
    availabilityUpdatedAt: null,
    isAdmin: false,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...partial
  };
}

class MemoryUsers implements UserRepository {
  constructor(private readonly rows: UserAuthRow[]) {}

  async findActiveById(id: string) {
    return this.rows.find((candidate) => candidate.id === id && candidate.deletedAt === null) ?? null;
  }

  async findActiveByCookieToken(cookieToken: string) {
    return this.rows.find((candidate) => candidate.cookieToken === cookieToken && candidate.deletedAt === null) ?? null;
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
    users: new MemoryUsers([user()]),
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
  return generateSignedCookie(COOKIE_NAME, "cookie-drive", runtimeSettings.auth.cookieSecret);
}

function minimalDrivePage(): DrivePageVM {
  return {
    generated_at: now.toISOString(),
    project: {
      id: projectId,
      name: "R5 Workspace",
      slug: "r5-workspace",
      owner_label: "owner",
      status: "active"
    },
    summary: {
      item_count: 0,
      file_count: 0,
      folder_count: 0,
      version_count: 0,
      accepted_deliverable_count: 0,
      pending_comment_count: 0
    },
    items: [],
    versions: [],
    accepted_deliverables: [],
    comments: [],
    actions: {},
    empty_state: "no_drive_items"
  };
}

test("drive page route returns an authenticated bilingual page envelope and forwards project id", async () => {
  const runtimeSettings = settings();
  const calls: { locale?: string; projectId?: string; actorId?: string }[] = [];
  const drivePages: DrivePageService = {
    async page(input) {
      calls.push({
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
      });
      return minimalDrivePage();
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/pages/drive?locale=en-US&project_id=${projectId}`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; meta: { locale: string }; data: DrivePageVM };
  assert.equal(body.ok, true);
  assert.equal(body.meta.locale, "en-US");
  assert.equal(body.data.project?.id, projectId);
  assert.deepEqual(calls, [{ locale: "en-US", projectId, actorId: userId }]);
});
