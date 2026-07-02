import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  defaultSeedIds,
  type CreateStoredWorkItemInput,
  type DriveAcceptedDeliverableRow,
  type InsertStoredChatMessageInput,
  type StoredWorkItemDetailRows,
  type WorkItemDataRepository,
  type WorkItemKnowledgeDocumentRow,
  type WorkItemRow
} from "@workhub/db";
import type { ProviderRegistry } from "@workhub/agent/providers";

import type { AuthActor } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";
import { createDbWorkItemService, createInMemoryWorkItemService, WorkItemServiceError } from "./services/work-items.js";

const now = new Date("2026-06-26T00:00:00.000Z");
const projectId = "93000000-0000-4000-8000-000000000101";
const workItemId = "93000000-0000-4000-8000-000000000201";
const userId = "93000000-0000-4000-8000-000000000301";
const acceptedChangeId = "93000000-0000-4000-8000-000000000401";

const actor: AuthActor = {
  kind: "human",
  id: userId,
  userId,
  label: "clarifier",
  isAdmin: false,
  orgId: defaultSeedIds.orgId,
  workspaceId: defaultSeedIds.workspaceId
};

function repository(): WorkItemDataRepository {
  const chatMessages: Array<{ kind: string; contentJson: unknown }> = [];
  return {
    async findProjectById(id: string) {
      return id === projectId
        ? {
            id: projectId,
            workspaceId: defaultSeedIds.workspaceId,
            ownerUserId: userId,
            archived: false,
            deletedAt: null
          }
        : null;
    },
    async findFirstActiveProject() {
      throw new Error("not needed");
    },
    async findFirstActiveProjectInWorkspace() {
      throw new Error("not needed");
    },
    async listOpenByProject() {
      return [];
    },
    async countOpenByProject() {
      return 0;
    },
    async countVisibleOpenByProject() {
      return 0;
    },
    async createWorkItem(input: CreateStoredWorkItemInput) {
      return {
        id: workItemId,
        code: "DEMO-999",
        projectId: input.projectId,
        workspaceId: input.workspaceId ?? defaultSeedIds.workspaceId,
        submitterUserId: input.submitterUserId,
        title: input.title ?? null,
        rawDescription: input.rawDescription ?? null,
        summaryMd: input.summaryMd ?? null,
        status: input.status ?? "ai_clarifying",
        priority: input.priority ?? "normal",
        syncState: "pending",
        version: 0,
        mode: "worker",
        humanReserved: false,
        claimedByUserId: null,
        createdAt: now,
        updatedAt: now
      };
    },
    async updateWorkItemFromSession() {
      throw new Error("not needed");
    },
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      chatMessages.push({ kind: input.kind, contentJson: input.contentJson });
      return {
        id: `chat-${chatMessages.length}`,
        workItemId: input.workItemId,
        role: input.role,
        kind: input.kind,
        contentJson: input.contentJson,
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: input.at ?? now
      };
    },
    async listSessionSelectedOptionIds() {
      return [];
    },
    async listSessionClarificationAnswers() {
      return [];
    },
    async findLatestChatMessageByKind() {
      return null;
    },
    async findWorkItemById() {
      return null;
    },
    async findWorkItemAccessRecord() {
      return null;
    },
    async readWorkItemDetail() {
      return null;
    },
    async findAcceptedDeliverableFile() {
      return null;
    },
    async restoreAcceptedDeliverable() {
      return null;
    },
    async searchKnowledge() {
      return { documents: [], workItems: [] };
    },
    async listClaimHandovers() {
      return [];
    },
    async createClaimHandover() {
      throw new Error("not needed");
    },
    async completeClaimHandover() {
      throw new Error("not needed");
    }
  } as unknown as WorkItemDataRepository;
}

function knowledgeWorkItem(partial: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: partial.id ?? "93000000-0000-4000-8000-000000000501",
    code: partial.code ?? "DEMO-501",
    projectId: partial.projectId ?? projectId,
    workspaceId: partial.workspaceId ?? defaultSeedIds.workspaceId,
    submitterUserId: partial.submitterUserId ?? "93000000-0000-4000-8000-000000000888",
    claimedByUserId: partial.claimedByUserId ?? null,
    claimedByNickname: partial.claimedByNickname ?? null,
    title: partial.title ?? "Knowledge work item",
    rawDescription: partial.rawDescription ?? "Knowledge work item description",
    summaryMd: partial.summaryMd ?? null,
    status: partial.status ?? "in_review",
    priority: partial.priority ?? "normal",
    syncState: partial.syncState ?? "pending",
    version: partial.version ?? 1,
    mode: partial.mode ?? "worker",
    humanReserved: partial.humanReserved ?? false,
    estimateHours: partial.estimateHours ?? null,
    estimateConfidence: partial.estimateConfidence ?? null,
    planningNote: partial.planningNote ?? null,
    startAt: partial.startAt ?? null,
    dueAt: partial.dueAt ?? null,
    sourceMeetingId: partial.sourceMeetingId ?? null,
    sourceWorkItemId: partial.sourceWorkItemId ?? null,
    claimedAt: partial.claimedAt ?? null,
    doneAt: partial.doneAt ?? null,
    deliveredAt: partial.deliveredAt ?? null,
    deliveryDocReadyAt: partial.deliveryDocReadyAt ?? null,
    acceptedAt: partial.acceptedAt ?? null,
    currentSpecId: partial.currentSpecId ?? null,
    mainBranchId: partial.mainBranchId ?? null,
    latestConfidenceId: partial.latestConfidenceId ?? null,
    deletedAt: partial.deletedAt ?? null,
    deletedByUserId: partial.deletedByUserId ?? null,
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now
  };
}

