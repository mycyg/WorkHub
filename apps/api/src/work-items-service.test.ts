import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { captureStdoutLines } from "@workhub/tools/test-support";

import type { AuthActor } from "./middleware/auth.js";
import { InternalContractError } from "./pages/output-contract.js";
import {
  assertR5_10RequiredConfidence,
  buildR5_10InitialUserMessage,
  buildR5_10RunScopeSummary,
  collectR5_10LocalInputFileContext,
  createR5_10ClarificationAnswerPayload,
  createR5_10WorkItemServiceOptions,
  selectR5_10TasksForRun
} from "./qa/r5-10-real-key-evaluation-contract.js";
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
    async replaceSessionClarificationAnswer(input: InsertStoredChatMessageInput) {
      for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
        if (chatMessages[index]?.kind === "clarification_answer") {
          chatMessages.splice(index, 1);
        }
      }
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
    async deleteSessionClarificationAnswers() {
      let removed = 0;
      for (let index = chatMessages.length - 1; index >= 0; index -= 1) {
        if (chatMessages[index]?.kind === "clarification_answer") {
          chatMessages.splice(index, 1);
          removed += 1;
        }
      }
      return removed;
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
    milestoneId: partial.milestoneId ?? null,
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
      && error.message === "你没有权限修改这个任务。"
  );
  assert.equal(generatorCalls, 0);
  assert.equal(chatWrites, 0);
});

test("CHAT-06 persistent getSession allows read-only stakeholders and reports a missing draft without generating", async () => {
  // CHAT-06：读会话降为 read 判定——只读干系人（member 指派、非提交人/负责人）不再 403；
  // 无已存草稿时按 CHAT-1 口径回 409 引导走生成路径重试，读路径仍不生成、不留痕。
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
      && error.status === 409
      && error.code === "clarification_draft_missing"
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

test("persistent intake keeps a newly created work item in ai_clarifying when AI analysis fails", async () => {
  // E2E-01：澄清生成失败不再把工作项置 cancelled——意图没丢（intent 消息已落库），
  // 工作项留在 ai_clarifying，可经 createSession(带 work_item_id) 显式重试生成。
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

  assert.deepEqual(updates, [], "clarification failure must not cancel the work item");
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

// ── CHAT-1：getSession 读路径去副作用 ─────────────────────────────────────────────

test("persistent getSession reuses the stored draft without any writes or LLM calls", async () => {
  // CHAT-1：轮询/刷新会话页必须纯读——不写 chat_messages、不调澄清生成器。
  let generatorCalls = 0;
  let chatWrites = 0;
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
    },
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      chatWrites += 1;
      return repository().insertChatMessage(input);
    },
    async replaceSessionClarificationAnswer() {
      chatWrites += 1;
      throw new Error("read path must not write chat messages");
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
      throw new Error("read path must never call the clarification generator");
    }
  });

  for (let poll = 0; poll < 3; poll += 1) {
    const session = await service.getSession({ sessionId: workItemId, actor, locale: "zh-CN" });
    assert.equal(session.question.title, "请确认 Q3预算复盘.xlsx 中的偏差说明面向董事会还是财务复盘？");
  }
  assert.equal(generatorCalls, 0);
  assert.equal(chatWrites, 0);
});

test("persistent getSession does not write missing-file notices on the read path", async () => {
  // CHAT-1①：点名文件缺失的 notice 只在生成路径写；GET 轮询不再每刷一次插一条
  // clarification_file_context_notice（此前读路径在复用判断之前就写 notice，无界膨胀 chat_messages）。
  // 已存草稿存在但盖不住点名文件 → 复用不命中 → 409 引导走生成路径重试，全程零写入、零 LLM。
  let chatWrites = 0;
  let generatorCalls = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId,
        title: "根据项目网盘 缺失材料.txt 生成三条验收要点",
        rawDescription: "请根据项目网盘 缺失材料.txt 生成三条验收要点。"
      });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000707",
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
        name: "unrelated-notes.md",
        path: "docs/unrelated-notes.md",
        preview: "这是一份无关的会议记录。"
      }];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      throw new Error("read path must never call the clarification generator");
    }
  });

  for (let poll = 0; poll < 3; poll += 1) {
    await assert.rejects(
      () => service.getSession({ sessionId: workItemId, actor, locale: "zh-CN" }),
      (error) =>
        error instanceof WorkItemServiceError
        && error.status === 409
        && error.code === "clarification_draft_missing"
    );
  }
  assert.equal(chatWrites, 0);
  assert.equal(generatorCalls, 0);
});

test("persistent getSession does not write file-context errors on the read path", async () => {
  // CHAT-1②：文件上下文加载失败的 error 留痕也只在生成路径写；GET 只抛错不落库。
  let chatWrites = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId
      });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000704",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: {
          title: "请确认 Reviewable work item 的验收口径？",
          body: "需求里提到 Reviewable work item，但没有说明验收口径。",
          placeholder: "例如：以网盘文件为准。"
        },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now,
        updatedAt: now
      };
    },
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      chatWrites += 1;
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      throw new Error("drive read exploded");
    }
  });

  await assert.rejects(
    () => service.getSession({ sessionId: workItemId, actor, locale: "zh-CN" }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 502
      && error.code === "clarification_file_context_failed"
  );
  assert.equal(chatWrites, 0);
});

