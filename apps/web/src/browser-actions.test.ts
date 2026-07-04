import assert from "node:assert/strict";
import test from "node:test";
import type { AcceptedDeliverableRestoreResult } from "@workhub/contracts";

import { acceptedDeliverableRestoreFollowUp, driveUploadPayloadFromPicker } from "./drive-actions.js";
import { drivePreviewPanelHtml, renderDrivePreviewPanel } from "./drive-preview.js";

class FakeElement {
  className = "";
  dataset: Record<string, string> = {};
  innerHTML = "";
  readonly closestResults = new Map<string, FakeElement | null>();
  readonly queryResults = new Map<string, FakeElement | null>();
  readonly inserted: Array<{ position: InsertPosition; element: FakeElement }> = [];
  readonly scrollCalls: unknown[] = [];
  removed = false;

  closest(selector: string) {
    return this.closestResults.get(selector) ?? null;
  }

  querySelector(selector: string) {
    return this.queryResults.get(selector) ?? null;
  }

  remove() {
    this.removed = true;
  }

  insertAdjacentElement(position: InsertPosition, element: FakeElement) {
    this.inserted.push({ position, element });
    return element;
  }

  scrollIntoView(options?: unknown) {
    this.scrollCalls.push(options);
  }
}

test("accepted deliverable restore refreshes the current route instead of jumping to drive", () => {
  const result = {
    accepted_deliverable: {
      id: "94000000-0000-4000-8000-000000000004",
      work_item_id: "94000000-0000-4000-8000-000000000005",
      proposal_id: "94000000-0000-4000-8000-000000000006",
      change_id: "94000000-0000-4000-8000-000000000007",
      target_kind: "text_doc",
      target_key: "drive:/deliverables/client-review.md",
      change_type: "updated",
      accepted_version: 2,
      filename: "client-review.md",
      drive_href: "/drive?project_id=94000000-0000-4000-8000-000000000001&item_id=94000000-0000-4000-8000-000000000002",
      restore_href: "/api/workitems/94000000-0000-4000-8000-000000000005/deliverables/94000000-0000-4000-8000-000000000004/restore",
      accepted_at: "2026-06-11T09:00:00.000Z"
    }
  } satisfies AcceptedDeliverableRestoreResult;

  const followUp = acceptedDeliverableRestoreFollowUp(result, "en-US", "Restored deliverable");

  assert.deepEqual(followUp, {
    kind: "refresh_current",
    noticeBody: "Restored: client-review.md"
  });
});

test("drive upload picker payload carries the selected parent folder id", () => {
  const file = new Blob(["folder upload"], { type: "text/plain" });
  const picker = {
    closest: () => ({
      querySelector: () => ({ value: "94000000-0000-4000-8000-000000000020" })
    })
  } as unknown as HTMLInputElement;

  const payload = driveUploadPayloadFromPicker(picker, file);

  assert.equal(payload.file, file);
  assert.equal(payload.parent_id, "94000000-0000-4000-8000-000000000020");
});

test("drive preview is rendered in-place instead of opening the API JSON envelope", () => {
  // R9.7: the old assertion read browser.ts and matched source strings. That was wrong
  // because source regexes can pass while delegated click behavior still opens raw API JSON.
  const actionTarget = new FakeElement();
  const route = new FakeElement();
  const anchor = new FakeElement();
  const previousPanel = new FakeElement();
  actionTarget.closestResults.set("[data-r4-route-component=\"drive\"]", route);
  actionTarget.closestResults.set("[data-r4-drive-accepted-deliverable],[data-r4-drive-item]", anchor);
  route.queryResults.set("[data-r5-drive-preview-panel]", previousPanel);
  const createdPanels: FakeElement[] = [];

  const rendered = renderDrivePreviewPanel(
    actionTarget as unknown as HTMLElement,
    {
      filename: "brief.md",
      preview_type: "text",
      size_bytes: 2048,
      text: "Body"
    },
    "en-US",
    () => {
      const panel = new FakeElement();
      createdPanels.push(panel);
      return panel as unknown as HTMLElement;
    }
  );

  assert.equal(rendered, true);
  assert.equal(previousPanel.removed, true);
  assert.equal(anchor.inserted.length, 1);
  assert.equal(anchor.inserted[0]?.position, "afterend");
  assert.equal(anchor.inserted[0]?.element, createdPanels[0]);
  assert.equal(createdPanels[0]?.dataset.r5DrivePreviewPanel, "true");
  assert.match(createdPanels[0]?.innerHTML ?? "", /Preview: brief\.md/u);
  assert.match(createdPanels[0]?.innerHTML ?? "", /Text preview · 2 KB/u);
  assert.equal(createdPanels[0]?.scrollCalls.length, 1);
});

test("drive preview panel localizes type and size metadata", () => {
  const zh = drivePreviewPanelHtml({
    filename: "brief.md",
    preview_type: "text",
    size_bytes: 2048,
    text: "正文"
  }, "zh-CN");
  const en = drivePreviewPanelHtml({
    filename: "brief.md",
    preview_type: "text",
    size_bytes: 2048,
    text: "Body"
  }, "en-US");

  assert.equal(zh.includes("类型 text"), false);
  assert.equal(zh.includes("2048 字节"), false);
  assert.equal(zh.includes("文本预览 · 2 KB"), true);
  assert.equal(en.includes("type text"), false);
  assert.equal(en.includes("2048 bytes"), false);
  assert.equal(en.includes("Text preview · 2 KB"), true);
});
