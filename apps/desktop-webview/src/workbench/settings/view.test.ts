import assert from "node:assert/strict";
import { test } from "node:test";

import { WorkHubApiError } from "@workhub/api-client/client";
import type { ProjectAiGovernanceVM } from "@workhub/contracts";

import { defaultEnabledQuietHours, mountProjectSettingsView } from "./view.js";

function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

class FakeElement {
  public dataset: Record<string, string> = {};
  public value = "";

  constructor(private readonly selectors = new Set<string>(), dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  closest<T extends Element = Element>(selector: string): T | null {
    return this.selectors.has(selector) ? (this as unknown as T) : null;
  }

  matches(selector: string): boolean {
    return this.selectors.has(selector);
  }
}

class FakeContainer extends FakeElement {
  public innerHTML = "";
  private readonly listeners = new Map<string, Array<(event: { target: unknown }) => void>>();
  private readonly queryResults = new Map<string, FakeElement>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const bucket = this.listeners.get(type) ?? [];
    bucket.push((event) => {
      if (typeof listener === "function") {
        listener(event as unknown as Event);
      } else {
        listener.handleEvent(event as unknown as Event);
      }
    });
    this.listeners.set(type, bucket);
  }

  setQueryResult(selector: string, element: FakeElement) {
    this.queryResults.set(selector, element);
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return (this.queryResults.get(selector) as unknown as T) ?? null;
  }

  dispatch(type: string, target: FakeElement) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ target });
    }
  }
}

function governanceVm(over: Partial<ProjectAiGovernanceVM> = {}): ProjectAiGovernanceVM {
  return {
    project_id: "90000000-0000-4000-8000-000000000001",
    observer_enabled: true,
    silence_window_seconds: 60,
    quiet_hours: { enabled: false },
    granular_settings: {},
    // R14 批 RISK：ProjectAiGovernanceVM 加了必填 risk_monitor（读侧完整默认值合并输出）——
    // 不是本文件测的功能改动，纯粹是共享契约加字段牵连的机械补齐（设置分区 UI 归 RISK-B 工包）。
    risk_monitor: {
      enabled: true,
      stall_days_threshold: 5,
      deadline_lookahead_days: 2,
      cost_spike_ratio_pct: 300,
      cost_spike_min_cny: 20
    },
    updated_at: null,
    ...over
  };
}

type RecordedRequest = { path: string; init: RequestInit | undefined };

function clientReturning(input: {
  onGet?: () => ProjectAiGovernanceVM | Promise<ProjectAiGovernanceVM>;
  onPatch?: (body: Record<string, unknown>) => ProjectAiGovernanceVM | Promise<ProjectAiGovernanceVM>;
  requests?: RecordedRequest[];
}) {
  return {
    async request<T>(path: string, init?: RequestInit): Promise<T> {
      input.requests?.push({ path, init });
      if (init?.method === "PATCH") {
        if (!input.onPatch) {
          throw new Error("unexpected PATCH");
        }
        return (await input.onPatch(JSON.parse(String(init.body)) as Record<string, unknown>)) as unknown as T;
      }
      if (!input.onGet) {
        throw new Error("unexpected GET");
      }
      return (await input.onGet()) as unknown as T;
    }
  };
}

async function withFakeDomGlobals<T>(run: () => Promise<T>): Promise<T> {
  const globals = globalThis as typeof globalThis & {
    HTMLElement: typeof HTMLElement;
    HTMLInputElement: typeof HTMLInputElement;
  };
  const previousElement = globals.HTMLElement;
  const previousInput = globals.HTMLInputElement;
  globals.HTMLElement = FakeElement as unknown as typeof HTMLElement;
  globals.HTMLInputElement = FakeElement as unknown as typeof HTMLInputElement;
  try {
    return await run();
  } finally {
    globals.HTMLElement = previousElement;
    globals.HTMLInputElement = previousInput;
  }
}

test("mounts, loads governance over the real endpoint path, and renders the editable form", async () => {
  const requests: RecordedRequest[] = [];
  const container = new FakeContainer();
  mountProjectSettingsView(container as unknown as HTMLElement, {
    client: clientReturning({ onGet: () => governanceVm(), requests }),
    locale: "zh-CN",
    projectId: "90000000-0000-4000-8000-000000000001",
    projectName: "星尘短剧",
    editable: true
  });
  await tick();

  assert.equal(requests[0]?.path, "/api/projects/90000000-0000-4000-8000-000000000001/ai-governance");
  assert.match(container.innerHTML, /data-wb-pset-observer\b/u);
  assert.match(container.innerHTML, /项目设置 · 星尘短剧/u);
});

