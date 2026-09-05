import assert from "node:assert/strict";
import test from "node:test";

import type {
  DriveRecentFileRow,
  DriveRepository,
  GithubActivityRow,
  GithubBindingRepository,
  WorkItemProjectListItemRow,
  WorkItemDataRepository,
  WorkItemProjectRow
} from "@workhub/db";

import type { AuthActor } from "./middleware/auth.js";
import {
  createProjectHomePageService,
  ProjectHomePageServiceError
} from "./services/project-home-pages.js";

const WS = "11111111-1111-4111-8111-111111111111";
const ORG = "00000000-0000-4000-8000-0000000000aa";
const PROJ = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

function actor(over: Partial<AuthActor> = {}): AuthActor {
  return {
    kind: "human",
    id: USER,
    label: "tester",
    userId: USER,
    isAdmin: false,
    orgId: ORG,
    workspaceId: WS,
    ...over
  };
}

function projectRow(over: Partial<WorkItemProjectRow> = {}): WorkItemProjectRow {
  return {
    id: PROJ,
    orgId: ORG,
    workspaceId: WS,
    name: "Alpha",
    slug: "alpha",
    description: "An auditable project.",
    ownerNickname: "owner",
    ownerUserId: USER,
    archived: false,
    deletedAt: null,
    ...over
  } as unknown as WorkItemProjectRow;
}

const WI_1 = "44444444-4444-4444-8444-444444444401";
const WI_2 = "44444444-4444-4444-8444-444444444402";
const OTHER_USER = "33333333-3333-4333-8333-3333333333ff";
// 缺省事项由默认 actor(USER) 提交 → 即便是私有态(spec_ready)对其自身也可见(isSubmitter)。
const openItem = (over: Partial<WorkItemProjectListItemRow> = {}): WorkItemProjectListItemRow => ({
  id: WI_1,
  code: "ALP-1",
  title: "Do the thing",
  status: "spec_ready",
  priority: "normal",
  updatedAt: new Date("2026-06-23T00:00:00.000Z"),
  submitterUserId: USER,
  claimedByUserId: null,
  workspaceId: WS,
  assignments: [],
  ...over
});

function repo(
  findProjectById: WorkItemDataRepository["findProjectById"],
  listOpenByProject: WorkItemDataRepository["listOpenByProject"],
  countOpenByProject?: WorkItemDataRepository["countOpenByProject"]
): Pick<WorkItemDataRepository, "findProjectById" | "listOpenByProject" | "countOpenByProject" | "countVisibleOpenByProject" | "findWorkItemAccessRecords"> {
  return {
    findProjectById,
    listOpenByProject,
    // 默认:全量进行中数 = 清单全长(未过滤);M5 测试可显式传入 total>可见 的场景。
    countOpenByProject: countOpenByProject ?? (async (projectId: string) => (await listOpenByProject(projectId, Number.MAX_SAFE_INTEGER)).length),
    countVisibleOpenByProject: async (projectId, input) => {
      const items = await listOpenByProject(projectId, Number.MAX_SAFE_INTEGER);
      return items.filter((item) =>
        input.isAdmin
        || item.claimedByUserId === input.viewerUserId
        || item.submitterUserId === input.viewerUserId
        || item.assignments.some((assignment) => assignment.userId === input.viewerUserId)
        || !["intake", "ai_clarifying", "spec_ready"].includes(item.status)
      ).length;
    },
    findWorkItemAccessRecords: async () => new Map()
  };
}

// 网盘 repo 切片假实现：缺省无文件；可传入最近文件 + 真实总数（测「超过展示上限」用）。
function driveRepo(
  recentFiles: DriveRecentFileRow[] = [],
  fileCount?: number
): Pick<DriveRepository, "listRecentFilesByProject" | "countFilesByProject"> {
  return {
    listRecentFilesByProject: async (_projectId, limit = 5) => recentFiles.slice(0, limit),
    countFilesByProject: async () => fileCount ?? recentFiles.length
  };
}