function knowledgeDocument(partial: Partial<WorkItemKnowledgeDocumentRow> = {}): WorkItemKnowledgeDocumentRow {
  return {
    id: partial.id ?? "93000000-0000-4000-8000-000000000601",
    projectId: partial.projectId ?? projectId,
    workItemId: partial.workItemId ?? null,
    sourceType: partial.sourceType ?? "drive",
    sourceId: partial.sourceId ?? "drive-file-1",
    title: partial.title ?? "Knowledge document",
    sourceUrl: partial.sourceUrl ?? "/drive/file/drive-file-1",
    corpusPath: partial.corpusPath ?? "/tmp/workhub-corpus/drive-file-1.md",
    contentHash: partial.contentHash ?? "0".repeat(64),
    createdAt: partial.createdAt ?? now,
    updatedAt: partial.updatedAt ?? now
  };
}

function detailRows(partial: Partial<StoredWorkItemDetailRows["workItem"]> = {}): StoredWorkItemDetailRows {
  return {
    workItem: {
      id: workItemId,
      code: "DEMO-999",
      projectId,
      workspaceId: defaultSeedIds.workspaceId,
      submitterUserId: "93000000-0000-4000-8000-000000000302",
      title: "Reviewable work item",
      rawDescription: "A public work item in the actor workspace.",
      summaryMd: null,
      status: "in_review",
      priority: "normal",
      syncState: "pending",
      version: 1,
      mode: "worker",
      humanReserved: false,
      claimedByUserId: null,
      createdAt: now,
      updatedAt: now,
      ...partial
    },
    projectName: "Demo",
    projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
    projectWorkspaceId: defaultSeedIds.workspaceId,
    projectArchived: false,
    projectDeletedAt: null,
    assignments: [],
    acceptance: [],
    agentSteps: [],
    latestProposal: null,
    acceptedDeliverables: [],
    evidenceBindings: [],
    driveSourceComment: null,
    meetingSourceInsight: null
  } as unknown as StoredWorkItemDetailRows;
}

function acceptedDeliverableRow(partial: Partial<DriveAcceptedDeliverableRow["accepted"]> = {}): DriveAcceptedDeliverableRow {
  const proposalId = "93000000-0000-4000-8000-000000000402";
  const changeId = "93000000-0000-4000-8000-000000000403";
  const itemId = "93000000-0000-4000-8000-000000000404";
  const versionId = "93000000-0000-4000-8000-000000000405";
  return {
    accepted: {
      id: acceptedChangeId,
      workItemId,
      projectId,
      proposalId,
      branchId: null,
      changeId,
      targetKind: "text_doc",
      targetEntityType: "delivery",
      targetEntityId: null,
      targetPath: "/outputs/result.md",
      targetKey: "delivery:/outputs/result.md",
      changeType: "updated",
      acceptedVersion: 2,
      baseVersionRef: null,
      acceptedRef: versionId,
      driveItemId: itemId,
      driveVersionId: versionId,
      sha256Before: null,
      sha256After: "a".repeat(64),
      previewRefJson: null,
      manifestChangeJson: {
        id: changeId,
        target_kind: "text_doc",
        target_ref: {
          entity_type: "delivery",
          path: "/outputs/result.md",
          sha256_after: "a".repeat(64)
        },
        change_type: "updated",
        human_summary: "更新正式交付物",
        machine_summary: { changed_fields: ["body"] }
      },
      supersededAt: null,
      createdAt: now,
      updatedAt: now,
      ...partial
    },
    driveItem: {
      id: itemId,
      projectId,
      parentId: null,
      kind: "file",
      name: "result.md",
      currentVersionId: versionId,
      deletedAt: null,
      deletedByUserId: null,
      createdByUserId: userId,
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now
    },
    driveVersion: {
      id: versionId,
      itemId,
      versionNo: 2,
      filename: "result.md",
      mime: "text/markdown",
      sizeBytes: 128,
      storagePath: "drive/result.md",
      sha256: "a".repeat(64),
      parsedText: "正式交付物",
      parsedTextPath: null,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now
    }
  };
}

test("persistent intake rejects injected generic clarification templates", async () => {
  const service = createDbWorkItemService(repository(), {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      return {
        title: "这件事先按哪种交付方向处理？",
        body: "请选择文档/方案、结构化数据或小型代码模板。",
        placeholder: "选一个方向即可。"
      };
    }
  });

  await assert.rejects(
    () => service.createSession({
      actor,
      locale: "zh-CN",
      payload: {
        project_id: projectId,
        intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      }
    }),
    (error) => error instanceof WorkItemServiceError && error.code === "clarification_llm_templated_response"
  );
});

