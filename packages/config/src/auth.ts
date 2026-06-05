export const authDefaults = {
  cookieName: "yqgl_id",
  localClientHeader: "X-YQGL-Client-Token",
  cookieMaxAgeSeconds: 60 * 60 * 24 * 365,
  cookieSalt: "yqgl-identity-v1",
  defaultOrgId: "00000000-0000-4000-8000-000000000001",
  defaultWorkspaceId: "00000000-0000-4000-8000-000000000002"
} as const;
