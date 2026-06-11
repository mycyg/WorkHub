import { createElement, useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import {
  createHomeReactRouteComponent,
  type HomeRouteComponentProps,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { uiT } from "@workhub/ui";
import type { ProposalConflict, ProposalConflictOption } from "@workhub/contracts";

import type { WebRouteReadyResult } from "./routes.js";

export type ReactRouteMountReason = "initial" | "sse-props";

export type ReactRouteMountResult = {
  mounted: boolean;
  routeKey?: "home" | "proposal" | undefined;
  componentName?: "HomeRouteComponent" | "ProposalMutationEditor" | undefined;
  mountCount: number;
  propsUpdateCount: number;
  reason?: ReactRouteMountReason | undefined;
};

const reactRuntimeName = "react-18-createRoot";
const dispatcherProbeActionId = "r4_react_mount_probe";

type ActiveReactMount = {
  host: HTMLElement;
  root: Root;
  routeKey: "home" | "proposal";
  mountCount: number;
  propsUpdateCount: number;
};

let activeMount: ActiveReactMount | undefined;
let totalMountCount = 0;

function setRuntimeMetric(key: string, value: unknown) {
  document.documentElement.dataset[key] = String(value);
}

function resetRuntimeMetrics() {
  setRuntimeMetric("r4ReactRealMount", false);
  setRuntimeMetric("r4ReactMountedRoute", "");
  setRuntimeMetric("r4ReactMountedComponent", "");
  setRuntimeMetric("r4ReactVisibleMutationEditor", false);
  setRuntimeMetric("r4ReactMutationEditorKind", "");
  setRuntimeMetric("r4ReactControlledField", "");
  setRuntimeMetric("r4ReactHtmlFallbackPreserved", false);
  setRuntimeMetric("r4ReactHtmlFallbackHidden", false);
}

export function unmountReactRouteIsland() {
  if (!activeMount) {
    resetRuntimeMetrics();
    return;
  }
  activeMount.root.unmount();
  activeMount = undefined;
  resetRuntimeMetrics();
}

function ensureReactMountHost(boundary: HTMLElement) {
  let host = boundary.querySelector<HTMLElement>("[data-r4-react-mount-root]");
  if (host) {
    return host;
  }
  host = document.createElement("div");
  host.hidden = true;
  host.dataset.r4ReactMountRoot = "true";
  host.dataset.r4ReactRuntime = reactRuntimeName;
  boundary.append(host);
  return host;
}

function HomeReactMountProbe(input: {
  props: HomeRouteComponentProps;
  fingerprint: string;
  reason: ReactRouteMountReason;
  mountCount: number;
  propsUpdateCount: number;
}) {
  return createElement(
    "div",
    {
      "data-r4-react-mounted-component": "HomeRouteComponent",
      "data-r4-react-mounted-route": "home",
      "data-r4-react-runtime": reactRuntimeName,
      "data-r4-react-props-source": "typed-page-vm",
      "data-r4-react-props-fingerprint": input.fingerprint,
      "data-r4-react-last-update-reason": input.reason,
      "data-r4-react-mount-count": String(input.mountCount),
      "data-r4-react-props-update-count": String(input.propsUpdateCount),
      "data-r4-react-primary-action-count": String(input.props.primaryActions.length),
      "data-r4-react-queue-count": String(input.props.queueCount),
      "data-r4-react-background-run-count": String(input.props.backgroundRunCount)
    },
    createElement(
      "a",
      {
        href: "/api/r4/react-mount-probe",
        "data-action-id": dispatcherProbeActionId,
        "data-method": "POST",
        "data-r4-react-dispatcher-probe": "true"
      },
      dispatcherProbeActionId
    )
  );
}

type StructuredFieldOperation = {
  field: string;
  valueType: string;
  beforeValue: unknown;
  currentValue: unknown;
  value: unknown;
};

type ProposalMutationEditorProps = {
  locale: WorkHubLocale;
  conflictId: string;
  field: string;
  valueType: string;
  beforeSummary: string;
  currentSummary: string;
  afterSummary: string;
  href: string;
  method: string;
  actionId: string;
  acceptOnlyPayload: string;
  keepCurrentPayload: string;
  customTemplatePayload: string;
};

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function operationRecords(option: ProposalConflictOption): StructuredFieldOperation[] {
  const patch = objectRecord(option.quality_gate?.["structured_record_patch"]);
  const dryRun = objectRecord(patch?.["structured_field_patch_dry_run"]);
  const operationPatch = objectRecord(dryRun?.["patch"]);
  const operations = Array.isArray(operationPatch?.["operations"]) ? operationPatch["operations"] : [];
  return operations.flatMap((operation) => {
    const record = objectRecord(operation);
    const field = typeof record?.["field"] === "string" ? record["field"].trim() : "";
    if (!record || !field) {
      return [];
    }
    return [{
      field,
      valueType: typeof record["value_type"] === "string" ? record["value_type"] : "",
      beforeValue: record["before_value"],
      currentValue: record["current_value"],
      value: record["value"]
    }];
  });
}

function isScalarOperation(operation: StructuredFieldOperation) {
  if (operation.valueType === "json_array" || operation.valueType === "array") {
    return false;
  }
  return operation.value === null || !["object", "undefined"].includes(typeof operation.value);
}

function summarizeValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value).slice(0, 120);
}

