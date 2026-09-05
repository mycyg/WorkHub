import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client";
import { cardFromAgentRunLive, cardFromAttentionItem, createCuuIdleScheduler, cuuMotionForState, type CuuCard } from "@workhub/cuu";
import {
  eventTypes,
  type AgentRunLiveVM,
  type AttentionItem,
  type ProposalConflict,
  type SessionVM,
  type WorkItemDetailVM
} from "@workhub/contracts";

import {
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAgentLauncherCard,
  desktopCuuProjectContextStorageKey,
  resolveDesktopCuuAction,
  submitDesktopCuuAction,
  type DesktopShellEmitter,
  type DesktopShellListen
} from "./desktop-cuu-runtime.js";
import {
  bootDesktopPetSurface,
  createDesktopPetIdleScheduler,
  createDesktopPetLoggedOutCard,
  defaultDesktopPetPointerSnapshot,
  desktopPetAliveIdlePolicy,
  desktopPetDelegateMainRoute,
  desktopPetInitialIdleAction,
  desktopPetLocale,
  desktopPetPointerSmoothingAlpha,
  desktopPetRunRestoreStorageKey,
  desktopPetRuntimeRetryingDelayMs,
  desktopPetSurfaceCss,
  handleDesktopPetRuntimeDecision,
  handleDesktopPetRuntimeNotice,
  renderDesktopPetSurface,
  replaceDesktopPetRootHtmlPreservingLive2DFrame,
  resolveDesktopSurface,
  scheduleDesktopPetFirstPaint,
  type DesktopPetSurfaceClient
} from "./pet-surface.js";
import { assertDesktopPetVisualQaPass, createDesktopPetVisualQaReport } from "./pet-surface-qa.js";
import {
  desktopPetPointerSnapshotFromSample,
  desktopPetWindowModeForCard,
  desktopPetWindowSettingsFromPreferences,
  normalizeDesktopPetPointerSnapshot,
  pointerPatchFromEvent,
  resolveDesktopPetWindowBridge
} from "./pet-window-bridge.js";

function shellPayload(event: string, data: unknown) {
  return {
    event,
    data: JSON.stringify(data),
    stream_kind: "me",
    stream_path: "/api/push/stream/me"
  };
}

test("desktop pet locale accepts QA injection without overriding explicit locale", () => {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
    navigator?: Navigator;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  const originalNavigator = target.navigator;

  try {
    target.__WORKHUB_CUU_QA_LOCALE__ = "en-US";
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: { getItem: () => "zh-CN" }
    });
    Object.defineProperty(target, "navigator", {
      configurable: true,
      value: { language: "zh-CN" }
    });

    assert.equal(desktopPetLocale(), "en-US");
    assert.equal(desktopPetLocale("zh-CN"), "zh-CN");
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
    Object.defineProperty(target, "navigator", {
      configurable: true,
      value: originalNavigator
    });
  }
});

test("desktop pet root replacement preserves the same Live2D iframe to avoid flicker", () => {
  const previousFrame = {
    getAttribute(name: string) {
      return name === "src" ? "./cuu/live2d/hijiki/cuu-hijiki.html" : null;
    }
  };
  let replacedWith: unknown;
  const nextFrame = {
    getAttribute(name: string) {
      return name === "src" ? "./cuu/live2d/hijiki/cuu-hijiki.html" : null;
    },
    replaceWith(node: unknown) {
      replacedWith = node;
    }
  };
  let rendered = false;
  let assignedHtml = "";
  const root = {
    get innerHTML() {
      return assignedHtml;
    },
    set innerHTML(value: string) {
      assignedHtml = value;
      rendered = true;
    },
    querySelector(selector: string) {
      if (selector !== ".wh-cuu-cat-live2d-frame") {
        return null;
      }
      return rendered ? nextFrame : previousFrame;
    }
  } as unknown as HTMLElement;

  assert.equal(replaceDesktopPetRootHtmlPreservingLive2DFrame(root, "<section>next</section>"), true);
  assert.equal(assignedHtml, "<section>next</section>");
  assert.equal(replacedWith, previousFrame);
});

test("desktop pet bubble is a real frosted-white glass card with dark text", () => {
  // 气泡本体是磨砂白玻璃卡：半透白渐变底 + backdrop blur，深色字直接读在白底上（透明窗里只靠这层不透明白底兜底）。
  assert.match(
    desktopPetSurfaceCss,
    /\.wh-pet-bubble\{[^}]*background:linear-gradient\(135deg,rgba\(255,255,255,\.82\),rgba\(255,255,255,\.52\)\)/u
  );
  // 气泡与聚焦盒(.wh-spot)同一套玻璃语言：亮玻璃描边 .7 + 24px 圆角 + blur40 + 同款柔投影/顶高光。
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble\{[^}]*border:1px solid rgba\(255,255,255,\.7\)/u);
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble\{[^}]*border-radius:24px/u);
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble\{[^}]*box-shadow:0 24px 64px -26px rgba\(31,35,53,\.42\),inset 0 1px 0 rgba\(255,255,255,\.75\)/u);
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble\{[^}]*backdrop-filter:blur\(40px\) saturate\(185%\)/u);
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble\{[^}]*-webkit-backdrop-filter:blur\(40px\) saturate\(185%\)/u);
  // 气泡内关掉冗余的 SVG warp/rim 折射层，避免边缘接缝与 rim 双描边。
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble>\.wh-liquid-glass-warp,\.wh-pet-bubble>\.wh-liquid-glass-rim\{display:none\}/u);
  assert.match(desktopPetSurfaceCss, /\.wh-liquid-glass-warp\{[^}]*--wh-liquid-frost:\.6px/u);
  assert.match(desktopPetSurfaceCss, /\.wh-liquid-glass-refract\{[^}]*filter:none;-webkit-filter:none/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-refract\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-refract\{[^}]*-webkit-backdrop-filter/u);
  // 3-4: the old assertion pinned a hidden SVG edge filter; pet bubbles hide the warp/rim,
  // so the generated-map filter could never be seen and should not stay in the CSS.
  assert.doesNotMatch(desktopPetSurfaceCss, /url\(#workhub-liquid-glass-pet-filter/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /(?:^|[;{])filter:url\(#workhub-liquid-glass/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /--wh-liquid-frost:(?:1[0-9]|[2-9][0-9])px/u);
  assert.match(desktopPetSurfaceCss, /\.wh-liquid-glass-warp\{[^}]*background:transparent[^}]*overflow:hidden/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-liquid-glass-warp\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-liquid-glass-warp\{[^}]*-webkit-backdrop-filter/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /--wh-liquid-opacity|opacity:var\(--wh-liquid-opacity/u);
  // R9 批次0-3：入场淡入是 apple 味必备微动画（M8/M11），恢复；同卡进度更新用 suppress 属性关掉重播。
  assert.match(desktopPetSurfaceCss, /@keyframes wh-pet-bubble-in\{from\{opacity:0\}to\{opacity:1\}\}/u);
  assert.match(desktopPetSurfaceCss, /data-pet-suppress-bubble-intro=true\] \.wh-pet-bubble\{animation:none\}/u);
  assert.match(desktopPetSurfaceCss, /\.wh-liquid-glass-edge--top\{left:0;right:0;top:0;height:var\(--wh-liquid-edge,12px\)/u);
  assert.match(desktopPetSurfaceCss, /\.wh-liquid-glass-edge--right\{top:0;right:0;bottom:0;width:var\(--wh-liquid-edge,12px\)/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /-webkit-mask-composite:xor|mask-composite:exclude/u);
  assert.match(desktopPetSurfaceCss, /\.wh-pet-bubble>\.wh-liquid-glass-content\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:8px/u);
  // 气泡是磨砂白底，正文走原本深色（kicker/message #667085、status/section #344054…），不再强制白字/黑描边。
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-pet-bubble>\.wh-liquid-glass-content\{[^}]*text-shadow/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /-webkit-text-stroke:\.16px rgba\(255,255,255,\.44\)/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-pet-bubble :is\([^)]+\.wh-pet-title[^}]+color:rgba\(255,255,255/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /-webkit-text-stroke:\.34px rgba\(0,0,0/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /wh-liquid-glass-tint|--wh-liquid-tint|mix-blend-mode/u);
  // 三种语气气泡各自的磨砂底回归（approval 暖白 / chat 白 / search 冰蓝）。
  // 气泡直接复用聚焦盒玻璃配方：语气不再改气泡底色或描边色（不再有暖奶油底/黄描边/蓝描边），只留圆点+表情色。
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-pet-bubble\[data-pet-bubble-tone=(?:approval|search|chat)\]\{[^}]*background/u);
  assert.doesNotMatch(desktopPetSurfaceCss, /\.wh-pet-bubble\[data-pet-bubble-tone=(?:approval|search|chat)\]\{[^}]*border-color/u);
  assert.doesNotMatch(
    desktopPetSurfaceCss,
    /\.(?:wh-pet-kind|wh-pet-priority|wh-pet-free-text|wh-pet-chip|wh-pet-action|wh-pet-reason)\{[^}]*backdrop-filter/u
  );
  assert.doesNotMatch(
    desktopPetSurfaceCss,
    /\.(?:wh-pet-kind|wh-pet-priority|wh-pet-free-text|wh-pet-chip|wh-pet-action|wh-pet-reason)\{[^}]*-webkit-backdrop-filter/u
  );
});

test("desktop pet runtime notices keep SSE retry cards transient and clear dismissed active cards", () => {
  const calls: Array<{
    cardId?: string | undefined;
    persist?: boolean | undefined;
  }> = [];
  const persistentCard = approvalCard();
  const sseStatusCard = {
    ...approvalCard(),
    id: "sse-status:global:retrying"
  };
  const setCard = (card: CuuCard | undefined, _message?: string, options?: { persist?: boolean }) => {
    calls.push({ cardId: card?.id, persist: options?.persist });
  };

  handleDesktopPetRuntimeNotice({ card: persistentCard, message: "ready", html: "<p>ready</p>" }, setCard);
  handleDesktopPetRuntimeNotice({ card: sseStatusCard, message: "retrying", html: "<p>retrying</p>" }, setCard);
  const cleared = handleDesktopPetRuntimeDecision({ reason: "dismissed_current", snapshot: {} }, setCard);
  const kept = handleDesktopPetRuntimeDecision(
    { reason: "dismissed_current", snapshot: { active_card: persistentCard } },
    setCard
  );

  // R9.7: the old assertion grepped pet-surface.ts for runtime-binding source text.
  // That was wrong because source text did not prove notice persistence or dismissed-card clearing behavior.
  assert.equal(desktopPetRuntimeRetryingDelayMs, 900);
  assert.equal(cleared, true);
  assert.equal(kept, false);
  assert.deepEqual(calls, [
    { cardId: "approval-card", persist: true },
    { cardId: "sse-status:global:retrying", persist: false },
    { cardId: undefined, persist: undefined }
  ]);
});

function approvalCard(): CuuCard {
  return {
    id: "approval-card",
    kind: "approval",
    state: "asking_approval",
    motion: cuuMotionForState("asking_approval"),
    title: "Cuu 等你审批",
    message: "点一个选项即可继续。",
    priority: "urgent",
    payload_ref: {
      entity_type: "workitem",
      entity_id: "10000000-0000-4000-8000-000000000101",
      href: "/workitems/10000000-0000-4000-8000-000000000101"
    },
    chips: [{ id: "file-only", label: "仅改文件", recommended: true }],
    sections: [
      { id: "changes", title: "这次改了什么", lines: ["更新周报草稿和验收清单", "新增 JSON 配置示例"] },
      { id: "risk", title: "风险与回滚", lines: ["低风险，可回滚", "不触碰生产部署"] }
    ],
    evidence_refs: [
      {
        id: "ev-weekly",
        source_type: "spec_doc",
        source_id: "doc-1",
        title: "上周周报",
        locator: { path: "docs/weekly.md" },
        confidence_hint: "found"
      },
      {
        id: "ev-config",
        source_type: "drive_file",
        source_id: "file-1",
        title: "配置样例",
        locator: { path: "config/sample.json" },
        confidence_hint: "found"
      }
    ],
    actions: [
      {
        id: "approve",
        label: "同意",
        tone: "primary",
        method: "POST",
        href: "/api/approvals/approval-1/respond"
      },
      {
        id: "request_changes",
        label: "打回",
        tone: "danger",
        method: "POST",
        href: "/api/approvals/approval-1/respond",
        requires_reason: true
      }
    ]
  };
}

function questionCard(): CuuCard {
  return {
    id: "question-card",
    kind: "question",
    state: "asking_approval",
    motion: cuuMotionForState("asking_approval"),
    title: "这次要按哪种口径整理？",
    message: "Cuu 推荐先走轻量方案。",
    priority: "high",
    chips: [
      { id: "minimal", label: "轻量方案", tone: "success", description: "只整理必要字段", recommended: true },
      { id: "complete", label: "完整方案", tone: "warning", description: "覆盖全部材料" }
    ],
    progress: [
      { key: "intent", label: "目标", state: "done", index: 0 },
      { key: "scope", label: "范围", state: "active", index: 1 },
      { key: "confirm", label: "确认", state: "pending", index: 2 }
    ],
    input: {
      mode: "single_choice",
      option_first: true,
      free_text_enabled: true,
      free_text_collapsed_by_default: true,
      free_text_placeholder: "补充一句即可",
      free_text_max_length: 120
    },
    actions: [
      {
        id: "submit_option",
        label: "确认选项",
        tone: "primary",
        method: "POST",
        href: "/api/sessions/session-1/next-question"
      }
    ],
    evidence_refs: [
      {
        id: "ev-intake",
        source_type: "spec_doc",
        source_id: "doc-2",
        title: "需求草稿",
        locator: { path: "docs/intake.md" },
        confidence_hint: "found"
      }
    ]
  };
}

function offlineCard(): CuuCard {
  return {
    id: "offline-card",
    kind: "offline",
    state: "offline",
    motion: cuuMotionForState("offline"),
    title: "Cuu 正在重连",
    message: "WorkHub 暂时连不上服务，Cuu 会继续尝试。",
    priority: "high",
    chips: [{ id: "retrying", label: "重连中", tone: "warning" }],
    actions: [{ id: "open_settings", label: "打开设置", tone: "secondary", href: "/settings" }]
  };
}

function completionCard(): CuuCard {
  return {
    id: "completion-card",
    kind: "completion",
    state: "celebrating",
    motion: cuuMotionForState("celebrating"),
    title: "这次执行完成了",
    message: "Cuu 已经完成本次执行。",
    priority: "normal",
    actions: [{ id: "view_replay", label: "查看回放", tone: "primary", method: "GET", href: "/agent-runs/run-1/replay" }]
  };
}

