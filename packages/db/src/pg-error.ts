// R24 S3 严重#4/#7：drizzle-orm 0.45 的 node-postgres 驱动（pg-core/session.js `queryWithCache`）把
// 裸 `pg` 驱动抛出的 DatabaseError 包进 `DrizzleQueryError` 的 `.cause`
// （`throw new DrizzleQueryError(queryString, params, e)`），顶层 `error.code` 恒为 `undefined`。
// 仓库/路由层若直接读 `(error as any).code` 判 SQLSTATE（23505 唯一冲突 / 23503 外键违约等），就永远
// 判不中、把本该翻译成 409 的冲突原样冒泡成 500——R24 S3 走查复现的真实案例：首启主窗+桌宠并发打
// desktop-bootstrap，两边都建 workspace_memberships 行，输家的唯一冲突没被
// apps/api/src/routes/auth.ts 的 isUniqueViolation 接住，直接抛成未捕获 500
// （`packages/db/src/repositories/memberships.ts` 的 `create()` 对驱动异常不做二次包装，原样上抛）。
// 统一在这里沿 `.cause` 链查找真正带字符串 `.code` 的 pg 错误对象——既兼容测试里直接在顶层塞 `.code`
// 的假错误（历史写法/单测直接构造），也兼容生产真实的嵌套包装；深度设上限防御万一的多层包装或
// 循环引用（正常只包一层，上限纯属防御）。
const MAX_CAUSE_CHAIN_DEPTH = 5;

export type PgErrorLike = {
  code?: string;
  constraint?: string;
  message?: string;
};

/**
 * 沿 `error` 自身与其 `.cause` 链查找第一个带字符串 `.code` 属性的对象（即裸 pg DatabaseError 的形状）。
 * 找不到（非对象、无 cause 链、超出深度上限）返回 `undefined`。
 */
export function findPgError(error: unknown, maxDepth = MAX_CAUSE_CHAIN_DEPTH): PgErrorLike | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < maxDepth && current != null; depth += 1) {
    if (typeof current !== "object") {
      break;
    }
    const candidate = current as PgErrorLike & { cause?: unknown };
    if (typeof candidate.code === "string") {
      return candidate;
    }
    current = candidate.cause;
  }
  return undefined;
}

/** `findPgError(error)?.code === code` 的简写——最常见的用法（只判 SQLSTATE，不判 constraint）。 */
export function isPgErrorCode(error: unknown, code: string, maxDepth = MAX_CAUSE_CHAIN_DEPTH): boolean {
  return findPgError(error, maxDepth)?.code === code;
}
