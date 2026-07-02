import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import { loadSettings, type Settings } from "@workhub/config";
import { DriveRepositoryConflictError } from "@workhub/db";
import type {
  ClientDeviceAuthRow,
  ClientDeviceRepository,
  DriveAcceptedDeliverableRow,
  DrivePageRows,
  DriveRepository,
  UserAuthRow,
  UserRepository
} from "@workhub/db";
import type { DeliverableChangeManifest, DrivePageVM, WorkItemDetailVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createDriveRoutes } from "./routes/drive.js";
import { createPageRoutes } from "./routes/pages.js";
import { createDrivePageService, DrivePageServiceError, type DrivePageService } from "./services/drive-pages.js";
import { ProposalServiceError, type StoredProposal } from "./services/proposals.js";
import { WorkItemServiceError } from "./services/work-items.js";

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

function projectRow(): NonNullable<DrivePageRows["project"]> {
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
      projectId: null,
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
      },
      {
        id: "91000000-0000-4000-8000-000000000015",
        projectId,
        folderId,
        authorUserId: userId,
        authorNickname: "PM",
        body: "请转成新的澄清草稿。",
        status: "pending_llm",
        llmKind: "task",
        llmReason: "用户请求生成任务",
        draftWorkItemId: null,
        createdAt: now,
        updatedAt: now
      }
    ],
    deletedItems: [],
    commentProposals: [],
    operations: [
      {
        id: "91000000-0000-4000-8000-000000000014",
        projectId,
        actorUserId: userId,
        opType: "upload_file",
        payloadJson: {
          drive_item_id: itemId,
          path: "/复盘包/客户复盘.md"
        },
        undoneAt: null,
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

function workItemDetail(partial: Partial<WorkItemDetailVM> = {}): WorkItemDetailVM {
  return {
    workitem: {
      id: workItemId,
      code: "R5-7",
      project_id: projectId,
      submitter_user_id: userId,
      title: "把网盘评论转为提议",
      raw_description: "把这条评论转成后续行动草稿。",
      summary_md: "把这条评论转成后续行动草稿。",
      status: "ai_clarifying",
      priority: "normal",
      sync_state: "synced",
      version: 1,
      mode: "worker",
      human_reserved: false,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    },
    acceptance: [],
    agent_trace_preview: [],
    accepted_deliverables: [],
    evidence_refs: [],
    source_context: {
      source_type: "drive_comment",
      project_id: projectId,
      comment_id: "91000000-0000-4000-8000-000000000012",
      folder_id: folderId,
      folder_path: "/复盘包",
      author_label: "PM",
      body: "把这条评论转成后续行动草稿。",
      status: "draft_created",
      created_at: now.toISOString()
    },
    actions: {
      create_proposal_draft: {
        id: "drive_draft_to_proposal",
        label: "生成变更提议",
        method: "POST",
        href: `/api/drive/workitems/${workItemId}/proposal-draft`
      }
    },
    ...partial
  };
}

function proposalManifest(input: { id?: string; workItemId?: string } = {}): DeliverableChangeManifest {
  return {
    version: 0,
    proposal_id: input.id ?? proposalId,
    work_item_id: input.workItemId ?? workItemId,
    branch_id: "91000000-0000-4000-8000-000000000099",
    title: "Drive draft proposal",
    summary_md: "Create a reviewable proposal from a Drive comment.",
    author: {
      actor_kind: "human",
      actor_user_id: userId,
      label: "drive-user"
    },
    base: {
      created_at: now.toISOString()
    },
    changes: [
      {
        id: changeId,
        target_kind: "text_doc",
        target_ref: {
          entity_type: "delivery",
          path: "/outputs/复盘包/drive-comment-R5-7.md"
        },
        change_type: "generated",
        human_summary: "Generate a proposal draft from the Drive comment."
      }
    ],
    checks: [
      {
        id: "drive_comment_source",
        label: "Drive comment source is attached",
        status: "passed"
      }
    ],
    evidence_refs: [
      {
        id: "91000000-0000-4000-8000-000000000098",
        source_type: "comment",
        source_id: "91000000-0000-4000-8000-000000000012",
        title: "Drive comment",
        confidence_hint: "found"
      }
    ],
    risk: {
      level: "low",
      human_label: "Preview-only proposal",
      reversible: true
    },
    rollback: {
      available: true,
      description: "Discard the proposal."
    },
    review: {
      suggested_decision: "needs_human",
      reason_required_on_reject: true
    }
  };
}

function storedProposalFromManifest(manifest: DeliverableChangeManifest): StoredProposal {
  return {
    id: manifest.proposal_id ?? proposalId,
    work_item_id: manifest.work_item_id,
    branch_id: manifest.branch_id ?? "91000000-0000-4000-8000-000000000099",
    round: 1,
    title: manifest.title,
    status: "opened",
    diff_manifest: manifest,
    opened_by_kind: "human",
    opened_by_user_id: userId,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    reviews: []
  };
}

test("drive page service scopes the default-project lookup to the actor's workspace (M8)", async () => {
  let seenWorkspaceId: string | undefined;
  let seenProjectId: string | undefined;
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      seenWorkspaceId = input?.workspaceId;
      seenProjectId = input?.projectId;
      return rows();
    },
    async uploadFile() { throw new Error("not needed"); },
    async softDeleteItem() { throw new Error("not needed"); },
    async restoreDeletedItem() { throw new Error("not needed"); },
    async commentToDraft() { throw new Error("not needed"); },
    async recordDraftProposal() { throw new Error("not needed"); }
  };
  const service = createDrivePageService({ repo, now: () => now });

  // 不传 projectId：默认项目挑选必须限定到 actor 的 workspace，不能全库取最老项目。
  await service.page({ actor: actor(), locale: "en-US" });
  assert.equal(seenProjectId, undefined);
  assert.equal(seenWorkspaceId, actor().workspaceId);
});

