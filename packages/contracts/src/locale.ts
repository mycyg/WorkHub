import { z } from "zod";

export const workHubLocales = ["zh-CN", "en-US"] as const;
export const workHubLocaleSchema = z.enum(workHubLocales);
export type WorkHubLocale = z.infer<typeof workHubLocaleSchema>;

export const defaultWorkHubLocale: WorkHubLocale = "zh-CN";
export const workHubLocaleStorageKey = "workhub.locale";

export function normalizeWorkHubLocale(value: unknown): WorkHubLocale {
  if (typeof value !== "string") {
    return defaultWorkHubLocale;
  }
  const normalized = value.trim().toLowerCase().replace(/_/gu, "-");
  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en-US";
  }
  if (normalized === "zh" || normalized === "zh-cn" || normalized.startsWith("zh-hans")) {
    return "zh-CN";
  }
  return defaultWorkHubLocale;
}

export const workHubLocaleInputSchema = z.preprocess((value) => normalizeWorkHubLocale(value), workHubLocaleSchema);
