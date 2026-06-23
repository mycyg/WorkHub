import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectHomePageVM } from "@workhub/contracts";

import { projectHomeDetailHtml } from "./dashboards.js";

function vm(over: Partial<ProjectHomePageVM> = {}): ProjectHomePageVM {
  return {
    generated_at: "2026-06-23T00:00:00.000Z",
    project: {
      id: "93000000-0000-4000-8000-000000000001",
      name: "R8 Workspace",
      slug: "r8-workspace",
      description: "Pilot delivery",
      owner_label: "owner",
      status: "active"
    },
    summary: { open_work_item_count: 2 },
    drive: {
      file_count: 1,
      recent_files: [
        { id: "20000000-0000-4000-8000-000000000777", name: "客户复盘.md", updated_at: "2026-06-22T00:00:00.000Z", href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
      ]
    },
    open_work_items: [
      { id: "10000000-0000-4000-8000-000000000901", code: "WH-1", title: "Weekly report", status: "in_progress", priority: "urgent", href: "/workitems/10000000-0000-4000-8000-000000000901" }
    ],
    actions: {
      new_task: { id: "new_task", label: "新任务", method: "GET", href: "/intake" },
      open_drive: { id: "open_drive", label: "打开网盘", method: "GET", href: "/drive?project_id=93000000-0000-4000-8000-000000000001" }
    },
    ...over
  };
}

test("S3 desktop project-home detail renders meta, work-item buttons, CTAs and back link", () => {
  const html = projectHomeDetailHtml(vm(), true);
  // 项目元信息
  assert.ok(html.includes("R8 Workspace"), "project name");
  assert.ok(html.includes("Pilot delivery"), "description");
  assert.ok(html.includes("进行中 2"), "open count");
  // 返回项目列表（不死胡同）
  assert.ok(html.includes("data-back-to-projects"), "back-to-projects control");
  // 进行中工作项可点 → 开工作项
  assert.ok(html.includes('data-open-workitem="10000000-0000-4000-8000-000000000901"'), "work item button carries id");
  assert.ok(html.includes("Weekly report"), "work item title");
  // 入口动作：新任务 + 打开网盘（label 取自服务端 VM）
  // S4b: new-task carries the project id + name so intake binds to this project and shows its context
  assert.ok(html.includes('data-open-intake="93000000-0000-4000-8000-000000000001"'), "new-task CTA carries project id");
  assert.ok(html.includes('data-open-intake-name="R8 Workspace"'), "new-task CTA carries project name");
  assert.ok(html.includes('data-open-drive="93000000-0000-4000-8000-000000000001"'), "open-drive carries project id");
  assert.ok(html.includes("新任务") && html.includes("打开网盘"), "localized action labels from VM");
  // 网盘同步是核心：项目主页直呈最近文件
  assert.ok(html.includes("最近文件 1"), "recent files count");
  assert.ok(html.includes("客户复盘.md"), "recent file name");
});

test("S3 desktop project-home shows a +more hint when the true count exceeds the shown list", () => {
  const html = projectHomeDetailHtml(vm({ summary: { open_work_item_count: 50 } }), false);
  assert.ok(html.includes("+49 more open items not shown."), "truncation hint (50 total - 1 shown)");
});

test("S3 desktop project-home shows an empty state when there is no open work", () => {
  const html = projectHomeDetailHtml(vm({ summary: { open_work_item_count: 0 }, open_work_items: [] }), true);
  assert.ok(html.includes("暂无进行中的工作"), "empty state copy");
  // 空态仍保留入口动作（新任务）——不是死胡同
  assert.ok(html.includes("data-open-intake"), "new-task CTA stays in empty state");
});
