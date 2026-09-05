import assert from "node:assert/strict";
import test from "node:test";

import { buildDelegateOptionNodes, delegatePickerHref } from "./delegate-options.js";

type FakeOption = { value: string; textContent: string | null };

test("delegate option builder keeps an HTML-shaped nickname as one literal option", () => {
  const created: FakeOption[] = [];
  const createOption = () => {
    const option: FakeOption = { value: "", textContent: null };
    created.push(option);
    return option;
  };
  const nickname = "Alice</option><option value=attacker selected>Attacker";

  const nodes = buildDelegateOptionNodes(createOption, [{
    id: "10000000-0000-4000-8000-0000000000aa",
    nickname,
    is_admin: false
  }], "zh-CN");

  assert.equal(nodes.length, 1);
  assert.equal(created.length, 1);
  assert.equal(nodes[0]?.value, "10000000-0000-4000-8000-0000000000aa");
  assert.equal(nodes[0]?.textContent, nickname);
});

// R23 F-04（升级转交端到端）：一个选人器要提交到哪个 href。决策卡上的选人器自带 href（升级转交
// 只有这一条路）；审批工作台的动作面板是整页共享的一份，按当前选中行推导。两者都没有就返回
// undefined——调用方据此提示「先选一条」，而不是发一个打不通的请求。
test("R23 F-04 the picker's own href wins over the selected approval row", () => {
  const escalationHref = "/api/escalations/30000000-0000-4000-8000-000000000001/delegate";

  assert.equal(delegatePickerHref({ pickerHref: escalationHref }), escalationHref);
  // 卡上的选人器与工作台选中行同时在场时，卡说了算——否则升级卡会把请求发到某条审批上。
  assert.equal(
    delegatePickerHref({
      pickerHref: escalationHref,
      selectedApprovalRespondHref: "/api/approvals/30000000-0000-4000-8000-000000000002/respond"
    }),
    escalationHref
  );
});

test("R23 F-04 with no href of its own, the picker follows the selected approval row", () => {
  assert.equal(
    delegatePickerHref({
      selectedApprovalRespondHref: "/api/approvals/30000000-0000-4000-8000-000000000002/respond"
    }),
    "/api/approvals/30000000-0000-4000-8000-000000000002/delegate"
  );
});

test("R23 F-04 nothing to submit to yields undefined rather than a half-built href", () => {
  assert.equal(delegatePickerHref({}), undefined);
  assert.equal(delegatePickerHref({ pickerHref: "   ", selectedApprovalRespondHref: "" }), undefined);
  assert.equal(delegatePickerHref({ pickerHref: null, selectedApprovalRespondHref: null }), undefined);
  // 选中行的 href 不是审批回应端点时也不硬凑一个 id 出来。
  assert.equal(delegatePickerHref({ selectedApprovalRespondHref: "/api/work-items/x/respond" }), undefined);
});
