import type { CuuState, QuestionCard, SessionVM } from "@workhub/contracts";

import { uiLocale, uiT, type UiRenderOptions } from "../i18n.js";

export type IntakeRenderSurface = "web" | "desktop";

export type IntakeRenderedSession = {
  surface: IntakeRenderSurface;
  sessionId: string;
  workItemId?: string;
  topic: string;
  route: string;
  streamHref: string;
  nextQuestionHref: string;
  css: string;
  html: string;
  optionIds: string[];
  recommendedOptionIds: string[];
  freeTextCollapsed: boolean;
  cuuState: CuuState;
  primaryHrefs: string[];
};

export const intakeCss = [
  ":root{color-scheme:light;--ink:#182033;--muted:#60708f;--line:#dfe6f2;--paper:#fff;--soft:#f5f8fc;--blue:#355cff;--green:#24a66a;--amber:#d98b16;--danger:#d94a3a}",
  ".wh-intake{font-family:\"Aptos\",\"Segoe UI\",sans-serif;color:var(--ink);background:linear-gradient(180deg,#f8fbff 0%,#edf5ff 100%);padding:24px;box-sizing:border-box}",
  ".wh-intake-frame{max-width:980px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start}",
  ".wh-intake-main{background:rgba(255,255,255,.93);border:1px solid var(--line);border-radius:8px;box-shadow:0 18px 50px rgba(37,51,79,.08);padding:24px}.wh-kicker{font-size:12px;color:var(--blue);font-weight:750;text-transform:uppercase;letter-spacing:0}",
  ".wh-title{font-size:30px;line-height:1.12;margin:8px 0}.wh-subtle{color:var(--muted);line-height:1.55}.wh-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:18px}",
  ".wh-option{appearance:none;text-align:left;border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:16px;min-height:134px;display:grid;gap:8px;cursor:pointer;color:var(--ink)}.wh-option[data-recommended=true]{border-color:var(--blue);box-shadow:0 0 0 1px rgba(53,92,255,.2),0 14px 30px rgba(53,92,255,.08)}",
  ".wh-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;background:var(--soft);padding:5px 9px;font-size:12px;color:var(--muted)}.wh-pill-primary{background:#edf1ff;color:var(--blue)}",
  ".wh-progress{height:8px;border-radius:999px;background:#e8eef8;overflow:hidden;margin:18px 0}.wh-progress>span{display:block;height:100%;background:var(--blue)}",
  ".wh-step{display:flex;align-items:flex-start;gap:10px;border-top:1px solid var(--line);padding:12px 0}.wh-step:first-child{border-top:0}.wh-dot{width:20px;height:20px;border-radius:999px;display:grid;place-items:center;font-size:12px;background:#edf1ff;color:var(--blue);flex:0 0 auto}.wh-step[data-state=done] .wh-dot{background:#e9f8ef;color:var(--green)}.wh-step[data-state=pending] .wh-dot{background:#eef1f6;color:#8c98ad}",
  ".wh-card{border:1px solid var(--line);background:var(--paper);border-radius:8px;padding:14px}.wh-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.wh-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:1px solid var(--blue);padding:10px 14px;color:#fff;text-decoration:none;background:var(--blue);font-weight:700}",
  ".wh-free-text{margin-top:14px}.wh-free-text summary{cursor:pointer;font-weight:700}",
  ".wh-desktop .wh-intake-frame{max-width:980px;grid-template-columns:minmax(0,1fr)}.wh-desktop .wh-intake{background:linear-gradient(135deg,#edf6ff,#f8fbff)}",
  "@media (max-width:860px){.wh-intake-frame{grid-template-columns:1fr}.wh-title{font-size:24px}}"
].join("");

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function progressPercent(question: QuestionCard) {
  if (question.progress.length === 0) {
    return 0;
  }
  const score = question.progress.reduce((sum, step) => {
    if (step.state === "done") {
      return sum + 1;
    }
    if (step.state === "active") {
      return sum + 0.5;
    }
    return sum;
  }, 0);
  return Math.round((score / question.progress.length) * 100);
}

function renderOptions(question: QuestionCard, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  const recommended = new Set(question.recommended_option_ids ?? []);
  return question.options
    .map((option) => {
      const description = option.description ?? option.impact ?? "";
      return `<button class="wh-option" type="button" data-option-id="${escapeHtml(option.id)}" data-recommended="${recommended.has(option.id)}">
        <strong>${escapeHtml(option.label)}</strong>
        <p class="wh-subtle">${escapeHtml(description)}</p>
        ${recommended.has(option.id) ? `<span class="wh-pill wh-pill-primary">${escapeHtml(uiT(locale, "intake.aiRecommended"))}</span>` : ""}
      </button>`;
    })
    .join("");
}

function renderFreeText(question: QuestionCard, options?: UiRenderOptions) {
  const locale = uiLocale(options);
  if (!question.free_text.enabled) {
    return "";
  }
  return `<details class="wh-card wh-free-text" ${question.free_text.collapsed_by_default ? "" : "open"}>
    <summary>${escapeHtml(uiT(locale, "intake.freeText"))}</summary>
    <p class="wh-subtle">${escapeHtml(question.free_text.placeholder ?? uiT(locale, "intake.freeTextPlaceholder"))}</p>
  </details>`;
}

export function renderIntakeSession(
  session: SessionVM,
  surface: IntakeRenderSurface,
  options?: UiRenderOptions
): IntakeRenderedSession {
  const locale = uiLocale(options);
  const question = {
    ...session.question,
    session_id: session.question.session_id ?? session.session_id,
    work_item_id: session.question.work_item_id ?? session.work_item_id
  };
  const state: CuuState = "asking_approval";
  const rootClass = surface === "desktop" ? "wh-desktop" : "wh-web";
  const pct = progressPercent(question);
  const main = `<section class="wh-intake-main" data-session-id="${escapeHtml(session.session_id)}">
    <span class="wh-kicker">${escapeHtml(uiT(locale, "intake.kicker"))}</span>
    <h1 class="wh-title">${escapeHtml(question.title)}</h1>
    <p class="wh-subtle">${escapeHtml(question.body ?? uiT(locale, "intake.defaultBody"))}</p>
    <div class="wh-progress" aria-label="${escapeHtml(uiT(locale, "intake.progressAria"))}"><span style="width:${pct}%"></span></div>
    <div class="wh-grid">${renderOptions(question, { locale })}</div>
    ${renderFreeText(question, { locale })}
    <div class="wh-actions"><a class="wh-btn" href="${escapeHtml(question.submit.href)}" data-method="${escapeHtml(question.submit.method)}">${escapeHtml(uiT(locale, "intake.continue"))}</a></div>
  </section>`;

  return {
    surface,
    sessionId: session.session_id,
    ...(session.work_item_id ? { workItemId: session.work_item_id } : {}),
    topic: session.topic,
    route: `/intake/${encodeURIComponent(session.session_id)}`,
    streamHref: session.stream_href,
    nextQuestionHref: session.next_question_href,
    css: intakeCss,
    html: `<div class="${rootClass}"><main class="wh-intake"><div class="wh-intake-frame">${main}</div></main></div>`,
    optionIds: question.options.map((option) => option.id),
    recommendedOptionIds: question.recommended_option_ids ?? [],
    freeTextCollapsed: question.free_text.collapsed_by_default,
    cuuState: state,
    primaryHrefs: [question.submit.href]
  };
}
