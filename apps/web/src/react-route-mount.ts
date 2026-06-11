import { createElement, useState, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import {
  createHomeReactRouteComponent,
  type HomeRouteComponentProps,
  type WorkHubLocale
} from "@workhub/ui/gold-path";
import { uiCount, uiT } from "@workhub/ui";
import type { ProposalConflict, ProposalConflictOption } from "@workhub/contracts";

import type { WebRouteReadyResult } from "./routes.js";

export type ReactRouteMountReason = "initial" | "sse-props";

export type ReactRouteMountResult = {
  mounted: boolean;
  routeKey?: "home" | "proposal" | undefined;
  componentName?: "HomeRouteComponent" | "ProposalMutationEditor" | "ProposalLineEditor" | undefined;
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
let activeProposalLineMount: ActiveReactMount | undefined;
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
  setRuntimeMetric("r4ReactVisibleLineEditor", false);
  setRuntimeMetric("r4ReactLineEditorKind", "");
  setRuntimeMetric("r4ReactLineEditorSelectedDecision", "");
  setRuntimeMetric("r4ReactLineEditorSearchValue", "");
  setRuntimeMetric("r4ReactLineEditorHtmlFallbackPreserved", false);
  setRuntimeMetric("r4ReactLineEditorHtmlFallbackHidden", false);
}

export function unmountReactRouteIsland() {
  if (!activeMount && !activeProposalLineMount) {
    resetRuntimeMetrics();
    return;
  }
  activeMount?.root.unmount();
  activeProposalLineMount?.root.unmount();
  activeMount = undefined;
  activeProposalLineMount = undefined;
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

type LineEditorDecision = "keep_current" | "accept_incoming" | "ai_fusion";

type LineEditorRange = {
  index: number;
  startLine: number;
  endLine: number;
};

type LineEditorRow = {
  index: number;
  kind: "add" | "remove" | "context";
  marker: string;
  text: string;
};

type ProposalLineEditorFile = {
  conflictId: string;
  targetKey: string;
  targetLabel: string;
  panelId: string;
  href: string;
  method: string;
  actionId: string;
  ranges: LineEditorRange[];
  rows: LineEditorRow[];
  defaultDecision: LineEditorDecision;
  decisions: LineEditorDecision[];
};

type ProposalLineEditorProps = {
  locale: WorkHubLocale;
  files: ProposalLineEditorFile[];
};

function numberField(record: Record<string, unknown> | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function textDiff3(option: ProposalConflictOption) {
  return objectRecord(option.quality_gate?.["text_diff3"]);
}

function lineEditorConflictRanges(value: unknown): LineEditorRange[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    const record = objectRecord(item);
    const startLine = numberField(record, "start_line");
    const endLine = numberField(record, "end_line");
    return startLine > 0 && endLine >= startLine ? [{ index, startLine, endLine }] : [];
  });
}

function lineEditorRows(preview: unknown): LineEditorRow[] {
  const patch = objectRecord(preview);
  if (patch?.["type"] !== "unified_text_patch_preview" || !Array.isArray(patch["hunks"])) {
    return [];
  }
  let index = 0;
  return patch["hunks"].flatMap((hunk) => {
    const record = objectRecord(hunk);
    const lines = Array.isArray(record?.["lines"]) ? record["lines"] : [];
    return lines.flatMap((line) => {
      if (typeof line !== "string") {
        return [];
      }
      index += 1;
      const marker = line.startsWith("+") ? "+" : line.startsWith("-") ? "-" : " ";
      return [{
        index,
        kind: marker === "+" ? "add" : marker === "-" ? "remove" : "context",
        marker,
        text: line.replace(/^[-+ ]/u, "")
      }];
    });
  });
}

function lineEditorOption(conflict: ProposalConflict) {
  return conflict.options.find((option) => {
    const diff3 = textDiff3(option);
    return diff3?.["type"] === "line_text_diff3"
      && lineEditorConflictRanges(diff3["conflict_ranges"]).length > 0
      && Boolean(option.action?.href);
  });
}

function lineEditorDefaultDecision(conflict: ProposalConflict): LineEditorDecision {
  return conflict.recommended_option_id === "keep_current" ||
    conflict.recommended_option_id === "accept_incoming" ||
    conflict.recommended_option_id === "ai_fusion"
    ? conflict.recommended_option_id
    : "ai_fusion";
}

function lineEditorDecisionOptions(conflict: ProposalConflict): LineEditorDecision[] {
  return conflict.options.flatMap((option) =>
    option.id === "keep_current" || option.id === "accept_incoming" || option.id === "ai_fusion"
      ? [option.id]
      : []
  );
}

function proposalLineEditorProps(conflicts: ProposalConflict[], locale: WorkHubLocale): ProposalLineEditorProps | undefined {
  const files = conflicts.flatMap((conflict): ProposalLineEditorFile[] => {
    const option = lineEditorOption(conflict);
    const diff3 = option ? textDiff3(option) : undefined;
    const ranges = lineEditorConflictRanges(diff3?.["conflict_ranges"]);
    if (!option?.action?.href || ranges.length === 0) {
      return [];
    }
    return [{
      conflictId: conflict.id,
      targetKey: conflict.target_key,
      targetLabel: conflict.target_path ?? conflict.target_key,
      panelId: `react-line-editor-${safeId(conflict.id)}`,
      href: option.action.href,
      method: option.action.method ?? "POST",
      actionId: option.action.id ?? "apply_ai_fusion",
      ranges,
      rows: lineEditorRows(option.quality_gate?.["text_patch_preview"]),
      defaultDecision: lineEditorDefaultDecision(conflict),
      decisions: lineEditorDecisionOptions(conflict)
    }];
  });
  return files.length > 0 ? { locale, files } : undefined;
}

function lineEditorDecisionLabel(locale: WorkHubLocale, decision: LineEditorDecision) {
  if (decision === "keep_current") {
    return uiT(locale, "proposal.overlapReviewKeepCurrent");
  }
  if (decision === "accept_incoming") {
    return uiT(locale, "proposal.overlapReviewAcceptIncoming");
  }
  return uiT(locale, "proposal.overlapReviewAiFusion");
}

function lineEditorRangeLabel(locale: WorkHubLocale, startLine: number, endLine: number) {
  if (startLine === endLine) {
    return locale === "zh-CN" ? `第 ${startLine} 行` : `Line ${startLine}`;
  }
  return locale === "zh-CN" ? `第 ${startLine}-${endLine} 行` : `Lines ${startLine}-${endLine}`;
}

function initialLineEditorDecisions(files: ProposalLineEditorFile[]) {
  return Object.fromEntries(files.map((file) => [
    file.panelId,
    Object.fromEntries(file.ranges.map((range) => [String(range.index), file.defaultDecision]))
  ]));
}

function lineEditorApplyPayload(file: ProposalLineEditorFile, decisions: Record<string, string | undefined>) {
  return JSON.stringify({
    confirm: true,
    text_hunk_overrides: {
      hunks: file.ranges.map((range) => ({
        hunk_index: range.index,
        start_line: range.startLine,
        end_line: range.endLine,
        decision: decisions[String(range.index)] ?? file.defaultDecision
      }))
    }
  });
}

function ProposalLineEditor(input: ProposalLineEditorProps) {
  const firstPanelId = input.files[0]?.panelId ?? "";
  const [activePanelId, setActivePanelId] = useState(firstPanelId);
  const [searchByPanel, setSearchByPanel] = useState<Record<string, string>>({});
  const [decisionsByPanel, setDecisionsByPanel] = useState<Record<string, Record<string, string | undefined>>>(() =>
    initialLineEditorDecisions(input.files)
  );
  const activeFile = input.files.find((file) => file.panelId === activePanelId) ?? input.files[0];
  const activeSearch = activeFile ? searchByPanel[activeFile.panelId] ?? "" : "";
  const activeDecision = activeFile
    ? decisionsByPanel[activeFile.panelId]?.[String(activeFile.ranges[0]?.index ?? 0)] ?? activeFile.defaultDecision
    : "";
  const hunkCount = input.files.reduce((sum, file) => sum + file.ranges.length, 0);
  const rowCount = input.files.reduce((sum, file) => sum + file.rows.length, 0);

  return createElement(
    "section",
    {
      className: "wh-line-editor",
      "data-route-line-editor": "true",
      "data-route-line-editor-file-count": String(input.files.length),
      "data-route-line-editor-hunk-count": String(hunkCount),
      "data-route-line-editor-row-count": String(rowCount),
      "data-r4-proposal-react-line-editor": "text-hunk",
      "data-r4-proposal-react-line-editor-controlled-state": "true",
      "data-r4-proposal-react-line-editor-selected-decision": activeDecision,
      "data-r4-proposal-react-line-editor-search-value": activeSearch
    },
    createElement(
      "div",
      { className: "wh-line-editor-head" },
      createElement("strong", null, uiT(input.locale, "proposal.lineEditorTitle")),
      createElement("span", { className: "wh-pill" }, uiCount(input.locale, input.files.length, "文件", "file"))
    ),
    createElement(
      "div",
      { className: "wh-line-editor-tabs", role: "tablist", "aria-label": uiT(input.locale, "proposal.lineEditorTitle") },
      input.files.map((file, index) => {
        const active = file.panelId === activePanelId || (!activePanelId && index === 0);
        return createElement(
          "button",
          {
            key: file.panelId,
            type: "button",
            className: "wh-line-editor-tab",
            role: "tab",
            id: `${file.panelId}-tab`,
            "aria-controls": file.panelId,
            "aria-selected": String(active),
            tabIndex: active ? 0 : -1,
            "data-line-editor-tab": file.targetKey,
            "data-line-editor-panel-id": file.panelId,
            onClick: () => setActivePanelId(file.panelId)
          },
          file.targetLabel
        );
      })
    ),
    input.files.map((file, index) => {
      const active = file.panelId === activePanelId || (!activePanelId && index === 0);
      const search = searchByPanel[file.panelId] ?? "";
      const lowerSearch = search.trim().toLowerCase();
      const decisions = decisionsByPanel[file.panelId] ?? {};
      const visibleRows = file.rows.filter((row) => lowerSearch.length === 0 || row.text.toLowerCase().includes(lowerSearch));
      return createElement(
        "section",
        {
          key: file.panelId,
          className: "wh-line-editor-panel",
          id: file.panelId,
          role: "tabpanel",
          "aria-labelledby": `${file.panelId}-tab`,
          "data-line-editor-panel": file.targetKey,
          "data-line-editor-match-count": String(visibleRows.length),
          hidden: !active
        },
        createElement(
          "div",
          { className: "wh-line-editor-toolbar" },
          createElement("input", {
            className: "wh-line-editor-search",
            type: "search",
            value: search,
            "data-line-editor-search": "true",
            "aria-label": uiT(input.locale, "proposal.lineEditorSearch"),
            placeholder: uiT(input.locale, "proposal.lineEditorSearch"),
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              const nextValue = event.currentTarget.value;
              setSearchByPanel((current) => ({ ...current, [file.panelId]: nextValue }));
            }
          }),
          createElement("span", { className: "wh-pill", "data-line-editor-match-count": String(visibleRows.length) }, uiCount(input.locale, visibleRows.length, "行", "line"))
        ),
        createElement(
          "div",
          { className: "wh-line-editor-body" },
          createElement(
            "div",
            { className: "wh-line-editor-lines", "data-line-editor-row-count": String(file.rows.length) },
            file.rows.map((row) => {
              const visible = lowerSearch.length === 0 || row.text.toLowerCase().includes(lowerSearch);
              return createElement(
                "div",
                {
                  key: row.index,
                  className: "wh-line-editor-row",
                  "data-line-editor-row": "true",
                  "data-line-editor-row-kind": row.kind,
                  "data-line-editor-row-text": row.text.toLowerCase(),
                  hidden: !visible
                },
                createElement("span", { className: "wh-line-editor-row-no" }, String(row.index)),
                createElement("span", { className: "wh-line-editor-row-kind" }, row.marker),
                createElement("span", { className: "wh-line-editor-row-text" }, row.text)
              );
            })
          ),
          createElement(
            "div",
            { className: "wh-line-editor-hunks" },
            file.ranges.map((range) => {
              const selectedDecision = decisions[String(range.index)] ?? file.defaultDecision;
              return createElement(
                "article",
                {
                  key: range.index,
                  className: "wh-line-editor-hunk",
                  tabIndex: 0,
                  "data-line-editor-hunk": "true",
                  "data-line-editor-hunk-index": String(range.index),
                  "data-line-editor-start-line": String(range.startLine),
                  "data-line-editor-end-line": String(range.endLine)
                },
                createElement(
                  "div",
                  { className: "wh-line-editor-hunk-head" },
                  createElement("strong", null, `${uiT(input.locale, "proposal.overlapReviewHunk")} ${range.index + 1}`),
                  createElement("span", { className: "wh-pill" }, lineEditorRangeLabel(input.locale, range.startLine, range.endLine))
                ),
                createElement(
                  "div",
                  { className: "wh-line-editor-decisions" },
                  file.decisions.map((decision) => {
                    const selected = selectedDecision === decision;
                    return createElement(
                      "button",
                      {
                        key: decision,
                        type: "button",
                        className: "wh-line-editor-decision",
                        "aria-pressed": String(selected),
                        "data-line-editor-decision": decision,
                        "data-line-editor-decision-selected": String(selected),
                        "data-line-editor-hunk-index": String(range.index),
                        onClick: () => setDecisionsByPanel((current) => ({
                          ...current,
                          [file.panelId]: {
                            ...(current[file.panelId] ?? {}),
                            [String(range.index)]: decision
                          }
                        }))
                      },
                      lineEditorDecisionLabel(input.locale, decision)
                    );
                  })
                )
              );
            })
          )
        ),
        createElement(
          "div",
          { className: "wh-line-editor-actions" },
          createElement(
            "a",
            {
              className: "wh-btn wh-btn-primary",
              href: file.href,
              "data-line-editor-apply": "true",
              "data-action-id": file.actionId,
              "data-action-href": file.href,
              "data-method": file.method,
              "data-request-json": lineEditorApplyPayload(file, decisions)
            },
            uiT(input.locale, "proposal.lineEditorApply")
          )
        )
      );
    })
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

function proposalLineMountHost() {
  return document.querySelector<HTMLElement>("[data-r4-proposal-react-line-editor-host=\"text-hunk\"]");
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

function hideProposalLineEditorFallback(host: HTMLElement) {
  const advanced = host.closest<HTMLElement>("[data-r4-proposal-advanced-review]");
  const fallback = Array.from(advanced?.querySelectorAll<HTMLElement>(".wh-line-editor[data-route-line-editor=\"true\"]") ?? [])
    .find((candidate) => !host.contains(candidate) && !candidate.hasAttribute("data-r4-proposal-react-line-editor"));
  if (!fallback) {
    host.dataset.r4ProposalReactLineEditorFallbackHidden = "false";
    return false;
  }
  fallback.hidden = true;
  fallback.dataset.r4ProposalLineEditorHtmlFallbackPreserved = "true";
  fallback.dataset.r4ProposalLineEditorHtmlFallbackHiddenByReact = "true";
  host.dataset.r4ProposalReactLineEditorFallbackHidden = "true";
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

function syncProposalLineRuntimeMetrics(
  host: HTMLElement,
  input: {
    selectedDecision: string;
    searchValue: string;
    reason: ReactRouteMountReason;
    mountCount: number;
    propsUpdateCount: number;
    fallbackHidden: boolean;
  }
) {
  const attrs = {
    r4ReactVisibleLineEditor: "true",
    r4ReactLineEditorKind: "text-hunk",
    r4ReactLineEditorSelectedDecision: input.selectedDecision,
    r4ReactLineEditorSearchValue: input.searchValue,
    r4ReactLineEditorHtmlFallbackPreserved: "true",
    r4ReactLineEditorHtmlFallbackHidden: String(input.fallbackHidden),
    r4ReactLineEditorLastUpdateReason: input.reason,
    r4ReactLineEditorMountCount: String(input.mountCount),
    r4ReactLineEditorPropsUpdateCount: String(input.propsUpdateCount)
  };
  host.dataset.r4ProposalReactLineEditorMounted = "true";
  host.dataset.r4ReactRuntime = reactRuntimeName;
  for (const [key, value] of Object.entries(attrs)) {
    host.dataset[key] = value;
    setRuntimeMetric(key, value);
  }
}

function unmountProposalLineEditorRoot() {
  activeProposalLineMount?.root.unmount();
  activeProposalLineMount = undefined;
  setRuntimeMetric("r4ReactVisibleLineEditor", false);
  setRuntimeMetric("r4ReactLineEditorKind", "");
  setRuntimeMetric("r4ReactLineEditorSelectedDecision", "");
  setRuntimeMetric("r4ReactLineEditorSearchValue", "");
  setRuntimeMetric("r4ReactLineEditorHtmlFallbackPreserved", false);
  setRuntimeMetric("r4ReactLineEditorHtmlFallbackHidden", false);
}

function mountProposalLineEditorRoot(
  props: ProposalLineEditorProps | undefined,
  host: HTMLElement | null,
  reason: ReactRouteMountReason
) {
  if (!props || !host) {
    unmountProposalLineEditorRoot();
    return false;
  }
  if (!activeProposalLineMount || activeProposalLineMount.host !== host) {
    activeProposalLineMount?.root.unmount();
    totalMountCount += 1;
    activeProposalLineMount = {
      host,
      root: createRoot(host),
      routeKey: "proposal",
      mountCount: totalMountCount,
      propsUpdateCount: 0
    };
  } else if (reason === "sse-props") {
    activeProposalLineMount.propsUpdateCount += 1;
  }
  const fallbackHidden = hideProposalLineEditorFallback(host);
  const firstFile = props.files[0];
  syncProposalLineRuntimeMetrics(host, {
    selectedDecision: firstFile?.defaultDecision ?? "",
    searchValue: "",
    reason,
    mountCount: activeProposalLineMount.mountCount,
    propsUpdateCount: activeProposalLineMount.propsUpdateCount,
    fallbackHidden
  });
  const currentMount = activeProposalLineMount;
  flushSync(() => {
    currentMount.root.render(createElement(ProposalLineEditor, props));
  });
  return true;
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
  const lineProps = proposalLineEditorProps(result.surface.proposal_conflicts, locale);
  const host = proposalMountHost();
  const lineHost = proposalLineMountHost();
  if (!props && !lineProps) {
    unmountReactRouteIsland();
    return {
      mounted: false,
      routeKey: "proposal",
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  let fieldMounted = false;
  if (props && host) {
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
    fieldMounted = true;
  } else {
    activeMount?.root.unmount();
    activeMount = undefined;
  }
  const lineMounted = mountProposalLineEditorRoot(lineProps, lineHost, reason);
  if (!fieldMounted && !lineMounted) {
    resetRuntimeMetrics();
  }
  return {
    mounted: fieldMounted || lineMounted,
    routeKey: "proposal",
    componentName: fieldMounted ? "ProposalMutationEditor" : "ProposalLineEditor",
    mountCount: activeMount?.mountCount ?? activeProposalLineMount?.mountCount ?? totalMountCount,
    propsUpdateCount: activeMount?.propsUpdateCount ?? activeProposalLineMount?.propsUpdateCount ?? 0,
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
  return activeMount?.routeKey === routeKey || (routeKey === "proposal" && activeProposalLineMount?.routeKey === "proposal");
}
