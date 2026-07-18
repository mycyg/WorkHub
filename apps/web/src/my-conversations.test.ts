import assert from "node:assert/strict";
import test from "node:test";

import type { DmListVM, ProjectListVM } from "@workhub/contracts";

import {
  dmMirrorRows,
  personalSpaceRows,
  renderMyConversationsSectionHtml
} from "./my-conversations.js";

const dmList: DmListVM = {
  items: [
    {
      conversation: {
        id: "c0000000-0000-4000-8000-000000000001",
        workspace_id: "w0000000-0000-4000-8000-000000000001",
        project_id: "p0000000-0000-4000-8000-000000000001",
        kind: "collab",
        title: "私聊",
        parent_conversation_id: null,
        source_message_id: null,
        visibility: "private",
        next_seq: 3,
        created_by: "u0000000-0000-4000-8000-000000000001",
        participant_role: "owner",
        cuu_enabled: false,
        is_dm: true,
        created_at: "2026-07-10T00:00:00.000Z",
        updated_at: "2026-07-10T00:00:00.000Z"
      },
      participants: [
        { user_id: "u0000000-0000-4000-8000-000000000001", nickname: "我", is_self: true },
        { user_id: "u0000000-0000-4000-8000-000000000002", nickname: "阿伟", is_self: false }
      ]
    }
  ]
};

const personalProjects: ProjectListVM = {
  generated_at: "2026-07-10T00:00:00.000Z",
  projects: [
    {
      id: "p0000000-0000-4000-8000-000000000009",
      workspace_id: "w0000000-0000-4000-8000-000000000001",
      name: "我的空间",
      slug: "personal-1",
      owner_nickname: "我",
      owner_user_id: "u0000000-0000-4000-8000-000000000001",
      archived: false,
      created_at: "2026-07-10T00:00:00.000Z",
      updated_at: "2026-07-10T00:00:00.000Z",
      open_work_item_count: 0,
      is_personal: true
    }
  ]
};

test("R19-15 DM rows link to the conversation mirror and label the other participant", () => {
  const rows = dmMirrorRows(dmList);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.href, "/conversations/c0000000-0000-4000-8000-000000000001");
  assert.equal(rows[0]?.peerNickname, "阿伟");
});

test("R19-15 personal-space rows link to the project home", () => {
  const rows = personalSpaceRows(personalProjects);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.href, "/projects/p0000000-0000-4000-8000-000000000009");
  assert.equal(rows[0]?.name, "我的空间");
});

test("R19-15 the my-conversations nav entry surfaces reachable links to personal spaces and DMs", () => {
  const html = renderMyConversationsSectionHtml({ dm: dmList, personal: personalProjects, locale: "zh-CN" });
  // 入口容器存在，且带上双列计数（供 smoke/断言定位）。
  assert.match(html, /data-r19-my-conversations="true"/u);
  assert.match(html, /data-r19-personal-space-count="1"/u);
  assert.match(html, /data-r19-dm-count="1"/u);
  // 私聊行链到只读会话镜像；个人空间行链到项目主页。
  assert.match(html, /href="\/conversations\/c0000000-0000-4000-8000-000000000001"/u);
  assert.match(html, /href="\/projects\/p0000000-0000-4000-8000-000000000009"/u);
  // 双语（英文）也成形，不用 emoji。
  const enHtml = renderMyConversationsSectionHtml({ dm: dmList, personal: personalProjects, locale: "en-US" });
  assert.match(enHtml, /Direct messages/u);
  assert.match(enHtml, /Personal spaces/u);
});

test("R19-15 empty personal + DM state renders an honest hint, not a broken entry", () => {
  const html = renderMyConversationsSectionHtml({
    dm: { items: [] },
    personal: { generated_at: "2026-07-10T00:00:00.000Z", projects: [] },
    locale: "zh-CN"
  });
  assert.match(html, /data-r19-my-conversations-empty="true"/u);
});
