import assert from "node:assert/strict";
import test from "node:test";

import { patchUserProfileRequestSchema, userProfileVmSchema } from "./domain/user-profile.js";

const userId = "16000000-0000-4000-8000-000000000001";

function baseVm() {
  return {
    user_id: userId,
    nickname: "张三",
    title: "前端负责人",
    bio_md: "做过三个交付项目",
    skill_tags: ["react", "typescript"],
    onboarded_at: null
  };
}

test("userProfileVmSchema accepts a fully-populated profile", () => {
  const parsed = userProfileVmSchema.safeParse(baseVm());
  assert.equal(parsed.success, true);
});

test("userProfileVmSchema accepts an empty/never-onboarded profile (all nullable fields null)", () => {
  const parsed = userProfileVmSchema.safeParse({
    user_id: userId,
    nickname: "张三",
    title: null,
    bio_md: null,
    skill_tags: [],
    onboarded_at: null
  });
  assert.equal(parsed.success, true);
});

test("userProfileVmSchema is strict and rejects unknown fields", () => {
  const parsed = userProfileVmSchema.safeParse({ ...baseVm(), extra_field: true });
  assert.equal(parsed.success, false);
});

test("userProfileVmSchema caps skill_tags at 50 entries", () => {
  const parsed = userProfileVmSchema.safeParse({
    ...baseVm(),
    skill_tags: Array.from({ length: 51 }, (_unused, index) => `tag-${index}`)
  });
  assert.equal(parsed.success, false);
});

test("patchUserProfileRequestSchema accepts a partial patch with just one field", () => {
  assert.equal(patchUserProfileRequestSchema.safeParse({ title: "后端负责人" }).success, true);
  assert.equal(patchUserProfileRequestSchema.safeParse({ bio_md: "新简介" }).success, true);
  assert.equal(patchUserProfileRequestSchema.safeParse({ skill_tags: ["go"] }).success, true);
});

test("patchUserProfileRequestSchema allows explicitly clearing title/bio_md via null", () => {
  const parsed = patchUserProfileRequestSchema.safeParse({ title: null, bio_md: null });
  assert.equal(parsed.success, true);
});

test("patchUserProfileRequestSchema rejects an entirely empty patch", () => {
  const parsed = patchUserProfileRequestSchema.safeParse({});
  assert.equal(parsed.success, false);
});

test("patchUserProfileRequestSchema is strict and rejects unknown fields", () => {
  const parsed = patchUserProfileRequestSchema.safeParse({ title: "x", extra: 1 });
  assert.equal(parsed.success, false);
});

test("patchUserProfileRequestSchema rejects blank-string title/bio_md (use null to clear, not empty string)", () => {
  assert.equal(patchUserProfileRequestSchema.safeParse({ title: "" }).success, false);
  assert.equal(patchUserProfileRequestSchema.safeParse({ bio_md: "   " }).success, false);
});

test("patchUserProfileRequestSchema caps skill_tags at 50 entries", () => {
  const parsed = patchUserProfileRequestSchema.safeParse({
    skill_tags: Array.from({ length: 51 }, (_unused, index) => `tag-${index}`)
  });
  assert.equal(parsed.success, false);
});