function petHarnessSession(stage: "scope" | "confirm"): SessionVM {
  const sessionId = "10000000-0000-4000-8000-000000000201";
  return {
    session_id: sessionId,
    work_item_id: sessionId,
    topic: `session:${sessionId}`,
    stream_href: `/api/push/stream/session/${sessionId}`,
    next_question_href: `/api/sessions/${sessionId}/next-question`,
    question: stage === "scope"
      ? {
          id: "10000000-0000-4000-8000-000000000211",
          session_id: sessionId,
          work_item_id: sessionId,
          title: "请确认 workhub-app-upload.txt 的验收口径",
          body: "AI 已读取需求和项目网盘文件，需要你确认最终按哪条验收标准输出三条要点。",
          input_mode: "long_text",
          options: [],
          free_text: {
            enabled: true,
            collapsed_by_default: false,
            placeholder: "例如：以 workhub-app-upload.txt 的 smoke 记录为依据，输出给验收同学。",
            max_length: 300
          },
          progress: [
            { key: "intent", label: "需求", state: "done" },
            { key: "scope", label: "澄清", state: "active" },
            { key: "confirm", label: "确认", state: "pending" },
            { key: "run", label: "执行", state: "pending" }
          ],
          submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
        }
      : {
          id: "10000000-0000-4000-8000-000000000212",
          session_id: sessionId,
          work_item_id: sessionId,
          title: "是否按这个方向创建事项？",
          body: "点确认后会进入可执行事项。",
          input_mode: "confirm",
          options: [
            {
              id: "create-workitem",
              label: "创建事项",
              description: "进入 AI 可施工状态。",
              icon: "check"
            },
            {
              id: "search-evidence-first",
              label: "先找证据",
              description: "先从项目资料里找依据。",
              icon: "search"
            }
          ],
          recommended_option_ids: ["create-workitem"],
          free_text: { enabled: true, collapsed_by_default: true, max_length: 300 },
          progress: [
            { key: "intent", label: "需求", state: "done" },
            { key: "scope", label: "口径", state: "done" },
            { key: "confirm", label: "确认", state: "active" },
            { key: "run", label: "执行", state: "pending" }
          ],
          submit: { method: "POST", href: `/api/sessions/${sessionId}/next-question` }
        }
  };
}

function petHarnessRun(): AgentRunLiveVM {
  const runId = "10000000-0000-4000-8000-000000000301";
  const workItemId = "10000000-0000-4000-8000-000000000201";
  return {
    run_id: runId,
    work_item_id: workItemId,
    title: "Cuu 桌面入口任务",
    status: "queued",
    run: {
      id: runId,
      work_item_id: workItemId,
      mode: "worker",
      actor: "AI",
      status: "queued",
      model: "deepseek-v4-flash",
      turns_used: 0,
      max_turns: 15,
      token_in: 0,
      token_out: 0,
      created_at: "2026-06-10T01:00:00.000Z",
      updated_at: "2026-06-10T01:00:00.000Z"
    },
    budget: {
      max_steps: 15,
      total_timeout_s: 300,
      max_tokens: 120000,
      max_cost_cny: "5.00"
    },
    budget_decision: {
      decision_id: "budget-pet-harness",
      allowed: true,
      model_route: {
        provider: "deepseek",
        model: "deepseek-v4-flash",
        reason: "pet runtime harness"
      }
    },
    usage: {
      steps_used: 0,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0.00"
    },
    trace: [],
    stream_href: `/api/push/stream/run/${runId}`,
    replay_href: `/api/agent-runs/${runId}/replay`
  };
}

function selectHarnessOption(card: CuuCard, optionId: string): CuuCard {
  return {
    ...card,
    chips: (card.chips ?? []).map((chip) => ({
      ...chip,
      selected: chip.id === optionId
    }))
  };
}

function resolveHarnessAction(card: CuuCard, actionId: string, freeText?: string) {
  const action = card.actions.find((candidate) => candidate.id === actionId);
  assert.ok(action?.href);
  const resolved = resolveDesktopCuuAction(action.href, { actionId: action.id, card, freeText });
  assert.ok(resolved);
  return resolved;
}

function cloneHarnessPayload<T>(payload: T): T {
  if (!payload || typeof payload !== "object") {
    return payload;
  }
  return JSON.parse(JSON.stringify(payload)) as T;
}

function createFakeLocalStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}

function createPetHarnessClient(calls: unknown[], run: AgentRunLiveVM = petHarnessRun()): DesktopPetSurfaceClient {
  return {
    async createSession(payload: unknown): Promise<SessionVM> {
      calls.push({ step: "createSession", payload: cloneHarnessPayload(payload) });
      return petHarnessSession("scope");
    },
    async getSession(sessionId: string): Promise<SessionVM> {
      calls.push({ step: "getSession", sessionId });
      return petHarnessSession("scope");
    },
    async nextQuestion(sessionId: string, payload: unknown): Promise<SessionVM> {
      calls.push({ step: "nextQuestion", sessionId, payload: cloneHarnessPayload(payload) });
      return petHarnessSession("confirm");
    },
    async createWorkItem(payload: unknown): Promise<WorkItemDetailVM> {
      calls.push({ step: "createWorkItem", payload: cloneHarnessPayload(payload) });
      return {
        workitem: {
          id: run.work_item_id,
          code: "WH-201",
          project_id: "10000000-0000-4000-8000-000000000002",
          submitter_user_id: "10000000-0000-4000-8000-000000000101",
          title: run.title,
          status: "ai_working",
          priority: "normal",
          sync_state: "pending",
          version: 1,
          mode: "worker",
          human_reserved: false,
          created_at: "2026-06-10T01:00:00.000Z",
          updated_at: "2026-06-10T01:00:00.000Z"
        },
        acceptance: [],
        agent_trace_preview: [],
        accepted_deliverables: [],
        evidence_refs: [],
        approval_decisions: [],
        actions: {}
      } as WorkItemDetailVM;
    },
    async startAgentRun(workItemId: string, payload: unknown): Promise<AgentRunLiveVM> {
      calls.push({ step: "startAgentRun", workItemId, payload: cloneHarnessPayload(payload) });
      return run;
    },
    async getAgentRun(runId?: string): Promise<AgentRunLiveVM> {
      calls.push({ step: "getAgentRun", runId });
      return run;
    },
    streamUrl(href: string) {
      return href;
    },
    async updatePreferences() {
      return {};
    },
    async respondApproval() {
      throw new Error("not needed");
    },
    async searchKnowledge() {
      throw new Error("not needed");
    },
    async useEvidenceForWorkItem() {
      throw new Error("not needed");
    },
    async mergeProposal() {
      throw new Error("not needed");
    }
  } as unknown as DesktopPetSurfaceClient;
}

class FakePetDomNode {}

class FakePetDomElement extends FakePetDomNode {
  readonly dataset: Record<string, string> = {};
  readonly style = {
    setProperty() {}
  };
  hidden = false;
  value = "";

  constructor(
    private readonly tagName: string,
    private readonly attributes: Record<string, string> = {},
    value = ""
  ) {
    super();
    this.value = value;
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith("data-")) {
        this.dataset[dataAttributeToDatasetKey(key)] = value;
      }
    }
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.matches(selector) ? this as unknown as T : null;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
    if (name.startsWith("data-")) {
      this.dataset[dataAttributeToDatasetKey(name)] = value;
    }
  }

  getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 260,
      bottom: 340,
      width: 260,
      height: 340,
      toJSON() {
        return {};
      }
    } as DOMRect;
  }

  private matches(selector: string) {
    if (selector === "a[href]") {
      return this.tagName.toLowerCase() === "a" && Boolean(this.attributes.href);
    }
    const attr = selector.match(/^\[([^=\]]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]$/u);
    if (!attr) {
      return false;
    }
    const name = attr[1];
    if (!name) {
      return false;
    }
    const expected = attr[2] ?? attr[3];
    if (!(name in this.attributes)) {
      return false;
    }
    return expected === undefined || this.attributes[name] === expected;
  }
}

type FakePetDomEvent = {
  readonly target: FakePetDomElement;
  defaultPrevented: boolean;
  preventDefault: () => void;
  // CHAT-10：键盘事件字段（Enter 发送用）；鼠标事件不填。
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
};

type FakePetDomListener = (event: FakePetDomEvent) => void | Promise<void>;

class FakePetDomRoot extends FakePetDomElement {
  innerHTML = "";
  petFreeTextValue = "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。";
  private readonly listeners = new Map<string, Set<FakePetDomListener>>();

  constructor() {
    super("div", { "data-wh-surface": "pet" });
  }

  addEventListener(type: string, listener: FakePetDomListener) {
    const listeners = this.listeners.get(type) ?? new Set<FakePetDomListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: FakePetDomListener) {
    this.listeners.get(type)?.delete(listener);
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    if (selector === "[data-wh-surface=pet]" && this.innerHTML.includes('data-wh-surface="pet"')) {
      return new FakePetDomElement("section", { "data-wh-surface": "pet" }) as unknown as T;
    }
    if (selector === "[data-pet-settings-menu]" && this.innerHTML.includes('data-pet-settings-menu="true"')) {
      return new FakePetDomElement("nav", { "data-pet-settings-menu": "true" }) as unknown as T;
    }
    if (selector === "[data-pet-free-text]" && this.innerHTML.includes('data-pet-free-text="true"')) {
      return new FakePetDomElement("textarea", { "data-pet-free-text": "true" }, this.petFreeTextValue) as unknown as T;
    }
    // CHAT-10：Enter 发送会查卡片的主提交锚点并 click() 它。从 innerHTML 里抠出真实 href 造成元素，
    // click() 转发回根节点的点击管线（与真实 DOM 的事件冒泡一致）。
    if (selector === '[data-cuu-action-id="submit_option"], [data-cuu-action-id="start_agent_from_cuu"]') {
      for (const actionId of ["submit_option", "start_agent_from_cuu"]) {
        const href = new RegExp(`href="([^"]+)"[^>]*data-cuu-action-id="${actionId}"`, "u").exec(this.innerHTML)?.[1];
        if (href) {
          const anchor = new FakePetDomElement("a", { href, "data-cuu-action-id": actionId }) as FakePetDomElement & {
            click: () => void;
          };
          anchor.click = () => {
            void this.click(anchor);
          };
          return anchor as unknown as T;
        }
      }
    }
    return null;
  }

  contains(node: Node | null) {
    return node instanceof FakePetDomNode;
  }

  async click(target: FakePetDomElement) {
    const event: FakePetDomEvent = {
      target,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      }
    };
    for (const listener of this.listeners.get("click") ?? []) {
      await listener(event);
    }
    return event;
  }

  // CHAT-09：click 之外的通用事件分发（自由文本框的 input 事件、CHAT-10 的 keydown 用它驱动）。
  async emit(type: string, target: FakePetDomElement, extra: Partial<FakePetDomEvent> = {}) {
    const event: FakePetDomEvent = {
      target,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      ...extra
    };
    for (const listener of this.listeners.get(type) ?? []) {
      await listener(event);
    }
    return event;
  }
}

function dataAttributeToDatasetKey(attributeName: string) {
  return attributeName.slice("data-".length).replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

function fakePetTarget(attributes: Record<string, string>, tagName = "button") {
  return new FakePetDomElement(tagName, attributes);
}

async function waitForFakePetCardMode() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 90);
  });
}

async function completePetBootAgentRunFlow(root: FakePetDomRoot) {
  await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
  await root.click(fakePetTarget({
    href: "/api/cuu/start-agent",
    "data-cuu-action-id": "start_agent_from_cuu"
  }, "a"));
  root.petFreeTextValue = "以 workhub-app-upload.txt 的 smoke 记录作为验收口径。";
  await root.click(fakePetTarget({
    href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
    "data-cuu-action-id": "submit_option"
  }, "a"));
  await root.click(fakePetTarget({ "data-pet-option-id": "create-workitem" }));
  await root.click(fakePetTarget({
    href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
    "data-cuu-action-id": "submit_option"
  }, "a"));
}

async function withFakePetDom(callback: (root: FakePetDomRoot) => Promise<void>) {
  const target = globalThis as Record<string, unknown>;
  const previousNode = target["Node"];
  const previousElement = target["Element"];
  const previousWindow = target["window"];
  const root = new FakePetDomRoot();
  let nextTimerId = 1;
  target["Node"] = FakePetDomNode;
  target["Element"] = FakePetDomElement;
  target["window"] = {
    setInterval() {
      nextTimerId += 1;
      return nextTimerId;
    },
    clearInterval() {}
  };
  try {
    await callback(root);
  } finally {
    if (previousNode === undefined) {
      delete target["Node"];
    } else {
      target["Node"] = previousNode;
    }
    if (previousElement === undefined) {
      delete target["Element"];
    } else {
      target["Element"] = previousElement;
    }
    if (previousWindow === undefined) {
      delete target["window"];
    } else {
      target["window"] = previousWindow;
    }
  }
}

