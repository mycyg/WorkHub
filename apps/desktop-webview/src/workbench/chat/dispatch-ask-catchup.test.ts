import assert from "node:assert/strict";
import { test } from "node:test";

import type { Notification } from "@workhub/contracts";

import { pickDispatchAskCatchupNotification, renderDispatchAskCatchupBannerHtml } from "./dispatch-ask-catchup.js";

const PROJECT_ID = "90000000-0000-4000-8000-000000000001";
const OTHER_PROJECT_ID = "90000000-0000-4000-8000-000000000002";

function notification(over: Partial<Notification> = {}): Notification {
  return {
    id: "90000000-0000-4000-8000-000000000101",
    user_id: "90000000-0000-4000-8000-000000000009",
    type: "action_card_item.dispatch_ask",
    severity: "normal",
    title: "有个活想派给你",
    body: "重写第三节",
    project_id: PROJECT_ID,
    created_at: "2026-07-13T09:00:00.000Z",
    updated_at: "2026-07-13T09:00:00.000Z",
    ...over
  };
}

// —— pickDispatchAskCatchupNotification —— //

test("pickDispatchAskCatchupNotification picks an unread dispatch_ask notification for the current project", () => {
  const n = notification();
  assert.equal(pickDispatchAskCatchupNotification([n], PROJECT_ID)?.id, n.id);
});

test("pickDispatchAskCatchupNotification ignores notifications for a different project", () => {
  const n = notification({ project_id: OTHER_PROJECT_ID });
  assert.equal(pickDispatchAskCatchupNotification([n], PROJECT_ID), undefined);
});

test("pickDispatchAskCatchupNotification ignores already-read notifications", () => {
  const n = notification({ read_at: "2026-07-13T09:05:00.000Z" });
  assert.equal(pickDispatchAskCatchupNotification([n], PROJECT_ID), undefined);
});

test("pickDispatchAskCatchupNotification ignores archived/dismissed notifications", () => {
  const n = notification({ archived_at: "2026-07-13T09:05:00.000Z" });
  assert.equal(pickDispatchAskCatchupNotification([n], PROJECT_ID), undefined);
});

test("pickDispatchAskCatchupNotification ignores notification types other than dispatch_ask", () => {
  const n = notification({ type: "workitem.escalated" });
  assert.equal(pickDispatchAskCatchupNotification([n], PROJECT_ID), undefined);
});

test("pickDispatchAskCatchupNotification picks the most recent one when several have piled up", () => {
  const older = notification({ id: "notif-older", created_at: "2026-07-12T09:00:00.000Z" });
  const newer = notification({ id: "notif-newer", created_at: "2026-07-13T09:00:00.000Z" });
  assert.equal(pickDispatchAskCatchupNotification([older, newer], PROJECT_ID)?.id, "notif-newer");
  // Order in the input list shouldn't matter.
  assert.equal(pickDispatchAskCatchupNotification([newer, older], PROJECT_ID)?.id, "notif-newer");
});

// —— renderDispatchAskCatchupBannerHtml —— //

test("renderDispatchAskCatchupBannerHtml renders nothing when there is no catch-up notification", () => {
  assert.equal(renderDispatchAskCatchupBannerHtml(undefined, "zh-CN"), "");
});

test("renderDispatchAskCatchupBannerHtml renders a real, clickable banner carrying the notification id", () => {
  const n = notification();
  const html = renderDispatchAskCatchupBannerHtml(n, "zh-CN");
  assert.match(html, /<button[^>]*data-wb-chat-catchup-open[^>]*data-wb-chat-catchup-notification="90000000-0000-4000-8000-000000000101"/u);
  assert.match(html, /有个活在等你拍板/u);
  assert.match(html, /重写第三节/u);
});

test("renderDispatchAskCatchupBannerHtml localizes to English", () => {
  const html = renderDispatchAskCatchupBannerHtml(notification(), "en-US");
  // The apostrophe goes through escapeHtml (&#39;) same as any other user-facing copy in this codebase.
  assert.match(html, /Something&#39;s waiting on your call/u);
});

test("renderDispatchAskCatchupBannerHtml escapes the notification body — no raw HTML injection", () => {
  const html = renderDispatchAskCatchupBannerHtml(notification({ body: "<img src=x onerror=alert(1)>" }), "zh-CN");
  assert.doesNotMatch(html, /<img/u);
  assert.match(html, /&lt;img/u);
});
