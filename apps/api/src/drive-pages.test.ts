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
import type { DeliverableChangeManifest, DrivePageVM, WorkItemDetailVM } from "@workhub/contracts";

import { COOKIE_NAME, type AuthDependencies, type AuthEnv } from "./middleware/auth.js";
import { createDriveRoutes } from "./routes/drive.js";
import { createPageRoutes } from "./routes/pages.js";
import { createDrivePageService, DrivePageServiceError, type DrivePageService } from "./services/drive-pages.js";
import { ProposalServiceError, type StoredProposal } from "./services/proposals.js";

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
          entity_type: "drive_item",
          entity_id: folderId,
          path: "/复盘包/drive-comment-R5-7.md"
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
    kind: "file",
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

test("drive page service exposes a no-project empty state instead of throwing", async () => {
  const service = createDrivePageService({
    repo: {
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

test("drive page service creates a work item draft from a pending drive comment", async () => {
  const pageRows = rows();
  const comment = pageRows.comments[1]!;
  const calls: { projectId: string; commentId: string; actorUserId: string }[] = [];
  const service = createDrivePageService({
    repo: {
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
      }
    },
    now: () => now
  });

  const result = await service.draftToProposal({ actor: actor(), locale: "zh-CN", workItemId });

  assert.equal(manifests.length, 1);
  assert.equal(manifests[0]?.work_item_id, workItemId);
  assert.equal(manifests[0]?.changes[0]?.target_ref.entity_type, "drive_item");
  assert.equal(manifests[0]?.evidence_refs[0]?.source_id, "91000000-0000-4000-8000-000000000012");
  assert.deepEqual(records, [{
    workItemId,
    proposalId: manifests[0]!.proposal_id!,
    actorUserId: userId
  }]);
  assert.equal(result.source_context?.proposal_status, "opened");
});

test("drive page service treats deterministic proposal conflicts as idempotent", async () => {
  let recordedProposalId: string | undefined;
  const service = createDrivePageService({
    repo: {
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
      }
    },
    now: () => now
  });

  const result = await service.draftToProposal({ actor: actor(), workItemId });

  assert.equal(recordedProposalId?.length, 36);
  assert.equal(result.source_context?.proposal_id, recordedProposalId);
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

test("drive upload route authenticates, parses payload, and returns a refreshed page VM", async () => {
  const runtimeSettings = settings();
  const calls: { projectId: string; filename: string; actorId?: string }[] = [];
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
    },
    async uploadFile(input) {
      calls.push({
        projectId: input.projectId,
        filename: input.filename,
        ...(input.actor.userId ? { actorId: input.actor.userId } : {})
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
    drivePages
  }));

  const response = await app.request(`/api/drive/projects/${projectId}/files?locale=en-US`, {
    method: "POST",
    headers: { Cookie: await cookie(runtimeSettings), "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "r5-upload.md", mime: "text/markdown", parsed_text: "# R5" })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { ok: true; data: DrivePageVM; meta: { locale: string } };
  assert.equal(body.meta.locale, "en-US");
  assert.equal(body.data.project?.id, projectId);
  assert.deepEqual(calls, [{ projectId, filename: "r5-upload.md", actorId: userId }]);
});

test("drive comment draft route authenticates and returns a refreshed page VM", async () => {
  const runtimeSettings = settings();
  const commentId = "91000000-0000-4000-8000-000000000015";
  const calls: { projectId: string; commentId: string; actorId?: string }[] = [];
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
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

test("drive mutation routes preserve service conflict codes", async () => {
  const runtimeSettings = settings();
  const drivePages: DrivePageService = {
    async page() {
      throw new Error("not needed");
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
