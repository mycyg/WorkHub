export const authDefaults = {
  cookieName: "yqgl_id",
  localClientHeader: "X-YQGL-Client-Token",
  cookieMaxAgeSeconds: 60 * 60 * 24 * 365,
  cookieSalt: "yqgl-identity-v1",
  defaultOrgId: "00000000-0000-4000-8000-000000000001",
  defaultWorkspaceId: "00000000-0000-4000-8000-000000000002",
  // R2 auth epic：会话过期默认（仅 AUTH_MODE!='nickname' 时生效）。绝对=硬上限，到点强制重登；
  // idle=滑动，每次活动续期但永不越过绝对上限。
  sessionAbsoluteTtlHours: 24 * 30,
  sessionIdleTtlHours: 24 * 7
} as const;
