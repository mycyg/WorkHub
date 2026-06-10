import assert from "node:assert/strict";
import test from "node:test";

import { WorkHubApiError } from "@workhub/api-client";
import { cardFromAgentRunLive, createCuuIdleScheduler, cuuMotionForState, type CuuCard } from "@workhub/cuu";
import type { AgentRunLiveVM, SessionVM, WorkItemDetailVM } from "@workhub/contracts";

import {
  cardFromDesktopCuuRuntimeError,
  createDesktopCuuAgentLauncherCard,
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
  renderDesktopPetSurface,
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
          title: "这件事先按哪种交付方式处理？",
          body: "Cuu 会先按你点选的交付方向继续。",
          input_mode: "single_choice",
          options: [
            {
              id: "document-draft",
              label: "文档/方案草稿",
              description: "周报、方案、PR 式变更说明",
              icon: "file-text"
            },
            {
              id: "structured-data",
              label: "结构化数据",
              description: "JSON、YAML、CSV 或表格分析",
              icon: "table"
            }
          ],
          recommended_option_ids: ["document-draft"],
          free_text: { enabled: true, collapsed_by_default: true, max_length: 300 },
          progress: [
            { key: "intent", label: "需求", state: "done" },
            { key: "scope", label: "口径", state: "active" },
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

function resolveHarnessAction(card: CuuCard, actionId: string) {
  const action = card.actions.find((candidate) => candidate.id === actionId);
  assert.ok(action?.href);
  const resolved = resolveDesktopCuuAction(action.href, { actionId: action.id, card });
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
        evidence_refs: []
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

  constructor(
    private readonly tagName: string,
    private readonly attributes: Record<string, string> = {}
  ) {
    super();
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

async function completePetBootAgentRunFlow(root: FakePetDomRoot) {
  await root.click(fakePetTarget({ "data-pet-drag-handle": "true" }));
  await root.click(fakePetTarget({ "data-pet-option-id": "document-draft" }));
  await root.click(fakePetTarget({
    href: "/api/cuu/start-agent",
    "data-cuu-action-id": "start_agent_from_cuu"
  }, "a"));
  await root.click(fakePetTarget({ "data-pet-option-id": "document-draft" }));
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
  assert.match(idle.css, /\.wh-pet-menu\{[^}]*right:88px;[^}]*width:164px;[^}]*overflow:hidden/u);
  assert.match(idle.css, /\.wh-pet-menu-row\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.match(idle.css, /\.wh-pet-menu button\{[^}]*min-width:0;max-width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(idle.css, /\.wh-pet-menu-row button\{[^}]*flex:1 1 0;[^}]*padding-left:6px;padding-right:6px;[^}]*overflow:hidden;text-overflow:ellipsis/u);
  assert.match(idle.html, /class="wh-cuu-cat-live2d-frame"/u);
  assert.match(idle.html, /cuu\/live2d\/hijiki\/cuu-hijiki\.html/u);
  assert.match(idle.css, /\.wh-pet-body::after\{content:"";position:absolute;inset:0;z-index:3/u);
  assert.match(idle.css, /\.wh-cuu-cat-live2d-frame\{[^}]*pointer-events:none/u);
  assert.doesNotMatch(idle.html, /wh-cuu-legacy|wh-cuu-atlas|wh-cuu-sprite|experimental_draft_probe/u);
  assert.doesNotMatch(idle.html, /data-cuu-fallback-visual-mode|data-cuu-image-motion/u);
  assert.doesNotMatch(idle.html, /wh-app-shell/u);
  assert.doesNotMatch(idle.html, /textarea|<input\b/iu);

  assert.match(statusOnly.html, /data-pet-window-mode="body_only"/u);
  assert.match(statusOnly.html, /data-pet-card-layout="compact"/u);
  assert.match(statusOnly.html, /data-pet-bubble-transient="true"/u);
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
  assert.match(card.css, /data-pet-window-mode=card\]\[data-pet-card-has-context=true\] \.wh-pet-bubble\{left:calc\(88px \* var\(--wh-pet-scale,1\)\);right:auto;bottom:calc\(392px \* var\(--wh-pet-scale,1\)\);width:calc\(300px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(card.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*max-height:calc\(320px \* var\(--wh-pet-scale,1\)\);overflow:auto;overflow-x:hidden/u);
  assert.match(card.css, /\.wh-pet-bubble>\*\{min-width:0;max-width:100%\}/u);
  assert.match(card.css, /\.wh-pet-progress\{[^}]*min-width:0;max-width:100%;width:100%/u);
  assert.match(card.css, /\.wh-pet-progress-label\{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap/u);
  assert.match(card.css, /\.wh-pet-section-title,\.wh-pet-evidence-title,\.wh-pet-input-hint\{[^}]*width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(card.css, /\.wh-pet-chips,\.wh-pet-actions,\.wh-pet-reasons\{[^}]*min-width:0;max-width:100%;width:100%/u);
  assert.match(card.css, /\.wh-pet-chip,\.wh-pet-action,\.wh-pet-reason\{[^}]*max-width:100%;[^}]*white-space:normal;overflow-wrap:anywhere;word-break:break-word/u);
  assert.match(card.html, /data-cuu-behavior-state="asking_approval"/u);
  assert.match(card.html, /data-cuu-behavior-phase="loop"/u);
  assert.match(card.html, /data-cuu-behavior-expected-window-mode="card"/u);
  assert.match(card.html, /data-cuu-behavior-expected-bubble-mode="card"/u);
  assert.match(card.html, /data-cuu-live2d-motion="asking_approval_bounce"/u);
  assert.match(card.html, /data-cuu-live2d-renderer-state="mtn\/01\.mtn"/u);
  assert.match(card.html, /data-pet-card-has-context="true"/u);
  assert.match(card.html, /class="wh-pet-kind">审批/u);
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
  assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-bubble\{[^}]*bottom:calc\(392px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(surface.css, /data-pet-window-mode=card\] \.wh-pet-body\{[^}]*bottom:calc\(48px \* var\(--wh-pet-scale,1\)\)/u);
  assert.match(surface.css, /data-pet-card-has-context=true\] \.wh-pet-bubble\{[^}]*max-height:calc\(320px \* var\(--wh-pet-scale,1\)\);overflow:auto;overflow-x:hidden/u);
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

test("pet surface renders the Cuu outbound agent launcher as option-first without text input", () => {
  const launcher = renderDesktopPetSurface({ card: createDesktopCuuAgentLauncherCard(), locale: "zh-CN" });
  const english = renderDesktopPetSurface({ card: createDesktopCuuAgentLauncherCard({ locale: "en-US" }), locale: "en-US" });

  assert.match(launcher.html, /data-cuu-card-id="cuu-agent-launcher"/u);
  assert.match(launcher.html, /要让 Cuu 做什么/u);
  assert.match(launcher.html, /data-pet-option-id="document-draft"/u);
  assert.match(launcher.html, /data-cuu-action-id="start_agent_from_cuu"/u);
  assert.match(launcher.html, /href="\/api\/cuu\/start-agent"/u);
  assert.match(launcher.html, /data-pet-input-mode="single_choice"/u);
  assert.doesNotMatch(launcher.html, /textarea|<input\b/iu);

  assert.match(english.html, /What should Cuu do/u);
  assert.match(english.html, /Start work/u);
  assert.doesNotMatch(english.html, /textarea|<input\b/iu);
});

test("pet runtime harness advances launcher selections through clarification into a run card", async () => {
  const calls: unknown[] = [];
  const run = petHarnessRun();
  const client = createPetHarnessClient(calls, run);

  let card = createDesktopCuuAgentLauncherCard({ locale: "zh-CN" });
  let surface = renderDesktopPetSurface({ card, locale: "zh-CN" });
  assert.match(surface.html, /data-cuu-card-id="cuu-agent-launcher"/u);
  assert.match(surface.html, /data-pet-option-id="document-draft"/u);
  assert.match(surface.html, /data-cuu-action-id="start_agent_from_cuu"/u);
  assert.doesNotMatch(surface.html, /textarea|<input\b/iu);

  card = selectHarnessOption(card, "document-draft");
  surface = renderDesktopPetSurface({ card, locale: "zh-CN" });
  assert.match(surface.html, /data-chip-id="document-draft"[^>]+data-selected="true"/u);

  const launcherResult = await submitDesktopCuuAction({
    client,
    action: resolveHarnessAction(card, "start_agent_from_cuu"),
    locale: "zh-CN"
  });
  assert.match(launcherResult.message, /还需要你点选/u);
  assert.equal(launcherResult.card?.payload_ref?.entity_type, "session");
  assert.equal(launcherResult.agentRun, undefined);
  card = launcherResult.card!;
  surface = renderDesktopPetSurface({ card, status_text: launcherResult.message, locale: "zh-CN" });
  assert.match(surface.html, /data-pet-bubble-kind="question"/u);
  assert.match(surface.html, /data-pet-option-id="document-draft"/u);
  assert.match(surface.html, /这件事先按哪种交付方式处理/u);

  card = selectHarnessOption(card, "document-draft");
  const clarificationResult = await submitDesktopCuuAction({
    client,
    action: resolveHarnessAction(card, "submit_option"),
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
        title: "Cuu 桌面入口任务",
        intent_text: "从 Cuu 桌宠入口创建一个 AI 可执行事项，并按已选交付方向施工。\n文档/方案草稿: 周报、说明、PR 式变更说明"
      }
    },
    {
      step: "nextQuestion",
      sessionId: "10000000-0000-4000-8000-000000000201",
      payload: { selected_option_ids: ["document-draft"] }
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
        assert.match(root.innerHTML, /data-pet-option-id="document-draft"/u);
        assert.match(root.innerHTML, /data-cuu-action-id="start_agent_from_cuu"/u);
        assert.doesNotMatch(root.innerHTML, /textarea|<input\b/iu);

        const launcherSelection = await root.click(fakePetTarget({ "data-pet-option-id": "document-draft" }));
        assert.equal(launcherSelection.defaultPrevented, true);
        assert.match(root.innerHTML, /data-chip-id="document-draft"[^>]+data-selected="true"/u);

        const launcherSubmit = await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.equal(launcherSubmit.defaultPrevented, true);
        assert.match(root.innerHTML, /data-pet-bubble-kind="question"/u);
        assert.match(root.innerHTML, /data-pet-option-id="document-draft"/u);
        assert.match(root.innerHTML, /这件事先按哪种交付方式处理/u);
        assert.doesNotMatch(root.innerHTML, /textarea|<input\b/iu);

        const clarificationSelection = await root.click(fakePetTarget({ "data-pet-option-id": "document-draft" }));
        assert.equal(clarificationSelection.defaultPrevented, true);
        assert.match(root.innerHTML, /data-chip-id="document-draft"[^>]+data-selected="true"/u);

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
        title: "Cuu 桌面入口任务",
        intent_text: "从 Cuu 桌宠入口创建一个 AI 可执行事项，并按已选交付方向施工。\n文档/方案草稿: 周报、说明、PR 式变更说明"
      }
    },
    {
      step: "nextQuestion",
      sessionId: "10000000-0000-4000-8000-000000000201",
      payload: { selected_option_ids: ["document-draft"] }
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
        await root.click(fakePetTarget({ "data-pet-option-id": "document-draft" }));
        await root.click(fakePetTarget({
          href: "/api/cuu/start-agent",
          "data-cuu-action-id": "start_agent_from_cuu"
        }, "a"));
        assert.match(root.innerHTML, /data-pet-bubble-kind="question"/u);
        assert.match(root.innerHTML, /这件事先按哪种交付方式处理/u);
      } finally {
        await runtime.dispose();
      }
    });

    const persisted = storage.getItem(desktopPetRunRestoreStorageKey);
    assert.ok(persisted);
    const restoreState = JSON.parse(persisted);
    assert.equal(restoreState.entity_type, "session");
    assert.equal(restoreState.entity_id, "10000000-0000-4000-8000-000000000201");

    await withFakePetDom(async (root) => {
      const restoreCalls: unknown[] = [];
      const runtime = await bootDesktopPetSurface(root as unknown as HTMLElement, {
        client: createPetHarnessClient(restoreCalls)
      });
      try {
        await Promise.resolve();
        await Promise.resolve();
        assert.match(root.innerHTML, /data-pet-bubble-kind="question"/u);
        assert.match(root.innerHTML, /data-pet-payload-ref-entity-type="session"/u);
        assert.match(root.innerHTML, /这件事先按哪种交付方式处理/u);
        assert.match(root.innerHTML, /Cuu 已恢复：这件事先按哪种交付方式处理？/u);
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