// ── CHAT-2：nextQuestion 校验 / 幂等 / adjust-scope / 状态守卫 ─────────────────────

test("persistent nextQuestion rejects option ids outside the current question options", async () => {
  // CHAT-2①：selected_option_ids 必须属于当前已存草稿的选项集，否则 422 且不落库。
  let answerWritten = false;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "ai_clarifying", submitterUserId: userId });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000705",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: {
          title: "请确认验收要点面向谁？",
          options: [
            { id: "option-1", label: "面向董事会" },
            { id: "option-2", label: "面向验收同学" }
          ]
        },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now,
        updatedAt: now
      };
    },
    async replaceSessionClarificationAnswer(input: InsertStoredChatMessageInput) {
      answerWritten = true;
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.nextQuestion({
      sessionId: workItemId,
      actor,
      locale: "zh-CN",
      payload: { selected_option_ids: ["injected-by-client"] }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 422
      && error.code === "clarification_option_invalid"
  );
  assert.equal(answerWritten, false);

  // 合法选项照常接受（含缺省 id 按 option-{index+1} 推导的口径）。
  const session = await service.nextQuestion({
    sessionId: workItemId,
    actor,
    locale: "zh-CN",
    payload: { selected_option_ids: ["option-2"] }
  });
  assert.equal(session.question.input_mode, "confirm");
});

test("persistent nextQuestion replaces the previous answer instead of appending", async () => {
  // CHAT-2②：同一题重复提交 = upsert 替换，回答记录恒为一条（幂等），且以最后一次为准。
  const storedAnswers: Array<{ selectedOptionIds: string[]; freeText?: string }> = [];
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "ai_clarifying", submitterUserId: userId });
    },
    async replaceSessionClarificationAnswer(input: InsertStoredChatMessageInput) {
      storedAnswers.splice(0, storedAnswers.length);
      storedAnswers.push({
        selectedOptionIds: (input.contentJson["selected_option_ids"] as string[]) ?? [],
        ...(typeof input.contentJson["free_text"] === "string" ? { freeText: input.contentJson["free_text"] as string } : {})
      });
      return repository().insertChatMessage(input);
    },
    async listSessionClarificationAnswers() {
      return storedAnswers;
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await service.nextQuestion({
    sessionId: workItemId,
    actor,
    locale: "zh-CN",
    payload: { free_text: "第一版回答。" }
  });
  await service.nextQuestion({
    sessionId: workItemId,
    actor,
    locale: "zh-CN",
    payload: { free_text: "网络重试后的第二版回答。" }
  });

  assert.equal(storedAnswers.length, 1);
  assert.equal(storedAnswers[0]?.freeText, "网络重试后的第二版回答。");
});

test("persistent nextQuestion adjust-scope clears stored answers before returning to scope", async () => {
  // CHAT-2③：「调整范围」回到 scope 重答时，已存的 scope 回答必须清除，否则旧选择残留进定稿输入。
  let cleared = 0;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "ai_clarifying", submitterUserId: userId });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "93000000-0000-4000-8000-000000000706",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: {
          title: "请确认 Reviewable work item 的验收口径？",
          body: "需求里提到 Reviewable work item，但没有说明验收口径。"
        },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now,
        updatedAt: now
      };
    },
    async deleteSessionClarificationAnswers() {
      cleared += 2;
      return 2;
    },
    async listSessionClarificationAnswers() {
      return [];
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [];
    }
  });

  const session = await service.nextQuestion({
    sessionId: workItemId,
    actor,
    locale: "zh-CN",
    payload: { selected_option_ids: ["adjust-scope"] }
  });

  assert.equal(cleared, 2);
  assert.equal(session.question.input_mode, "long_text");
  assert.equal(session.question.progress.find((step) => step.key === "scope")?.state, "active");
});

test("persistent nextQuestion rejects answers once the session has left clarification", async () => {
  // CHAT-2④ 状态守卫：已定稿(spec_ready)的会话不再接受澄清回答。
  let answerWritten = false;
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "spec_ready", submitterUserId: userId });
    },
    async replaceSessionClarificationAnswer() {
      answerWritten = true;
      throw new Error("finalized sessions must not accept clarification answers");
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.nextQuestion({
      sessionId: workItemId,
      actor,
      locale: "zh-CN",
      payload: { free_text: "迟到的回答。" }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 409
      && error.code === "clarification_state_conflict"
  );
  assert.equal(answerWritten, false);
});

// ── CHAT-3：定稿竞态守卫 ─────────────────────────────────────────────────────────

