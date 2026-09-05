import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client";

import type { SpotlightViewContext } from "../view-context.js";
import { createNewProjectView, newProjectHtml } from "./new-project.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public disabled = false;
  public value = "";
  public focusCalls = 0;

  constructor(private readonly selectors = new Set<string>()) {}

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  matches(selector: string): boolean {
    return this.selectors.has(selector);
  }

  focus() {
    this.focusCalls += 1;
  }
}

class NameInput extends FakeElement {
  constructor() {
    super(new Set(["[data-new-project-name]"]));
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  public readonly nameInput = new NameInput();
  public readonly submitButton = new FakeElement(new Set(["[data-new-project-submit]"]));
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];
  private readonly inputListeners: Array<(event: { target: unknown }) => void> = [];
  private readonly keydownListeners: Array<(event: unknown) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const bucket = type === "click" ? this.clickListeners : type === "input" ? this.inputListeners : type === "keydown" ? this.keydownListeners : undefined;
    if (!bucket) return;
    bucket.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    if (selector === "[data-new-project-name]") return this.nameInput as unknown as T;
    if (selector === "[data-new-project-submit]") return this.submitButton as unknown as T;
    return null;
  }

  click(target: FakeElement) {
    for (const listener of this.clickListeners) listener({ target });
  }

  type(value: string) {
    this.nameInput.value = value;
    for (const listener of this.inputListeners) listener({ target: this.nameInput });
  }

  pressEnter(options: { isComposing?: boolean; keyCode?: number } = {}) {
    let defaultPrevented = false;
    const event = {
      target: this.nameInput,
      key: "Enter",
      isComposing: options.isComposing ?? false,
      keyCode: options.keyCode ?? 13,
      preventDefault: () => {
        defaultPrevented = true;
      }
    };
    for (const listener of this.keydownListeners) listener(event);
    return defaultPrevented;
  }
}

async function withFakeHtmlElement<T>(run: () => Promise<T> | T): Promise<T> {
  const globals = globalThis as unknown as { HTMLElement?: unknown };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previous;
  }
}

function baseCtx(body: FakeBody, overrides: Partial<SpotlightViewContext> = {}): SpotlightViewContext {
  return {
    body: body as unknown as HTMLElement,
    locale: "zh-CN",
    client: {} as never,
    back() {},
    open() {},
    setSubtitle() {},
    toast() {},
    requestResize() {},
    refocusBody() {},
    signal: new AbortController().signal,
    ...overrides
  } as SpotlightViewContext;
}

test("newProjectHtml disables submit until a non-empty name is entered", () => {
  const empty = newProjectHtml(true, { name: "", submitting: false });
  assert.match(empty, /data-new-project-submit disabled/u);

  const named = newProjectHtml(true, { name: "客户复盘项目", submitting: false });
  assert.doesNotMatch(named, /data-new-project-submit disabled/u);
});

test("newProjectHtml never carries a real company name in its placeholder (L-03)", () => {
  const zh = newProjectHtml(true, { name: "", submitting: false });
  const en = newProjectHtml(false, { name: "", submitting: false });
  assert.doesNotMatch(zh, /泰诺麦博/u);
  assert.match(zh, /产品路线图/u);
  assert.match(en, /Product roadmap/u);
});

