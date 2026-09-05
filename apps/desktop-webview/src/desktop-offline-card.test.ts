import assert from "node:assert/strict";
import test from "node:test";

import { bindDesktopOfflineCard } from "./desktop-offline-card.js";

// D-01（R23 精简批）：这两条用例原来住在 apps/desktop-webview/src/main.test.ts（main.ts 死 barrel 的自证
// 测试文件），但测的是 desktop-offline-card.ts 的真实行为——该模块没有自己的测试文件（browser-offline-card.test.ts
// 测的是另一个模块），main.ts 删除后随之搬到这里，断言原样保留。

type FakeDesktopDomEvent = { preventDefault?: () => void };

type FakeDesktopDomElement = {
  value?: string;
  addEventListener: (type: string, handler: (event: FakeDesktopDomEvent) => void) => void;
  dispatch: (type: string, event?: FakeDesktopDomEvent) => void;
  focus?: (options?: FocusOptions) => void;
  removeAttribute?: (name: string) => void;
  setAttribute?: (name: string, value: string) => void;
};

function fakeDesktopDomElement(extra: Partial<FakeDesktopDomElement> = {}): FakeDesktopDomElement {
  const listeners = new Map<string, (event: FakeDesktopDomEvent) => void>();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.(event);
    },
    ...extra
  };
}

function fakeDesktopRoot(nodes: Record<string, FakeDesktopDomElement | null>) {
  return {
    innerHTML: "",
    querySelector(selector: string) {
      return nodes[selector] ?? null;
    }
  } as unknown as HTMLElement;
}

// R9.7: the old offline-settings assertion grepped browser.ts for localStorage calls.
// That was wrong because source regexes can pass while the rendered offline card still navigates or leaves controls unbound.
test("desktop offline settings edit the API base locally instead of navigating to a dead settings route", () => {
  const storageCalls: Array<{ method: "setItem" | "removeItem"; key: string; value?: string }> = [];
  const reloads: string[] = [];
  const rebuilds: string[] = [];
  const focusCalls: FocusOptions[] = [];
  const removedAttributes: string[] = [];
  let submitPrevented = 0;

  const retry = fakeDesktopDomElement();
  const openSettings = fakeDesktopDomElement();
  const defaultApi = fakeDesktopDomElement();
  const form = fakeDesktopDomElement({
    removeAttribute(name) {
      removedAttributes.push(name);
    }
  });
  const apiInput = fakeDesktopDomElement({
    value: "https://workhub.example///",
    focus(options) {
      focusCalls.push(options ?? {});
    }
  });
  const root = fakeDesktopRoot({
    "#wh-retry": retry,
    "#wh-open-settings": openSettings,
    "#wh-default-api": defaultApi,
    "#wh-offline-settings": form,
    "#wh-api-base": apiInput
  });

  bindDesktopOfflineCard(root, {
    apiBase: "http://127.0.0.1:8787",
    detail: "ECONNREFUSED",
    locale: "zh-CN",
    storage: {
      setItem(key, value) {
        storageCalls.push({ method: "setItem", key, value });
      },
      removeItem(key) {
        storageCalls.push({ method: "removeItem", key });
      }
    },
    reload: () => { reloads.push("reload"); },
    scheduleRebuild: () => { rebuilds.push("rebuild"); }
  });

  assert.match(root.innerHTML, /id="wh-offline-settings"/u);
  assert.doesNotMatch(root.innerHTML, /#\/settings/u);

  openSettings.dispatch("click");
  assert.deepEqual(removedAttributes, ["hidden"]);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);

  form.dispatch("submit", { preventDefault: () => { submitPrevented += 1; } });
  assert.equal(submitPrevented, 1);
  assert.deepEqual(storageCalls, [
    { method: "setItem", key: "workhub_api_base", value: "https://workhub.example" }
  ]);
  assert.deepEqual(reloads, ["reload"]);

  defaultApi.dispatch("click");
  assert.deepEqual(storageCalls.at(-1), { method: "removeItem", key: "workhub_api_base" });
  assert.deepEqual(reloads, ["reload", "reload"]);

  retry.dispatch("click");
  assert.deepEqual(reloads, ["reload", "reload", "reload"]);
  assert.deepEqual(rebuilds, ["rebuild"]);
});

// DSK-05：非法服务器地址（非 http/https / 带凭据 / 畸形串）拒存、不 reload，行内报错。
test("desktop offline settings refuse to store an invalid API base (DSK-05)", () => {
  const storageCalls: Array<{ method: "setItem" | "removeItem"; key: string; value?: string }> = [];
  const reloads: string[] = [];
  const removedFromError: string[] = [];
  const hiddenAttrs: string[] = [];

  const form = fakeDesktopDomElement();
  const apiInput = fakeDesktopDomElement({ value: "javascript:alert(1)" });
  const errorEl = fakeDesktopDomElement({
    removeAttribute(name) {
      removedFromError.push(name);
    },
    setAttribute(name, value) {
      hiddenAttrs.push(`${name}=${value}`);
    }
  });
  const root = fakeDesktopRoot({
    "#wh-offline-settings": form,
    "#wh-api-base": apiInput,
    "#wh-api-base-error": errorEl
  });

  bindDesktopOfflineCard(root, {
    apiBase: "http://127.0.0.1:8787",
    detail: "ECONNREFUSED",
    locale: "zh-CN",
    storage: {
      setItem(key, value) {
        storageCalls.push({ method: "setItem", key, value });
      },
      removeItem(key) {
        storageCalls.push({ method: "removeItem", key });
      }
    },
    reload: () => { reloads.push("reload"); }
  });

  form.dispatch("submit", { preventDefault: () => {} });
  assert.deepEqual(storageCalls, [], "an invalid address must never reach localStorage");
  assert.deepEqual(reloads, [], "no reload on rejection");
  assert.deepEqual(removedFromError, ["hidden"]);
  assert.match(String((errorEl as { textContent?: string }).textContent), /http:\/\/ 或 https:\/\//u);

  // 合法地址仍照常归一化保存并重载（尾部斜杠归一）。
  (apiInput as { value?: string }).value = "https://workhub.example///";
  form.dispatch("submit", { preventDefault: () => {} });
  assert.deepEqual(storageCalls, [
    { method: "setItem", key: "workhub_api_base", value: "https://workhub.example" }
  ]);
  assert.deepEqual(reloads, ["reload"]);
});