test("session finalization aborts when a new clarification answer lands after the read", async () => {
  // CHAT-3：listSessionClarificationAnswers 读到 1 条回答后、定稿写入前用户又答了一条——
  // 仓库层在定稿事务里复核回答计数（expectedClarificationAnswerCount=1 ≠ 实际 2）→ null → 409。
  const repo: WorkItemDataRepository = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "ai_clarifying", submitterUserId: userId });
    },
    async listSessionClarificationAnswers() {
      return [{ selectedOptionIds: [], freeText: "读到的第一版回答。" }];
    },
    async updateWorkItemFromSession(input: Parameters<WorkItemDataRepository["updateWorkItemFromSession"]>[0]) {
      // 模拟并发：事务内实际已有 2 条回答（读与写之间又插入一条）。
      const actualAnswerCount = 2;
      if (input.expectedClarificationAnswerCount !== undefined
        && input.expectedClarificationAnswerCount !== actualAnswerCount) {
        return null;
      }
      return knowledgeWorkItem({ id: input.workItemId, status: input.status });
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  await assert.rejects(
    () => service.createWorkItem({
      actor,
      locale: "zh-CN",
      payload: { session_id: workItemId }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 409
      && error.code === "workitem_state_conflict"
  );
});

// ── E2E-01：解析失败重试 + 留痕本地化 ────────────────────────────────────────────

test("persistent intake retries once with a strict-JSON nudge when the LLM response does not parse", async () => {
  // E2E-01①：LLM 输出解析失败（invalid JSON）重试一次，重试 prompt 追加「只返回合法 JSON」强调。
  const prompts: string[] = [];
  const providerRegistry = {
    isConfigured() {
      return true;
    },
    get() {
      return {
        messages: {
          async create(input: { messages: Array<{ content: string }> }) {
            prompts.push(input.messages[0]?.content ?? "");
            if (prompts.length === 1) {
              return { content: [{ text: "当然，这是你的澄清问题——抱歉，忘了 JSON。" }] };
            }
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

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: {
      project_id: projectId,
      intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
    }
  });

  assert.equal(prompts.length, 2, "parse failure must be retried exactly once");
  assert.match(prompts[1] ?? "", /只返回一个合法 JSON 对象/u);
  assert.equal(session.question.title, "请确认 workhub-app-upload.txt 的验收口径是否只面向真实 App 测试？");
});

test("persistent intake does not retry non-parse LLM failures", async () => {
  // E2E-01① 边界：泛化模板拒稿/服务不可用不是瞬态解析错误，重试也不会改变结论——不重试。
  let createCalls = 0;
  const providerRegistry = {
    isConfigured() {
      return true;
    },
    get() {
      return {
        messages: {
          async create() {
            createCalls += 1;
            return {
              content: [{
                text: JSON.stringify({
                  title: "这件事先按哪种交付方向处理？",
                  body: "请选择文档/方案、结构化数据或小型代码模板。"
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
      return [];
    }
  });

  await assert.rejects(
    () => service.createSession({
      actor,
      locale: "zh-CN",
      payload: { project_id: projectId, intent_text: "整理周报。" }
    }),
    (error) => error instanceof WorkItemServiceError && error.code === "clarification_llm_templated_response"
  );
  assert.equal(createCalls, 1);
});

test("persistent intake writes the clarification analysis trace in the request locale", async () => {
  // E2E-01③：clarification_analysis_error 留痕按 locale 写中/英文，不再硬编码英文。
  const traces: Array<{ kind: string; message: unknown }> = [];
  const repo: WorkItemDataRepository = {
    ...repository(),
    async insertChatMessage(input: InsertStoredChatMessageInput) {
      traces.push({ kind: input.kind, message: (input.contentJson as Record<string, unknown>)["message"] });
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [];
    },
    async clarificationGenerator() {
      throw new Error("provider down");
    }
  });

  for (const locale of ["zh-CN", "en-US"] as const) {
    traces.length = 0;
    await assert.rejects(
      () => service.createSession({
        actor,
        locale,
        payload: { project_id: projectId, intent_text: "整理周报。" }
      }),
      (error) => error instanceof WorkItemServiceError && error.code === "clarification_llm_failed"
    );
    const trace = traces.find((entry) => entry.kind === "clarification_analysis_error");
    assert.ok(trace, "analysis failure must leave a trace");
    assert.match(
      String(trace?.message),
      locale === "en-US" ? /^AI material analysis failed: /u : /^AI 材料分析失败：/u
    );
  }
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

test("real-key evaluation wires the provider registry into WorkItem clarification", async () => {
  const providerRegistry = { isConfigured: () => true } as unknown as ProviderRegistry;
  const context = [{
    name: "workhub-app-upload.txt",
    path: "inputs/workhub-app-upload.txt",
    preview: "真实 App 验收"
  }];
  const options = createR5_10WorkItemServiceOptions(
    providerRegistry,
    new Map([["请根据项目网盘 workhub-app-upload.txt 生成验收要点。", context]])
  );

  // R9.7: the old assertion grepped r5-10-real-key-evaluation.ts for `providerRegistry`.
  // That was wrong because source text did not prove the helper passes the registry and file context at runtime.
  assert.equal(options.providerRegistry, providerRegistry);
  assert.deepEqual(
    await options.projectFileContext?.({ intentText: "请根据项目网盘 workhub-app-upload.txt 生成验收要点。" }),
    context
  );
  assert.deepEqual(await options.projectFileContext?.({ intentText: "没有预置文件的任务" }), []);
});

test("real-key evaluation answers AI clarification with free text before applying task presets", () => {
  const payload = createR5_10ClarificationAnswerPayload("请优先输出适合项目验收的要点。");

  // R9.7: the old assertion grepped request-body source around `/next-question`.
  // That was wrong because source text did not prove the clarification payload omits preset option ids.
  assert.deepEqual(payload, { free_text: "请优先输出适合项目验收的要点。" });
  assert.equal(Object.hasOwn(payload, "selected_option_ids"), false);
});

test("real-key evaluation labels limited samples instead of applying full-suite gates", () => {
  const selected = selectR5_10TasksForRun(["T1", "T2", "T3"], "2");
  const limited = buildR5_10RunScopeSummary({
    limitedRun: selected.limitedRun,
    requestedTaskLimit: selected.requestedTaskLimit,
    taskCount: selected.tasks.length,
    totalTaskCount: 3,
    realProviderSamplePass: true,
    realProviderFullSuitePass: null,
    ledgerPass: false,
    qualityPassCount: 1,
    sampledQualityTotal: 2,
    structuredUpgrade: false,
    budgetGuard: false,
    unsampledGateTasks: ["T5", "B1"]
  });
  const full = buildR5_10RunScopeSummary({
    limitedRun: false,
    requestedTaskLimit: null,
    taskCount: 3,
    totalTaskCount: 3,
    realProviderSamplePass: true,
    realProviderFullSuitePass: true,
    ledgerPass: true,
    qualityPassCount: 3,
    sampledQualityTotal: 3,
    structuredUpgrade: true,
    budgetGuard: true,
    unsampledGateTasks: []
  });

  // R9.7: the old assertion grepped report-source strings for limited/full suite labels.
  // That was wrong because source text did not prove the limit selection or report sections agree.
  assert.deepEqual(selected.tasks, ["T1", "T2"]);
  assert.equal(selected.requestedTaskLimit, 2);
  assert.equal(selected.limitedRun, true);
  assert.deepEqual(limited.reportRunScope, {
    mode: "limited_sample",
    requested_task_limit: 2,
    task_count: 2,
    total_available_tasks: 3,
    full_suite: false
  });
  assert.match(limited.runScope, /limited_sample \(2\/3, R5_10_REAL_TASK_LIMIT=2\)/u);
  assert.equal(limited.markdownGateSummary.includes("## Limited Sample Summary"), true);
  assert.equal(limited.markdownGateSummary.includes("- Ledger sample: fail"), true);
  assert.match(limited.escalationCalibrationNote, /full-suite escalation gates were not asserted/u);
  assert.deepEqual(full.reportRunScope, {
    mode: "full_suite",
    requested_task_limit: null,
    task_count: 3,
    total_available_tasks: 3,
    full_suite: true
  });
  assert.equal(full.markdownGateSummary.includes("## Full Gate Summary"), true);
  assert.equal(full.markdownGateSummary.includes("- G2 real provider: pass"), true);
});

test("real-key evaluation feeds prepared input files into AI clarification", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "workhub-r5-10-context-"));
  await mkdir(join(workdir, "inputs", "nested"), { recursive: true });
  await writeFile(join(workdir, "inputs", "brief.txt"), "  真实   App\n验收  ", "utf8");
  await writeFile(join(workdir, "inputs", "nested", "metrics.csv"), "metric,value\npass,3\n", "utf8");

  const context = await collectR5_10LocalInputFileContext(workdir);

  // R9.7: the old assertion grepped for `localInputFileContext` and the intent map.
  // That was wrong because source text did not prove prepared files become clarification context rows.
  assert.deepEqual(
    context.map((item) => ({ name: item.name, path: item.path, preview: item.preview })),
    [
      { name: "brief.txt", path: "inputs/brief.txt", preview: "真实 App 验收" },
      { name: "metrics.csv", path: "inputs/nested/metrics.csv", preview: "metric,value pass,3" }
    ]
  );
  assert.equal(typeof context[0]?.sizeBytes, "number");
});

test("real-key evaluation keeps resolved work item context in the execution prompt", () => {
  const message = buildR5_10InitialUserMessage({
    runTitle: "生成客户验收要点",
    workItemId: workItemId,
    taskId: "T1",
    taskPrompt: "请根据 inputs/brief.txt 生成验收要点。",
    workItemContext: "用户上传了 workhub-app-upload.txt。"
  });
  const noContext = buildR5_10InitialUserMessage({
    runTitle: "生成客户验收要点",
    workItemId: workItemId,
    taskId: "T1",
    taskPrompt: "请根据 inputs/brief.txt 生成验收要点。"
  });

  // R9.7: the old assertion grepped the queue `initialUserMessage` source.
  // That was wrong because source text did not prove resolved work-item context appears in the actual prompt.
  assert.match(message, /work_item_id: 93000000-0000-4000-8000-000000000201/u);
  assert.match(message, /r5_10_task_id: T1/u);
  assert.match(message, /<work_item_context>\n用户上传了 workhub-app-upload.txt。\n<\/work_item_context>/u);
  assert.match(message, /请根据 inputs\/brief\.txt 生成验收要点。/u);
  assert.doesNotMatch(noContext, /<work_item_context>/u);
});

test("real-key evaluation fails deliverable samples with incomplete confidence reviews", () => {
  // R9.7: the old assertion grepped for `assertRequiredConfidence(...)`.
  // That was wrong because source text did not prove deliverable confidence failures are thrown.
  assert.doesNotThrow(() => assertR5_10RequiredConfidence({ id: "T5", expectedMode: "structured_upgrade" }, null));
  assert.throws(
    () => assertR5_10RequiredConfidence({ id: "T1", expectedMode: "deliverable" }, null),
    /expected a confidence review record/u
  );
  assert.throws(
    () => assertR5_10RequiredConfidence({ id: "T1", expectedMode: "deliverable" }, { verdict: null, score: null }),
    /confidence review is incomplete/u
  );
  assert.doesNotThrow(() =>
    assertR5_10RequiredConfidence({ id: "T1", expectedMode: "deliverable" }, { verdict: "pass", score: "4" })
  );
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
    // CHAT-2②：回答写入走幂等的 replaceSessionClarificationAnswer（upsert），权限拒绝时必须一条都不写。
    async replaceSessionClarificationAnswer() {
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
      && error.message === "你没有权限修改这个任务。"
  );
  assert.equal(answerWritten, false);
});

test("CHAT-06 session readback allows read-only stakeholders once clarification answers exist", async () => {
  // CHAT-06：读路径降为 read 判定——只读干系人可看澄清进度（confirm 阶段 VM）；写路径仍要 mutate。
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

  const session = await service.getSession({
    sessionId: workItemId,
    actor,
    locale: "zh-CN"
  });

  assert.equal(session.session_id, workItemId);
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
    async replaceSessionClarificationAnswer(input: InsertStoredChatMessageInput) {
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

test("confirmation option copy does not leak raw work item statuses", async () => {
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
      return repository().insertChatMessage(input);
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  for (const locale of ["zh-CN", "en-US"] as const) {
    const session = await service.nextQuestion({
      sessionId: workItemId,
      actor,
      locale,
      payload: { free_text: "请按项目网盘材料继续。" }
    });
    const visibleOptionCopy = session.question.options
      .flatMap((option) => [option.label, option.description ?? ""])
      .join("\n");

    assert.doesNotMatch(visibleOptionCopy, /\bspec_ready\b/u);
  }
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
      && error.message === "你没有权限修改这个任务。"
  );
  assert.equal(evidenceBound, false);
});

test("CHAT-05 evidence binding rejects work-item refs that do not exist or are not visible", async () => {
  let evidenceBound = false;
  const referencedWorkItemId = "93000000-0000-4000-8000-000000000902";
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      // actor 是绑定目标事项的提交人（有写权限）。
      return detailRows({ status: "spec_ready", submitterUserId: userId });
    },
    async findWorkItemAccessRecords() {
      // 被引用的事项查不到（不存在/已删除）。
      return new Map();
    },
    async insertChatMessage() {
      evidenceBound = true;
      throw new Error("service must not bind forged evidence refs");
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
          id: referencedWorkItemId,
          source_type: "work_item",
          source_id: "DEMO-902",
          title: "伪造的证据引用",
          href: `/workitems/${referencedWorkItemId}`
        }]
      }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 404
      && error.code === "evidence_ref_not_found"
  );
  assert.equal(evidenceBound, false);
});

test("CHAT-05 evidence binding rejects work-item refs the actor cannot read", async () => {
  let evidenceBound = false;
  const referencedWorkItemId = "93000000-0000-4000-8000-000000000903";
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "spec_ready", submitterUserId: userId });
    },
    async findWorkItemAccessRecords(ids: string[]) {
      // 引用的事项存在，但属于另一个 workspace——actor 不可读。
      return new Map(ids.map((id) => [id, {
        id,
        status: "in_review",
        submitterUserId: "93000000-0000-4000-8000-000000000888",
        claimedByUserId: null,
        workspaceId: "92000000-0000-4000-8000-000000009999",
        project: {
          archived: false,
          deletedAt: null,
          ownerUserId: "93000000-0000-4000-8000-000000000888",
          workspaceId: "92000000-0000-4000-8000-000000009999"
        },
        assignments: []
      }]));
    },
    async insertChatMessage() {
      evidenceBound = true;
      throw new Error("service must not bind evidence refs the actor cannot read");
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
          id: referencedWorkItemId,
          source_type: "work_item",
          source_id: "DEMO-903",
          title: "跨工作区事项的引用",
          href: `/workitems/${referencedWorkItemId}`
        }]
      }
    }),
    (error) =>
      error instanceof WorkItemServiceError
      && error.status === 404
      && error.code === "evidence_ref_not_found"
  );
  assert.equal(evidenceBound, false);
});

