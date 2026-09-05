import assert from "node:assert/strict";
import { test } from "node:test";

import { commandRegistry } from "../command-palette.js";
import { resolveCapabilityView } from "./registry.js";

test("every capability resolves to a real inline view carrying its id", () => {
  // R9.6 adds Agent Army on top of the original 11 abilities; assert the live
  // registry size instead of freezing the old count in the test name/comment.
  for (const command of commandRegistry) {
    assert.equal(resolveCapabilityView(command.id).id, command.id);
  }
});

// 严重 #8（R24 S3 走查）：new_project 曾经映到 createWorkbenchOpenView(...,{bare:true})——那个 view
// 只 invoke open_workbench 打开一个空窗口，不建任何项目。锁死它现在是真正的内联建项目表单
// （views/new-project.ts），不会退化回那条假入口。
test("new_project resolves to the inline create-project form, not the bare open-workbench placeholder", () => {
  class FakeElement {
    public innerHTML = "";
    addEventListener() {}
    querySelector() {
      return null;
    }
  }
  const globals = globalThis as unknown as { HTMLElement?: unknown };
  const previous = globals.HTMLElement;
  globals.HTMLElement = FakeElement;
  try {
    const body = new FakeElement();
    resolveCapabilityView("new_project").mount({
      body: body as unknown as HTMLElement,
      locale: "en-US",
      client: {} as never,
      back() {},
      open() {},
      setSubtitle() {},
      toast() {},
      requestResize() {},
      refocusBody() {},
      signal: new AbortController().signal
    });
    assert.match(body.innerHTML, /data-new-project-name/u, "renders a real name field, not a bare open-workbench loading state");
    assert.doesNotMatch(body.innerHTML, /Opening the workbench window/u);
  } finally {
    globals.HTMLElement = previous;
  }
});
