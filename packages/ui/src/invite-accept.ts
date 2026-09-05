import { normalizeWorkHubLocale, type WorkHubLocale } from "./gold-path/i18n.js";

// R20 P1-05：邀请接受落地页。POST /api/auth/invites/accept 的公开前端入口——收件人凭 out-of-band
// token 在未登录态填「令牌 + 昵称 + 密码」建号。邀请只在密码登录模式可用（昵称模式无邀请），故这里
// 始终要求密码；成功后服务端已 mint 会话 cookie，浏览器侧直接跳回工作台即以新账号登录。
export type InviteAcceptScreenInput = {
  locale?: WorkHubLocale | undefined;
  /** 从 ?token= 预填的邀请令牌（可为空，用户可手填）。 */
  token?: string | undefined;
  /** 提交失败时的人话错误（原文呈现，不翻译）。 */
  errorText?: string | undefined;
};

export type InviteAcceptCopyKey =
  | "kicker"
  | "title"
  | "summary"
  | "tokenLabel"
  | "tokenPlaceholder"
  | "nicknameLabel"
  | "nicknamePlaceholder"
  | "passwordLabel"
  | "passwordPlaceholder"
  | "passwordHint"
  | "localeLabel"
  | "submit"
  | "note";

import { inviteAcceptCopy } from "./invite-accept-copy.js";

function t(locale: WorkHubLocale, key: InviteAcceptCopyKey) {
  return inviteAcceptCopy[locale][key];
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// 复用注册屏的视觉语言（同一套 wh-onboarding-* 类），落地页与报到页观感一致。
export const inviteAcceptScreenCss = [
  "body{margin:0;background:#f6f9fd;color:#172033;overflow-x:hidden}",
  ".wh-onboarding-screen{min-height:100vh;display:grid;place-items:center;padding:24px;font-family:\"Aptos\",\"Segoe UI\",sans-serif;background:linear-gradient(180deg,#fbfdff 0%,#edf4fb 100%);box-sizing:border-box}",
  ".wh-onboarding-screen,.wh-onboarding-screen *{box-sizing:border-box}",
  ".wh-onboarding-card{width:min(440px,100%);display:grid;gap:14px;border:1px solid #dfe5f1;border-radius:12px;background:rgba(255,255,255,.96);padding:26px;box-shadow:0 18px 48px rgba(37,51,79,.09);min-width:0}",
  ".wh-onboarding-kicker{color:#3b6fe0;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}",
  ".wh-onboarding-card h1{margin:0;font-size:24px;line-height:1.35;overflow-wrap:anywhere}",
  ".wh-onboarding-card p{margin:0;color:#66728c;font-size:13px;line-height:1.55;overflow-wrap:anywhere}",
  ".wh-onboarding-field{display:grid;gap:6px;min-width:0}",
  ".wh-onboarding-field label{font-size:12px;font-weight:850;color:#46536e;line-height:1.35}",
  ".wh-onboarding-field input{border:1px solid #cdd8ea;border-radius:8px;padding:11px 12px;font-size:14px;line-height:1.35;min-width:0;width:100%;font-family:inherit}",
  ".wh-onboarding-field input:focus{outline:2px solid #3b6fe0;outline-offset:1px}",
  ".wh-onboarding-locales{display:flex;gap:8px;flex-wrap:wrap}",
  ".wh-onboarding-locales button{border:1px solid #cdd8ea;border-radius:999px;background:#fff;color:#46536e;font-size:12px;font-weight:850;line-height:1.35;padding:7px 14px;cursor:pointer}",
  ".wh-onboarding-locales button[aria-pressed=true]{background:#3b6fe0;border-color:#3b6fe0;color:#fff}",
  ".wh-onboarding-error{border:1px solid #f0c5bd;background:#fdf3f1;border-radius:8px;color:#a4392a;font-size:13px;line-height:1.5;padding:10px 12px;overflow-wrap:anywhere}",
  ".wh-onboarding-submit{border:0;border-radius:8px;background:#3b6fe0;color:#fff;font-size:14px;font-weight:900;line-height:1.35;padding:12px 14px;cursor:pointer;width:100%;font-family:inherit}",
  ".wh-onboarding-submit:hover{background:#3263cc}",
  ".wh-onboarding-note{color:#8a95ad;font-size:11px;line-height:1.45;overflow-wrap:anywhere}"
].join("");

export function renderInviteAcceptScreen(input: InviteAcceptScreenInput = {}) {
  const locale = normalizeWorkHubLocale(input.locale);
  const token = input.token ?? "";
  const html = `<style>${inviteAcceptScreenCss}</style>
    <main class="wh-onboarding-screen" data-r4-web-route-status="invite-accept" data-r20-invite-accept="true" data-r20-invite-accept-locale="${escapeHtml(locale)}">
      <form class="wh-onboarding-card" data-r20-invite-accept-form="true" novalidate>
        <span class="wh-onboarding-kicker">${escapeHtml(t(locale, "kicker"))}</span>
        <h1>${escapeHtml(t(locale, "title"))}</h1>
        <p>${escapeHtml(t(locale, "summary"))}</p>
        ${input.errorText ? `<div class="wh-onboarding-error" data-r20-invite-accept-error="true" role="alert">${escapeHtml(input.errorText)}</div>` : ""}
        <div class="wh-onboarding-field">
          <label for="wh-invite-token">${escapeHtml(t(locale, "tokenLabel"))}</label>
          <input id="wh-invite-token" name="token" type="text" required maxlength="512" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(t(locale, "tokenPlaceholder"))}" value="${escapeHtml(token)}" data-r20-invite-accept-token="true" />
        </div>
        <div class="wh-onboarding-field">
          <label for="wh-invite-nickname">${escapeHtml(t(locale, "nicknameLabel"))}</label>
          <input id="wh-invite-nickname" name="nickname" type="text" required maxlength="64" autocomplete="username" placeholder="${escapeHtml(t(locale, "nicknamePlaceholder"))}" data-r20-invite-accept-nickname="true" />
        </div>
        <div class="wh-onboarding-field">
          <label for="wh-invite-password">${escapeHtml(t(locale, "passwordLabel"))}</label>
          <input id="wh-invite-password" name="password" type="password" required minlength="8" maxlength="1024" autocomplete="new-password" placeholder="${escapeHtml(t(locale, "passwordPlaceholder"))}" data-r20-invite-accept-password="true" />
          <p class="wh-onboarding-note">${escapeHtml(t(locale, "passwordHint"))}</p>
        </div>
        <div class="wh-onboarding-field">
          <label>${escapeHtml(t(locale, "localeLabel"))}</label>
          <div class="wh-onboarding-locales" role="group" aria-label="${escapeHtml(t(locale, "localeLabel"))}">
            <button type="button" data-r20-invite-accept-locale-option="zh-CN" aria-pressed="${String(locale === "zh-CN")}">中文</button>
            <button type="button" data-r20-invite-accept-locale-option="en-US" aria-pressed="${String(locale === "en-US")}">English</button>
          </div>
        </div>
        <button type="submit" class="wh-onboarding-submit" data-r20-invite-accept-submit="true">${escapeHtml(t(locale, "submit"))}</button>
        <p class="wh-onboarding-note">${escapeHtml(t(locale, "note"))}</p>
      </form>
    </main>`;
  return { html, locale };
}
