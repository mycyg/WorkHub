export type DesktopPetQaDomReportReason = "render" | "patch";

export type DesktopPetQaDomElementSnapshot = {
  selector: string;
  present: boolean;
  data: Record<string, string>;
  rect?: DesktopPetQaDomRect | undefined;
  layout?: DesktopPetQaDomLayout | undefined;
  overflow_offenders?: DesktopPetQaDomOverflowOffender[] | undefined;
  text?: string | undefined;
};

export type DesktopPetQaDomLayout = {
  client_width: number;
  scroll_width: number;
  client_height: number;
  scroll_height: number;
  horizontal_overflow: boolean;
};

export type DesktopPetQaDomOverflowOffender = {
  tag: string;
  class_name: string;
  text: string;
  client_width: number;
  scroll_width: number;
  rect_width: number;
};

export type DesktopPetQaDomRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

export type DesktopPetQaDomSnapshot = {
  contract: "workhub.cuu.tauri.actual-dom-report";
  version: 1;
  captured_at_iso: string;
  reason: DesktopPetQaDomReportReason;
  surface: DesktopPetQaDomElementSnapshot;
  live2d: DesktopPetQaDomElementSnapshot;
  settings_menu: DesktopPetQaDomElementSnapshot;
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
  clientWidth?: number;
  scrollWidth?: number;
  clientHeight?: number;
  scrollHeight?: number;
  getAttributeNames?: () => string[];
  getAttribute?: (name: string) => string | null;
  getBoundingClientRect?: () => DOMRect;
  querySelectorAll?: (selector: string) => NodeListOf<Element>;
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
    settings_menu: collectDesktopPetQaDomElement(root, "[data-pet-settings-menu]"),
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
  const rect = collectDesktopPetQaRect(element);
  const layout = collectDesktopPetQaLayout(element);
  const overflowOffenders = collectDesktopPetQaOverflowOffenders(element);
  return {
    selector,
    present: true,
    data: collectDesktopPetQaDataAttributes(element),
    ...(rect ? { rect } : {}),
    ...(layout ? { layout } : {}),
    ...(overflowOffenders.length ? { overflow_offenders: overflowOffenders } : {}),
    ...(text ? { text } : {})
  };
}

function collectDesktopPetQaRect(element: DomElementLike): DesktopPetQaDomRect | undefined {
  if (typeof element.getBoundingClientRect !== "function") {
    return undefined;
  }
  const rect = element.getBoundingClientRect();
  return {
    x: roundRectNumber(rect.x),
    y: roundRectNumber(rect.y),
    width: roundRectNumber(rect.width),
    height: roundRectNumber(rect.height),
    right: roundRectNumber(rect.right),
    bottom: roundRectNumber(rect.bottom)
  };
}

function collectDesktopPetQaLayout(element: DomElementLike): DesktopPetQaDomLayout | undefined {
  if (typeof element.clientWidth !== "number" || typeof element.scrollWidth !== "number") {
    return undefined;
  }
  const clientWidth = Math.max(0, Math.round(element.clientWidth));
  const scrollWidth = Math.max(0, Math.round(element.scrollWidth));
  const clientHeight = typeof element.clientHeight === "number" ? Math.max(0, Math.round(element.clientHeight)) : 0;
  const scrollHeight = typeof element.scrollHeight === "number" ? Math.max(0, Math.round(element.scrollHeight)) : 0;
  return {
    client_width: clientWidth,
    scroll_width: scrollWidth,
    client_height: clientHeight,
    scroll_height: scrollHeight,
    horizontal_overflow: clientWidth > 0 && scrollWidth > clientWidth + 2
  };
}

function collectDesktopPetQaOverflowOffenders(element: DomElementLike): DesktopPetQaDomOverflowOffender[] {
  if (typeof element.querySelectorAll !== "function") {
    return [];
  }
  return Array.from(element.querySelectorAll("*") as NodeListOf<DomElementLike>)
    .map((candidate) => {
      const text = normalizeTextContent(candidate.textContent) ?? "";
      const rect = typeof candidate.getBoundingClientRect === "function" ? candidate.getBoundingClientRect() : undefined;
      return {
        tag: candidate.tagName.toLowerCase(),
        class_name: String(candidate.className || ""),
        text,
        client_width: typeof candidate.clientWidth === "number" ? Math.max(0, Math.round(candidate.clientWidth)) : 0,
        scroll_width: typeof candidate.scrollWidth === "number" ? Math.max(0, Math.round(candidate.scrollWidth)) : 0,
        rect_width: rect ? roundRectNumber(rect.width) : 0
      };
    })
    .filter((entry) => entry.text && entry.client_width > 0 && entry.scroll_width > entry.client_width + 2)
    .slice(0, 12);
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

function roundRectNumber(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
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