const FILE_1 = "55555555-5555-4555-8555-555555555501";

// R14 批 GH（07-gh-design.md §5.1）：GitHub 活动切片假实现——缺省无仓库依赖（旧调用方/未绑定项目走
// 这条路径，github_activities 字段应整体不出现）；传入 rows 时模拟真实仓库按 limit 截断。
function githubRepo(
  rows: GithubActivityRow[] = []
): Pick<GithubBindingRepository, "listRecentActivitiesByProject"> {
  return {
    listRecentActivitiesByProject: async (_projectId, limit) => rows.slice(0, limit)
  };
}

function githubActivityRow(overrides: Partial<GithubActivityRow> = {}): GithubActivityRow {
  return {
    id: "66666666-6666-4666-8666-666666666601",
    projectId: PROJ,
    kind: "commit",
    externalId: "sha1",
    title: "feat: initial commit",
    authorLogin: "octocat",
    htmlUrl: "https://github.com/octocat/Hello-World/commit/sha1",
    state: null,
    occurredAt: new Date("2026-06-22T12:00:00.000Z"),
    relatedWorkItemId: null,
    createdAt: new Date("2026-06-22T12:05:00.000Z"),
    ...overrides
  } as GithubActivityRow;
}

test("project home page returns project meta + open work items + actions", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async () => [openItem(), openItem({ id: WI_2, code: "ALP-2", title: null })]
    ),
    driveRepo: driveRepo([{ id: FILE_1, name: "客户复盘.md", updatedAt: new Date("2026-06-22T00:00:00.000Z") }], 3),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });
  assert.equal(vm.project.id, PROJ);
  assert.equal(vm.project.slug, "alpha");
  assert.equal(vm.project.description, "An auditable project.");
  assert.equal(vm.project.status, "active");
  assert.equal(vm.summary.open_work_item_count, 2);
  assert.equal(vm.open_work_items[0]?.href, `/workitems/${WI_1}`);
  assert.equal(vm.open_work_items[1]?.title, "ALP-2", "null title falls back to code");
  assert.equal(vm.actions.open_drive.href, `/drive?project_id=${PROJ}`);
  // S4b：新任务带项目上下文，进接入起始页时绑定到本项目（不再丢进通用「试点项目」）。
  assert.equal(vm.actions.new_task.href, `/intake?project_id=${PROJ}`);
  // 网盘切片：真实文件总数 + 最近文件（链到项目网盘）
  assert.equal(vm.drive.file_count, 3, "drive file_count = true total");
  assert.equal(vm.drive.recent_files.length, 1);
  assert.equal(vm.drive.recent_files[0]?.name, "客户复盘.md");
  // #5：最近文件深链到网盘并高亮该文件(item_id)，不再都指向同一个通用网盘页。
  assert.equal(vm.drive.recent_files[0]?.href, `/drive?project_id=${PROJ}&item_id=${FILE_1}`);
  assert.equal(vm.empty_state, undefined);
  // R14 批 GH：没有注入 githubActivities 依赖（这个测试没有绑定 repo 的场景）→ 字段整体不出现。
  assert.equal(vm.github_activities, undefined);
});