test("drive page service builds project files, version history, accepted deliverable links, and comment draft state", async () => {
  let seenProjectId: string | undefined;
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      seenProjectId = input?.projectId;
      return rows();
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async softDeleteItem() {
      throw new Error("not needed");
    },
    async restoreDeletedItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async recordDraftProposal() {
      throw new Error("not needed");
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
  assert.equal(page.summary.operation_count, 1);
  assert.equal(page.items[1]?.path, "/复盘包/客户复盘.md");
  assert.equal(page.items[1]?.current_version?.source, "accepted_deliverable");
  assert.equal(page.items[1]?.accepted_deliverable?.id, acceptedChangeId);
  assert.equal(page.versions[0]?.download_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/download`);
  assert.equal(page.versions[0]?.preview_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/preview`);
  assert.equal(page.versions[0]?.restore_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/restore`);
  assert.equal(page.comments[0]?.folder_path, "/复盘包");
  assert.equal(page.comments[0]?.draft_href, `/workitems/${workItemId}`);
  assert.equal(page.comments[1]?.draft_action?.href, `/api/drive/projects/${projectId}/comments/91000000-0000-4000-8000-000000000015/draft`);
  assert.equal(page.actions.comment_to_draft?.href, page.comments[1]?.draft_action?.href);
  assert.equal(page.actions.upload_file?.label, "Upload file");
  assert.equal(page.operations[0]?.target_path, "/复盘包/客户复盘.md");
  assert.equal(page.operations[0]?.op_type, "upload_file");
});

test("drive page service surfaces proposal links for comment-created drafts", async () => {
  const pageRows = rows();
  pageRows.comments[0]!.status = "proposal_created";
  pageRows.commentProposals.push({
    id: proposalId,
    workItemId,
    branchId: "91000000-0000-4000-8000-000000000099",
    round: 1,
    title: "Drive draft proposal",
    status: "opened",
    diffManifest: proposalManifest(),
    confidenceId: null,
    mergeSnapshotId: null,
    openedByKind: "human",
    openedByUserId: userId,
    reviewedAt: null,
    mergedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(page.comments[0]?.status, "proposal_created");
  assert.equal(page.comments[0]?.proposal_id, proposalId);
  assert.equal(page.comments[0]?.proposal_href, `/proposals/${proposalId}`);
  assert.equal(page.comments[0]?.proposal_status, "opened");
});

test("drive page service uses superseded accepted rows only for historical version source labels", async () => {
  const pageRows = rows();
  pageRows.acceptedDeliverables.push({
    accepted: {
      ...pageRows.acceptedDeliverables[0]!.accepted,
      id: "91000000-0000-4000-8000-0000000000ac",
      acceptedVersion: 1,
      acceptedRef: previousVersionId,
      driveVersionId: previousVersionId,
      sha256After: "b".repeat(64),
      supersededAt: new Date("2026-06-11T00:30:00.000Z"),
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-11T00:30:00.000Z")
    },
    driveItem: pageRows.items[1]!,
    driveVersion: pageRows.versions[1]!
  });
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });
  const previousVersion = page.versions.find((version) => version.id === previousVersionId);

  assert.equal(page.summary.accepted_deliverable_count, 1);
  assert.deepEqual(page.accepted_deliverables.map((accepted) => accepted.id), [acceptedChangeId]);
  assert.equal(previousVersion?.source, "accepted_deliverable");
  assert.equal(previousVersion?.accepted_deliverable_id, "91000000-0000-4000-8000-0000000000ac");
  assert.equal(previousVersion?.restore_href, undefined);
});

test("drive page service marks restored versions with the current accepted row instead of a superseded duplicate", async () => {
  const pageRows = rows();
  const restoredCurrentAcceptedId = "91000000-0000-4000-8000-0000000000ad";
  const supersededDuplicateAcceptedId = "91000000-0000-4000-8000-0000000000ae";
  const restoredCurrent: DriveAcceptedDeliverableRow = {
    accepted: {
      ...pageRows.acceptedDeliverables[0]!.accepted,
      id: restoredCurrentAcceptedId,
      acceptedVersion: 3,
      acceptedRef: previousVersionId,
      driveVersionId: previousVersionId,
      sha256After: "b".repeat(64),
      supersededAt: null,
      createdAt: new Date("2026-06-11T00:40:00.000Z"),
      updatedAt: new Date("2026-06-11T00:40:00.000Z")
    },
    driveItem: pageRows.items[1]!,
    driveVersion: pageRows.versions[1]!
  };
  const supersededDuplicate: DriveAcceptedDeliverableRow = {
    accepted: {
      ...restoredCurrent.accepted,
      id: supersededDuplicateAcceptedId,
      acceptedVersion: 1,
      supersededAt: new Date("2026-06-11T00:30:00.000Z"),
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-11T00:30:00.000Z")
    },
    driveItem: pageRows.items[1]!,
    driveVersion: pageRows.versions[1]!
  };
  pageRows.acceptedDeliverables = [restoredCurrent, supersededDuplicate];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });
  const previousVersion = page.versions.find((version) => version.id === previousVersionId);

  assert.deepEqual(page.accepted_deliverables.map((accepted) => accepted.id), [restoredCurrentAcceptedId]);
  assert.equal(previousVersion?.accepted_deliverable_id, restoredCurrentAcceptedId);
  assert.equal(previousVersion?.restore_href, `/api/workitems/${workItemId}/deliverables/${restoredCurrentAcceptedId}/restore`);
});

test("drive page service hides draft, proposal, and accepted-deliverable links when the actor cannot open the backing work item", async () => {
  const pageRows = rows();
  pageRows.comments[0]!.status = "proposal_created";
  pageRows.commentProposals.push({
    id: proposalId,
    workItemId,
    branchId: "91000000-0000-4000-8000-000000000099",
    round: 1,
    title: "Drive draft proposal",
    status: "opened",
    diffManifest: proposalManifest(),
    confidenceId: null,
    mergeSnapshotId: null,
    openedByKind: "human",
    openedByUserId: userId,
    reviewedAt: null,
    mergedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "ai_clarifying",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(page.comments[0]?.draft_work_item_id, workItemId);
  assert.equal(page.comments[0]?.draft_href, undefined);
  assert.equal(page.comments[0]?.proposal_id, undefined);
  assert.equal(page.comments[0]?.proposal_href, undefined);
  assert.equal(page.comments[0]?.proposal_status, undefined);
  assert.equal(page.accepted_deliverables.length, 0);
  assert.equal(page.versions[0]?.download_href, undefined);
  assert.equal(page.versions[0]?.preview_href, undefined);
  assert.equal(page.versions[0]?.restore_href, undefined);
  assert.equal(page.items[1]?.accepted_deliverable, undefined);
  assert.equal(page.items[1]?.download_href, undefined);
  assert.equal(page.items[1]?.preview_href, undefined);
});

test("drive page service hides unreadable accepted deliverable rows without exposing ordinary file downloads", async () => {
  const pageRows = rows();
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "ai_clarifying",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(page.accepted_deliverables.length, 0);
  assert.equal(page.summary.accepted_deliverable_count, 0);
  assert.equal(page.items[1]?.accepted_deliverable, undefined);
  assert.equal(page.items[1]?.download_href, undefined);
  assert.equal(page.items[1]?.preview_href, undefined);
  assert.equal(page.items[1]?.delete_href, undefined);
  assert.notEqual(page.actions.delete_item?.href, `/api/drive/projects/${projectId}/items/${itemId}/delete`);
});

test("drive page service blocks direct file reads for unreadable accepted deliverables", async () => {
  const pageRows = rows();
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      assert.equal(input?.projectId, projectId);
      assert.equal(input?.targetItemId, itemId);
      return pageRows;
    },
    async readFile(input) {
      assert.deepEqual(input, { projectId, itemId });
      return {
        project: pageRows.project,
        item: pageRows.items[1] ?? null,
        version: pageRows.versions[0] ?? null
      };
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async softDeleteItem() {
      throw new Error("not needed");
    },
    async restoreDeletedItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async recordDraftProposal() {
      throw new Error("not needed");
    }
  };
  const service = createDrivePageService({
    repo,
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "ai_clarifying",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  await assert.rejects(
    () => service.file({ actor: actor(), projectId, itemId }),
    (error) => error instanceof DrivePageServiceError
      && error.status === 403
      && error.code === "drive_forbidden"
  );
});

test("drive page service checks direct file reads against the current accepted version only", async () => {
  const pageRows = rows();
  const readableOldWorkItemId = "91000000-0000-4000-8000-0000000000aa";
  const currentAccepted = pageRows.acceptedDeliverables[0]!;
  const oldAccepted: DriveAcceptedDeliverableRow = {
    accepted: {
      ...currentAccepted.accepted,
      id: "91000000-0000-4000-8000-0000000000ab",
      workItemId: readableOldWorkItemId,
      acceptedVersion: 1,
      baseVersionRef: null,
      acceptedRef: previousVersionId,
      driveVersionId: previousVersionId,
      sha256Before: null,
      sha256After: "b".repeat(64),
      createdAt: new Date("2026-06-10T00:00:00.000Z"),
      updatedAt: new Date("2026-06-10T00:00:00.000Z")
    },
    driveItem: currentAccepted.driveItem,
    driveVersion: pageRows.versions[1] ?? null
  };
  pageRows.acceptedDeliverables = [currentAccepted, oldAccepted];
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      assert.equal(input?.projectId, projectId);
      assert.equal(input?.targetItemId, itemId);
      return pageRows;
    },
    async readFile(input) {
      assert.deepEqual(input, { projectId, itemId });
      return {
        project: pageRows.project,
        item: pageRows.items[1] ?? null,
        version: pageRows.versions[0] ?? null
      };
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async softDeleteItem() {
      throw new Error("not needed");
    },
    async restoreDeletedItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async recordDraftProposal() {
      throw new Error("not needed");
    }
  };
  const service = createDrivePageService({
    repo,
    workItemAccess: {
      async findWorkItemAccessRecord(id: string) {
        if (id === readableOldWorkItemId) {
          return {
            id,
            status: "in_review",
            submitterUserId: userId,
            claimedByUserId: null,
            workspaceId: actor().workspaceId,
            project: {
              archived: false,
              deletedAt: null,
              ownerUserId: userId,
              workspaceId: actor().workspaceId
            },
            assignments: []
          };
        }
        return {
          id,
          status: "spec_ready",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  await assert.rejects(
    () => service.file({ actor: actor(), projectId, itemId }),
    (error) => error instanceof DrivePageServiceError
      && error.status === 403
      && error.code === "drive_forbidden"
  );
});

test("drive page service keeps backing work item links for claimed private work in the actor workspace", async () => {
  const pageRows = rows();
  pageRows.comments[0]!.status = "proposal_created";
  pageRows.commentProposals.push({
    id: proposalId,
    workItemId,
    branchId: "91000000-0000-4000-8000-000000000099",
    round: 1,
    title: "Drive draft proposal",
    status: "opened",
    diffManifest: proposalManifest(),
    confidenceId: null,
    mergeSnapshotId: null,
    openedByKind: "human",
    openedByUserId: userId,
    reviewedAt: null,
    mergedAt: null,
    createdAt: now,
    updatedAt: now
  });
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "spec_ready",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: userId,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(page.comments[0]?.draft_href, `/workitems/${workItemId}`);
  assert.equal(page.comments[0]?.proposal_id, proposalId);
  assert.equal(page.comments[0]?.proposal_href, `/proposals/${proposalId}`);
  assert.equal(page.accepted_deliverables[0]?.download_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/download`);
  assert.equal(page.accepted_deliverables[0]?.preview_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/preview`);
  assert.equal(page.accepted_deliverables[0]?.restore_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/restore`);
});

test("drive page service hides accepted-deliverable restore links when the actor can read but cannot mutate the backing work item", async () => {
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return rows();
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "in_review",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: []
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(page.accepted_deliverables[0]?.download_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/download`);
  assert.equal(page.accepted_deliverables[0]?.preview_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/preview`);
  assert.equal(page.accepted_deliverables[0]?.restore_href, undefined);
  assert.equal(page.versions[0]?.download_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/download`);
  assert.equal(page.versions[0]?.restore_href, undefined);
  assert.equal(page.items[1]?.accepted_deliverable?.restore_href, undefined);
});

test("drive page service shows accepted-deliverable restore links for assigned leads", async () => {
  const pageRows = rows();
  pageRows.project = {
    ...pageRows.project!,
    ownerUserId: "91000000-0000-4000-8000-00000000feed"
  };
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    workItemAccess: {
      async findWorkItemAccessRecord() {
        return {
          id: workItemId,
          status: "spec_ready",
          submitterUserId: "91000000-0000-4000-8000-00000000beef",
          claimedByUserId: null,
          workspaceId: actor().workspaceId,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: "91000000-0000-4000-8000-00000000feed",
            workspaceId: actor().workspaceId
          },
          assignments: [{ userId, role: "lead" }]
        };
      }
    },
    now: () => now
  } as Parameters<typeof createDrivePageService>[0] & { workItemAccess: unknown });

  const page = await service.page({ actor: actor(), locale: "en-US", projectId });

  assert.equal(page.accepted_deliverables[0]?.restore_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/restore`);
  assert.equal(page.versions[0]?.restore_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/restore`);
  assert.equal(page.items[1]?.accepted_deliverable?.restore_href, `/api/workitems/${workItemId}/deliverables/${acceptedChangeId}/restore`);
});

test("drive page service targets the latest manual file for recycle actions", async () => {
  const manualItemId = "91000000-0000-4000-8000-000000000015";
  const manualVersionId = "91000000-0000-4000-8000-000000000016";
  const manualUpdatedAt = new Date("2026-06-11T02:00:00.000Z");
  const pageRows = rows();
  pageRows.items.push({
    id: manualItemId,
    projectId,
    parentId: folderId,
    name: "manual-note.md",
    kind: "file" as const,
    currentVersionId: manualVersionId,
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: manualUpdatedAt,
    updatedAt: manualUpdatedAt
  });
  pageRows.versions.unshift({
    id: manualVersionId,
    itemId: manualItemId,
    versionNo: 1,
    filename: "manual-note.md",
    mime: "text/markdown",
    sizeBytes: 128,
    storagePath: "drive/r5/manual-note.md",
    sha256: null,
    parsedText: "手工上传",
    parsedTextPath: null,
    createdByUserId: userId,
    createdAt: manualUpdatedAt,
    updatedAt: manualUpdatedAt
  });
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });

  assert.equal(page.selected_item_id, manualItemId);
  assert.equal(page.actions.delete_item?.href, `/api/drive/projects/${projectId}/items/${manualItemId}/delete`);
  assert.equal(page.actions.delete_item?.label.includes("manual-note.md"), true);
  // F3：可删项各自带 delete_href(逐行删除按钮),不只一个全局按钮指向单个 deletable。
  const manualVm = page.items.find((item) => item.id === manualItemId);
  assert.equal(manualVm?.delete_href, `/api/drive/projects/${projectId}/items/${manualItemId}/delete`);
  assert.equal(
    (manualVm as { preview_href?: string } | undefined)?.preview_href,
    `/api/drive/projects/${projectId}/items/${manualItemId}/preview`
  );
  assert.equal(
    (manualVm as { download_href?: string } | undefined)?.download_href,
    `/api/drive/projects/${projectId}/items/${manualItemId}/download`
  );
});

test("drive page service returns an upload refresh focused on the created file", async () => {
  const uploadedItemId = "91000000-0000-4000-8000-0000000000c1";
  const uploadedVersionId = "91000000-0000-4000-8000-0000000000c2";
  const pageRows = rows();
  const uploadedItem = {
    ...pageRows.items[1]!,
    id: uploadedItemId,
    parentId: null,
    name: "刚上传.md",
    currentVersionId: uploadedVersionId,
    updatedAt: new Date("2026-06-11T01:01:00.000Z")
  };
  const uploadedVersion = {
    ...pageRows.versions[0]!,
    id: uploadedVersionId,
    itemId: uploadedItemId,
    filename: "刚上传.md",
    parsedText: "刚上传的内容",
    createdAt: new Date("2026-06-11T01:01:00.000Z")
  };
  let readInputAfterUpload: Parameters<DriveRepository["readPage"]>[0] | undefined;
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      readInputAfterUpload = input;
      return input?.targetItemId === uploadedItemId
        ? { ...pageRows, items: [uploadedItem], versions: [uploadedVersion] }
        : pageRows;
    },
    async uploadFile() {
      return {
        item: uploadedItem as DrivePageRows["items"][number],
        version: uploadedVersion as DrivePageRows["versions"][number],
        operation: pageRows.operations[0]!
      };
    },
    async softDeleteItem() { throw new Error("not needed"); },
    async restoreDeletedItem() { throw new Error("not needed"); },
    async commentToDraft() { throw new Error("not needed"); },
    async recordDraftProposal() { throw new Error("not needed"); }
  };
  const service = createDrivePageService({ repo, now: () => now });

  const page = await service.uploadFile({
    actor: actor(),
    projectId,
    filename: "刚上传.md",
    mime: "text/markdown",
    parsedText: "刚上传的内容"
  });

  assert.equal(readInputAfterUpload?.targetItemId, uploadedItemId);
  assert.equal(page.selected_item_id, uploadedItemId);
  assert.equal(page.items[0]?.name, "刚上传.md");
});

test("drive page service returns a delete refresh with the deleted item in recycle", async () => {
  const deletedItemId = "91000000-0000-4000-8000-0000000000d1";
  const deletedVersionId = "91000000-0000-4000-8000-0000000000d2";
  const pageRows = rows();
  const deletedAt = new Date("2026-06-11T01:02:00.000Z");
  const deletedItem = {
    ...pageRows.items[1]!,
    id: deletedItemId,
    name: "刚删除.md",
    currentVersionId: deletedVersionId,
    deletedAt,
    deletedByUserId: userId,
    updatedAt: deletedAt
  };
  const deletedVersion = {
    ...pageRows.versions[0]!,
    id: deletedVersionId,
    itemId: deletedItemId,
    filename: "刚删除.md",
    parsedText: "刚删除的内容",
    createdAt: deletedAt,
    updatedAt: deletedAt
  };
  const readInputs: Array<Parameters<DriveRepository["readPage"]>[0]> = [];
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      readInputs.push(input);
      return input?.targetItemId === deletedItemId
        ? { ...pageRows, items: [pageRows.items[0]!], versions: [deletedVersion], deletedItems: [deletedItem] }
        : { ...pageRows, deletedItems: [] };
    },
    async uploadFile() { throw new Error("not needed"); },
    async softDeleteItem() {
      return {
        item: deletedItem as DrivePageRows["items"][number],
        version: deletedVersion as DrivePageRows["versions"][number],
        operation: pageRows.operations[0]!
      };
    },
    async restoreDeletedItem() { throw new Error("not needed"); },
    async commentToDraft() { throw new Error("not needed"); },
    async recordDraftProposal() { throw new Error("not needed"); }
  };
  const service = createDrivePageService({ repo, now: () => now });

  const page = await service.deleteItem({ actor: actor(), projectId, itemId: deletedItemId });

  assert.equal(readInputs[readInputs.length - 1]?.targetItemId, deletedItemId);
  assert.equal(page.deleted_items[0]?.id, deletedItemId);
  assert.equal(page.deleted_items[0]?.restore_href, `/api/drive/projects/${projectId}/items/${deletedItemId}/restore`);
});

test("drive page service reports missing delete and restore targets as file-level not-found errors", async () => {
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage() { return rows(); },
    async uploadFile() { throw new Error("not needed"); },
    async softDeleteItem() { return null; },
    async restoreDeletedItem() { return null; },
    async commentToDraft() { throw new Error("not needed"); },
    async recordDraftProposal() { throw new Error("not needed"); }
  };
  const service = createDrivePageService({ repo, now: () => now });

  await assert.rejects(
    () => service.deleteItem({ actor: actor(), projectId, itemId }),
    (error) => error instanceof DrivePageServiceError && error.status === 404 && error.code === "drive_file_not_found"
  );
  await assert.rejects(
    () => service.restoreItem({ actor: actor(), projectId, itemId }),
    (error) => error instanceof DrivePageServiceError && error.status === 404 && error.code === "drive_file_not_found"
  );
});

test("drive page service preserves the selected folder when uploading into a parent folder", async () => {
  const uploadedItemId = "91000000-0000-4000-8000-0000000000c3";
  const uploadedVersionId = "91000000-0000-4000-8000-0000000000c4";
  const pageRows = rows();
  const uploadedItem = {
    ...pageRows.items[1]!,
    id: uploadedItemId,
    parentId: folderId,
    name: "文件夹内上传.md",
    currentVersionId: uploadedVersionId
  };
  const uploadedVersion = {
    ...pageRows.versions[0]!,
    id: uploadedVersionId,
    itemId: uploadedItemId,
    filename: "文件夹内上传.md"
  };
  let seenParentId: string | null | undefined = undefined;
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      return input?.targetItemId === uploadedItemId
        ? { ...pageRows, items: [pageRows.items[0]!, uploadedItem], versions: [uploadedVersion] }
        : pageRows;
    },
    async uploadFile(input) {
      seenParentId = input.parentId;
      return {
        item: uploadedItem as DrivePageRows["items"][number],
        version: uploadedVersion as DrivePageRows["versions"][number],
        operation: pageRows.operations[0]!
      };
    },
    async softDeleteItem() { throw new Error("not needed"); },
    async restoreDeletedItem() { throw new Error("not needed"); },
    async commentToDraft() { throw new Error("not needed"); },
    async recordDraftProposal() { throw new Error("not needed"); }
  };
  const service = createDrivePageService({ repo, now: () => now });
  const uploadInput = {
    actor: actor(),
    projectId,
    parentId: folderId,
    filename: "文件夹内上传.md",
    mime: "text/markdown",
    parsedText: "文件夹内上传"
  };

  const page = await service.uploadFile(uploadInput);

  assert.equal(seenParentId, folderId);
  assert.equal(page.selected_item_id, uploadedItemId);
  assert.equal(page.items.find((item) => item.id === uploadedItemId)?.parent_id, folderId);
});

test("drive page service returns a restore refresh focused on the restored item", async () => {
  const restoredItemId = "91000000-0000-4000-8000-0000000000d1";
  const restoredVersionId = "91000000-0000-4000-8000-0000000000d2";
  const pageRows = rows();
  const deletedItem = {
    ...pageRows.items[1]!,
    id: restoredItemId,
    name: "恢复回来.md",
    currentVersionId: restoredVersionId,
    deletedAt: new Date("2026-06-10T00:00:00.000Z"),
    updatedAt: new Date("2026-06-10T00:00:00.000Z")
  };
  const restoredItem = {
    ...deletedItem,
    deletedAt: null,
    updatedAt: new Date("2026-06-11T01:01:00.000Z")
  };
  const restoredVersion = {
    ...pageRows.versions[0]!,
    id: restoredVersionId,
    itemId: restoredItemId,
    filename: "恢复回来.md"
  };
  let readInputAfterRestore: Parameters<DriveRepository["readPage"]>[0] | undefined;
  const repo: DriveRepository = {
    async listRecentFilesByProject() { return []; },
    async countFilesByProject() { return 0; },
    async readPage(input) {
      readInputAfterRestore = input;
      return input?.targetItemId === restoredItemId
        ? { ...pageRows, items: [restoredItem], versions: [restoredVersion], deletedItems: [] }
        : { ...pageRows, deletedItems: [deletedItem] };
    },
    async uploadFile() { throw new Error("not needed"); },
    async softDeleteItem() { throw new Error("not needed"); },
    async restoreDeletedItem() {
      return {
        item: restoredItem as DrivePageRows["items"][number],
        operation: pageRows.operations[0]!
      };
    },
    async commentToDraft() { throw new Error("not needed"); },
    async recordDraftProposal() { throw new Error("not needed"); }
  };
  const service = createDrivePageService({ repo, now: () => now });

  const page = await service.restoreItem({ actor: actor(), projectId, itemId: restoredItemId });

  assert.equal(readInputAfterRestore?.targetItemId, restoredItemId);
  assert.equal(page.selected_item_id, restoredItemId);
  assert.equal(page.items[0]?.name, "恢复回来.md");
});

test("drive page service reads ordinary file metadata for preview and download routes", async () => {
  const manualItem = {
    id: "91000000-0000-4000-8000-0000000000f1",
    projectId,
    parentId: folderId,
    name: "manual-note.md",
    kind: "file",
    currentVersionId: "91000000-0000-4000-8000-0000000000f2",
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: now,
    updatedAt: now
  };
  const manualVersion = {
    id: "91000000-0000-4000-8000-0000000000f2",
    itemId: manualItem.id,
    versionNo: 1,
    filename: "manual-note.md",
    mime: "text/markdown",
    sizeBytes: 128,
    storagePath: "/tmp/workhub-manual-note.md",
    sha256: null,
    parsedText: "手工上传",
    parsedTextPath: null,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now
  };
  const seen: { projectId: string; itemId: string }[] = [];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readFile(input) {
        seen.push(input);
        return { project: projectRow(), item: manualItem, version: manualVersion };
      },
      async readPage() { return rows(); },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const file = await service.file({ actor: actor(), projectId, itemId: manualItem.id });

  assert.deepEqual(seen, [{ projectId, itemId: manualItem.id }]);
  assert.equal(file.id, manualVersion.id);
  assert.equal(file.itemId, manualItem.id);
  assert.equal(file.filename, "manual-note.md");
  assert.equal(file.mime, "text/markdown");
  assert.equal(file.storagePath, "/tmp/workhub-manual-note.md");
  assert.equal(file.parsedText, "手工上传");
});

test("F3: each recycle-bin item gets its own restore_href (not just deleted_items[0])", async () => {
  const pageRows = rows();
  const deletedAt = "2026-06-14T08:00:00.000Z";
  const mkDeleted = (id: string, name: string) => ({
    id,
    projectId,
    parentId: null,
    name,
    kind: "file" as const,
    currentVersionId: null,
    createdByUserId: userId,
    updatedByUserId: userId,
    deletedAt: new Date(deletedAt),
    deletedByUserId: userId,
    createdAt: now,
    updatedAt: now
  });
  const firstId = "91000000-0000-4000-8000-0000000000d1";
  const secondId = "91000000-0000-4000-8000-0000000000d2";
  pageRows.deletedItems = [mkDeleted(firstId, "first-deleted.md"), mkDeleted(secondId, "second-deleted.md")];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() { return pageRows; },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });
  const byId = new Map(page.deleted_items.map((item) => [item.id, item]));
  assert.equal(page.actions.restore_item, undefined, "restore is row-scoped, not a global first-deleted-item action");
  // Both deleted items are individually restorable — not just the first.
  assert.equal(byId.get(firstId)?.restore_href, `/api/drive/projects/${projectId}/items/${firstId}/restore`);
  assert.equal(byId.get(secondId)?.restore_href, `/api/drive/projects/${projectId}/items/${secondId}/restore`);
});

test("drive page service hides restore links for deleted children whose parent is still deleted", async () => {
  const pageRows = rows();
  const deletedParentId = "91000000-0000-4000-8000-0000000000e1";
  const deletedChildId = "91000000-0000-4000-8000-0000000000e2";
  const deletedAt = new Date("2026-06-14T08:10:00.000Z");
  pageRows.deletedItems = [
    {
      ...pageRows.items[0]!,
      id: deletedParentId,
      name: "已删除文件夹",
      parentId: null,
      deletedAt,
      updatedAt: deletedAt
    },
    {
      ...pageRows.items[1]!,
      id: deletedChildId,
      name: "子文件.md",
      parentId: deletedParentId,
      deletedAt,
      updatedAt: deletedAt
    }
  ];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() { return pageRows; },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });
  const byId = new Map(page.deleted_items.map((item) => [item.id, item]));

  assert.equal(byId.get(deletedParentId)?.restore_href, `/api/drive/projects/${projectId}/items/${deletedParentId}/restore`);
  assert.equal(byId.get(deletedChildId)?.restore_href, undefined);
});

test("drive page service hides restore links when an active sibling already has the deleted item name", async () => {
  const pageRows = rows();
  const deletedItemId = "91000000-0000-4000-8000-0000000000e3";
  const deletedAt = new Date("2026-06-14T08:20:00.000Z");
  pageRows.deletedItems = [{
    ...pageRows.items[1]!,
    id: deletedItemId,
    name: pageRows.items[1]!.name,
    parentId: pageRows.items[1]!.parentId,
    deletedAt,
    updatedAt: deletedAt
  }];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() { return pageRows; },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });

  assert.equal(page.deleted_items[0]?.restore_href, undefined);
});

test("drive page service hides restore links when the repository reports an off-slice active sibling conflict", async () => {
  const pageRows = rows();
  const deletedItemId = "91000000-0000-4000-8000-0000000000e7";
  const deletedAt = new Date("2026-06-14T08:30:00.000Z");
  pageRows.items = pageRows.items.filter((item) => item.name !== "off-slice-conflict.md");
  pageRows.deletedItems = [{
    ...pageRows.items[1]!,
    id: deletedItemId,
    name: "off-slice-conflict.md",
    parentId: pageRows.items[1]!.parentId,
    deletedAt,
    updatedAt: deletedAt
  }];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() { return { ...pageRows, restoreBlockedItemIds: [deletedItemId] }; },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });

  assert.equal(page.deleted_items[0]?.restore_href, undefined);
});

test("drive page service keeps recycle-bin file current-version metadata intact", async () => {
  const pageRows = rows();
  const deletedItemId = "91000000-0000-4000-8000-0000000000d3";
  const deletedVersionId = "91000000-0000-4000-8000-0000000000d4";
  const deletedItem = {
    ...pageRows.items[1]!,
    id: deletedItemId,
    name: "已删除说明.md",
    currentVersionId: deletedVersionId,
    deletedAt: new Date("2026-06-14T08:00:00.000Z"),
    updatedAt: new Date("2026-06-14T08:00:00.000Z")
  };
  const deletedVersion = {
    ...pageRows.versions[0]!,
    id: deletedVersionId,
    itemId: deletedItemId,
    filename: "已删除说明.md",
    sizeBytes: 4096
  };
  pageRows.deletedItems = [deletedItem];
  pageRows.versions = [...pageRows.versions, deletedVersion];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() { return pageRows; },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });
  const deletedVm = page.deleted_items.find((item) => item.id === deletedItemId);
  const deletedVersionVm = page.versions.find((version) => version.id === deletedVersionId);

  assert.equal(deletedVm?.current_version_id, deletedVersionId);
  assert.equal(deletedVm?.current_version?.id, deletedVersionId);
  assert.equal(deletedVm?.current_version?.current, true);
  assert.equal(deletedVm?.current_version?.size_bytes, 4096);
  assert.equal(deletedVersionVm?.current, true);
});

test("drive page service honors a requested item_id (#5 recent-file deep-link) and rejects a missing target", async () => {
  const pageRows = rows();
  let readInput: Parameters<DriveRepository["readPage"]>[0];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage(input) {
        readInput = input;
        return pageRows;
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  // requested folder id (a real item, not the default file pick) → highlighted
  const focused = await service.page({ actor: actor(), locale: "zh-CN", projectId, itemId: folderId });
  assert.equal(focused.selected_item_id, folderId, "requested item_id is honored");
  assert.equal(readInput?.targetItemId, folderId, "requested item_id is forwarded so the repository can include it beyond the page slice");

  await assert.rejects(
    () => service.page({ actor: actor(), locale: "zh-CN", projectId, itemId: "91000000-0000-4000-8000-0000000000bb" }),
    (error) => error instanceof DrivePageServiceError
      && error.status === 404
      && error.code === "drive_file_not_found"
      && error.message === "没有找到这个网盘文件。"
  );
});

test("drive page service honors a requested deleted item_id in the recycle bin", async () => {
  const pageRows = rows();
  const deletedItemId = "91000000-0000-4000-8000-0000000000db";
  pageRows.deletedItems = [{
    ...pageRows.items[1]!,
    id: deletedItemId,
    name: "已删除验收说明.md",
    deletedAt: new Date("2026-06-14T09:00:00.000Z"),
    updatedAt: new Date("2026-06-14T09:00:00.000Z")
  }];
  let readInput: Parameters<DriveRepository["readPage"]>[0];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage(input) {
        readInput = input;
        return pageRows;
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const focused = await service.page({ actor: actor(), locale: "zh-CN", projectId, itemId: deletedItemId });

  assert.equal(focused.selected_item_id, deletedItemId);
  assert.equal(readInput?.targetItemId, deletedItemId);
  assert.equal(focused.deleted_items[0]?.id, deletedItemId);
});

test("xreview: drive summary.file_count uses the uncapped project total, not the 200-row tree slice", async () => {
  const pageRows = rows();
  const loadedFiles = pageRows.items.filter((item) => item.kind === "file").length;
  const loadedFolders = pageRows.items.filter((item) => item.kind === "folder").length;
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      // 项目实际有 250 个文件,但 readPage 树只加载了 loadedFiles 个(<=200)。
      async countFilesByProject() { return 250; },
      async readPage() {
        return {
          ...pageRows,
          totalItemCount: 260,
          totalFileCount: 250,
          totalFolderCount: 10,
          totalDeletedItemCount: 4,
          totalVersionCount: 999,
          totalAcceptedDeliverableCount: 7,
          totalPendingCommentCount: 6,
          totalOperationCount: 123
        };
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });
  // 与项目主页 countFilesByProject 同口径(250),而不是树切片的 loaded 数 —— 否则 >200 文件时两页对不上。
  assert.equal(page.summary.file_count, 250);
  assert.equal(page.summary.folder_count, 10);
  assert.equal(page.summary.item_count, 260);
  assert.equal(page.summary.deleted_item_count, 4);
  assert.equal(page.summary.version_count, 999);
  assert.equal(page.summary.accepted_deliverable_count, 7);
  assert.equal(page.summary.pending_comment_count, 6);
  assert.equal(page.summary.operation_count, 123);
  assert.ok(loadedFiles < 250, "fixture loads fewer files than the project total (the cap scenario)");
  assert.ok(loadedFolders < 10, "fixture loads fewer folders than the project total (the cap scenario)");
});

test("DF-3: drive children_count uses the uncapped per-parent count, not the 200-row tree slice", async () => {
  const pageRows = rows();
  // 已载入树里该文件夹只有 1 个子项;但项目实际有 9 个(其余排在 200 行上限之外)。
  const loadedChildren = pageRows.items.filter((item) => item.parentId === folderId).length;
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async countChildrenByParent() { return [{ parentId: folderId, count: 9 }]; },
      async readPage() { return pageRows; },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN", projectId });
  const folderVm = page.items.find((item) => item.id === folderId);
  // 全量 count(*) 口径(9)覆盖 loaded 子集数(1)——否则子项排在 200 之外的文件夹会读成 0、被误判空可删。
  assert.equal(folderVm?.children_count, 9);
  assert.ok(loadedChildren < 9, "fixture loads fewer children than the real per-parent count (the cap scenario)");
  // children_count>0 → 该文件夹绝不会被列为可删的空文件夹(delete_item 不会指向它的删除端点)。
  assert.ok(
    !page.actions?.delete_item?.href?.includes(`/items/${folderId}/delete`),
    "a folder with real children is never offered as an empty-folder delete candidate"
  );
});

test("drive page service does not 403 the generic drive route on an invisible default project", async () => {
  const hiddenRows = rows();
  hiddenRows.project = {
    ...projectRow(),
    ownerUserId: "91000000-0000-4000-8000-000000000099",
    workspaceId: "91000000-0000-4000-8000-000000000098"
  };
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return hiddenRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const genericPage = await service.page({ actor: actor(), locale: "zh-CN" });
  assert.equal(genericPage.empty_state, "no_project");

  await assert.rejects(
    () => service.page({ actor: actor(), locale: "zh-CN", projectId }),
    (error) => error instanceof DrivePageServiceError && error.status === 403 && error.code === "drive_forbidden"
  );
});

test("drive page service blocks owner writes from another workspace", async () => {
  const crossWorkspaceRows = rows();
  crossWorkspaceRows.project = {
    ...projectRow(),
    ownerUserId: userId,
    workspaceId: "91000000-0000-4000-8000-000000000098"
  };
  let uploadReachedRepository = false;
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return crossWorkspaceRows;
      },
      async uploadFile() {
        uploadReachedRepository = true;
        throw new Error("cross-workspace owner must not upload");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  await assert.rejects(
    () => service.uploadFile({
      actor: actor(),
      projectId,
      filename: "跨工作区.txt",
      mime: "text/plain",
      sizeBytes: 12,
      storagePath: "drive/r5/cross-workspace.txt"
    }),
    (error) => error instanceof DrivePageServiceError && error.status === 403 && error.code === "drive_forbidden"
  );
  assert.equal(uploadReachedRepository, false);
});

test("drive page service exposes a no-project empty state instead of throwing", async () => {
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return { project: null, items: [], versions: [], acceptedDeliverables: [], comments: [], deletedItems: [], operations: [], commentProposals: [] };
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const page = await service.page({ actor: actor(), locale: "zh-CN" });

  assert.equal(page.empty_state, "no_project");
  assert.equal(page.summary.item_count, 0);
  assert.deepEqual(page.items, []);
});

test("drive page service 404s an explicit project_id that resolves to nothing (not a misleading no_project 200)", async () => {
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        // 不存在/已归档/已删项目 → repo 返回 project:null
        return { project: null, items: [], versions: [], acceptedDeliverables: [], comments: [], deletedItems: [], operations: [], commentProposals: [] };
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal() { throw new Error("not needed"); }
    },
    now: () => now
  });

  await assert.rejects(
    () => service.page({ actor: actor(), locale: "zh-CN", projectId: "93000000-0000-4000-8000-0000000000ff" }),
    (error) => error instanceof DrivePageServiceError && error.status === 404 && error.code === "drive_not_found"
  );
});

test("drive page service creates a work item draft from a pending drive comment", async () => {
  const pageRows = rows();
  const comment = pageRows.comments[1]!;
  const calls: { projectId: string; commentId: string; actorUserId: string }[] = [];
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return pageRows;
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft(input) {
        calls.push({
          projectId: input.projectId,
          commentId: input.commentId,
          actorUserId: input.actorUserId
        });
        comment.status = "draft_created";
        comment.draftWorkItemId = workItemId;
        comment.updatedAt = now;
        return { comment, workItem: null, created: true };
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    },
    now: () => now
  });

  const page = await service.commentToDraft({ actor: actor(), projectId, commentId: comment.id });

  assert.deepEqual(calls, [{ projectId, commentId: comment.id, actorUserId: userId }]);
  assert.equal(page.comments[1]?.status, "draft_created");
  assert.equal(page.comments[1]?.draft_href, `/workitems/${workItemId}`);
});

test("drive page service creates a deterministic proposal from a drive comment draft", async () => {
  const manifests: DeliverableChangeManifest[] = [];
  const records: Array<{ workItemId: string; proposalId: string; actorUserId: string }> = [];
  const refreshed = workItemDetail({
    source_context: {
      source_type: "drive_comment",
      project_id: projectId,
      comment_id: "91000000-0000-4000-8000-000000000012",
      folder_id: folderId,
      folder_path: "/复盘包",
      author_label: "PM",
      body: "把这条评论转成后续行动草稿。",
      status: "proposal_created",
      created_at: now.toISOString(),
      proposal_id: proposalId,
      proposal_href: `/proposals/${proposalId}`,
      proposal_status: "opened"
    },
    actions: {}
  });
  let detailCallCount = 0;
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return rows();
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal(input) {
        records.push({
          workItemId: input.workItemId,
          proposalId: input.proposalId,
          actorUserId: input.actorUserId
        });
        return {
          comment: rows().comments[0]!,
          operation: rows().operations[0]!
        };
      }
    },
    proposals: {
      async createFromManifest(input) {
        manifests.push(input.manifest);
        return storedProposalFromManifest(input.manifest);
      },
      async get() {
        return null;
      }
    },
    workItems: {
      async detailPage() {
        detailCallCount += 1;
        return detailCallCount === 1 ? workItemDetail() : refreshed;
      },
      async assertCanMutateArtifacts() {
        return undefined;
      }
    },
    now: () => now
  });

  const result = await service.draftToProposal({ actor: actor(), locale: "zh-CN", workItemId });

  assert.equal(manifests.length, 1);
  assert.equal(manifests[0]?.work_item_id, workItemId);
  assert.equal(manifests[0]?.changes[0]?.target_ref.entity_type, "delivery");
  assert.equal(manifests[0]?.changes[0]?.target_ref.entity_id, undefined);
  assert.equal(manifests[0]?.changes[0]?.target_ref.path, "/outputs/复盘包/drive-comment-R5-7.md");
  const generatedContent = manifests[0]?.changes[0]?.machine_summary?.generated_content_md;
  assert.ok(generatedContent?.includes("## 来源评论"));
  assert.ok(generatedContent?.includes("把这条评论转成后续行动草稿。"));
  assert.equal(
    manifests[0]?.changes[0]?.target_ref.sha256_after,
    createHash("sha256").update(generatedContent!, "utf8").digest("hex")
  );
  assert.equal(manifests[0]?.evidence_refs[0]?.source_id, "91000000-0000-4000-8000-000000000012");
  assert.deepEqual(records, [{
    workItemId,
    proposalId: manifests[0]!.proposal_id!,
    actorUserId: userId
  }]);
  assert.equal(result.source_context?.proposal_status, "opened");
});

test("drive draftToProposal requires artifact mutation access before creating a proposal", async () => {
  let createFromManifestCalls = 0;
  let recordDraftProposalCalls = 0;
  const workItems = {
    async detailPage() {
      return workItemDetail();
    },
    async assertCanMutateArtifacts() {
      throw new WorkItemServiceError(403, "forbidden", "你没有权限修改这个事项的正式交付物。");
    }
  };
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return rows();
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        recordDraftProposalCalls += 1;
        throw new Error("must not record when artifact mutation is forbidden");
      }
    },
    proposals: {
      async createFromManifest(input) {
        createFromManifestCalls += 1;
        return storedProposalFromManifest(input.manifest);
      },
      async get() {
        return null;
      }
    },
    workItems,
    now: () => now
  });

  await assert.rejects(
    () => service.draftToProposal({ actor: actor(), workItemId }),
    (error) => error instanceof WorkItemServiceError
      && error.status === 403
      && error.code === "forbidden"
      && error.message === "你没有权限修改这个事项的正式交付物。"
  );
  assert.equal(createFromManifestCalls, 0);
  assert.equal(recordDraftProposalCalls, 0);
});

test("drive page service treats deterministic proposal conflicts as idempotent", async () => {
  let recordedProposalId: string | undefined;
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return rows();
      },
      async uploadFile() {
        throw new Error("not needed");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal(input) {
        recordedProposalId = input.proposalId;
        return {
          comment: rows().comments[0]!,
          operation: rows().operations[0]!
        };
      }
    },
    proposals: {
      async createFromManifest() {
        throw new ProposalServiceError(409, "proposal_already_exists", "exists");
      },
      async get() {
        return null;
      }
    },
    workItems: {
      async detailPage() {
        return workItemDetail({
          source_context: {
            ...workItemDetail().source_context!,
            proposal_id: recordedProposalId,
            proposal_href: recordedProposalId ? `/proposals/${recordedProposalId}` : undefined,
            proposal_status: recordedProposalId ? "opened" : undefined
          },
          actions: recordedProposalId ? {} : workItemDetail().actions
        });
      },
      async assertCanMutateArtifacts() {
        return undefined;
      }
    },
    now: () => now
  });

  const result = await service.draftToProposal({ actor: actor(), workItemId });

  assert.equal(recordedProposalId?.length, 36);
  assert.equal(result.source_context?.proposal_id, recordedProposalId);
});

// findings[#22/#24 后继]：draft→proposal 跨服务写入幂等 + self-heal 回归。
// 用一个有状态的假仓库忠实建模「现已幂等」的 recordDraftProposal：评论已是 proposal_created 且
// 已有指向同一 proposalId 的 draft_to_proposal operation → 直接返回既有行，不再追加 operation/audit。
// 据此证明：重复调用只产生一套 operation/audit；service 在残留态(draft_created)下会 self-heal。
class StatefulDriveRecorder {
  comment = rows().comments[0]!;
  operations: Array<{ workItemId: string; proposalId: string }> = [];
  auditRows: Array<{ proposalId: string; action: string }> = [];

  constructor() {
    // 残留态：评论已建草稿但仍停在 draft_created，draft_to_proposal 从未落盘。
    this.comment = { ...this.comment, status: "draft_created", draftWorkItemId: workItemId };
  }

  async recordDraftProposal(input: { workItemId: string; proposalId: string }) {
    const alreadyDone =
      this.comment.status === "proposal_created" &&
      this.operations.some((op) => op.workItemId === input.workItemId && op.proposalId === input.proposalId);
    if (alreadyDone) {
      // 幂等 no-op：不追加 operation/audit，返回既有行。
      return { comment: this.comment, operation: rows().operations[0]! };
    }
    this.comment = { ...this.comment, status: "proposal_created" };
    this.operations.push({ workItemId: input.workItemId, proposalId: input.proposalId });
    this.auditRows.push({ proposalId: input.proposalId, action: "proposal.created_from_drive_draft" });
    this.auditRows.push({ proposalId: input.proposalId, action: "drive.comment.proposal_created" });
    return { comment: this.comment, operation: rows().operations[0]! };
  }
}

test("drive draftToProposal self-heals a residual draft_created state and is idempotent across re-runs", async () => {
  const recorder = new StatefulDriveRecorder();
  // 提议已存在（上次 createFromManifest 已成功），但评论仍停在 draft_created——典型部分失败残留。
  const residual = workItemDetail({
    source_context: {
      source_type: "drive_comment",
      project_id: projectId,
      comment_id: "91000000-0000-4000-8000-000000000012",
      folder_id: folderId,
      folder_path: "/复盘包",
      author_label: "PM",
      body: "把这条评论转成后续行动草稿。",
      status: "draft_created",
      created_at: now.toISOString(),
      proposal_id: proposalId,
      proposal_href: `/proposals/${proposalId}`,
      proposal_status: "opened"
    },
    actions: {}
  });
  let createFromManifestCalls = 0;
  const service = createDrivePageService({
    repo: {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return rows();
      },
      async uploadFile() { throw new Error("not needed"); },
      async softDeleteItem() { throw new Error("not needed"); },
      async restoreDeletedItem() { throw new Error("not needed"); },
      async commentToDraft() { throw new Error("not needed"); },
      async recordDraftProposal(input) {
        return recorder.recordDraftProposal({ workItemId: input.workItemId, proposalId: input.proposalId });
      }
    },
    proposals: {
      async createFromManifest() {
        createFromManifestCalls += 1;
        throw new Error("must not create a new proposal when one already exists");
      },
      async get() {
        return null;
      }
    },
    workItems: {
      async detailPage() {
        return residual;
      },
      async assertCanMutateArtifacts() {
        return undefined;
      }
    },
    now: () => now
  });

  await service.draftToProposal({ actor: actor(), workItemId });
  // self-heal 跑了一次：补齐 1 套 operation + 2 条 audit；从不调用 createFromManifest。
  assert.equal(createFromManifestCalls, 0);
  assert.equal(recorder.operations.length, 1);
  assert.equal(recorder.auditRows.length, 2);
  assert.equal(recorder.comment.status, "proposal_created");

  // 第二次调用必须是安全 no-op——operation/audit 计数不变，绝不重复 insert。
  await service.draftToProposal({ actor: actor(), workItemId });
  assert.equal(recorder.operations.length, 1);
  assert.equal(recorder.auditRows.length, 2);
});

test("drive recordDraftProposal stays idempotent when called twice with the same proposal", async () => {
  // 直接对「已幂等」的仓库契约施压：两次 recordDraftProposal 只留一套 operation/audit。
  const recorder = new StatefulDriveRecorder();
  const first = await recorder.recordDraftProposal({ workItemId, proposalId });
  const second = await recorder.recordDraftProposal({ workItemId, proposalId });

  assert.equal(first.comment.status, "proposal_created");
  assert.equal(second.comment.status, "proposal_created");
  assert.equal(recorder.operations.length, 1);
  assert.equal(recorder.auditRows.length, 2);
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
    mutedNotificationTypes: [],
    isAdmin: false,
    deletedAt: null,
    deletedByUserId: null,
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

async function readDirectoryNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
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
      pending_comment_count: 0,
      deleted_item_count: 0,
      operation_count: 0
    },
    can_manage: true,
    items: [],
    deleted_items: [],
    versions: [],
    accepted_deliverables: [],
    comments: [],
    operations: [],
    actions: {},
    empty_state: "no_drive_items"
  };
}

function readOnlyDrivePage(): DrivePageVM {
  return {
    ...minimalDrivePage(),
    can_manage: false,
    actions: {}
  };
}

function unusedDriveFile(): never {
  throw new Error("not needed");
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
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
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

test("drive page route rejects malformed item_id before it reaches the repository", async () => {
  const runtimeSettings = settings();
  let pageCalls = 0;
  const drivePages: DrivePageService = {
    async page() {
      pageCalls += 1;
      throw new Error("malformed item_id must not reach the drive page service");
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
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/pages", createPageRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/pages/drive?project_id=${projectId}&item_id=not-a-uuid`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "drive_file_not_found");
  assert.equal(pageCalls, 0);
});

test("drive upload route authenticates, parses payload, and returns a refreshed page VM", async () => {
  const defaultRuntimeSettings = settings();
  const defaultUploadRoot = path.join(defaultRuntimeSettings.dataDir, "project-drive", "uploads", projectId);
  const beforeDefaultUploadDirs = new Set(await readDirectoryNames(defaultUploadRoot));
  let newDefaultUploadDirs: string[] = [];
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-json-upload-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    const calls: { projectId: string; filename: string; actorId?: string; storagePath?: string }[] = [];
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile(input) {
        calls.push({
          projectId: input.projectId,
          filename: input.filename,
          ...(input.actor.userId ? { actorId: input.actor.userId } : {}),
          ...(input.storagePath ? { storagePath: input.storagePath } : {})
        });
        return minimalDrivePage();
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };

    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));

    const response = await app.request(`/api/drive/projects/${projectId}/files?locale=en-US`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "r5-upload.md", mime: "text/markdown", parsed_text: "# R5" })
    });

    newDefaultUploadDirs = (await readDirectoryNames(defaultUploadRoot)).filter((dir) => !beforeDefaultUploadDirs.has(dir));
    assert.deepEqual(newDefaultUploadDirs, []);
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: true; data: DrivePageVM; meta: { locale: string } };
    assert.equal(body.meta.locale, "en-US");
    assert.equal(body.data.project?.id, projectId);
    assert.deepEqual(calls, [{
      projectId,
      filename: "r5-upload.md",
      actorId: userId,
      storagePath: calls[0]?.storagePath
    }]);
    assert.equal(path.resolve(calls[0]?.storagePath ?? "").startsWith(path.resolve(dataDir)), true);
  } finally {
    await Promise.all(
      newDefaultUploadDirs.map((dir) => rm(path.join(defaultUploadRoot, dir), { recursive: true, force: true }))
    );
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route forwards parent_id so folder uploads do not land at project root", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-json-folder-upload-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    const calls: Array<{ filename: string; parentId?: string }> = [];
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile(input) {
        calls.push({
          filename: input.filename,
          ...((input as { parentId?: string }).parentId ? { parentId: (input as { parentId?: string }).parentId } : {})
        });
        return minimalDrivePage();
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "folder-upload.md",
        mime: "text/markdown",
        parent_id: folderId,
        parsed_text: "# Folder upload"
      })
    });

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [{ filename: "folder-upload.md", parentId: folderId }]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route normalizes JSON filenames to a basename", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-json-basename-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    const calls: Array<{ filename: string; storagePath?: string }> = [];
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile(input) {
        calls.push({
          filename: input.filename,
          ...(input.storagePath ? { storagePath: input.storagePath } : {})
        });
        return minimalDrivePage();
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "../nested/report.md",
        mime: "text/markdown",
        parsed_text: "# Report"
      })
    });

    assert.equal(response.status, 200);
    assert.equal(calls[0]?.filename, "report.md");
    assert.match(calls[0]?.storagePath ?? "", /report\.md$/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route normalizes dot-segment JSON filenames to a safe leaf name", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-json-dotname-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    const calls: Array<{ filename: string; storagePath?: string }> = [];
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile(input) {
        calls.push({
          filename: input.filename,
          ...(input.storagePath ? { storagePath: input.storagePath } : {})
        });
        return minimalDrivePage();
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "../",
        mime: "text/plain",
        parsed_text: "safe content"
      })
    });

    assert.equal(response.status, 200);
    assert.equal(calls[0]?.filename, "upload.bin");
    assert.match(calls[0]?.storagePath ?? "", /upload\.bin$/u);
    assert.equal(await readFile(calls[0]!.storagePath!, "utf8"), "safe content");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route rejects metadata-only JSON uploads so AI file context is readable", async () => {
  const runtimeSettings = settings();
  let uploadCalls = 0;
  const drivePages: DrivePageService = {
    async page() {
      return minimalDrivePage();
    },
    async file() {
      return unusedDriveFile();
    },
    async uploadFile() {
      uploadCalls += 1;
      throw new Error("upload should not run");
    },
    async deleteItem() {
      throw new Error("not needed");
    },
    async restoreItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/files`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "empty-context.json",
      mime: "application/json",
      size_bytes: 128,
      sha256: "d".repeat(64)
    })
  });

  assert.equal(response.status, 400);
  assert.equal(uploadCalls, 0);
  const body = await response.json() as { error: { code: string; message: string } };
  assert.equal(body.error.code, "drive_file_content_missing");
  assert.match(body.error.message, /文件内容|parsed_text/u);
});

test("drive upload route materializes multipart file bytes before returning success", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-upload-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    const content = "真实文件内容\nDrive upload should hydrate this.";
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const calls: {
      filename: string;
      mime?: string;
      sizeBytes?: number;
      sha256?: string;
      parsedText?: string;
      storagePath?: string;
    }[] = [];
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile(input) {
        calls.push({
          filename: input.filename,
          ...(input.mime ? { mime: input.mime } : {}),
          ...(input.sizeBytes !== undefined ? { sizeBytes: input.sizeBytes } : {}),
          ...(input.sha256 ? { sha256: input.sha256 } : {}),
          ...(input.parsedText ? { parsedText: input.parsedText } : {}),
          ...(input.storagePath ? { storagePath: input.storagePath } : {})
        });
        assert.ok(input.storagePath, "upload should pass a persisted storage path to the service");
        assert.equal(await readFile(input.storagePath, "utf8"), content);
        return minimalDrivePage();
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));
    const form = new FormData();
    form.set("file", new Blob([content], { type: "text/markdown" }), "用户复盘.md");

    const response = await app.request(`/api/drive/projects/${projectId}/files?locale=en-US`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings) },
      body: form
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      filename: "用户复盘.md",
      mime: "text/markdown",
      sizeBytes: Buffer.byteLength(content),
      sha256: expectedHash,
      parsedText: content,
      storagePath: calls[0]?.storagePath
    });
    assert.match(calls[0]?.storagePath ?? "", /project-drive/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route truncates unbounded (chunked) bodies at the 34MiB stream cap before buffering", async () => {
  // R9 批次0-5：不声明 Content-Length 的请求绕过全局预检，路由内必须边读边限量——
  // 否则 formData() 会把任意大 body 全量缓冲进内存（认证成员即可打 OOM）。
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-upload-stream-cap-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    let uploadCalls = 0;
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile() {
        uploadCalls += 1;
        throw new Error("upload should not run");
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(35 * 1024 * 1024)], { type: "application/octet-stream" }), "way-too-large.bin");

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings) },
      body: form
    });

    assert.equal(response.status, 413);
    assert.equal(uploadCalls, 0);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, "drive_file_too_large");
    assert.match(body.error.message, /34/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route rejects oversized multipart files before calling the service", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-upload-too-large-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    let uploadCalls = 0;
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile() {
        uploadCalls += 1;
        throw new Error("upload should not run");
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(32 * 1024 * 1024 + 1)], { type: "application/octet-stream" }), "too-large.bin");

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings) },
      body: form
    });

    assert.equal(response.status, 413);
    assert.equal(uploadCalls, 0);
    const body = await response.json() as { error: { code: string; message: string } };
    assert.equal(body.error.code, "drive_file_too_large");
    assert.match(body.error.message, /超过|32/u);
    await assert.rejects(
      readdir(path.join(dataDir, "project-drive", "uploads")),
      /ENOENT/u
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route checks manage permission before materializing multipart bytes", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-upload-forbidden-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    let uploadCalls = 0;
    const drivePages: DrivePageService = {
      async page() {
        return readOnlyDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile() {
        uploadCalls += 1;
        throw new Error("upload should not run");
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));
    const form = new FormData();
    form.set("file", new Blob(["forbidden"], { type: "text/plain" }), "forbidden.txt");

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings) },
      body: form
    });

    assert.equal(response.status, 403);
    assert.equal(uploadCalls, 0);
    await assert.rejects(
      readdir(path.join(dataDir, "project-drive", "uploads")),
      /ENOENT/u
    );
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive page service removes materialized bytes when the repository rejects before commit", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-upload-cleanup-"));
  try {
    const storagePath = path.join(dataDir, "project-drive", "uploads", projectId, "duplicate.txt");
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, "duplicate content");
    const repo: DriveRepository = {
      async listRecentFilesByProject() { return []; },
      async countFilesByProject() { return 0; },
      async readPage() {
        return rows();
      },
      async uploadFile(input) {
        assert.equal(input.storagePath, storagePath);
        assert.equal(await readFile(storagePath, "utf8"), "duplicate content");
        throw new DriveRepositoryConflictError("drive_name_conflict", "网盘里已经有同名文件。");
      },
      async softDeleteItem() {
        throw new Error("not needed");
      },
      async restoreDeletedItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async recordDraftProposal() {
        throw new Error("not needed");
      }
    };
    const service = createDrivePageService({ repo, now: () => now });

    await assert.rejects(
      () => service.uploadFile({
        actor: actor(),
        projectId,
        filename: "duplicate.txt",
        mime: "text/plain",
        storagePath,
        parsedText: "duplicate content"
      }),
      (error) => error instanceof DrivePageServiceError
        && error.status === 409
        && error.code === "drive_name_conflict"
        && error.message === "网盘里已经有同名文件。"
    );
    await assert.rejects(readFile(storagePath, "utf8"), /ENOENT/u);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route keeps materialized bytes after the service takes upload ownership", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-upload-owned-"));
  try {
    const runtimeSettings = loadSettings({
      APP_ENV: "test",
      COOKIE_SECRET: "test-cookie-secret",
      DATA_DIR: dataDir
    });
    let storagePath = "";
    const drivePages: DrivePageService = {
      async page() {
        return minimalDrivePage();
      },
      async file() {
        return unusedDriveFile();
      },
      async uploadFile(input) {
        storagePath = input.storagePath ?? "";
        assert.ok(storagePath, "upload should materialize before calling the service");
        assert.equal(await readFile(storagePath, "utf8"), "committed content");
        throw new DrivePageServiceError(409, "刷新网盘页面失败。", "drive_refresh_failed");
      },
      async deleteItem() {
        throw new Error("not needed");
      },
      async restoreItem() {
        throw new Error("not needed");
      },
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages,
      settings: runtimeSettings
    }));
    const form = new FormData();
    form.set("file", new Blob(["committed content"], { type: "text/plain" }), "committed.txt");

    const response = await app.request(`/api/drive/projects/${projectId}/files`, {
      method: "POST",
      headers: { Cookie: await cookie(runtimeSettings) },
      body: form
    });

    assert.equal(response.status, 409);
    assert.match(storagePath, /project-drive/u);
    assert.equal(await readFile(storagePath, "utf8"), "committed content");
    const body = await response.json() as { error: { code: string } };
    assert.equal(body.error.code, "drive_refresh_failed");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive upload route returns 400 for malformed JSON instead of treating it as an empty upload", async () => {
  const runtimeSettings = settings();
  let uploadCalls = 0;
  const drivePages: DrivePageService = {
    async page() {
      return minimalDrivePage();
    },
    async file() {
      return unusedDriveFile();
    },
    async uploadFile() {
      uploadCalls += 1;
      throw new Error("upload should not run");
    },
    async deleteItem() {
      throw new Error("not needed");
    },
    async restoreItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/files`, {
    method: "POST",
    headers: {
      Cookie: await cookie(runtimeSettings),
      "Content-Type": "application/json"
    },
    body: "{"
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { ok: false; error: { message: string } };
  assert.match(body.error.message, /valid JSON/u);
  assert.equal(uploadCalls, 0);
});