test("persistent intake does not fill AI clarification drafts with fallback template body text", async () => {
  const service = createDbWorkItemService(repository(), {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      return {
        title: "请确认 workhub-app-upload.txt 里的真实 App 上传验收是否就是唯一验收依据？"
      };
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: {
      project_id: projectId,
      intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
    }
  });

  assert.equal(session.question.title, "请确认 workhub-app-upload.txt 里的真实 App 上传验收是否就是唯一验收依据？");
  assert.equal(session.question.body, undefined);
});

test("persistent intake ignores stale stored generic clarification templates and regenerates", async () => {
  let generatorCalls = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId,
        title: "根据项目网盘 workhub-app-upload.txt 生成三条验收要点",
        rawDescription: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000701",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: {
          title: "这件事先按哪种交付方向处理？",
          body: "请选择文档/方案、结构化数据或小型代码模板。",
          placeholder: "选一个方向即可。"
        },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now,
        updatedAt: now
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      return {
        title: "请确认 workhub-app-upload.txt 的三条验收要点是否只用于真实 App 测试？",
        body: "我已读取验收材料/workhub-app-upload.txt，需要确认验收对象。",
        placeholder: "例如：是，只面向真实 App 验收。"
      };
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: { work_item_id: workItemId }
  });

  assert.equal(generatorCalls, 1);
  assert.match(session.question.title, /workhub-app-upload\.txt/u);
  assert.doesNotMatch(session.question.title, /交付方向|文档\/方案|结构化数据|小型代码/u);
});

test("persistent intake reuses stored clarification when the current file context would validate it", async () => {
  let generatorCalls = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId,
        title: "请整理预算偏差说明",
        rawDescription: "请整理预算偏差说明"
      });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000703",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: {
          title: "请确认 Q3预算复盘.xlsx 中的偏差说明面向董事会还是财务复盘？",
          body: "我已看到 Q3预算复盘.xlsx，需要确认这份说明的目标读者。",
          placeholder: "例如：面向董事会。"
        },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now,
        updatedAt: now
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "Q3预算复盘.xlsx",
        path: "财务/Q3预算复盘.xlsx",
        preview: "预算偏差说明、董事会口径、财务复盘口径。"
      }];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      return {
        title: "请确认财务/Q3预算复盘.xlsx 的预算偏差说明使用董事会口径还是财务复盘口径？",
        body: "我已看到财务/Q3预算复盘.xlsx，需要确认口径。",
        placeholder: "例如：董事会口径。"
      };
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: { work_item_id: workItemId }
  });

  assert.equal(generatorCalls, 0);
  assert.equal(session.question.title, "请确认 Q3预算复盘.xlsx 中的偏差说明面向董事会还是财务复盘？");
});

test("persistent intake accepts a rephrased clarification even when it does not quote the named file verbatim", async () => {
  // R9 批次0-2：文件已找到并喂给了模型，LLM 换个说法不逐字引用文件名是正常改写，
  // 不允许因此 502 阻断 intake（旧 clarification_llm_missing_named_file 已删除）。
  const service = createDbWorkItemService(repository(), {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      return {
        title: "请确认生成三条验收要点的目标读者是谁？",
        body: "需求里提到生成三条验收要点，但没有说明读者。",
        placeholder: "例如：面向验收同学。"
      };
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: {
      project_id: projectId,
      intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
    }
  });
  assert.equal(session.question.title, "请确认生成三条验收要点的目标读者是谁？");
});

test("persistent intake regenerates stored clarification that misses an explicitly named file", async () => {
  let generatorCalls = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId,
        title: "根据项目网盘 workhub-app-upload.txt 生成三条验收要点",
        rawDescription: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000702",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: {
          title: "请确认生成三条验收要点的目标读者是谁？",
          body: "需求里提到生成三条验收要点，但没有说明读者。",
          placeholder: "例如：面向验收同学。"
        },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now,
        updatedAt: now
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      return {
        title: "请确认 workhub-app-upload.txt 里的 App 上传验收是否就是这三条要点的唯一依据？",
        body: "我已读取验收材料/workhub-app-upload.txt，需要确认是否只按该文件验收。",
        placeholder: "例如：是，只按这份文件验收。"
      };
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: { work_item_id: workItemId }
  });

  assert.equal(generatorCalls, 1);
  assert.match(session.question.title, /workhub-app-upload\.txt/u);
});

test("persistent intake requires mutation access before regenerating an existing session clarification", async () => {
  let generatorCalls = 0;
  let chatWrites = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "ai_clarifying",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null,
          title: "根据项目网盘 workhub-app-upload.txt 生成三条验收要点",
          rawDescription: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "member" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      chatWrites += 1;
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      return {
        title: "请确认 workhub-app-upload.txt 是否作为三条验收要点的唯一来源？",
        body: "我已读取验收材料/workhub-app-upload.txt，需要确认依据范围。",
        placeholder: "例如：是，只按这份文件验收。"
      };
    }
  });

  await assert.rejects(
    () => service.createSession({
      actor,
      locale: "zh-CN",
      payload: { work_item_id: workItemId }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 403
      && error.message === "你没有权限修改这个事项。"
  );
  assert.equal(generatorCalls, 0);
  assert.equal(chatWrites, 0);
});