// R14 批 GH（07-gh-design.md §5.1）：项目主页 github_activities 区块——绑定且有活动时出现(按
// occurred_at 展示切片、cap 8、字段映射到 GithubActivityVM)；未绑定/无活动/取数失败都省略整个字段
// （诚实缺省，不渲染占位区块），取数失败也不拖垮页面其余部分。
test("R14 批 GH: project home surfaces recent GitHub activity when a repo binding has data", async () => {
  const rows = [
    githubActivityRow(),
    githubActivityRow({
      id: "66666666-6666-4666-8666-666666666602",
      kind: "pull_request",
      externalId: "8",
      title: "feat: add thing",
      authorLogin: "author",
      htmlUrl: "https://github.com/octocat/Hello-World/pull/8",
      state: "merged",
      occurredAt: new Date("2026-06-22T13:00:00.000Z")
    })
  ];
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => []),
    driveRepo: driveRepo(),
    githubActivities: githubRepo(rows),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });

  assert.equal(vm.github_activities?.length, 2);
  assert.deepEqual(vm.github_activities?.[0], {
    kind: "commit",
    title: "feat: initial commit",
    html_url: "https://github.com/octocat/Hello-World/commit/sha1",
    occurred_at: "2026-06-22T12:00:00.000Z",
    author_login: "octocat"
  });
  assert.deepEqual(vm.github_activities?.[1], {
    kind: "pull_request",
    title: "feat: add thing",
    html_url: "https://github.com/octocat/Hello-World/pull/8",
    occurred_at: "2026-06-22T13:00:00.000Z",
    author_login: "author",
    state: "merged"
  });
});

test("R14 批 GH: project home caps GitHub activity at 8 entries", async () => {
  const rows = Array.from({ length: 12 }, (_, index) =>
    githubActivityRow({
      id: `66666666-6666-4666-8666-6666666666${String(70 + index)}`,
      externalId: `sha${index}`,
      title: `commit ${index}`
    })
  );
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => []),
    driveRepo: driveRepo(),
    githubActivities: githubRepo(rows),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });

  assert.equal(vm.github_activities?.length, 8, "display slice caps at 8 (07-gh-design §5.1)");
});

test("R14 批 GH: project home omits github_activities when there is no binding or the binding has no activity yet", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => []),
    driveRepo: driveRepo(),
    githubActivities: githubRepo([]), // 绑定了但暂无活动——同「未绑定」一样省略字段，不是空数组占位
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });

  assert.equal(vm.github_activities, undefined);
});

test("R14 批 GH: project home degrades to omitting github_activities when the activity source throws", async () => {
  const failingGithubRepo: Pick<GithubBindingRepository, "listRecentActivitiesByProject"> = {
    async listRecentActivitiesByProject() {
      throw new Error("github activities source down");
    }
  };
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => [openItem()]),
    driveRepo: driveRepo(),
    githubActivities: failingGithubRepo,
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });

  assert.equal(vm.github_activities, undefined, "a broken GitHub activity source must not fail the whole page");
  assert.equal(vm.open_work_items.length, 1, "the rest of the page still renders normally");
});

// B-R9.6 §3.4：军团工作项行尾 pill 的数据面——挂着活跃计划的行带 army{done,total}，
// 其余行不带；军团取数抛错时页面照常返回（展示增强不拖垮主页）。
test("B-R9.6 project home attaches army progress to armied rows and survives source failure", async () => {
  const calls: Array<{ workspaceId: string; workItemIds: string[] }> = [];
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async () => [openItem(), openItem({ id: WI_2, code: "ALP-2" })]
    ),
    driveRepo: driveRepo(),
    taskPlans: {
      async listArmyProgressByWorkItemIds(input) {
        calls.push({ workspaceId: input.workspaceId, workItemIds: [...input.workItemIds] });
        return new Map([[WI_1, { planId: "66666666-6666-4666-8666-666666666601", doneItems: 2, totalItems: 4 }]]);
      }
    },
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });
  assert.deepEqual(calls, [{ workspaceId: WS, workItemIds: [WI_1, WI_2] }]);
  assert.deepEqual(vm.open_work_items[0]?.army, { done: 2, total: 4 });
  assert.equal(vm.open_work_items[1]?.army, undefined);

  const failing = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async () => [openItem()]
    ),
    driveRepo: driveRepo(),
    taskPlans: {
      async listArmyProgressByWorkItemIds() {
        throw new Error("task plan source down");
      }
    },
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const degraded = await failing.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });
  assert.equal(degraded.open_work_items.length, 1);
  assert.equal(degraded.open_work_items[0]?.army, undefined);
});