test("a 404 load renders the honest owner-only state instead of a retry dead end", async () => {
  const container = new FakeContainer();
  mountProjectSettingsView(container as unknown as HTMLElement, {
    client: clientReturning({
      onGet: () => {
        throw new WorkHubApiError(404, "ai_governance_not_found", "没有找到可管理的项目 AI 设置。");
      }
    }),
    locale: "zh-CN",
    projectId: "90000000-0000-4000-8000-000000000001",
    projectName: "星尘短剧",
    editable: false
  });
  await tick();

  assert.match(container.innerHTML, /data-wb-pset-owner-only="true"/u);
  assert.doesNotMatch(container.innerHTML, /data-wb-pset-retry/u);
});

test("toggling the observer switch PATCHes observer_enabled with optimistic update and rollback on failure", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    let failPatch = false;
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm({ observer_enabled: true }),
        onPatch: (body) => {
          patched.push(body);
          if (failPatch) {
            throw new WorkHubApiError(500, "internal_error", "boom");
          }
          return governanceVm({ observer_enabled: body.observer_enabled as boolean });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-observer]"])));
    // Optimistic flip to off before the PATCH settles.
    assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);
    await tick();
    assert.deepEqual(patched, [{ observer_enabled: false }]);
    assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);

    // Second toggle fails server-side: rolls back to off and shows the inline error.
    failPatch = true;
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-observer]"])));
    await tick();
    await tick();
    assert.match(container.innerHTML, /data-on="false"[^>]*data-wb-pset-observer/u);
    assert.match(container.innerHTML, /data-wb-pset-error="true"/u);
  });
});

test("the silence-window save button validates the range client-side and PATCHes only the field", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm({ silence_window_seconds: 60 }),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ silence_window_seconds: body.silence_window_seconds as number });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    const field = new FakeElement();
    field.value = "90000";
    container.setQueryResult("[data-wb-pset-silence-input]", field);
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-silence-save]"])));
    await tick();
    // Out of range: no PATCH, inline error instead.
    assert.equal(patched.length, 0);
    assert.match(container.innerHTML, /data-wb-pset-error="true"/u);

    field.value = "120";
    container.setQueryResult("[data-wb-pset-silence-input]", field);
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-silence-save]"])));
    await tick();
    assert.deepEqual(patched, [{ silence_window_seconds: 120 }]);
    assert.match(container.innerHTML, /value="120" data-wb-pset-silence-input/u);
  });
});

test("enabling quiet hours sends a full valid quiet_hours object; the last weekday cannot be removed", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    let current = governanceVm({ quiet_hours: { enabled: false } });
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => current,
        onPatch: (body) => {
          patched.push(body);
          current = governanceVm({ quiet_hours: body.quiet_hours as ProjectAiGovernanceVM["quiet_hours"] });
          return current;
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-quiet-toggle]"])));
    await tick();
    assert.equal(patched.length, 1);
    const sent = patched[0]!.quiet_hours as { enabled: boolean; weekdays: number[]; start_minute: number; end_minute: number };
    assert.equal(sent.enabled, true);
    assert.deepEqual(sent.weekdays, [0, 1, 2, 3, 4, 5, 6]);
    assert.notEqual(sent.start_minute, sent.end_minute);

    // Remove weekdays down to one, then confirm the guard blocks removing the last one.
    for (const day of [1, 2, 3, 4, 5, 6]) {
      container.dispatch(
        "click",
        new FakeElement(new Set(["[data-wb-pset-quiet-weekday]"]), { wbPsetQuietWeekday: String(day) })
      );
      await tick();
    }
    const before = patched.length;
    container.dispatch(
      "click",
      new FakeElement(new Set(["[data-wb-pset-quiet-weekday]"]), { wbPsetQuietWeekday: "0" })
    );
    await tick();
    assert.equal(patched.length, before, "removing the final weekday must not produce a PATCH");
    assert.match(container.innerHTML, /至少保留一天/u);
  });
});

test("toggling one granular capability resends all four keys explicitly", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm({ granular_settings: { send_notification: false } }),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ granular_settings: body.granular_settings as ProjectAiGovernanceVM["granular_settings"] });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch(
      "click",
      new FakeElement(new Set(["[data-wb-pset-granular]"]), { wbPsetGranular: "dispatch_run" })
    );
    await tick();
    assert.deepEqual(patched, [
      {
        granular_settings: {
          create_work_item: true,
          dispatch_run: false,
          mutate_drive: true,
          send_notification: false
        }
      }
    ]);
  });
});

test("a non-editable mount never issues a PATCH no matter what is clicked", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const requests: RecordedRequest[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({ onGet: () => governanceVm(), requests }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: false
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-observer]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-quiet-toggle]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-pset-granular]"]), { wbPsetGranular: "mutate_drive" }));
    await tick();

    assert.equal(requests.filter((request) => request.init?.method === "PATCH").length, 0);
    assert.match(container.innerHTML, /只有项目负责人能修改这些设置。/u);
  });
});

