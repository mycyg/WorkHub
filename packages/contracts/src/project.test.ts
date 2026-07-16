import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_INSTRUCTIONS_MAX_CHARS,
  createPersonalProjectRequestSchema,
  patchProjectInstructionsRequestSchema,
  projectInstructionsVmSchema,
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

// R16 批 W4a（项目级自定义指令）：契约层做「去首尾空白 + 长度上限」——PATCH 载荷的 instructions_md
// 直接链式 .trim().max()，超限走全局 ZodError→422 兜底，不需要服务层另起校验。
test("R16 W4a patchProjectInstructionsRequestSchema trims whitespace and caps at PROJECT_INSTRUCTIONS_MAX_CHARS", () => {
  const trimmed = patchProjectInstructionsRequestSchema.parse({
    instructions_md: "  遇到发布相关的工单，先问一句要不要拉发布负责人。  "
  });
  assert.equal(trimmed.instructions_md, "遇到发布相关的工单，先问一句要不要拉发布负责人。");

  // 留空（含纯空白）必须合法——它是「清空自定义指令」的唯一途径。
  assert.equal(patchProjectInstructionsRequestSchema.parse({ instructions_md: "" }).instructions_md, "");
  assert.equal(patchProjectInstructionsRequestSchema.parse({ instructions_md: "   " }).instructions_md, "");

  // 超限：trim 之后仍超过 4000 字符才算数——纯空白 padding 不能绕过上限。
  const atLimit = "指".repeat(PROJECT_INSTRUCTIONS_MAX_CHARS);
  assert.equal(patchProjectInstructionsRequestSchema.safeParse({ instructions_md: atLimit }).success, true);
  const overLimit = "指".repeat(PROJECT_INSTRUCTIONS_MAX_CHARS + 1);
  assert.equal(patchProjectInstructionsRequestSchema.safeParse({ instructions_md: overLimit }).success, false);
  const paddedButWithinLimit = ` ${atLimit} `;
  assert.equal(
    patchProjectInstructionsRequestSchema.safeParse({ instructions_md: paddedButWithinLimit }).success,
    true,
    "surrounding whitespace must not count toward the cap once trimmed"
  );

  assert.equal(
    patchProjectInstructionsRequestSchema.safeParse({ instructions_md: "ok", extra: 1 }).success,
    false,
    "strict schema must reject unknown fields"
  );
});

test("R16 W4a projectInstructionsVmSchema keeps instructions_md as a plain (never-null) string", () => {
  const parsed = projectInstructionsVmSchema.parse({
    project_id: "90000000-0000-4000-8000-000000000001",
    instructions_md: "",
    updated_at: "2026-07-16T00:00:00.000Z"
  });
  assert.equal(parsed.instructions_md, "");
  assert.equal(
    projectInstructionsVmSchema.safeParse({
      project_id: "90000000-0000-4000-8000-000000000001",
      instructions_md: null,
      updated_at: "2026-07-16T00:00:00.000Z"
    }).success,
    false,
    "VM must not accept null — callers fold the empty/unset case to an empty string"
  );
});
