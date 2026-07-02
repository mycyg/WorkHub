import { randomUUID } from "node:crypto";

import type { LlmActor } from "@workhub/agent/providers";
import {
  getSharedDatabaseClient,
  createTaskPlanRepository,
  type CreateDraftTaskPlanInput,
  type TaskPlanRow
} from "@workhub/db";
import type {
  DeliverableChangeManifest,
  TaskPlanItemRole,
  WorkHubLocale,
  WorkItemDetailVM
} from "@workhub/contracts";

import { getDefaultProviderRegistry } from "./provider-registry.js";
import { createMetaPlanner, type MetaPlanner, type MetaPlannerDraftItem } from "./meta-planner.js";
import { getDefaultObjectiveService, type ObjectiveService } from "./objectives.js";
import {
  getDefaultProposalService,
  type ProposalService,
  type StoredProposal
} from "./proposals.js";
export {
  createTaskPlanMergeApprovalHandler,
  TaskPlanApprovalError
} from "./task-plan-approval.js";

type JsonObject = Record<string, unknown>;

export class TaskPlanServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type TaskPlanWorkflowRepository = {
  createDraftPlan: (input: CreateDraftTaskPlanInput) => Promise<void>;
  cancelDraftPlan: (input: { planId: string; workspaceId: string; cancelledAt?: Date }) => Promise<TaskPlanRow | null>;
  approvePlan: (input: { planId: string; workspaceId: string; approvedAt?: Date }) => Promise<TaskPlanRow | null>;
};

export type CreateTaskPlanProposalInput = {
  detail: WorkItemDetailVM;
  actor: LlmActor;
  locale?: WorkHubLocale;
  memories?: {
    user?: string[];
    team?: string[];
    objectives?: string[];
  };
};

export type CreateTaskPlanProposalResult = {
  planId: string;
  proposal: StoredProposal;
};

export type TaskPlanWorkflowService = {
  createPlanProposal: (input: CreateTaskPlanProposalInput) => Promise<CreateTaskPlanProposalResult>;
};

export type TaskPlanWorkflowOptions = {
  taskPlans: TaskPlanWorkflowRepository;
  proposals: Pick<ProposalService, "createFromManifest">;
  planner: MetaPlanner;
  objectives?: Pick<ObjectiveService, "planningContextForWorkItem">;
  id?: () => string;
  now?: () => Date;
};

function acceptanceText(input: readonly unknown[]) {
  return input
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const key of ["body_md", "body", "title", "label", "text"]) {
          const value = record[key];
          if (typeof value === "string" && value.trim()) {
            return value.trim();
          }
        }
      }
      return "";
    })
    .filter(Boolean);
}

function planMarkdown(items: readonly MetaPlannerDraftItem[]) {
  return items.map((item, index) => [
    `${index + 1}. ${item.title} (${item.role})`,
    `   Objective: ${item.objectiveMd}`,
    `   Acceptance: ${item.acceptanceMd}`,
    `   Budget: ${item.budgetSharePct}%`,
    item.dependsOn.length ? `   Depends on: ${item.dependsOn.join(", ")}` : undefined
  ].filter(Boolean).join("\n")).join("\n\n");
}

function taskPlanManifest(input: {
  planId: string;
  workspaceId: string;
  workItemId: string;
  items: readonly MetaPlannerDraftItem[];
  createdAt: Date;
}): DeliverableChangeManifest {
  const markdown = planMarkdown(input.items);
  return {
    version: 0,
    work_item_id: input.workItemId,
    title: "计划提议",
    summary_md: "请先确认这份任务拆解计划，通过后 WorkHub 才会进入派发。",
    author: {
      actor_kind: "ai",
      label: "WorkHub Meta-Planner"
    },
    base: {
      created_at: input.createdAt.toISOString()
    },
    changes: [{
      id: input.planId,
      target_kind: "structured_record",
      target_ref: {
        entity_type: "task_plan",
        entity_id: input.planId,
        path: `/workspaces/${input.workspaceId}/task-plans/${input.planId}`
      },
      change_type: "generated",
      human_summary: "新增可审的任务计划草稿。",
      machine_summary: {
        changed_fields: ["task_plan_items", "budget_share_pct", "depends_on"],
        generated_content_md: markdown
      }
    }],
    checks: [
      {
        id: "structure",
        label: "结构校验",
        status: "passed",
        detail: "每个子任务都有验收标准，依赖无环，预算份额合计 100。"
      },
      {
        id: "judge",
        label: "LLM judge 快评",
        status: "passed",
        detail: "计划已通过快速复核，仍需人审后才能派发。"
      }
    ],
    evidence_refs: [],
    risk: {
      level: "low",
      human_label: "低风险：这里只批准计划，不直接改交付物。",
      reversible: true
    },
    rollback: {
      available: false,
      description: "计划未派发前可重新生成；通过后可在后续派发阶段取消。"
    },
    review: {
      suggested_decision: "needs_human",
      reason_required_on_reject: true
    }
  };
}

