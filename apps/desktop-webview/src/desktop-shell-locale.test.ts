import assert from "node:assert/strict";
import test from "node:test";

import { workHubLocaleStorageKey } from "@workhub/ui/gold-path";

import { readDesktopShellLocale, resolveDesktopBootLocale } from "./desktop-shell-locale.js";
import type { DesktopWindowControlsScope } from "./desktop-window-controls.js";

type InvokeCall = { command: string; args?: Record<string, unknown> | undefined };

function shellScope(
  calls: InvokeCall[],
  reply: (command: string) => unknown
): DesktopWindowControlsScope {
  return {
    __TAURI__: {
      core: {
        invoke(command: string, args?: Record<string, unknown>) {
          calls.push({ command, args });
          return Promise.resolve(reply(command));
        }
      }
    }
  };
}

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => map.delete(key) as unknown as void,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    }
  } as Storage;
}

test("readDesktopShellLocale 只认壳层给的两个合法值；没有 Tauri / 命令不存在都回 undefined", async () => {
  const calls: InvokeCall[] = [];
  assert.equal(await readDesktopShellLocale(shellScope(calls, () => "zh-CN")), "zh-CN");
  assert.deepEqual(calls, [{ command: "get_shell_locale", args: undefined }]);
  assert.equal(await readDesktopShellLocale(shellScope([], () => "fr-FR")), undefined);
  assert.equal(await readDesktopShellLocale({}), undefined);
  assert.equal(
    await readDesktopShellLocale(
      shellScope([], () => {
        throw new Error("老壳层没有这条命令");
      })
    ),
    undefined
  );
});

// R27（真机走查）：英文系统上首启，连接服务器屏与登录屏全是英文，`WORKHUB_LOCALE=zh-CN` 也救不了
// ——那个变量只喂给壳层，webview 只认 navigator.language。
test("首启没有显式偏好时，壳层语言顶掉 navigator.language", async () => {
  const locale = await resolveDesktopBootLocale({
    storage: memoryStorage(),
    navigatorLanguage: "en-US",
    scope: shellScope([], () => "zh-CN")
  });
  assert.equal(locale, "zh-CN");
});

test("这台设备表过态的显式偏好仍排第一，壳层语言不许把它顶掉", async () => {
  const locale = await resolveDesktopBootLocale({
    storage: memoryStorage({ [workHubLocaleStorageKey]: "en-US" }),
    navigatorLanguage: "zh-CN",
    scope: shellScope([], () => "zh-CN")
  });
  assert.equal(locale, "en-US");
});

test("问不到壳层（浏览器 dev 预览 / 老壳层）就回落 navigator.language", async () => {
  assert.equal(
    await resolveDesktopBootLocale({ storage: memoryStorage(), navigatorLanguage: "en-GB", scope: {} }),
    "en-US"
  );
  assert.equal(
    await resolveDesktopBootLocale({ storage: memoryStorage(), navigatorLanguage: "zh-Hans", scope: {} }),
    "zh-CN"
  );
});

test("QA/夹具覆盖优先于一切，且读存储抛错时退化成继续问下一个来源", async () => {
  assert.equal(
    await resolveDesktopBootLocale({
      override: "en-US",
      storage: memoryStorage({ [workHubLocaleStorageKey]: "zh-CN" }),
      navigatorLanguage: "zh-CN",
      scope: shellScope([], () => "zh-CN")
    }),
    "en-US"
  );
  const throwingStorage = {
    getItem() {
      throw new Error("隐私模式");
    }
  } as unknown as Storage;
  assert.equal(
    await resolveDesktopBootLocale({
      storage: throwingStorage,
      navigatorLanguage: "en-US",
      scope: shellScope([], () => "zh-CN")
    }),
    "zh-CN"
  );
});
