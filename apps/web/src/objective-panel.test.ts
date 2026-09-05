import assert from "node:assert/strict";
import test from "node:test";
import type { ObjectiveDetailResponse, ProjectHomeWorkItemVM } from "@workhub/contracts";

import {
  objectiveDetailBodyHtml,
  objectiveDetailErrorHtml,
  objectiveDetailLoadingHtml,
  objectiveListBodyHtml,
  objectiveListErrorHtml,
  objectiveListLoadingHtml,
  objectiveRowHtml,
  type ObjectiveListItem
} from "./objective-panel.js";

const objectiveA: ObjectiveListItem = {
  objective_id: "95000000-0000-4000-8000-000000000001",
  title: "R23 稳定性目标",
  status: "active",
  progress_percent: 40
};

const objectiveB: ObjectiveListItem = {
  objective_id: "95000000-0000-4000-8000-000000000002",
  title: "Reduce review escapes",
  status: "paused",
  progress_percent: 10
};

const openWorkItem: ProjectHomeWorkItemVM = {
  id: "95000000-0000-4000-8000-000000000010",
  code: "WI-1",
  title: "调研竞品",
  status: "ai_working",
  priority: "p1",
  href: "/workitems/95000000-0000-4000-8000-000000000010"
};

function fullDetail(overrides: Partial<ObjectiveDetailResponse> = {}): ObjectiveDetailResponse {
  return {
    objective_id: objectiveA.objective_id,
    title: objectiveA.title,
    description_md: null,
    status: "active",
    progress_percent: 40,
    owner_user_id: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    key_results: [],
    key_results_capped: false,
    linked_work_items: [],
    linked_work_items_capped: false,
    linked_task_plans: [],
    linked_task_plans_capped: false,
    ...overrides
  };
}

// R23 F-01：一行的可见部分 + 相邻的默认折叠详情容器，两者用 objective_id 关联（不依赖兄弟节点顺序）。

test("objectiveRowHtml renders title/status/progress and a link picker when open work items exist", () => {
  const html = objectiveRowHtml(objectiveA, [openWorkItem], "zh-CN");

  assert.match(html, /data-r20-okr-item="95000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /R23 稳定性目标/u);
  assert.match(html, /active/u);
  assert.match(html, /40%/u);
  assert.match(html, /data-r20-okr-link-select/u);
  assert.match(html, /WI-1 · 调研竞品/u);
  assert.match(html, /data-r20-okr-link-submit="true"/u);
  assert.match(html, /data-r23-okr-detail-toggle="true" aria-expanded="false"/u);
  assert.match(html, /详情/u);
  assert.match(html, /data-r23-okr-detail-body="95000000-0000-4000-8000-000000000001" hidden/u);
});

test("objectiveRowHtml falls back to an honest note when the project has no open work items to link", () => {
  const html = objectiveRowHtml(objectiveA, [], "zh-CN");

  assert.doesNotMatch(html, /data-r20-okr-link-select/u);
  assert.match(html, /这个项目暂时没有可关联的进行中任务/u);
});

test("objectiveRowHtml localizes into English", () => {
  const html = objectiveRowHtml(objectiveA, [], "en-US");

  assert.match(html, /No open tasks in this project to link yet\./u);
  assert.match(html, />Details</u);
});

test("objectiveRowHtml escapes untrusted title text", () => {
  const html = objectiveRowHtml({ ...objectiveA, title: "<script>alert(1)</script>" }, [], "zh-CN");

  assert.doesNotMatch(html, /<script>/u);
  assert.match(html, /&lt;script&gt;/u);
});

test("objectiveListBodyHtml renders an honest empty state for a zero-item workspace", () => {
  const html = objectiveListBodyHtml([], false, [], "zh-CN");

  assert.match(html, /data-r20-okr-list-empty="true"/u);
  assert.match(html, /还没有创建目标/u);
});

test("objectiveListBodyHtml renders one row per objective and an honest capped note", () => {
  const html = objectiveListBodyHtml([objectiveA, objectiveB], true, [], "zh-CN");

  assert.match(html, /data-r20-okr-item="95000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /data-r20-okr-item="95000000-0000-4000-8000-000000000002"/u);
  assert.match(html, /data-r20-okr-list-capped="true"/u);
  assert.match(html, /还有更多目标未显示/u);
});

test("objectiveListBodyHtml omits the capped note when the list isn't capped", () => {
  const html = objectiveListBodyHtml([objectiveA], false, [], "zh-CN");

  assert.doesNotMatch(html, /data-r20-okr-list-capped/u);
});

test("objectiveListLoadingHtml and objectiveListErrorHtml distinguish loading, forbidden, and other failures", () => {
  assert.match(objectiveListLoadingHtml("zh-CN"), /data-r20-okr-list-loading="true"/u);
  const forbidden = objectiveListErrorHtml("zh-CN", true);
  assert.match(forbidden, /data-r20-okr-list-forbidden="true"/u);
  assert.doesNotMatch(forbidden, /data-r20-okr-list-retry/u);
  const failed = objectiveListErrorHtml("zh-CN", false);
  assert.match(failed, /data-r20-okr-list-error="true"/u);
  assert.match(failed, /data-r20-okr-list-retry="true"/u);
});

test("objectiveDetailBodyHtml renders honest per-section empty states when nothing is linked", () => {
  const html = objectiveDetailBodyHtml(fullDetail(), "zh-CN");

  assert.match(html, /还没有关键结果/u);
  assert.match(html, /还没有关联的任务。/u);
  assert.match(html, /还没有关联的任务计划。/u);
  assert.doesNotMatch(html, /更多未显示/u);
});

test("objectiveDetailBodyHtml renders key results, linked work items, and linked task plans with capped hints", () => {
  const detail = fullDetail({
    key_results: [{
      id: "95000000-0000-4000-8000-000000000020",
      seq: 0,
      title: "P0 缺陷清零",
      target_value: "0",
      current_value: "2",
      unit: null,
      status: "active",
      progress_percent: 60
    }],
    key_results_capped: true,
    linked_work_items: [{ id: "95000000-0000-4000-8000-000000000021", code: "WI-9", title: "接入 R23 F-01", status: "ai_working" }],
    linked_work_items_capped: false,
    linked_task_plans: [{ id: "95000000-0000-4000-8000-000000000022", work_item_id: "95000000-0000-4000-8000-000000000021", status: "approved", created_at: "2026-09-01T00:00:00.000Z" }],
    linked_task_plans_capped: true
  });

  const html = objectiveDetailBodyHtml(detail, "zh-CN");

  assert.match(html, /P0 缺陷清零/u);
  assert.match(html, /60%/u);
  assert.match(html, /WI-9/u);
  assert.match(html, /接入 R23 F-01/u);
  assert.match(html, /approved/u);
  // capped 只应出现在关键结果与执行计划两段（工作项那段没有 capped）。
  assert.equal((html.match(/更多未显示/gu) ?? []).length, 2);
});

test("objectiveDetailLoadingHtml and objectiveDetailErrorHtml localize into English", () => {
  assert.match(objectiveDetailLoadingHtml("en-US"), /Loading detail…/u);
  const error = objectiveDetailErrorHtml("en-US");
  assert.match(error, /data-r23-okr-detail-error="true"/u);
  assert.match(error, /data-r23-okr-detail-retry="true"/u);
  assert.match(error, /Couldn&#39;t load detail/u);
});