function structuredFieldOverridePayload(input: {
  operations: StructuredFieldOperation[];
  field: string;
  mode: "accept_only" | "keep_current" | "custom";
  customValue?: unknown;
}) {
  const overrides = input.mode === "accept_only"
    ? input.operations.map((operation) => ({
      field: operation.field,
      decision: operation.field === input.field ? "accept_incoming" : "keep_current"
    }))
    : [{
      field: input.field,
      decision: input.mode === "keep_current" ? "keep_current" : "custom",
      ...(input.mode === "custom" ? { value: input.customValue } : {})
    }];
  return {
    confirm: true,
    structured_field_overrides: {
      operations: overrides
    }
  };
}

function proposalMutationEditorProps(conflicts: ProposalConflict[], locale: WorkHubLocale): ProposalMutationEditorProps | undefined {
  for (const conflict of conflicts) {
    for (const option of conflict.options) {
      if (option.id !== "ai_fusion" || !option.action?.href) {
        continue;
      }
      const operations = operationRecords(option);
      const operation = operations.find(isScalarOperation);
      if (!operation) {
        continue;
      }
      return {
        locale,
        conflictId: conflict.id,
        field: operation.field,
        valueType: operation.valueType,
        beforeSummary: summarizeValue(operation.beforeValue),
        currentSummary: summarizeValue(operation.currentValue),
        afterSummary: summarizeValue(operation.value),
        href: option.action.href,
        method: option.action.method ?? "POST",
        actionId: option.action.id ?? "apply_ai_fusion",
        acceptOnlyPayload: JSON.stringify(structuredFieldOverridePayload({ operations, field: operation.field, mode: "accept_only" })),
        keepCurrentPayload: JSON.stringify(structuredFieldOverridePayload({ operations, field: operation.field, mode: "keep_current" })),
        customTemplatePayload: JSON.stringify(structuredFieldOverridePayload({
          operations,
          field: operation.field,
          mode: "custom",
          customValue: "__WORKHUB_CUSTOM_FIELD_VALUE__"
        }))
      };
    }
  }
  return undefined;
}

