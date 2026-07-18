import assert from "node:assert/strict";
import test from "node:test";

import { fetchWorkspaceRosterMembers, type WorkspaceRosterVM } from "./workspace-roster.js";

// R20 P1-08 收尾：审批转交选择器等消费端需要「全部」工作区成员，不是摘要/加人面板那种够用即止的单页
// 近似——必须按响应里的 total 翻页翻到底，遵循 GET /api/workspace/roster 的 limit/offset 分页契约
// （每页封顶 100，深 offset 可达任意成员，不像旧全局 /api/users 那样硬 200 截断）。这是根因测试：若
// 实现退化成「只取第一页就当作全量」（旧 add-people 选择器走的近似捷径），下面的多页断言会先红——
// 已手工验证：把 fetchWorkspaceRosterMembers 的循环体临时改成「取一页即 break」重跑本文件，
// 第一个 test 在 total(3) > 单页 members.length(2) 处失败（红）；恢复翻页循环后转绿。

function fakeRosterClient(pages: WorkspaceRosterVM[]) {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    client: {
      request: async <T>(path: string): Promise<T> => {
        calls.push(path);
        const page = pages[index];
        index += 1;
        if (!page) {
          throw new Error(`unexpected extra roster page request: ${path}`);
        }
        return page as unknown as T;
      }
    }
  };
}

test("fetchWorkspaceRosterMembers pages through every roster page until total is reached", async () => {
  const { client, calls } = fakeRosterClient([
    {
      members: [
        { user_id: "10000000-0000-4000-8000-000000000001", nickname: "阿黄", is_admin: true },
        { user_id: "10000000-0000-4000-8000-000000000002", nickname: "小赵", is_admin: false }
      ],
      total: 3,
      limit: 2,
      offset: 0
    },
    {
      members: [{ user_id: "10000000-0000-4000-8000-000000000003", nickname: "小李", is_admin: false }],
      total: 3,
      limit: 2,
      offset: 2
    }
  ]);

  const members = await fetchWorkspaceRosterMembers(client);

  // 三个成员全拿到——不是只拿第一页（旧 /api/users 硬 200 截断的翻版风险）。
  assert.equal(members.length, 3);
  assert.deepEqual(
    members.map((m) => m.user_id),
    [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003"
    ]
  );
  // is_admin 逐行透传（roster 新增字段，替代此前 /api/users 的 is_admin）。
  assert.equal(members[0]?.is_admin, true);
  assert.equal(members[1]?.is_admin, false);
  assert.equal(members[2]?.is_admin, false);
  // 分页契约：第二次请求的 offset 紧接第一页取到的成员数（=2），不是固定步长、也不是重复请求同一页。
  assert.equal(calls.length, 2);
  assert.match(calls[0] ?? "", /limit=100&offset=0/u);
  assert.match(calls[1] ?? "", /limit=100&offset=2/u);
});

test("fetchWorkspaceRosterMembers stops after a single page when total fits in one page", async () => {
  const { client, calls } = fakeRosterClient([
    {
      members: [{ user_id: "10000000-0000-4000-8000-000000000009", nickname: "独苗", is_admin: false }],
      total: 1,
      limit: 100,
      offset: 0
    }
  ]);

  const members = await fetchWorkspaceRosterMembers(client);

  assert.equal(members.length, 1);
  assert.equal(calls.length, 1, "no wasted follow-up request once offset reaches total");
});

test("fetchWorkspaceRosterMembers stops on an empty page even if total looks larger (defensive, never loops forever)", async () => {
  const { client, calls } = fakeRosterClient([
    { members: [], total: 50, limit: 100, offset: 0 }
  ]);

  const members = await fetchWorkspaceRosterMembers(client);

  assert.deepEqual(members, []);
  assert.equal(calls.length, 1);
});
