import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// R2 auth epic（密码基线）：口令哈希。落库的是自描述 PHC 串，不存明文。
//
// 算法选型：用 node 内置 scrypt（内存硬，零依赖，glibc/musl 无关），而非设计原稿点名的 argon2id——
// 刻意避免在自动循环里引入原生依赖（@node-rs/argon2 的预编译二进制要靠 pilot-stack-smoke 的 Docker
// 构建才验证得到，风险不该无人值守时担）。user_credentials.password_algo 列正是为「无停机轮换哈希算法」
// 设计：日后可注册 argon2id 实现到下面的 verifier 注册表，旧 scrypt 串靠 algo 标签继续验、登录时按
// needsRehash() 透明升级，无需迁移。

// 手写 promise 包装（promisify 推断不出带 options 的重载）。
function scrypt(plain: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(plain, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

// scrypt 参数：N=2^COST_LOG2（CPU/内存代价）、r（块大小）、p（并行度）、keylen（输出长度）。
// COST_LOG2=15 → N=32768，约 ~32MB 内存/次，单核 ~50-100ms——交互登录可接受、暴力破解昂贵。
const CURRENT_ALGO = "scrypt";
const SCRYPT_COST_LOG2 = 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_BYTES = 16;
// scrypt 内部内存上限要够 N*r*128 字节，否则 cost 调高时报错。给足余量。
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 8;
// 上界限制 scrypt 计算成本（防超长口令 DoS）。
export const PASSWORD_MAX_LENGTH = 1024;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/** 口令策略校验：长度区间。越界抛 WeakPasswordError（调用方转 400）。返回原串便于链式。 */
export function validatePassword(plain: string): string {
  if (typeof plain !== "string" || plain.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError(`密码至少 ${PASSWORD_MIN_LENGTH} 位`);
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    throw new WeakPasswordError(`密码不能超过 ${PASSWORD_MAX_LENGTH} 位`);
  }
  return plain;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

async function scryptHash(plain: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: 2 ** SCRYPT_COST_LOG2,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: SCRYPT_MAXMEM
  })) as Buffer;
}

/** 当前算法标签（写进 user_credentials.password_algo 列）。 */
export function currentPasswordAlgo(): string {
  return CURRENT_ALGO;
}

/**
 * 生成 PHC 风格自描述哈希串：$scrypt$ln=15,r=8,p=1$<saltB64url>$<hashB64url>。
 * 自带参数 → 日后调参/换算法时旧串仍可验，并据此判 needsRehash。
 */
export async function hashPassword(plain: string): Promise<string> {
  validatePassword(plain);
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const hash = await scryptHash(plain, salt);
  const params = `ln=${SCRYPT_COST_LOG2},r=${SCRYPT_BLOCK_SIZE},p=${SCRYPT_PARALLELISM}`;
  return `$scrypt$${params}$${b64url(salt)}$${b64url(hash)}`;
}

type ParsedScrypt = {
  costLog2: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
};

function parseScrypt(stored: string): ParsedScrypt | null {
  // 形如 $scrypt$ln=15,r=8,p=1$<salt>$<hash>
  const parts = stored.split("$");
  if (parts.length !== 5 || parts[0] !== "" || parts[1] !== "scrypt") {
    return null;
  }
  const paramSpec = parts[2] ?? "";
  const saltPart = parts[3] ?? "";
  const hashPart = parts[4] ?? "";
  const params: Record<string, number> = {};
  for (const pair of paramSpec.split(",")) {
    const [key, raw] = pair.split("=");
    const value = Number(raw);
    if (!key || !Number.isInteger(value)) {
      return null;
    }
    params[key] = value;
  }
  if (params.ln === undefined || params.r === undefined || params.p === undefined) {
    return null;
  }
  try {
    const salt = Buffer.from(saltPart, "base64url");
    const hash = Buffer.from(hashPart, "base64url");
    if (salt.length === 0 || hash.length === 0) {
      return null;
    }
    return { costLog2: params.ln, blockSize: params.r, parallelism: params.p, salt, hash };
  } catch {
    return null;
  }
}

/**
 * 常量时间校验口令。任何解析失败/算法不认识/不匹配都返回 false（绝不抛、绝不泄露原因）。
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof stored !== "string") {
    return false;
  }
  const parsed = parseScrypt(stored);
  if (!parsed) {
    return false;
  }
  let candidate: Buffer;
  try {
    candidate = (await scrypt(plain, parsed.salt, parsed.hash.length, {
      N: 2 ** parsed.costLog2,
      r: parsed.blockSize,
      p: parsed.parallelism,
      maxmem: SCRYPT_MAXMEM
    })) as Buffer;
  } catch {
    return false;
  }
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

/**
 * 是否该在下次成功登录时透明重哈希：算法非当前、或参数低于当前强度、或串不可解析。
 * 用于无停机轮换（将来切 argon2id / 调高 cost 时自动升级旧串）。
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseScrypt(stored);
  if (!parsed) {
    return true;
  }
  return (
    parsed.costLog2 < SCRYPT_COST_LOG2 ||
    parsed.blockSize !== SCRYPT_BLOCK_SIZE ||
    parsed.parallelism !== SCRYPT_PARALLELISM
  );
}
