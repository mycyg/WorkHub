import assert from "node:assert/strict";
import test from "node:test";

import type { SessionVM } from "@workhub/contracts";

import { renderIntakeSession } from "./render.js";

const session: SessionVM = {
  session_id: "10000000-0000-4000-8000-000000000001",
  work_item_id: "10000000-0000-4000-8000-000000000002",
  topic: "生成客户周报模板",
  stream_href: "/api/push/stream/session/10000000-0000-4000-8000-000000000001",
  next_question_href: "/api/sessions/10000000-0000-4000-8000-000000000001/next-question",
  question: {
    id: "10000000-0000-4000-8000-000000000003",
    title: "这次周报偏向哪种口吻？",
    body: "选一个方向即可。",
    input_mode: "single_choice",
    options: [
      { id: "brief", label: "简洁版", description: "适合快速同步。" },
      { id: "detailed", label: "详细版", description: "会展开更多证据。" }
    ],
    recommended_option_ids: ["brief"],
    free_text: {
      enabled: true,
      collapsed_by_default: true,
      placeholder: "确实需要时再补一句。",
      max_length: 120
    },
    progress: [
      { key: "goal", label: "目标", state: "done" },
      { key: "tone", label: "口吻", state: "active" },
      { key: "reviewer", label: "审核人", state: "pending" }
    ],
    evidence_refs: [],
    submit: { method: "POST", href: "/api/sessions/10000000-0000-4000-8000-000000000001/next-question" }
  }
};

test("intake sessions render as option-first pages", () => {
  const page = renderIntakeSession(session, "web");

  assert.equal(page.surface, "web");
  assert.equal(page.sessionId, session.session_id);
  assert.equal(page.route, `/intake/${session.session_id}`);
  assert.deepEqual(page.optionIds, ["brief", "detailed"]);
  assert.deepEqual(page.recommendedOptionIds, ["brief"]);
  assert.equal(page.freeTextCollapsed, true);
  assert.equal(page.cuuState, "asking_approval");
  assert.equal(page.html.includes("简洁版"), true);
  assert.equal(page.html.includes("AI 推荐"), true);
  assert.equal(page.html.includes("wh-cuu-avatar"), false);
  assert.equal(page.html.includes("<details"), true);
  assert.equal(page.primaryHrefs[0], session.question.submit.href);
});

test("desktop intake keeps the same session contract with a desktop wrapper", () => {
  const page = renderIntakeSession(session, "desktop");

  assert.equal(page.surface, "desktop");
  assert.equal(page.html.includes("wh-desktop"), true);
  assert.equal(page.streamHref, session.stream_href);
  assert.equal(page.nextQuestionHref, session.next_question_href);
});
