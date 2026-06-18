import assert from "node:assert/strict";
import test from "node:test";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  WeakPasswordError,
  currentPasswordAlgo,
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword
} from "./auth/password.js";

test("hashPassword returns a self-describing scrypt PHC string with a random salt", async () => {
  const a = await hashPassword("correct horse battery staple");
  const b = await hashPassword("correct horse battery staple");
  assert.match(a, /^\$scrypt\$ln=\d+,r=\d+,p=\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u);
  assert.notEqual(a, b, "同口令两次哈希应因随机 salt 而不同");
  assert.equal(currentPasswordAlgo(), "scrypt");
});

test("verifyPassword accepts the right password and rejects wrong/tampered/garbage without throwing", async () => {
  const stored = await hashPassword("s3cret-passphrase");
  assert.equal(await verifyPassword("s3cret-passphrase", stored), true);
  assert.equal(await verifyPassword("wrong-passphrase", stored), false);
  // 篡改 hash 段
  assert.equal(await verifyPassword("s3cret-passphrase", `${stored}tampered`), false);
  // 完全非法的串不抛、判 false
  assert.equal(await verifyPassword("whatever", "not-a-phc-string"), false);
  assert.equal(await verifyPassword("whatever", ""), false);
  assert.equal(await verifyPassword("whatever", "$scrypt$ln=15$onlytwoparts"), false);
});

test("validatePassword enforces the length window", () => {
  assert.throws(() => validatePassword("short"), WeakPasswordError);
  assert.throws(() => validatePassword("x".repeat(PASSWORD_MAX_LENGTH + 1)), WeakPasswordError);
  const ok = "x".repeat(PASSWORD_MIN_LENGTH);
  assert.equal(validatePassword(ok), ok);
});

test("needsRehash flags weaker-than-current params and unparseable strings, not current hashes", async () => {
  const current = await hashPassword("rotate-me-maybe");
  assert.equal(needsRehash(current), false);
  // 旧的低 cost 串 → 应升级
  assert.equal(needsRehash("$scrypt$ln=14,r=8,p=1$AAAA$AAAA"), true);
  // 不可解析（含将来未知算法）→ 应升级
  assert.equal(needsRehash("$argon2id$v=19$m=65536$abc$def"), true);
  assert.equal(needsRehash("garbage"), true);
});
