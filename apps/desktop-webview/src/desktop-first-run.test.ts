import assert from "node:assert/strict";
import { test } from "node:test";

import { isDesktopFirstRun, markDesktopIdentityCreated, markDesktopOnboarded } from "./desktop-first-run.js";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    values
  };
}

test("isDesktopFirstRun is false until a created identity is marked", () => {
  const storage = fakeStorage();
  assert.equal(isDesktopFirstRun(storage), false);
  markDesktopIdentityCreated(storage, true);
  assert.equal(isDesktopFirstRun(storage), true);
});

test("markDesktopIdentityCreated(false) clears any stale first-run marker", () => {
  const storage = fakeStorage({ workhub_desktop_identity_created: "1" });
  markDesktopIdentityCreated(storage, false);
  assert.equal(isDesktopFirstRun(storage), false);
});

test("markDesktopOnboarded clears the marker so the landing page stops showing the first-run card", () => {
  const storage = fakeStorage({ workhub_desktop_identity_created: "1" });
  assert.equal(isDesktopFirstRun(storage), true);
  markDesktopOnboarded(storage);
  assert.equal(isDesktopFirstRun(storage), false);
});

test("storage failures degrade to false/no-op instead of throwing", () => {
  const throwing: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    }
  };
  assert.equal(isDesktopFirstRun(throwing), false);
  assert.doesNotThrow(() => markDesktopIdentityCreated(throwing, true));
  assert.doesNotThrow(() => markDesktopOnboarded(throwing));
});
