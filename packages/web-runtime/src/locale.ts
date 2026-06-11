import {
  normalizeWorkHubLocale,
  workHubLocaleStorageKey,
  type WorkHubLocale
} from "@workhub/ui/gold-path";

export type IdentityLocaleCarrier = {
  locale?: unknown;
  preferences?: {
    locale?: unknown;
  };
} | null | undefined;

export function isWorkHubLocale(value: unknown): value is WorkHubLocale {
  return value === "zh-CN" || value === "en-US";
}

export function identityLocale(identity: IdentityLocaleCarrier): WorkHubLocale | undefined {
  const locale = identity?.preferences?.locale ?? identity?.locale;
  return isWorkHubLocale(locale) ? locale : undefined;
}

export function setDocumentLocale(locale: WorkHubLocale, documentElement = globalThis.document?.documentElement) {
  if (documentElement) {
    documentElement.lang = locale;
  }
}

export function persistBrowserLocale(
  locale: WorkHubLocale,
  input: {
    storage?: Storage | undefined;
    documentElement?: HTMLElement | undefined;
  } = {}
) {
  const storage = input.storage ?? globalThis.localStorage;
  storage.setItem(workHubLocaleStorageKey, locale);
  setDocumentLocale(locale, input.documentElement);
}

export function browserLocale(
  input: {
    storage?: Storage | undefined;
    navigatorLanguage?: string | undefined;
  } = {}
): WorkHubLocale {
  const storage = input.storage ?? globalThis.localStorage;
  const navigatorLanguage = input.navigatorLanguage ?? globalThis.navigator?.language;
  return normalizeWorkHubLocale(storage.getItem(workHubLocaleStorageKey) ?? navigatorLanguage);
}

export function applyIdentityLocale(identity: IdentityLocaleCarrier, fallback: WorkHubLocale): WorkHubLocale {
  const locale = identityLocale(identity) ?? fallback;
  persistBrowserLocale(locale);
  return locale;
}
