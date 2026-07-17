import assert from "node:assert/strict";
import test from "node:test";

import { renderInviteAcceptScreen } from "./invite-accept.js";

// R20 P1-05：邀请接受落地页——公开（未登录可达）表单，token/昵称/密码三字段。

test("invite accept screen renders token, nickname, and password fields", () => {
  const { html } = renderInviteAcceptScreen({ locale: "zh-CN" });
  assert.equal(html.includes('data-r20-invite-accept="true"'), true);
  assert.equal(html.includes('data-r20-invite-accept-token="true"'), true);
  assert.equal(html.includes('data-r20-invite-accept-nickname="true"'), true);
  assert.equal(html.includes('data-r20-invite-accept-password="true"'), true);
  assert.equal(html.includes('data-r20-invite-accept-submit="true"'), true);
  // 密码字段是 password 类型，最短 8 位（与 inviteAcceptRequestSchema 对齐）。
  assert.equal(html.includes('type="password"'), true);
  assert.equal(html.includes('minlength="8"'), true);
});

test("invite accept screen prefills the token from the ?token= query and html-escapes it", () => {
  const { html } = renderInviteAcceptScreen({ locale: "en-US", token: "abc\"><script>x" });
  // 预填进 value，且做了 HTML 转义（防注入）。
  assert.equal(html.includes('value="abc&quot;&gt;&lt;script&gt;x"'), true);
  assert.equal(html.includes("<script>x"), false);
});

test("invite accept screen surfaces a server error message verbatim", () => {
  const { html } = renderInviteAcceptScreen({ locale: "zh-CN", errorText: "邀请无效或已过期" });
  assert.equal(html.includes('data-r20-invite-accept-error="true"'), true);
  assert.equal(html.includes("邀请无效或已过期"), true);
});

test("invite accept screen defaults locale and offers a language toggle", () => {
  const { locale, html } = renderInviteAcceptScreen({});
  assert.equal(locale, "zh-CN");
  assert.equal(html.includes('data-r20-invite-accept-locale-option="zh-CN"'), true);
  assert.equal(html.includes('data-r20-invite-accept-locale-option="en-US"'), true);
});
