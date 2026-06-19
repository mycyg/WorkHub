import { z } from "zod";

// R3 团队就绪 routes-layer 加固：路由 uuid 形参在到达 DB（uuid 列）前先校验。非 uuid 串原本直达 PG
// 查询 → Postgres 22P02 invalid uuid → app.onError 无裸 PG 分支 → 误报 500 + unhandled_error 日志。
//
// 纯谓词：调用点自行决定抛出本路由约定的 404 错误类型（HTTPException / 各 *ServiceError），从而既消除 500，
// 又保持「非法 uuid」与「合法但不存在的 uuid」同样返回 404——攻击者无法据状态码区分存在性。
const uuidParamSchema = z.uuid();

export function isUuidParam(value: unknown): boolean {
  return uuidParamSchema.safeParse(value).success;
}
