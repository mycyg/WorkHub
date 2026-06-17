// 契约/外部来源的 href 可能带 javascript:/data: 协议，或 //protocol-relative 跳到站外 → 点击即 XSS / 开放重定向。
// escapeHtml 只挡引号/尖括号，不挡危险 scheme，故渲染 href/data-action-href 前必须先过这里：
// 只放行「单斜杠相对路径」与 http(s)/mailto，其余一律拦成 "#"。渲染时仍需再过 escapeHtml。
// 与各 render 模块内的同名局部副本保持同一判定；新接入的 sink 统一引用本文件。
export function safeHref(value: unknown): string {
  const v = String(value ?? "").trim();
  if ((v.startsWith("/") && !v.startsWith("//")) || /^(?:https?:|mailto:)/iu.test(v)) {
    return v;
  }
  return "#";
}