test("drive ordinary file routes download and preview stored bytes", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "workhub-drive-file-read-"));
  try {
    const runtimeSettings = settings();
    const content = "# Manual note\n\nThis came from the project drive.";
    const storagePath = path.join(dataDir, "manual-note.md");
    await writeFile(storagePath, content);
    const calls: { projectId: string; itemId: string; actorId?: string }[] = [];
    const drivePages: DrivePageService = {
      async page() {
        throw new Error("not needed");
      },
      async file(input) {
        calls.push({
          projectId: input.projectId,
          itemId: input.itemId,
          ...(input.actor.userId ? { actorId: input.actor.userId } : {})
        });
        return {
          id: currentVersionId,
          itemId,
          projectId,
          filename: "manual-note.md",
          mime: "text/markdown",
          sizeBytes: Buffer.byteLength(content),
          storagePath
        };
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
      async commentToDraft() {
        throw new Error("not needed");
      },
      async draftToProposal() {
        throw new Error("not needed");
      }
    };
    const app = withErrors(new Hono<AuthEnv>());
    app.route("/api/drive", createDriveRoutes({
      auth: authDeps(runtimeSettings),
      drivePages
    }));

    const download = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/download`, {
      headers: { Cookie: await cookie(runtimeSettings) }
    });
    assert.equal(download.status, 200);
    assert.equal(await download.text(), content);
    assert.equal(download.headers.get("Content-Type"), "text/markdown");
    assert.equal(download.headers.get("Content-Length"), String(Buffer.byteLength(content)));
    assert.match(download.headers.get("Content-Disposition") ?? "", /manual-note\.md/u);

    const preview = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/preview`, {
      headers: { Cookie: await cookie(runtimeSettings) }
    });
    assert.equal(preview.status, 200);
    const body = await preview.json() as { ok: true; data: { text: string; preview_type: string; download_href: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.preview_type, "text");
    assert.equal(body.data.text, content);
    assert.equal(body.data.download_href, `/api/drive/projects/${projectId}/items/${itemId}/download`);
    assert.deepEqual(calls, [
      { projectId, itemId, actorId: userId },
      { projectId, itemId, actorId: userId }
    ]);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("drive ordinary file routes fall back to parsed text when stored bytes are missing", async () => {
  const runtimeSettings = settings();
  const content = "# Manual note\n\nRecovered from parsed_text.";
  const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
    },
    async file() {
      return {
        id: currentVersionId,
        itemId,
        projectId,
        filename: "manual-note.md",
        mime: "text/markdown",
        sizeBytes: Buffer.byteLength(content),
        storagePath: path.join(tmpdir(), "workhub-missing-manual-note.md"),
        parsedText: content,
        sha256
      };
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
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const download = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/download`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), content);
  assert.equal(download.headers.get("Content-Length"), String(Buffer.byteLength(content)));

  const preview = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/preview`, {
    headers: { Cookie: await cookie(runtimeSettings) }
  });
  assert.equal(preview.status, 200);
  const body = await preview.json() as { ok: true; data: { text: string } };
  assert.equal(body.data.text, content);
});

test("drive ordinary file preview and download reject incomplete parsed text fallback", async () => {
  const runtimeSettings = settings();
  const cachedText = "# Manual note\n\nThis is only the preview cache.";
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
    },
    async file() {
      return {
        id: currentVersionId,
        itemId,
        projectId,
        filename: "manual-note.md",
        mime: "text/markdown",
        sizeBytes: Buffer.byteLength(cachedText) + 100,
        storagePath: path.join(tmpdir(), "workhub-missing-truncated-note.md"),
        parsedText: cachedText,
        sha256: createHash("sha256").update(`${cachedText} full`, "utf8").digest("hex")
      };
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
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));
  const headers = { Cookie: await cookie(runtimeSettings) };

  const preview = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/preview`, { headers });
  assert.equal(preview.status, 404);
  const previewBody = await preview.json() as { ok: false; error: { code: string } };
  assert.equal(previewBody.error.code, "drive_file_missing");

  const download = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/download`, { headers });
  assert.equal(download.status, 404);
  const downloadBody = await download.json() as { ok: false; error: { code: string } };
  assert.equal(downloadBody.error.code, "drive_file_missing");
});