test("project home blocks admins from opening a project in another org", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({
        orgId: "00000000-0000-4000-8000-0000000000bb",
        workspaceId: "11111111-1111-4111-8111-1111111111bb"
      } as Partial<WorkItemProjectRow>),
      async () => []
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  await assert.rejects(
    () => svc.page({
      actor: actor({
        isAdmin: true,
        workspaceId: "11111111-1111-4111-8111-111111111199"
      }),
      projectId: PROJ,
      locale: "zh-CN"
    }),
    (error: unknown) =>
      error instanceof ProjectHomePageServiceError
      && error.status === 403
      && error.code === "project_forbidden"
  );
});

test("project home hides recent accepted-deliverable files the viewer cannot open", async () => {
  const acceptedRecentFile = {
    id: FILE_1,
    name: "正式交付.md",
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
    acceptedWorkItemIds: [WI_2]
  } as DriveRecentFileRow & { acceptedWorkItemIds: string[] };
  const manualFile = {
    id: "55555555-5555-4555-8555-555555555502",
    name: "公开材料.md",
    updatedAt: new Date("2026-06-21T00:00:00.000Z")
  };
  const baseRepo = repo(
    async () => projectRow({ ownerUserId: OTHER_USER }),
    async () => []
  );
  const svc = createProjectHomePageService({
    repo: {
      ...baseRepo,
      async findWorkItemAccessRecords(workItemIds: string[]) {
        assert.deepEqual(workItemIds, [WI_2]);
        return new Map([[WI_2, {
          id: WI_2,
          status: "spec_ready" as const,
          submitterUserId: OTHER_USER,
          claimedByUserId: null,
          workspaceId: WS,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: OTHER_USER,
            workspaceId: WS
          },
          assignments: []
        }]]);
      }
    } as unknown as Parameters<typeof createProjectHomePageService>[0]["repo"],
    driveRepo: driveRepo([acceptedRecentFile, manualFile], 2),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });

  assert.equal(vm.drive.file_count, 2, "project file count still reports the real Drive total");
  assert.deepEqual(vm.drive.recent_files.map((file) => file.id), [manualFile.id]);
});

test("project home scans past unreadable accepted-deliverable recent files", async () => {
  const hiddenAcceptedFiles = Array.from({ length: 50 }, (_, index) => ({
    id: `55555555-5555-4555-8555-${String(index + 601).padStart(12, "0")}`,
    name: `私有交付-${index + 1}.md`,
    updatedAt: new Date(`2026-06-22T00:${String(index).padStart(2, "0")}:00.000Z`),
    acceptedWorkItemIds: [WI_2]
  })) as Array<DriveRecentFileRow & { acceptedWorkItemIds: string[] }>;
  const readableFile = {
    id: "55555555-5555-4555-8555-555555555699",
    name: "公开复盘.md",
    updatedAt: new Date("2026-06-21T00:00:00.000Z")
  };
  const baseRepo = repo(
    async () => projectRow({ ownerUserId: OTHER_USER }),
    async () => []
  );
  const svc = createProjectHomePageService({
    repo: {
      ...baseRepo,
      async findWorkItemAccessRecords(workItemIds: string[]) {
        assert.deepEqual(workItemIds, [WI_2]);
        return new Map([[WI_2, {
          id: WI_2,
          status: "spec_ready" as const,
          submitterUserId: OTHER_USER,
          claimedByUserId: null,
          workspaceId: WS,
          project: {
            archived: false,
            deletedAt: null,
            ownerUserId: OTHER_USER,
            workspaceId: WS
          },
          assignments: []
        }]]);
      }
    } as unknown as Parameters<typeof createProjectHomePageService>[0]["repo"],
    driveRepo: driveRepo([...hiddenAcceptedFiles, readableFile], 51),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ, locale: "zh-CN" });

  assert.equal(vm.drive.file_count, 51);
  assert.deepEqual(vm.drive.recent_files.map((file) => file.id), [readableFile.id]);
});