test("严重 #8: submitting a name creates a real project, opens its workbench, and confirms — instead of the old bare open-workbench no-op", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    const bootstrapCalls: Array<{ name?: string }> = [];
    const invokeCalls: Array<[string, Record<string, unknown> | undefined]> = [];
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    let resetCount = 0;

    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          invokeCalls.push([command, args]);
          return undefined;
        }
      }
    };
    const storageValues = new Map<string, string>();
    const globals = globalThis as unknown as { window?: unknown };
    globals.window = {
      localStorage: {
        getItem: (key: string) => storageValues.get(key) ?? null,
        setItem: (key: string, value: string) => storageValues.set(key, value),
        removeItem: (key: string) => storageValues.delete(key)
      }
    };

    try {
      createNewProjectView().mount(
        baseCtx(body, {
          client: {
            async bootstrapProject(payload: { name?: string }) {
              bootstrapCalls.push(payload);
              return { project: { id: "p-1", name: payload.name }, created: true, context_ready: true };
            }
          } as never,
          toast: (message: string, tone?: string) => {
            toasts.push({ message, tone });
          },
          resetShell: () => {
            resetCount += 1;
          }
        })
      );

      body.type("客户复盘项目");
      body.click(body.submitButton);
      await tick();
      await tick();

      assert.deepEqual(bootstrapCalls, [{ name: "客户复盘项目" }]);
      assert.deepEqual(invokeCalls, [["open_workbench", { projectId: "p-1" }]]);
      assert.equal(resetCount, 1, "resetShell was called so the box collapses back to idle, not left expanded over the workbench");
      assert.ok(toasts.some((t) => t.tone === "ok" && /客户复盘项目/u.test(t.message)));
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
      delete globals.window;
    }
  });
});

test("an empty name is rejected inline and never calls bootstrapProject", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let called = false;
    createNewProjectView().mount(
      baseCtx(body, {
        client: {
          async bootstrapProject() {
            called = true;
            return { project: { id: "p-1", name: "" }, created: true, context_ready: true };
          }
        } as never
      })
    );

    body.click(body.submitButton);
    await tick();

    assert.equal(called, false);
    assert.match(body.innerHTML, /先给项目起个名字/u);
  });
});

test("pressing Enter in the name field submits (single-field form convention), but not while an IME composition is in progress", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    let calls = 0;
    createNewProjectView().mount(
      baseCtx(body, {
        client: {
          async bootstrapProject() {
            calls += 1;
            return { project: { id: "p-1", name: "x" }, created: true, context_ready: true };
          }
        } as never
      })
    );

    body.type("x");
    const preventedDuringComposition = body.pressEnter({ isComposing: true });
    await tick();
    assert.equal(calls, 0, "a composing Enter (choosing an IME candidate) must not submit");
    assert.equal(preventedDuringComposition, false);

    const prevented = body.pressEnter();
    await tick();
    assert.equal(prevented, true);
    assert.equal(calls, 1);
  });
});

test("a server-side failure surfaces the server's own message, not a generic one, and lets the user retry", async () => {
  await withFakeHtmlElement(async () => {
    const body = new FakeBody();
    createNewProjectView().mount(
      baseCtx(body, {
        client: {
          async bootstrapProject() {
            throw new WorkHubApiError(409, "project_slug_conflict", "这个项目标识已被占用。");
          }
        } as never
      })
    );

    body.type("重名项目");
    body.click(body.submitButton);
    await tick();

    assert.match(body.innerHTML, /这个项目标识已被占用。/u);
    // the field keeps the typed name so the user can just edit it, not retype from scratch
    assert.match(body.innerHTML, /value="重名项目"/u);
  });
});

test("without a Tauri bridge (browser dev preview), the project is still created and the shell still resets — it just skips opening a native window", async () => {
  await withFakeHtmlElement(async () => {
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    const body = new FakeBody();
    let resetCount = 0;
    const toasts: Array<{ message: string; tone?: string | undefined }> = [];
    createNewProjectView().mount(
      baseCtx(body, {
        client: {
          async bootstrapProject(payload: { name?: string }) {
            return { project: { id: "p-1", name: payload.name }, created: true, context_ready: true };
          }
        } as never,
        toast: (message: string, tone?: string) => {
          toasts.push({ message, tone });
        },
        resetShell: () => {
          resetCount += 1;
        }
      })
    );

    body.type("预览环境项目");
    body.click(body.submitButton);
    await tick();

    assert.equal(resetCount, 1);
    assert.ok(toasts.some((t) => t.tone === "ok"));
  });
});
