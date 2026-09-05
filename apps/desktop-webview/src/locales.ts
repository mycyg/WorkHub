// apps/desktop-webview/src 的用户可见文案单一来源。
//
// 形状照 deepseek-harness 的 per-package `locales.ts`（MIT, Copyright (c) 2026 DeepSeek）：
// **中文对象是 key 集的事实源**，英文对象用 `satisfies Record<keyof typeof zh, string>` 做
// 编译期对齐——少一个键或多一个键都编译不过，不需要额外的门禁脚本来盯对称性。
//
// 这些字符串原本以 `zh ? "中文" : "English"` 内联在渲染代码里；搬进来时一个字都没改。
// 门禁见 scripts/dev/check-ui-i18n.ts（含汉字的字面量只许住在词典文件里）。

import { normalizeWorkHubLocale, type WorkHubLocale } from "@workhub/contracts";

const zh = {
  acceptInvite: "接受邀请",
  canTReachTheServerReconnecting: "服务器连不上，正在重连…",
  checkThatEmailNicknameAndPassword: "请检查邮箱、昵称和密码是否有效（密码至少 8 位）。",
  checkThatTheInviteTokenNickname: "请检查邀请令牌、昵称和密码是否有效（密码至少 8 位）。",
  couldnTAcceptTheInviteCheck: "接受邀请失败，请检查后端连接后重试。",
  email: "邮箱",
  emailOrPasswordIsIncorrectPlease: "邮箱或密码不正确，请重试。",
  enterANicknameToReBind: "输入昵称重新绑定这台设备。",
  enterAValidEmailAndPassword: "请填写有效的邮箱和密码。",
  enterTheInviteTokenNicknameAnd: "请填写邀请令牌、昵称和密码。",
  enterYourEmailAndPassword: "请填写邮箱和密码。",
  enterYourEmailNicknameAndPassword: "请填写邮箱、昵称和密码。",
  haveAnInviteToken: "我有邀请令牌",
  inviteToken: "邀请令牌",
  nickname: "昵称",
  offline: "已离线",
  password: "密码",
  passwordLoginIsnTEnabledOn: "当前后端未启用密码登录。",
  passwordRegistrationIsnTEnabledOn: "当前后端未启用密码注册。",
  pasteTheInviteTokenYourAdmin: "粘贴管理员发给你的邀请令牌",
  pleaseEnterANicknameFirst: "请先填写昵称。",
  register: "注册",
  registrationFailedCheckTheBackendConnection: "注册失败，请检查后端连接后重试。",
  signIn: "登录",
  signInFailedCheckTheBackend: "登录失败，请检查后端连接后重试。",
  signInMethod: "登录方式",
  signInToWorkhub: "登录 WorkHub",
  signedOut: "已登出",
  thatEmailIsAlreadyRegisteredSign: "该邮箱已注册，请改用登录。",
  theAiServiceIsnTConfigured: "AI 服务未配置，Cuu 不会回应——需要在服务端配置模型密钥（见部署文档 DEPLOY.md）",
  thisDeviceHasnTConnectedBefore: "这台设备第一次连接，去主窗口登录后 Cuu 才能开始帮你。",
  thisDeviceHasnTConnectedTo: "这台设备第一次连接这台服务器：登录已有账号、注册新账号，或用邀请令牌加入。",
  thisDeviceHasnTConnectedTo2: "这台设备第一次连接这台服务器，输入昵称就能开始。",
  thisDeviceSignedOutSignBack: "这台设备已经登出，去主窗口重新登录后 Cuu 才能继续帮你。",
  thisDeviceSignsInWithEmail: "这台设备使用邮箱 + 密码登录。登录后会绑定为受信任设备。",
  thisInviteIsInvalidOrExpired: "邀请无效或已过期，请向管理员索取新的邀请。",
  tooManyAttemptsPleaseWaitA: "登录尝试过于频繁，请稍后再试。",
  tooManyAttemptsPleaseWaitA2: "尝试过于频繁，请稍后再试。",
  welcomeToWorkhub: "欢迎使用 WorkHub",
  yourNickname: "你的昵称",
} as const;

