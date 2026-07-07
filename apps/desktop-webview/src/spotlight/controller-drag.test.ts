import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { isSpotlightDragExcludedPointer, isSpotlightDragExcludedTarget } from "./controller.js";

const originalElement = globalThis.Element;

class FakeElement {
  constructor(
    private readonly tagName: string,
    private readonly rect?: { left: number; top: number; right: number; bottom: number }
  ) {}

  closest(selector: string): FakeElement | null {
    const selectors = selector.split(",").map((item) => item.trim());
    return selectors.includes(this.tagName) ? this : null;
  }

  getBoundingClientRect(): { left: number; top: number; right: number; bottom: number } {
    return this.rect ?? { left: 0, top: 0, right: 0, bottom: 0 };
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

test("Spotlight drag target classifier excludes focused text controls by pointer bounds", () => {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement
  });

  const input = new FakeElement("input", { left: 20, top: 10, right: 180, bottom: 36 });
  const wrapper = new FakeElement("div");

  assert.equal(
    isSpotlightDragExcludedPointer({
      target: wrapper as unknown as EventTarget,
      clientX: 80,
      clientY: 24,
      activeElement: input as unknown as Element
    }),
    true
  );
  assert.equal(
    isSpotlightDragExcludedPointer({
      target: wrapper as unknown as EventTarget,
      clientX: 260,
      clientY: 24,
      activeElement: input as unknown as Element
    }),
    false
  );
});

test("Spotlight drag target classifier excludes text controls by hit-tested pointer element", () => {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement
  });

  const input = new FakeElement("input");
  const wrapper = new FakeElement("div");

  assert.equal(
    isSpotlightDragExcludedPointer({
      target: wrapper as unknown as EventTarget,
      clientX: 80,
      clientY: 24,
      elementAtPoint: input as unknown as Element
    }),
    true
  );
});

test("Spotlight drag target classifier excludes known text-control bounds when event retargeting is unreliable", () => {
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement
  });

  const input = new FakeElement("input", { left: 54, top: 12, right: 690, bottom: 38 });
  const wrapper = new FakeElement("div");

  assert.equal(
    isSpotlightDragExcludedPointer({
      target: wrapper as unknown as EventTarget,
      clientX: 72,
      clientY: 24,
      excludedElements: [input as unknown as Element]
    }),
    true
  );
});