test("drive comment draft route authenticates and returns a refreshed page VM", async () => {
  const runtimeSettings = settings();
  const commentId = "91000000-0000-4000-8000-000000000015";
  const calls: { projectId: string; commentId: string; actorId?: string }[] = [];
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
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
    async commentToDraft(input) {
      calls.push({
        projectId: input.projectId,
        commentId: input.commentId,
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
      });
      return minimalDrivePage();
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/comments/${commentId}/draft?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: DrivePageVM; meta: { locale: string } };
  assert.equal(body.meta.locale, "en-US");
  assert.equal(body.data.project?.id, projectId);
  assert.deepEqual(calls, [{ projectId, commentId, actorId: userId }]);
});

test("drive draft proposal route authenticates and returns a refreshed work item VM", async () => {
  const runtimeSettings = settings();
  const calls: { workItemId: string; locale?: string; actorId?: string }[] = [];
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
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
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal(input) {
      calls.push({
        workItemId: input.workItemId,
        ...(input.locale ? { locale: input.locale } : {}),
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
      });
      return workItemDetail({
        source_context: {
          source_type: "drive_comment",
          project_id: projectId,
          comment_id: "91000000-0000-4000-8000-000000000012",
          folder_id: folderId,
          folder_path: "/复盘包",
          author_label: "PM",
          body: "把这条评论转成后续行动草稿。",
          status: "proposal_created",
          created_at: now.toISOString(),
          proposal_id: proposalId,
          proposal_href: `/proposals/${proposalId}`,
          proposal_status: "opened"
        },
        actions: {}
      });
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/workitems/${workItemId}/proposal-draft?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings) }
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: WorkItemDetailVM; meta: { locale: string } };
  assert.equal(body.meta.locale, "en-US");
  assert.equal(body.data.source_context?.proposal_href, `/proposals/${proposalId}`);
  assert.deepEqual(calls, [{ workItemId, locale: "en-US", actorId: userId }]);
});