test("desktop surface resolver sends Tauri pet routes to the pet surface", () => {
  assert.equal(resolveDesktopSurface({ pathname: "/pet", search: "" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/index.html", search: "", hash: "#surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=main" }), "main");
});

test("pet first-paint scheduler waits for two animation frames before showing the window", () => {
  const calls: string[] = [];
  const rafCallbacks: FrameRequestCallback[] = [];
  const timeoutCallbacks: Array<() => void> = [];
  const cancel = scheduleDesktopPetFirstPaint(() => calls.push("ready"), {
    requestAnimationFrame(callback) {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    setTimeout(callback) {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    },
    clearTimeout() {}
  });

  rafCallbacks.shift()?.(0);
  assert.deepEqual(calls, []);
  rafCallbacks.shift()?.(16);
  assert.deepEqual(calls, ["ready"]);
  timeoutCallbacks.shift()?.();
  assert.deepEqual(calls, ["ready"]);
  cancel();
});

test("pet surface renders only the Live2D cat runtime without main shell or fallback sprites", () => {
  const idle = renderDesktopPetSurface({ idle_action: "idle_tail_sway", locale: "zh-CN" });
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true,
    locale: "zh-CN"
  });
  const statusOnly = renderDesktopPetSurface({
    status_text: "Cuu look updated.",
    locale: "en-US"
  });

  assert.equal(idle.visual_mode, "live2d_cat");
  assert.equal(idle.live2d.runtime_kind, "live2d_cubism2_cat");
  assert.equal(idle.live2d.status, "approved_cat_option");
  assert.equal(idle.live2d.model_key, "hijiki");
  assert.equal(idle.live2d.appearance, "black_cat");
  assert.equal(idle.live2d.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(idle.live2d.model_pack_selection_reason, "registry_default");
  assert.equal(idle.live2d.motion_state, "idle_tail_sway");
  assert.match(idle.html, /data-wh-surface="pet"/u);
  assert.match(idle.html, /data-pet-window-mode="body_only"/u);
  assert.match(idle.html, /data-pet-window-width="260"/u);
  assert.match(idle.html, /data-pet-window-height="340"/u);
  assert.match(idle.html, /data-cuu-visual-mode="live2d_cat"/u);
  assert.match(idle.html, /data-cuu-live2d-runtime="live2d_cubism2_cat"/u);
  assert.match(idle.html, /data-cuu-live2d-framing="transparent_full_body"/u);
  assert.match(idle.html, /data-cuu-live2d-model="hijiki"/u);
  assert.match(idle.html, /data-cuu-live2d-appearance="black_cat"/u);
  assert.match(idle.html, /data-cuu-behavior-manifest-version="1"/u);
  assert.match(idle.html, /data-cuu-behavior-state="idle"/u);
  assert.match(idle.html, /data-cuu-behavior-phase="idle_random"/u);
  assert.match(idle.html, /data-cuu-behavior-expected-window-mode="body_only"/u);
  assert.match(idle.html, /data-cuu-live2d-renderer-state="mtn\/00_idle\.mtn"/u);
  assert.match(idle.html, /class="wh-pet-menu"[^>]*data-pet-settings-menu="true"[^>]*hidden/u);
  assert.match(idle.html, /data-pet-menu-model="cuu-hijiki-live2d-cubism2" aria-pressed="true"/u);
  assert.match(idle.html, /data-pet-menu-model="cuu-tororo-live2d-cubism2" aria-pressed="false"/u);
  assert.match(idle.html, /data-pet-menu-locale="zh-CN" aria-pressed="true"/u);
  assert.match(idle.html, /data-pet-menu-open-settings="true"/u);
  assert.doesNotMatch(idle.html, /data-pet-menu-pass-through/u);
  assert.match(idle.css, /:root\{--wh-pet-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","PingFang SC","Noto Sans CJK SC",Arial,sans-serif;--wh-pet-accent:#0a84ff/u);
  assert.doesNotMatch(idle.css, /Aptos|Segoe UI/u);
  assert.match(idle.css, /\.wh-pet-bubble\{[^}]*border-radius:24px;[^}]*background:linear-gradient\(135deg,rgba\(255,255,255,\.82\),rgba\(255,255,255,\.52\)\)/u);
  assert.doesNotMatch(idle.css, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-refract\{[^}]*backdrop-filter/u);
  assert.doesNotMatch(idle.css, /\.wh-liquid-glass-warp--pet \.wh-liquid-glass-refract\{[^}]*-webkit-backdrop-filter/u);
  // 3-4: same as the static CSS assertion above; hidden pet warp should not keep SVG filters alive.
  assert.doesNotMatch(idle.css, /url\(#workhub-liquid-glass-pet-filter/u);
  assert.doesNotMatch(idle.css, /(?:^|[;{])filter:url\(#workhub-liquid-glass/u);
  assert.match(idle.css, /\.wh-pet-menu\{[^}]*right:88px;[^}]*width:164px;[^}]*overflow:hidden/u);
  assert.match(idle.css, /\.wh-pet-menu\{[^}]*border-radius:14px;[^}]*background:rgba\(255,255,255,\.92\);[^}]*backdrop-filter:blur\(30px\) saturate\(180%\)/u);
  assert.match(idle.css, /\.wh-pet-menu-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(idle.css, /\.wh-pet-menu button\{[^}]*min-width:0;max-width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(idle.css, /\.wh-pet-menu button\{[^}]*border-radius:10px;[^}]*font:760 11px\/1\.15 var\(--wh-pet-font\)/u);
  assert.match(idle.css, /\.wh-pet-menu-row button\{[^}]*flex:1 1 0;[^}]*padding-left:6px;padding-right:6px;[^}]*overflow:hidden;text-overflow:ellipsis/u);
  assert.match(idle.html, /class="wh-cuu-cat-live2d-frame"/u);
  assert.match(idle.html, /cuu\/live2d\/hijiki\/cuu-hijiki\.html/u);
  // R8 穿透修复：命中区收成猫身轮廓(inset:22% 18% 0 18%)，body 本身 pointer-events:none，四周透明区可穿透。
  assert.match(idle.css, /\.wh-pet-body::after\{content:"";position:absolute;inset:22% 18% 0 18%;z-index:3[^}]*pointer-events:auto/u);
  assert.match(idle.css, /\.wh-pet-body\{[^}]*pointer-events:none/u);
  assert.match(idle.css, /\.wh-cuu-cat-live2d-frame\{[^}]*pointer-events:none/u);
  // R7.1 桌宠穿透契约：气泡容器穿透(none)，惟真可点子元素 auto —— 浅蓝空白处可点穿到下方窗口。
  assert.match(idle.css, /\.wh-pet-bubble\{[^}]*pointer-events:none/u);
  assert.match(idle.css, /\.wh-pet-bubble button,\.wh-pet-bubble a\[data-cuu-action-id\],\.wh-pet-bubble \[data-pet-option-id\],\.wh-pet-bubble \[data-pet-reason\],\.wh-pet-bubble \[data-pet-free-text\]\{pointer-events:auto\}/u);
  assert.doesNotMatch(idle.html, /wh-cuu-legacy|wh-cuu-atlas|wh-cuu-sprite|experimental_draft_probe/u);
  assert.doesNotMatch(idle.html, /data-cuu-fallback-visual-mode|data-cuu-image-motion/u);
  assert.doesNotMatch(idle.html, /wh-app-shell/u);
  assert.doesNotMatch(idle.html, /textarea|<input\b/iu);

  assert.match(statusOnly.html, /data-pet-window-mode="body_only"/u);
  assert.match(statusOnly.html, /data-pet-card-layout="compact"/u);
  assert.match(statusOnly.html, /data-pet-bubble-transient="true"/u);
  assert.match(statusOnly.html, /wh-liquid-glass-warp wh-liquid-glass-warp--pet/u);
  assert.match(statusOnly.html, /wh-liquid-glass-edge wh-liquid-glass-edge--top/u);
  assert.match(statusOnly.html, /wh-liquid-glass-edge wh-liquid-glass-edge--right/u);
  assert.match(statusOnly.html, /class="wh-liquid-glass-content"/u);
  assert.match(statusOnly.html, /<p class="wh-pet-status">Cuu look updated\.<\/p>/u);
  assert.match(statusOnly.css, /data-pet-card-layout=compact\] \.wh-pet-bubble\{left:auto;right:calc\(8px \* var\(--wh-pet-scale,1\)\);top:auto;bottom:calc\(224px \* var\(--wh-pet-scale,1\)\);width:calc\(150px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(statusOnly.css, /data-pet-card-layout=compact\] \.wh-pet-status\{line-height:1\.25;display:-webkit-box;-webkit-line-clamp:2/u);

  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-pet-payload-ref-entity-type="workitem"/u);
  assert.match(card.html, /data-pet-payload-ref-entity-id="10000000-0000-4000-8000-000000000101"/u);
  assert.match(card.html, /data-pet-window-mode="card"/u);
  assert.match(card.html, /data-pet-card-kind="approval"/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{left:calc\(88px \* var\(--wh-pet-scale,1\)\);right:auto;top:auto;bottom:calc\(392px \* var\(--wh-pet-scale,1\)\);width:calc\(300px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-body\{right:calc\(72px \* var\(--wh-pet-scale,1\)\);bottom:calc\(48px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{[^}]*max-width:calc\(100% - calc\(128px \* var\(--wh-pet-scale,1\)\)\)/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-bubble\[data-pet-bubble-kind=bubble\],\.wh-pet-surface\[data-pet-window-mode=card\] \.wh-pet-bubble\[data-pet-bubble-kind=offline\],\.wh-pet-surface\[data-pet-window-mode=card\] \.wh-pet-bubble\[data-pet-bubble-kind=trace\]\{min-height:calc\(268px \* var\(--wh-pet-scale,1\)\)/u);
  // R9.7 real-user smoke: the old 372px assertion was wrong because Chrome/CDP measured only
  // 2.04px between the context bubble and Live2D body, failing `bubble_clear_of_live2d`.
  assert.match(card.css, /data-pet-window-mode=card\]\[data-pet-card-has-context=true\] \.wh-pet-bubble\{left:calc\(72px \* var\(--wh-pet-scale,1\)\);right:auto;bottom:calc\(380px \* var\(--wh-pet-scale,1\)\);width:calc\(328px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*min-height:0;max-height:calc\(336px \* var\(--wh-pet-scale,1\)\);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*pointer-events:auto/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*gap:6px;padding:10px 12px/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-title\{[^}]*-webkit-line-clamp:2;[^}]*font-size:13px/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-message\{[^}]*-webkit-line-clamp:2;[^}]*font-size:11px/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-section-line,\.wh-pet-surface\[data-pet-card-has-context=true\] \.wh-pet-evidence-item\{-webkit-line-clamp:1\}/u);
  assert.match(card.css, /\.wh-pet-bubble>\.wh-liquid-glass-content\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:8px/u);
  assert.match(card.css, /\.wh-pet-bubble \.wh-liquid-glass-content>\*\{min-width:0;max-width:100%\}/u);
  assert.match(card.css, /\.wh-pet-menu button\{[^}]*background:rgba\(255,255,255,\.72\)/u);
  assert.match(card.css, /\.wh-pet-progress\{[^}]*min-width:0;max-width:100%;width:100%/u);
  assert.match(card.css, /\.wh-pet-progress-label\{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/u);
  assert.match(card.css, /\.wh-pet-section-title,\.wh-pet-evidence-title,\.wh-pet-input-hint\{[^}]*width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(card.css, /\.wh-pet-chips,\.wh-pet-actions,\.wh-pet-reasons\{[^}]*min-width:0;max-width:100%;width:100%/u);
  assert.match(card.css, /\.wh-pet-chip,\.wh-pet-action,\.wh-pet-reason\{[^}]*max-width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(card.css, /\.wh-pet-chip,\.wh-pet-action,\.wh-pet-reason\{[^}]*display:inline-flex;align-items:center;justify-content:center;min-height:28px/u);
  assert.match(card.css, /\.wh-pet-action\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/u);
  assert.match(card.html, /data-cuu-behavior-state="asking_approval"/u);
  assert.match(card.html, /data-cuu-behavior-phase="loop"/u);
  assert.match(card.html, /data-cuu-behavior-expected-window-mode="card"/u);
  assert.match(card.html, /data-cuu-behavior-expected-bubble-mode="card"/u);
  assert.match(card.html, /data-cuu-live2d-motion="asking_approval_bounce"/u);
  assert.match(card.html, /data-cuu-live2d-renderer-state="mtn\/01\.mtn"/u);
  assert.match(card.html, /data-pet-card-has-context="true"/u);
  assert.match(card.html, /class="wh-pet-kind">审批/u);
  // R6.P3：5 情绪 + 3 气泡。asking_approval → emotion=approval, tone=approval(cream)，带颜文字标签。
  assert.match(card.html, /data-pet-bubble-emotion="approval"/u);
  assert.match(card.html, /data-pet-bubble-tone="approval"/u);
  assert.match(card.html, /class="wh-pet-emotion">等你拍板/u);
  assert.doesNotMatch(card.css, /\.wh-pet-bubble\[data-pet-bubble-tone=(?:approval|search)\]\{[^}]*border-color/u);
  assert.match(card.html, /data-pet-section-id="changes"/u);
  assert.match(card.html, /data-pet-evidence-count="2"/u);
  assert.match(card.html, /data-recommended="true"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.html, /data-cuu-action-id="request_changes"/u);
  assert.match(card.html, /data-pet-reason="证据不足"/u);
});

test("pet surface keeps the failed agent-run card inside the expanded Cuu frame", () => {
  const failedRun: AgentRunLiveVM = {
    ...petHarnessRun(),
    status: "failed",
    run: {
      ...petHarnessRun().run,
      status: "failed",
      handoff_md: "Cuu R3 run-failure QA forced provider failure."
    },
    usage: {
      steps_used: 1,
      token_in: 0,
      token_out: 0,
      estimated_cost_cny: "0.00"
    },
    trace: [
      {
        id: "10000000-0000-4000-8000-000000000302",
        agent_run_id: "10000000-0000-4000-8000-000000000301",
        step_no: 1,
        phase: "final",
        input_json: {},
        output_excerpt: "Cuu R3 run-failure QA forced provider failure.",
        created_at: "2026-06-10T01:01:00.000Z"
      }
    ]
  };
  const card = cardFromAgentRunLive(failedRun, { locale: "en-US" });
  const surface = renderDesktopPetSurface({
    card,
    status_text: "Cuu updated progress: Cuu desktop entry task",
    locale: "en-US"
  });

  assert.match(surface.html, /data-pet-window-mode="card"/u);
  assert.match(surface.html, /data-pet-window-height="720"/u);
  assert.match(surface.html, /data-pet-card-has-context="true"/u);
  assert.match(surface.html, /class="wh-pet-title">This run needs attention<\/strong>/u);
  assert.match(surface.html, /class="wh-pet-section-title">Run progress<\/span>/u);
  assert.match(surface.html, /class="wh-pet-section-title">Budget<\/span>/u);
  assert.match(surface.html, /data-cuu-action-id="view_replay"/u);
  assert.match(surface.html, /data-cuu-action-id="open_workitem"/u);
  // WIRE-07：终态（failed）run 不出中止按钮——中止只对进行中的 run 有意义。
  assert.doesNotMatch(surface.html, /data-cuu-action-id="abort_agent_run"/u);
  assert.doesNotMatch(surface.html, /Cuu updated progress: Cuu desktop entry task/u);
  assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{[^}]*bottom:calc\(392px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-body\{[^}]*bottom:calc\(48px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*max-height:calc\(336px \* var\(--wh-pet-scale,1\)\);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-title\{[^}]*-webkit-line-clamp:2/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-message\{[^}]*-webkit-line-clamp:2/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-section-line,\.wh-pet-surface\[data-pet-card-has-context=true\] \.wh-pet-evidence-item\{-webkit-line-clamp:1\}/u);
});

// WIRE-07：进行中（queued/running）的 run 卡必须真的端出「取消执行」按钮，且点击能解析成
// abort-agent-run 动作（两段式确认在点击层，submit 走 client.abortAgentRun）。
test("pet surface offers a wired abort action on an active agent-run card", () => {
  const activeRun = petHarnessRun();
  assert.equal(activeRun.status, "queued");
  const card = cardFromAgentRunLive(activeRun, { locale: "zh-CN" });
  const surface = renderDesktopPetSurface({
    card,
    status_text: "Cuu 正在推进：桌面入口任务",
    locale: "zh-CN"
  });

  assert.match(surface.html, /data-cuu-action-id="abort_agent_run"/u);
  assert.match(surface.html, /href="\/api\/agent-runs\/10000000-0000-4000-8000-000000000301\/abort"/u);
  assert.match(surface.html, /data-method="POST"/u);
  assert.match(surface.html, /取消执行/u);

  const resolved = resolveHarnessAction(card, "abort_agent_run");
  assert.deepEqual(resolved, { kind: "abort-agent-run", runId: "10000000-0000-4000-8000-000000000301" });
});

test("pet surface constrains long runtime error cards in the expanded Cuu frame", () => {
  const run = petHarnessRun();
  const longStatus = `Cuu updated progress: ${"LongProviderDiagnosticWithoutNaturalBreaks".repeat(12)}`;
  const cards = [
    cardFromDesktopCuuRuntimeError(new WorkHubApiError(403, "forbidden", "No permission."), { locale: "en-US", run }),
    cardFromDesktopCuuRuntimeError(new WorkHubApiError(502, "provider_failed", "Provider failed."), { locale: "en-US", run }),
    cardFromDesktopCuuRuntimeError(new WorkHubApiError(503, "network_unavailable", "Network unavailable."), { locale: "en-US", run })
  ];

  for (const card of cards) {
    const surface = renderDesktopPetSurface({
      card,
      status_text: longStatus,
      locale: "en-US"
    });

    assert.match(surface.html, /data-pet-window-mode="card"/u);
    assert.match(surface.html, /data-pet-window-height="720"/u);
    assert.match(surface.html, /data-pet-card-has-context="false"/u);
    assert.match(surface.html, /data-pet-bubble-kind="(?:bubble|offline)"/u);
    assert.match(surface.html, /data-cuu-action-id="view_replay"/u);
    assert.match(surface.html, /data-cuu-action-id="open_workitem"/u);
    assert.match(surface.html, /LongProviderDiagnosticWithoutNaturalBreaks/u);
    assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{[^}]*max-height:calc\(268px \* var\(--wh-pet-scale,1\)\);overflow:hidden/u);
    assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-title\{[^}]*-webkit-line-clamp:3;[^}]*overflow:hidden/u);
    assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-message\{[^}]*-webkit-line-clamp:5;[^}]*overflow:hidden/u);
    assert.match(surface.css, /\.wh-pet-status\{[^}]*max-width:100%;width:100%;[^}]*overflow-wrap:anywhere;word-break:break-word/u);
    assert.match(surface.css, /\.wh-pet-chip,\.wh-pet-action,\.wh-pet-reason\{[^}]*max-width:100%;[^}]*overflow-wrap:anywhere;word-break:break-word/u);
  }
});

test("pet surface selects the white Live2D cat option and rejects old model packs", () => {
  const white = renderDesktopPetSurface({
    idle_action: "idle_tail_sway",
    requested_model_pack_id: "cuu-tororo-live2d-cubism2"
  });
  const legacyRequest = renderDesktopPetSurface({
    idle_action: "idle_tail_sway",
    requested_model_pack_id: "legacy-cuu-pack"
  });

  assert.equal(white.live2d.model_pack_id, "cuu-tororo-live2d-cubism2");
  assert.equal(white.live2d.model_pack_selection_reason, "requested_default_ready");
  assert.equal(white.live2d.model_key, "tororo");
  assert.equal(white.live2d.appearance, "white_cat");
  assert.match(white.html, /data-cuu-live2d-model="tororo"/u);
  assert.match(white.html, /data-cuu-live2d-appearance="white_cat"/u);
  assert.match(white.html, /cuu\/live2d\/tororo\/cuu-tororo\.html/u);

  assert.equal(legacyRequest.live2d.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(legacyRequest.live2d.model_pack_selection_reason, "unknown_requested_pack");
  assert.doesNotMatch(legacyRequest.html, /wh-cuu-legacy/u);
});

test("pet surface exposes input-reactive pointer state for Live2D cat QA", () => {
  assert.deepEqual(defaultDesktopPetPointerSnapshot(), {
    cursor_near: false,
    hovered: false,
    dragging: false,
    look_x: 0,
    look_y: 0,
    avoidance_x: 0,
    avoidance_y: 0,
    hover_avoidance: "none"
  });

  const surface = renderDesktopPetSurface({
    idle_action: "look_at_mouse",
    pointer_snapshot: {
      cursor_near: true,
      hovered: true,
      dragging: true,
      look_x: 0.42,
      look_y: -0.18,
      avoidance_x: 0,
      avoidance_y: 0,
      hover_avoidance: "none",
      last_pointer_ms: 1234
    }
  });

  assert.match(surface.html, /data-pet-cursor-near="true"/u);
  assert.match(surface.html, /data-pet-hovered="true"/u);
  assert.match(surface.html, /data-pet-dragging="true"/u);
  assert.match(surface.html, /data-pet-look-x="0\.42"/u);
  assert.match(surface.html, /data-pet-look-y="-0\.18"/u);
  assert.match(surface.html, /data-pet-pointer-smoothing-alpha="0\.58"/u);
  assert.match(surface.html, /--wh-pet-look-head-x-px:3\.78px/u);
  assert.match(surface.html, /data-cuu-live2d-state="look_at_mouse"/u);
  assert.match(surface.html, /data-cuu-behavior-state="idle"/u);
  assert.match(surface.html, /data-cuu-behavior-phase="idle_random"/u);
  assert.match(surface.css, /data-pet-cursor-near=true.*?\.wh-cuu-cat-live2d/u);
  assert.doesNotMatch(surface.css, /data-pet-cursor-near=true\]\s+\.wh-cuu-cat-live2d\{transform:/u);
  assert.match(surface.css, /data-pet-dragging=true.*?cursor:grabbing/u);
});

test("pet pointer helpers normalize Rust look percent and hover avoidance", () => {
  const sampled = desktopPetPointerSnapshotFromSample(
    { pointer: { cursor_near: true, look_x_percent: 43, look_y_percent: -25 } },
    defaultDesktopPetPointerSnapshot()
  );

  assert.equal(sampled.look_x, 0.43);
  assert.equal(sampled.look_y, -0.25);

  const root = {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 100 };
    }
  } as HTMLElement;
  const hovered = normalizeDesktopPetPointerSnapshot({
    ...sampled,
    ...pointerPatchFromEvent(root, { clientX: 180, clientY: 20 } as PointerEvent, { cursor_near: true })
  });

  assert.equal(hovered.look_x, 0.8);
  assert.equal(hovered.look_y, -0.6);
  assert.equal(hovered.hover_avoidance, "soft");
  assert.ok(hovered.avoidance_x < 0);
  assert.ok(hovered.avoidance_y > 0);
});

test("pet surface renders clarification cards as option-first light cards", () => {
  const card = renderDesktopPetSurface({ card: questionCard(), locale: "zh-CN" });
  const english = renderDesktopPetSurface({ card: questionCard(), locale: "en-US" });

  assert.match(card.html, /data-pet-card-kind="question"/u);
  assert.match(card.html, /class="wh-pet-kind">澄清/u);
  assert.match(card.html, /class="wh-pet-progress"/u);
  assert.match(card.html, /data-pet-option-id="minimal"/u);
  assert.match(card.html, /type="button" aria-pressed="false"/u);
  assert.match(card.html, /data-pet-option-first="true"/u);
  assert.match(card.html, /点选项即可，补充文字已折叠/u);
  assert.match(card.html, /data-cuu-action-id="submit_option"/u);
  assert.doesNotMatch(card.html, /textarea|<input\b/iu);

  assert.match(english.html, /class="wh-pet-kind">Clarify/u);
  assert.match(english.html, /Choose an option; text is folded away/u);
  assert.match(english.html, /aria-label="Cuu desktop pet"/u);
});

test("pet surface keeps the primary confirmation action visible after an option is selected", () => {
  const selected = renderDesktopPetSurface({
    card: selectHarnessOption(questionCard(), "minimal"),
    locale: "zh-CN"
  });
  const actionIndex = selected.html.indexOf('class="wh-pet-actions"');
  const chipsIndex = selected.html.indexOf('class="wh-pet-chips"');

  assert.notEqual(actionIndex, -1);
  assert.notEqual(chipsIndex, -1);
  assert.ok(actionIndex < chipsIndex, "selected question cards show Confirm before the option stack");
});

test("pet surface removes duplicate proposal summaries and keeps the proposal action clickable", () => {
  const summary = "变更摘要 本次 AgentRun 从 outputs/ 生成 1 个交付物变更草案：文本稿 1。";
  const card = cardFromAttentionItem({
    id: "proposal-event-runtime",
    kind: "proposal_review",
    priority: "normal",
    work_item_id: "10000000-0000-4000-8000-000000000201",
    source_ref: { entity_type: "proposal", entity_id: "proposal-1" },
    title: `AI 已生成变更申请：${summary}`,
    summary_text: `AI 已生成变更申请：${summary}`,
    actions: [
      { id: "open_proposal", label: "查看", style: "secondary", method: "GET", href: "/proposals/proposal-1" }
    ],
    cuu_state: "carrying_document",
    created_at: "2026-06-10T01:00:00.000Z"
  });

  const surface = renderDesktopPetSurface({ card, locale: "zh-CN" });

  assert.match(surface.html, /Cuu 等你确认变更/u);
  assert.match(surface.html, /data-cuu-action-id="open_proposal"/u);
  assert.match(surface.html, /href="\/proposals\/proposal-1"/u);
  assert.match(surface.html, />查看变更申请<\/a>/u);
  assert.match(surface.html, /data-pet-section-id="next_step"/u);
  assert.match(surface.html, /点「查看变更申请」会打开变更详情，里面有总结、改动和确认按钮/u);
  assert.equal((surface.html.match(/变更摘要 本次 AgentRun/g) ?? []).length, 1);
  assert.ok(
    surface.html.indexOf('data-pet-section-id="next_step"') < surface.html.indexOf('data-cuu-action-id="open_proposal"'),
    "proposal cards explain the next step before showing the open action"
  );
});

test("pet surface renders the Cuu outbound agent launcher as text-first without preset choices", () => {
  const launcher = renderDesktopPetSurface({ card: createDesktopCuuAgentLauncherCard(), locale: "zh-CN" });
  const english = renderDesktopPetSurface({ card: createDesktopCuuAgentLauncherCard({ locale: "en-US" }), locale: "en-US" });

  assert.match(launcher.html, /data-cuu-card-id="cuu-agent-launcher"/u);
  assert.match(launcher.html, /要让 Cuu 做什么/u);
  assert.match(launcher.html, /data-pet-free-text/u);
  assert.match(launcher.html, /data-cuu-action-id="start_agent_from_cuu"/u);
  assert.match(launcher.html, /href="\/api\/cuu\/start-agent"/u);
  assert.match(launcher.html, /data-pet-input-mode="long_text"/u);
  assert.doesNotMatch(launcher.html, /data-pet-option-id="document-draft"/u);

  assert.match(english.html, /What should Cuu do/u);
  assert.match(english.html, /Start work/u);
  assert.match(english.html, /data-pet-free-text/u);
});

test("pet surface renders the Cuu outbound agent launcher as a free-text demand composer", () => {
  const launcher = renderDesktopPetSurface({ card: createDesktopCuuAgentLauncherCard(), locale: "zh-CN" });
  const english = renderDesktopPetSurface({ card: createDesktopCuuAgentLauncherCard({ locale: "en-US" }), locale: "en-US" });

  assert.match(launcher.html, /data-cuu-card-id="cuu-agent-launcher"/u);
  assert.match(launcher.html, /data-pet-free-text/u);
  assert.match(launcher.html, /data-pet-input-mode="long_text"/u);
  assert.match(launcher.html, /data-pet-option-first="false"/u);
  assert.doesNotMatch(launcher.html, /data-pet-option-id="document-draft"/u);
  assert.doesNotMatch(launcher.html, /先点一个交付方向/u);

  assert.match(english.html, /data-pet-free-text/u);
  assert.doesNotMatch(english.html, /Pick one delivery direction/u);
});

test("pet runtime harness advances launcher selections through clarification into a run card", async () => {
  const calls: unknown[] = [];
  const run = petHarnessRun();
  const client = createPetHarnessClient(calls, run);

  let card = createDesktopCuuAgentLauncherCard({ locale: "zh-CN" });
  let surface = renderDesktopPetSurface({ card, locale: "zh-CN" });
  const demand = "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。";
  const clarification = "以 workhub-app-upload.txt 的 smoke 记录作为验收口径。";
  assert.match(surface.html, /data-cuu-card-id="cuu-agent-launcher"/u);
  assert.match(surface.html, /data-pet-free-text/u);
  assert.match(surface.html, /data-cuu-action-id="start_agent_from_cuu"/u);
  assert.doesNotMatch(surface.html, /data-pet-option-id="document-draft"/u);

  const launcherResult = await submitDesktopCuuAction({
    client,
    action: resolveHarnessAction(card, "start_agent_from_cuu", demand),
    locale: "zh-CN"
  });
  assert.match(launcherResult.message, /还需要你补充/u);
  assert.equal(launcherResult.card?.payload_ref?.entity_type, "session");
  assert.equal(launcherResult.agentRun, undefined);
  card = launcherResult.card!;
  surface = renderDesktopPetSurface({ card, status_text: launcherResult.message, locale: "zh-CN" });
  assert.match(surface.html, /data-pet-bubble-kind="question"/u);
  assert.match(surface.html, /data-pet-free-text/u);
  assert.match(surface.html, /workhub-app-upload\.txt/u);

  const clarificationResult = await submitDesktopCuuAction({
    client,
    action: resolveHarnessAction(card, "submit_option", clarification),
    locale: "zh-CN"
  });
  card = clarificationResult.card!;
  surface = renderDesktopPetSurface({ card, status_text: clarificationResult.message, locale: "zh-CN" });
  assert.match(surface.html, /data-pet-option-id="create-workitem"/u);
  assert.match(surface.html, /是否按这个方向创建事项/u);

  card = selectHarnessOption(card, "create-workitem");
  const runResult = await submitDesktopCuuAction({
    client,
    action: resolveHarnessAction(card, "submit_option"),
    locale: "zh-CN"
  });
  assert.equal(runResult.agentRun?.run_id, run.run_id);
  assert.equal(runResult.card?.payload_ref?.entity_type, "agent_run");
  surface = renderDesktopPetSurface({ card: runResult.card, status_text: runResult.message, locale: "zh-CN" });
  assert.match(surface.html, /data-cuu-card-id="10000000-0000-4000-8000-000000000301"/u);
  assert.match(surface.html, /data-pet-bubble-kind="trace"/u);
  assert.match(surface.html, /data-cuu-state="thinking"/u);
  assert.match(surface.html, /data-cuu-action-id="view_replay"/u);

  assert.deepEqual(calls, [
    {
      step: "createSession",
      payload: {
        title: demand,
        intent_text: demand
      }
    },
    {
      step: "nextQuestion",
      sessionId: "10000000-0000-4000-8000-000000000201",
      payload: { free_text: clarification }
    },
    {
      step: "nextQuestion",
      sessionId: "10000000-0000-4000-8000-000000000201",
      payload: { selected_option_ids: ["create-workitem"] }
    },
    {
      step: "createWorkItem",
      payload: {
        session_id: "10000000-0000-4000-8000-000000000201",
        selected_option_ids: ["create-workitem"],
        kickoff_agent: true
      }
    },
    {
      step: "startAgentRun",
      workItemId: "10000000-0000-4000-8000-000000000201",
      payload: { title: "Cuu 桌面入口任务" }
    }
  ]);
});

test("pet surface boot flow opens launcher, resolves clarification, confirms, and renders a run card", async () => {
  const calls: unknown[] = [];
  const run = petHarnessRun();
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(calls, run)
      });

      try {
        assert.match(root.innerHTML, /data-wh-surface="pet"/u);
        assert.match(root.innerHTML, /data-pet-window-mode="body_only"/u);
        assert.doesNotMatch(root.innerHTML, /data-cuu-card-id="cuu-agent-launcher"/u);

        await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
        assert.match(root.innerHTML, /data-cuu-card-id="cuu-agent-launcher"/u);
        assert.match(root.innerHTML, /data-pet-free-text/u);
        assert.match(root.innerHTML, /data-cuu-action-id="start_agent_from_cuu"/u);
        assert.doesNotMatch(root.innerHTML, /data-pet-option-id="document-draft"/u);

        const launcherSubmit = await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.equal(launcherSubmit.defaultPrevented, true);
        assert.match(root.innerHTML, /data-pet-bubble-kind="question"/u);
        assert.match(root.innerHTML, /data-pet-bubble-tone="chat"/u);
        assert.match(root.innerHTML, /data-pet-free-text/u);
        assert.match(root.innerHTML, /workhub-app-upload\.txt/u);
        assert.doesNotMatch(root.innerHTML, /data-pet-option-id="document-draft"/u);

        root.petFreeTextValue = "以 workhub-app-upload.txt 的 smoke 记录作为验收口径。";

        const clarificationSubmit = await root.click(fakePetTarget({
          href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
          "data-cuu-action-id": "submit_option"
        }, "a"));
        assert.equal(clarificationSubmit.defaultPrevented, true);
        assert.match(root.innerHTML, /data-pet-option-id="create-workitem"/u);
        assert.match(root.innerHTML, /是否按这个方向创建事项/u);

        const confirmationSelection = await root.click(fakePetTarget({ "data-pet-option-id": "create-workitem" }));
        assert.equal(confirmationSelection.defaultPrevented, true);
        assert.match(root.innerHTML, /data-chip-id="create-workitem"[^>]+data-selected="true"/u);

        const confirmationSubmit = await root.click(fakePetTarget({
          href: "/api/sessions/10000000-0000-4000-8000-000000000201/next-question",
          "data-cuu-action-id": "submit_option"
        }, "a"));
        assert.equal(confirmationSubmit.defaultPrevented, true);
        assert.match(root.innerHTML, /data-cuu-card-id="10000000-0000-4000-8000-000000000301"/u);
        assert.match(root.innerHTML, /data-pet-bubble-kind="trace"/u);
        assert.match(root.innerHTML, /data-cuu-state="thinking"/u);
        assert.match(root.innerHTML, /data-cuu-action-id="view_replay"/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }

  assert.deepEqual(calls, [
    {
      step: "createSession",
      payload: {
        title: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。",
        intent_text: "请根据项目网盘 workhub-app-upload.txt 生成三条验收要点。"
      }
    },
    {
      step: "nextQuestion",
      sessionId: "10000000-0000-4000-8000-000000000201",
      payload: { free_text: "以 workhub-app-upload.txt 的 smoke 记录作为验收口径。" }
    },
    {
      step: "nextQuestion",
      sessionId: "10000000-0000-4000-8000-000000000201",
      payload: { selected_option_ids: ["create-workitem"] }
    },
    {
      step: "createWorkItem",
      payload: {
        session_id: "10000000-0000-4000-8000-000000000201",
        selected_option_ids: ["create-workitem"],
        kickoff_agent: true
      }
    },
    {
      step: "startAgentRun",
      workItemId: "10000000-0000-4000-8000-000000000201",
      payload: { title: "Cuu 桌面入口任务" }
    }
  ]);
});

test("pet surface passes the current project context into Cuu launcher sessions", async () => {
  const calls: unknown[] = [];
  const projectId = "10000000-0000-4000-8000-000000000002";
  const target = globalThis as typeof globalThis & {
    localStorage?: Storage;
  };
  const originalLocalStorage = target.localStorage;
  const storage = createFakeLocalStorage({
    [desktopCuuProjectContextStorageKey]: JSON.stringify({
      project_id: projectId,
      route: `/drive?project_id=${projectId}`,
      updated_at_ms: Date.now()
    })
  });
  Object.defineProperty(target, "localStorage", {
    value: storage,
    configurable: true
  });

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(calls)
      });

      try {
        await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
        const launcherSubmit = await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.equal(launcherSubmit.defaultPrevented, true);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    Object.defineProperty(target, "localStorage", {
      value: originalLocalStorage,
      configurable: true
    });
  }

  assert.equal(
    (calls[0] as { payload?: { project_id?: string } } | undefined)?.payload?.project_id,
    projectId
  );
});

// CHAT-10：自由文本框 Enter 发送（Shift+Enter 换行）、中文输入法选词上屏的 Enter（isComposing）不发送。
test("pet free-text box submits on Enter, keeps Shift+Enter and IME composition as plain newline", async () => {
  const calls: unknown[] = [];
  const target = globalThis as typeof globalThis & { __WORKHUB_CUU_QA_LOCALE__?: unknown };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(calls)
      });
      try {
        await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
        assert.match(root.innerHTML, /data-pet-free-text="true"/u);
        const textarea = () => fakePetTarget({ "data-pet-free-text": "true" }, "textarea");

        // Shift+Enter：换行，不发送。
        const shiftEnter = await root.emit("keydown", textarea(), { key: "Enter", shiftKey: true });
        assert.equal(shiftEnter.defaultPrevented, false);
        assert.equal(calls.length, 0);

        // 输入法选词上屏的 Enter：不发送。
        const composing = await root.emit("keydown", textarea(), { key: "Enter", isComposing: true });
        assert.equal(composing.defaultPrevented, false);
        assert.equal(calls.length, 0);

        // 裸 Enter：等价于点「开始处理」——走既有点击管线发起 createSession。
        const enter = await root.emit("keydown", textarea(), { key: "Enter" });
        assert.equal(enter.defaultPrevented, true);
        await waitForFakePetCardMode();
        assert.equal(
          (calls[0] as { step?: string } | undefined)?.step,
          "createSession",
          "Enter must forward to the card's primary submit action"
        );
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet surface lets users restart after a launcher clarification failure", async () => {
  const calls: unknown[] = [];
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  const client = {
    ...createPetHarnessClient(calls),
    async createSession(payload: unknown): Promise<SessionVM> {
      calls.push({ step: "createSession", payload: cloneHarnessPayload(payload) });
      throw new Error("AI 材料分析没有返回可用的澄清反问。");
    }
  } as unknown as DesktopPetSurfaceClient;

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, { client });
      try {
        await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
        assert.match(root.innerHTML, /data-cuu-card-id="cuu-agent-launcher"/u);

        const launcherSubmit = await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.equal(launcherSubmit.defaultPrevented, true);
        assert.match(root.innerHTML, /这次启动没有成功/u);
        assert.match(root.innerHTML, /可以重新开始，Cuu 会再读一次需求和项目文件/u);
        assert.match(root.innerHTML, /data-cuu-action-id="restart_cuu"/u);
        assert.match(root.innerHTML, />重新开始<\/a>/u);
        assert.doesNotMatch(root.innerHTML, /查看回放|打开事项/u);

        const restart = await root.click(fakePetTarget({
          href: "/cuu/restart",
          "data-cuu-action-id": "restart_cuu"
        }, "a"));
        assert.equal(restart.defaultPrevented, true);
        assert.match(root.innerHTML, /data-cuu-card-id="cuu-agent-launcher"/u);
        assert.match(root.innerHTML, /已回到需求输入/u);
        assert.match(root.innerHTML, /data-pet-free-text/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet surface clears an approval card after a request-changes reason succeeds", async () => {
  const calls: unknown[] = [];
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const approval: AttentionItem = {
    id: "approval-runtime",
    kind: "approval",
    priority: "urgent",
    source_ref: { entity_type: "approval_request", entity_id: "approval-1" },
    title: "Review this change",
    summary_text: "AI prepared a change request.",
    reason_text: "Approve to deliver it.",
    actions: [
      { id: "approve", label: "同意", style: "primary", method: "POST", href: "/api/approvals/approval-1/respond" },
      {
        id: "request_changes",
        label: "打回",
        style: "danger",
        method: "POST",
        href: "/api/approvals/approval-1/respond",
        requires_reason: true
      }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-10T01:00:00.000Z"
  };
  const client = {
    ...createPetHarnessClient(calls),
    pages: {
      attention: async () => ({ primary: null, queue: [] })
    },
    async respondApproval(id: string, payload: unknown) {
      calls.push({ step: "respondApproval", id, payload: cloneHarnessPayload(payload) });
      return { id, status: "responded" };
    }
  } as unknown as DesktopPetSurfaceClient;
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "en-US";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, { client, listen });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.permissionAsk, {
            summary_text: approval.summary_text,
            attention: approval
          })
        });
        assert.match(root.innerHTML, /data-cuu-card-id="approval-runtime"/u);
        assert.match(root.innerHTML, /data-cuu-action-id="request_changes"/u);

        const requestChanges = await root.click(fakePetTarget({
          href: "/api/approvals/approval-1/respond",
          "data-cuu-action-id": "request_changes",
          "data-requires-reason": "true"
        }, "a"));
        assert.equal(requestChanges.defaultPrevented, true);
        assert.match(root.innerHTML, /Choose one reason so Cuu can revise with it/u);
        assert.match(root.innerHTML, /data-pet-reason="Not enough evidence"/u);

        const reason = await root.click(fakePetTarget({ "data-pet-reason": "Not enough evidence" }));
        assert.equal(reason.defaultPrevented, false);
        assert.match(root.innerHTML, /Sent back; Cuu will revise/u);
        assert.doesNotMatch(root.innerHTML, /data-cuu-card-id="approval-runtime"/u);
        assert.doesNotMatch(root.innerHTML, /data-cuu-action-id="approve"|data-cuu-action-id="request_changes"/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }

  assert.deepEqual(calls, [
    {
      step: "respondApproval",
      id: "approval-1",
      payload: { decision: "deny", reason_md: "Not enough evidence", remember: "once" }
    }
  ]);
});

