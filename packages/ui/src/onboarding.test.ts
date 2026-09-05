import assert from "node:assert/strict";
import test from "node:test";

import { renderPasswordAuthScreen } from "./onboarding.js";

// R23 P2（SA-04）：纯渲染层单测（无 DOM 依赖）——DOM 接线（探测模式/提交/tab 切换）在
// apps/web/src/browser.ts，这个 workspace 的测试运行器没有 jsdom，接线本身不在这里覆盖
// （同 packages/ui 其余渲染函数 + apps/desktop-webview/src/desktop-login.ts 的既有先例）。

test("renderPasswordAuthScreen defaults to the login tab: email + password, no nickname field", () => {
  const { html, tab } = renderPasswordAuthScreen({ locale: "zh-CN" });
  assert.equal(tab, "login");
  assert.match(html, /data-r23-auth-tab="login"/u);
  assert.match(html, /type="email"[^>]*data-r23-auth-email="true"/u);
  assert.match(html, /type="password"[^>]*data-r23-auth-password="true"/u);
  assert.doesNotMatch(html, /data-r23-auth-nickname/u);
  assert.doesNotMatch(html, /data-r23-auth-first-admin-hint/u);
  assert.match(html, /登录 WorkHub/u);
  assert.match(html, /data-r23-auth-submit="true"[^>]*>登录</u);
});

test("renderPasswordAuthScreen register tab adds a nickname field and the first-admin hint", () => {
  const { html, tab } = renderPasswordAuthScreen({ locale: "zh-CN", tab: "register" });
  assert.equal(tab, "register");
  assert.match(html, /data-r23-auth-tab="register"/u);
  assert.match(html, /data-r23-auth-nickname="true"/u);
  assert.match(html, /data-r23-auth-first-admin-hint="true"/u);
  assert.match(html, /第一个注册的人会成为管理员/u);
  // A2-51：登录第一屏不出现「实例」这类部署运维词。
  assert.doesNotMatch(html, /实例/u);
  assert.match(html, /创建账号/u);
  // 注册屏绝不该出现管理员口令字段——那是 nickname 模式的 renderOnboardingScreen 专属，密码模式
  // 首个注册者由服务端自动判定，前端不采集也不应该采集"我是管理员"这类字段。
  assert.doesNotMatch(html, /admin[-_]secret|管理员口令/iu);
});

test("renderPasswordAuthScreen surfaces a server error without translating it, and preserves typed input", () => {
  const html = renderPasswordAuthScreen({
    locale: "zh-CN",
    tab: "login",
    errorText: "邮箱或密码不正确",
    presetEmail: "alice@example.com"
  }).html;
  assert.match(html, /data-r23-auth-error="true"[^>]*role="alert"[^>]*>邮箱或密码不正确/u);
  assert.match(html, /value="alice@example\.com"/u);
});

test("renderPasswordAuthScreen register tab preserves both typed email and nickname across an error re-render", () => {
  const html = renderPasswordAuthScreen({
    locale: "zh-CN",
    tab: "register",
    errorText: "该邮箱已注册",
    presetEmail: "dup@example.com",
    presetNickname: "小拓"
  }).html;
  assert.match(html, /value="dup@example\.com"/u);
  assert.match(html, /value="小拓"/u);
  assert.match(html, /该邮箱已注册/u);
});

test("renderPasswordAuthScreen shows the post-login target route, same contract as renderOnboardingScreen", () => {
  const html = renderPasswordAuthScreen({ locale: "en-US", targetRoute: "/approvals" }).html;
  assert.match(html, /data-r23-auth-target="\/approvals"/u);
  assert.match(html, /You will land on \/approvals/u);
});

test("renderPasswordAuthScreen omits the target line entirely when there is no deep-linked target", () => {
  const html = renderPasswordAuthScreen({ locale: "en-US" }).html;
  assert.doesNotMatch(html, /data-r23-auth-target/u);
});

test("renderPasswordAuthScreen is bilingual and password fields never echo plaintext", () => {
  const zhHtml = renderPasswordAuthScreen({ locale: "zh-CN" }).html;
  const enHtml = renderPasswordAuthScreen({ locale: "en-US" }).html;
  assert.match(enHtml, /Sign in to WorkHub/u);
  assert.match(enHtml, /data-r23-auth-locale-option="en-US"[^>]*aria-pressed="true"/u);
  assert.match(zhHtml, /data-r23-auth-locale-option="zh-CN"[^>]*aria-pressed="true"/u);
  // 密码输入框必须是 type=password（不明文回显），且不能被 value 预填（不像 email/nickname 那样带回显）。
  assert.doesNotMatch(zhHtml, /data-r23-auth-password="true"[^>]*value=/u);
});
