import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createWorkItemRequestSchema,
  useEvidenceForTaskRequestSchema,
  workItemDetailVmSchema,
  type CreateWorkItemRequest,
  type EvidenceRef,
  type UseEvidenceForTaskRequest,
  type WorkItemDetailVM
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getP05GoldPathFixture,
  isP05SessionId,
  isP05WorkItemId,
  p05GoldPathIds
} from "../pages/gold-path.js";

export type WorkItemRoutesDependencies = {
  auth?: AuthDependencySource;
};

async function readJsonBody(c: Context) {
  const text = await c.req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "创建工作项请求不是有效的 JSON。" });
  }
}

function selectedOptionLabels(input: CreateWorkItemRequest) {
  const fixture = getP05GoldPathFixture();
  const optionById = new Map(fixture.question.options.map((option) => [option.id, option]));
  const selectedIds = input.selected_option_ids?.length
    ? input.selected_option_ids
    : fixture.question.recommended_option_ids ?? [];

  const unknownId = selectedIds.find((id) => !optionById.has(id));
  if (unknownId) {
    throw new HTTPException(400, { message: `澄清选项不存在：${unknownId}` });
  }

  return selectedIds
    .map((id) => optionById.get(id)?.label)
    .filter((label): label is string => Boolean(label));
}

function buildCreatedWorkItemDetail(input: CreateWorkItemRequest, submitterUserId: string): WorkItemDetailVM {
  const fixture = getP05GoldPathFixture();
  const selectedLabels = selectedOptionLabels(input);
  const optionText = selectedLabels.length ? `已选择：${selectedLabels.join("、")}。` : "已采用 Cuu 推荐口径。";
  const rawDescription = input.raw_description ?? fixture.workItem.raw_description;
  const title = input.title ?? fixture.workItem.title;
  const {
    latest_confidence_id: _latestConfidenceId,
    delivered_at: _deliveredAt,
    delivery_doc_ready_at: _deliveryDocReadyAt,
    accepted_at: _acceptedAt,
    ...workItemBase
  } = fixture.workItem;

  const detail: WorkItemDetailVM = {
    workitem: {
      ...workItemBase,
      project_id: input.project_id ?? fixture.workItem.project_id,
      submitter_user_id: submitterUserId,
      title,
      raw_description: rawDescription,
      summary_md: `Cuu 已把澄清选项整理成工作项，${optionText}接下来会读取会议、网盘和评论证据。`,
      status: input.kickoff_agent === false ? "spec_ready" : "ai_working",
      version: 2,
      updated_at: new Date().toISOString()
    },
    acceptance: [
      {
        id: "option-first",
        title: "澄清必须点选优先",
        status: "met"
      },
      {
        id: "file-only",
        title: "首发只做 file-only 数字交付物",
        status: "open"
      },
      {
        id: "evidence-bound",
        title: "输出前必须绑定会议/网盘/评论证据",
        status: "open"
      }
    ],
    agent_trace_preview: input.kickoff_agent === false ? [] : fixture.replay.steps.slice(0, 2),
    evidence_refs: fixture.question.evidence_refs ?? fixture.evidenceBubble.evidence_refs.slice(0, 1)
  };

  return workItemDetailVmSchema.parse(detail);
}

function uniqueEvidenceRefs(refs: EvidenceRef[]) {
  const seen = new Set<string>();
  const result: EvidenceRef[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) {
      continue;
    }
    seen.add(ref.id);
    result.push(ref);
  }
  return result;
}

function bindEvidenceAcceptance(acceptance: unknown[], evidenceCount: number) {
  let found = false;
  const mapped = acceptance.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }
    const record = item as Record<string, unknown>;
    if (record.id !== "evidence-bound") {
      return item;
    }
    found = true;
    return {
      ...record,
      status: "met",
      detail: `Cuu 已带回 ${evidenceCount} 条证据引用。`
    };
  });
  if (found) {
    return mapped;
  }
  return [
    ...mapped,
    {
      id: "evidence-bound",
      title: "输出前必须绑定会议/网盘/评论证据",
      status: "met",
      detail: `Cuu 已带回 ${evidenceCount} 条证据引用。`
    }
  ];
}

function buildEvidenceBoundWorkItemDetail(input: UseEvidenceForTaskRequest): WorkItemDetailVM {
  const fixture = getP05GoldPathFixture();
  const evidenceRefs = uniqueEvidenceRefs([...input.evidence_refs, ...fixture.workItemDetail.evidence_refs]);
  const detail: WorkItemDetailVM = {
    ...fixture.workItemDetail,
    workitem: {
      ...fixture.workItemDetail.workitem,
      summary_md: `Cuu 已把 ${input.evidence_refs.length} 条证据绑定到当前任务，下一步会基于这些来源起草交付物。`,
      status: "ai_working",
      updated_at: new Date().toISOString()
    },
    acceptance: bindEvidenceAcceptance(fixture.workItemDetail.acceptance, input.evidence_refs.length),
    evidence_refs: evidenceRefs
  };

  return workItemDetailVmSchema.parse(detail);
}

export function createWorkItemRoutes(deps: WorkItemRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;

  routes.post("/workitems", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createWorkItemRequestSchema.parse(await readJsonBody(c));
    if (payload.session_id && !isP05SessionId(payload.session_id)) {
      throw new HTTPException(404, { message: "没有找到这个澄清会话。" });
    }

    const data = buildCreatedWorkItemDetail(payload, c.var.currentUser.id ?? p05GoldPathIds.user);
    return c.json({ ok: true, data }, 201);
  });

  routes.post("/workitems/:id/evidence-bindings", createCurrentUserMiddleware(authSource), async (c) => {
    if (!isP05WorkItemId(c.req.param("id"))) {
      throw new HTTPException(404, { message: "没有找到这个事项页面。" });
    }
    const payload = useEvidenceForTaskRequestSchema.parse(await readJsonBody(c));
    return c.json({ ok: true, data: buildEvidenceBoundWorkItemDetail(payload) });
  });

  return routes;
}
