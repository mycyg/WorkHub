import { strict as assert } from "node:assert";
import { test } from "node:test";

import { createGlassWindowController, renderGlassWindow } from "./glass-window.js";

test("renderGlassWindow emits a dismissible glass dialog with title + body", () => {
  const html = renderGlassWindow({ key: "drive", title: "网盘", bodyHtml: "<p>files</p>", kicker: "Drive" });
  assert.match(html, /data-glass-backdrop data-glass-window="drive"/u);
  assert.match(html, /role="dialog" aria-modal="true"/u);
  assert.match(html, /class="wh-gw-kicker">Drive</u);
  assert.match(html, /class="wh-gw-title">网盘</u);
  assert.match(html, /data-glass-close/u);
  assert.match(html, /data-glass-body><p>files<\/p></u);
  // 玻璃 + spring 入场（Apple 味）
  assert.match(html, /ds-glass-strong/u);
  assert.match(html, /ds-anim-spring-in/u);
});

test("renderGlassWindow supports wide windows + escapes the title", () => {
  const wide = renderGlassWindow({ key: "diff", title: "<x>", bodyHtml: "", wide: true });
  assert.match(wide, /wh-gw--wide/u);
  assert.match(wide, /aria-label="&lt;x&gt;"/u);
  assert.doesNotMatch(wide, /aria-label="<x>"/u);
});

// 轻量 fake DOM 验证控制器状态机（测试环境无真 DOM）。
function fakeHost() {
  const body = { innerHTML: "" };
  return {
    innerHTML: "",
    ownerDocument: undefined as unknown as Document,
    attrs: new Set<string>(),
    setAttribute(name: string) {
      this.attrs.add(name);
    },
    removeAttribute(name: string) {
      this.attrs.delete(name);
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel: string) {
      return sel.includes("glass-body") ? body : null;
    },
    _body: body
  };
}

test("controller open/setBody/close drives state + onClose", () => {
  const host = fakeHost();
  const closed: Array<string | undefined> = [];
  const ctrl = createGlassWindowController(host as unknown as HTMLElement, {
    onClose: (key) => closed.push(key)
  });

  assert.equal(ctrl.isOpen(), false);
  ctrl.open({ key: "drive", title: "网盘", bodyHtml: "<p>a</p>" });
  assert.equal(ctrl.isOpen(), true);
  assert.equal(ctrl.currentKey(), "drive");
  assert.match(host.innerHTML, /data-glass-window="drive"/u);

  ctrl.setBody("<p>live</p>");
  assert.equal(host._body.innerHTML, "<p>live</p>");

  ctrl.close();
  assert.equal(ctrl.isOpen(), false);
  assert.equal(ctrl.currentKey(), undefined);
  assert.equal(host.innerHTML, "");
  assert.ok(host.attrs.has("hidden"), "host hidden after close");
  assert.deepEqual(closed, ["drive"]);
});

test("controller close is a no-op when nothing is open", () => {
  const host = fakeHost();
  const closed: Array<string | undefined> = [];
  const ctrl = createGlassWindowController(host as unknown as HTMLElement, { onClose: (k) => closed.push(k) });
  ctrl.close();
  assert.deepEqual(closed, [], "no onClose when nothing open");
});
