import type {
  AttentionAction,
  AttentionHomeVM,
  CostDashboardVM,
  ProposalConflict,
  ProposalDetailVM,
  SettingsPageVM
} from "@workhub/contracts";

import { normalizeWorkHubLocale, type WorkHubLocale } from "./i18n.js";
import type { ReplayRenderedPage } from "../replay/index.js";
import type { WebRouteComponentKey } from "./route-components.js";

export type WebReactRouteComponentKey = Extract<WebRouteComponentKey, "home" | "proposal" | "replay" | "cost" | "settings">;

export type WebReactRouteComponentName =
  | "HomeRouteComponent"
  | "ProposalRouteComponent"
  | "ReplayRouteComponent"
  | "CostRouteComponent"
  | "SettingsRouteComponent";

export type WebReactRouteComponentMode = "html-fallback";

export type WebReactRouteComponentPropsSource = "typed-page-vm";

type WebReactRouteComponentAdapterBase<
  RouteKey extends WebReactRouteComponentKey,
  ComponentName extends WebReactRouteComponentName,
  PageVm extends "attention" | "proposal" | "replay" | "cost" | "settings",
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

export type ProposalReactRouteComponentAdapter = WebReactRouteComponentAdapterBase<"proposal", "ProposalRouteComponent", "proposal", ProposalRouteComponentProps>;

export type ReplayReactRouteComponentAdapter = WebReactRouteComponentAdapterBase<"replay", "ReplayRouteComponent", "replay", ReplayRouteComponentProps>;

export type CostReactRouteComponentAdapter = WebReactRouteComponentAdapterBase<"cost", "CostRouteComponent", "cost", CostRouteComponentProps>;

export type SettingsReactRouteComponentAdapter = WebReactRouteComponentAdapterBase<"settings", "SettingsRouteComponent", "settings", SettingsRouteComponentProps>;

export type WebReactRouteComponentAdapter =
  | HomeReactRouteComponentAdapter
  | ProposalReactRouteComponentAdapter
  | ReplayReactRouteComponentAdapter
  | CostReactRouteComponentAdapter
  | SettingsReactRouteComponentAdapter;

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

export type ProposalRouteComponentProps = {
  routeKey: "proposal";
  locale: WorkHubLocale;
  pageVm: "proposal";
  proposalId: string;
  workItemId: string;
  title: string;
  status: ProposalDetailVM["status"];
  changeCount: number;
  checkCount: number;
  evidenceRefCount: number;
  commentCount: number;
  conflictCount: number;
  reviewActionCount: number;
  reviewActionHrefs: string[];
  mergeActionAvailable: boolean;
  rollbackAvailable: boolean;
  advancedFallbackPreserved: true;
  advancedFallbackSource: "proposal-advanced-editors-html-fallback";
  advancedFallbackActionCount: number;
  lineEditorFallback: boolean;
  fieldEditorFallback: boolean;
  subrecordEditorFallback: boolean;
};

export type ReplayRouteComponentProps = {
  routeKey: "replay";
  locale: WorkHubLocale;
  pageVm: "replay";
  runId: string;
  workItemId: string;
  title: string;
  stepCount: number;
  acceptedDeliverableCount: number;
  mergeAttemptCount: number;
  structuredAuditCount: number;
  primaryActionHrefs: string[];
};

function proposalReviewActions(vm: ProposalDetailVM) {
  if (vm.status === "opened") {
    return [vm.review_actions.approve, vm.review_actions.request_changes];
  }
  if (vm.status === "reviewed" && vm.review_actions.merge) {
    return [vm.review_actions.merge];
  }
  return [];
}

function proposalConflictActionHrefs(conflicts: ProposalConflict[]) {
  return conflicts.flatMap((conflict) =>
    conflict.options.map((option) => option.action?.href).filter((href): href is string => Boolean(href))
  );
}

