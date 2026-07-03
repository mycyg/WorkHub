import assert from "node:assert/strict";
import { test } from "node:test";

import { createIntakeView, defaultSelectedOptionIds, doneHtml, startHtml } from "./intake.js";

class FakeElement {
  public dataset: Record<string, string> = {};
  public disabled = false;
  public textContent = "";
  public value = "";

  constructor(private readonly selectors = new Set<string>()) {}

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  focus() {}
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  public readonly intent = new FakeElement();
  public readonly actionButton = new FakeElement();
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "click") return;
    this.clickListeners.push((event) => {
      if (typeof listener === "function") {
        listener(event as Event);
      } else {
        listener.handleEvent(event as Event);
      }
    });
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    if (selector === "[data-intent]") {
      return this.intent as unknown as T;
    }
    if (selector === "[data-submit],[data-start]") {
      return this.actionButton as unknown as T;
    }
    return null;
  }

  querySelectorAll<T extends Element = Element>(): T[] {
    return [];
  }

  click(selector: string) {
    const target = new FakeElement(new Set([selector]));
    for (const listener of this.clickListeners) {
      listener({ target });
    }
  }
}

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

test("S4b desktop intake start shows the bound project when a label is supplied", () => {
  const html = startHtml(true, "客户复盘项目");
  assert.ok(html.includes('data-intake-project="客户复盘项目"'), "carries the project marker");
  assert.ok(html.includes("项目：客户复盘项目"), "shows the project name pill");
  // the intent textarea + start button are still present
  assert.ok(html.includes("data-intent"), "intent input present");
  assert.ok(html.includes("data-start"), "start button present");
});

test("S4b desktop intake start stays generic (no project pill) when no label is supplied", () => {
  const html = startHtml(false);
  assert.ok(!html.includes("data-intake-project"), "no project marker when unbound");
  assert.ok(!html.includes("Project:"), "no project pill when unbound");
  assert.ok(html.includes("data-intent") && html.includes("data-start"), "generic start intact");
});

test("desktop intake defaults the recommended single-choice option", () => {
  const selected = defaultSelectedOptionIds({
    id: "scope",
    title: "这件事先按哪种交付方式处理？",
    input_mode: "single_choice",
    options: [
      { id: "document-draft", label: "文档/方案草稿" },
      { id: "structured-data", label: "结构化数据" }
    ],
    recommended_option_ids: ["document-draft"],
    free_text: { enabled: true, collapsed_by_default: true },
    progress: [],
    evidence_refs: [],
    submit: { method: "POST", href: "/next" }
  });
  assert.deepEqual([...selected], ["document-draft"]);
});

test("desktop intake does not auto-answer multi-choice questions", () => {
  const selected = defaultSelectedOptionIds({
    id: "checks",
    title: "要检查哪些部分？",
    input_mode: "multi_choice",
    options: [
      { id: "ui", label: "UI" },
      { id: "api", label: "API" }
    ],
    recommended_option_ids: ["ui"],
    free_text: { enabled: true, collapsed_by_default: true },
    progress: [],
    evidence_refs: [],
    submit: { method: "POST", href: "/next" }
  });
  assert.equal(selected.size, 0);
});

test("desktop intake defaults the recommended confirm action", () => {
  const selected = defaultSelectedOptionIds({
    id: "confirm",
    title: "是否按这个方向创建事项？",
    input_mode: "confirm",
    options: [
      { id: "create", label: "创建事项" },
      { id: "evidence", label: "先找证据" }
    ],
    recommended_option_ids: ["create"],
    free_text: { enabled: true, collapsed_by_default: true },
    progress: [],
    evidence_refs: [],
    submit: { method: "POST", href: "/create" }
  });
  assert.deepEqual([...selected], ["create"]);
});

test("R9.7 desktop intake created state avoids dispatch copy", () => {
  const zh = doneHtml("WH-9", "客户访谈摘要", true);
  const en = doneHtml("WH-9", "Interview summary", false);

  assert.doesNotMatch(zh, /派活/u);
  assert.doesNotMatch(en, /Dispatch|dispatch/u);
  assert.match(zh, /再建一个任务/u);
  assert.match(en, /Create another task/u);
});

test("R9.7 desktop intake created toast avoids dispatch copy", async () => {
  const globals = globalThis as unknown as { HTMLElement?: unknown };
  const previousHTMLElement = globals.HTMLElement;
  globals.HTMLElement = FakeElement;
  try {
    const body = new FakeBody();
    body.intent.value = "整理客户访谈";
    const toasts: Array<{ message: string; tone: "ok" | "error" | "info" | undefined }> = [];
    const view = createIntakeView();

    view.mount({
      body: body as unknown as HTMLElement,
      locale: "zh-CN",
      client: {
        async createSession() {
          return {
            session_id: "session-1",
            question: {
              id: "confirm",
              title: "是否创建？",
              input_mode: "confirm",
              options: [{ id: "create", label: "创建工作项" }],
              recommended_option_ids: ["create"],
              free_text: { enabled: false, collapsed_by_default: true },
              progress: [],
              evidence_refs: [],
              submit: { method: "POST", href: "/create" }
            }
          };
        },
        async createWorkItem() {
          return { workitem: { code: "WH-9", title: "客户访谈摘要" } };
        }
      } as never,
      back() {},
      open() {},
      setSubtitle() {},
      toast(message, tone) {
        toasts.push({ message, tone });
      },
      requestResize() {},
      signal: new AbortController().signal
    });

    body.click("[data-start]");
    await tick();
    body.click("[data-submit]");
    await tick();

    const success = toasts.find((toast) => toast.tone === "ok");
    assert.ok(success, "created work item toast was emitted");
    assert.doesNotMatch(success.message, /派活|dispatch/iu);
    assert.match(success.message, /待你过目/u);
  } finally {
    globals.HTMLElement = previousHTMLElement;
  }
});
