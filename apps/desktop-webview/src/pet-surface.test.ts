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
  defaultDesktopPetPointerSnapshot,
  desktopPetAliveIdlePolicy,
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
  assert.doesNotMatch(surface.html, /data-cuu-action-id="abort_agent_run"/u);
  assert.doesNotMatch(surface.html, /Cuu updated progress: Cuu desktop entry task/u);
  assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{[^}]*bottom:calc\(392px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-body\{[^}]*bottom:calc\(48px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*max-height:calc\(336px \* var\(--wh-pet-scale,1\)\);overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-title\{[^}]*-webkit-line-clamp:2/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-message\{[^}]*-webkit-line-clamp:2/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-section-line,\.wh-pet-surface\[data-pet-card-has-context=true\] \.wh-pet-evidence-item\{-webkit-line-clamp:1\}/u);
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
