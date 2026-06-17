import { ZodError, type z, type ZodTypeAny } from "zod";

/**
 * findings[#79]：page builder 返回前的 fail-closed `schema.parse(...)` 校验的是「服务端自己装配的 VM」是否
 * 符合契约——失败是 SERVER bug（装配走样），不是客户端输入错误。若让裸 ZodError 冒泡到 app.ts onError 的
 * 全局 ZodError 分支，会被映射成 422 + "Request payload does not match..."（错误状态码 + 甩锅调用方 + 还把
 * 内部 VM 字段路径 error.issues 泄露出去）。包成本错误类，让 onError 当 500 处理（给 on-call 告警），response
 * 不带 issues。
 */
export class InternalContractError extends Error {
  readonly context: string;
  readonly issues: unknown;
  constructor(context: string, cause: ZodError) {
    super(`WorkHub VM assembly violated its contract at ${context}`);
    this.name = "InternalContractError";
    this.context = context;
    this.issues = cause.issues;
  }
}

/**
 * 输出边界（VM 装配）专用的 fail-closed 解析：成功原样返回；ZodError → InternalContractError(→500)。
 * 与输入边界（请求体）的 parse 区分开，避免服务端装配 bug 被当成客户端 422。
 */
export function parseOutputContract<T extends ZodTypeAny>(schema: T, value: unknown, context: string): z.infer<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new InternalContractError(context, error);
    }
    throw error;
  }
}
