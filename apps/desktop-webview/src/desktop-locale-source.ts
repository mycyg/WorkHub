// WorkHub 桌面 · 「从零开始」解析一次建号请求该带的 locale（R24 S4 桌面端接线）。
//
// 背景：本机真机走查发现英文用户的整个桌面端被翻成中文——服务端新建用户 preferred_locale 曾恒为
// zh-CN。服务端已修（.agents/notes/implemented/2026-09-05-bootstrap-idempotency-and-locale.md）：
// 四个建号入口（identify/desktop-bootstrap/register/invites-accept）新增可选 locale 字段，真正新建
// 用户时优先用它、其次退回 Accept-Language、都没有才落旧默认 zh-CN；桌面端此前完全没有传这个字段。
//
// desktop-rebind.ts / desktop-login.ts 的四个 run* 函数（runDesktopRebind /
// runDesktopCredentialLogin / runDesktopCredentialRegister / runDesktopInviteAccept）不需要这个
// 模块——它们的调用方（bindDesktopRebindScreen / bindDesktopCredentialGate）在挂载这张屏之前就已经
// 用 @workhub/web-runtime 的 browserLocale() 解出了这扇窗当前的语言，直接把这个已知值原样传下去即可，
// 不需要在提交时重新计算一遍。本模块只服务**没有**现成已解析 locale 可用的调用点——目前是
// spotlight/views/drive.ts 的 refreshDriveResourceToken（网盘取数遇 401/403 时静默换新令牌的自愈
// 路径，深处一个独立函数，够不到任何 boot 时解析过的 locale 变量）。
//
// 优先级刻意不复用 packages/contracts/src/locale.ts 的 normalizeWorkHubLocale——原因与服务端
// apps/api/src/middleware/auth.ts 的 resolveNewUserLocale 顶注同一个：normalizeWorkHubLocale 对
// 「认不出是不是中文」的值兜底 zh-CN（defaultWorkHubLocale），而这里（同服务端 Accept-Language 分支）
// 要的语义是「有信号但认不出是不是中文」一律落 en-US——两者默认方向相反。复用它会让一个
// fr-FR/ja-JP 的 navigator.language 被误判成中文用户，比完全不处理还糟，也正是这次要修的原始 bug
// （英文/其它非中文用户被服务端旧默认判成中文）的同一形状。因此这里镜像服务端 resolveNewUserLocale
// 的判定结构，只是「显式 locale／Accept-Language」换成「已保存偏好／navigator.language」：
//   1) 应用内已保存的语言偏好——localStorage[workHubLocaleStorageKey]，且恰好是 "zh-CN"/"en-US"
//      之一（这个键只由本应用写入，正常情况总是这两个值之一；不是这两者之一时按未保存处理，落到
//      第 2 步用 navigator.language 重新判断，而不是把一个损坏的存储值当真）；
//   2) 没有已保存偏好、但有 navigator.language：只看是否为 zh/zh-* 前缀——是则 zh-CN，其它任何值
//      （含无法识别的怪值，如 fr-FR/ja-JP）一律归 en-US；
//   3) 两者都没有（SSR/非 DOM 环境，理论上桌面端不会命中）——落旧默认 zh-CN，与「完全没有 Accept-
//      Language 头」时服务端的兜底口径一致（没有任何信号时不改变这条路径的既有行为）。
import { defaultWorkHubLocale, workHubLocaleStorageKey, type WorkHubLocale } from "@workhub/contracts";

export function resolveDesktopRequestLocale(input?: {
  storage?: Pick<Storage, "getItem"> | undefined;
  navigatorLanguage?: string | undefined;
}): WorkHubLocale {
  const storage = input?.storage ?? globalThis.localStorage;
  const navigatorLanguage = input?.navigatorLanguage ?? globalThis.navigator?.language;
  // 同 browserLocale()（L#69 既有取舍）：localStorage 在隐私模式/配额已满/被禁用时可能抛错——读失败
  // 退化为仅用 navigator 语言，不能让「查一下语言偏好」这种非关键读顺带炸掉一次令牌自愈请求。
  let stored: string | null = null;
  try {
    stored = storage?.getItem(workHubLocaleStorageKey) ?? null;
  } catch {
    stored = null;
  }
  if (stored === "zh-CN" || stored === "en-US") {
    return stored;
  }
  if (!navigatorLanguage) {
    return defaultWorkHubLocale;
  }
  const primaryTag = navigatorLanguage.trim().toLowerCase();
  return primaryTag === "zh" || primaryTag.startsWith("zh-") ? "zh-CN" : "en-US";
}
