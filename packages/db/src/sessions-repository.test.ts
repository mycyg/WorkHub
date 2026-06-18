import assert from "node:assert/strict";
import test from "node:test";

import {
  generateSessionToken,
  hashSessionToken,
  isSessionActive,
  nextIdleExpiry
} from "./repositories/sessions.js";

test("hashSessionToken is deterministic sha256 hex and never returns the plaintext", () => {
  const token = "session-secret-abc";
  const hash = hashSessionToken(token);
  assert.equal(hash, hashSessionToken(token)); // 同输入同输出
  assert.match(hash, /^[0-9a-f]{64}$/u); // sha256 hex = 64 hex chars
  assert.notEqual(hash, token);
  assert.notEqual(hashSessionToken("session-secret-abd"), hash); // 不同输入不同 hash
});

test("generateSessionToken returns high-entropy base64url tokens that differ each call", () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.match(a, /^[A-Za-z0-9_-]+$/u); // base64url 字符集（无 +/=）
  assert.ok(a.length >= 43, `expected >=43 chars for 48 bytes base64url, got ${a.length}`);
  assert.notEqual(a, b);
});

test("isSessionActive requires not-revoked AND before both absolute and idle expiry", () => {
  const now = new Date("2026-06-18T12:00:00.000Z");
  const future = new Date("2026-06-18T13:00:00.000Z");
  const past = new Date("2026-06-18T11:00:00.000Z");

  // 全有效
  assert.equal(isSessionActive({ revokedAt: null, absoluteExpiresAt: future, idleExpiresAt: future }, now), true);
  // 已撤销
  assert.equal(
    isSessionActive({ revokedAt: past, absoluteExpiresAt: future, idleExpiresAt: future }, now),
    false
  );
  // 绝对过期
  assert.equal(isSessionActive({ revokedAt: null, absoluteExpiresAt: past, idleExpiresAt: future }, now), false);
  // 滑动过期
  assert.equal(isSessionActive({ revokedAt: null, absoluteExpiresAt: future, idleExpiresAt: past }, now), false);
  // 边界：now === 过期时刻视为已过期（严格小于才算有效）
  assert.equal(isSessionActive({ revokedAt: null, absoluteExpiresAt: now, idleExpiresAt: future }, now), false);
});

test("nextIdleExpiry slides forward but never past the absolute hard cap", () => {
  const now = new Date("2026-06-18T12:00:00.000Z");
  const idleTtlMs = 30 * 60 * 1000; // 30 分钟
  const farAbsolute = new Date("2026-06-19T12:00:00.000Z");
  const nearAbsolute = new Date("2026-06-18T12:10:00.000Z"); // 仅 10 分钟后

  // 绝对上限很远 → 取 now + idleTtl
  assert.equal(nextIdleExpiry(now, idleTtlMs, farAbsolute).toISOString(), "2026-06-18T12:30:00.000Z");
  // 绝对上限很近 → 夹到绝对上限，不越过硬上限
  assert.equal(nextIdleExpiry(now, idleTtlMs, nearAbsolute).toISOString(), nearAbsolute.toISOString());
});