test("persistent getSession requires mutation access before generating a missing clarification", async () => {
  let generatorCalls = 0;
  let chatWrites = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "ai_clarifying",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null,
          title: "根据项目网盘 workhub-app-upload.txt 生成三条验收要点",
          rawDescription: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "member" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      chatWrites += 1;
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "验收材料/workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      return {
        title: "请确认 workhub-app-upload.txt 是否作为三条验收要点的唯一来源？",
        body: "我已读取验收材料/workhub-app-upload.txt，需要确认依据范围。",
        placeholder: "例如：是，只按这份文件验收。"
      };
    }
  });

  await assert.rejects(
    () => service.getSession({
      sessionId: workItemId,
      actor,
      locale: "zh-CN"
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 403
      && error.message === "你没有权限修改这个事项。"
  );
  assert.equal(generatorCalls, 0);
  assert.equal(chatWrites, 0);
});

test("persistent intake degrades gracefully when an explicitly named project file is not loaded", async () => {
  // R9 批次0-2：点名文件识别有误报可能（版本号/小数/域名），找不到不再 502+cancel 工单——
  // 降级为继续生成澄清反问，由反问自然向用户确认缺失材料。
  let generatorReached = false;
  const service = createDbWorkItemService(repository(), {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "unrelated-notes.md",
        path: "docs/unrelated-notes.md",
        preview: "这是一份无关的会议记录。"
      }];
    },
    async clarificationGenerator() {
      generatorReached = true;
      return {
        title: "没有找到 workhub-app-upload.txt，请确认它在哪个目录？",
        body: "项目网盘里目前只看到 unrelated-notes.md。",
        placeholder: "例如：验收材料/workhub-app-upload.txt。"
      };
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: {
      project_id: projectId,
      intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
    }
  });
  assert.equal(generatorReached, true, "clarification should proceed without the missing file");
  assert.match(session.question.title, /workhub-app-upload\.txt/u);
});

test("persistent intake requires an AI clarification generator instead of local fallback questions", async () => {
  const service = createDbWorkItemService(repository(), {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    }
  });

  await assert.rejects(
    () => service.createSession({
      actor,
      locale: "zh-CN",
      payload: {
        project_id: projectId,
        intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 503
      && error.code === "clarification_llm_unavailable"
  );
});

test("persistent intake cancels a newly created clarification draft when AI analysis fails", async () => {
  const updates: Array<{ workItemId: string; status: string; planningNote?: string | null }> = [];
  const repo = {
    ...repository(),
    async updateWorkItemFromSession(input: Parameters<WorkItemDataRepository["updateWorkItemFromSession"]>[0]) {
      const update = {
        workItemId: input.workItemId,
        status: input.status,
        ...(input.planningNote !== undefined ? { planningNote: input.planningNote } : {})
      };
      updates.push(update);
      return knowledgeWorkItem({
        id: input.workItemId,
        status: input.status,
        ...(input.planningNote !== undefined ? { planningNote: input.planningNote } : {})
      });
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      throw new Error("provider down");
    }
  });

  await assert.rejects(
    () => service.createSession({
      actor,
      locale: "zh-CN",
      payload: {
        project_id: projectId,
        intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 502
      && error.code === "clarification_llm_failed"
  );

  assert.deepEqual(updates, [{
    workItemId,
    status: "cancelled",
    planningNote: "clarification_session_failed"
  }]);
});

test("persistent intake does not cancel an existing work item when AI analysis fails", async () => {
  let updateCalled = false;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId,
        title: "根据项目网盘 workhub-app-upload.txt 生成三条验收要点",
        rawDescription: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      });
    },
    async updateWorkItemFromSession() {
      updateCalled = true;
      throw new Error("existing sessions must not be cancelled from clarification failure");
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "workhub-app-upload.txt",
        preview: "桌面 APP 上传验收：必须证明真实 APP 可读取项目网盘文件。"
      }];
    },
    async clarificationGenerator() {
      throw new Error("provider down");
    }
  });

  await assert.rejects(
    () => service.createSession({
      actor,
      locale: "zh-CN",
      payload: { work_item_id: workItemId }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 502
      && error.code === "clarification_llm_failed"
  );
  assert.equal(updateCalled, false);
});

test("persistent intake passes the actor workspace into AI clarification usage", async () => {
  let seenActor: { workspaceId?: string } | undefined;
  let seenTask: string | undefined;
  const providerRegistry = {
    isConfigured() {
      return true;
    },
    get(actorInput: { workspaceId?: string } | undefined, task: string) {
      seenActor = actorInput;
      seenTask = task;
      return {
        messages: {
          async create() {
            return {
              content: [{
                text: JSON.stringify({
                  title: "请确认 workhub-app-upload.txt 的验收口径是否只面向真实 App 测试？",
                  body: "我已看到项目文件 workhub-app-upload.txt，需要确认验收口径。",
                  placeholder: "例如：是，只面向真实 App 测试。"
                })
              }]
            };
          }
        }
      };
    }
  } as unknown as ProviderRegistry;
  const service = createDbWorkItemService(repository(), {
    now: () => now,
    providerRegistry,
    async projectFileContext() {
      return [{
        name: "workhub-app-upload.txt",
        path: "workhub-app-upload.txt",
        preview: "真实 App 验收"
      }];
    }
  });

  await service.createSession({
    actor,
    locale: "zh-CN",
    payload: {
      project_id: projectId,
      intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
    }
  });

  assert.equal(seenTask, "clarify");
  assert.equal(seenActor?.workspaceId, defaultSeedIds.workspaceId);
});