export type CostRouteComponentProps = {
  routeKey: "cost";
  locale: WorkHubLocale;
  pageVm: "cost";
  tokenIn: number;
  tokenOut: number;
  totalTokens: number;
  totalCostCny: string;
  budgetCount: number;
  riskCount: number;
  modelCount: number;
  trendCount: number;
  noticeCount: number;
  primaryActionHrefs: string[];
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
    // 与 SSR home 一致：primary 可能 = queue[0]（live），按 id 去重避免重复计数。
    queueCount: vm.primary ? vm.queue.filter((item) => item.id !== vm.primary?.id).length : vm.queue.length,
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

export function createProposalReactRouteComponent(
  vm: ProposalDetailVM,
  conflicts: ProposalConflict[],
  locale: WorkHubLocale,
  advancedFallback?: {
    actionHrefs?: string[] | undefined;
    lineEditor?: boolean | undefined;
    fieldEditor?: boolean | undefined;
    subrecordEditor?: boolean | undefined;
  }
): ProposalReactRouteComponentAdapter {
  const normalizedLocale = normalizeWorkHubLocale(locale);
  const reviewActions = proposalReviewActions(vm);
  const reviewActionHrefs = reviewActions.map((action) => action.href);
  const advancedFallbackActionHrefs = advancedFallback?.actionHrefs ?? proposalConflictActionHrefs(conflicts);
  const props: ProposalRouteComponentProps = {
    routeKey: "proposal",
    locale: normalizedLocale,
    pageVm: "proposal",
    proposalId: vm.proposal_id,
    workItemId: vm.work_item_id,
    title: vm.title,
    status: vm.status,
    changeCount: vm.manifest.changes.length,
    checkCount: vm.manifest.checks.length,
    evidenceRefCount: vm.evidence_refs.length,
    commentCount: vm.comments.length,
    conflictCount: conflicts.length,
    reviewActionCount: reviewActionHrefs.length,
    reviewActionHrefs,
    mergeActionAvailable: Boolean(vm.status === "reviewed" && vm.review_actions.merge),
    rollbackAvailable: vm.manifest.rollback.available,
    advancedFallbackPreserved: true,
    advancedFallbackSource: "proposal-advanced-editors-html-fallback",
    advancedFallbackActionCount: advancedFallbackActionHrefs.length,
    lineEditorFallback: advancedFallback?.lineEditor ?? conflicts.length > 0,
    fieldEditorFallback: advancedFallback?.fieldEditor ?? false,
    subrecordEditorFallback: advancedFallback?.subrecordEditor ?? false
  };
  return {
    routeKey: "proposal",
    componentName: "ProposalRouteComponent",
    mode: "html-fallback",
    propsSource: "typed-page-vm",
    htmlFallback: true,
    adapter: "react-compatible-route-component-v1",
    locale: normalizedLocale,
    pageVm: "proposal",
    primaryHrefs: [...reviewActionHrefs, ...advancedFallbackActionHrefs],
    propsFingerprint: compactHash([
      props.routeKey,
      props.locale,
      props.pageVm,
      props.proposalId,
      props.workItemId,
      props.status,
      props.changeCount,
      props.checkCount,
      props.evidenceRefCount,
      props.commentCount,
      props.conflictCount,
      props.reviewActionCount,
      props.advancedFallbackActionCount,
      props.lineEditorFallback,
      props.fieldEditorFallback,
      props.subrecordEditorFallback
    ]),
    props
  };
}

export function createReplayReactRouteComponent(rendered: ReplayRenderedPage, locale: WorkHubLocale): ReplayReactRouteComponentAdapter {
  const normalizedLocale = normalizeWorkHubLocale(locale);
  const props: ReplayRouteComponentProps = {
    routeKey: "replay",
    locale: normalizedLocale,
    pageVm: "replay",
    runId: rendered.runId,
    workItemId: rendered.workItemId ?? "",
    title: rendered.title,
    stepCount: rendered.stepCount,
    acceptedDeliverableCount: rendered.acceptedDeliverableCount,
    mergeAttemptCount: rendered.mergeAttemptCount,
    structuredAuditCount: rendered.structuredAuditCount,
    primaryActionHrefs: rendered.primaryHrefs
  };
  return {
    routeKey: "replay",
    componentName: "ReplayRouteComponent",
    mode: "html-fallback",
    propsSource: "typed-page-vm",
    htmlFallback: true,
    adapter: "react-compatible-route-component-v1",
    locale: normalizedLocale,
    pageVm: "replay",
    primaryHrefs: props.primaryActionHrefs,
    propsFingerprint: compactHash([
      props.routeKey,
      props.locale,
      props.pageVm,
      props.runId,
      props.workItemId,
      props.stepCount,
      props.acceptedDeliverableCount,
      props.mergeAttemptCount,
      props.structuredAuditCount,
      props.primaryActionHrefs.length
    ]),
    props
  };
}

export function createCostReactRouteComponent(vm: CostDashboardVM, locale: WorkHubLocale): CostReactRouteComponentAdapter {
  const normalizedLocale = normalizeWorkHubLocale(locale);
  const primaryActionHrefs = vm.notices.map((notice) => notice.action_href).filter((href): href is string => Boolean(href));
  const props: CostRouteComponentProps = {
    routeKey: "cost",
    locale: normalizedLocale,
    pageVm: "cost",
    tokenIn: vm.token_in,
    tokenOut: vm.token_out,
    totalTokens: vm.token_in + vm.token_out,
    totalCostCny: vm.total_cost_cny,
    budgetCount: vm.budget.length,
    riskCount: vm.top_exhaustion_risks.length,
    modelCount: vm.model_breakdown.length,
    trendCount: vm.trend.length,
    noticeCount: vm.notices.length,
    primaryActionHrefs
  };
  return {
    routeKey: "cost",
    componentName: "CostRouteComponent",
    mode: "html-fallback",
    propsSource: "typed-page-vm",
    htmlFallback: true,
    adapter: "react-compatible-route-component-v1",
    locale: normalizedLocale,
    pageVm: "cost",
    primaryHrefs: props.primaryActionHrefs,
    propsFingerprint: compactHash([
      props.routeKey,
      props.locale,
      props.pageVm,
      props.tokenIn,
      props.tokenOut,
      props.totalTokens,
      props.totalCostCny,
      props.budgetCount,
      props.riskCount,
      props.modelCount,
      props.trendCount,
      props.noticeCount,
      props.primaryActionHrefs.length
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