test("CHAT-05 evidence binding accepts work-item refs the actor can read", async () => {
  const referencedWorkItemId = "93000000-0000-4000-8000-000000000904";
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "spec_ready", submitterUserId: userId });
    },
    async findWorkItemAccessRecords(ids: string[]) {
      return new Map(ids.map((id) => [id, {
        id,
        status: "in_review",
        submitterUserId: "93000000-0000-4000-8000-000000000888",
        claimedByUserId: null,
        workspaceId: defaultSeedIds.workspaceId,
        project: {
          archived: false,
          deletedAt: null,
          ownerUserId: null,
          workspaceId: defaultSeedIds.workspaceId
        },
        assignments: []
      }]));
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  const detail = await service.bindEvidence({
    workItemId,
    actor,
    locale: "zh-CN",
    payload: {
      evidence_refs: [{
        id: referencedWorkItemId,
        source_type: "work_item",
        source_id: "DEMO-904",
        title: "同工作区可读事项",
        href: `/workitems/${referencedWorkItemId}`
      }]
    }
  });

  assert.equal(detail.workitem.id, workItemId);
});

// R27（真机走查）：一条 phase 是契约外值的 agent_steps 行此前把 /api/pages/workitems/:id 整页打成
// internal_contract_error（500），界面只剩「详情没加载出来 / 重试」。现在那一步被丢掉、其余步骤与整页照常出。
test("一条 phase 脏值的运行步骤只丢自己，任务详情整页照常返回并留下结构化 warn", async () => {
  const runId = "93000000-0000-4000-8000-000000000901";
  const dirtyStepId = "93000000-0000-4000-8000-000000000902";
  const goodStepId = "93000000-0000-4000-8000-000000000903";
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      const rows = detailRows();
      return {
        ...rows,
        agentSteps: [
          {
            id: dirtyStepId,
            agentRunId: runId,
            stepNo: 1,
            phase: "mystery_future_phase",
            inputJson: {},
            toolName: null,
            outputExcerpt: null,
            controlSignal: null,
            snapshotId: null,
            createdAt: now
          },
          {
            id: goodStepId,
            agentRunId: runId,
            stepNo: 2,
            phase: "final",
            inputJson: {},
            toolName: null,
            outputExcerpt: "写完了",
            controlSignal: null,
            snapshotId: null,
            createdAt: now
          }
        ]
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, { now: () => now });

  // 捕获且透传（见 @workhub/tools/test-support）：整段替换 process.stdout.write 会吞掉报告器的 TAP 行。
  const { result: detail, lines } = await captureStdoutLines(() =>
    service.detailPage({ workItemId, actor, locale: "zh-CN" })
  );

  assert.equal(detail.workitem.id, workItemId);
  assert.deepEqual(detail.agent_trace_preview.map((step) => step.id), [goodStepId]);
  const warned = lines.some((line) => {
    try {
      const entry = JSON.parse(line) as { level?: string; event?: string; phase?: string; stepId?: string };
      return entry.level === "warn"
        && entry.event === "work_item_agent_step_dropped_unparsable"
        && entry.phase === "mystery_future_phase"
        && entry.stepId === dirtyStepId;
    } catch {
      return false;
    }
  });
  assert.equal(warned, true, "被丢掉的那一步要留给运维一条结构化 warn");
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
      milestoneId: null,
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

test("R9.2 work item detail exposes task-plan child run visibility and decision jumps", async () => {
  const repo = repository();
  const planId = "93000000-0000-4000-8000-000000000901";
  const researchId = "93000000-0000-4000-8000-000000000902";
  const reviewId = "93000000-0000-4000-8000-000000000903";
  repo.readWorkItemDetail = async () => ({
    ...detailRows({ status: "ai_working", submitterUserId: userId }),
    taskPlan: {
      plan: {
        id: planId,
        workItemId,
        workspaceId: defaultSeedIds.workspaceId,
        status: "dispatching",
        objectiveId: null,
        budgetJson: { total_share_pct: 100, max_cost_cny: "3.000000" },
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
          status: "succeeded",
          createdAt: now,
          updatedAt: now
        },
        {
          id: reviewId,
          planId,
          parentItemId: null,
          seq: 2,
          title: "复核风险",
          role: "review",
          objectiveMd: "确认结论风险。",
          acceptanceMd: "列出风险和是否需要负责人决定。",
          budgetSharePct: 25,
          dependsOn: [researchId],
          status: "failed",
          createdAt: now,
          updatedAt: now
        }
      ],
      itemsCapped: false,
      runs: [
        {
          id: "93000000-0000-4000-8000-000000000911",
          parentRunId: null,
          workItemId,
          workspaceId: defaultSeedIds.workspaceId,
          taskPlanId: planId,
          taskPlanItemId: researchId,
          agentRole: "research",
          title: "整理竞品证据",
          status: "succeeded",
          costEstimate: "0.450000",
          outcomeReason: null,
          createdAt: now,
          updatedAt: now,
          finishedAt: now
        },
        {
          id: "93000000-0000-4000-8000-000000000912",
          parentRunId: null,
          workItemId,
          workspaceId: defaultSeedIds.workspaceId,
          taskPlanId: planId,
          taskPlanItemId: reviewId,
          agentRole: "review",
          title: "复核风险",
          status: "escalated",
          costEstimate: "0.800000",
          outcomeReason: "needs_owner_decision",
          createdAt: now,
          updatedAt: now,
          finishedAt: now
        },
        {
          id: "93000000-0000-4000-8000-000000000913",
          parentRunId: null,
          workItemId,
          workspaceId: "93000000-0000-4000-8000-000000000999",
          taskPlanId: planId,
          taskPlanItemId: reviewId,
          agentRole: "review",
          title: "外部工作区复核",
          status: "succeeded",
          costEstimate: "9.000000",
          outcomeReason: null,
          createdAt: now,
          updatedAt: now,
          finishedAt: now
        }
      ],
      runsCapped: false
    }
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.agent_team?.plan_id, planId);
  // B-R9.6 §3.1：dispatching 计划头行带「暂停派发」控制，指向真实 pause 端点。
  assert.equal(vm.agent_team?.dispatch_control?.kind, "pause");
  assert.equal(vm.agent_team?.dispatch_control?.href, `/api/task-plans/${planId}/pause`);
  assert.equal(vm.agent_team?.completed_count, 1);
  assert.equal(vm.agent_team?.total_count, 2);
  assert.equal(vm.agent_team?.cost_used_cny, "1.250000");
  assert.equal(vm.agent_team?.cost_budget_cny, "3.000000");
  assert.equal(vm.agent_team?.items[0]?.status, "succeeded");
  assert.equal(vm.agent_team?.items[0]?.run_workspace_id, defaultSeedIds.workspaceId);
  assert.equal(vm.agent_team?.items[0]?.action?.href, "/agent-runs/93000000-0000-4000-8000-000000000911/replay");
  assert.equal(vm.agent_team?.items[1]?.status, "needs_human");
  assert.equal(vm.agent_team?.items[1]?.decision_href, "/attention");
  assert.equal(vm.agent_team?.items[1]?.action?.label, "去决策");
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

// R13 批 P4（全托管透明度：reviewer_kind 溯源）：仓库层批量反查好 reviewer_kind 挂在 row 上
// （见 attachAcceptedDeliverableReviewerKind），服务层只需忠实透传到 VM。
test("work item detail threads reviewer_kind onto accepted deliverables from the repository row", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "in_review",
      submitterUserId: "93000000-0000-4000-8000-000000000302",
      claimedByUserId: null
    }),
    acceptedDeliverables: [{ ...acceptedDeliverableRow(), reviewerKind: "ai" }]
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.accepted_deliverables[0]?.reviewer_kind, "ai");
});

