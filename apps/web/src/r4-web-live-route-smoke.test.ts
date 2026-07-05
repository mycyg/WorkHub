import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { contactSheetFreshness } from "./r4-smoke-contact-sheet.js";

test("R9.7 R4 live-route smoke rejects a stale contact sheet PNG", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workhub-r4-contact-sheet-"));
  try {
    await writeFile(path.join(dir, "contact-sheet.html"), "<img src=\"01.png\" />", "utf8");
    await writeFile(path.join(dir, "01.png"), "new screenshot", "utf8");
    await writeFile(path.join(dir, "contact-sheet.png"), "old contact sheet", "utf8");

    const base = new Date("2026-07-06T00:00:00.000Z");
    await utimes(path.join(dir, "contact-sheet.png"), base, new Date(base.getTime() + 1_000));
    await utimes(path.join(dir, "contact-sheet.html"), base, new Date(base.getTime() + 2_000));
    await utimes(path.join(dir, "01.png"), base, new Date(base.getTime() + 3_000));

    const freshness = await contactSheetFreshness({
      outputDir: dir,
      steps: [{ screenshot: "01.png" }]
    });

    assert.equal(freshness.ok, false);
    assert.deepEqual(freshness.stale_sources.sort(), ["01.png", "contact-sheet.html"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("R9.7 R4 live-route smoke accepts a contact sheet generated after HTML and screenshots", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workhub-r4-contact-sheet-"));
  try {
    await writeFile(path.join(dir, "contact-sheet.html"), "<img src=\"01.png\" />", "utf8");
    await writeFile(path.join(dir, "01.png"), "new screenshot", "utf8");
    await writeFile(path.join(dir, "contact-sheet.png"), "fresh contact sheet", "utf8");

    const base = new Date("2026-07-06T00:00:00.000Z");
    await utimes(path.join(dir, "contact-sheet.html"), base, new Date(base.getTime() + 1_000));
    await utimes(path.join(dir, "01.png"), base, new Date(base.getTime() + 2_000));
    await utimes(path.join(dir, "contact-sheet.png"), base, new Date(base.getTime() + 3_000));

    const freshness = await contactSheetFreshness({
      outputDir: dir,
      steps: [{ screenshot: "01.png" }]
    });

    assert.equal(freshness.ok, true);
    assert.deepEqual(freshness.stale_sources, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
