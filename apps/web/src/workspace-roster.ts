// R20 P1-08 收尾：工作区花名册（GET /api/workspace/roster，分页）的客户端消费逻辑——独立成不带 DOM 副
// 作用的纯模块（browser.ts 顶层执行 document.getElementById，无法被 node:test 直接 import），使「翻页
// 翻到底」这条契约行为可脱离 jsdom 单测覆盖。
//
// 背景：roster 取代此前误当花名册用的全局 /api/users（跨租户泄露 + 硬 200 截断 + 全局昵称排序）。
// is_admin＝全局管理员标签（R20 P1-08 收尾补字段到 roster 行，非本工作区角色）。
//
// 选择器类消费端（审批转交等）需要「全部」工作区成员，不是摘要/加人面板那种够用即止的单页近似——按响应里
// 的 total 翻页翻到底，遵循端点的 limit/offset 分页契约（每页封顶 100，深 offset 可达任意成员，不像旧
// /api/users 那样硬 200 截断）。防御性上限只挡诡异响应（total 撒谎/死循环），对内部团队规模远打不到。

export type WorkspaceRosterMemberSlice = { user_id: string; nickname: string; is_admin: boolean };
export type WorkspaceRosterVM = { members: WorkspaceRosterMemberSlice[]; total: number; limit: number; offset: number };

// 最小依赖面——只要求一个泛型 request 方法，避免这个纯模块拉入整个 BrowserApiClient 类型（及其 DOM/客户端
// 依赖），也方便单测直接喂假实现。
export type WorkspaceRosterRequester = {
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

export async function fetchWorkspaceRosterMembers(
  client: WorkspaceRosterRequester
): Promise<WorkspaceRosterMemberSlice[]> {
  const members: WorkspaceRosterMemberSlice[] = [];
  const pageSize = 100;
  let offset = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const page = await client.request<WorkspaceRosterVM>(`/api/workspace/roster?limit=${pageSize}&offset=${offset}`);
    members.push(...page.members);
    offset += page.members.length;
    if (page.members.length === 0 || offset >= page.total) {
      break;
    }
  }
  return members;
}
