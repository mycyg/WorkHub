// WorkHub 桌面 · Spotlight「派活 / 澄清」能力内联视图（S3，核心闭环 + 最能体现「盒子会生长」）。
// 输入意图 → createSession → 统一玻璃问答卡（进度 + 选项 chip + 自由文本）逐题推进（nextQuestion），
// input_mode=confirm 时一键 createWorkItem（spec_ready，不自动派活，与 web 同口径：先给人过目）。
// 复用 client.createSession/nextQuestion/createWorkItem + 真实 payload（{selected_option_ids, free_text} / {session_id, selected_option_ids}）。

import type { SessionVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

type Question = SessionVM["question"];

function progressHtml(question: Question): string {
  if (!question.progress?.length) {
    return "";
  }
  const dots = question.progress
    .map(
      (step) =>
        `<span class="wh-spot-step wh-spot-step--${step.state}"><span class="wh-spot-step-dot"></span>${escapeHtml(step.label)}</span>`
    )
    .join("");
  return `<div class="wh-spot-steps">${dots}</div>`;
}

function optionsHtml(question: Question, selected: Set<string>, zh: boolean): string {
  if (!question.options?.length) {
    return "";
  }
  const recommended = new Set(question.recommended_option_ids ?? []);
  const cards = question.options
    .map((option) => {
      const desc = option.description ?? option.impact ?? "";
      const isSel = selected.has(option.id);
      const tag = recommended.has(option.id) ? (zh ? "推荐" : "Recommended") : option.risk_hint ?? "";
      return `<button type="button" class="wh-spot-opt" data-opt="${escapeHtml(option.id)}" data-sel="${isSel}">
        <span class="wh-spot-opt-check" aria-hidden="true"></span>
        <span class="wh-spot-opt-text">
          <span class="wh-spot-opt-label">${escapeHtml(option.label)}${tag ? `<span class="wh-spot-opt-tag">${escapeHtml(tag)}</span>` : ""}</span>
          ${desc ? `<span class="wh-spot-opt-desc">${escapeHtml(desc)}</span>` : ""}
        </span>
      </button>`;
    })
    .join("");
  return `<div class="wh-spot-opts" data-multi="${question.input_mode === "multi_choice" || question.input_mode === "rank"}">${cards}</div>`;
}

function freeTextHtml(question: Question, zh: boolean): string {
  if (!question.free_text?.enabled) {
    return "";
  }
  const ph = question.free_text.placeholder ?? (zh ? "补充点细节（可选）…" : "Add any detail (optional)…");
  const max = question.free_text.max_length ? ` maxlength="${question.free_text.max_length}"` : "";
  return `<textarea class="wh-spot-freetext" data-freetext placeholder="${escapeHtml(ph)}"${max}></textarea>`;
}

function questionHtml(vm: SessionVM, selected: Set<string>, zh: boolean): string {
  const q = vm.question;
  const isConfirm = q.input_mode === "confirm";
  const submitLabel = isConfirm ? (zh ? "创建工作项" : "Create work item") : zh ? "继续" : "Continue";
  return `<div class="wh-spot-intake">
    ${progressHtml(q)}
    <h3 class="wh-spot-intake-title">${escapeHtml(q.title)}</h3>
    ${q.body ? `<p class="wh-spot-intake-body">${escapeHtml(q.body)}</p>` : ""}
    ${optionsHtml(q, selected, zh)}
    ${freeTextHtml(q, zh)}
    <div class="wh-spot-intake-actions">
      <button type="button" class="wh-spot-act wh-spot-act--quiet" data-restart>${zh ? "重新开始" : "Restart"}</button>
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-submit>${escapeHtml(submitLabel)}</button>
    </div>
  </div>`;
}

function startHtml(zh: boolean): string {
  return `<div class="wh-spot-intake">
    <h3 class="wh-spot-intake-title">${zh ? "你想让 AI 帮你做点什么？" : "What should the AI take on?"}</h3>
    <p class="wh-spot-intake-body">${zh ? "用一句话说清楚，Cuu 会先澄清几个关键点，再去干、回头给你过目。" : "Describe it in a line — Cuu clarifies a few points, then works and brings it back for review."}</p>
    <textarea class="wh-spot-freetext" data-intent placeholder="${zh ? "例如：整理上周客户访谈，输出一页要点摘要…" : "e.g. Summarize last week's customer interviews into a one-pager…"}"></textarea>
    <div class="wh-spot-intake-actions">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-start>${zh ? "开始澄清" : "Start"}</button>
    </div>
  </div>`;
}

function doneHtml(code: string, title: string, zh: boolean): string {
  return `<div class="wh-spot-empty">
    <div class="wh-spot-empty-face">(=^･ω･^=)✓</div>
    <h3 class="wh-spot-empty-title">${zh ? "工作项已创建" : "Work item created"}</h3>
    <p class="wh-spot-empty-sub">${escapeHtml(code ? `${code} · ${title}` : title)}</p>
    <div class="wh-spot-intake-actions" style="justify-content:center">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-restart>${zh ? "再派一个" : "Dispatch another"}</button>
    </div>
  </div>`;
}

export function createIntakeView(): SpotlightCapabilityView {
  return {
    id: "intake",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { body, client } = ctx;
      let disposed = false;
      let session: SessionVM | null = null;
      let selected = new Set<string>();
      let busy = false;

      const setBusy = (label: string) => {
        const btn = body.querySelector<HTMLButtonElement>("[data-submit],[data-start]");
        if (btn) {
          btn.disabled = true;
          btn.textContent = label;
        }
      };

      const renderStart = () => {
        if (disposed) return;
        session = null;
        selected = new Set();
        ctx.setSubtitle(zh ? "提需求" : "New request");
        body.innerHTML = startHtml(zh);
        ctx.requestResize();
        body.querySelector<HTMLTextAreaElement>("[data-intent]")?.focus();
      };

      const renderQuestion = () => {
        if (disposed || !session) return;
        // 副标题 = 当前澄清步骤（含 N/总）；setSubtitle 走 textContent，传原文不要转义。
        const steps = session.question.progress ?? [];
        const active = steps.find((s) => s.state === "active");
        const total = steps.length;
        const idx = total ? steps.filter((s) => s.state === "done").length + 1 : 0;
        ctx.setSubtitle(active ? (total ? `${active.label} · ${idx}/${total}` : active.label) : zh ? "澄清中" : "Clarifying");
        body.innerHTML = questionHtml(session, selected, zh);
        ctx.requestResize();
      };

      const startSession = async (intent: string) => {
        if (busy) return;
        busy = true;
        setBusy(zh ? "正在开场…" : "Starting…");
        try {
          session = await client.createSession(intent.trim() ? { intent_text: intent.trim() } : {});
          selected = new Set();
          busy = false;
          renderQuestion();
        } catch (error) {
          busy = false;
          ctx.toast(zh ? "开场失败，请重试" : "Couldn't start — retry", "error");
          renderStart();
        }
      };

      const submit = async () => {
        if (busy || !session) return;
        const q = session.question;
        const freeText = body.querySelector<HTMLTextAreaElement>("[data-freetext]")?.value.trim() ?? "";
        const ids = [...selected];
        // M3：非确认步必须有答案（选项或补充文本），否则别把空答案推给服务端误推进。
        if (q.input_mode !== "confirm" && ids.length === 0 && !freeText) {
          ctx.toast(zh ? "先选一项，或补一句再继续" : "Pick an option or add a note first", "info");
          return;
        }
        busy = true;
        setBusy(zh ? "处理中…" : "Working…");
        try {
          if (q.input_mode === "confirm") {
            const created = await client.createWorkItem({ session_id: session.session_id, selected_option_ids: ids });
            busy = false;
            session = null;
            ctx.setSubtitle(zh ? "已创建" : "Created");
            body.innerHTML = doneHtml(created.workitem.code ?? "", created.workitem.title ?? "", zh);
            ctx.requestResize();
            ctx.toast(zh ? "工作项已创建（待你过目，未自动派活）" : "Work item created (awaiting your review)", "ok");
            return;
          }
          session = await client.nextQuestion(session.session_id, {
            selected_option_ids: ids,
            ...(freeText ? { free_text: freeText } : {})
          });
          selected = new Set();
          busy = false;
          renderQuestion();
        } catch (error) {
          busy = false;
          ctx.toast(zh ? "提交失败，请重试" : "Submit failed — retry", "error");
          renderQuestion();
        }
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-start]")) {
          void startSession(body.querySelector<HTMLTextAreaElement>("[data-intent]")?.value ?? "");
          return;
        }
        if (target.closest("[data-restart]")) {
          renderStart();
          return;
        }
        if (target.closest("[data-submit]")) {
          void submit();
          return;
        }
        const opt = target.closest<HTMLElement>("[data-opt]");
        if (opt?.dataset.opt && session) {
          const id = opt.dataset.opt;
          const multi = session.question.input_mode === "multi_choice" || session.question.input_mode === "rank";
          if (multi) {
            if (selected.has(id)) selected.delete(id);
            else selected.add(id);
          } else {
            selected = new Set([id]);
          }
          // 只更新选中态，不整体重渲（保自由文本输入）。
          body.querySelectorAll<HTMLElement>("[data-opt]").forEach((el) => {
            el.dataset.sel = String(selected.has(el.dataset.opt ?? ""));
          });
        }
      });

      renderStart();
      return () => {
        disposed = true;
      };
    }
  };
}
