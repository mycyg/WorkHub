import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client";

import {
  addDependency,
  attachMilestone,
  createMilestone,
  deleteMilestone,
  fetchProjectTimeline,
  humanizeTimelineError,
  removeDependency,
  updateMilestone,
  type TimelineApiClient
} from "./api.js";

type Call = { path: string; method: string; body: unknown };

function recorder(result: unknown = {}): { client: TimelineApiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: TimelineApiClient = {
    request: <T>(path: string, init: RequestInit = {}) => {
      calls.push({ path, method: init.method ?? "GET", body: init.body });
      return Promise.resolve(result as T);
    }
  };
  return { client, calls };
}

test("fetchProjectTimeline hits the E1 read endpoint with locale", async () => {
  const { client, calls } = recorder({ project: { id: "p1" } });
  await fetchProjectTimeline(client, "p1", "zh-CN");
  assert.equal(calls[0]?.path, "/api/pages/project/p1/timeline?locale=zh-CN");
});

test("milestone CRUD builds the right method + path + body", async () => {
  const { client, calls } = recorder();
  await createMilestone(client, "p1", { title: "M1", due_at: "2026-07-20T00:00:00Z" });
  assert.equal(calls[0]?.path, "/api/projects/p1/milestones");
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.body)), { title: "M1", due_at: "2026-07-20T00:00:00Z" });

  await updateMilestone(client, "p1", "m1", { status: "done" });
  assert.equal(calls[1]?.path, "/api/projects/p1/milestones/m1");
  assert.equal(calls[1]?.method, "PATCH");

  await deleteMilestone(client, "p1", "m1");
  assert.equal(calls[2]?.path, "/api/projects/p1/milestones/m1");
  assert.equal(calls[2]?.method, "DELETE");
});

test("dependency + attach-milestone endpoints", async () => {
  const { client, calls } = recorder();
  await addDependency(client, "wi-a", "wi-b");
  assert.equal(calls[0]?.path, "/api/workitems/wi-a/dependencies");
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.body)), { depends_on: "wi-b" });

  await removeDependency(client, "wi-a", "wi-b");
  assert.equal(calls[1]?.method, "DELETE");

  await attachMilestone(client, "wi-a", "m1");
  assert.equal(calls[2]?.path, "/api/workitems/wi-a/milestone");
  assert.equal(calls[2]?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[2]?.body)), { milestone_id: "m1" });

  await attachMilestone(client, "wi-a", null);
  assert.deepEqual(JSON.parse(String(calls[3]?.body)), { milestone_id: null });
});

test("humanizeTimelineError translates 422 codes bilingually", () => {
  const cycle = new WorkHubApiError(422, "dependency_cycle", "服务端中文原话");
  assert.equal(humanizeTimelineError(cycle, "zh-CN").includes("环"), true);
  assert.equal(humanizeTimelineError(cycle, "en-US").includes("cycle"), true);

  const cross = new WorkHubApiError(422, "dependency_cross_project", "x");
  assert.equal(humanizeTimelineError(cross, "en-US").includes("same project"), true);

  const scope = new WorkHubApiError(422, "milestone_scope_mismatch", "x");
  assert.equal(humanizeTimelineError(scope, "zh-CN").includes("同一个项目"), true);
});

test("humanizeTimelineError: 403 → permission copy; unknown → generic (no Chinese leak into en)", () => {
  const forbidden = new WorkHubApiError(403, "project_forbidden", "无权限");
  assert.equal(humanizeTimelineError(forbidden, "en-US").includes("permission"), true);

  const unknown = new WorkHubApiError(500, "boom", "服务端中文");
  // zh reuses the server message; en gives a generic English line (never the Chinese message).
  assert.equal(humanizeTimelineError(unknown, "zh-CN"), "服务端中文");
  assert.equal(humanizeTimelineError(unknown, "en-US").includes("服务端"), false);

  assert.equal(humanizeTimelineError(new Error("net"), "zh-CN").length > 0, true);
});
