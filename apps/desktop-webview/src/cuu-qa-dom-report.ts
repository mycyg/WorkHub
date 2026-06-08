export type DesktopPetQaDomReportReason = "render" | "patch";

export type DesktopPetQaDomElementSnapshot = {
  selector: string;
  present: boolean;
  data: Record<string, string>;
  text?: string | undefined;
};

export type DesktopPetQaDomSnapshot = {
  contract: "workhub.cuu.tauri.actual-dom-report";
  version: 1;
  captured_at_iso: string;
  reason: DesktopPetQaDomReportReason;
  surface: DesktopPetQaDomElementSnapshot;
  live2d: DesktopPetQaDomElementSnapshot;
  bubble: DesktopPetQaDomElementSnapshot;
  primary_chip: DesktopPetQaDomElementSnapshot;
  primary_action: DesktopPetQaDomElementSnapshot;
};

type DesktopPetQaDomReportTarget = typeof globalThis & {
  __WORKHUB_CUU_QA_DOM_REPORT__?: boolean;
  __WORKHUB_CUU_QA_SCENARIO__?: string;
  __TAURI__?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> | unknown;
    core?: {
      invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> | unknown;
    };
  };
};

type DomElementLike = Element & {
  dataset?: DOMStringMap;
  getAttributeNames?: () => string[];
  getAttribute?: (name: string) => string | null;
};

export function collectDesktopPetQaDomSnapshot(
  root: ParentNode,
  reason: DesktopPetQaDomReportReason,
  now = new Date()
): DesktopPetQaDomSnapshot {
  return {
    contract: "workhub.cuu.tauri.actual-dom-report",
    version: 1,
    captured_at_iso: now.toISOString(),
    reason,
    surface: collectDesktopPetQaDomElement(root, "[data-wh-surface=pet]"),
    live2d: collectDesktopPetQaDomElement(root, ".wh-cuu-cat-live2d"),
    bubble: collectDesktopPetQaDomElement(root, "[data-pet-bubble]"),
    primary_chip: collectDesktopPetQaDomElement(root, "[data-chip-id],[data-pet-option-id]"),
    primary_action: collectDesktopPetQaDomElement(root, "[data-cuu-action-id]")
  };
}

export function writeDesktopPetQaDomSnapshot(
  root: ParentNode,
  reason: DesktopPetQaDomReportReason,
  target: DesktopPetQaDomReportTarget = globalThis as DesktopPetQaDomReportTarget
): void {
  if (!target.__WORKHUB_CUU_QA_DOM_REPORT__ && !target.__WORKHUB_CUU_QA_SCENARIO__) {
    return;
  }
  const invoke = target.__TAURI__?.core?.invoke ?? target.__TAURI__?.invoke;
  if (typeof invoke !== "function") {
    return;
  }
  const report = collectDesktopPetQaDomSnapshot(root, reason);
  void Promise.resolve(invoke("write_cuu_qa_dom_report", { reportJson: JSON.stringify(report) })).catch(() => undefined);
}

function collectDesktopPetQaDomElement(root: ParentNode, selector: string): DesktopPetQaDomElementSnapshot {
  const element = root.querySelector?.(selector) as DomElementLike | null | undefined;
  if (!element) {
    return {
      selector,
      present: false,
      data: {}
    };
  }
  const text = normalizeTextContent(element.textContent);
  return {
    selector,
    present: true,
    data: collectDesktopPetQaDataAttributes(element),
    ...(text ? { text } : {})
  };
}

function collectDesktopPetQaDataAttributes(element: DomElementLike): Record<string, string> {
  const data: Record<string, string> = {};
  if (typeof element.getAttributeNames === "function" && typeof element.getAttribute === "function") {
    for (const name of element.getAttributeNames()) {
      if (!name.startsWith("data-")) {
        continue;
      }
      data[dataAttributeReportKey(name)] = element.getAttribute(name) ?? "";
    }
    return data;
  }
  for (const [key, value] of Object.entries(element.dataset ?? {})) {
    data[datasetReportKey(key)] = String(value);
  }
  return data;
}

function dataAttributeReportKey(name: string) {
  return name.replace(/-/gu, "_");
}

function datasetReportKey(key: string) {
  return `data_${key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`)}`;
}

function normalizeTextContent(input: string | null | undefined) {
  const text = input?.replace(/\s+/gu, " ").trim();
  if (!text) {
    return undefined;
  }
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}