test("pet surface handles proposal review request-changes without navigating to the API URL", async () => {
  const calls: unknown[] = [];
  const shellEmits: unknown[] = [];
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const shellEmitter: DesktopShellEmitter = {
    emitTo(target, eventName, payload) {
      shellEmits.push({ target, eventName, payload: cloneHarnessPayload(payload) });
    }
  };
  const proposalReview: AttentionItem = {
    id: "proposal-review-runtime",
    kind: "proposal_review",
    priority: "urgent",
    source_ref: { entity_type: "proposal", entity_id: "proposal-1" },
    title: "Cuu 等你确认变更",
    summary_text: "AI 交付了一份变更，等你确认。",
    reason_text: "确认后才会合入。",
    actions: [
      { id: "approve", label: "同意", style: "primary", method: "POST", href: "/api/proposals/proposal-1/review" },
      {
        id: "request_changes",
        label: "打回",
        style: "danger",
        method: "POST",
        href: "/api/proposals/proposal-1/review",
        requires_reason: true
      },
      { id: "open_proposal", label: "打开", style: "secondary", method: "GET", href: "/proposals/proposal-1" }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-10T01:00:00.000Z"
  };
  const client = {
    ...createPetHarnessClient(calls),
    pages: {
      attention: async () => ({ primary: null, queue: [] })
    },
    async reviewProposal(id: string, payload: unknown) {
      calls.push({ step: "reviewProposal", id, payload: cloneHarnessPayload(payload) });
      return { attention: { summary_text: "已打回；Cuu 会继续改。" } };
    }
  } as unknown as DesktopPetSurfaceClient;
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client,
        listen,
        petWindowBridge: {
          setMode() {}
        },
        shellEmitter
      });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.permissionAsk, {
            summary_text: proposalReview.summary_text,
            attention: proposalReview
          })
        });
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /data-cuu-card-id="proposal-review-runtime"/u);
        assert.match(root.innerHTML, /data-cuu-action-id="request_changes"/u);
        assert.match(root.innerHTML, /查看变更申请/u);
        assert.match(root.innerHTML, /确认通过/u);
        assert.match(root.innerHTML, /打回修改/u);
        assert.doesNotMatch(root.innerHTML, />打开<\/a>/u);
        assert.doesNotMatch(root.innerHTML, />同意<\/a>/u);
        assert.ok(root.innerHTML.indexOf('data-cuu-action-id="open_proposal"') < root.innerHTML.indexOf('data-cuu-action-id="approve"'));
        assert.ok(root.innerHTML.indexOf('data-cuu-action-id="approve"') < root.innerHTML.indexOf('data-cuu-action-id="request_changes"'));

        const openProposal = await root.click(fakePetTarget({
          href: "/proposals/proposal-1",
          "data-cuu-action-id": "open_proposal"
        }, "a"));
        assert.equal(openProposal.defaultPrevented, true);
        assert.deepEqual(shellEmits, [
          { target: "main", eventName: "navigate", payload: { route: "/proposals/proposal-1" } }
        ]);
        assert.match(root.innerHTML, /data-cuu-card-id="proposal-review-runtime"/u);

        const requestChanges = await root.click(fakePetTarget({
          href: "/api/proposals/proposal-1/review",
          "data-cuu-action-id": "request_changes",
          "data-requires-reason": "true"
        }, "a"));
        assert.equal(requestChanges.defaultPrevented, true);
        assert.match(root.innerHTML, /先点一个原因，Cuu 会带着它继续改/u);
        assert.match(root.innerHTML, /data-pet-reason="证据不足"/u);

        const reason = await root.click(fakePetTarget({ "data-pet-reason": "证据不足" }));
        assert.equal(reason.defaultPrevented, false);
        assert.match(root.innerHTML, /已打回；Cuu 会继续改/u);
        assert.doesNotMatch(root.innerHTML, /data-cuu-card-id="proposal-review-runtime"/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }

  assert.deepEqual(calls, [
    {
      step: "reviewProposal",
      id: "proposal-1",
      payload: { decision: "request_changes", reason_md: "证据不足", remember: "once" }
    }
  ]);
});

