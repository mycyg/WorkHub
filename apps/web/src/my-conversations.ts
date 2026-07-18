import type { DmListVM, ProjectListVM } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

// R19-15：web 端「个人空间 / 私聊」导航入口。桌面工作台左栏有个人空间分组 + 私聊分组，web 端后端能力
// 齐备（GET /api/me/personal-projects、GET /api/dm/list）但导航进不去。本模块是纯渲染层，供 browser.ts
// 在项目页（/projects，既有导航项）客户端水合注入——不新增路由、不动 gold-path 的 shellPageOrder/键，
// 因此不触三处路由计数门。私聊行链到既有只读会话镜像 /conversations/:id；个人空间行链到 /projects/:id
// 项目主页（其成员摘要块已给出主区会话镜像入口）。

export type DmMirrorRow = {
  conversationId: string;
  href: string;
  peerNickname: string;
};

export type PersonalSpaceRow = {
  projectId: string;
  href: string;
  name: string;
};

// 每条 DM 恰好 2 名参与者（self + 对方，见 dmListItemVmSchema）——挑出「对方」渲染行标题。
export function dmMirrorRows(dm: DmListVM): DmMirrorRow[] {
  return dm.items.map((item) => {
    const peer = item.participants.find((participant) => !participant.is_self);
    return {
      conversationId: item.conversation.id,
      href: `/conversations/${item.conversation.id}`,
      peerNickname: peer?.nickname ?? item.conversation.title
    };
  });
}

export function personalSpaceRows(projects: ProjectListVM): PersonalSpaceRow[] {
  return projects.projects.map((project) => ({
    projectId: project.id,
    href: `/projects/${project.id}`,
    name: project.name
  }));
}

function copy(locale: WorkHubLocale) {
  const zh = locale === "zh-CN";
  return {
    kicker: zh ? "个人" : "Personal",
    title: zh ? "个人空间与私聊" : "Personal spaces & direct messages",
    summary: zh
      ? "只属于你的空间和一对一私聊，点开即可查看只读会话镜像。"
      : "Your own spaces and one-to-one chats — open one to view its read-only mirror.",
    personalHead: zh ? "个人空间" : "Personal spaces",
    dmHead: zh ? "私聊" : "Direct messages",
    personalEmpty: zh ? "还没有个人空间。" : "No personal spaces yet.",
    dmEmpty: zh ? "还没有私聊。" : "No direct messages yet.",
    // 取数失败（null）与「确实为空」不同——不谎称「还没有」，只说没拉到。
    loadFailed: zh ? "暂时没拉到，稍后重试。" : "Couldn't load — retry later.",
    bothEmpty: zh
      ? "你还没有个人空间或私聊。完整的新建与聊天在桌面工作台里。"
      : "You have no personal spaces or direct messages yet. Create and chat from the desktop workbench.",
    dmFallbackPeer: zh ? "私聊" : "Direct message"
  };
}

function rowListHtml(
  rows: Array<{ href: string; label: string; marker: string }>,
  emptyText: string
): string {
  if (rows.length === 0) {
    return `<p class="wh-subtle" data-r19-empty="true">${escapeHtml(emptyText)}</p>`;
  }
  const items = rows
    .map(
      (row) =>
        `<a class="wh-r4-route-row-title" ${row.marker} href="${escapeHtml(safeHref(row.href))}">${escapeHtml(row.label)}</a>`
    )
    .join("");
  return `<div class="wh-r4-route-timeline" role="list">${items}</div>`;
}

// dm/personal 为 null＝该来源取数失败（fail-soft，只影响那一列，不整块塌）。
export function renderMyConversationsSectionHtml(input: {
  dm: DmListVM | null;
  personal: ProjectListVM | null;
  locale: WorkHubLocale;
}): string {
  const t = copy(input.locale);
  const spaces = input.personal ? personalSpaceRows(input.personal) : [];
  const dms = input.dm ? dmMirrorRows(input.dm) : [];
  // 两个来源都成功加载且都为空 → 一条诚实的合并空态。任一来源取数失败（null）不算「空」。
  const bothEmpty = spaces.length === 0 && dms.length === 0 && input.personal !== null && input.dm !== null;

  const body = bothEmpty
    ? `<p class="wh-subtle" data-r19-my-conversations-empty="true">${escapeHtml(t.bothEmpty)}</p>`
    : `<div class="wh-r4-route-grid">
        <div data-r19-personal-space-group="true" data-r19-personal-space-count="${escapeHtml(String(spaces.length))}">
          <h3 role="heading" aria-level="2">${escapeHtml(t.personalHead)}</h3>
          ${rowListHtml(
            spaces.map((row) => ({ href: row.href, label: row.name, marker: `data-r19-personal-space-row="${escapeHtml(row.projectId)}"` })),
            input.personal === null ? t.loadFailed : t.personalEmpty
          )}
        </div>
        <div data-r19-dm-group="true" data-r19-dm-count="${escapeHtml(String(dms.length))}">
          <h3 role="heading" aria-level="2">${escapeHtml(t.dmHead)}</h3>
          ${rowListHtml(
            dms.map((row) => ({ href: row.href, label: row.peerNickname || t.dmFallbackPeer, marker: `data-r19-dm-row="${escapeHtml(row.conversationId)}"` })),
            input.dm === null ? t.loadFailed : t.dmEmpty
          )}
        </div>
      </div>`;

  return `<section class="wh-card wh-r4-route-card" data-r19-my-conversations="true">
      <header class="wh-r4-route-head">
        <div>
          <span class="wh-r4-route-kicker">${escapeHtml(t.kicker)}</span>
          <h2 role="heading" aria-level="1">${escapeHtml(t.title)}</h2>
          <p>${escapeHtml(t.summary)}</p>
        </div>
      </header>
      ${body}
    </section>`;
}
