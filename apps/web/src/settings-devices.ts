import type { ClientDeviceResponse } from "@workhub/contracts";
import type { WorkHubLocale } from "@workhub/ui/gold-path";

// R20 P2-05（设备管理 API 完整但零 UI）：/api/client-devices 四端点（register/me/current/:id revoke）
// 此前从未被任何前端调用过——本文件是 web /settings「已登录设备」区块的纯格式化/判定层（无 DOM 依赖，
// 可直接单测），供 apps/web/src/browser.ts 的 bindSettingsDevicesPanel 水合时调用。拆出来的原因同
// drive-actions.ts/browser-action-notice.ts 的既有先例：这里的判定逻辑（本机匹配/撤销态/错误人话化）
// 值得单测覆盖，browser.ts 里纯粹的 DOM 拼装胶水代码则不单独测（本仓库对 bind* 系列水合函数的一贯做法，
// 该仓库没有 jsdom/happy-dom，真实 DOM 行为只能靠人工/浏览器验证）。

export type SettingsDeviceRowViewModel = {
  id: string;
  deviceName: string;
  platform: string;
  lastSeenLabel: string;
  isCurrent: boolean;
  isRevoked: boolean;
  statusLabel: string;
  canRevoke: boolean;
};

// 「最近活跃」本地化显示——同 apps/desktop-webview/src/spotlight/views/memory.ts 的
// formatMemoryTimestamp 套路（Intl.DateTimeFormat 按 locale 走，年月日+时分，24 小时制）。
// 从未连接过（lastSeenAt 缺失，理论上不会发生——注册即写入，但契约里 last_seen_at 是 optional）
// 时给诚实的空态文案而非硬渲染 "Invalid Date"。
export function formatDeviceLastSeen(lastSeenAt: string | undefined, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  if (!lastSeenAt) {
    return zh ? "从未连接" : "Never connected";
  }
  const parsed = new Date(lastSeenAt);
  if (Number.isNaN(parsed.getTime())) {
    return zh ? "从未连接" : "Never connected";
  }
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(parsed);
}

// 「本机」判定——currentDeviceId 来自尽力探测的 GET /api/client-devices/current（该端点要求本地客户端
// client-token 请求头；纯网页会话从不带这个头，探测会 403，bindSettingsDevicesPanel 把探测失败
// 折叠为 null，这里传 null 即诚实地不标注任何一行，而不是瞎猜/常显）。已撤销的设备即使 id 匹配也不再
// 算「本机」——撤销之后这个会话已经不该被信任为当前活跃设备。
export function isCurrentDevice(
  device: Pick<ClientDeviceResponse, "id" | "revoked_at">,
  currentDeviceId: string | null
): boolean {
  return currentDeviceId !== null && !device.revoked_at && device.id === currentDeviceId;
}

export function isDeviceRevoked(device: Pick<ClientDeviceResponse, "revoked_at">): boolean {
  return Boolean(device.revoked_at);
}

// 单台设备的展示行 VM——撤销态优先于本机态（已撤销的本机没有意义）；只有「未撤销且非本机」才允许撤销
// 按钮出现——本机会话没有自撤销入口（自撤销会立刻让当前请求的 client-token 失效，属于另一条独立动作
// r9ConfirmArmed revoke-current，不在本工单范围内，这里不接）。
export function buildSettingsDeviceRow(
  device: ClientDeviceResponse,
  currentDeviceId: string | null,
  locale: WorkHubLocale
): SettingsDeviceRowViewModel {
  const zh = locale === "zh-CN";
  const revoked = isDeviceRevoked(device);
  const current = isCurrentDevice(device, currentDeviceId);
  const statusLabel = revoked
    ? (zh ? "已撤销" : "Revoked")
    : current
      ? (zh ? "本机" : "This device")
      : (zh ? "活跃" : "Active");
  return {
    id: device.id,
    deviceName: device.device_name,
    platform: device.platform,
    lastSeenLabel: formatDeviceLastSeen(device.last_seen_at, locale),
    isCurrent: current,
    isRevoked: revoked,
    statusLabel,
    canRevoke: !revoked && !current
  };
}

// 撤销失败的人话化——不静默吞错（工单纪律③）。duck-type 读 `.code`（WorkHubApiError 的公开字段）而不
// import 运行时类，保持本模块零副作用/纯函数、单测无需构造真实错误实例。未知错误兜底成通用重试文案，
// 绝不把裸 Error.message（可能带内部细节）直接吐给用户。
export function humanizeDeviceRevokeError(error: unknown, locale: WorkHubLocale): string {
  const zh = locale === "zh-CN";
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "not_found") {
    return zh ? "没有找到这台设备，可能已经撤销过了。" : "That device wasn't found — it may already be revoked.";
  }
  if (code === "forbidden") {
    return zh ? "没有权限撤销这台设备。" : "You don't have permission to revoke that device.";
  }
  return zh ? "撤销失败，请稍后重试。" : "Revoke failed, please try again.";
}