function ProposalMutationEditor(input: ProposalMutationEditorProps) {
  const [customValue, setCustomValue] = useState("");
  const title = uiT(input.locale, "proposal.fieldEditorTitle");
  const body = uiT(input.locale, "proposal.fieldEditorBody");
  const fieldLabel = uiT(input.locale, "proposal.fieldEditorField");
  const placeholder = uiT(input.locale, "proposal.fieldEditorCustomPlaceholder");
  return createElement(
    "details",
    {
      className: "wh-field-editor",
      open: true,
      "data-r4-proposal-react-mutation-editor": "structured-field-scalar",
      "data-r4-proposal-react-controlled-state": "true",
      "data-r4-proposal-react-controlled-field": input.field,
      "data-r4-proposal-react-controlled-value": customValue,
      "data-conflict-id": input.conflictId,
      "data-proposal-structured-field-editor-row": input.field
    },
    createElement("summary", null, title),
    createElement("p", { className: "wh-field-editor-body" }, body),
    createElement(
      "div",
      { className: "wh-field-editor-list" },
      createElement(
        "div",
        {
          className: "wh-field-editor-row",
          "data-r4-proposal-react-field-row": input.field,
          "data-proposal-structured-field-editor-row": input.field
        },
        createElement("strong", null, `${fieldLabel}: ${input.field}`),
        createElement(
          "div",
          { className: "wh-field-editor-actions" },
          createElement(
            "a",
            {
              className: "wh-btn",
              href: input.href,
              "data-action-id": input.actionId,
              "data-field-editor-action": "accept_only",
              "data-structured-field": input.field,
              "data-method": input.method,
              "data-request-json": input.acceptOnlyPayload
            },
            uiT(input.locale, "proposal.fieldEditorAcceptOnly")
          ),
          createElement(
            "a",
            {
              className: "wh-btn",
              href: input.href,
              "data-action-id": input.actionId,
              "data-field-editor-action": "keep_current",
              "data-structured-field": input.field,
              "data-method": input.method,
              "data-request-json": input.keepCurrentPayload
            },
            uiT(input.locale, "proposal.fieldEditorKeep")
          )
        ),
        createElement(
          "div",
          { className: "wh-field-editor-custom" },
          createElement("textarea", {
            value: customValue,
            "data-structured-field-custom-input": input.field,
            "data-r4-react-controlled-input": "true",
            "aria-label": placeholder,
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => setCustomValue(event.currentTarget.value)
          }),
          createElement(
            "button",
            {
              type: "button",
              className: "wh-btn",
              "data-action-id": input.actionId,
              "data-field-editor-action": "custom",
              "data-structured-field": input.field,
              "data-method": input.method,
              "data-action-href": input.href,
              "data-href": input.href,
              "data-request-json-template": input.customTemplatePayload
            },
            uiT(input.locale, "proposal.fieldEditorCustom")
          )
        )
      )
    )
  );
}

function syncRuntimeMetrics(
  boundary: HTMLElement,
  host: HTMLElement,
  input: {
    fingerprint: string;
    reason: ReactRouteMountReason;
    mountCount: number;
    propsUpdateCount: number;
  }
) {
  const attrs = {
    r4ReactRealMount: "true",
    r4ReactRuntime: reactRuntimeName,
    r4ReactMountedRoute: "home",
    r4ReactMountedComponent: "HomeRouteComponent",
    r4ReactPropsSource: "typed-page-vm",
    r4ReactPropsFingerprint: input.fingerprint,
    r4ReactLastUpdateReason: input.reason,
    r4ReactMountCount: String(input.mountCount),
    r4ReactPropsUpdateCount: String(input.propsUpdateCount),
    r4ReactDispatcherProbeActionId: dispatcherProbeActionId
  };
  for (const [key, value] of Object.entries(attrs)) {
    boundary.dataset[key] = value;
    host.dataset[key] = value;
    setRuntimeMetric(key, value);
  }
}

function proposalMountHost() {
  return document.querySelector<HTMLElement>("[data-r4-proposal-react-mutation-editor-host=\"structured-field-scalar\"]");
}

function hideProposalStructuredFieldFallback(host: HTMLElement) {
  const advanced = host.closest<HTMLElement>("[data-r4-proposal-advanced-review]");
  const fallback = advanced?.querySelector<HTMLElement>("details[data-proposal-structured-field-editor=\"true\"]");
  if (!fallback) {
    host.dataset.r4ProposalReactMutationEditorFallbackHidden = "false";
    return false;
  }
  fallback.hidden = true;
  fallback.dataset.r4ProposalHtmlFallbackPreserved = "true";
  fallback.dataset.r4ProposalHtmlFallbackHiddenByReact = "true";
  host.dataset.r4ProposalReactMutationEditorFallbackHidden = "true";
  return true;
}

function syncProposalRuntimeMetrics(
  host: HTMLElement,
  input: {
    field: string;
    reason: ReactRouteMountReason;
    mountCount: number;
    propsUpdateCount: number;
    fallbackHidden: boolean;
  }
) {
  const attrs = {
    r4ReactRealMount: "true",
    r4ReactRuntime: reactRuntimeName,
    r4ReactMountedRoute: "proposal",
    r4ReactMountedComponent: "ProposalMutationEditor",
    r4ReactPropsSource: "typed-page-vm",
    r4ReactPropsFingerprint: `proposal|structured-field-scalar|${input.field}`,
    r4ReactLastUpdateReason: input.reason,
    r4ReactMountCount: String(input.mountCount),
    r4ReactPropsUpdateCount: String(input.propsUpdateCount),
    r4ReactVisibleMutationEditor: "true",
    r4ReactMutationEditorKind: "structured-field-scalar",
    r4ReactControlledField: input.field,
    r4ReactHtmlFallbackPreserved: "true",
    r4ReactHtmlFallbackHidden: String(input.fallbackHidden)
  };
  host.dataset.r4ProposalReactMutationEditorMounted = "true";
  host.dataset.r4ReactRuntime = reactRuntimeName;
  host.dataset.r4ReactControlledField = input.field;
  for (const [key, value] of Object.entries(attrs)) {
    host.dataset[key] = value;
    setRuntimeMetric(key, value);
  }
}

