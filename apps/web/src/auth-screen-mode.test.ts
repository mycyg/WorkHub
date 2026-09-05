import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import { describeAuthScreenError, detectAuthScreenMode } from "./auth-screen-mode.js";

// R23 P2（SA-04）：纯编排单测，无 DOM 依赖（同 onboarding-locale-sync.test.ts 的先例）。

test("detectAuthScreenMode returns password when identify 404s (AUTH_MODE!='nickname')", async () => {
  const mode = await detectAuthScreenMode(async () => {
    throw new WorkHubApiError(404, "not_found", "nickname login isn't available under the current auth mode");
  });
  assert.equal(mode, "password");
});

test("detectAuthScreenMode returns nickname when identify rejects with a validation error (empty nickname, nickname mode)", async () => {
  const mode = await detectAuthScreenMode(async () => {
    throw new WorkHubApiError(422, "validation_error", "Request payload does not match the WorkHub API contract.");
  });
  assert.equal(mode, "nickname");
});

test("detectAuthScreenMode defaults to nickname on a network/5xx failure (fail open to the least surprising screen)", async () => {
  const mode = await detectAuthScreenMode(async () => {
    throw new Error("fetch failed");
  });
  assert.equal(mode, "nickname");
});

test("detectAuthScreenMode defaults to nickname if identify unexpectedly resolves (schema should have rejected the empty nickname)", async () => {
  const mode = await detectAuthScreenMode(async () => ({
    id: "u1",
    nickname: "",
    display_name: "",
    created: false,
    locale: "zh-CN",
    preferences: { locale: "zh-CN" },
    is_admin: false,
    availability_status: "online"
  }));
  assert.equal(mode, "nickname");
});

test("detectAuthScreenMode probes with an empty nickname (never guesses a real one, never risks creating a user)", async () => {
  let seenPayload: unknown;
  await detectAuthScreenMode(async (payload) => {
    seenPayload = payload;
    throw new WorkHubApiError(404, "not_found", "nope");
  });
  assert.deepEqual(seenPayload, { nickname: "" });
});

test("describeAuthScreenError: login 401 never reveals whether the email exists (same wording either way)", () => {
  const message = describeAuthScreenError(new WorkHubApiError(401, "unauthorized", "邮箱或密码不正确"), "zh-CN", "login");
  assert.match(message, /邮箱或密码不正确/u);
});

test("describeAuthScreenError: register 409 tells the user to sign in instead, bilingually", () => {
  assert.match(describeAuthScreenError(new WorkHubApiError(409, "conflict", "该邮箱已注册"), "zh-CN", "register"), /已注册.*登录/u);
  assert.match(describeAuthScreenError(new WorkHubApiError(409, "conflict", "该邮箱已注册"), "en-US", "register"), /already registered.*sign in/iu);
});

test("describeAuthScreenError: a login 409 (not a login status) falls through to the generic failure message, not the register wording", () => {
  const message = describeAuthScreenError(new WorkHubApiError(409, "conflict", "该邮箱已注册"), "zh-CN", "login");
  assert.doesNotMatch(message, /已注册/u);
});

test("describeAuthScreenError: 429 is shared between login and register", () => {
  const error = new WorkHubApiError(429, "rate_limited", "too many attempts");
  assert.match(describeAuthScreenError(error, "zh-CN", "login"), /频繁/u);
  assert.match(describeAuthScreenError(error, "zh-CN", "register"), /频繁/u);
});

test("describeAuthScreenError: register 422/400 mentions all three fields; login 422/400 only mentions email+password", () => {
  const validationError = new WorkHubApiError(422, "validation_error", "bad payload");
  const registerMessage = describeAuthScreenError(validationError, "zh-CN", "register");
  assert.match(registerMessage, /邮箱.*昵称.*密码/u);
  const loginMessage = describeAuthScreenError(validationError, "zh-CN", "login");
  assert.doesNotMatch(loginMessage, /昵称/u);
});

test("describeAuthScreenError: never echoes the raw server WeakPasswordError text (that message has no English translation)", () => {
  const weakPassword = new WorkHubApiError(400, "bad_request", "密码至少 8 位");
  const enMessage = describeAuthScreenError(weakPassword, "en-US", "register");
  assert.doesNotMatch(enMessage, /密码至少/u);
  assert.match(enMessage, /at least 8 characters/u);
});

test("describeAuthScreenError: a non-WorkHubApiError (network failure) gets a generic, bilingual, context-correct fallback", () => {
  const networkError = new Error("fetch failed");
  assert.match(describeAuthScreenError(networkError, "zh-CN", "login"), /登录失败/u);
  assert.match(describeAuthScreenError(networkError, "zh-CN", "register"), /注册失败/u);
  assert.match(describeAuthScreenError(networkError, "en-US", "login"), /Sign-in failed/u);
  assert.match(describeAuthScreenError(networkError, "en-US", "register"), /Registration failed/u);
});
