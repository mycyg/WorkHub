// WorkHub 桌面 · Spotlight「派活 / 澄清」能力内联视图（S3，核心闭环 + 最能体现「盒子会生长」）。
// 输入意图 → createSession → 统一玻璃问答卡（进度 + 选项 chip + 自由文本）逐题推进（nextQuestion），
// input_mode=confirm 时一键 createWorkItem（spec_ready，不自动派活，与 web 同口径：先给人过目）。
// 复用 client.createSession/nextQuestion/createWorkItem + 真实 payload（{selected_option_ids, free_text} / {session_id, selected_option_ids}）。

import { WorkHubApiError } from "@workhub/api-client";
import type { SessionVM } from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { riskHintLabel } from "../labels.js";
import type { SpotlightCapabilityView, SpotlightViewContext } from "../view-context.js";

import { spotlightViewsT } from "./locales.js";

type Question = SessionVM["question"];

export function defaultSelectedOptionIds(question: Question): Set<string> {
  if ((question.input_mode !== "single_choice" && question.input_mode !== "confirm") || !question.options?.length) {
    return new Set();
  }
  const recommended = new Set(question.recommended_option_ids ?? []);
  const firstRecommended = question.options.find((option) => recommended.has(option.id));
  return firstRecommended ? new Set([firstRecommended.id]) : new Set();
}

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
      // 非推荐项的风险药丸要本地化(低/中/高风险),别裸渲 contract token low/medium/high(web 同款已修);
      // 无 risk_hint 时不渲药丸(下方 tag ? 守卫)。
      const tag = recommended.has(option.id)
        ? (spotlightViewsT(zh, "recommended"))
        : option.risk_hint ? riskHintLabel(option.risk_hint, zh) : "";
      return `<button type="button" class="wh-spot-opt" data-opt="${escapeHtml(option.id)}" data-sel="${isSel}" aria-pressed="${isSel}">
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
  const ph = question.free_text.placeholder ?? (spotlightViewsT(zh, "addAnyDetailOptional"));
  const max = question.free_text.max_length ? ` maxlength="${question.free_text.max_length}"` : "";
  return `<textarea class="wh-spot-freetext" data-freetext placeholder="${escapeHtml(ph)}"${max}></textarea>`;
}

function questionHtml(vm: SessionVM, selected: Set<string>, zh: boolean): string {
  const q = vm.question;
  const isConfirm = q.input_mode === "confirm";
  const submitLabel = isConfirm ? (spotlightViewsT(zh, "createWorkItem")) : spotlightViewsT(zh, "continue");
  return `<div class="wh-spot-intake">
    ${progressHtml(q)}
    <h3 class="wh-spot-intake-title">${escapeHtml(q.title)}</h3>
    ${q.body ? `<p class="wh-spot-intake-body">${escapeHtml(q.body)}</p>` : ""}
    ${optionsHtml(q, selected, zh)}
    ${freeTextHtml(q, zh)}
    <div class="wh-spot-intake-actions">
      <button type="button" class="wh-spot-act wh-spot-act--quiet" data-restart>${spotlightViewsT(zh, "restart")}</button>
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-submit>${escapeHtml(submitLabel)}</button>
    </div>
  </div>`;
}

// projectLabel：从项目主页「新任务」进来时携带的项目名 → 起始屏直接显示「在该项目里新建」，与 web 端对齐。
export function startHtml(zh: boolean, projectLabel?: string, prefillIntent?: string): string {
  const projectPill = projectLabel
    ? `<div class="wh-spot-row-meta" data-intake-project="${escapeHtml(projectLabel)}"><span class="wh-spot-chip wh-spot-chip--info">${escapeHtml(zh ? `项目：${projectLabel}` : `Project: ${projectLabel}`)}</span></div>`
    : "";
  return `<div class="wh-spot-intake">
    <h3 class="wh-spot-intake-title">${spotlightViewsT(zh, "whatShouldTheAiTakeOn")}</h3>
    ${projectPill}
    <p class="wh-spot-intake-body">${spotlightViewsT(zh, "describeItInALineCuu")}</p>
    <textarea class="wh-spot-freetext" data-intent placeholder="${spotlightViewsT(zh, "eGSummarizeLastWeekS")}">${escapeHtml(prefillIntent ?? "")}</textarea>
    <div class="wh-spot-intake-actions">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-start>${spotlightViewsT(zh, "start")}</button>
    </div>
  </div>`;
}

export function doneHtml(code: string, title: string, zh: boolean): string {
  return `<div class="wh-spot-empty">
    <div class="wh-spot-empty-face">(=^･ω･^=)✓</div>
    <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "workItemCreated")}</h3>
    <p class="wh-spot-empty-sub">${escapeHtml(code ? `${code} · ${title}` : title)}</p>
    <div class="wh-spot-intake-actions" style="justify-content:center">
      <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-restart>${spotlightViewsT(zh, "createAnotherTask")}</button>
    </div>
  </div>`;
}

// 阻断 #3（R24 S3 走查）：createSession 失败此前一律吞掉服务端原因、弹一句「重试也没用」的假重试
// toast。按错误码分流：没有项目/AI 未配置这两条已知死路直接给可行动的下一步（去建项目/去看设置），
// 其它码把服务端原文透传给用户（总比一句通用文案强，即便原文暂时还是硬编码中文——见
// views/memory.ts friendlyErrorMessage 同款「暂无双语表就诚实兜底」的取舍）。
type StartFailureKind = "no_project" | "ai_unavailable" | "other";

function classifyStartFailure(error: unknown): StartFailureKind {
  if (error instanceof WorkHubApiError) {
    if (error.code === "project_not_found") {
      return "no_project";
    }
    if (error.code === "clarification_llm_unavailable" || error.status === 503) {
      return "ai_unavailable";
    }
  }
  return "other";
}

function startFailureToastMessage(kind: StartFailureKind, error: unknown, zh: boolean): string {
  if (kind === "no_project") {
    return spotlightViewsT(zh, "thisServerHasNoProjectYet");
  }
  if (kind === "ai_unavailable") {
    return spotlightViewsT(zh, "theAiServiceIsnTSet");
  }
  // 其它码：透传服务端原文，不再用一句「重试」抹掉原因。
  if (error instanceof WorkHubApiError && error.message) {
    return error.message;
  }
  return spotlightViewsT(zh, "couldnTStartRetry");
}

// 已知死路（无项目/AI 未配置）额外给一张就地卡片 + 直达按钮——光有 toast 不够（3.2s 就没了，且toast
// 内没有可点的动作），用户得能一键走到能解决问题的地方，而不是回到同一个必然失败的起始表单里死循环。
function startFailureCardHtml(kind: StartFailureKind, zh: boolean): string {
  if (kind === "no_project") {
    return `<div class="wh-spot-empty">
      <div class="wh-spot-empty-face">(=^･ω･^=)</div>
      <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "createAProjectFirst")}</h3>
      <p class="wh-spot-empty-sub">${spotlightViewsT(zh, "aTaskNeedsToBelongTo")}</p>
      <div class="wh-spot-intake-actions" style="justify-content:center">
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-goto-new-project>${spotlightViewsT(zh, "createAProject")}</button>
      </div>
    </div>`;
  }
  if (kind === "ai_unavailable") {
    return `<div class="wh-spot-empty">
      <div class="wh-spot-empty-face">(=^･ω･^=)</div>
      <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "aiIsnTSetUpYet")}</h3>
      <p class="wh-spot-empty-sub">${spotlightViewsT(zh, "anAdminNeedsToConfigureA")}</p>
      <div class="wh-spot-intake-actions" style="justify-content:center">
        <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-goto-settings>${spotlightViewsT(zh, "openSettings")}</button>
      </div>
    </div>`;
  }
  return "";
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
        // 绑定项目时(ctx.target.label) 把上下文带进面包屑 + 起始屏，与 web 端「在 X 里派活」对齐。
        const projectLabel = ctx.target?.label;
        // 普通用户审查 R2：launcher 整句查询无匹配→「当新任务」带过来的原话预填到意图框，不丢字。
        const prefillIntent = ctx.target?.route?.startsWith("spotlight-intent:")
          ? ctx.target.route.slice("spotlight-intent:".length)
          : undefined;
        ctx.setSubtitle(projectLabel ? (zh ? `新任务 · ${projectLabel}` : `New task · ${projectLabel}`) : (spotlightViewsT(ctx.locale, "newRequest")));
        body.innerHTML = startHtml(zh, projectLabel, prefillIntent);
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
        ctx.setSubtitle(active ? (total ? `${active.label} · ${idx}/${total}` : active.label) : spotlightViewsT(ctx.locale, "clarifying"));
        body.innerHTML = questionHtml(session, selected, zh);
        ctx.requestResize();
      };

      const startSession = async (intent: string) => {
        if (busy) return;
        busy = true;
        setBusy(spotlightViewsT(ctx.locale, "starting"));
        try {
          // S4b：从项目主页「新任务」进来时携带 ctx.target.id → 会话绑定到该项目，不丢上下文。
          const projectId = ctx.target?.id;
          const trimmedIntent = intent.trim();
          session = await client.createSession({
            ...(projectId ? { project_id: projectId } : {}),
            ...(trimmedIntent ? { intent_text: trimmedIntent } : {})
          });
          selected = defaultSelectedOptionIds(session.question);
          busy = false;
          renderQuestion();
        } catch (error) {
          busy = false;
          const kind = classifyStartFailure(error);
          ctx.toast(startFailureToastMessage(kind, error, zh), "error");
          const failureCard = startFailureCardHtml(kind, zh);
          if (failureCard) {
            session = null;
            selected = new Set();
            ctx.setSubtitle(spotlightViewsT(ctx.locale, "oneThingFirst"));
            body.innerHTML = failureCard;
            ctx.requestResize();
          } else {
            renderStart();
          }
        }
      };

      const submit = async () => {
        if (busy || !session) return;
        const q = session.question;
        const freeText = body.querySelector<HTMLTextAreaElement>("[data-freetext]")?.value.trim() ?? "";
        const ids = [...selected];
        // M3：非确认步必须有答案（选项或补充文本），否则别把空答案推给服务端误推进。
        if (q.input_mode !== "confirm" && ids.length === 0 && !freeText) {
          ctx.toast(spotlightViewsT(ctx.locale, "pickAnOptionOrAddA"), "info");
          return;
        }
        busy = true;
        setBusy(spotlightViewsT(ctx.locale, "working"));
        try {
          if (q.input_mode === "confirm") {
            const created = await client.createWorkItem({ session_id: session.session_id, selected_option_ids: ids });
            busy = false;
            session = null;
            ctx.setSubtitle(spotlightViewsT(ctx.locale, "created"));
            body.innerHTML = doneHtml(created.workitem.code ?? "", created.workitem.title ?? "", zh);
            ctx.requestResize();
            ctx.toast(spotlightViewsT(ctx.locale, "workItemCreatedAwaitingYourReview"), "ok");
            return;
          }
          session = await client.nextQuestion(session.session_id, {
            selected_option_ids: ids,
            ...(freeText ? { free_text: freeText } : {})
          });
          selected = defaultSelectedOptionIds(session.question);
          busy = false;
          renderQuestion();
        } catch (error) {
          busy = false;
          ctx.toast(spotlightViewsT(ctx.locale, "submitFailedRetry"), "error");
          renderQuestion();
        }
      };

      body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest("[data-start]")) {
          // L18：空意图不要静默开一个无主题的会话。先要一句话说清要做什么（与 submit() 的兜底同口径）。
          const intent = body.querySelector<HTMLTextAreaElement>("[data-intent]")?.value ?? "";
          if (!intent.trim()) {
            ctx.toast(spotlightViewsT(ctx.locale, "tellMeWhatToDoIn"), "info");
            body.querySelector<HTMLTextAreaElement>("[data-intent]")?.focus();
            return;
          }
          void startSession(intent);
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
        if (target.closest("[data-goto-new-project]")) {
          ctx.open("new_project");
          return;
        }
        if (target.closest("[data-goto-settings]")) {
          ctx.open("settings");
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
          // 只更新选中态，不整体重渲（保自由文本输入）。aria-pressed 同步给读屏。
          body.querySelectorAll<HTMLElement>("[data-opt]").forEach((el) => {
            const isSelected = selected.has(el.dataset.opt ?? "");
            el.dataset.sel = String(isSelected);
            el.setAttribute("aria-pressed", String(isSelected));
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
