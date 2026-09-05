import assert from "node:assert/strict";
import test from "node:test";

import {
  delegateResultSummaryText,
  delegateTargetFromHref,
  isDelegateActionHref,
  submitDelegateAction,
  type DelegateActionClient
} from "./delegate.js";

const approvalId = "20000000-0000-4000-8000-000000000001";
const escalationId = "20000000-0000-4000-8000-000000000002";
const targetUserId = "20000000-0000-4000-8000-0000000000aa";

function recordingClient() {
  const calls: Array<{ method: string; id: string; toUserId: string; locale?: string }> = [];
  const client: DelegateActionClient = {
    async delegateApproval(id, payload) {
      calls.push({ method: "delegateApproval", id, toUserId: payload.to_user_id });
      return { ok: true };
    },
    async delegateEscalation(id, payload, options) {
      calls.push({
        method: "delegateEscalation",
        id,
        toUserId: payload.to_user_id,
        ...(options?.locale ? { locale: options.locale } : {})
      });
      return { attention: { summary_text: "已转交给 Nova" } };
    }
  };
  return { client, calls };
}

test("R23 F-04: delegate href classification names the resource, not just the /delegate suffix", () => {
  assert.deepEqual(delegateTargetFromHref(`/api/approvals/${approvalId}/delegate`), {
    kind: "approval",
    id: approvalId
  });
  assert.deepEqual(delegateTargetFromHref(`/api/escalations/${escalationId}/delegate`), {
    kind: "escalation",
    id: escalationId
  });
  // 绝对 URL 与查询串走同一套 pathname 解析（与 action-payload 的 hrefPathname 同源）。
  assert.deepEqual(delegateTargetFromHref(`https://workhub.example/api/escalations/${escalationId}/delegate?from=card`), {
    kind: "escalation",
    id: escalationId
  });
  assert.deepEqual(delegateTargetFromHref("/api/approvals/a%20b/delegate"), { kind: "approval", id: "a b" });

  // 泛匹配 /\/delegate$/ 会把这些也认成转交，从而路由到错误的 SDK 方法——必须一律不认。
  assert.equal(delegateTargetFromHref("/api/work-items/x/delegate"), undefined);
  assert.equal(delegateTargetFromHref("/api/escalations/x/y/delegate"), undefined);
  assert.equal(delegateTargetFromHref(`/api/approvals/${approvalId}/respond`), undefined);
  assert.equal(delegateTargetFromHref("/delegate"), undefined);

  assert.equal(isDelegateActionHref(`/api/escalations/${escalationId}/delegate`), true);
  assert.equal(isDelegateActionHref(`/api/escalations/${escalationId}/resolve`), false);
});

test("R23 F-04: submit routes each resource to its own SDK method, escalation carrying locale", async () => {
  const { client, calls } = recordingClient();

  await submitDelegateAction(client, `/api/approvals/${approvalId}/delegate`, targetUserId, { locale: "en-US" });
  await submitDelegateAction(client, `/api/escalations/${escalationId}/delegate`, targetUserId, { locale: "en-US" });

  assert.deepEqual(calls, [
    { method: "delegateApproval", id: approvalId, toUserId: targetUserId },
    { method: "delegateEscalation", id: escalationId, toUserId: targetUserId, locale: "en-US" }
  ]);
});

test("R23 F-04: submit stays out of the way when the href is not a delegate or nobody is picked", async () => {
  const { client, calls } = recordingClient();

  assert.equal(submitDelegateAction(client, `/api/escalations/${escalationId}/resolve`, targetUserId), undefined);
  assert.equal(submitDelegateAction(client, `/api/escalations/${escalationId}/delegate`, ""), undefined);
  assert.equal(calls.length, 0);
});

test("R23 F-04: the receipt's own wording wins, and a shapeless receipt just yields nothing", () => {
  assert.equal(delegateResultSummaryText({ attention: { summary_text: "已转交给 Nova" } }), "已转交给 Nova");
  assert.equal(delegateResultSummaryText({ attention: { summary_text: 7 } }), undefined);
  assert.equal(delegateResultSummaryText({ ok: true }), undefined);
  assert.equal(delegateResultSummaryText(undefined), undefined);
  assert.equal(delegateResultSummaryText(null), undefined);
});