test("work item detail leaves reviewer_kind undefined when the repository row has none", async () => {
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

  assert.equal(vm.accepted_deliverables[0]?.reviewer_kind, undefined);
});

// R13 批 P4（观察者工单来源标注）：action_card_items 反查到的会话 id 只在没有既有 drive_comment/meeting_insight
// 来源时才补 conversation_observer 分支——三者互斥（观察者派发从不途经评论/会议）。
test("work item detail surfaces the conversation-observer source when action_card_items links to it", async () => {
  const observerConversationId = "93000000-0000-4000-8000-000000000801";
  const observerCreatedAt = new Date("2026-07-05T00:00:00.000Z");
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "ai_working",
      submitterUserId: "93000000-0000-4000-8000-000000000302",
      claimedByUserId: null
    }),
    observerActionCardItem: {
      conversationId: observerConversationId,
      createdAt: observerCreatedAt
    }
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.source_context?.source_type, "conversation_observer");
  assert.ok(vm.source_context && vm.source_context.source_type === "conversation_observer");
  if (vm.source_context?.source_type === "conversation_observer") {
    assert.equal(vm.source_context.conversation_id, observerConversationId);
    assert.equal(vm.source_context.created_at, observerCreatedAt.toISOString());
  }
  // no draft-to-proposal action makes sense for an observer-created item (no comment/insight body).
  assert.equal(vm.actions.create_proposal_draft, undefined);
});