// —— R14 批 RISK：风险巡检阈值分区读写接线 —— //

test("toggling the risk-monitor enable switch PATCHes the full risk_monitor object (not just { enabled }), preserving the existing thresholds", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () =>
          governanceVm({
            risk_monitor: {
              enabled: true,
              stall_days_threshold: 7,
              deadline_lookahead_days: 3,
              cost_spike_ratio_pct: 400,
              cost_spike_min_cny: 30
            }
          }),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ risk_monitor: body.risk_monitor as ProjectAiGovernanceVM["risk_monitor"] });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-risk-enabled]"])));
    await tick();
    assert.deepEqual(patched, [
      {
        risk_monitor: {
          enabled: false,
          stall_days_threshold: 7,
          deadline_lookahead_days: 3,
          cost_spike_ratio_pct: 400,
          cost_spike_min_cny: 30
        }
      }
    ]);
  });
});

test("the risk threshold save button validates each field against the contract bounds client-side and sends no PATCH on failure", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ risk_monitor: body.risk_monitor as ProjectAiGovernanceVM["risk_monitor"] });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    const stallField = new FakeElement();
    stallField.value = "91"; // over the max of 90
    container.setQueryResult("[data-wb-risk-stall-input]", stallField);
    container.setQueryResult("[data-wb-risk-deadline-input]", Object.assign(new FakeElement(), { value: "2" }));
    container.setQueryResult("[data-wb-risk-cost-ratio-input]", Object.assign(new FakeElement(), { value: "300" }));
    container.setQueryResult("[data-wb-risk-cost-min-input]", Object.assign(new FakeElement(), { value: "20" }));

    container.dispatch("click", new FakeElement(new Set(["[data-wb-risk-save]"])));
    await tick();
    assert.equal(patched.length, 0);
    assert.match(container.innerHTML, /工单停滞天数阈值要在 1 到 90 天之间/u);
  });
});

test("the risk threshold save button PATCHes all five keys with the new values once every field passes validation", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const patched: Record<string, unknown>[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({
        onGet: () => governanceVm(),
        onPatch: (body) => {
          patched.push(body);
          return governanceVm({ risk_monitor: body.risk_monitor as ProjectAiGovernanceVM["risk_monitor"] });
        }
      }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: true
    });
    await tick();

    container.setQueryResult("[data-wb-risk-stall-input]", Object.assign(new FakeElement(), { value: "12" }));
    container.setQueryResult("[data-wb-risk-deadline-input]", Object.assign(new FakeElement(), { value: "5" }));
    container.setQueryResult("[data-wb-risk-cost-ratio-input]", Object.assign(new FakeElement(), { value: "250" }));
    container.setQueryResult("[data-wb-risk-cost-min-input]", Object.assign(new FakeElement(), { value: "15.5" }));

    container.dispatch("click", new FakeElement(new Set(["[data-wb-risk-save]"])));
    await tick();
    assert.deepEqual(patched, [
      {
        risk_monitor: {
          enabled: true,
          stall_days_threshold: 12,
          deadline_lookahead_days: 5,
          cost_spike_ratio_pct: 250,
          cost_spike_min_cny: 15.5
        }
      }
    ]);
    assert.match(container.innerHTML, /value="12" data-wb-risk-stall-input/u);
  });
});

test("a non-editable mount never issues a risk-monitor PATCH no matter what is clicked", async () => {
  await withFakeDomGlobals(async () => {
    const container = new FakeContainer();
    const requests: RecordedRequest[] = [];
    mountProjectSettingsView(container as unknown as HTMLElement, {
      client: clientReturning({ onGet: () => governanceVm(), requests }),
      locale: "zh-CN",
      projectId: "90000000-0000-4000-8000-000000000001",
      projectName: "星尘短剧",
      editable: false
    });
    await tick();

    container.dispatch("click", new FakeElement(new Set(["[data-wb-risk-enabled]"])));
    container.dispatch("click", new FakeElement(new Set(["[data-wb-risk-save]"])));
    await tick();

    assert.equal(requests.filter((request) => request.init?.method === "PATCH").length, 0);
  });
});

test("defaultEnabledQuietHours produces a contract-valid enabled block", () => {
  const quiet = defaultEnabledQuietHours("Asia/Shanghai");
  assert.equal(quiet.enabled, true);
  assert.equal(quiet.timezone, "Asia/Shanghai");
  assert.notEqual(quiet.start_minute, quiet.end_minute);
  assert.equal(new Set(quiet.weekdays).size, quiet.weekdays.length);
  assert.ok(quiet.weekdays.length >= 1);
});
