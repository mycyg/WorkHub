import { WorkHubApiError } from "@workhub/api-client/client";
import type { IdentifyRequest, IdentityResponse } from "@workhub/api-client";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

// R23 P2（SA-04）：生产环境强制 AUTH_MODE!='nickname' 时，POST /api/auth/identify 直接 404
// （apps/api/src/routes/auth.ts 的 passwordModeEnabled 门在解析请求体之前就先检查）——web 端唯一的
// 引导屏（packages/ui/src/onboarding.ts 的 renderOnboardingScreen）却只有「昵称 + 管理员口令」字段，
// 密码/hybrid 模式的用户完全无路可走。
//
// AUTH_MODE 是部署期常量（读环境变量，容器生命周期内不变），但没有任何公开、无需鉴权的端点/health
// 字段直接暴露它（GET /api/health 只有 ai_provider_configured，不含 auth 模式）——新增这样一个端点
// 只为了探一个布尔值，收益不值得多一个需要维护的公开面。于是复用 identify 本身的这个 404：
//   - nickname 模式：identify 先解析请求体（identifyRequestSchema：nickname 至少 1 字符）——传空
//     昵称只会在这一步失败（422 validation_error），不会触发下面的 getOrCreateActiveByNickname，
//     不会建用户，没有副作用。
//   - password/hybrid 模式：passwordModeEnabled 检查发生在请求体解析之前，无论传什么昵称都直接
//     404——这是这条探测路径能可靠工作的关键（不依赖 payload 内容，只依赖服务端的模式判断顺序）。
// 这个探测函数不碰 DOM，纯依赖注入（同 onboarding-locale-sync.ts / desktop-login.ts 的先例），
// 便于在没有 jsdom 的测试运行器里单测。
export type AuthScreenMode = "nickname" | "password";

export async function detectAuthScreenMode(
  identify: (payload: IdentifyRequest) => Promise<IdentityResponse>
): Promise<AuthScreenMode> {
  try {
    await identify({ nickname: "" });
  } catch (error) {
    if (error instanceof WorkHubApiError && error.status === 404) {
      return "password";
    }
    // 其它任何失败（422 校验错误＝nickname 模式确认可用；网络错误/5xx＝探测失败，不确定）都按
    // nickname 处理——这是本仓库 AUTH_MODE 的默认值，探测失败时保留现状远比误判成密码模式、把
    // LAN 信任模式的用户扔进一个陌生的邮箱密码表单更安全。
    return "nickname";
  }
  // identify 理论上不会在传空昵称时成功（schema 要求至少 1 字符）；万一服务端行为变化导致真的
  // 成功了，也按 nickname 处理——这个分支不该出现，出现时 fail open 到侵入性最小的既有体验。
  return "nickname";
}

// R23 P2（SA-04）：把服务端/网络错误翻成用户可读的一句话——同 apps/desktop-webview/src/desktop-login.ts
// 的 describeDesktopLoginError 先例（那份只覆盖 login；这里额外覆盖 register 的 409/凭据模式判断）。
// 401 的统一口径「邮箱或密码不正确」不区分「邮箱不存在」与「密码错」，避免账号枚举。
export function describeAuthScreenError(error: unknown, locale: WorkHubLocale, context: "login" | "register"): string {
  const zh = locale === "zh-CN";
  if (error instanceof WorkHubApiError) {
    if (context === "login" && error.status === 401) {
      return zh ? "邮箱或密码不正确，请重试。" : "Email or password is incorrect. Please try again.";
    }
    if (error.status === 429) {
      return zh ? "尝试过于频繁，请稍后再试。" : "Too many attempts. Please wait a moment and retry.";
    }
    if (context === "register" && error.status === 409) {
      return zh ? "该邮箱已注册，请改用登录。" : "That email is already registered — sign in instead.";
    }
    if (error.status === 400 || error.status === 422) {
      return context === "register"
        ? (zh
          ? "请检查邮箱、昵称和密码是否有效（密码至少 8 位）。"
          : "Check that email, nickname, and password are valid (password needs at least 8 characters).")
        : (zh ? "请填写有效的邮箱和密码。" : "Enter a valid email and password.");
    }
    if (error.status === 404) {
      // 罕见竞态：探测时是密码模式，提交时后端刚好切回了 nickname 模式（部署配置变更 + 重启）。
      return zh ? "当前后端未启用这种登录方式，请刷新页面重试。" : "This sign-in method isn't enabled on this backend — refresh and try again.";
    }
  }
  return zh
    ? (context === "login" ? "登录失败，请检查网络连接后重试。" : "注册失败，请检查网络连接后重试。")
    : (context === "login" ? "Sign-in failed — check your connection and retry." : "Registration failed — check your connection and retry.");
}