function mountProposalReactRouteIsland(
  result: WebRouteReadyResult,
  locale: WorkHubLocale,
  reason: ReactRouteMountReason
): ReactRouteMountResult {
  if (result.surface.key !== "proposal") {
    unmountReactRouteIsland();
    return {
      mounted: false,
      routeKey: "proposal",
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  const props = proposalMutationEditorProps(result.surface.proposal_conflicts, locale);
  const host = proposalMountHost();
  if (!props || !host) {
    unmountReactRouteIsland();
    return {
      mounted: false,
      routeKey: "proposal",
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  if (!activeMount || activeMount.host !== host || activeMount.routeKey !== "proposal") {
    activeMount?.root.unmount();
    totalMountCount += 1;
    activeMount = {
      host,
      root: createRoot(host),
      routeKey: "proposal",
      mountCount: totalMountCount,
      propsUpdateCount: 0
    };
  } else if (reason === "sse-props") {
    activeMount.propsUpdateCount += 1;
  }
  const fallbackHidden = hideProposalStructuredFieldFallback(host);
  syncProposalRuntimeMetrics(host, {
    field: props.field,
    reason,
    mountCount: activeMount.mountCount,
    propsUpdateCount: activeMount.propsUpdateCount,
    fallbackHidden
  });
  const currentMount = activeMount;
  flushSync(() => {
    currentMount.root.render(createElement(ProposalMutationEditor, props));
  });
  return {
    mounted: true,
    routeKey: "proposal",
    componentName: "ProposalMutationEditor",
    mountCount: activeMount.mountCount,
    propsUpdateCount: activeMount.propsUpdateCount,
    reason
  };
}

export function mountReactRouteIsland(
  result: WebRouteReadyResult,
  locale: WorkHubLocale,
  reason: ReactRouteMountReason
): ReactRouteMountResult {
  if (result.match.key === "proposal") {
    return mountProposalReactRouteIsland(result, locale, reason);
  }
  if (result.match.key !== "home") {
    unmountReactRouteIsland();
    return {
      mounted: false,
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  const boundary = document.getElementById("wh-r4-hydration-home");
  if (!(boundary instanceof HTMLElement)) {
    resetRuntimeMetrics();
    return {
      mounted: false,
      routeKey: "home",
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  const host = ensureReactMountHost(boundary);
  if (!activeMount || activeMount.host !== host || activeMount.routeKey !== "home") {
    activeMount?.root.unmount();
    totalMountCount += 1;
    activeMount = {
      host,
      root: createRoot(host),
      routeKey: "home",
      mountCount: totalMountCount,
      propsUpdateCount: 0
    };
  } else if (reason === "sse-props") {
    activeMount.propsUpdateCount += 1;
  }

  if (result.surface.key !== "home") {
    resetRuntimeMetrics();
    return {
      mounted: false,
      routeKey: "home",
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }

  const adapter = createHomeReactRouteComponent(result.surface.attention, locale);
  syncRuntimeMetrics(boundary, host, {
    fingerprint: adapter.propsFingerprint,
    reason,
    mountCount: activeMount.mountCount,
    propsUpdateCount: activeMount.propsUpdateCount
  });
  const currentMount = activeMount;
  flushSync(() => {
    currentMount.root.render(
      createElement(HomeReactMountProbe, {
        props: adapter.props,
        fingerprint: adapter.propsFingerprint,
        reason,
        mountCount: currentMount.mountCount,
        propsUpdateCount: currentMount.propsUpdateCount
      })
    );
  });

  return {
    mounted: true,
    routeKey: "home",
    componentName: "HomeRouteComponent",
    mountCount: activeMount.mountCount,
    propsUpdateCount: activeMount.propsUpdateCount,
    reason
  };
}

export function hasMountedReactRoute(routeKey: "home" | "proposal") {
  return activeMount?.routeKey === routeKey;
}