test("pet surface does not steal focus on OS notification arrival; clicking the matching Cuu card action lands the plan", async () => {
  // MRG-20：修复前 webview 在通知到达那一刻就 focus_system_notification——弹窗抢焦点 + 强制导航。
  // 现在到达只暂存计划；用户在桌宠 Cuu 卡上点击指向同一路由的动作时，才把壳层算好的
  // route/window_control 经命令桥回传原生 focus_system_notification 落地（审批通知落审批面板）。
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const focusedPlans: Array<{ route?: string; windowControl?: { label?: string } }> = [];
  const client = createPetHarnessClient([]) as unknown as DesktopPetSurfaceClient;
  const planPayload = {
    id: "evt-approval",
    event: "permission.ask",
    title: "Cuu needs your approval",
    body: "Open WorkHub to allow, deny, or remember this rule.",
    urgency: "urgent",
    route: "/approvals?approvalId=approval-1",
    windowControl: {
      label: "main",
      action: "show_and_focus",
      source: "system_notification",
      focus: true,
      reason: "focus-main-route",
      route: "/approvals?approvalId=approval-1"
    },
    streamKind: "me",
    streamPath: "/api/push/stream/me"
  };

  await withFakePetDom(async (root) => {
    const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
      client,
      listen,
      petWindowBridge: {
        setMode() {},
        focusSystemNotification(plan) {
          focusedPlans.push(plan);
        }
      }
    });
    try {
      handlers.get("system-notification")?.({ payload: planPayload });
      await Promise.resolve();
      // 到达即抢焦点的旧行为已移除——不点卡片就什么都不发生。
      assert.equal(focusedPlans.length, 0);

      // 用户点击指向同一路由（path 相同，查询串不影响匹配）的卡片动作 → 计划被回传落地。
      await root.click(fakePetTarget({ href: "/approvals" }, "a"));
      await Promise.resolve();
      assert.equal(focusedPlans.length, 1);
      assert.equal(focusedPlans[0]?.route, "/approvals?approvalId=approval-1");
      assert.equal(focusedPlans[0]?.windowControl?.label, "main");

      // 计划一次性消费——再点一次不再重复导航。
      await root.click(fakePetTarget({ href: "/approvals" }, "a"));
      await Promise.resolve();
      assert.equal(focusedPlans.length, 1);
    } finally {
      await runtime.dispose();
    }
  });
});

test("pet surface keeps the notification plan when the user clicks an unrelated route", async () => {
  // MRG-20：点了别的路由不该误消费暂存的通知计划——之后点对路由仍能落地。
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const focusedPlans: Array<{ route?: string }> = [];
  const focusedMainRoutes: string[] = [];
  const client = createPetHarnessClient([]) as unknown as DesktopPetSurfaceClient;

  await withFakePetDom(async (root) => {
    const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
      client,
      listen,
      petWindowBridge: {
        setMode() {},
        focusSystemNotification(plan) {
          focusedPlans.push(plan);
        },
        focusMainRoute(route) {
          focusedMainRoutes.push(route);
        }
      }
    });
    try {
      handlers.get("system-notification")?.({
        payload: {
          id: "evt-cost",
          event: "budget.warning",
          title: "Budget warning",
          body: "Usage is close to the cap.",
          urgency: "high",
          route: "/dashboard/cost",
          windowControl: {
            label: "main",
            action: "show_and_focus",
            source: "system_notification",
            focus: true,
            reason: "focus-main-route",
            route: "/dashboard/cost"
          },
          streamKind: "me",
          streamPath: "/api/push/stream/me"
        }
      });
      await Promise.resolve();

      // 点不相关的路由 → 不消费计划，走既有主窗导航兜底。
      await root.click(fakePetTarget({ href: "/settings" }, "a"));
      await Promise.resolve();
      assert.equal(focusedPlans.length, 0);
      assert.deepEqual(focusedMainRoutes, ["/settings"]);

      // 点对路由 → 计划落地。
      await root.click(fakePetTarget({ href: "/dashboard/cost" }, "a"));
      await Promise.resolve();
      assert.equal(focusedPlans.length, 1);
      assert.equal(focusedPlans[0]?.route, "/dashboard/cost");
    } finally {
      await runtime.dispose();
    }
  });
});

