import assert from "node:assert/strict";
import test from "node:test";

import type { AuthActor } from "../middleware/auth.js";
import {
  buildEscalationAttentionItem,
  createEscalationService,
  type EscalationRepository,
  type EscalationServiceRow
} from "./escalations.js";

const now = new Date("2026-07-02T16:00:00.000Z");
const escalationId = "94000000-0000-4000-8000-000000000101";
const workItemId = "94000000-0000-4000-8000-000000000102";
const projectId = "94000000-0000-4000-8000-000000000103";
const userId = "12000000-0000-4000-8000-000000000011";

function actor(): AuthActor {
  return {
    kind: "human",
    id: userId,
    userId,
    label: "r9-runner",
    isAdmin: false,
    orgId: "91000000-0000-4000-8000-000000000001",
    workspaceId: "92000000-0000-4000-8000-000000000001"
  };
}

function row(partial: Partial<EscalationServiceRow> = {}): EscalationServiceRow {
  return {
    id: escalationId,
    workItemId,
    projectId,
    title: "竞品价格调研",
    reasonMd: "AI 对数据来源不确定。",
    trigger: "unqualified",
    suggestedLeadUserId: null,
    createdAt: now,
    resolvedAt: null,
    workItemStatus: "escalated",
    workspaceId: actor().workspaceId,
    ...partial
  };
}

class MemoryEscalationRepository implements EscalationRepository {
  public resolveCalls: Array<{ escalationId: string; targetStatus: string }> = [];

  async findById(id: string) {
    return id === escalationId ? row() : null;
  }

  async listUnresolvedForWorkspace() {
    return [row()];
  }

  async resolveEscalation(input: { escalationId: string; targetStatus: string }) {
    this.resolveCalls.push({ escalationId: input.escalationId, targetStatus: input.targetStatus });
    return row({ resolvedAt: now, workItemStatus: input.targetStatus as EscalationServiceRow["workItemStatus"] });
  }

  async delegateEscalation() {
    return row({ suggestedLeadUserId: "12000000-0000-4000-8000-000000000012" });
  }
}

test("R9.0 escalation attention cards expose three human decisions without raw enum copy", () => {
  const item = buildEscalationAttentionItem(row(), "zh-CN");

  assert.equal(item.kind, "escalation");
  assert.equal(item.priority, "urgent");
  assert.equal(item.source_ref.entity_type, "escalation_event");
  assert.equal(item.title, "《竞品价格调研》卡住了");
  assert.equal(item.reason_text, "AI 对数据来源不确定。");
  assert.deepEqual(item.actions.map((action) => [action.id, action.label, action.method, action.href]), [
    ["escalation_retry", "让它重试", "POST", `/api/escalations/${escalationId}/resolve`],
    ["escalation_pm_mode", "转成我来做", "POST", `/api/escalations/${escalationId}/resolve`],
    ["escalation_cancel", "取消这个子任务", "POST", `/api/escalations/${escalationId}/resolve`]
  ]);
});

test("R9.0 escalation resolve actions map to the work-item state machine", async () => {
  const repository = new MemoryEscalationRepository();
  const service = createEscalationService({ repository, now: () => now });

  await service.resolve(escalationId, actor(), { action: "retry" });
  await service.resolve(escalationId, actor(), { action: "pm_mode" });
  await service.resolve(escalationId, actor(), { action: "cancel" });

  assert.deepEqual(repository.resolveCalls.map((call) => call.targetStatus), [
    "ai_working",
    "pm_mode",
    "cancelled"
  ]);
});