test("real-key evaluation wires the provider registry into WorkItem clarification", () => {
  const source = readFileSync("src/qa/r5-10-real-key-evaluation.ts", "utf8");
  assert.match(
    source,
    /createDbWorkItemService\(workItemRepository,\s*\{[\s\S]*providerRegistry[\s\S]*\}\)/u
  );
});

test("real-key evaluation answers AI clarification with free text before applying task presets", () => {
  const source = readFileSync("src/qa/r5-10-real-key-evaluation.ts", "utf8");
  assert.match(source, /const clarificationQuestion = session\.data\.question/u);
  assert.match(
    source,
    /\/api\/sessions\/\$\{session\.data\.session_id\}\/next-question`[\s\S]{0,160}free_text: clarificationAnswer/u
  );
  assert.doesNotMatch(
    source,
    /\/api\/sessions\/\$\{session\.data\.session_id\}\/next-question`[\s\S]{0,160}selected_option_ids: task\.optionIds/u
  );
});

test("real-key evaluation labels limited samples instead of applying full-suite gates", () => {
  const source = readFileSync("src/qa/r5-10-real-key-evaluation.ts", "utf8");
  assert.match(source, /const limitedRun = /u);
  assert.match(source, /R5_10_REAL_TASK_LIMIT/u);
  assert.match(source, /run_scope/u);
  assert.match(source, /full_suite/u);
  assert.match(source, /Limited Sample Summary/u);
  assert.match(source, /Full Gate Summary/u);
  assert.match(source, /full-suite escalation gates were not asserted in this limited sample/u);
});

test("real-key evaluation feeds prepared input files into AI clarification", () => {
  const source = readFileSync("src/qa/r5-10-real-key-evaluation.ts", "utf8");
  assert.match(source, /function localInputFileContext/u);
  assert.match(source, /const clarificationFileContextByIntent = new Map/u);
  assert.match(source, /projectFileContext/u);
  assert.match(source, /clarificationFileContextByIntent\.set\(task\.intentText/u);
});

test("real-key evaluation keeps resolved work item context in the execution prompt", () => {
  const source = readFileSync("src/qa/r5-10-real-key-evaluation.ts", "utf8");
  assert.match(source, /initialUserMessage:\s*\(run,\s*workItemContext\)/u);
  assert.match(source, /workItemContext\s*\?\s*\[/u);
  assert.match(source, /<work_item_context>/u);
  assert.match(source, /workItemContext,/u);
});

test("real-key evaluation fails deliverable samples with incomplete confidence reviews", () => {
  const source = readFileSync("src/qa/r5-10-real-key-evaluation.ts", "utf8");
  assert.match(source, /function assertRequiredConfidence/u);
  assert.match(source, /task\.expectedMode !== "deliverable"/u);
  assert.match(source, /confidence review is incomplete/u);
  assert.match(source, /assertRequiredConfidence\(task,\s*confidenceEvidence\)/u);
});

test("kickoff_agent finalize does not show ai_working before an AgentRun is actually queued", async () => {
  const service = createInMemoryWorkItemService({ now: () => now });
  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: { intent_text: "根据项目网盘里的材料生成验收要点。" }
  });

  const created = await service.createWorkItem({
    actor,
    locale: "zh-CN",
    payload: {
      session_id: session.session_id,
      selected_option_ids: ["document-draft"],
      kickoff_agent: true
    }
  });

  assert.equal(created.workitem.status, "spec_ready");
});

test("session finalization requires mutation access, not just private detail read access", async () => {
  let finalized = false;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "ai_clarifying",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "member" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async listSessionClarificationAnswers() {
      return [{
        selectedOptionIds: ["document-draft"],
        freeText: "请按网盘文件输出验收要点。"
      }];
    },
    async updateWorkItemFromSession() {
      finalized = true;
      return knowledgeWorkItem({ id: workItemId, status: "spec_ready" });
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.createWorkItem({
      actor,
      locale: "zh-CN",
      payload: {
        session_id: workItemId,
        selected_option_ids: ["document-draft"]
      }
    }),
    (error) => error instanceof WorkItemServiceError && error.status === 403
  );
  assert.equal(finalized, false);
});

