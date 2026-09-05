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
    summary: "告诉团队你是谁。每个项目都有群聊、网盘和 AI 项目经理——派活干活它来，审批拍板归你。",
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
    summary: "Tell the team who you are. Every project gets a group chat, a drive and an AI project manager - it does the work, you approve and decide.",
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

// R23 P2（SA-04）：生产环境强制 AUTH_MODE!='nickname' 时，上面的 renderOnboardingScreen（昵称 +
// 管理员口令）不适用——POST /api/auth/identify 在这个模式下恒 404。这是密码/hybrid 模式的对应入口屏：
// 登录（POST /api/auth/login）与注册（POST /api/auth/register）同屏两个 tab，调用方
// （apps/web/src/browser.ts）按 auth-screen-mode.ts 探测到的模式二选一渲染这个还是上面那个。
// 零管理员实例的首个注册者服务端自动提为管理员（同 packages/api-client/src/types.ts 的
// PasswordRegisterRequest 注释）——register tab 用一句提示说明这件事，而不是让用户毫无准备地
// 「顺手注册」出一个自己都不知道拥有管理员权限的账号。
export type PasswordAuthScreenTab = "login" | "register";

export type PasswordAuthScreenInput = {
  locale?: WorkHubLocale | undefined;
  tab?: PasswordAuthScreenTab | undefined;
  /** 服务端/校验失败的人话错误（邮箱或密码不正确、该邮箱已注册等）。原文呈现，不翻译。 */
  errorText?: string | undefined;
  /** 登录成功后将进入的目标路径（深链保持的可见承诺，同 renderOnboardingScreen）。 */
  targetRoute?: string | undefined;
  /** 报错重渲后保留用户已输入的邮箱，不用重打一遍。 */
  presetEmail?: string | undefined;
  /** 报错重渲后保留用户已输入的昵称（仅 register tab）。 */
  presetNickname?: string | undefined;
};

type PasswordAuthCopyKey =
  | "kicker"
  | "loginTitle"
  | "loginSummary"
  | "registerTitle"
  | "registerSummary"
  | "tabLogin"
  | "tabRegister"
  | "emailLabel"
  | "emailPlaceholder"
  | "passwordLabel"
  | "nicknameLabel"
  | "nicknamePlaceholder"
  | "localeLabel"
  | "submitLogin"
  | "submitRegister"
  | "firstAdminHint"
  | "targetPrefix";

const passwordAuthCopy: Record<WorkHubLocale, Record<PasswordAuthCopyKey, string>> = {
  "zh-CN": {
    kicker: "WorkHub",
    loginTitle: "登录 WorkHub",
    loginSummary: "这个实例要求账号和密码登录。输入邮箱和密码进入工作台。",
    registerTitle: "创建账号",
    registerSummary: "还没有账号？用邮箱和密码创建一个。",
    tabLogin: "登录",
    tabRegister: "注册",
    emailLabel: "邮箱",
    emailPlaceholder: "you@example.com",
    passwordLabel: "密码",
    nicknameLabel: "你的昵称",
    nicknamePlaceholder: "例如：小拓",
    localeLabel: "界面语言",
    submitLogin: "登录",
    submitRegister: "创建账号",
    firstAdminHint: "本实例目前还没有管理员——如果你是第一个注册的人，这个账号会自动成为管理员。",
    targetPrefix: "完成后将打开"
  },
  "en-US": {
    kicker: "WorkHub",
    loginTitle: "Sign in to WorkHub",
    loginSummary: "This instance requires an account and password. Enter your email and password to continue.",
    registerTitle: "Create your account",
    registerSummary: "No account yet? Create one with an email and password.",
    tabLogin: "Sign in",
    tabRegister: "Register",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    passwordLabel: "Password",
    nicknameLabel: "Your nickname",
    nicknamePlaceholder: "e.g. Alex",
    localeLabel: "Interface language",
    submitLogin: "Sign in",
    submitRegister: "Create account",
    firstAdminHint: "This instance has no admin yet — if you're the first person to register, this account becomes the admin automatically.",
    targetPrefix: "You will land on"
  }
};

function authT(locale: WorkHubLocale, key: PasswordAuthCopyKey) {
  return passwordAuthCopy[locale][key];
}

