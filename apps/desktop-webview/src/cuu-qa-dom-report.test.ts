import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDesktopPetQaDomSnapshot,
  writeDesktopPetQaDomSnapshot
} from "./cuu-qa-dom-report.js";

function fakeElement(attrs: Record<string, string>, textContent = "", rect?: Partial<DOMRect>) {
  return {
    textContent,
    getAttributeNames() {
      return Object.keys(attrs);
    },
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    ...(rect
      ? {
          getBoundingClientRect() {
            return {
              x: rect.x ?? 0,
              y: rect.y ?? 0,
              width: rect.width ?? 0,
              height: rect.height ?? 0,
              right: rect.right ?? (rect.x ?? 0) + (rect.width ?? 0),
              bottom: rect.bottom ?? (rect.y ?? 0) + (rect.height ?? 0)
            } as DOMRect;
          }
        }
      : {})
  };
}

function fakeRoot(elements: Record<string, ReturnType<typeof fakeElement> | undefined>) {
  return {
    querySelector(selector: string) {
      return elements[selector] ?? null;
    }
  } as unknown as ParentNode;
}

test("Cuu QA DOM report collects exact data attributes from the pet surface", () => {
  const root = fakeRoot({
    "[data-wh-surface=pet]": fakeElement({
      "data-wh-surface": "pet",
      "data-pet-window-mode": "card",
      "data-cuu-behavior-state": "asking_approval",
      "data-cuu-live2d-renderer-state": "mtn/01.mtn"
    }),
    ".wh-cuu-cat-live2d": fakeElement({
      "data-cuu-live2d-runtime": "live2d_cubism2_cat",
      "data-cuu-live2d-model": "hijiki"
    }),
    "[data-pet-bubble]": fakeElement({
      "data-pet-bubble": "true",
      "data-cuu-card-id": "approval-card",
      "data-pet-payload-ref-entity-type": "agent_run",
      "data-pet-payload-ref-entity-id": "run-1",
      "data-pet-payload-ref-href": "/agent-runs/run-1/replay"
    }, "Cuu Approval needed Approve", { x: 208.456, y: 142.123, width: 288, height: 164 }),
    "[data-chip-id],[data-pet-option-id]": fakeElement({
      "data-chip-id": "file-only",
      "data-recommended": "true"
    }),
    "[data-cuu-action-id]": fakeElement({
      "data-cuu-action-id": "approve",
      "data-tone": "primary"
    })
  });

  const report = collectDesktopPetQaDomSnapshot(root, "render", new Date("2026-06-08T00:00:00.000Z"));

  assert.equal(report.contract, "workhub.cuu.tauri.actual-dom-report");
  assert.equal(report.version, 1);
  assert.equal(report.captured_at_iso, "2026-06-08T00:00:00.000Z");
  assert.equal(report.reason, "render");
  assert.deepEqual(report.surface.data, {
    data_wh_surface: "pet",
    data_pet_window_mode: "card",
    data_cuu_behavior_state: "asking_approval",
    data_cuu_live2d_renderer_state: "mtn/01.mtn"
  });
  assert.equal(report.live2d.data.data_cuu_live2d_model, "hijiki");
  assert.equal(report.bubble.data.data_cuu_card_id, "approval-card");
  assert.equal(report.bubble.data.data_pet_payload_ref_entity_type, "agent_run");
  assert.equal(report.bubble.data.data_pet_payload_ref_entity_id, "run-1");
  assert.deepEqual(report.bubble.rect, {
    x: 208.46,
    y: 142.12,
    width: 288,
    height: 164,
    right: 496.46,
    bottom: 306.12
  });
  assert.equal(report.primary_chip.data.data_recommended, "true");
  assert.equal(report.primary_action.data.data_cuu_action_id, "approve");
});

test("Cuu QA DOM report writes through the Tauri command only when QA reporting is enabled", async () => {
  type QaDomReportTarget = NonNullable<Parameters<typeof writeDesktopPetQaDomSnapshot>[2]>;
  const root = fakeRoot({
    "[data-wh-surface=pet]": fakeElement({ "data-wh-surface": "pet" })
  });
  const calls: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const target = {
    __WORKHUB_CUU_QA_DOM_REPORT__: true,
    __TAURI__: {
      core: {
        invoke(command: string, args?: Record<string, unknown>) {
          calls.push({ command, args });
        }
      }
    }
  };

  writeDesktopPetQaDomSnapshot(root, "patch", target as QaDomReportTarget);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.command, "write_cuu_qa_dom_report");
  assert.equal(JSON.parse(String(calls[0]?.args?.reportJson)).reason, "patch");

  writeDesktopPetQaDomSnapshot(root, "render", { ...target, __WORKHUB_CUU_QA_DOM_REPORT__: false } as QaDomReportTarget);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
});