test("session clarification answer uses generic mutation access, not artifact-specific access", async () => {
  let answerWritten = false;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "ai_clarifying",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "member" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async insertChatMessage() {
      answerWritten = true;
      throw new Error("service must not write a clarification answer for a read-only session");
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.nextQuestion({
      sessionId: workItemId,
      actor,
      locale: "zh-CN",
      payload: { free_text: "请按项目网盘材料继续。" }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 403
      && error.message === "你没有权限修改这个事项。"
  );
  assert.equal(answerWritten, false);
});

test("session readback requires mutation access even after clarification answers exist", async () => {
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "ai_clarifying",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "member" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async listSessionClarificationAnswers() {
      return [{
        selectedOptionIds: ["document-draft"],
        freeText: "请按网盘材料继续。"
      }];
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.getSession({
      sessionId: workItemId,
      actor,
      locale: "zh-CN"
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 403
      && error.message === "你没有权限修改这个事项。"
  );
});

test("assigned lead can continue a private clarification session", async () => {
  let answerWritten = false;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "ai_clarifying",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "lead" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      answerWritten = true;
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  const session = await service.nextQuestion({
    sessionId: workItemId,
    actor,
    locale: "zh-CN",
    payload: { free_text: "请按项目网盘材料继续。" }
  });

  assert.equal(answerWritten, true);
  assert.equal(session.question.input_mode, "confirm");
  assert.equal(session.question.progress.find((step) => step.key === "confirm")?.state, "active");
});

test("work item session wraps VM assembly drift as an internal contract error", async () => {
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        id: "not-a-uuid",
        status: "ai_clarifying",
        submitterUserId: userId
      });
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.nextQuestion({
      sessionId: workItemId,
      actor,
      locale: "zh-CN",
      payload: { free_text: "请按项目网盘材料继续。" }
    }),
    (error: unknown) => error instanceof InternalContractError && error.context === "work-item.session"
  );
});

test("evidence binding uses generic mutation access, not artifact-specific access", async () => {
  let evidenceBound = false;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return {
        ...detailRows({
          status: "spec_ready",
          submitterUserId: "93000000-0000-4000-8000-000000000888",
          claimedByUserId: null
        }),
        projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
        assignments: [{ userId, role: "member" }]
      } as unknown as StoredWorkItemDetailRows;
    },
    async insertChatMessage() {
      evidenceBound = true;
      throw new Error("service must not bind evidence for a read-only work item");
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.bindEvidence({
      workItemId,
      actor,
      locale: "zh-CN",
      payload: {
        evidence_refs: [{
          id: "93000000-0000-4000-8000-000000000901",
          source_type: "drive_file",
          source_id: "93000000-0000-4000-8000-000000000901",
          title: "项目网盘材料",
          href: "/api/drive/items/93000000-0000-4000-8000-000000000901"
        }]
      }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 403
      && error.message === "你没有权限修改这个事项。"
  );
  assert.equal(evidenceBound, false);
});

test("work item detail wraps VM assembly drift as an internal contract error", async () => {
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ id: "not-a-uuid" });
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.detailPage({ workItemId, actor, locale: "zh-CN" }),
    (error: unknown) => error instanceof InternalContractError && error.context === "work-item.detail"
  );
});

test("in-memory work item detail wraps VM assembly drift as an internal contract error", async () => {
  const service = createInMemoryWorkItemService({
    now: () => now,
    id: () => "not-a-uuid"
  });

  await assert.rejects(
    () => service.createWorkItem({
      actor,
      locale: "zh-CN",
      payload: {
        title: "Memory detail drift",
        raw_description: "内存版事项详情也应该使用同一输出契约边界。"
      }
    }),
    (error: unknown) => error instanceof InternalContractError && error.context === "work-item.detail"
  );
});

test("accepted deliverable restore finds previous versions by project target instead of same drive item", () => {
  const source = readFileSync("../../packages/db/src/repositories/work-items.ts", "utf8");
  assert.doesNotMatch(
    source,
    /eq\(acceptedDeliverableChanges\.driveItemId,\s*current\.driveItem\.id\)/u
  );
});

test("claimed work item access still respects the actor workspace scope", async () => {
  const otherWorkspaceId = "93000000-0000-4000-8000-000000000777";
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    workItem: {
      id: workItemId,
      code: "DEMO-777",
      projectId,
      workspaceId: otherWorkspaceId,
      submitterUserId: "93000000-0000-4000-8000-000000000888",
      claimedByUserId: userId,
      claimedByNickname: "clarifier",
      title: "跨租户认领事项",
      rawDescription: "不应在错误 workspace 下读取。",
      summaryMd: "不应在错误 workspace 下读取。",
      status: "spec_ready",
      priority: "normal",
      syncState: "pending",
      version: 1,
      mode: "worker",
      humanReserved: false,
      estimateHours: null,
      estimateConfidence: null,
      planningNote: null,
      startAt: null,
      dueAt: null,
      sourceMeetingId: null,
      sourceWorkItemId: null,
      claimedAt: null,
      doneAt: null,
      deliveredAt: null,
      deliveryDocReadyAt: null,
      acceptedAt: null,
      currentSpecId: null,
      mainBranchId: null,
      latestConfidenceId: null,
      deletedAt: null,
      deletedByUserId: null,
      createdAt: now,
      updatedAt: now
    },
    projectName: "Other workspace project",
    projectOwnerUserId: null,
    projectWorkspaceId: otherWorkspaceId,
    projectArchived: false,
    projectDeletedAt: null,
    assignments: [],
    acceptance: [],
    agentSteps: [],
    latestProposal: null,
    acceptedDeliverables: [],
    evidenceBindings: [],
    driveSourceComment: null,
    meetingSourceInsight: null
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.detailPage({ workItemId, actor, locale: "zh-CN" }),
    (error) => error instanceof WorkItemServiceError && error.status === 403
  );
});