test("project home page 404 when the project is missing/archived/deleted", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => null, async () => []),
    driveRepo: driveRepo()
  });
  await assert.rejects(
    () => svc.page({ actor: actor(), projectId: PROJ }),
    (error) => error instanceof ProjectHomePageServiceError && error.status === 404
  );
});

test("project home page 403 when a non-admin actor is outside the project's workspace", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ workspaceId: "99999999-9999-4999-8999-999999999999", ownerUserId: "someone-else" }),
      async () => []
    ),
    driveRepo: driveRepo()
  });
  await assert.rejects(
    () => svc.page({ actor: actor(), projectId: PROJ }),
    (error) => error instanceof ProjectHomePageServiceError && error.status === 403
  );
});

test("project home page flags empty_state when there is no open work", async () => {
  const svc = createProjectHomePageService({
    repo: repo(async () => projectRow(), async () => []),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.empty_state, "no_open_work");
  assert.equal(vm.drive.file_count, 0, "no files → drive slice still present (empty)");
  assert.equal(vm.drive.recent_files.length, 0);
});

test("project home hides private-status work items the viewer can't open (no 403 dead links)", async () => {
  // F9：他人的私有态事项(intake/澄清/spec_ready)点进去会 403——项目主页不该列出这些死链。
  // 清单 = 1 条本人 spec_ready(可见) + 1 条他人 spec_ready(不可见) + 1 条他人非私有态(同 workspace 可见)。
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [
        openItem(),
        openItem({ id: WI_2, code: "ALP-2", submitterUserId: OTHER_USER, status: "spec_ready" }),
        openItem({ id: "44444444-4444-4444-8444-444444444403", code: "ALP-3", submitterUserId: OTHER_USER, status: "in_review" })
      ]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  const ids = vm.open_work_items.map((item) => item.id);
  assert.deepEqual(ids, [WI_1, "44444444-4444-4444-8444-444444444403"], "本人私有态 + 他人非私有态保留;他人私有态过滤掉");
  assert.equal(vm.summary.open_work_item_count, 2, "头部计数与可见清单一致(不计入过滤掉的死链)");
  // M5：同时暴露全量进行中数(同 /projects 列表卡口径) → 头部可显示「进行中 3 · 你可处理 2」,与列表卡的 3 对齐,
  // 不再让用户以为数据出错(列表显 3、主页显 2)。
  assert.equal(vm.summary.total_open_work_item_count, 3, "全量进行中数 = 列表卡口径(未按可见性过滤),含被隐藏的他人私有态");
});

test("project home shows private work items explicitly assigned to the viewer", async () => {
  const assignedPrivateItem = openItem({
    id: WI_2,
    code: "ALP-ASSIGNED",
    submitterUserId: OTHER_USER,
    status: "spec_ready",
    assignments: [{ userId: USER, role: "lead" }]
  });
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [assignedPrivateItem]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ });

  assert.deepEqual(vm.open_work_items.map((item) => item.id), [assignedPrivateItem.id]);
  assert.equal(vm.summary.open_work_item_count, 1);
  assert.equal(vm.empty_state, undefined);
});

test("project home scans past hidden private drafts before applying the display cap", async () => {
  const hiddenItems = Array.from({ length: 55 }, (_, index) =>
    openItem({
      id: `44444444-4444-4444-8444-${String(index + 10).padStart(12, "0")}`,
      code: `ALP-H${index + 1}`,
      submitterUserId: OTHER_USER,
      status: "spec_ready"
    })
  );
  const visibleItem = openItem({
    id: "44444444-4444-4444-8444-000000000999",
    code: "ALP-V",
    submitterUserId: OTHER_USER,
    status: "in_review"
  });
  const allItems = [...hiddenItems, visibleItem];
  let requestedLimit = 0;
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async (_projectId, limit = allItems.length) => {
        requestedLimit = limit;
        return allItems.slice(0, limit);
      },
      async () => allItems.length
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ });

  assert.ok(requestedLimit > 50, "service scans beyond the display cap before filtering private rows");
  assert.deepEqual(vm.open_work_items.map((item) => item.id), [visibleItem.id]);
  assert.equal(vm.summary.open_work_item_count, 1);
  assert.equal(vm.summary.total_open_work_item_count, allItems.length);
  assert.equal(vm.empty_state, undefined);
});

