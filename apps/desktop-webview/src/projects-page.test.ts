import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectListVM } from "@workhub/contracts";

import { renderProjectsListHtml, projectsPageCss } from "./projects-page.js";

function project(partial: Partial<ProjectListVM["projects"][number]> = {}): ProjectListVM["projects"][number] {
  return {
    id: "62000000-0000-4000-8000-000000000020",
    workspace_id: "62000000-0000-4000-8000-000000000001",
    name: "渠道增长",
    slug: "growth",
    owner_nickname: "阿橘",
    owner_user_id: "62000000-0000-4000-8000-000000000002",
    archived: false,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    open_work_item_count: 3,
    ...partial
  };
}

function page(projects: ProjectListVM["projects"]): ProjectListVM {
  return { generated_at: "2026-06-15T00:00:00.000Z", projects };
}

test("projects page renders the empty state when there are no projects", () => {
  const html = renderProjectsListHtml({ page: page([]), locale: "zh-CN" });
  assert.match(html, /data-proj-empty="true"/u);
  assert.match(html, /还没有项目/u);
  assert.doesNotMatch(html, /wh-proj-card/u);
});

test("projects page renders a clickable glass card with name, active count, owner and slug", () => {
  const html = renderProjectsListHtml({
    page: page([project({ description: "把自然增长跑起来" })]),
    locale: "zh-CN"
  });
  assert.match(html, /data-proj-count="1"/u);
  assert.match(html, /渠道增长/u);
  // 整卡可点 + 携带下钻所需属性
  assert.match(html, /class="wh-proj-card gl-press"[^>]*data-project-id="62000000-0000-4000-8000-000000000020"[^>]*data-project-slug="growth"/u);
  assert.match(html, /wh-proj-count--active">3 个进行中</u);
  assert.match(html, /把自然增长跑起来/u);
  assert.match(html, /负责人 · 阿橘/u);
  // 顶部概览 chip:1 个项目 + 3 进行中
  assert.match(html, /wh-proj-chip"><b>1<\/b>个项目/u);
  assert.match(html, /wh-proj-chip wh-proj-chip--active"><b>3<\/b>进行中/u);
});

test("projects page shows the all-clear count and localizes (en)", () => {
  const html = renderProjectsListHtml({
    page: page([project({ open_work_item_count: 0 })]),
    locale: "en-US"
  });
  assert.match(html, />All clear</u);
  assert.doesNotMatch(html, /wh-proj-count--active/u);
  assert.match(html, /Owner · 阿橘/u);
  assert.match(html, /<b>0<\/b>active/u);
  assert.ok(projectsPageCss.includes(".wh-proj-card{"));
});