test("claimer can read an archived-project work item without widening access to other users", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "spec_ready",
      submitterUserId: "93000000-0000-4000-8000-000000000888",
      claimedByUserId: userId
    }),
    projectArchived: true
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.workitem.id, workItemId);
  await assert.rejects(
    () => service.detailPage({
      workItemId,
      actor: {
        ...actor,
        id: "93000000-0000-4000-8000-000000000999",
        userId: "93000000-0000-4000-8000-000000000999",
        label: "stranger"
      },
      locale: "zh-CN"
    }),
    (error) => error instanceof WorkItemServiceError && error.status === 403
  );
});

test("assigned users can open private work item details in their workspace", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "spec_ready",
      submitterUserId: "93000000-0000-4000-8000-000000000888",
      claimedByUserId: null
    }),
    assignments: [{ userId, role: "lead" }]
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.workitem.id, workItemId);
});

test("work item detail includes the latest task plan snapshot for presentation", async () => {
  const planId = "93000000-0000-4000-8000-000000000901";
  const researchId = "93000000-0000-4000-8000-000000000902";
  const produceId = "93000000-0000-4000-8000-000000000903";
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "in_review",
      submitterUserId: userId,
      claimedByUserId: null
    }),
    taskPlan: {
      plan: {
        id: planId,
        workItemId,
        workspaceId: defaultSeedIds.workspaceId,
        status: "approved",
        objectiveId: null,
        budgetJson: { total_share_pct: 100 },
        decompositionContextJson: { source: "meta_planner" },
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now
      },
      items: [
        {
          id: researchId,
          planId,
          parentItemId: null,
          seq: 1,
          title: "整理竞品证据",
          role: "research",
          objectiveMd: "查清三类竞品的最新打法。",
          acceptanceMd: "列出至少 3 条可核验来源。",
          budgetSharePct: 35,
          dependsOn: [],
          status: "pending",
          createdAt: now,
          updatedAt: now
        },
        {
          id: produceId,
          planId,
          parentItemId: null,
          seq: 2,
          title: "产出短报告",
          role: "produce",
          objectiveMd: "把证据整理成短报告。",
          acceptanceMd: "报告包含结论、证据和下一步建议。",
          budgetSharePct: 65,
          dependsOn: [researchId],
          status: "pending",
          createdAt: now,
          updatedAt: now
        }
      ],
      itemsCapped: false
    }
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.task_plan?.status, "approved");
  assert.equal(vm.task_plan?.items[0]?.role, "research");
  assert.equal(vm.task_plan?.items[1]?.depends_on[0], researchId);
  assert.equal(vm.task_plan?.items_capped, false);
});

test("work item detail hides accepted-deliverable restore links for read-only viewers", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "in_review",
      submitterUserId: "93000000-0000-4000-8000-000000000302",
      claimedByUserId: null
    }),
    acceptedDeliverables: [acceptedDeliverableRow()]
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.accepted_deliverables[0]?.download_href?.includes("/download"), true);
  assert.equal(vm.accepted_deliverables[0]?.preview_href?.includes("/preview"), true);
  assert.equal(vm.accepted_deliverables[0]?.restore_href, undefined);
});

test("work item detail hides source proposal actions for read-only viewers", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "in_review",
      submitterUserId: "93000000-0000-4000-8000-000000000302",
      claimedByUserId: null
    }),
    projectOwnerUserId: "93000000-0000-4000-8000-000000000303",
    driveSourceComment: {
      comment: {
        id: "93000000-0000-4000-8000-000000000701",
        projectId,
        folderId: null,
        authorUserId: "93000000-0000-4000-8000-000000000302",
        authorNickname: "PM",
        body: "请把这条网盘批注转成变更申请。",
        status: "draft_created",
        llmKind: null,
        llmReason: null,
        draftWorkItemId: workItemId,
        createdAt: now,
        updatedAt: now
      },
      folder: null,
      folderPath: null
    }
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.source_context?.source_type, "drive_comment");
  assert.equal(vm.actions.create_proposal_draft, undefined);
});

test("work item detail hides source proposal actions after the source was dismissed", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "in_review",
      submitterUserId: userId,
      claimedByUserId: null
    }),
    driveSourceComment: {
      comment: {
        id: "93000000-0000-4000-8000-000000000702",
        projectId,
        folderId: null,
        authorUserId: "93000000-0000-4000-8000-000000000302",
        authorNickname: "PM",
        body: "这条评论已经被忽略，不应该再显示生成提议入口。",
        status: "dismissed",
        llmKind: null,
        llmReason: null,
        draftWorkItemId: workItemId,
        createdAt: now,
        updatedAt: now
      },
      folder: null,
      folderPath: null
    }
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.source_context?.source_type, "drive_comment");
  assert.equal(vm.source_context.status, "dismissed");
  assert.equal(vm.actions.create_proposal_draft, undefined);
});

