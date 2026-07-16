import assert from "node:assert/strict";
import test from "node:test";

import {
  ProjectSlugOccupiedError,
  createProjectRepository,
  type ProjectRow
} from "./repositories/projects.js";
import { orgs, projectAiGovernance, projectConversations, projects, workItems, workspaces } from "./schema/index.js";
import {
  createQueryRecorder,
  queryParamValues,
  queryReferences,
  type RecordedQuery
} from "./test-query-recorder.js";

const now = new Date("2026-07-12T08:00:00.000Z");
const orgId = "12000000-0000-4000-8000-000000000001";
const workspaceId = "12000000-0000-4000-8000-000000000002";
const projectId = "12000000-0000-4000-8000-000000000003";
const requestOwnerUserId = "12000000-0000-4000-8000-000000000004";
const existingOwnerUserId = "12000000-0000-4000-8000-000000000005";

const input = {
  orgId,
  workspaceId,
  projectId,
  name: "桌面工作台",
  slug: "desktop-workbench",
  description: "R12",
  ownerNickname: "owner",
  ownerUserId: requestOwnerUserId,
  at: now
};

function project(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: projectId,
    workspaceId,
    name: input.name,
    slug: input.slug,
    description: input.description,
    ownerNickname: input.ownerNickname,
    ownerUserId: requestOwnerUserId,
    archived: false,
    deletedAt: null,
    deletedByNickname: null,
    nextSeq: 0,
    isPersonal: false,
    // R15 批 B：projects 加了 is_dm_container 列——普通项目固定 false（容器项目不经这条 fixture）。
    isDmContainer: false,
    // R16 批 W4a：projects 加了 instructions_md 列——大多数 fixture 场景不关心它，默认空。
    instructionsMd: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function mainInsert(queries: RecordedQuery[]) {
  return queries.find(
    (query) => query.operation === "insert" && query.targetTable === projectConversations
  );
}

function assertMainInsert(
  query: RecordedQuery | undefined,
  expectedCreator: string,
  expectedProjectId = projectId
) {
  assert.ok(query, "expected an active main conversation insert");
  assert.ok(query.steps.includes("onConflictDoNothing"));
  const values = query.valuesValue as Record<string, unknown>;
  assert.match(String(values["id"]), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(values["workspaceId"], workspaceId);
  assert.equal(values["projectId"], expectedProjectId);
  assert.equal(values["kind"], "main");
  assert.equal(values["title"], "主区");
  assert.equal(values["visibility"], "project");
  assert.equal(values["nextSeq"], 0);
  assert.equal(values["createdBy"], expectedCreator);
  assert.equal(values["createdAt"], now);
  assert.equal(values["updatedAt"], now);

  const conflict = query.onConflict as { target?: unknown; where?: unknown };
  assert.ok(queryReferences(conflict.target, projectConversations.projectId));
  assert.ok(queryReferences(conflict.where, projectConversations.kind));
  assert.ok(queryReferences(conflict.where, projectConversations.deletedAt));
  assert.ok(queryParamValues(conflict.where).includes("main"));
}

test("R12 project bootstrap creates a project and its main conversation in one transaction", async () => {
  const createdProject = project();
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [],
    [createdProject],
    [{ id: "12000000-0000-4000-8000-000000000006" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, true);
  assert.equal(result.project.id, projectId);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.deepEqual(queries.map((query) => query.targetTable ?? query.fromTable), [
    orgs,
    workspaces,
    projects,
    projects,
    projectConversations
  ]);
  assertMainInsert(mainInsert(queries), requestOwnerUserId);
});

test("R12 project bootstrap repairs an existing active project without a main before returning", async () => {
  const existing = project({ ownerUserId: existingOwnerUserId });
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [existing],
    [{ id: "12000000-0000-4000-8000-000000000007" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, false);
  assert.equal(result.project.id, projectId);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assertMainInsert(mainInsert(queries), existingOwnerUserId);
});

test("R12 project bootstrap does not duplicate an existing active main", async () => {
  const existing = project({ ownerUserId: null });
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [existing],
    [],
    [{ id: "12000000-0000-4000-8000-000000000008" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, false);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.filter((query) => query.targetTable === projectConversations).length, 1);
  const conversationRead = queries.find((query) => query.fromTable === projectConversations);
  assert.equal(conversationRead?.limit, 1);
  assert.ok(queryReferences(conversationRead?.where, projectConversations.projectId));
  assert.ok(queryReferences(conversationRead?.where, projectConversations.workspaceId));
  assert.ok(queryReferences(conversationRead?.where, projectConversations.kind));
  assert.ok(queryReferences(conversationRead?.where, projectConversations.deletedAt));
  assertMainInsert(mainInsert(queries), requestOwnerUserId);
});

test("R12 project insert race loser re-reads the project and repairs its active main", async () => {
  const raced = project({ id: "12000000-0000-4000-8000-000000000009" });
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [],
    [],
    [raced],
    [],
    [{ id: "12000000-0000-4000-8000-000000000010" }]
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPilotProject(input);

  assert.equal(result.created, false);
  assert.equal(result.project.id, raced.id);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  assert.equal(queries.filter((query) => query.fromTable === projects).length, 2);
  assertMainInsert(mainInsert(queries), requestOwnerUserId, raced.id);
});

test("R12 project bootstrap rejects the transaction when a main conflict cannot be resolved", async () => {
  const existing = project();
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [existing],
    [],
    []
  ]);
  const repository = createProjectRepository(db);

  await assert.rejects(
    repository.bootstrapPilotProject(input),
    /active main conversation conflict could not be resolved/u
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  assert.equal(queries.filter((query) => query.fromTable === projectConversations).length, 1);
});

test("R12 archived or deleted slug occupancy remains typed and never inserts a main", async () => {
  const { db, queries, transactions } = createQueryRecorder([
    [],
    [],
    [],
    [],
    []
  ]);
  const repository = createProjectRepository(db);

  await assert.rejects(
    repository.bootstrapPilotProject(input),
    (error: unknown) => error instanceof ProjectSlugOccupiedError && error.slug === input.slug
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  assert.equal(queries.some((query) => query.targetTable === projectConversations), false);
});

// R13 批 S3（个人空间）——团队项目列表必须把 is_personal=true 的行过滤掉，否则个人空间会混进
// 「项目」分组（设计稿明确要求两个列表互斥，见 01-new-batches-design.md 第五节验收门）。
test("R13 S3 listForWorkspace excludes personal projects from the team project list", async () => {
  const { db, queries } = createQueryRecorder([[project()]]);
  const repository = createProjectRepository(db);

  const rows = await repository.listForWorkspace(workspaceId);

  assert.equal(rows.length, 1);
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  assert.equal(query?.joins[0]?.table, workItems);
  assert.ok(queryReferences(query?.where, projects.isPersonal), "team list must filter on projects.isPersonal");
  assert.ok(queryParamValues(query?.where).includes(false), "team list must require isPersonal = false");
});

test("R13 S3 listPersonalForUser scopes to the owner, the workspace, and is_personal=true only", async () => {
  const personalProject = project({ isPersonal: true, ownerUserId: requestOwnerUserId });
  const { db, queries } = createQueryRecorder([[personalProject]]);
  const repository = createProjectRepository(db);

  const rows = await repository.listPersonalForUser({ workspaceId, ownerUserId: requestOwnerUserId });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, personalProject.id);
  const query = queries[0];
  assert.equal(query?.fromTable, projects);
  for (const column of [projects.workspaceId, projects.ownerUserId, projects.isPersonal, projects.archived]) {
    assert.ok(queryReferences(query?.where, column), `missing personal-list predicate for ${String(column)}`);
  }
  const params = queryParamValues(query?.where);
  assert.ok(params.includes(workspaceId));
  assert.ok(params.includes(requestOwnerUserId));
  assert.ok(params.includes(true));
  // 排序：按创建时间升序——「我的空间」在「我的空间 2」之前，符合创建先后。
  assert.equal(query?.orderBy.length, 1);
});

test("R13 S3 bootstrapPersonalProject creates a personal project, its main conversation, and turns the 60s observer off", async () => {
  const createdProject = project({ isPersonal: true, ownerUserId: requestOwnerUserId });
  const { db, queries, transactions } = createQueryRecorder([
    [createdProject],
    [{ id: "12000000-0000-4000-8000-000000000011" }],
    []
  ]);
  const repository = createProjectRepository(db);

  const result = await repository.bootstrapPersonalProject({
    workspaceId,
    name: "我的空间",
    slug: "personal-space",
    ownerNickname: input.ownerNickname,
    ownerUserId: requestOwnerUserId,
    at: now
  });

  assert.equal(result.created, true);
  assert.equal(result.project.id, createdProject.id);
  assert.deepEqual(transactions, [{ outcome: "resolved" }]);
  const projectInsert = queries.find((query) => query.operation === "insert" && query.targetTable === projects);
  assert.ok(projectInsert, "expected a projects insert");
  const insertedValues = projectInsert.valuesValue as Record<string, unknown>;
  assert.equal(insertedValues["isPersonal"], true);
  assert.equal(insertedValues["workspaceId"], workspaceId);
  assert.equal(insertedValues["ownerUserId"], requestOwnerUserId);
  assertMainInsert(mainInsert(queries), requestOwnerUserId, createdProject.id);
  const governanceInsert = queries.find(
    (query) => query.operation === "insert" && query.targetTable === projectAiGovernance
  );
  assert.ok(governanceInsert, "expected a project_ai_governance insert turning the observer off");
  const governanceValues = governanceInsert.valuesValue as Record<string, unknown>;
  assert.equal(governanceValues["projectId"], createdProject.id);
  assert.equal(governanceValues["observerEnabled"], false, "personal space observer must default off (user拍板)");
  assert.ok(governanceInsert.steps.includes("onConflictDoNothing"));
});

test("R13 S3 bootstrapPersonalProject never reuses another project on a slug conflict (no find-or-reuse semantics)", async () => {
  const { db, queries, transactions } = createQueryRecorder([[]]);
  const repository = createProjectRepository(db);

  await assert.rejects(
    repository.bootstrapPersonalProject({
      workspaceId,
      name: "我的空间",
      slug: "personal-space",
      ownerNickname: input.ownerNickname,
      ownerUserId: requestOwnerUserId,
      at: now
    }),
    (error: unknown) => error instanceof ProjectSlugOccupiedError && error.slug === "personal-space"
  );

  assert.deepEqual(transactions, [{ outcome: "rejected", errorName: "Error" }]);
  // 撞车时不能顺手插了主区会话或治理行——报错必须发生在任何其它写入之前。
  assert.equal(queries.some((query) => query.targetTable === projectConversations), false);
  assert.equal(queries.some((query) => query.targetTable === projectAiGovernance), false);
});

// R16 批 W4a（项目级自定义指令）：单列条件更新——只改 instructions_md + updatedAt，且只对活跃项目
// （未归档、未软删）生效，呼应服务层 requireManageableProject 的活跃性判定。
test("R16 W4a updateInstructions writes instructions_md scoped to the active project only", async () => {
  const at = new Date("2026-07-16T02:00:00.000Z");
  const updated = project({ instructionsMd: "遇到发布相关的工单，先问一句要不要拉发布负责人。" });
  const { db, queries } = createQueryRecorder([[updated]]);
  const repository = createProjectRepository(db);

  const result = await repository.updateInstructions({
    projectId,
    instructionsMd: "遇到发布相关的工单，先问一句要不要拉发布负责人。",
    now: at
  });

  assert.equal(result?.instructionsMd, "遇到发布相关的工单，先问一句要不要拉发布负责人。");
  const update = queries.find((query) => query.operation === "update");
  assert.equal(update?.targetTable, projects);
  const values = update?.setValue as Record<string, unknown>;
  assert.equal(values["instructionsMd"], "遇到发布相关的工单，先问一句要不要拉发布负责人。");
  assert.equal(values["updatedAt"], at);
  assert.ok(queryReferences(update?.where, projects.id));
  assert.ok(queryReferences(update?.where, projects.archived));
  assert.ok(queryReferences(update?.where, projects.deletedAt));
  const params = queryParamValues(update?.where);
  assert.ok(params.includes(projectId));
  assert.ok(params.includes(false));
});

test("R16 W4a updateInstructions clears to null (blank means no injection) and returns null when the project misses the active fence", async () => {
  const { db, queries } = createQueryRecorder([[]]);
  const repository = createProjectRepository(db);

  const result = await repository.updateInstructions({
    projectId,
    instructionsMd: null,
    now: new Date("2026-07-16T02:05:00.000Z")
  });

  assert.equal(result, null);
  const update = queries.find((query) => query.operation === "update");
  const values = update?.setValue as Record<string, unknown>;
  assert.equal(values["instructionsMd"], null);
});
