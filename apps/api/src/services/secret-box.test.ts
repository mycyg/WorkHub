import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { SecretBoxKeyError, createSecretBox } from "./secret-box.js";

const keyBase64 = randomBytes(32).toString("base64");
const otherKeyBase64 = randomBytes(32).toString("base64");

test("R14 批 GH secret-box: seal/open round-trips arbitrary PAT-shaped plaintext", () => {
  const box = createSecretBox(keyBase64);
  for (const plaintext of [
    "ghp_0123456789abcdefghijABCDEFGHIJ012345",
    "github_pat_11ABCDEFG0_veryLongFineGrainedTokenValue0123456789",
    "含中文与空格 的 极端值",
    ""
  ]) {
    const sealed = box.seal(plaintext);
    assert.equal(box.open(sealed), plaintext);
    // GCM 形状：96-bit IV + 128-bit auth tag。
    assert.equal(sealed.iv.length, 12);
    assert.equal(sealed.authTag.length, 16);
  }
});

test("R14 批 GH secret-box: every seal uses a fresh random IV (no nonce reuse)", () => {
  const box = createSecretBox(keyBase64);
  const first = box.seal("ghp_0123456789abcdefghij");
  const second = box.seal("ghp_0123456789abcdefghij");
  assert.notDeepEqual(first.iv, second.iv);
  assert.notDeepEqual(first.ciphertext, second.ciphertext);
});

test("R14 批 GH secret-box: sealed output never contains the plaintext", () => {
  const box = createSecretBox(keyBase64);
  const plaintext = "ghp_super_secret_token_0123456789";
  const sealed = box.seal(plaintext);
  const serialized = [
    sealed.ciphertext.toString("utf8"),
    sealed.ciphertext.toString("base64"),
    sealed.iv.toString("base64"),
    sealed.authTag.toString("base64")
  ].join("|");
  assert.equal(serialized.includes(plaintext), false);
});

test("R14 批 GH secret-box: tampering with any single byte of the auth tag is rejected", () => {
  const box = createSecretBox(keyBase64);
  const sealed = box.seal("ghp_0123456789abcdefghij");
  for (let index = 0; index < sealed.authTag.length; index += 1) {
    const tampered = Buffer.from(sealed.authTag);
    tampered[index] = tampered[index]! ^ 0xff;
    assert.throws(
      () => box.open({ ...sealed, authTag: tampered }),
      /Unsupported state|unable to authenticate/iu,
      `tampered auth tag byte ${index} must be rejected`
    );
  }
});

test("R14 批 GH secret-box: tampering with the ciphertext or IV is rejected", () => {
  const box = createSecretBox(keyBase64);
  const sealed = box.seal("ghp_0123456789abcdefghij");

  const flippedCiphertext = Buffer.from(sealed.ciphertext);
  flippedCiphertext[0] = flippedCiphertext[0]! ^ 0x01;
  assert.throws(() => box.open({ ...sealed, ciphertext: flippedCiphertext }));

  const flippedIv = Buffer.from(sealed.iv);
  flippedIv[3] = flippedIv[3]! ^ 0x80;
  assert.throws(() => box.open({ ...sealed, iv: flippedIv }));
});

test("R14 批 GH secret-box: opening with a different key fails (no silent wrong-key decrypt)", () => {
  const sealed = createSecretBox(keyBase64).seal("ghp_0123456789abcdefghij");
  assert.throws(() => createSecretBox(otherKeyBase64).open(sealed));
});

test("R14 批 GH secret-box: malformed sealed shapes are rejected with a clear error", () => {
  const box = createSecretBox(keyBase64);
  const sealed = box.seal("ghp_0123456789abcdefghij");
  // 截断的 auth tag（截断攻击）与错长 IV 都在解密前就被拒。
  assert.throws(() => box.open({ ...sealed, authTag: sealed.authTag.subarray(0, 8) }), SecretBoxKeyError);
  assert.throws(() => box.open({ ...sealed, iv: Buffer.alloc(16) }), SecretBoxKeyError);
});

test("R14 批 GH secret-box: non-32-byte keys are rejected at construction, fail-closed", () => {
  for (const badKey of [
    "",
    "short",
    randomBytes(16).toString("base64"),
    randomBytes(31).toString("base64"),
    randomBytes(33).toString("base64"),
    "!!!not-base64-at-all!!!"
  ]) {
    assert.throws(() => createSecretBox(badKey), SecretBoxKeyError, `key ${JSON.stringify(badKey)} must be rejected`);
  }
  // 恰好 32 字节的合法 key 通过。
  assert.doesNotThrow(() => createSecretBox(randomBytes(32).toString("base64")));
});
