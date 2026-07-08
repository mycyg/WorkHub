import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { settings as defaultSettings, type Settings } from "@workhub/config";

import { readLocalClientToken } from "./auth.js";

// findings[8]：状态变更请求此前只靠 SameSite=Lax cookie 防 CSRF（CORS 只挡读取响应，不挡浏览器发出带 cookie 的写）。
// 这是在 cookie 之上再加一层"同源守卫"，不替换 cookie，也不需要任何前端改动：
//  - 桌面端用自定义 token header 做 bearer 鉴权，天然免疫 CSRF；
//  - web SPA 由 API 同源伺服，浏览器对每个跨源 mutation 必带 Sec-Fetch-Site 或 Origin 之一；
//  - 非浏览器/服务端调用两者都不带 → 放行，仍由既有 cookie/token 鉴权把关。
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// 同源守卫豁免的精确路径（仅桌面首启引导）。集中在此一处，便于审计豁免面。
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/desktop-bootstrap"]);

function csrfExemptPath(rawUrl: string): boolean {
  try {
    return CSRF_EXEMPT_PATHS.has(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

// 由请求自身重建 origin（scheme://host），优先反代头。仅在"有 Origin 但无 Sec-Fetch-Site"（老浏览器）时用到，
// 出错只会过度拒绝古早浏览器，绝不会放过现代浏览器的跨源写（那条由 Sec-Fetch-Site 兜住）。
function selfOrigin(c: Context): string | undefined {
  const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host");
  if (!host) {
    return undefined;
  }
  let scheme = c.req.header("X-Forwarded-Proto");
  if (!scheme) {
    try {
      scheme = new URL(c.req.url).protocol.replace(/:$/u, "");
    } catch {
      scheme = "http";
    }
  }
  return `${scheme}://${host}`;
}

export function createSameOriginGuardMiddleware(
  source: () => Settings = () => defaultSettings
): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method.toUpperCase())) {
      return next();
    }
    // (0) 桌面首启引导端点豁免：桌面是跨源(tauri://localhost)且首启无 cookie/无 token，
    //     必须能发起这一个 POST 才能拿到 client_token。豁免范围窄到单条精确路径，便于审计。
    //     token 走响应体 + CORS 不反射攻击源 → 跨源攻击页发得出请求却读不到 token，无新增 CSRF 面。
    if (csrfExemptPath(c.req.url)) {
      return next();
    }
    // (1) 本地客户端令牌（桌面）= header bearer 鉴权，免疫 CSRF。只认服务端真正用于鉴权的 header 集合
    //     （readLocalClientToken）——自定义 header 跨源需 CORS 预检，无法被伪造发出。
    if (readLocalClientToken(c)) {
      return next();
    }
    // (2) Sec-Fetch-Site：现代浏览器在每个 mutation 上都带。同源/同站/直接导航放行，明确跨站拒绝。
    const secFetchSite = c.req.header("Sec-Fetch-Site");
    if (secFetchSite) {
      if (secFetchSite === "same-origin" || secFetchSite === "same-site" || secFetchSite === "none") {
        return next();
      }
      throw new HTTPException(403, { message: "跨站请求被拒绝。(Cross-site request rejected.)" });
    }
    // (3) 退而求其次（老浏览器无 Sec-Fetch-Site）：比对 Origin 与本服务 origin / CORS 白名单。
    const origin = c.req.header("Origin");
    if (origin) {
      const allowOrigins = source().auth.corsAllowOrigins;
      const self = selfOrigin(c);
      if (allowOrigins.includes("*") || allowOrigins.includes(origin) || (self !== undefined && origin === self)) {
        return next();
      }
      throw new HTTPException(403, { message: "跨域请求被拒绝。(Cross-origin request rejected.)" });
    }
    // (4) 既无 Sec-Fetch-Site 也无 Origin（非浏览器/服务端/老客户端）→ 放行，cookie/token 鉴权仍把关。
    return next();
  };
}
