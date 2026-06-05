import type { DeliverableChangeManifest } from "../experience.js";

const id = {
  workItem: "11111111-1111-4111-8111-111111111111",
  branch: "22222222-2222-4222-8222-222222222222",
  snapshot: "33333333-3333-4333-8333-333333333333",
  evidence: "44444444-4444-4444-8444-444444444444"
};

const sha = "a".repeat(64);

const baseManifest = {
  version: 0,
  work_item_id: id.workItem,
  branch_id: id.branch,
  author: {
    actor_kind: "ai",
    label: "Cuu"
  },
  base: {
    snapshot_id: id.snapshot,
    created_at: "2026-06-05T00:00:00.000Z"
  },
  checks: [
    { id: "snapshot_exists", label: "Snapshot exists", status: "passed" },
    { id: "artifact_exists", label: "Artifact exists", status: "passed" },
    { id: "evidence_linked", label: "Evidence linked", status: "passed" },
    { id: "revert_available", label: "Revert available", status: "passed" }
  ],
  evidence_refs: [
    {
      id: id.evidence,
      source_type: "work_item",
      source_id: id.workItem,
      title: "Original request",
      confidence_hint: "found"
    }
  ],
  risk: {
    level: "low",
    human_label: "可回滚的低风险改动",
    reversible: true
  },
  rollback: {
    available: true,
    snapshot_id: id.snapshot,
    description: "可回到本次执行前的快照。"
  },
  review: {
    suggested_decision: "needs_human",
    reason_required_on_reject: true
  }
} satisfies Omit<DeliverableChangeManifest, "title" | "summary_md" | "changes">;

export const deliverableManifestFixtures: DeliverableChangeManifest[] = [
  {
    ...baseManifest,
    title: "生成方案文档",
    summary_md: "新增一份 Word 方案草稿。",
    changes: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        target_kind: "binary_doc",
        target_ref: {
          entity_type: "drive_item",
          path: "/outputs/方案草稿.docx",
          sha256_after: sha
        },
        change_type: "generated",
        human_summary: "生成了 Word 方案草稿。",
        preview_ref: { kind: "office_preview", href: "/api/previews/docx-1" }
      }
    ]
  },
  {
    ...baseManifest,
    title: "生成汇报 PPT",
    summary_md: "新增一份汇报用幻灯片。",
    changes: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        target_kind: "slide_deck",
        target_ref: {
          entity_type: "drive_item",
          path: "/outputs/汇报.pptx",
          sha256_after: sha
        },
        change_type: "generated",
        human_summary: "生成了 12 页汇报 PPT。",
        machine_summary: { slide_count_delta: 12 },
        preview_ref: { kind: "office_preview", href: "/api/previews/pptx-1" }
      }
    ]
  },
  {
    ...baseManifest,
    title: "更新数据表",
    summary_md: "新增 CSV 分析结果。",
    changes: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        target_kind: "spreadsheet",
        target_ref: {
          entity_type: "drive_item",
          path: "/outputs/分析结果.csv",
          sha256_after: sha
        },
        change_type: "generated",
        human_summary: "生成了数据分析 CSV。",
        machine_summary: { row_count_delta: 48 },
        preview_ref: { kind: "text", href: "/api/previews/csv-1" }
      }
    ]
  },
  {
    ...baseManifest,
    title: "生成图片素材",
    summary_md: "新增一张绿幕素材图。",
    changes: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        target_kind: "image",
        target_ref: {
          entity_type: "drive_item",
          path: "/outputs/cuu-green.png",
          sha256_after: sha
        },
        change_type: "generated",
        human_summary: "生成了 Cuu 绿幕图。",
        machine_summary: { image_size_after: "1024x1024" },
        preview_ref: { kind: "image", href: "/api/previews/image-1" }
      }
    ]
  },
  {
    ...baseManifest,
    title: "整理交付文件夹",
    summary_md: "创建交付文件夹并放入产物。",
    changes: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        target_kind: "folder",
        target_ref: {
          entity_type: "folder",
          path: "/outputs/release"
        },
        change_type: "created",
        human_summary: "新增 release 文件夹。"
      }
    ]
  },
  {
    ...baseManifest,
    title: "更新工作项字段",
    summary_md: "补充验收标准与截止时间。",
    changes: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        target_kind: "structured_record",
        target_ref: {
          entity_type: "work_item",
          entity_id: id.workItem
        },
        change_type: "updated",
        human_summary: "更新了工作项标题、截止时间与验收项。",
        machine_summary: {
          changed_fields: ["title", "due_at", "acceptance_items"]
        }
      }
    ]
  }
];