const passwordAuthScreenCss = [
  ".wh-auth-tabs{display:flex;gap:8px}",
  ".wh-auth-tabs button{flex:1;border:1px solid #cdd8ea;border-radius:8px;background:#fff;color:#46536e;font-size:13px;font-weight:850;line-height:1.35;padding:9px 10px;cursor:pointer;font-family:inherit}",
  ".wh-auth-tabs button[aria-selected=true]{background:#3b6fe0;border-color:#3b6fe0;color:#fff}",
  ".wh-auth-hint{border:1px solid #cdd8ea;background:#f6f9fd;border-radius:8px;color:#46536e;font-size:12px;line-height:1.5;padding:9px 12px;overflow-wrap:anywhere}"
].join("");

export function renderPasswordAuthScreen(input: PasswordAuthScreenInput = {}) {
  const locale = normalizeWorkHubLocale(input.locale);
  const tab: PasswordAuthScreenTab = input.tab === "register" ? "register" : "login";
  const isRegister = tab === "register";
  const targetRoute = input.targetRoute && input.targetRoute !== "/" ? input.targetRoute : "";
  const html = `<style>${onboardingScreenCss}${passwordAuthScreenCss}</style>
    <main class="wh-onboarding-screen" data-r4-web-route-status="onboarding" data-r23-auth-screen="true" data-r23-auth-tab="${tab}" data-r23-auth-locale="${escapeHtml(locale)}">
      <form class="wh-onboarding-card" data-r23-auth-form="true" data-r23-auth-form-tab="${tab}" novalidate>
        <span class="wh-onboarding-kicker">${escapeHtml(authT(locale, "kicker"))}</span>
        <div class="wh-auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${String(!isRegister)}" data-r23-auth-tab-option="login">${escapeHtml(authT(locale, "tabLogin"))}</button>
          <button type="button" role="tab" aria-selected="${String(isRegister)}" data-r23-auth-tab-option="register">${escapeHtml(authT(locale, "tabRegister"))}</button>
        </div>
        <h1>${escapeHtml(authT(locale, isRegister ? "registerTitle" : "loginTitle"))}</h1>
        <p>${escapeHtml(authT(locale, isRegister ? "registerSummary" : "loginSummary"))}</p>
        ${input.errorText ? `<div class="wh-onboarding-error" data-r23-auth-error="true" role="alert">${escapeHtml(input.errorText)}</div>` : ""}
        <div class="wh-onboarding-field">
          <label for="wh-auth-email">${escapeHtml(authT(locale, "emailLabel"))}</label>
          <input id="wh-auth-email" name="email" type="email" required maxlength="320" autocomplete="username" inputmode="email" placeholder="${escapeHtml(authT(locale, "emailPlaceholder"))}" value="${escapeHtml(input.presetEmail ?? "")}" data-r23-auth-email="true" />
        </div>
        ${isRegister ? `<div class="wh-onboarding-field">
          <label for="wh-auth-nickname">${escapeHtml(authT(locale, "nicknameLabel"))}</label>
          <input id="wh-auth-nickname" name="nickname" type="text" required maxlength="64" autocomplete="nickname" placeholder="${escapeHtml(authT(locale, "nicknamePlaceholder"))}" value="${escapeHtml(input.presetNickname ?? "")}" data-r23-auth-nickname="true" />
        </div>` : ""}
        <div class="wh-onboarding-field">
          <label for="wh-auth-password">${escapeHtml(authT(locale, "passwordLabel"))}</label>
          <input id="wh-auth-password" name="password" type="password" required minlength="8" maxlength="1024" autocomplete="${isRegister ? "new-password" : "current-password"}" data-r23-auth-password="true" />
        </div>
        ${isRegister ? `<p class="wh-auth-hint" data-r23-auth-first-admin-hint="true">${escapeHtml(authT(locale, "firstAdminHint"))}</p>` : ""}
        <div class="wh-onboarding-field">
          <label>${escapeHtml(authT(locale, "localeLabel"))}</label>
          <div class="wh-onboarding-locales" role="group" aria-label="${escapeHtml(authT(locale, "localeLabel"))}">
            <button type="button" data-r23-auth-locale-option="zh-CN" aria-pressed="${String(locale === "zh-CN")}">中文</button>
            <button type="button" data-r23-auth-locale-option="en-US" aria-pressed="${String(locale === "en-US")}">English</button>
          </div>
        </div>
        <button type="submit" class="wh-onboarding-submit" data-r23-auth-submit="true">${escapeHtml(authT(locale, isRegister ? "submitRegister" : "submitLogin"))}</button>
        ${targetRoute ? `<p class="wh-onboarding-target" data-r23-auth-target="${escapeHtml(targetRoute)}">${escapeHtml(authT(locale, "targetPrefix"))} ${escapeHtml(targetRoute)}</p>` : ""}
      </form>
    </main>`;
  return { html, locale, tab };
}
