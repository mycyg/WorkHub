import assert from "node:assert/strict";
import test from "node:test";

import type { UserMemoryRow } from "@workhub/db";

import { buildUserMemoryPromptSection, correctionFromReview } from "./services/user-memory.js";

function row(over: Partial<UserMemoryRow>): UserMemoryRow {
  return {
    id: "m-1",
    userId: "u-1",
    workspaceId: null,
    category: "preference",
    key: "k",
    valueMd: "v",
    confidence: 0.5,
    sourceRunId: null,
    lastUsedAt: null,
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over
  } as UserMemoryRow;
}

test("buildUserMemoryPromptSection returns empty string when no memories", () => {
  assert.equal(buildUserMemoryPromptSection([]), "");
});

test("buildUserMemoryPromptSection lists memories with category labels", () => {
  const section = buildUserMemoryPromptSection([
    row({ category: "preference", valueMd: "周报只要 markdown" }),
    row({ category: "correction", valueMd: "交付物要 PDF 不要 DOCX" })
  ]);
  assert.equal(section.includes("既定偏好与历史纠正"), true);
  assert.equal(section.includes("[偏好] 周报只要 markdown"), true);
  assert.equal(section.includes("[纠正过] 交付物要 PDF 不要 DOCX"), true);
});

test("correctionFromReview captures a request_changes reason as a correction", () => {
  const memory = correctionFromReview({
    reviewerUserId: "u-9",
    decision: "request_changes",
    reasonMd: "  预算口径要按季度，不要按月  ",
    proposalId: "p-7"
  });
  assert.ok(memory);
  assert.equal(memory?.userId, "u-9");
  assert.equal(memory?.category, "correction");
  assert.equal(memory?.key, "proposal:p-7");
  assert.equal(memory?.valueMd, "预算口径要按季度，不要按月");
  assert.equal(memory?.confidence, 0.9);
});

test("correctionFromReview ignores approvals, missing reviewer, and empty reasons", () => {
  assert.equal(correctionFromReview({ reviewerUserId: "u-9", decision: "approve", reasonMd: "ok", proposalId: "p-1" }), null);
  assert.equal(correctionFromReview({ reviewerUserId: null, decision: "request_changes", reasonMd: "x", proposalId: "p-1" }), null);
  assert.equal(correctionFromReview({ reviewerUserId: "u-9", decision: "request_changes", reasonMd: "   ", proposalId: "p-1" }), null);
});