test("pet surface refreshes a proposal card after the main window settles the review action", async () => {
  const openedProposalReview: AttentionItem = {
    id: "proposal-review-runtime",
    kind: "proposal_review",
    priority: "urgent",
    source_ref: { entity_type: "proposal", entity_id: "proposal-1" },
    title: "Cuu 等你确认变更",
    summary_text: "AI 交付了一份变更，等你确认。",
    reason_text: "确认后才会合入。",
    actions: [
      { id: "open_proposal", label: "查看变更申请", style: "secondary", method: "GET", href: "/proposals/proposal-1" },
      { id: "approve", label: "确认通过", style: "primary", method: "POST", href: "/api/proposals/proposal-1/review" },
      {
        id: "request_changes",
        label: "打回修改",
        style: "danger",
        method: "POST",
        href: "/api/proposals/proposal-1/review",
        requires_reason: true
      }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-10T01:00:00.000Z"
  };
  const reviewedProposalReview: AttentionItem = {
    ...openedProposalReview,
    summary_text: "已确认通过，只差合入交付物。",
    reason_text: "接下来可以合入交付物。",
    actions: [
      { id: "open_proposal", label: "查看变更申请", style: "secondary", method: "GET", href: "/proposals/proposal-1" },
      { id: "merge", label: "合入交付物", style: "primary", method: "POST", href: "/api/proposals/proposal-1/merge" }
    ]
  };
  let attentionQueue: AttentionItem[] = [];
  const calls: Array<{ step: string; id: string; payload: unknown }> = [];
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const stopped: string[] = [];
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => stopped.push(eventName);
  };
  const client = {
    ...createPetHarnessClient([]),
    pages: {
      attention: async () => ({ primary: null, queue: attentionQueue })
    },
    async mergeProposal(id: string, payload: unknown) {
      calls.push({ step: "mergeProposal", id, payload: cloneHarnessPayload(payload) });
      attentionQueue = [];
      return { attention: { summary_text: "已合入交付物。" } };
    }
  } as unknown as DesktopPetSurfaceClient;
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client,
        listen
      });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.permissionAsk, {
            summary_text: openedProposalReview.summary_text,
            attention: openedProposalReview
          })
        });
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /data-cuu-card-id="proposal-review-runtime"/u);
        assert.match(root.innerHTML, /确认通过/u);
        assert.match(root.innerHTML, /打回修改/u);
        assert.doesNotMatch(root.innerHTML, /合入交付物/u);

        attentionQueue = [reviewedProposalReview];
        handlers.get("attention-refresh")?.({ payload: { reason: "spotlight-action-settled" } });
        await waitForFakePetCardMode();

        assert.match(root.innerHTML, /data-cuu-card-id="proposal-review-runtime"/u);
        assert.match(root.innerHTML, /Cuu 等你合入变更/u);
        assert.match(root.innerHTML, /有变更待合入/u);
        assert.match(root.innerHTML, /合入交付物/u);
        assert.doesNotMatch(root.innerHTML, /有一件待你拍板/u);
        assert.doesNotMatch(root.innerHTML, /data-cuu-action-id="approve"/u);
        assert.doesNotMatch(root.innerHTML, /data-cuu-action-id="request_changes"/u);

        const merge = await root.click(fakePetTarget({
          href: "/api/proposals/proposal-1/merge",
          "data-cuu-action-id": "merge"
        }, "a"));
        await waitForFakePetCardMode();

        assert.equal(merge.defaultPrevented, true);
        assert.deepEqual(calls, [{ step: "mergeProposal", id: "proposal-1", payload: {} }]);
        assert.doesNotMatch(root.innerHTML, /data-cuu-card-id="proposal-review-runtime"/u);
      } finally {
        await runtime.dispose();
      }
      assert.ok(stopped.includes("attention-refresh"));
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

// CHAT-09：自由文本框有未提交内容时静默刷新被跳过是刻意的（保住正在打的字），但跳过必须记脏——
// 否则之后再无事件到达，卡片永久停在旧帧。这条测试钉死：跳过 → 清空文本框（input 事件）→ 补刷落地。
test("pet surface flushes the skipped attention refresh once the free-text box is cleared", async () => {
  const clarificationItem = (summary: string): AttentionItem => ({
    id: "clarify-1",
    kind: "clarification",
    priority: "urgent",
    source_ref: { entity_type: "notification", entity_id: "session-1" },
    title: "Cuu 想再确认一句",
    summary_text: summary,
    reason_text: summary,
    actions: [
      { id: "submit_option", label: "继续", style: "primary", method: "POST", href: "/api/sessions/session-1/next-question" }
    ],
    cuu_state: "asking_approval",
    created_at: "2026-06-10T01:00:00.000Z"
  });
  let attentionQueue: AttentionItem[] = [];
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const client = {
    ...createPetHarnessClient([]),
    pages: {
      attention: async () => ({ primary: null, queue: attentionQueue })
    }
  } as unknown as DesktopPetSurfaceClient;
  const target = globalThis as typeof globalThis & { __WORKHUB_CUU_QA_LOCALE__?: unknown };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, { client, listen });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.permissionAsk, {
            summary_text: "旧口径文本",
            attention: clarificationItem("旧口径文本")
          })
        });
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /data-cuu-card-id="clarify-1"/u);
        assert.match(root.innerHTML, /旧口径文本/u);
        assert.match(root.innerHTML, /data-pet-free-text="true"/u);

        // 框里有未提交内容（harness 默认 petFreeTextValue 非空）→ 静默刷新被跳过、记脏。
        attentionQueue = [clarificationItem("新口径文本")];
        handlers.get("attention-refresh")?.({ payload: { reason: "spotlight-action-settled" } });
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /旧口径文本/u, "pending free text must shield the visible card");
        assert.doesNotMatch(root.innerHTML, /新口径文本/u);

        // 用户清空文本框 → 补刷落地，新帧上来。
        root.petFreeTextValue = "";
        await root.emit("input", fakePetTarget({ "data-pet-free-text": "true" }, "textarea"));
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /新口径文本/u, "clearing the box must flush the skipped refresh");
        assert.doesNotMatch(root.innerHTML, /旧口径文本/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet surface hides backend English diagnostics on zh launcher clarification failures", async () => {
  const calls: unknown[] = [];
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  const client = {
    ...createPetHarnessClient(calls),
    async createSession(payload: unknown): Promise<SessionVM> {
      calls.push({ step: "createSession", payload: cloneHarnessPayload(payload) });
      throw new WorkHubApiError(
        502,
        "clarification_llm_templated_response",
        "AI material analysis returned a generic template instead of a real follow-up question."
      );
    }
  } as unknown as DesktopPetSurfaceClient;

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, { client });
      try {
        await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
        const launcherSubmit = await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.equal(launcherSubmit.defaultPrevented, true);
        assert.match(root.innerHTML, /这次启动没有成功/u);
        assert.match(root.innerHTML, /可以重新开始，Cuu 会再读一次需求和项目文件/u);
        assert.doesNotMatch(root.innerHTML, /generic template|real follow-up question|AI material analysis/iu);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet surface renders merge conflicts as proposal conflict choices instead of a restart error", async () => {
  const conflict: ProposalConflict = {
    id: "conflict-workhub-upload",
    work_item_id: "10000000-0000-4000-8000-000000000201",
    proposal_id: "proposal-1",
    change_id: "change-1",
    target_key: "drive_item:outputs/acceptance-checks-workhub-app-upload.md",
    target_kind: "text_doc",
    change_type: "generated",
    target_path: "outputs/acceptance-checks-workhub-app-upload.md",
    headline: "acceptance-checks-workhub-app-upload.md 已经有正式版本",
    summary_text: "这份变更和正式版撞车，需要先选择处理方案。",
    existing: {
      proposal_id: "proposal-old",
      change_id: "change-old",
      sha256: "a".repeat(64)
    },
    incoming: {
      sha256_before: "b".repeat(64),
      sha256_after: "c".repeat(64)
    },
    recommended_option_id: "keep_current",
    options: [
      {
        id: "keep_current",
        label: "保留正式版",
        summary_text: "保留已正式采纳的版本。",
        recommended: true,
        action: {
          id: "keep_current",
          label: "保留正式版",
          method: "POST",
          href: "/api/proposals/proposal-1/merge",
          request_json: { conflict_resolution: { accept_incoming_target_keys: [] } }
        }
      },
      {
        id: "accept_incoming",
        label: "采纳这次版本",
        summary_text: "用这次版本覆盖正式版。",
        action: {
          id: "accept_incoming",
          label: "采纳这次版本",
          method: "POST",
          href: "/api/proposals/proposal-1/merge",
          request_json: {
            conflict_resolution: { accept_incoming_target_keys: ["drive_item:outputs/acceptance-checks-workhub-app-upload.md"] }
          }
        }
      }
    ]
  };
  const reviewedProposalReview: AttentionItem = {
    id: "proposal-review-runtime",
    kind: "proposal_review",
    priority: "urgent",
    source_ref: { entity_type: "proposal", entity_id: "proposal-1" },
    title: "Cuu 等你确认变更",
    summary_text: "已确认通过，只差合入交付物。",
    reason_text: "接下来可以合入交付物。",
    actions: [
      { id: "open_proposal", label: "查看变更申请", style: "secondary", method: "GET", href: "/proposals/proposal-1" },
      { id: "merge", label: "合入交付物", style: "primary", method: "POST", href: "/api/proposals/proposal-1/merge" }
    ],
    cuu_state: "carrying_document",
    created_at: "2026-06-10T01:00:00.000Z"
  };
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const client = {
    ...createPetHarnessClient([]),
    pages: {
      attention: async () => ({ primary: null, queue: [] })
    },
    async mergeProposal() {
      throw new WorkHubApiError(409, "merge_conflict", "这份变更和正式版撞车，需要先选择处理方案。", {
        conflicts: [conflict]
      });
    }
  } as unknown as DesktopPetSurfaceClient;
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, { client, listen });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.permissionAsk, {
            summary_text: reviewedProposalReview.summary_text,
            attention: reviewedProposalReview
          })
        });
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /合入交付物/u);

        const merge = await root.click(fakePetTarget({
          href: "/api/proposals/proposal-1/merge",
          "data-cuu-action-id": "merge"
        }, "a"));
        assert.equal(merge.defaultPrevented, true);
        assert.match(root.innerHTML, /和别人的改动冲突了/u);
        assert.match(root.innerHTML, /保留正式版/u);
        // 旧断言继续接受「采纳这次版本」；Cuu proposal 卡片已统一 merge 动词为「合入」，否则同一卡内会混用两套口径。
        assert.match(root.innerHTML, /采纳这次版本/u);
        assert.doesNotMatch(root.innerHTML, /这次启动没有成功|重新开始/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet surface syncs settings emitted by the main desktop window", async () => {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  const storage = createFakeLocalStorage({
    workhub_cuu_preferences: JSON.stringify({
      pet_pass_through: true,
      pet_hide_on_hover: true,
      pet_opacity_percent: 60
    })
  });
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const handlers = new Map<string, (event: { payload: unknown }) => void>();
      const stopped: string[] = [];
      const emitted: unknown[] = [];
      const listen: DesktopShellListen = (eventName, handler) => {
        handlers.set(eventName, handler);
        return () => stopped.push(eventName);
      };
      const shellEmitter: DesktopShellEmitter = {
        emitTo: (_target, _eventName, payload) => {
          emitted.push(payload);
        }
      };
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([]),
        listen,
        shellEmitter
      });

      try {
        assert.match(root.innerHTML, /data-pet-pass-through="true"/u);
        assert.match(root.innerHTML, /data-pet-hide-on-hover="true"/u);
        assert.match(root.innerHTML, /data-pet-opacity-percent="60"/u);

        handlers.get("pet-settings")?.({
          payload: {
            scale_percent: 100,
            opacity_percent: 100,
            pass_through: false,
            hide_on_hover: false
          }
        });

        assert.match(root.innerHTML, /data-pet-pass-through="false"/u);
        assert.match(root.innerHTML, /data-pet-hide-on-hover="false"/u);
        assert.match(root.innerHTML, /data-pet-opacity-percent="100"/u);
        const persisted = JSON.parse(storage.getItem("workhub_cuu_preferences") ?? "{}") as Record<string, unknown>;
        assert.equal(persisted.pet_scale_percent, 100);
        assert.equal(persisted.pet_opacity_percent, 100);
        assert.equal(persisted.pet_pass_through, false);
        assert.equal(persisted.pet_hide_on_hover, false);
        assert.deepEqual(emitted, []);
      } finally {
        await runtime.dispose();
      }
      assert.ok(stopped.includes("pet-settings"));
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

