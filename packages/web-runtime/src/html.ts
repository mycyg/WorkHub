export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

// 外部/契约来源的 href 可能带 javascript:/data: → 点击即 XSS（escapeHtml 只挡引号/尖括号，不挡危险 scheme）。
// 只放行相对路径与 http(s)/mailto，其余拦成 "#"。渲染 href/data-action-href 时应先过它再 escapeHtml。
export function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if (v.startsWith("/") || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}

export function eventListenerOptions(signal?: AbortSignal): AddEventListenerOptions | undefined {
  return signal ? { signal } : undefined;
}

export function cssEscape(value: string) {
  const escape = globalThis.CSS?.escape;
  if (escape) {
    return escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/gu, (match) => `\\${match}`);
}