test("project home does not claim no open work when visible work is beyond the scan window", async () => {
  const hiddenItems = Array.from({ length: 200 }, (_, index) =>
    openItem({
      id: `44444444-4444-4444-8444-${String(index + 900).padStart(12, "0")}`,
      code: `ALP-H${index + 1}`,
      submitterUserId: OTHER_USER,
      status: "spec_ready"
    })
  );
  const visibleItem = openItem({
    id: "44444444-4444-4444-8444-000000001999",
    code: "ALP-V-BEYOND-SCAN",
    submitterUserId: OTHER_USER,
    status: "in_review"
  });
  const allItems = [...hiddenItems, visibleItem];
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async (_projectId, limit = allItems.length) => allItems.slice(0, limit),
      async () => allItems.length
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ });

  assert.equal(vm.summary.open_work_item_count, 1);
  assert.deepEqual(vm.open_work_items, []);
  assert.equal(vm.empty_state, undefined, "header says there is visible work, so the page must not say there is no open work");
});

test("project home summary counts visible open work beyond the 50-row display cap", async () => {
  const visibleItems = Array.from({ length: 55 }, (_, index) =>
    openItem({
      id: `44444444-4444-4444-8444-${String(index + 200).padStart(12, "0")}`,
      code: `ALP-${index + 1}`,
      status: "in_review"
    })
  );
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async (_projectId, limit = visibleItems.length) => visibleItems.slice(0, limit),
      async () => visibleItems.length
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ });

  assert.equal(vm.open_work_items.length, 50, "the visible list stays capped for scanability");
  assert.equal(vm.summary.open_work_item_count, 55, "the header count is not the display slice length");
  assert.equal(vm.summary.total_open_work_item_count, 55);
});

test("project home summary counts visible open work beyond the 200-row scan cap", async () => {
  const visibleItems = Array.from({ length: 201 }, (_, index) =>
    openItem({
      id: `44444444-4444-4444-8444-${String(index + 400).padStart(12, "0")}`,
      code: `ALP-${index + 1}`,
      status: "in_review"
    })
  );
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow(),
      async (_projectId, limit = visibleItems.length) => visibleItems.slice(0, limit),
      async () => visibleItems.length
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor(), projectId: PROJ });

  assert.equal(vm.open_work_items.length, 50);
  assert.equal(vm.summary.open_work_item_count, 201, "the header count is not the scan cap length");
  assert.equal(vm.summary.total_open_work_item_count, 201);
});

test("project home shows nothing (empty_state) when every open item is another user's private draft", async () => {
  // 项目有活动但全是他人私有草稿 → 当前用户在本项目无可处理项,诚实显示空态而非一堆 403 死链。
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [
        openItem({ submitterUserId: OTHER_USER, status: "ai_clarifying" }),
        openItem({ id: WI_2, code: "ALP-2", submitterUserId: OTHER_USER, status: "spec_ready" })
      ]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor(), projectId: PROJ });
  assert.equal(vm.open_work_items.length, 0);
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.empty_state, "no_open_work");
});

test("admin sees all open items on project home (incl. others' private drafts)", async () => {
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ ownerUserId: OTHER_USER }),
      async () => [openItem({ submitterUserId: OTHER_USER }), openItem({ id: WI_2, code: "ALP-2", submitterUserId: OTHER_USER })]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });
  const vm = await svc.page({ actor: actor({ isAdmin: true }), projectId: PROJ });
  assert.equal(vm.summary.open_work_item_count, 2, "admin 可越权读 → 全部可见");
});

