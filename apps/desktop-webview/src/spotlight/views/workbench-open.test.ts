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
    resetShell() {},
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
  assert.match(body.innerHTML, /只能在 WorkHub 桌面应用里打开/u);
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

test("selecting a project stashes the pending deep link before invoking (cold-start race mitigation)", async () => {
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
    const storageValues = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => storageValues.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storageValues.set(key, value);
        },
        removeItem: (key: string) => {
          storageValues.delete(key);
        }
      }
    };
    const globals = globalThis as unknown as { window?: unknown };
    try {
      globals.window = fakeWindow;
      const body = new FakeBody();
      createWorkbenchOpenView("workbench").mount(
        baseCtx(body, { target: { id: "project-1", label: "星尘短剧" } })
      );
      // The stash must land synchronously, before the invoke() promise even settles — that is the
      // whole point (see pending-deep-link.ts): it has to be there before Rust creates the window.
      assert.ok(storageValues.has("workhub_workbench_pending_deep_link"));
      const stashed = JSON.parse(storageValues.get("workhub_workbench_pending_deep_link")!) as { projectId?: string };
      assert.equal(stashed.projectId, "project-1");
      await tick();
      assert.deepEqual(calls, [["open_workbench", { projectId: "project-1" }]]);
    } finally {
      delete globals.window;
      delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
    }
  });
});

test("the bare 'new project' entry does not stash anything (there is no project id to route to)", async () => {
  await withFakeHTMLElement(async () => {
    (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke: async () => undefined }
    };
    const storageValues = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => storageValues.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storageValues.set(key, value);
        },
        removeItem: (key: string) => {
          storageValues.delete(key);
        }
      }
    };
    const globals = globalThis as unknown as { window?: unknown };
    try {
      globals.window = fakeWindow;
      const body = new FakeBody();
      createWorkbenchOpenView("new_project", { bare: true }).mount(
        baseCtx(body, { target: { id: "project-1", label: "星尘短剧" } })
      );
      await tick();
      assert.equal(storageValues.size, 0);
    } finally {
      delete globals.window;
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

// R13 收尾:动作完成后聚焦盒复位回首页搜索态——成功路径在短暂展示后调度 resetShell,
// 且盒子被关掉(signal abort)时不复位(定时器已清)。
test("a successful open schedules a shell reset back to the idle launcher, cancelled by abort", async () => {
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
    core: { invoke: async () => undefined }
  };
  const body = new FakeBody();
  const abort = new AbortController();
  let resets = 0;
  const previousSetTimeout = globalThis.setTimeout;
  const scheduled: Array<() => void> = [];
  (globalThis as { setTimeout: unknown }).setTimeout = ((fn: () => void) => {
    scheduled.push(fn);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  try {
    createWorkbenchOpenView("workbench").mount(
      baseCtx(body, { signal: abort.signal, resetShell: () => { resets += 1; } })
    );
    await new Promise((resolve) => previousSetTimeout(resolve, 0));
    assert.equal(scheduled.length >= 1, true);
    scheduled.forEach((fn) => fn());
    assert.equal(resets, 1);
  } finally {
    (globalThis as { setTimeout: unknown }).setTimeout = previousSetTimeout;
    delete (globalThis as { __TAURI__?: unknown }).__TAURI__;
  }
});