// DSK-02：托盘「恢复交互」只复位穿透/悬停隐藏——用户自调的透明度必须原样保留（此前硬重置成 100 并落盘，
// 把用户设置冲掉；Rust 侧 main.rs 特意保留用户透明度，webview 这边不该对着干）。
test("pet tray restore-interaction resets pass-through/hover-hide but preserves the user's opacity", async () => {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  const storage = createFakeLocalStorage({
    workhub_cuu_preferences: JSON.stringify({
      pet_pass_through: true,
      pet_hide_on_hover: true,
      pet_opacity_percent: 60
    })
  });
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const handlers = new Map<string, (event: { payload: unknown }) => void>();
      const listen: DesktopShellListen = (eventName, handler) => {
        handlers.set(eventName, handler);
        return () => handlers.delete(eventName);
      };
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([]),
        listen
      });

      try {
        assert.match(root.innerHTML, /data-pet-pass-through="true"/u);
        assert.match(root.innerHTML, /data-pet-opacity-percent="60"/u);

        handlers.get("tray-action")?.({ payload: { id: "restore-pet-interaction" } });

        // 穿透/悬停隐藏复位，透明度保持用户自调的 60（且落盘的也是 60）。
        assert.match(root.innerHTML, /data-pet-pass-through="false"/u);
        assert.match(root.innerHTML, /data-pet-hide-on-hover="false"/u);
        assert.match(root.innerHTML, /data-pet-opacity-percent="60"/u);
        const persisted = JSON.parse(storage.getItem("workhub_cuu_preferences") ?? "{}") as Record<string, unknown>;
        assert.equal(persisted.pet_opacity_percent, 60);
        assert.equal(persisted.pet_pass_through, false);
        assert.equal(persisted.pet_hide_on_hover, false);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

// G-desktop 止血批 3（跨窗口登出广播）——纯函数覆盖：卡片诚实标出"已登出"，不假装 Cuu 还能干活。
test("createDesktopPetLoggedOutCard renders an honest signed-out card in both locales", () => {
  const zh = createDesktopPetLoggedOutCard("zh-CN");
  assert.equal(zh.kind, "offline");
  assert.equal(zh.state, "offline");
  assert.match(zh.title, /已登出/u);
  assert.match(zh.message, /重新登录/u);
  assert.deepEqual(zh.actions, []);

  const en = createDesktopPetLoggedOutCard("en-US");
  assert.match(en.title, /Signed out/u);
  assert.match(en.message, /sign back in/iu);
});

// G-desktop 止血批 3：桌宠窗和工作台窗共用同一条 workhub-logged-out 广播（见
// desktop-cuu-runtime.ts 的 DesktopShellEventName 顶部注释）——主窗登出时已经开着的桌宠窗不会跟着
// reload，之前完全没有 handler，会拿着刚被清空的 client token 静默连环 401。这条测试钉死：桌宠窗收到
// 广播后换成诚实的「已登出」卡片，dispose 时把这个新监听也一并解绑（不留泄漏）。
test("pet surface swaps to an honest signed-out card when it receives the workhub-logged-out broadcast, and unlistens on dispose", async () => {
  const target = globalThis as typeof globalThis & { __WORKHUB_CUU_QA_LOCALE__?: unknown };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  try {
    await withFakePetDom(async (root) => {
      const handlers = new Map<string, (event: { payload: unknown }) => void>();
      const stopped: string[] = [];
      const listen: DesktopShellListen = (eventName, handler) => {
        handlers.set(eventName, handler);
        return () => stopped.push(eventName);
      };
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([]),
        listen
      });
      try {
        handlers.get("workhub-logged-out")?.({ payload: undefined });
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /data-cuu-card-id="pet-logged-out"/u);
        assert.match(root.innerHTML, /已登出/u);
      } finally {
        await runtime.dispose();
      }
      assert.ok(stopped.includes("workhub-logged-out"));
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet right-click menu broadcasts hover setting changes to the main settings panel", async () => {
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  const storage = createFakeLocalStorage({
    workhub_cuu_preferences: JSON.stringify({
      pet_pass_through: false,
      pet_hide_on_hover: false,
      pet_opacity_percent: 100
    })
  });
  target.__WORKHUB_CUU_QA_LOCALE__ = "en-US";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const emits: Array<{ target: string; eventName: string; payload: unknown }> = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([]),
        shellEmitter: {
          emitTo(target, eventName, payload) {
            emits.push({ target, eventName, payload });
          }
        }
      });

      try {
        assert.match(root.innerHTML, /data-pet-hide-on-hover="false"/u);

        await root.click(fakePetTarget({ "data-pet-menu-toggle-hover": "true" }));

        assert.match(root.innerHTML, /data-pet-hide-on-hover="true"/u);
        assert.equal(emits.length, 1);
        assert.deepEqual(emits[0], {
          target: "main",
          eventName: "pet-settings",
          payload: {
            scale_percent: 100,
            opacity_percent: 100,
            pass_through: false,
            hide_on_hover: true,
            source: "pet-menu"
          }
        });
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

// R12 批7:被派活问询气泡的「去工作台看看」按钮点击 → 真实 invoke("open_workbench", ...)。
test("pet surface routes a dispatch_ask bubble's workbench action through a real open_workbench invoke", async () => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const target = globalThis as typeof globalThis & {
    __TAURI__?: unknown;
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalTauri = target.__TAURI__;
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  target.__TAURI__ = {
    core: {
      async invoke(command: string, args?: Record<string, unknown>) {
        invokeCalls.push({ command, args });
        return undefined;
      }
    }
  };

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([]),
        listen
      });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.notificationCreated, {
            id: "notification-dispatch-ask-dom",
            type: "action_card_item.dispatch_ask",
            severity: "normal",
            title: "有个活想派给你",
            body: "整理会议纪要",
            project_id: "10000000-0000-4000-8000-000000000780"
          })
        });
        // 真实(伪装的)__TAURI__.core.invoke 存在时，卡片进入 card 窗口模式会先过一次异步
        // syncPetWindowMode(见 pet-surface.ts)，气泡在"syncing"瞬态里被抑制——等它落定，照抄
        // waitForFakePetCardMode 在其它 card-mode 用例里的同款等待。
        await waitForFakePetCardMode();
        assert.match(root.innerHTML, /data-pet-bubble-kind="bubble"/u);
        assert.match(root.innerHTML, /有个活儿想派给我/u);
        assert.match(root.innerHTML, /data-cuu-action-id="open_workbench"/u);
        assert.match(root.innerHTML, /href="\/workbench\/10000000-0000-4000-8000-000000000780"/u);

        const click = await root.click(fakePetTarget({
          href: "/workbench/10000000-0000-4000-8000-000000000780",
          "data-cuu-action-id": "open_workbench"
        }, "a"));

        assert.equal(click.defaultPrevented, true);
        assert.deepEqual(
          invokeCalls.filter((call) => call.command === "open_workbench"),
          [{ command: "open_workbench", args: { projectId: "10000000-0000-4000-8000-000000000780" } }]
        );
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__TAURI__ = originalTauri;
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

test("pet surface falls back to an honest 'could not open' message when no Tauri invoke is available", async () => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const target = globalThis as typeof globalThis & {
    __TAURI__?: unknown;
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
  };
  const originalTauri = target.__TAURI__;
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  delete target.__TAURI__;

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([]),
        listen
      });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.notificationCreated, {
            id: "notification-dispatch-ask-degraded",
            type: "action_card_item.dispatch_ask",
            severity: "normal",
            title: "有个活想派给你",
            body: "整理会议纪要",
            project_id: "10000000-0000-4000-8000-000000000781"
          })
        });

        await root.click(fakePetTarget({
          href: "/workbench/10000000-0000-4000-8000-000000000781",
          "data-cuu-action-id": "open_workbench"
        }, "a"));

        assert.match(root.innerHTML, /Cuu 暂时打不开工作台窗口/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__TAURI__ = originalTauri;
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});

// D1（R19-13 托盘语言联动补线）：桌宠设置菜单切语言此前只广播给主窗、更新本地偏好，
// 从没通知原生外壳——托盘菜单/tooltip/通知兜底文案永远停在启动语言。现在切换成功后
// 真调 set_shell_locale，与 spotlight/views/settings.ts 的主窗切语言同一份修法。
test("pet settings menu locale switch also syncs the native shell via set_shell_locale", async () => {
  const invokeCalls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const target = globalThis as typeof globalThis & { __TAURI__?: unknown };
  const originalTauri = target.__TAURI__;
  target.__TAURI__ = {
    core: {
      async invoke(command: string, args?: Record<string, unknown>) {
        invokeCalls.push({ command, args });
        return undefined;
      }
    }
  };

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([])
      });
      try {
        await root.click(fakePetTarget({ "data-pet-menu-locale": "en-US" }));
        // setLocalePreference 的原生外壳同步挂在 client.updatePreferences(...).then(...)——
        // fire-and-forget，不在点击处理器内 await，故需要多等一拍微任务让它真正落地。
        await Promise.resolve();
        await Promise.resolve();
        // 只筛 set_shell_locale——挂载期间桌宠还会为窗口设置发其它 invoke（如 set_pet_window_settings），
        // 那些跟本条修复无关，不该让这条断言对它们的存在/顺序敏感。
        assert.deepEqual(
          invokeCalls.filter((call) => call.command === "set_shell_locale"),
          [{ command: "set_shell_locale", args: { locale: "en-US" } }]
        );
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    if (originalTauri === undefined) {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = originalTauri;
    }
  }
});

// 非 Tauri 环境（web 预览/无壳层测试替身）没有 invoke 时，切语言仍要正常完成——best-effort
// 跳过，不抛错、不卡住偏好更新。
test("pet settings menu locale switch degrades quietly with no Tauri invoke available", async () => {
  const target = globalThis as typeof globalThis & { __TAURI__?: unknown };
  const originalTauri = target.__TAURI__;
  delete target.__TAURI__;

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient([])
      });
      try {
        await root.click(fakePetTarget({ "data-pet-menu-locale": "en-US" }));
        await Promise.resolve();
        await Promise.resolve();
        assert.match(root.innerHTML, /data-pet-menu-locale="en-US" aria-pressed="true"/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    if (originalTauri === undefined) {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = originalTauri;
    }
  }
});

test("pet surface persists and restores the current session question card", async () => {
  const storage = createFakeLocalStorage();
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const calls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(calls)
      });
      try {
        await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
        await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.match(root.innerHTML, /data-pet-bubble-kind="question"/u);
        assert.match(root.innerHTML, /data-pet-bubble-tone="chat"/u);
        assert.match(root.innerHTML, /请确认 workhub-app-upload\.txt 的验收口径/u);
      } finally {
        await runtime.dispose();
      }
    });

    const persisted = storage.getItem(desktopPetRunRestoreStorageKey);
    assert.ok(persisted);
    const restoreState = JSON.parse(persisted);
    assert.equal(restoreState.entity_type, "session");
    assert.equal(restoreState.entity_id, "10000000-0000-4000-8000-000000000201");
    restoreState.card.actions[0].label = "确认选项";
    storage.setItem(desktopPetRunRestoreStorageKey, JSON.stringify(restoreState));

    await withFakePetDom(async (root) => {
      const restoreCalls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(restoreCalls)
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        assert.match(root.innerHTML, /data-pet-bubble-kind="question"/u);
        assert.match(root.innerHTML, /data-pet-bubble-tone="chat"/u);
        assert.match(root.innerHTML, /data-pet-payload-ref-entity-type="session"/u);
        assert.match(root.innerHTML, /请确认 workhub-app-upload\.txt 的验收口径/u);
        assert.match(root.innerHTML, /Cuu 已恢复：请确认 workhub-app-upload\.txt 的验收口径/u);
        assert.match(root.innerHTML, /提交回答/u);
        assert.doesNotMatch(root.innerHTML, /确认选项/u);
      } finally {
        await runtime.dispose();
      }
      assert.deepEqual(restoreCalls, []);
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("pet surface persists and restores the active agent run card after refresh", async () => {
  const run = petHarnessRun();
  const storage = createFakeLocalStorage();
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const firstCalls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(firstCalls, run)
      });
      try {
        await completePetBootAgentRunFlow(root);
        assert.match(root.innerHTML, /data-cuu-card-id="10000000-0000-4000-8000-000000000301"/u);
      } finally {
        await runtime.dispose();
      }
    });

    const persisted = storage.getItem(desktopPetRunRestoreStorageKey);
    assert.ok(persisted);
    assert.equal(JSON.parse(persisted).entity_type, "agent_run");
    assert.equal(JSON.parse(persisted).entity_id, run.run_id);

    await withFakePetDom(async (root) => {
      const restoreCalls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(restoreCalls, run)
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        assert.match(root.innerHTML, /data-cuu-card-id="10000000-0000-4000-8000-000000000301"/u);
        assert.match(root.innerHTML, /data-pet-bubble-kind="trace"/u);
        assert.match(root.innerHTML, /data-cuu-state="thinking"/u);
        assert.match(root.innerHTML, /Cuu 已恢复：Cuu 桌面入口任务/u);
      } finally {
        await runtime.dispose();
      }
      assert.deepEqual(restoreCalls, [{ step: "getAgentRun", runId: run.run_id }]);
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("pet surface restores a terminal agent run card without rerunning the launcher flow", async () => {
  const terminalRun: AgentRunLiveVM = {
    ...petHarnessRun(),
    status: "succeeded",
    run: {
      ...petHarnessRun().run,
      status: "succeeded"
    },
    trace: [
      ...petHarnessRun().trace,
      {
        id: "10000000-0000-4000-8000-000000000302",
        agent_run_id: "10000000-0000-4000-8000-000000000301",
        step_no: 2,
        phase: "final",
        input_json: {},
        output_excerpt: "已完成交付物。",
        created_at: "2026-06-10T01:01:00.000Z"
      }
    ]
  };
  const storage = createFakeLocalStorage({
    [desktopPetRunRestoreStorageKey]: JSON.stringify({
      version: 1,
      entity_type: "agent_run",
      entity_id: terminalRun.run_id,
      href: `/agent-runs/${terminalRun.run_id}/replay`,
      updated_at_ms: Date.now()
    })
  });
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalLocalStorage = target.localStorage;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const restoreCalls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(restoreCalls, terminalRun)
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        assert.match(root.innerHTML, /data-cuu-card-id="10000000-0000-4000-8000-000000000301"/u);
        assert.match(root.innerHTML, /data-pet-bubble-kind="completion"/u);
        assert.match(root.innerHTML, /data-cuu-state="celebrating"/u);
        assert.match(root.innerHTML, /data-cuu-action-id="view_replay"/u);
        assert.match(root.innerHTML, /Cuu 已恢复：Cuu 桌面入口任务/u);
      } finally {
        await runtime.dispose();
      }
      assert.deepEqual(restoreCalls, [{ step: "getAgentRun", runId: terminalRun.run_id }]);
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("pet surface allows seeded restore during reload QA scenarios", async () => {
  const terminalRun: AgentRunLiveVM = {
    ...petHarnessRun(),
    status: "succeeded",
    run: {
      ...petHarnessRun().run,
      status: "succeeded"
    }
  };
  const storage = createFakeLocalStorage({
    [desktopPetRunRestoreStorageKey]: JSON.stringify({
      version: 1,
      entity_type: "agent_run",
      entity_id: terminalRun.run_id,
      href: `/agent-runs/${terminalRun.run_id}/replay`,
      updated_at_ms: Date.now()
    })
  });
  const target = globalThis as typeof globalThis & {
    __WORKHUB_CUU_QA_LOCALE__?: unknown;
    __WORKHUB_CUU_QA_SCENARIO__?: unknown;
    localStorage?: Storage;
  };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  const originalQaScenario = target.__WORKHUB_CUU_QA_SCENARIO__;
  const originalLocalStorage = target.localStorage;
  target.__WORKHUB_CUU_QA_LOCALE__ = "en-US";
  target.__WORKHUB_CUU_QA_SCENARIO__ = "reload-terminal-run";
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: storage
  });

  try {
    await withFakePetDom(async (root) => {
      const restoreCalls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(restoreCalls, terminalRun)
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        assert.match(root.innerHTML, /data-pet-bubble-kind="completion"/u);
        assert.match(root.innerHTML, /data-cuu-action-id="view_replay"/u);
        assert.match(root.innerHTML, /Cuu restored: Cuu 桌面入口任务/u);
      } finally {
        await runtime.dispose();
      }
      assert.deepEqual(restoreCalls, [{ step: "getAgentRun", runId: terminalRun.run_id }]);
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
    target.__WORKHUB_CUU_QA_SCENARIO__ = originalQaScenario;
    Object.defineProperty(target, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("pet surface localizes fixed approval bubble controls in English", () => {
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "Choose one reason so Cuu can revise with it.",
    include_reject_reasons: true,
    locale: "en-US"
  });

  assert.match(card.html, /class="wh-pet-kind">Approval/u);
  assert.match(card.html, /class="wh-pet-priority" data-priority="urgent">Urgent/u);
  assert.match(card.html, /class="wh-pet-evidence-title">Evidence/u);
  assert.match(card.html, /data-pet-reason="Not enough evidence"/u);
  assert.doesNotMatch(card.html, /data-pet-reason="证据不足"|class="wh-pet-kind">审批|>急</u);

  const idle = renderDesktopPetSurface({ locale: "en-US", requested_model_pack_id: "cuu-tororo-live2d-cubism2" });
  assert.match(idle.html, /Cuu settings/u);
  assert.match(idle.html, /Black cat/u);
  assert.match(idle.html, /White cat/u);
  assert.match(idle.html, /data-pet-menu-model="cuu-tororo-live2d-cubism2" aria-pressed="true"/u);
  assert.match(idle.html, /data-pet-menu-locale="en-US" aria-pressed="true"/u);
  assert.doesNotMatch(idle.html, /Cuu 设置|黑猫|白猫/u);
});

test("pet surface starts with a non-static runtime action fixture and fast idle cadence", () => {
  assert.equal(desktopPetInitialIdleAction, "idle_tail_sway");

  const idle = renderDesktopPetSurface({ idle_action: desktopPetInitialIdleAction });
  assert.match(idle.html, /data-cuu-idle-action="idle_tail_sway"/u);
  assert.match(idle.html, /data-cuu-live2d-runtime="live2d_cubism2_cat"/u);
  assert.equal(idle.live2d.motion_state, "idle_tail_sway");

  const scheduler = createCuuIdleScheduler({
    now_ms: 0,
    policy: desktopPetAliveIdlePolicy,
    random: () => 0
  });
  assert.deepEqual([scheduler.tick({ now_ms: 1200 }).action, scheduler.snapshot().last_action], ["idle_blink", "idle_blink"]);
  assert.equal(scheduler.tick({ now_ms: 2200 }).action, "idle_tail_sway");
  assert.equal(scheduler.tick({ now_ms: 3200, cursor_near: true }).action, "look_at_mouse");
});

test("desktop pet scheduler factory uses the lively first-screen cadence", () => {
  const scheduler = createDesktopPetIdleScheduler(0);
  assert.equal(desktopPetPointerSmoothingAlpha, 0.58);
  assert.equal(scheduler.tick({ now_ms: 1800 }).reason, "blink_due");
});

test("pet surface renders compact fallback while card mode is not confirmed", () => {
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    window_mode_error: "Cannot switch Cuu pet window to card: Tauri invoke bridge is unavailable.",
    window_mode_status: "failed"
  });

  assert.match(card.html, /data-pet-window-mode="body_only"/u);
  assert.match(card.html, /data-pet-card-layout="compact"/u);
  assert.match(card.html, /data-pet-window-mode-status="failed"/u);
  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.css, /data-pet-card-layout=compact\] \.wh-pet-bubble\{left:auto;right:calc\(8px \* var\(--wh-pet-scale,1\)\);top:auto;bottom:calc\(224px \* var\(--wh-pet-scale,1\)\)/u);
  assert.doesNotMatch(card.html, /data-cuu-action-id="request_changes"/u);
  assert.doesNotMatch(card.html, /data-pet-reason/u);
});

