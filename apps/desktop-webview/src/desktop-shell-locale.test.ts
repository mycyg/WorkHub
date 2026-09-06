import assert from "node:assert/strict";
import test from "node:test";

import { workHubLocaleStorageKey } from "@workhub/ui/gold-path";

import {
  parseDesktopLocaleChangedPayload,
  publishDesktopLocale,
  readDesktopShellLocale,
  resolveDesktopBootLocale
} from "./desktop-shell-locale.js";
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

// R27（真机走查）：身份语言此前只在解析它的那扇窗口里生效，桌宠窗一直举着 boot 时算的旧语言。
test("语言变了才广播；壳层永远先落定，广播排在它之后", async () => {
  const changedCalls: InvokeCall[] = [];
  const changedEmits: Array<{ eventName: string; payload: unknown }> = [];
  const changed = publishDesktopLocale({
    locale: "zh-CN",
    previous: "en-US",
    source: "main",
    invoke: (command, args) => {
      changedCalls.push({ command, args });
      return Promise.resolve();
    },
    emitter: {
      emit(eventName: string, payload?: unknown) {
        // 广播必须排在 set_shell_locale 落定之后——顺序反了，收广播的窗口 boot 时会问到旧的壳层语言。
        changedEmits.push({ eventName, payload });
      }
    } as never
  });
  assert.equal(changed, true);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(changedCalls.length, 1);
  assert.equal(changedCalls[0]?.command, "set_shell_locale");
  assert.deepEqual(changedCalls[0]?.args, { locale: "zh-CN" });
  assert.deepEqual(changedEmits, [
    { eventName: "workhub-locale-changed", payload: { locale: "zh-CN", source: "main" } }
  ]);

  // 没变：壳层照样同步（托盘/标题跟着这台设备的真实语言），但不广播——收广播的窗口不该被无谓地
  // reload，互相唤醒的回环也是这么断掉的。
  const sameCalls: InvokeCall[] = [];
  const sameEmits: Array<{ eventName: string; payload: unknown }> = [];
  const unchanged = publishDesktopLocale({
    locale: "zh-CN",
    previous: "zh-CN",
    source: "workbench",
    invoke: (command, args) => {
      sameCalls.push({ command, args });
      return Promise.resolve();
    },
    emitter: {
      emit(eventName: string, payload?: unknown) {
        sameEmits.push({ eventName, payload });
      }
    } as never
  });
  assert.equal(unchanged, false);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(sameCalls.length, 1);
  assert.equal(sameCalls[0]?.command, "set_shell_locale");
  assert.deepEqual(sameEmits, []);
});

test("广播 payload 认不出的形状一律丢弃，绝不拿猜出来的语言换掉整扇窗口", () => {
  assert.deepEqual(parseDesktopLocaleChangedPayload({ locale: "zh-CN", source: "main" }), {
    locale: "zh-CN",
    source: "main"
  });
  assert.deepEqual(parseDesktopLocaleChangedPayload({ locale: "en-US" }), {
    locale: "en-US",
    source: undefined
  });
  assert.equal(parseDesktopLocaleChangedPayload({ locale: "fr-FR" }), undefined);
  assert.equal(parseDesktopLocaleChangedPayload(undefined), undefined);
  assert.equal(parseDesktopLocaleChangedPayload("zh-CN"), undefined);
});
