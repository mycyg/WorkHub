import { cssEscape, eventListenerOptions } from "./html.js";

export type RouteLineEditorBindingOptions = {
  signal?: AbortSignal | undefined;
  markDirty?: ((reason: string) => void) | undefined;
};

export function datasetInt(element: HTMLElement, key: string) {
  const value = element.dataset[key];
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function updateLineEditorPanelPayload(panel: HTMLElement) {
  const hunks = Array.from(panel.querySelectorAll<HTMLElement>("[data-line-editor-hunk]")).flatMap((hunk) => {
    const selected = hunk.querySelector<HTMLButtonElement>("[data-line-editor-decision-selected=\"true\"]")
      ?? hunk.querySelector<HTMLButtonElement>("[data-line-editor-decision]");
    const hunkIndex = datasetInt(hunk, "lineEditorHunkIndex");
    const startLine = datasetInt(hunk, "lineEditorStartLine");
    const endLine = datasetInt(hunk, "lineEditorEndLine");
    const decision = selected?.dataset.lineEditorDecision;
    return hunkIndex !== undefined && startLine !== undefined && endLine !== undefined && decision
      ? [{ hunk_index: hunkIndex, start_line: startLine, end_line: endLine, decision }]
      : [];
  });
  const apply = panel.querySelector<HTMLElement>("[data-line-editor-apply]");
  if (!apply || hunks.length === 0) {
    return;
  }
  const requestJson = JSON.stringify({ confirm: true, text_hunk_overrides: { hunks } });
  apply.dataset.requestJson = requestJson;
  apply.setAttribute("data-request-json", requestJson);
}

export function activateLineEditorPanel(tab: HTMLButtonElement) {
  const editor = tab.closest<HTMLElement>("[data-route-line-editor]");
  const panelId = tab.dataset.lineEditorPanelId;
  if (!editor || !panelId) {
    return;
  }
  for (const item of editor.querySelectorAll<HTMLButtonElement>("[data-line-editor-tab]")) {
    const active = item === tab;
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  }
  for (const panel of editor.querySelectorAll<HTMLElement>("[data-line-editor-panel]")) {
    panel.hidden = panel.id !== panelId;
  }
  editor.querySelector<HTMLElement>(`#${cssEscape(panelId)}`)?.querySelector<HTMLInputElement>("[data-line-editor-search]")?.focus();
}

export function applyLineEditorSearch(input: HTMLInputElement) {
  const panel = input.closest<HTMLElement>("[data-line-editor-panel]");
  if (!panel) {
    return;
  }
  const query = input.value.trim().toLowerCase();
  let visibleCount = 0;
  for (const row of panel.querySelectorAll<HTMLElement>("[data-line-editor-row]")) {
    const text = `${row.dataset.lineEditorRowText ?? ""} ${row.textContent ?? ""}`.toLowerCase();
    const visible = query.length === 0 || text.includes(query);
    row.hidden = !visible;
    if (visible) {
      visibleCount += 1;
    }
  }
  panel.dataset.lineEditorMatchCount = String(visibleCount);
  const badge = panel.querySelector<HTMLElement>("[data-line-editor-match-count]");
  if (badge) {
    badge.textContent = String(visibleCount);
  }
}

export function bindRouteLineEditor(shellRoot: HTMLElement, options: RouteLineEditorBindingOptions = {}) {
  shellRoot.addEventListener("click", (event) => {
    const tab = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-line-editor-tab]") : null;
    if (tab) {
      event.preventDefault();
      activateLineEditorPanel(tab);
      return;
    }
    const decision = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-line-editor-decision]") : null;
    if (!decision) {
      return;
    }
    const hunk = decision.closest<HTMLElement>("[data-line-editor-hunk]");
    const panel = decision.closest<HTMLElement>("[data-line-editor-panel]");
    if (!hunk || !panel) {
      return;
    }
    for (const sibling of hunk.querySelectorAll<HTMLButtonElement>("[data-line-editor-decision]")) {
      const selected = sibling === decision;
      sibling.dataset.lineEditorDecisionSelected = String(selected);
      sibling.setAttribute("aria-pressed", String(selected));
    }
    updateLineEditorPanelPayload(panel);
    options.markDirty?.("proposal_line_editor");
  }, eventListenerOptions(options.signal));

  shellRoot.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target.closest<HTMLInputElement>("[data-line-editor-search]") : null;
    if (input) {
      applyLineEditorSearch(input);
      if (input.value.trim().length > 0) {
        options.markDirty?.("proposal_line_search");
      }
    }
  }, eventListenerOptions(options.signal));

  shellRoot.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const hunk = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-line-editor-hunk]") : null;
    const panel = hunk?.closest<HTMLElement>("[data-line-editor-panel]");
    if (!hunk || !panel) {
      return;
    }
    const hunks = Array.from(panel.querySelectorAll<HTMLElement>("[data-line-editor-hunk]"));
    const index = hunks.indexOf(hunk);
    const nextIndex = event.key === "ArrowDown" ? index + 1 : index - 1;
    const next = hunks[nextIndex];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }, eventListenerOptions(options.signal));
}