test("cross-workspace admin sees project home as read-only without dead write actions or mismatched visible counts", async () => {
  const otherWorkspace = "99999999-9999-4999-8999-999999999999";
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ workspaceId: otherWorkspace, ownerUserId: OTHER_USER }),
      async () => [
        openItem({ workspaceId: otherWorkspace, submitterUserId: OTHER_USER, status: "in_review" }),
        openItem({ id: WI_2, code: "ALP-2", workspaceId: otherWorkspace, submitterUserId: OTHER_USER, status: "spec_ready" })
      ]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor({ isAdmin: true, workspaceId: WS }), projectId: PROJ });

  assert.equal(vm.actions.open_drive.href, `/drive?project_id=${PROJ}`);
  assert.equal(vm.actions.new_task.href, "/intake");
  assert.deepEqual(vm.open_work_items, []);
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.summary.total_open_work_item_count, 2);
});

test("project home does not let claimed items bypass the workspace visibility gate", async () => {
  const otherWorkspace = "99999999-9999-4999-8999-999999999999";
  const svc = createProjectHomePageService({
    repo: repo(
      async () => projectRow({ workspaceId: otherWorkspace, ownerUserId: OTHER_USER }),
      async () => [
        openItem({
          workspaceId: otherWorkspace,
          submitterUserId: OTHER_USER,
          claimedByUserId: USER,
          status: "spec_ready"
        })
      ]
    ),
    driveRepo: driveRepo(),
    now: () => new Date("2026-06-23T00:00:00.000Z")
  });

  const vm = await svc.page({ actor: actor({ isAdmin: true, workspaceId: WS }), projectId: PROJ });

  assert.deepEqual(vm.open_work_items, []);
  assert.equal(vm.summary.open_work_item_count, 0);
  assert.equal(vm.summary.total_open_work_item_count, 1);
  assert.equal(vm.empty_state, "no_open_work");
});

// R23 P4（R20 P2A 端点上界面）：项目主页要渲「归档 / 删除」两个动作，就得先知道当前这个人有没有资格。
// can_manage_lifecycle 直接借 project-ops 的导出谓词算（与 POST /api/projects/:id/{archive,delete} 同一把
// 尺子），前端据此决定整块渲不渲——两处各写一份的话，迟早漂移成「看得见点了却 403」。
test("R23 P4: project home ships can_manage_lifecycle using the same gate as the archive/delete endpoints", async () => {
  const page = async (over: Partial<AuthActor> = {}, project = projectRow()) => {
    const svc = createProjectHomePageService({
      repo: repo(async () => project, async () => [openItem()]),
      driveRepo: driveRepo(),
      now: () => new Date("2026-06-23T00:00:00.000Z")
    });
    return svc.page({ actor: actor(over), projectId: PROJ, locale: "zh-CN" });
  };

  // 项目所有者：可管理。
  assert.equal((await page()).can_manage_lifecycle, true);

  // 同工作区的普通成员（非所有者、非管理员）：能看项目主页，但不能归档/删除。
  const memberUser = "33333333-3333-4333-8333-3333333333ee";
  assert.equal((await page({ id: memberUser, userId: memberUser })).can_manage_lifecycle, false);

  // 同工作区管理员：可管理。
  assert.equal((await page({ id: memberUser, userId: memberUser, isAdmin: true })).can_manage_lifecycle, true);

  // 孤儿项目（workspaceId 为 NULL）对管理员不敞开——R21 收口的 NULL 旁路必须在 VM 上同样体现，
  // 否则界面会给出一个服务端一定拒绝的入口。
  const orphan = projectRow({ workspaceId: null, ownerUserId: null } as Partial<WorkItemProjectRow>);
  assert.equal((await page({ id: memberUser, userId: memberUser, isAdmin: true }, orphan)).can_manage_lifecycle, false);
});