const en = {
  acceptInvite: "Accept invite",
  canTReachTheServerReconnecting: "Can't reach the server — reconnecting…",
  checkThatEmailNicknameAndPassword: "Check that email, nickname, and password are valid (password needs at least 8 characters).",
  checkThatTheInviteTokenNickname: "Check that the invite token, nickname, and password are valid (password needs at least 8 characters).",
  couldnTAcceptTheInviteCheck: "Couldn't accept the invite — check the backend connection and retry.",
  email: "Email",
  emailOrPasswordIsIncorrectPlease: "Email or password is incorrect. Please try again.",
  enterANicknameToReBind: "Enter a nickname to re-bind this device.",
  enterAValidEmailAndPassword: "Enter a valid email and password.",
  enterTheInviteTokenNicknameAnd: "Enter the invite token, nickname, and password.",
  enterYourEmailAndPassword: "Enter your email and password.",
  enterYourEmailNicknameAndPassword: "Enter your email, nickname, and password.",
  haveAnInviteToken: "Have an invite token",
  inviteToken: "Invite token",
  nickname: "Nickname",
  offline: "Offline",
  password: "Password",
  passwordLoginIsnTEnabledOn: "Password login isn't enabled on this backend.",
  passwordRegistrationIsnTEnabledOn: "Password registration isn't enabled on this backend.",
  pasteTheInviteTokenYourAdmin: "Paste the invite token your admin sent you",
  pleaseEnterANicknameFirst: "Please enter a nickname first.",
  register: "Register",
  registrationFailedCheckTheBackendConnection: "Registration failed — check the backend connection and retry.",
  signIn: "Sign in",
  signInFailedCheckTheBackend: "Sign-in failed — check the backend connection and retry.",
  signInMethod: "Sign-in method",
  signInToWorkhub: "Sign in to WorkHub",
  signedOut: "Signed out",
  thatEmailIsAlreadyRegisteredSign: "That email is already registered — sign in instead.",
  theAiServiceIsnTConfigured: "The AI service isn't configured, so Cuu won't reply — a model key needs to be set up on the server (see DEPLOY.md).",
  thisDeviceHasnTConnectedBefore: "This device hasn't connected before — sign in from the main window before Cuu can help.",
  thisDeviceHasnTConnectedTo: "This device hasn't connected to this server before — sign in, register, or join with an invite token.",
  thisDeviceHasnTConnectedTo2: "This device hasn't connected to this server before — enter a nickname to get started.",
  thisDeviceSignedOutSignBack: "This device signed out — sign back in from the main window before Cuu can help again.",
  thisDeviceSignsInWithEmail: "This device signs in with email and password, then binds as a trusted device.",
  thisInviteIsInvalidOrExpired: "This invite is invalid or expired — ask your admin for a new one.",
  tooManyAttemptsPleaseWaitA: "Too many attempts. Please wait a moment and retry.",
  tooManyAttemptsPleaseWaitA2: "Too many attempts. Please wait a moment and retry.",
  welcomeToWorkhub: "Welcome to WorkHub",
  yourNickname: "Your nickname",
} as const satisfies Record<keyof typeof zh, string>;

export type DesktopCopyKey = keyof typeof zh;

// 第一参数收 `boolean` 是过渡口子：这一层的渲染函数历史上大量以 `zh: boolean` 传语言，
// 把这些签名一起改成 `locale` 是另一件事，不该和「文案搬家」混在一批里。
export function desktopT(locale: WorkHubLocale | boolean, key: DesktopCopyKey): string {
  const isZh = typeof locale === "boolean" ? locale : normalizeWorkHubLocale(locale) === "zh-CN";
  return (isZh ? zh : en)[key];
}
