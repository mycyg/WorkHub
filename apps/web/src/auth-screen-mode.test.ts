import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";

import { detectAuthScreenMode } from "./auth-screen-mode.js";

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