test("drive delete route rejects malformed path ids before parsing the body", async () => {
  const runtimeSettings = settings();
  let deleteCalls = 0;
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
    },
    async file() {
      return unusedDriveFile();
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async deleteItem() {
      deleteCalls += 1;
      throw new Error("malformed path ids must not reach the drive service");
    },
    async restoreItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/not-a-uuid/delete`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 404);
  const body = await response.json() as { ok: false; error: { code: string } };
  assert.equal(body.error.code, "drive_file_not_found");
  assert.equal(deleteCalls, 0);
});

test("drive delete route checks manage access before parsing the optional body", async () => {
  const runtimeSettings = settings();
  let pageCalls = 0;
  let deleteCalls = 0;
  const drivePages: DrivePageService = {
    async page(input) {
      pageCalls += 1;
      assert.equal(input.projectId, projectId);
      return readOnlyDrivePage();
    },
    async file() {
      return unusedDriveFile();
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async deleteItem() {
      deleteCalls += 1;
      throw new Error("read-only users must not reach deleteItem");
    },
    async restoreItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/delete`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: "{"
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "drive_forbidden",
      message: "你没有权限管理这个项目网盘。"
    }
  });
  assert.equal(pageCalls, 1);
  assert.equal(deleteCalls, 0);
});

test("drive mutation routes preserve service conflict codes", async () => {
  const runtimeSettings = settings();
  const drivePages: DrivePageService = {
    async page() {
      return minimalDrivePage();
    },
    async file() {
      return unusedDriveFile();
    },
    async uploadFile() {
      throw new Error("not needed");
    },
    async deleteItem() {
      throw new DrivePageServiceError(409, "文件版本已经变化，请刷新后重试。", "drive_current_version_changed");
    },
    async restoreItem() {
      throw new Error("not needed");
    },
    async commentToDraft() {
      throw new Error("not needed");
    },
    async draftToProposal() {
      throw new Error("not needed");
    }
  };
  const app = withErrors(new Hono<AuthEnv>());
  app.route("/api/drive", createDriveRoutes({
    auth: authDeps(runtimeSettings),
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/items/${itemId}/delete`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ expected_current_version_id: currentVersionId })
  });

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: {
      code: "drive_current_version_changed",
      message: "文件版本已经变化，请刷新后重试。"
    }
  });
});
