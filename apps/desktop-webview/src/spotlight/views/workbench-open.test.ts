import assert from "node:assert/strict";
import test from "node:test";

import type { SpotlightViewContext } from "../view-context.js";
import { createWorkbenchOpenView } from "./workbench-open.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  constructor(private readonly selectors = new Set<string>()) {}

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }
}

class FakeBody extends FakeElement {
  public innerHTML = "";
  private readonly clickListeners: Array<(event: { target: unknown }) => void> = [];

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type !== "click") {
      return;
    }
    this.clickListeners.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
  }

  click(target: FakeElement) {
    for (const listener of this.clickListeners) {
      listener({ target });
    }
  }
}

// run 通常是 async——必须 await 它再复原，否则 finally 在 await tick() 之前就跑完，
// 把 HTMLElement 补丁提前撤了（曾经踩过：body.click() 时 instanceof HTMLElement 炸 TypeError）。
async function withFakeHTMLElement<T>(run: () => Promise<T> | T): Promise<T> {
  const globals = globalThis as typeof globalThis & { HTMLElement: typeof HTMLElement };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
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
    client: {} as SpotlightViewContext["client"],
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

test("workbench view shows an honest unavailable state when there is no Tauri bridge (browser dev preview)", async () => {
  delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  const body = new FakeBody();
  createWorkbenchOpenView("workbench").mount(baseCtx(body));
  assert.match(body.innerHTML, /只在桌面客户端里可用/u);
  assert.doesNotMatch(body.innerHTML, /已打开/u);
});

test("workbench view invokes the real open_workbench Tauri command with the target project id", async () => {
  await withFakeHTMLElement(async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          calls.push([command, args]);
          return undefined;
        }
      }
    };
    try {
      const body = new FakeBody();
      createWorkbenchOpenView("workbench").mount(
        baseCtx(body, { target: { id: "project-1", label: "星尘短剧" } })
      );
      await tick();
      assert.deepEqual(calls, [["open_workbench", { projectId: "project-1" }]]);
      assert.match(body.innerHTML, /已在工作台窗口打开「星尘短剧」/u);
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    }
  });
});

test("the 'new project' entry always opens bare (never leaks a stray project id from spotlight context)", async () => {
  await withFakeHTMLElement(async () => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async (command: string, args?: Record<string, unknown>) => (calls.push([command, args]), undefined) }
    };
    try {
      const body = new FakeBody();
      createWorkbenchOpenView("new_project", { bare: true }).mount(
        baseCtx(body, { target: { id: "project-1", label: "星尘短剧" } })
      );
      await tick();
      assert.deepEqual(calls, [["open_workbench", {}]]);
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    }
  });
});

test("a failed invoke renders a retry affordance that is wired to a real retry, not a dead button", async () => {
  await withFakeHTMLElement(async () => {
    let attempts = 0;
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: {
        invoke: async () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("window creation failed");
          }
          return undefined;
        }
      }
    };
    try {
      const body = new FakeBody();
      createWorkbenchOpenView("workbench").mount(baseCtx(body));
      await tick();
      assert.match(body.innerHTML, /没打开工作台窗口/u);
      assert.equal(attempts, 1);

      body.click(new FakeElement(new Set(["[data-spot-retry]"])));
      await tick();
      assert.equal(attempts, 2);
      assert.match(body.innerHTML, /已打开工作台窗口/u);
    } finally {
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    }
  });
});
