import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { isSpotlightDragExcludedTarget } from "./controller.js";

const originalElement = globalThis.Element;

class FakeElement {
  constructor(private readonly tagName: string) {}

  closest(selector: string): FakeElement | null {
    const selectors = selector.split(",").map((item) => item.trim());
    return selectors.includes(this.tagName) ? this : null;
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: originalElement
  });
});

test("Spotlight drag target classifier excludes text editing controls from window dragging", () => {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement
  });

  assert.equal(isSpotlightDragExcludedTarget(new FakeElement("input") as unknown as EventTarget), true);
  assert.equal(isSpotlightDragExcludedTarget(new FakeElement("textarea") as unknown as EventTarget), true);
  assert.equal(isSpotlightDragExcludedTarget(new FakeElement("button") as unknown as EventTarget), true);
  assert.equal(isSpotlightDragExcludedTarget(new FakeElement("div") as unknown as EventTarget), false);
});
