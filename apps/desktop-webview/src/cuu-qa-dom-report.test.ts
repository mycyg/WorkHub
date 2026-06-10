import assert from "node:assert/strict";
import test from "node:test";

import {
  collectDesktopPetQaDomSnapshot,
  writeDesktopPetQaDomSnapshot
} from "./cuu-qa-dom-report.js";

function fakeElement(
  attrs: Record<string, string>,
  textContent = "",
  rect?: Partial<DOMRect>,
  layout?: Partial<Pick<HTMLElement, "clientWidth" | "scrollWidth" | "clientHeight" | "scrollHeight">>,
  children: unknown[] = []
) {
  return {
    textContent,
    tagName: "DIV",
    className: attrs.class ?? attrs.className ?? "",
    ...(layout
      ? {
          clientWidth: layout.clientWidth ?? 0,
          scrollWidth: layout.scrollWidth ?? 0,
          clientHeight: layout.clientHeight ?? 0,
          scrollHeight: layout.scrollHeight ?? 0
        }
      : {}),
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
      : {}),
    ...(children.length
      ? {
          querySelectorAll() {
            return children as unknown as NodeListOf<Element>;
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
    }, "", { x: 0, y: 0, width: 520, height: 720, right: 520, bottom: 720 }),
    ".wh-cuu-cat-live2d": fakeElement({
      "data-cuu-live2d-runtime": "live2d_cubism2_cat",
      "data-cuu-live2d-model": "hijiki"
    }, "Cuu", { x: 244, y: 330, width: 180, height: 320, right: 424, bottom: 650 }),
    "[data-pet-settings-menu]": fakeElement({
      "data-pet-settings-menu": "true"
    }, "Cuu settings Black cat White cat EN Dodge hover Open settings Hide Cuu", {
      x: 62,
      y: 84,
      width: 184,
      height: 218
    }),
    "[data-pet-bubble]": fakeElement({
      "data-pet-bubble": "true",
      "data-cuu-card-id": "approval-card",
      "data-pet-payload-ref-entity-type": "agent_run",
      "data-pet-payload-ref-entity-id": "run-1",
      "data-pet-payload-ref-href": "/agent-runs/run-1/replay"
    }, "Cuu Approval needed Approve", { x: 208.456, y: 142.123, width: 288, height: 164 }, {
      clientWidth: 288,
      scrollWidth: 288,
      clientHeight: 164,
      scrollHeight: 184
    }, [
      fakeElement({ class: "wh-pet-title" }, "Long unwrapped title", { width: 132 }, {
        clientWidth: 120,
        scrollWidth: 168
      })
    ]),
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
  assert.equal(report.settings_menu.data.data_pet_settings_menu, "true");
  assert.equal(report.settings_menu.text, "Cuu settings Black cat White cat EN Dodge hover Open settings Hide Cuu");
  assert.deepEqual(report.settings_menu.rect, {
    x: 62,
    y: 84,
    width: 184,
    height: 218,
    right: 246,
    bottom: 302
  });
  assert.equal(report.bubble.data.data_cuu_card_id, "approval-card");
  assert.equal(report.bubble.data.data_pet_payload_ref_entity_type, "agent_run");
  assert.equal(report.bubble.data.data_pet_payload_ref_entity_id, "run-1");
  assert.deepEqual(report.bubble.layout, {
    client_width: 288,
    scroll_width: 288,
    client_height: 164,
    scroll_height: 184,
    horizontal_overflow: false,
    vertical_overflow: true
  });
  assert.equal(report.bubble.overflow_offenders?.[0]?.class_name, "wh-pet-title");
  assert.equal(report.bubble.overflow_offenders?.[0]?.scroll_width, 168);
  assert.deepEqual(report.bubble.rect, {
    x: 208.46,
    y: 142.12,
    width: 288,
    height: 164,
    right: 496.46,
    bottom: 306.12
  });
  assert.deepEqual(report.spatial_safety, {
    bubble_within_surface_horizontal: true,
    bubble_within_surface_vertical: true,
    live2d_within_surface_horizontal: true,
    live2d_within_surface_vertical: true,
    bubble_overlaps_live2d: false,
    bubble_live2d_overlap_width: 180,
    bubble_live2d_overlap_height: 0,
    bubble_gap_to_live2d_px: 23.88
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