test("work item detail prefers the drive-comment source over the observer source when both are present", async () => {
  const repo = repository();
  repo.readWorkItemDetail = async () => ({
    ...detailRows({
      status: "in_review",
      submitterUserId: "93000000-0000-4000-8000-000000000302",
      claimedByUserId: null
    }),
    driveSourceComment: {
      comment: {
        id: "93000000-0000-4000-8000-000000000703",
        projectId,
        folderId: null,
        authorUserId: "93000000-0000-4000-8000-000000000302",
        authorNickname: "PM",
        body: "既有网盘评论来源不应被观察者来源覆盖。",
        status: "draft_created",
        llmKind: null,
        llmReason: null,
        draftWorkItemId: workItemId,
        createdAt: now,
        updatedAt: now
      },
      folder: null,
      folderPath: null
    },
    observerActionCardItem: {
      conversationId: "93000000-0000-4000-8000-000000000802",
      createdAt: now
    }
  } as unknown as StoredWorkItemDetailRows);
  const service = createDbWorkItemService(repo, { now: () => now });

  const vm = await service.detailPage({ workItemId, actor, locale: "zh-CN" });

  assert.equal(vm.source_context?.source_type, "drive_comment");
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

test("API-04 createSession refuses clarification generation when the budget gate rejects", async () => {
  let generatorCalls = 0;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({ status: "ai_clarifying", submitterUserId: userId });
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [];
    },
    async clarificationGenerator() {
      generatorCalls += 1;
      return { title: "不应生成的反问" };
    },
    async budgetGate() {
      throw new WorkItemServiceError(429, "budget_exhausted", "团队本期 AI 预算已用完，请追加或上调预算后再试。");
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
      && error.status === 429
      && error.code === "budget_exhausted"
  );
  assert.equal(generatorCalls, 0);
});

test("API-04 createSession does not consult the budget gate when reusing a stored draft", async () => {
  let gateCalls = 0;
  const repo = {
    ...repository(),
    async readWorkItemDetail() {
      return detailRows({
        status: "ai_clarifying",
        submitterUserId: userId,
        title: "写一份团队周会纪要模板",
        rawDescription: "写一份团队周会纪要模板"
      });
    },
    async findLatestChatMessageByKind() {
      return {
        id: "chat-stored",
        workItemId,
        role: "assistant",
        kind: "clarification_question",
        contentJson: { title: "周会纪要模板要覆盖哪些固定栏目？", body: "写一份团队周会纪要模板" },
        selectedOptionKey: null,
        userOtherText: null,
        createdAt: now
      };
    }
  } as unknown as WorkItemDataRepository;
  const service = createDbWorkItemService(repo, {
    now: () => now,
    async projectFileContext() {
      return [];
    },
    async clarificationGenerator() {
      throw new Error("generator must not run when a stored draft is reused");
    },
    async budgetGate() {
      gateCalls += 1;
    }
  });

  const session = await service.createSession({
    actor,
    locale: "zh-CN",
    payload: { work_item_id: workItemId }
  });

  assert.equal(session.session_id, workItemId);
  assert.equal(gateCalls, 0);
});

// R23 P4（R20 P2A 端点上界面）：详情页要渲「认领 / 指派给…」两个按钮，就得先知道当前这个人有没有资格。
// 服务端用与 POST /api/workitems/:id/{claim,assign} 完全相同的谓词算出 can_claim / can_assign 随 VM 下发——
// 若两处各写一份判定，迟早漂移成「看得见点了却 403」或「有权限却没入口」。
test("R23 P4: detailPage ships can_claim/can_assign computed with the same predicates as the write endpoints", async () => {
  const submitterActor: AuthActor = { ...actor, id: userId, userId };
  const detailFor = async (
    rows: StoredWorkItemDetailRows,
    withActor: AuthActor = submitterActor
  ) => {
    const repo = { ...repository(), async readWorkItemDetail() { return rows; } } as unknown as WorkItemDataRepository;
    const service = createDbWorkItemService(repo, { now: () => now });
    return service.detailPage({ workItemId, actor: withActor, locale: "zh-CN" });
  };

  // 提交人 + 可认领状态（spec_ready，无人独占指派）：两个动作都开放。
  const openToSubmitter = await detailFor(detailRows({ status: "spec_ready", submitterUserId: userId }));
  assert.equal(openToSubmitter.can_claim, true);
  assert.equal(openToSubmitter.can_assign, true);

  // in_review 仍可改归属（还在推进中），但已经过了可认领窗口——按钮该有的有、该没的没。
  const inReview = await detailFor(detailRows({ status: "in_review", submitterUserId: userId }));
  assert.equal(inReview.can_claim, false);
  assert.equal(inReview.can_assign, true);

  // 已完成的事项两个动作都关闭——归属不再是可改的东西。
  const done = await detailFor(detailRows({ status: "done", submitterUserId: userId }));
  assert.equal(done.can_claim, false);
  assert.equal(done.can_assign, false);

  // 非提交人、非管理员、也不是现任主责：能看（同工作区非私有态）但不能改归属。
  const otherUserId = "93000000-0000-4000-8000-0000000003ff";
  const stranger: AuthActor = { ...actor, id: otherUserId, userId: otherUserId };
  const notMine = await detailFor(detailRows({ status: "ai_working", submitterUserId: userId }), stranger);
  assert.equal(notMine.can_assign, false);
  assert.equal(notMine.can_claim, false);

  // 管理员在可改归属的状态上恒可指派。
  const adminActor: AuthActor = { ...actor, id: otherUserId, userId: otherUserId, isAdmin: true };
  const asAdmin = await detailFor(detailRows({ status: "ai_working", submitterUserId: userId }), adminActor);
  assert.equal(asAdmin.can_assign, true);
});

// R23 P4（R20 P2A 端点上界面）：assign 写的是 work_item_assignments、不是 claimed_by——详情页 VM 必须把
// 这份名单端出来，否则界面上指派完毫无变化，用户看不出这个动作到底生效没有。
test("R23 P4: detailPage surfaces the assignment roster with display names, lead first", async () => {
  const leadUserId = "93000000-0000-4000-8000-000000000501";
  const helperUserId = "93000000-0000-4000-8000-000000000502";
  const ghostUserId = "93000000-0000-4000-8000-000000000503";
  const detailFor = async (assignments: StoredWorkItemDetailRows["assignments"]) => {
    const rows: StoredWorkItemDetailRows = { ...detailRows({ submitterUserId: userId }), assignments };
    const repo = { ...repository(), async readWorkItemDetail() { return rows; } } as unknown as WorkItemDataRepository;
    const service = createDbWorkItemService(repo, { now: () => now });
    return service.detailPage({ workItemId, actor: { ...actor, id: userId, userId }, locale: "zh-CN" });
  };

  // 没有任何指派：字段整体省略（诚实缺省，前端据此不渲空名单区块），不是端一个空数组出去。
  assert.equal((await detailFor([])).assignees, undefined);

  // 排序：lead 恒在前（谁主责是读者第一眼要找的），同角色内按展示名稳定排序——刷新两次顺序不会变。
  const roster = await detailFor([
    { userId: helperUserId, role: "collaborator", nickname: "阿岚" },
    { userId: leadUserId, role: "lead", nickname: "小拓" }
  ]);
  assert.deepEqual(roster.assignees, [
    { user_id: leadUserId, nickname: "小拓", role: "lead" },
    { user_id: helperUserId, nickname: "阿岚", role: "collaborator" }
  ]);

  // 账号被硬删（join 不到 nickname）：这一行仍要在，只是没有名字——不能因为名字缺席就把被指派人吞掉。
  const ghosted = await detailFor([{ userId: ghostUserId, role: "collaborator", nickname: null }]);
  assert.deepEqual(ghosted.assignees, [{ user_id: ghostUserId, role: "collaborator" }]);

  // 历史脏行的未知角色收口成 collaborator，不让一条脏数据把整页 VM 校验打挂（详情页整个渲不出来）。
  const legacy = await detailFor([{ userId: helperUserId, role: "reviewer", nickname: "阿岚" }]);
  assert.equal(legacy.assignees?.[0]?.role, "collaborator");
});
