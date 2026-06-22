import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectRepository } from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import { createProjectService } from "./services/projects.js";

// H1 回归锁：纯非 ASCII（如中文）项目名曾被 slug 化成空串 → 统一落回固定 "pilot-project" slug，
// 而 bootstrap 按 slug 复用 → 用户用中文名「新建项目」会静默落进同一个(甚至 intake 的 pilot)项目。
// 这里用注入的假仓库捕获 service.bootstrapProject 实际派生的 slug 来锁住修复。

// 真实 ProjectRow 是完整建表行；测试只断言捕获的 slug，故给 toProjectVm 会读的字段后按推断行类型 cast。
type ProjectRowT = Awaited<ReturnType<ProjectRepository["bootstrapPilotProject"]>>["project"];

function fakeRepo(): { repo: ProjectRepository; slugs: string[] } {
  const slugs: string[] = [];
  const repo: ProjectRepository = {
    async bootstrapPilotProject(input) {
      slugs.push(input.slug);
      const project = {
        id: `proj-${input.slug}`,
        workspaceId: input.workspaceId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        ownerNickname: input.ownerNickname,
        ownerUserId: input.ownerUserId,
        archived: false,
        createdAt: new Date(0),
        updatedAt: new Date(0)
      } as unknown as ProjectRowT;
      return { project, created: true };
    },
    async listForWorkspace() {
      return [];
    }
  };
  return { repo, slugs };
}

const actor: AuthActor = {
  kind: "human",
  id: "u1",
  label: "Tester",
  userId: "u1",
  isAdmin: false,
  orgId: "o1",
  workspaceId: "w1"
};

test("H1: pure-CJK project names get unique slugs (not the shared pilot-project fallback)", async () => {
  const { repo, slugs } = fakeRepo();
  const service = createProjectService(repo);
  await service.bootstrapProject({ payload: { name: "市场部项目" }, actor });
  await service.bootstrapProject({ payload: { name: "客户成功" }, actor });
  assert.notEqual(slugs[0], "pilot-project");
  assert.match(slugs[0]!, /^project-[0-9a-f]{8}$/u);
  assert.notEqual(slugs[0], slugs[1]); // 不同中文名 → 不同项目（不再静默合并）
});

test("ASCII names still derive a deterministic slug", async () => {
  const { repo, slugs } = fakeRepo();
  await createProjectService(repo).bootstrapProject({ payload: { name: "My Project" }, actor });
  assert.equal(slugs[0], "my-project");
});

test("explicit slug wins (intake pilot idempotency is unaffected)", async () => {
  const { repo, slugs } = fakeRepo();
  await createProjectService(repo).bootstrapProject({ payload: { name: "Pilot Project", slug: "pilot-project" }, actor });
  assert.equal(slugs[0], "pilot-project");
});
