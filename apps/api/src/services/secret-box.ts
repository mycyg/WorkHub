import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// R14 批 GH（07-gh-design.md §1.1）：项目级 GitHub PAT 的最小可逆加密原语。
// 全仓库此前只有单向哈希（scrypt 口令 / sha256 会话 token），PAT 需要明文取回去调 GitHub API，
// 故新建这一个纯函数模块：AES-256-GCM + env 主密钥（GITHUB_TOKEN_ENC_KEY，32 字节 base64），
// node 内置 node:crypto，零新依赖——与 password.ts/auth.ts 同一「零依赖、glibc/musl 无关」选型哲学。
// 主密钥与 COOKIE_SECRET 刻意分离：泄漏影响面（伪造会话 vs 解密全部项目 PAT）与轮换节奏都不同。
// 未配置密钥时调用方 fail-closed（绑定端点 503、worker 空转），绝不明文兜底落库。

export type SealedSecret = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

export type SecretBox = {
  seal: (plaintext: string) => SealedSecret;
  open: (input: SealedSecret) => string;
};

const KEY_BYTES = 32;
// GCM 推荐 96-bit nonce。
const IV_BYTES = 12;
// GCM 默认 128-bit 认证标签；open 侧钉死长度，短标签截断攻击直接拒。
const AUTH_TAG_BYTES = 16;

export class SecretBoxKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxKeyError";
  }
}

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, "base64");
  // Buffer.from(base64) 静默忽略非法字符——只核解码后的字节数即可覆盖「配了但配错」的所有形态。
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxKeyError(
      `GITHUB_TOKEN_ENC_KEY must decode to exactly ${KEY_BYTES} bytes (generate with: openssl rand -base64 32)`
    );
  }
  return {
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return { ciphertext, iv, authTag: cipher.getAuthTag() };
    },
    open({ ciphertext, iv, authTag }) {
      if (iv.length !== IV_BYTES) {
        throw new SecretBoxKeyError(`sealed secret iv must be ${IV_BYTES} bytes`);
      }
      if (authTag.length !== AUTH_TAG_BYTES) {
        throw new SecretBoxKeyError(`sealed secret auth tag must be ${AUTH_TAG_BYTES} bytes`);
      }
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    }
  };
}
