import type { AttentionAction, AttentionHomeVM, SettingsPageVM } from "@workhub/contracts";

import { normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { WebRouteComponentKey } from "./route-components.js";

export type WebReactRouteComponentKey = Extract<WebRouteComponentKey, "home" | "settings">;

export type WebReactRouteComponentName = "HomeRouteComponent" | "SettingsRouteComponent";

export type WebReactRouteComponentMode = "html-fallback";

export type WebReactRouteComponentPropsSource = "typed-page-vm";

type WebReactRouteComponentAdapterBase<
  RouteKey extends WebReactRouteComponentKey,
  ComponentName extends WebReactRouteComponentName,
  PageVm extends "attention" | "settings",
  Props
> = {
  routeKey: RouteKey;
  componentName: ComponentName;
  mode: WebReactRouteComponentMode;
  propsSource: WebReactRouteComponentPropsSource;
  htmlFallback: true;
  adapter: "react-compatible-route-component-v1";
  locale: WorkHubLocale;
  pageVm: PageVm;
  primaryHrefs: string[];
  propsFingerprint: string;
  props: Props;
};

export type HomeReactRouteComponentAdapter = WebReactRouteComponentAdapterBase<"home", "HomeRouteComponent", "attention", HomeRouteComponentProps>;

export type SettingsReactRouteComponentAdapter = WebReactRouteComponentAdapterBase<"settings", "SettingsRouteComponent", "settings", SettingsRouteComponentProps>;

export type WebReactRouteComponentAdapter = HomeReactRouteComponentAdapter | SettingsReactRouteComponentAdapter;

export type HomeRouteComponentProps = {
  routeKey: "home";
  locale: WorkHubLocale;
  pageVm: "attention";
  hasPrimary: boolean;
  primaryTitle: string;
  primarySummary: string;
  primaryReason: string;
  primaryActions: AttentionAction[];
  queueCount: number;
  backgroundRunCount: number;
  evidenceRefCount: number;
};

export type SettingsRouteComponentProps = {
  routeKey: "settings";
  locale: WorkHubLocale;
  pageVm: "settings";
  generatedAt: string;
  appEnv: string;
  runtimeStatus: SettingsPageVM["runtime"]["runtime_status"];
  workerCount: number;
  brokerBackend: string;
  brokerConfigured: boolean;
  databaseConfigured: boolean;
  agentRunLeaseMs: number;
  agentRunRecoveryIntervalMs: number;
  defaultProvider: string;
  defaultModel: string;
  providerCount: number;
  apiKeyConfigured: boolean;
  baseUrlConfigured: boolean;
  secretSafe: boolean;
  activeLocale: WorkHubLocale;
  preferenceLocale: WorkHubLocale;
  preferenceSource: SettingsPageVM["language"]["preference_source"];
  preferenceSynced: boolean;
  supportedLocales: WorkHubLocale[];
  storageKey: string;
  updateHref: string;
  desktopClient: SettingsPageVM["device"]["desktop_client"];
  localExecutionBoundary: boolean;
  independentPetWindow: boolean;
  petModelSettingsInWeb: boolean;
  restoreHref: string;
  restoreRequiresDesktop: boolean;
  webLocalActionsEnabled: boolean;
};

function compactHash(parts: (string | number | boolean | undefined)[]) {
  return parts
    .map((part) => String(part ?? ""))
    .join("|");
}

export function createHomeReactRouteComponent(vm: AttentionHomeVM, locale: WorkHubLocale): HomeReactRouteComponentAdapter {
  const normalizedLocale = normalizeWorkHubLocale(locale);
  const primaryActions = vm.primary?.actions ?? [];
  const props: HomeRouteComponentProps = {
    routeKey: "home",
    locale: normalizedLocale,
    pageVm: "attention",
    hasPrimary: Boolean(vm.primary),
    primaryTitle: vm.primary?.title ?? "",
    primarySummary: vm.primary?.summary_text ?? "",
    primaryReason: vm.primary?.reason_text ?? vm.primary?.summary_text ?? "",
    primaryActions,
    queueCount: vm.queue.length,
    backgroundRunCount: vm.background_runs.length,
    evidenceRefCount: vm.primary?.evidence_refs?.length ?? 0
  };
  const primaryHrefs = primaryActions.map((action) => action.href);
  return {
    routeKey: "home",
    componentName: "HomeRouteComponent",
    mode: "html-fallback",
    propsSource: "typed-page-vm",
    htmlFallback: true,
    adapter: "react-compatible-route-component-v1",
    locale: normalizedLocale,
    pageVm: "attention",
    primaryHrefs,
    propsFingerprint: compactHash([
      props.routeKey,
      props.locale,
      props.pageVm,
      props.hasPrimary,
      props.queueCount,
      props.backgroundRunCount,
      props.evidenceRefCount,
      primaryHrefs.length
    ]),
    props
  };
}

export function createSettingsReactRouteComponent(vm: SettingsPageVM, locale: WorkHubLocale): SettingsReactRouteComponentAdapter {
  const normalizedLocale = normalizeWorkHubLocale(locale);
  const props: SettingsRouteComponentProps = {
    routeKey: "settings",
    locale: normalizedLocale,
    pageVm: "settings",
    generatedAt: vm.generated_at,
    appEnv: vm.runtime.app_env,
    runtimeStatus: vm.runtime.runtime_status,
    workerCount: vm.runtime.worker_count,
    brokerBackend: vm.runtime.broker_backend,
    brokerConfigured: vm.runtime.broker_configured,
    databaseConfigured: vm.runtime.database_configured,
    agentRunLeaseMs: vm.runtime.agent_run_lease_ms,
    agentRunRecoveryIntervalMs: vm.runtime.agent_run_recovery_interval_ms,
    defaultProvider: vm.llm_runtime.default_provider,
    defaultModel: vm.llm_runtime.default_model,
    providerCount: vm.llm_runtime.provider_count,
    apiKeyConfigured: vm.llm_runtime.api_key_configured,
    baseUrlConfigured: vm.llm_runtime.base_url_configured,
    secretSafe: vm.llm_runtime.secret_safe,
    activeLocale: normalizeWorkHubLocale(vm.language.active_locale),
    preferenceLocale: normalizeWorkHubLocale(vm.language.preference_locale),
    preferenceSource: vm.language.preference_source,
    preferenceSynced: vm.language.preference_synced,
    supportedLocales: vm.language.supported_locales.map((item) => normalizeWorkHubLocale(item)),
    storageKey: vm.language.storage_key,
    updateHref: vm.language.update_href,
    desktopClient: vm.device.desktop_client,
    localExecutionBoundary: vm.device.local_execution_boundary,
    independentPetWindow: vm.device.independent_pet_window,
    petModelSettingsInWeb: vm.device.pet_model_settings_in_web,
    restoreHref: vm.device.restore_href,
    restoreRequiresDesktop: vm.device.restore_requires_desktop,
    webLocalActionsEnabled: vm.device.web_local_actions_enabled
  };
  return {
    routeKey: "settings",
    componentName: "SettingsRouteComponent",
    mode: "html-fallback",
    propsSource: "typed-page-vm",
    htmlFallback: true,
    adapter: "react-compatible-route-component-v1",
    locale: normalizedLocale,
    pageVm: "settings",
    primaryHrefs: [props.restoreHref],
    propsFingerprint: compactHash([
      props.routeKey,
      props.locale,
      props.pageVm,
      props.runtimeStatus,
      props.workerCount,
      props.secretSafe,
      props.activeLocale,
      props.preferenceLocale,
      props.petModelSettingsInWeb,
      props.restoreRequiresDesktop,
      props.webLocalActionsEnabled
    ]),
    props
  };
}

export function reactRouteComponentMarkerAttrs(component: WebReactRouteComponentAdapter): Record<string, string> {
  return {
    "data-r4-react-component": component.componentName,
    "data-r4-react-component-route": component.routeKey,
    "data-r4-react-component-mode": component.mode,
    "data-r4-react-component-props-source": component.propsSource,
    "data-r4-react-component-page-vm": component.pageVm,
    "data-r4-react-component-locale": component.locale,
    "data-r4-react-component-html-fallback": String(component.htmlFallback),
    "data-r4-react-component-adapter": component.adapter,
    "data-r4-react-component-action-count": String(component.primaryHrefs.length),
    "data-r4-react-component-props-fingerprint": component.propsFingerprint
  };
}