test("project knowledge search hides work items the actor cannot open", async () => {
  const hiddenId = "93000000-0000-4000-8000-000000000502";
  const visibleId = "93000000-0000-4000-8000-000000000503";
  const repo = {
    ...repository(),
    async searchKnowledge() {
      return {
        documents: [],
        workItems: [
          knowledgeWorkItem({
            id: hiddenId,
            code: "DEMO-PRIVATE",
            status: "spec_ready",
            title: "Secret validation checklist",
            rawDescription: "Only the submitter should see this."
          }),
          knowledgeWorkItem({
            id: visibleId,
            code: "DEMO-PUBLIC",
            status: "in_review",
            title: "Public validation checklist",
            rawDescription: "The project can reuse this visible review."
          })
        ]
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  const bubble = await service.searchKnowledge({
    actor,
    locale: "zh-CN",
    payload: {
      project_id: projectId,
      q: "validation",
      limit: 10
    }
  });

  assert.deepEqual(bubble.evidence_refs.map((ref) => ref.id), [visibleId]);
  assert.equal(bubble.evidence_refs.some((ref) => ref.title.includes("Secret")), false);
});

test("project knowledge search keeps private work items assigned to the actor", async () => {
  const assignedId = "93000000-0000-4000-8000-000000000504";
  const repo = {
    ...repository(),
    async searchKnowledge() {
      return {
        documents: [],
        workItems: [
          {
            ...knowledgeWorkItem({
              id: assignedId,
              code: "DEMO-ASSIGNED",
              status: "spec_ready",
              title: "Assigned private checklist",
              rawDescription: "Only explicit assignees should see this."
            }),
            assignments: [{ userId, role: "lead" }]
          }
        ]
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  const bubble = await service.searchKnowledge({
    actor,
    locale: "zh-CN",
    payload: { project_id: projectId, query: "Assigned" }
  });

  assert.deepEqual(bubble.evidence_refs.map((ref) => ref.id), [assignedId]);
});

test("project knowledge search hides documents attached to unreadable private work items", async () => {
  const hiddenId = "93000000-0000-4000-8000-000000000505";
  const documentId = "93000000-0000-4000-8000-000000000602";
  const repo = {
    ...repository(),
    async searchKnowledge() {
      return {
        documents: [
          knowledgeDocument({
            id: documentId,
            workItemId: hiddenId,
            title: "Private draft attachment",
            sourceUrl: "/drive/private-draft"
          })
        ],
        workItems: [
          knowledgeWorkItem({
            id: hiddenId,
            code: "DEMO-HIDDEN-DOC",
            status: "spec_ready",
            title: "Hidden private draft",
            rawDescription: "Only the submitter should see this attachment."
          })
        ]
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  const bubble = await service.searchKnowledge({
    actor,
    locale: "zh-CN",
    payload: { project_id: projectId, q: "draft", limit: 10 }
  });

  assert.equal(bubble.evidence_refs.some((ref) => ref.id === documentId), false);
  assert.equal(bubble.evidence_refs.some((ref) => ref.title.includes("Private")), false);
});

test("knowledge document evidence refs drop unsafe source hrefs", async () => {
  const documentId = "93000000-0000-4000-8000-000000000603";
  const repo = {
    ...repository(),
    async searchKnowledge() {
      return {
        documents: [
          knowledgeDocument({
            id: documentId,
            sourceUrl: "javascript:alert(1)"
          })
        ],
        workItems: []
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  const bubble = await service.searchKnowledge({
    actor,
    locale: "zh-CN",
    payload: { project_id: projectId, q: "Knowledge" }
  });

  const ref = bubble.evidence_refs.find((candidate) => candidate.id === documentId);
  assert.ok(ref);
  assert.equal(ref.href, undefined);
});

test("project knowledge search returns not found for missing project anchors", async () => {
  let searched = false;
  const repo = {
    ...repository(),
    async findProjectById() {
      return null;
    },
    async searchKnowledge() {
      searched = true;
      throw new Error("searchKnowledge must not run for a missing project");
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.searchKnowledge({
      actor,
      locale: "zh-CN",
      payload: { project_id: projectId, q: "验收" }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 404
      && error.code === "project_not_found"
  );
  assert.equal(searched, false);
});

test("project knowledge search returns not found for archived project anchors", async () => {
  let searched = false;
  const repo = {
    ...repository(),
    async findProjectById() {
      return {
        id: projectId,
        workspaceId: defaultSeedIds.workspaceId,
        ownerUserId: userId,
        archived: true,
        deletedAt: null
      };
    },
    async searchKnowledge() {
      searched = true;
      throw new Error("searchKnowledge must not run for an archived project");
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.searchKnowledge({
      actor,
      locale: "zh-CN",
      payload: { project_id: projectId, q: "验收" }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 404
      && error.code === "project_not_found"
  );
  assert.equal(searched, false);
});

test("accepted deliverable restore requires artifact mutation access, not just detail read access", async () => {
  let restoreCalled = false;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows();
    },
    async restoreAcceptedDeliverable() {
      restoreCalled = true;
      return null;
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.restoreAcceptedDeliverable({
      workItemId,
      acceptedChangeId,
      actor
    }),
    (error) => error instanceof WorkItemServiceError && error.status === 403
  );
  assert.equal(restoreCalled, false);
});
