import assert from "node:assert/strict";
import test from "node:test";

import { createSearchRepository } from "./repositories/search.js";
import {
  conversationParticipants,
  projectConversations,
  workspaceMemberships
} from "./schema/index.js";
import { createQueryRecorder, queryParamValues, queryReferences, type RecordedQuery } from "./test-query-recorder.js";

const workspaceId = "14000000-0000-4000-8000-000000000001";
const viewerUserId = "14000000-0000-4000-8000-000000000002";

function allPredicates(query: RecordedQuery | undefined) {
  assert.ok(query, "expected a recorded search query");
  return [query.where, ...query.joins.map((join) => join.on)];
}

function referencesAny(query: RecordedQuery | undefined, target: unknown) {
  return allPredicates(query).some((predicate) => queryReferences(predicate, target));
}

// R15 批 B（人对人私聊）：DM 会话就是 kind='collab' + dm_key 的会话，可见性完全复用 searchConversations
// 既有的「main 全员可见 / collab 仅参与者」参与者门（visibleConversationCondition 同口径），dm_key 不
// 参与判定。这条断言证明搜索对 DM 与对普通 collab 会话一视同仁：第三人（含 admin）不是参与者 → 命不中，
// 且没有任何按 workspace 成员角色（admin）绕过的后门。只加断言，不改搜索实现。
test("R15 B searchConversations gates collab (and therefore DM) results on participant membership with no admin bypass", async () => {
  const { db, queries } = createQueryRecorder([[]]);

  await createSearchRepository(db).searchConversations({
    actor: { userId: viewerUserId, workspaceId, isAdmin: true },
    pattern: "%预算%",
    limit: 11
  });

  const search = queries[0];
  // collab 分支要求参与者命中（isNotNull(conversation_participants.id)）——DM 亦然。
  assert.ok(referencesAny(search, conversationParticipants.id), "collab/DM results must require a participant match");
  assert.ok(referencesAny(search, conversationParticipants.userId), "participant gate must bind to the viewer");
  const params = queryParamValues(search?.where);
  assert.ok(params.includes("main"));
  assert.ok(params.includes("collab"));
  assert.ok(params.includes(viewerUserId));
  // 没有 admin 后门：搜索的可见性判定从不引用 workspace 成员角色——admin 也必须是参与者才看得到 DM。
  assert.equal(referencesAny(search, workspaceMemberships.role), false, "search must not grant DM visibility by admin role");
});
