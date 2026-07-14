// 测试夹具：一份结构完整的 ProposalDetailVM（render.test.ts / panel.test.ts 共用——不放在任何 *.test.ts
// 里避免 node --test 的文件粒度运行器把被 import 的测试文件重复注册一遍）。
import type { ActionSpec, ProposalDetailVM } from "@workhub/contracts";

export function proposalActionSpec(over: Partial<ActionSpec> & { id: string; label: string }): ActionSpec {
  return {
    method: "POST",
    href: `/api/proposals/prop-1/${over.id}`,
    ...over
  };
}

export function proposalVm(over: Partial<ProposalDetailVM> = {}): ProposalDetailVM {
  return {
    proposal_id: "prop-1",
    work_item_id: "wi-1",
    title: "选题报告 · 第三节(草稿)",
    status: "opened",
    manifest: {
      version: 0,
      work_item_id: "wi-1",
      title: "选题报告 · 第三节(草稿)",
      summary_md: "补齐了第三节的论证链，引用了两份新调研。",
      author: { actor_kind: "ai", label: "WorkHub AI" },
      base: {},
      changes: [
        {
          id: "chg-1",
          target_kind: "text_doc",
          target_ref: { entity_type: "drive_item", path: "/outputs/report.md" },
          change_type: "updated",
          human_summary: "重写第三节的论证结构",
          machine_summary: { before_excerpt: "旧的第三节开头", after_excerpt: "新的第三节开头" }
        }
      ],
      checks: [
        { id: "ck-1", label: "结构完整", status: "passed" },
        { id: "ck-2", label: "引用可溯", status: "warning", detail: "两处引用待人工核对" }
      ],
      evidence_refs: [],
      risk: { level: "medium", human_label: "中风险 · 可回滚", reversible: true },
      rollback: { available: true, description: "留有快照，可回滚。" },
      review: { reason_required_on_reject: true }
    },
    evidence_refs: [],
    review_actions: {
      approve: proposalActionSpec({ id: "approve", label: "确认通过" }),
      request_changes: proposalActionSpec({ id: "request_changes", label: "打回修改", requires_reason: true })
    },
    comments: [],
    ...over
  };
}
