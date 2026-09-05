// 报到屏 / 密码登录屏的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import type { WorkHubLocale } from "@workhub/contracts";

import type { OnboardingCopyKey, PasswordAuthCopyKey } from "./onboarding.js";

export const onboardingCopy: Record<WorkHubLocale, Record<OnboardingCopyKey, string>> = {
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
    lanNote: "在公司内网里填个昵称就能加入，不需要密码。"
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
    lanNote: "On the local network you can join with a nickname, no password needed."
  }
};

export const passwordAuthCopy: Record<WorkHubLocale, Record<PasswordAuthCopyKey, string>> = {
  "zh-CN": {
    kicker: "WorkHub",
    loginTitle: "登录 WorkHub",
    loginSummary: "这个团队用邮箱和密码登录。输入后进入工作台。",
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
    firstAdminHint: "这个团队还没有管理员——第一个注册的人会成为管理员。",
    targetPrefix: "完成后将打开"
  },
  "en-US": {
    kicker: "WorkHub",
    loginTitle: "Sign in to WorkHub",
    loginSummary: "This team signs in with email and password. Enter yours to continue.",
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
    firstAdminHint: "No admin yet — the first person to sign up becomes one.",
    targetPrefix: "You will land on"
  }
};
