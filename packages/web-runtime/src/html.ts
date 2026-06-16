export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
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
