import type { DmListVM, ProjectListVM } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";
import { escapeHtml, safeHref } from "@workhub/web-runtime";

// R19-15：web 端「个人空间 / 私聊」导航入口。桌面工作台左栏有个人空间分组 + 私聊分组，web 端后端能力
// 齐备（GET /api/me/personal-projects、GET /api/dm/list）但导航进不去。本模块是纯渲染层，供 browser.ts
// 在项目页（/projects，既有导航项）客户端水合注入——不新增路由、不动 gold-path 的 shellPageOrder/键，
// 因此不触三处路由计数门。私聊行链到既有只读会话镜像 /conversations/:id；个人空间行链到 /projects/:id
// 项目主页（其成员摘要块已给出主区会话镜像入口）。
//
// R23 P2（SA-05）：此前这里写死「完整的新建...在桌面工作台里」，但创建个人空间本身（POST
// /api/me/personal-projects）不需要桌面工作台——只是这个页面没给入口。补一个「新建个人空间」按钮
// （browser.ts 接 client.createPersonalProject 并在成功后导航到新空间的项目主页），文案随之改实：
// 只有「完整收发消息」仍然是桌面工作台的事（SA-01 未解，group chat 在 web 端仍是只读镜像）。

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
    // R23 P2（SA-05）：新建本身在 web 就能做了；仍然诚实说明完整收发消息还是桌面工作台的事（SA-01 未解）。
    bothEmpty: zh
      ? "你还没有个人空间或私聊。可以点上方「新建个人空间」创建一个——完整的收发消息仍在桌面工作台进行。"
      : "You have no personal spaces or direct messages yet. Use “New personal space” above to create one — full messaging still happens on the desktop workbench.",
    dmFallbackPeer: zh ? "私聊" : "Direct message",
    createPersonalSpace: zh ? "新建个人空间" : "New personal space"
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
  // 两个来源都成功加载且都为空 → 额外给一条诚实的合并提示。任一来源取数失败（null）不算「空」。
  const bothEmpty = spaces.length === 0 && dms.length === 0 && input.personal !== null && input.dm !== null;

  // R23 P2（SA-05）：此前 bothEmpty 会把整个两列网格换成一句纯文字提示，连「新建个人空间」的入口都
  // 一并盖掉——恰恰是用户最需要这个按钮的时候。现在网格（含按钮）恒渲染，bothEmpty 只多加一行
  // 合并提示，不再吞掉按钮。
  const body = `${bothEmpty ? `<p class="wh-subtle" data-r19-my-conversations-empty="true">${escapeHtml(t.bothEmpty)}</p>` : ""}
      <div class="wh-r4-route-grid">
        <div data-r19-personal-space-group="true" data-r19-personal-space-count="${escapeHtml(String(spaces.length))}">
          <div class="wh-r4-route-head">
            <h3 role="heading" aria-level="2">${escapeHtml(t.personalHead)}</h3>
            <a class="wh-btn" href="/api/me/personal-projects" role="button" data-action-id="create_personal_space" data-method="POST" data-r19-create-personal-space="true">${escapeHtml(t.createPersonalSpace)}</a>
          </div>
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
