import { normalizeWorkHubLocale, type WorkHubLocale } from "./gold-path/i18n.js";

export type OnboardingScreenInput = {
  locale?: WorkHubLocale | undefined;
  /** 注册失败时的服务端人话错误（如管理员口令错误）。原文呈现，不翻译。 */
  errorText?: string | undefined;
  /** 注册成功后将进入的目标路径（deep link 保持的可见承诺）。 */
  targetRoute?: string | undefined;
};

type OnboardingCopyKey =
  | "kicker"
  | "title"
  | "summary"
  | "nicknameLabel"
  | "nicknamePlaceholder"
  | "localeLabel"
  | "adminToggle"
  | "adminLabel"
  | "adminHint"
  | "submit"
  | "targetPrefix"
  | "lanNote";

const onboardingCopy: Record<WorkHubLocale, Record<OnboardingCopyKey, string>> = {
  "zh-CN": {
    kicker: "WorkHub",
    title: "报到后开始干活",
    summary: "告诉团队你是谁。AI 是默认劳动力，你负责审批和拍板。",
    nicknameLabel: "你的昵称",
    nicknamePlaceholder: "例如：小拓",
    localeLabel: "界面语言",
    adminToggle: "我是管理员",
    adminLabel: "管理员口令",
    adminHint: "只有认领管理员昵称才需要填。",
    submit: "进入 WorkHub",
    targetPrefix: "完成后将打开",
    lanNote: "局域网信任模式：无需密码，凭昵称报到。"
  },
  "en-US": {
    kicker: "WorkHub",
    title: "Sign in to get to work",
    summary: "Tell the team who you are. AI does the work by default; you approve and decide.",
    nicknameLabel: "Your nickname",
    nicknamePlaceholder: "e.g. Alex",
    localeLabel: "Interface language",
    adminToggle: "I am an admin",
    adminLabel: "Admin passphrase",
    adminHint: "Only needed when claiming an admin nickname.",
    submit: "Enter WorkHub",
    targetPrefix: "You will land on",
    lanNote: "LAN trust mode: no password, just report in with a nickname."
  }
};

function t(locale: WorkHubLocale, key: OnboardingCopyKey) {
  return onboardingCopy[locale][key];
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export const onboardingScreenCss = [
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
  ".wh-onboarding-admin{border:1px dashed #cdd8ea;border-radius:8px;padding:10px 12px}",
  ".wh-onboarding-admin summary{cursor:pointer;font-size:12px;font-weight:850;color:#46536e;line-height:1.35}",
  ".wh-onboarding-admin .wh-onboarding-field{margin-top:10px}",
  ".wh-onboarding-error{border:1px solid #f0c5bd;background:#fdf3f1;border-radius:8px;color:#a4392a;font-size:13px;line-height:1.5;padding:10px 12px;overflow-wrap:anywhere}",
  ".wh-onboarding-submit{border:0;border-radius:8px;background:#3b6fe0;color:#fff;font-size:14px;font-weight:900;line-height:1.35;padding:12px 14px;cursor:pointer;width:100%;font-family:inherit}",
  ".wh-onboarding-submit:hover{background:#3263cc}",
  ".wh-onboarding-target{color:#66728c;font-size:12px;line-height:1.45;overflow-wrap:anywhere}",
  ".wh-onboarding-note{color:#8a95ad;font-size:11px;line-height:1.45;overflow-wrap:anywhere}"
].join("");

export function renderOnboardingScreen(input: OnboardingScreenInput = {}) {
  const locale = normalizeWorkHubLocale(input.locale);
  const targetRoute = input.targetRoute && input.targetRoute !== "/" ? input.targetRoute : "";
  const html = `<style>${onboardingScreenCss}</style>
    <main class="wh-onboarding-screen" data-r4-web-route-status="onboarding" data-r5-9-onboarding="true" data-r5-9-onboarding-locale="${escapeHtml(locale)}">
      <form class="wh-onboarding-card" data-r5-9-onboarding-form="true" novalidate>
        <span class="wh-onboarding-kicker">${escapeHtml(t(locale, "kicker"))}</span>
        <h1>${escapeHtml(t(locale, "title"))}</h1>
        <p>${escapeHtml(t(locale, "summary"))}</p>
        ${input.errorText ? `<div class="wh-onboarding-error" data-r5-9-onboarding-error="true" role="alert">${escapeHtml(input.errorText)}</div>` : ""}
        <div class="wh-onboarding-field">
          <label for="wh-onboarding-nickname">${escapeHtml(t(locale, "nicknameLabel"))}</label>
          <input id="wh-onboarding-nickname" name="nickname" type="text" required maxlength="64" autocomplete="username" placeholder="${escapeHtml(t(locale, "nicknamePlaceholder"))}" data-r5-9-onboarding-nickname="true" />
        </div>
        <div class="wh-onboarding-field">
          <label>${escapeHtml(t(locale, "localeLabel"))}</label>
          <div class="wh-onboarding-locales" role="group" aria-label="${escapeHtml(t(locale, "localeLabel"))}">
            <button type="button" data-r5-9-onboarding-locale-option="zh-CN" aria-pressed="${String(locale === "zh-CN")}">中文</button>
            <button type="button" data-r5-9-onboarding-locale-option="en-US" aria-pressed="${String(locale === "en-US")}">English</button>
          </div>
        </div>
        <details class="wh-onboarding-admin" data-r5-9-onboarding-admin="true">
          <summary>${escapeHtml(t(locale, "adminToggle"))}</summary>
          <div class="wh-onboarding-field">
            <label for="wh-onboarding-admin-secret">${escapeHtml(t(locale, "adminLabel"))}</label>
            <input id="wh-onboarding-admin-secret" name="admin_secret" type="password" maxlength="256" autocomplete="off" data-r5-9-onboarding-admin-secret="true" />
            <p class="wh-onboarding-note">${escapeHtml(t(locale, "adminHint"))}</p>
          </div>
        </details>
        <button type="submit" class="wh-onboarding-submit" data-r5-9-onboarding-submit="true">${escapeHtml(t(locale, "submit"))}</button>
        ${targetRoute ? `<p class="wh-onboarding-target" data-r5-9-onboarding-target="${escapeHtml(targetRoute)}">${escapeHtml(t(locale, "targetPrefix"))} ${escapeHtml(targetRoute)}</p>` : ""}
        <p class="wh-onboarding-note">${escapeHtml(t(locale, "lanNote"))}</p>
      </form>
    </main>`;
  return { html, locale };
}