test("pet surface hides transient compact cards while the Cuu window is expanding", () => {
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    window_mode_error: "Cuu 正在展开审批卡片。",
    window_mode_status: "syncing"
  });

  assert.match(card.html, /data-pet-window-mode="body_only"/u);
  assert.match(card.html, /data-pet-card-layout="compact"/u);
  assert.match(card.html, /data-pet-window-mode-status="syncing"/u);
  assert.match(card.html, /data-cuu-behavior-state="asking_approval"/u);
  assert.doesNotMatch(card.html, /class="wh-pet-bubble"/u);
  assert.doesNotMatch(card.html, /data-cuu-card-id="approval-card"/u);
});

test("pet surface keeps completion cards as anchored celebration tips", () => {
  const card = renderDesktopPetSurface({ card: completionCard() });

  assert.match(card.html, /data-pet-window-mode="card"/u);
  assert.match(card.html, /data-pet-card-layout="full"/u);
  assert.match(card.html, /data-pet-bubble-kind="completion"/u);
  assert.match(card.html, /data-cuu-live2d-motion="celebrating_jump"/u);
  assert.match(card.html, /data-cuu-behavior-expected-window-mode="card"/u);
  assert.match(card.html, /data-cuu-behavior-expected-bubble-mode="tip"/u);
  assert.match(card.html, /data-cuu-action-id="view_replay"/u);
  assert.equal(desktopPetWindowModeForCard(completionCard()), "card");
});

test("pet surface keeps same-card progress updates from animating the bubble opacity", () => {
  const runCard = cardFromAgentRunLive(petHarnessRun(), { locale: "zh-CN" });
  const firstRender = renderDesktopPetSurface({ card: runCard, status_text: "Cuu 开始处理了" });
  const progressUpdate = renderDesktopPetSurface({
    card: runCard,
    status_text: "Cuu 更新了进度：正在整理下一步",
    suppress_bubble_intro: true
  });

  assert.match(firstRender.html, /data-pet-suppress-bubble-intro="false"/u);
  assert.match(progressUpdate.html, /data-pet-suppress-bubble-intro="true"/u);
  // R9 批次0-3：入场动画恢复为常驻 CSS，同卡更新靠 data-pet-suppress-bubble-intro 属性抑制重播。
  assert.match(firstRender.css, /animation:wh-pet-bubble-in \.34s ease-out both/u);
  assert.match(progressUpdate.css, /data-pet-suppress-bubble-intro=true\] \.wh-pet-bubble\{animation:none/u);
});

test("pet surface anchors full card bubbles near the Cuu body instead of the left window edge", () => {
  const card = renderDesktopPetSurface({ card: approvalCard() });

  assert.match(card.html, /data-pet-window-mode="card"/u);
  assert.match(card.html, /data-pet-card-layout="full"/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-body\{right:calc\(72px \* var\(--wh-pet-scale,1\)\);bottom:calc\(48px \* var\(--wh-pet-scale,1\)\);width:calc\(240px \* var\(--wh-pet-scale,1\)\);height:calc\(320px \* var\(--wh-pet-scale,1\)\)\}/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{left:calc\(88px \* var\(--wh-pet-scale,1\)\);right:auto;top:auto;bottom:calc\(392px \* var\(--wh-pet-scale,1\)\);width:calc\(300px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(card.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{[^}]*max-width:calc\(100% - calc\(128px \* var\(--wh-pet-scale,1\)\)\)/u);
  assert.doesNotMatch(card.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{left:auto;right:calc/u);
});

test("pet surface keeps offline Cuu fully visible in card mode", () => {
  const card = renderDesktopPetSurface({ card: offlineCard() });

  assert.match(card.html, /data-cuu-state="offline"/u);
  assert.match(card.html, /data-cuu-live2d-motion="worried_ears"/u);
  assert.doesNotMatch(card.html, /data-cuu-live2d-motion="offline_sleep"/u);
  assert.equal(card.live2d.motion_state, "worried_ears");
});

test("pet surface passes the Cuu independent desktop visual QA contract", () => {
  const idle = renderDesktopPetSurface({ idle_action: "idle_tail_sway" });
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true
  });
  const report = createDesktopPetVisualQaReport({ idle, card });

  assert.deepEqual(report.failed_checks, []);
  assert.equal(report.passed, true);
  assertDesktopPetVisualQaPass(report);
});

test("pet window bridge resolves body/card modes and Tauri-like commands", async () => {
  const calls: string[] = [];
  const mockBridge = {
    setMode(mode: "body_only" | "card") {
      calls.push(`mode:${mode}`);
    }
  };
  assert.equal(desktopPetWindowModeForCard(undefined), "body_only");
  assert.equal(desktopPetWindowModeForCard(approvalCard()), "card");
  assert.equal(desktopPetWindowModeForCard(completionCard()), "card");
  assert.equal(resolveDesktopPetWindowBridge({ __WORKHUB_PET__: mockBridge }), mockBridge);

  const tauri = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          calls.push(`${command}:${args?.mode ?? args?.scalePercent ?? ""}`);
          if (command === "set_pet_window_mode") {
            return { placement: { mode: args?.mode, size: { width: 520, height: 720 } } };
          }
          if (command === "set_pet_window_settings") {
            return {
              settings: {
                scalePercent: args?.scalePercent,
                opacityPercent: args?.opacityPercent,
                passThrough: args?.passThrough,
                hideOnHover: args?.hideOnHover
              }
            };
          }
          return command === "sample_pet_cursor_near";
        }
      },
      window: {
        getCurrentWindow() {
          return {
            startDragging() {
              calls.push("startDragging");
            }
          };
        }
      }
    }
  });

  await tauri?.setMode?.("card");
  await tauri?.setSettings?.({ scale_percent: 125, opacity_percent: 80, pass_through: true, hide_on_hover: true });
  await tauri?.startDragging?.();
  await tauri?.focusMainRoute?.("/settings");
  await tauri?.showPetWindow?.();
  await tauri?.hidePetWindow?.();
  assert.equal(await tauri?.sampleCursorNear?.(), true);
  assert.deepEqual(calls, [
    "set_pet_window_mode:card",
    "set_pet_window_settings:125",
    "startDragging",
    "focus_main_route:",
    "show_pet_window:",
    "hide_pet_window:",
    "sample_pet_cursor_near:"
  ]);

  const scaledTauri = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          calls.push(`scaled:${command}:${args?.mode ?? ""}`);
          if (command === "set_pet_window_mode") {
            return { placement: { mode: args?.mode, size: { width: 390, height: 540 } } };
          }
          return {};
        }
      }
    }
  });
  await scaledTauri?.setMode?.("card");
  assert.equal(calls.at(-1), "scaled:set_pet_window_mode:card");
});

test("pet window bridge relays notification clicks to the native focus_system_notification command", async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          calls.push({ command, args });
          return {};
        }
      }
    }
  });
  const plan = {
    id: "evt-approval",
    event: "permission.ask",
    title: "Cuu needs your approval",
    body: "Open WorkHub to allow, deny, or remember this rule.",
    urgency: "urgent" as const,
    route: "/approvals?approvalId=approval-1",
    windowControl: {
      label: "main",
      action: "show_and_focus" as const,
      source: "system_notification" as const,
      focus: true,
      reason: "focus-main-route",
      route: "/approvals?approvalId=approval-1"
    },
    streamKind: "me",
    streamPath: "/api/push/stream/me"
  };

  await bridge?.focusSystemNotification?.(plan);

  assert.deepEqual(calls, [{ command: "focus_system_notification", args: { plan } }]);
});

test("pet window bridge wires dynamic click-through (cursor probe + ignore toggle)", async () => {
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          calls.push({ command, args });
          if (command === "pet_cursor_client_position") {
            return { x: 12, y: 34, inside: true };
          }
          return {};
        }
      },
      window: {
        getCurrentWindow() {
          return { label: "pet" };
        }
      }
    }
  });

  // 命中测试要用的客户区坐标按原值透传；穿透切换调用 set_pet_window_click_through 并带 ignore 实参。
  assert.deepEqual(await bridge?.cursorClientPosition?.(), { x: 12, y: 34, inside: true });
  await bridge?.setClickThrough?.(true);
  await bridge?.setClickThrough?.(false);
  assert.deepEqual(
    calls.map((call) => call.command),
    ["pet_cursor_client_position", "set_pet_window_click_through", "set_pet_window_click_through"]
  );
  assert.deepEqual(calls[1]?.args, { ignore: true });
  assert.deepEqual(calls[2]?.args, { ignore: false });

  // 坏返回值安全降级为「窗口外」——命中测试不会把缝隙误判成可点击区。
  const degraded = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke() {
          return null;
        }
      },
      window: {
        getCurrentWindow() {
          return { label: "pet" };
        }
      }
    }
  });
  assert.deepEqual(await degraded?.cursorClientPosition?.(), { x: 0, y: 0, inside: false });
});

test("pet window bridge rejects unavailable invoke and maps preferences", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      window: {
        getCurrentWindow() {
          return { label: "pet" };
        }
      }
    }
  });

  assert.equal(bridge?.diagnostics?.invoke_available, false);
  await assert.rejects(
    async () => bridge?.setMode?.("card"),
    /Tauri invoke bridge is unavailable/u
  );
  assert.deepEqual(
    desktopPetWindowSettingsFromPreferences({
      pet_scale_percent: 150,
      pet_opacity_percent: 60,
      pet_pass_through: true,
      pet_hide_on_hover: true
    }),
    { scale_percent: 150, opacity_percent: 60, pass_through: true, hide_on_hover: true }
  );
});

// ── R23 F-04（升级转交端到端）─────────────────────────────────────────────────────
// 桌宠气泡里塞不下一份花名册下拉，但此前的做法是把「转交他人」整个剥掉（rank8 的
// stripUnsupportedPetActions），于是升级转交在桌宠这一端彻底没有入口。现在按钮留着，
// 点它把主窗口的决策队列打开到这张卡，选人在那边完成。
test("R23 F-04 pet hand-off action maps to the main-window decision queue, named at that card", () => {
  assert.equal(
    desktopPetDelegateMainRoute("/api/escalations/esc-1/delegate"),
    "/approvals?id=esc-1"
  );
  assert.equal(
    desktopPetDelegateMainRoute("/api/approvals/approval-1/delegate"),
    "/approvals?id=approval-1"
  );
  // id 进查询串要编码，否则带斜杠/问号的 id 会把路由本身改写掉。
  assert.equal(
    desktopPetDelegateMainRoute("/api/escalations/esc%201/delegate"),
    "/approvals?id=esc%201"
  );
  // 别的动作一律不认——这个分支排在桌宠其它 href 分类之前，认错了会把正常动作吞成一次导航。
  assert.equal(desktopPetDelegateMainRoute("/api/escalations/esc-1/resolve"), undefined);
  assert.equal(desktopPetDelegateMainRoute("/approvals"), undefined);
  assert.equal(desktopPetDelegateMainRoute(null), undefined);
  assert.equal(desktopPetDelegateMainRoute(undefined), undefined);
});

test("R23 F-04 pet surface keeps the hand-off action and opens the main window on that card", async () => {
  const escalationId = "50000000-0000-4000-8000-000000000f04";
  const escalation: AttentionItem = {
    id: escalationId,
    kind: "escalation",
    priority: "urgent",
    work_item_id: "50000000-0000-4000-8000-000000000f05",
    source_ref: { entity_type: "escalation_event", entity_id: escalationId },
    title: "《供应延期》卡住了",
    summary_text: "供应商没回复，等你拿主意。",
    reason_text: "供应商没回复，等你拿主意。",
    actions: [
      { id: "escalation_pm_mode", label: "我来定方向", style: "primary", method: "POST", href: `/api/escalations/${escalationId}/resolve` },
      { id: "escalation_delegate", label: "转交他人", style: "secondary", method: "POST", href: `/api/escalations/${escalationId}/delegate` }
    ],
    cuu_state: "worried",
    created_at: "2026-09-05T01:00:00.000Z"
  };
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const listen: DesktopShellListen = (eventName, handler) => {
    handlers.set(eventName, handler);
    return () => handlers.delete(eventName);
  };
  const focusedMainRoutes: string[] = [];
  const client = {
    ...createPetHarnessClient([]),
    pages: {
      attention: async () => ({ primary: null, queue: [] })
    }
  } as unknown as DesktopPetSurfaceClient;
  const target = globalThis as typeof globalThis & { __WORKHUB_CUU_QA_LOCALE__?: unknown };
  const originalQaLocale = target.__WORKHUB_CUU_QA_LOCALE__;
  target.__WORKHUB_CUU_QA_LOCALE__ = "zh-CN";

  try {
    await withFakePetDom(async (root) => {
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client,
        listen,
        petWindowBridge: {
          setMode() {},
          focusMainRoute(route) {
            focusedMainRoutes.push(route);
          }
        }
      });
      try {
        handlers.get("push-event")?.({
          payload: shellPayload(eventTypes.permissionAsk, {
            summary_text: escalation.summary_text,
            attention: escalation
          })
        });
        await waitForFakePetCardMode();

        // 动作留在卡上了（此前会被 stripUnsupportedPetActions 剥掉）。
        assert.match(root.innerHTML, /data-cuu-action-id="escalation_delegate"/u);
        assert.match(root.innerHTML, /转交他人/u);

        const delegate = await root.click(fakePetTarget({
          href: `/api/escalations/${escalationId}/delegate`,
          "data-cuu-action-id": "escalation_delegate"
        }, "a"));
        await waitForFakePetCardMode();

        assert.equal(delegate.defaultPrevented, true);
        assert.deepEqual(focusedMainRoutes, [`/approvals?id=${escalationId}`]);
        // 说清为什么跳走——否则用户只看到窗口一闪。
        assert.match(root.innerHTML, /转交要先选人，已在主窗口打开这条待办/u);
      } finally {
        await runtime.dispose();
      }
    });
  } finally {
    target.__WORKHUB_CUU_QA_LOCALE__ = originalQaLocale;
  }
});
