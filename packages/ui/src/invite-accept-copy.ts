// 接受邀请屏的用户可见文案单一来源。
// 文案 locale 独占门禁：含汉字的字面量只许住在词典文件里，见 scripts/dev/check-ui-i18n.ts。

import type { WorkHubLocale } from "@workhub/contracts";

import type { InviteAcceptCopyKey } from "./invite-accept.js";

export const inviteAcceptCopy: Record<WorkHubLocale, Record<InviteAcceptCopyKey, string>> = {
  "zh-CN": {
    kicker: "WorkHub 邀请",
    title: "接受邀请，加入团队",
    summary: "用管理员给你的邀请码建立账号。加入后每个项目都有群聊、网盘和 AI 项目经理协作。",
    tokenLabel: "邀请码",
    tokenPlaceholder: "粘贴管理员给你的邀请码",
    nicknameLabel: "你的昵称",
    nicknamePlaceholder: "例如：小拓",
    passwordLabel: "设置密码",
    passwordPlaceholder: "至少 8 位",
    passwordHint: "这个密码只用于以后登录，我们不会明文保存它。",
    localeLabel: "界面语言",
    submit: "加入 WorkHub",
    note: "邀请码只能用一次，加入后就失效了。"
  },
  "en-US": {
    kicker: "WorkHub invite",
    title: "Accept your invite and join the team",
    summary: "Use the invite code your admin gave you to create an account. Every project gets a group chat, a drive and an AI project manager.",
    tokenLabel: "Invite code",
    tokenPlaceholder: "Paste the code from your admin",
    nicknameLabel: "Your nickname",
    nicknamePlaceholder: "e.g. Alex",
    passwordLabel: "Set a password",
    passwordPlaceholder: "At least 8 characters",
    passwordHint: "This password is only for signing in later; we never store it in plain text.",
    localeLabel: "Interface language",
    submit: "Join WorkHub",
    note: "The invite code works once and expires as soon as you join."
  }
};
