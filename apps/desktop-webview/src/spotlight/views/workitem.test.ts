import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkItemDetailVM } from "@workhub/contracts";

import { detailHtml } from "./workitem.js";

const WI = "10000000-0000-4000-8000-000000000901";

// 只填 detailHtml 实际读取的字段(其余用 cast 省略),与 drive.test 同手法做纯渲染断言。
function vm(over: Partial<WorkItemDetailVM> = {}): WorkItemDetailVM {
  return {
    workitem: { id: WI, code: "WH-1", title: "Weekly report", status: "spec_ready", priority: "normal" },
    agent_trace_preview: [],
    acceptance: [],
    accepted_deliverables: [],
    evidence_refs: [],
    actions: {},
    ...over
  } as unknown as WorkItemDetailVM;
}

test("#22 desktop workitem shows Dispatch only when spec_ready with no proposal/trace", () => {
  assert.ok(detailHtml(vm(), true).includes(`data-wi-run="${WI}"`), "dispatch shown for clean spec_ready");
  // a latest proposal already exists → no re-run button (matches web gate)
  assert.ok(
    !detailHtml(vm({ latest_proposal: { proposal_id: "p", title: "x" } as WorkItemDetailVM["latest_proposal"] }), true).includes("data-wi-run"),
    "no dispatch once a proposal exists"
  );
  // already has trace → no dispatch
  assert.ok(
    !detailHtml(vm({ agent_trace_preview: [{ phase: "think" } as unknown as WorkItemDetailVM["agent_trace_preview"][number]] }), true).includes("data-wi-run"),
    "no dispatch once a run has traced"
  );
  // not spec_ready → no dispatch
  assert.ok(!detailHtml(vm({ workitem: { id: WI, code: "WH-1", title: "t", status: "merged", priority: "normal" } as WorkItemDetailVM["workitem"] }), true).includes("data-wi-run"), "no dispatch when not spec_ready");
});

test("#11 desktop workitem surfaces create-proposal-draft when the action is present", () => {
  const withAction = vm({
    workitem: { id: WI, code: "WH-1", title: "t", status: "intake", priority: "normal" } as WorkItemDetailVM["workitem"],
    actions: { create_proposal_draft: { id: "create_proposal_draft", label: "Draft", method: "POST", href: "/x" } } as WorkItemDetailVM["actions"]
  });
  assert.ok(detailHtml(withAction, true).includes(`data-wi-create-proposal="${WI}"`), "draft button shown when action present");
  assert.ok(!detailHtml(vm(), true).includes("data-wi-create-proposal"), "no draft button without the action");
});

test("desktop workitem latest proposal hides model self narration titles", () => {
  const html = detailHtml(vm({
    latest_proposal: {
      proposal_id: "proposal-1",
      title: "完成了。让我做一个人话总结。"
    } as WorkItemDetailVM["latest_proposal"]
  }), true);

  assert.equal(html.includes("完成了。让我做一个人话总结。"), false);
  assert.match(html, /交付物变更申请/u);
});

test("desktop workitem trace hides hidden reasoning and raw tool payloads", () => {
  const html = detailHtml(vm({
    agent_trace_preview: [
      {
        id: "trace-1",
        agent_run_id: "run-1",
        step_no: 1,
        phase: "think",
        input_json: {},
        output_excerpt: "Now I understand the task and will analyze hidden reasoning.",
        created_at: "2026-06-26T00:00:00.000Z"
      },
      {
        id: "trace-2",
        agent_run_id: "run-1",
        step_no: 2,
        phase: "tool_result",
        tool_name: "read_project_file",
        input_json: {},
        output_excerpt: "--- name: markdown-report description: raw tool payload",
        created_at: "2026-06-26T00:00:01.000Z"
      }
    ] as WorkItemDetailVM["agent_trace_preview"]
  }), true);

  assert.ok(html.includes("AI 正在整理材料，稍后给你下一步。"));
  assert.equal(html.includes("隐藏推理内容"), false);
  assert.ok(html.includes("工具已返回：read_project_file"));
  assert.equal(html.includes("Now I understand"), false);
  assert.equal(html.includes("markdown-report"), false);
});
