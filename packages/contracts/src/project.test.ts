import assert from "node:assert/strict";
import test from "node:test";

import {
  createPersonalProjectRequestSchema,
  projectListItemVmSchema,
  projectVmSchema
} from "./domain/project.js";

const baseProject = {
  id: "90000000-0000-4000-8000-000000000001",
  workspace_id: "90000000-0000-4000-8000-000000000000",
  name: "星尘短剧",
  slug: "xingchen",
  owner_nickname: "阿曼",
  owner_user_id: "90000000-0000-4000-8000-000000000002"
};

// R13 批 S3（个人空间）：is_personal 是 additive 字段——省略必须仍然合法（既有客户端/既有测试
// fixture 不需要跟着改），显式 true/false 也都要通过。
test("R13 S3 project VM keeps is_personal optional (additive contract, old callers unaffected)", () => {
  assert.equal(projectVmSchema.safeParse(baseProject).success, true, "omitting is_personal must remain valid");
  assert.equal(
    projectVmSchema.safeParse({ ...baseProject, is_personal: true }).success,
    true,
    "personal project rows must validate"
  );
  assert.equal(
    projectVmSchema.safeParse({ ...baseProject, is_personal: false }).success,
    true,
    "explicit false must validate"
  );
  const parsed = projectVmSchema.parse({ ...baseProject, is_personal: true });
  assert.equal(parsed.is_personal, true);
});

test("R13 S3 project list item VM (extends project VM) also carries the optional is_personal flag", () => {
  const listItem = {
    ...baseProject,
    is_personal: true,
    archived: false,
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    open_work_item_count: 0
  };
  const parsed = projectListItemVmSchema.parse(listItem);
  assert.equal(parsed.is_personal, true);
});

test("R13 S3 createPersonalProjectRequestSchema accepts an omitted or blank-trimmed name and rejects an actually blank one", () => {
  assert.equal(createPersonalProjectRequestSchema.parse({}).name, undefined, "no name → server auto-names it");
  assert.equal(createPersonalProjectRequestSchema.parse({ name: "读论文" }).name, "读论文");
  assert.equal(createPersonalProjectRequestSchema.safeParse({ name: "   " }).success, false, "whitespace-only name is rejected");
  assert.equal(createPersonalProjectRequestSchema.safeParse({ name: "a".repeat(129) }).success, false, "name over 128 chars is rejected");
});