function toCreateItems(items: readonly MetaPlannerDraftItem[]) {
  return items.map((item) => ({
    id: item.id,
    seq: item.seq,
    title: item.title,
    role: item.role as TaskPlanItemRole,
    objectiveMd: item.objectiveMd,
    acceptanceMd: item.acceptanceMd,
    budgetSharePct: item.budgetSharePct,
    dependsOn: item.dependsOn
  }));
}

export function createTaskPlanWorkflowService(options: TaskPlanWorkflowOptions): TaskPlanWorkflowService {
  const nextId = options.id ?? randomUUID;
  const now = options.now ?? (() => new Date());
  return {
    async createPlanProposal(input) {
      const workItem = input.detail.workitem;
      const workspaceId = workItem.workspace_id ?? input.actor.workspaceId;
      const createdByUserId = input.actor.userId ?? input.actor.id;
      if (!workspaceId) {
        throw new TaskPlanServiceError(422, "task_plan_workspace_missing", "这个事项缺少工作区，不能生成任务计划。");
      }
      if (!createdByUserId) {
        throw new TaskPlanServiceError(403, "task_plan_actor_missing", "缺少计划创建人，不能生成任务计划。");
      }
      const objectiveContext = options.objectives
        ? await options.objectives.planningContextForWorkItem({ workspaceId, workItemId: workItem.id })
        : { lines: [], capped: false };
      const memories = {
        ...(input.memories ?? {}),
        ...(objectiveContext.lines.length > 0 ? { objectives: objectiveContext.lines } : {})
      };
      const draft = await options.planner.createDraft({
        actor: {
          ...input.actor,
          userId: createdByUserId,
          workspaceId,
          workItemId: workItem.id
        },
        ...(input.locale ? { locale: input.locale } : {}),
        workItem: {
          id: workItem.id,
          workspaceId,
          ...(workItem.title ? { title: workItem.title } : {}),
          ...(workItem.raw_description ? { rawDescription: workItem.raw_description } : {}),
          ...(workItem.summary_md ? { summaryMd: workItem.summary_md } : {})
        },
        acceptance: acceptanceText(input.detail.acceptance),
        ...(Object.keys(memories).length > 0 ? { memories } : {})
      });
      const planId = nextId();
      const createdAt = now();
      const budgetJson: JsonObject = {
        total_share_pct: draft.items.reduce((sum, item) => sum + item.budgetSharePct, 0)
      };
      await options.taskPlans.createDraftPlan({
        id: planId,
        workItemId: workItem.id,
        workspaceId,
        budgetJson,
        decompositionContextJson: draft.decompositionContext,
        createdByUserId,
        items: toCreateItems(draft.items),
        now: createdAt
      });
      const manifest = taskPlanManifest({
        planId,
        workspaceId,
        workItemId: workItem.id,
        items: draft.items,
        createdAt
      });
      let proposal: StoredProposal;
      try {
        proposal = await options.proposals.createFromManifest({
          workItemId: workItem.id,
          manifest,
          actor: {
            actor_kind: "ai",
            label: "WorkHub Meta-Planner"
          },
          title: "计划提议"
        });
      } catch (error) {
        await options.taskPlans.cancelDraftPlan({
          planId,
          workspaceId,
          cancelledAt: now()
        });
        throw error;
      }
      return {
        planId,
        proposal
      };
    }
  };
}

let defaultTaskPlanWorkflowService: TaskPlanWorkflowService | undefined;

export function getDefaultTaskPlanWorkflowService() {
  if (!defaultTaskPlanWorkflowService) {
    defaultTaskPlanWorkflowService = createTaskPlanWorkflowService({
      taskPlans: createTaskPlanRepository(getSharedDatabaseClient().db),
      proposals: getDefaultProposalService(),
      planner: createMetaPlanner({ providerRegistry: getDefaultProviderRegistry() }),
      objectives: getDefaultObjectiveService()
    });
  }
  return defaultTaskPlanWorkflowService;
}
