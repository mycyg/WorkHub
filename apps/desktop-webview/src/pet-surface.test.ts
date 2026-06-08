import assert from "node:assert/strict";
import test from "node:test";

import { createCuuIdleScheduler, cuuMotionForState, type CuuCard } from "@workhub/cuu";

import {
  createDesktopPetIdleScheduler,
  defaultDesktopPetPointerSnapshot,
  desktopPetAliveIdlePolicy,
  desktopPetInitialIdleAction,
  desktopPetPointerSmoothingAlpha,
  renderDesktopPetSurface,
  resolveDesktopSurface,
  scheduleDesktopPetFirstPaint
} from "./pet-surface.js";
import { assertDesktopPetVisualQaPass, createDesktopPetVisualQaReport } from "./pet-surface-qa.js";
import {
  desktopPetPointerSnapshotFromSample,
  desktopPetWindowModeForCard,
  desktopPetWindowSettingsFromPreferences,
  normalizeDesktopPetPointerSnapshot,
  pointerPatchFromEvent,
  resolveDesktopPetWindowBridge
} from "./pet-window-bridge.js";

function approvalCard(): CuuCard {
  return {
    id: "approval-card",
    kind: "approval",
    state: "asking_approval",
    motion: cuuMotionForState("asking_approval"),
    title: "Cuu 等你审批",
    message: "点一个选项即可继续。",
    priority: "urgent",
    chips: [{ id: "file-only", label: "仅改文件", recommended: true }],
    sections: [
      { id: "changes", title: "这次改了什么", lines: ["更新周报草稿和验收清单", "新增 JSON 配置示例"] },
      { id: "risk", title: "风险与回滚", lines: ["低风险，可回滚", "不触碰生产部署"] }
    ],
    evidence_refs: [
      {
        id: "ev-weekly",
        source_type: "spec_doc",
        source_id: "doc-1",
        title: "上周周报",
        locator: { path: "docs/weekly.md" },
        confidence_hint: "found"
      },
      {
        id: "ev-config",
        source_type: "drive_file",
        source_id: "file-1",
        title: "配置样例",
        locator: { path: "config/sample.json" },
        confidence_hint: "found"
      }
    ],
    actions: [
      {
        id: "approve",
        label: "同意",
        tone: "primary",
        method: "POST",
        href: "/api/approvals/approval-1/respond"
      },
      {
        id: "request_changes",
        label: "打回",
        tone: "danger",
        method: "POST",
        href: "/api/approvals/approval-1/respond",
        requires_reason: true
      }
    ]
  };
}

function questionCard(): CuuCard {
  return {
    id: "question-card",
    kind: "question",
    state: "asking_approval",
    motion: cuuMotionForState("asking_approval"),
    title: "这次要按哪种口径整理？",
    message: "Cuu 推荐先走轻量方案。",
    priority: "high",
    chips: [
      { id: "minimal", label: "轻量方案", tone: "success", description: "只整理必要字段", recommended: true },
      { id: "complete", label: "完整方案", tone: "warning", description: "覆盖全部材料" }
    ],
    progress: [
      { key: "intent", label: "目标", state: "done", index: 0 },
      { key: "scope", label: "范围", state: "active", index: 1 },
      { key: "confirm", label: "确认", state: "pending", index: 2 }
    ],
    input: {
      mode: "single_choice",
      option_first: true,
      free_text_enabled: true,
      free_text_collapsed_by_default: true,
      free_text_placeholder: "补充一句即可",
      free_text_max_length: 120
    },
    actions: [
      {
        id: "submit_option",
        label: "确认选项",
        tone: "primary",
        method: "POST",
        href: "/api/sessions/session-1/next-question"
      }
    ],
    evidence_refs: [
      {
        id: "ev-intake",
        source_type: "spec_doc",
        source_id: "doc-2",
        title: "需求草稿",
        locator: { path: "docs/intake.md" },
        confidence_hint: "found"
      }
    ]
  };
}

function offlineCard(): CuuCard {
  return {
    id: "offline-card",
    kind: "offline",
    state: "offline",
    motion: cuuMotionForState("offline"),
    title: "Cuu 正在重连",
    message: "WorkHub 暂时连不上服务，Cuu 会继续尝试。",
    priority: "high",
    chips: [{ id: "retrying", label: "重连中", tone: "warning" }],
    actions: [{ id: "open_settings", label: "打开设置", tone: "secondary", href: "/settings" }]
  };
}

test("desktop surface resolver sends Tauri pet routes to the pet surface", () => {
  assert.equal(resolveDesktopSurface({ pathname: "/pet", search: "" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/index.html", search: "", hash: "#surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=main" }), "main");
});

test("pet first-paint scheduler waits for two animation frames before showing the window", () => {
  const calls: string[] = [];
  const rafCallbacks: FrameRequestCallback[] = [];
  const timeoutCallbacks: Array<() => void> = [];
  const cancel = scheduleDesktopPetFirstPaint(() => calls.push("ready"), {
    requestAnimationFrame(callback) {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    setTimeout(callback) {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    },
    clearTimeout() {}
  });

  rafCallbacks.shift()?.(0);
  assert.deepEqual(calls, []);
  rafCallbacks.shift()?.(16);
  assert.deepEqual(calls, ["ready"]);
  timeoutCallbacks.shift()?.();
  assert.deepEqual(calls, ["ready"]);
  cancel();
});

test("pet surface renders only the Live2D cat runtime without main shell or fallback sprites", () => {
  const idle = renderDesktopPetSurface({ idle_action: "idle_tail_sway" });
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true
  });

  assert.equal(idle.visual_mode, "live2d_cat");
  assert.equal(idle.live2d.runtime_kind, "live2d_cubism2_cat");
  assert.equal(idle.live2d.status, "approved_cat_option");
  assert.equal(idle.live2d.model_key, "hijiki");
  assert.equal(idle.live2d.appearance, "black_cat");
  assert.equal(idle.live2d.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(idle.live2d.model_pack_selection_reason, "registry_default");
  assert.equal(idle.live2d.motion_state, "idle_tail_sway");
  assert.match(idle.html, /data-wh-surface="pet"/u);
  assert.match(idle.html, /data-pet-window-mode="body_only"/u);
  assert.match(idle.html, /data-pet-window-width="180"/u);
  assert.match(idle.html, /data-pet-window-height="220"/u);
  assert.match(idle.html, /data-cuu-visual-mode="live2d_cat"/u);
  assert.match(idle.html, /data-cuu-live2d-runtime="live2d_cubism2_cat"/u);
  assert.match(idle.html, /data-cuu-live2d-model="hijiki"/u);
  assert.match(idle.html, /data-cuu-live2d-appearance="black_cat"/u);
  assert.match(idle.html, /class="wh-cuu-cat-live2d-frame"/u);
  assert.match(idle.html, /cuu\/live2d\/hijiki\/cuu-hijiki\.html/u);
  assert.doesNotMatch(idle.html, /wh-cuu-legacy|wh-cuu-atlas|wh-cuu-sprite|experimental_draft_probe/u);
  assert.doesNotMatch(idle.html, /data-cuu-fallback-visual-mode|data-cuu-image-motion/u);
  assert.doesNotMatch(idle.html, /wh-app-shell/u);
  assert.doesNotMatch(idle.html, /textarea|<input\b/iu);

  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-pet-window-mode="card"/u);
  assert.match(card.html, /data-pet-card-kind="approval"/u);
  assert.match(card.html, /data-pet-card-has-context="true"/u);
  assert.match(card.html, /class="wh-pet-kind">审批/u);
  assert.match(card.html, /data-pet-section-id="changes"/u);
  assert.match(card.html, /data-pet-evidence-count="2"/u);
  assert.match(card.html, /data-recommended="true"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.html, /data-cuu-action-id="request_changes"/u);
  assert.match(card.html, /data-pet-reason="证据不足"/u);
});

test("pet surface selects the white Live2D cat option and rejects old model packs", () => {
  const white = renderDesktopPetSurface({
    idle_action: "idle_tail_sway",
    requested_model_pack_id: "cuu-tororo-live2d-cubism2"
  });
  const legacyRequest = renderDesktopPetSurface({
    idle_action: "idle_tail_sway",
    requested_model_pack_id: "legacy-cuu-pack"
  });

  assert.equal(white.live2d.model_pack_id, "cuu-tororo-live2d-cubism2");
  assert.equal(white.live2d.model_pack_selection_reason, "requested_default_ready");
  assert.equal(white.live2d.model_key, "tororo");
  assert.equal(white.live2d.appearance, "white_cat");
  assert.match(white.html, /data-cuu-live2d-model="tororo"/u);
  assert.match(white.html, /data-cuu-live2d-appearance="white_cat"/u);
  assert.match(white.html, /cuu\/live2d\/tororo\/cuu-tororo\.html/u);

  assert.equal(legacyRequest.live2d.model_pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(legacyRequest.live2d.model_pack_selection_reason, "unknown_requested_pack");
  assert.doesNotMatch(legacyRequest.html, /wh-cuu-legacy/u);
});

test("pet surface exposes input-reactive pointer state for Live2D cat QA", () => {
  assert.deepEqual(defaultDesktopPetPointerSnapshot(), {
    cursor_near: false,
    hovered: false,
    dragging: false,
    look_x: 0,
    look_y: 0,
    avoidance_x: 0,
    avoidance_y: 0,
    hover_avoidance: "none"
  });

  const surface = renderDesktopPetSurface({
    idle_action: "look_at_mouse",
    pointer_snapshot: {
      cursor_near: true,
      hovered: true,
      dragging: true,
      look_x: 0.42,
      look_y: -0.18,
      avoidance_x: 0,
      avoidance_y: 0,
      hover_avoidance: "none",
      last_pointer_ms: 1234
    }
  });

  assert.match(surface.html, /data-pet-cursor-near="true"/u);
  assert.match(surface.html, /data-pet-hovered="true"/u);
  assert.match(surface.html, /data-pet-dragging="true"/u);
  assert.match(surface.html, /data-pet-look-x="0\.42"/u);
  assert.match(surface.html, /data-pet-look-y="-0\.18"/u);
  assert.match(surface.html, /data-pet-pointer-smoothing-alpha="0\.58"/u);
  assert.match(surface.html, /--wh-pet-look-head-x-px:3\.78px/u);
  assert.match(surface.html, /data-cuu-live2d-state="look_at_mouse"/u);
  assert.match(surface.css, /data-pet-cursor-near=true.*?\.wh-cuu-cat-live2d/u);
  assert.match(surface.css, /data-pet-dragging=true.*?cursor:grabbing/u);
});

test("pet pointer helpers normalize Rust look percent and hover avoidance", () => {
  const sampled = desktopPetPointerSnapshotFromSample(
    { pointer: { cursor_near: true, look_x_percent: 43, look_y_percent: -25 } },
    defaultDesktopPetPointerSnapshot()
  );

  assert.equal(sampled.look_x, 0.43);
  assert.equal(sampled.look_y, -0.25);

  const root = {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 100 };
    }
  } as HTMLElement;
  const hovered = normalizeDesktopPetPointerSnapshot({
    ...sampled,
    ...pointerPatchFromEvent(root, { clientX: 180, clientY: 20 } as PointerEvent, { cursor_near: true })
  });

  assert.equal(hovered.look_x, 0.8);
  assert.equal(hovered.look_y, -0.6);
  assert.equal(hovered.hover_avoidance, "soft");
  assert.ok(hovered.avoidance_x < 0);
  assert.ok(hovered.avoidance_y > 0);
});

test("pet surface renders clarification cards as option-first light cards", () => {
  const card = renderDesktopPetSurface({ card: questionCard() });
  const english = renderDesktopPetSurface({ card: questionCard(), locale: "en-US" });

  assert.match(card.html, /data-pet-card-kind="question"/u);
  assert.match(card.html, /class="wh-pet-kind">澄清/u);
  assert.match(card.html, /class="wh-pet-progress"/u);
  assert.match(card.html, /data-pet-option-id="minimal"/u);
  assert.match(card.html, /type="button" aria-pressed="false"/u);
  assert.match(card.html, /data-pet-option-first="true"/u);
  assert.match(card.html, /点选项即可，补充文字已折叠/u);
  assert.match(card.html, /data-cuu-action-id="submit_option"/u);
  assert.doesNotMatch(card.html, /textarea|<input\b/iu);

  assert.match(english.html, /class="wh-pet-kind">Clarify/u);
  assert.match(english.html, /Choose an option; text is folded away/u);
  assert.match(english.html, /aria-label="Cuu desktop pet"/u);
});

test("pet surface localizes fixed approval bubble controls in English", () => {
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "Choose one reason so Cuu can revise with it.",
    include_reject_reasons: true,
    locale: "en-US"
  });

  assert.match(card.html, /class="wh-pet-kind">Approval/u);
  assert.match(card.html, /class="wh-pet-priority" data-priority="urgent">Urgent/u);
  assert.match(card.html, /class="wh-pet-evidence-title">Evidence/u);
  assert.match(card.html, /data-pet-reason="Not enough evidence"/u);
  assert.doesNotMatch(card.html, /data-pet-reason="证据不足"|class="wh-pet-kind">审批|>急</u);
});

test("pet surface starts with a non-static runtime action fixture and fast idle cadence", () => {
  assert.equal(desktopPetInitialIdleAction, "idle_tail_sway");

  const idle = renderDesktopPetSurface({ idle_action: desktopPetInitialIdleAction });
  assert.match(idle.html, /data-cuu-idle-action="idle_tail_sway"/u);
  assert.match(idle.html, /data-cuu-live2d-runtime="live2d_cubism2_cat"/u);
  assert.equal(idle.live2d.motion_state, "idle_tail_sway");

  const scheduler = createCuuIdleScheduler({
    now_ms: 0,
    policy: desktopPetAliveIdlePolicy,
    random: () => 0
  });
  assert.deepEqual([scheduler.tick({ now_ms: 1200 }).action, scheduler.snapshot().last_action], ["idle_blink", "idle_blink"]);
  assert.equal(scheduler.tick({ now_ms: 2200 }).action, "idle_tail_sway");
  assert.equal(scheduler.tick({ now_ms: 3200, cursor_near: true }).action, "look_at_mouse");
});

test("desktop pet scheduler factory uses the lively first-screen cadence", () => {
  const scheduler = createDesktopPetIdleScheduler(0);
  assert.equal(desktopPetPointerSmoothingAlpha, 0.58);
  assert.equal(scheduler.tick({ now_ms: 1800 }).reason, "blink_due");
});

test("pet surface renders compact fallback while card mode is not confirmed", () => {
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    window_mode_error: "Cannot switch Cuu pet window to card: Tauri invoke bridge is unavailable.",
    window_mode_status: "failed"
  });

  assert.match(card.html, /data-pet-window-mode="body_only"/u);
  assert.match(card.html, /data-pet-card-layout="compact"/u);
  assert.match(card.html, /data-pet-window-mode-status="failed"/u);
  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.doesNotMatch(card.html, /data-cuu-action-id="request_changes"/u);
  assert.doesNotMatch(card.html, /data-pet-reason/u);
});

test("pet surface keeps offline Cuu fully visible in card mode", () => {
  const card = renderDesktopPetSurface({ card: offlineCard() });

  assert.match(card.html, /data-cuu-state="offline"/u);
  assert.match(card.html, /data-cuu-live2d-motion="worried_ears"/u);
  assert.doesNotMatch(card.html, /data-cuu-live2d-motion="offline_sleep"/u);
  assert.equal(card.live2d.motion_state, "worried_ears");
});

test("pet surface passes the Cuu independent desktop visual QA contract", () => {
  const idle = renderDesktopPetSurface({ idle_action: "idle_tail_sway" });
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true
  });
  const report = createDesktopPetVisualQaReport({ idle, card });

  assert.deepEqual(report.failed_checks, []);
  assert.equal(report.passed, true);
  assertDesktopPetVisualQaPass(report);
});

test("pet window bridge resolves body/card modes and Tauri-like commands", async () => {
  const calls: string[] = [];
  const mockBridge = {
    setMode(mode: "body_only" | "card") {
      calls.push(`mode:${mode}`);
    }
  };
  assert.equal(desktopPetWindowModeForCard(undefined), "body_only");
  assert.equal(desktopPetWindowModeForCard(approvalCard()), "card");
  assert.equal(resolveDesktopPetWindowBridge({ __WORKHUB_PET__: mockBridge }), mockBridge);

  const tauri = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string, args?: Record<string, unknown>) {
          calls.push(`${command}:${args?.mode ?? args?.scalePercent ?? ""}`);
          if (command === "set_pet_window_mode") {
            return { placement: { mode: args?.mode, size: { width: 380, height: 560 } } };
          }
          if (command === "set_pet_window_settings") {
            return {
              settings: {
                scalePercent: args?.scalePercent,
                opacityPercent: args?.opacityPercent,
                passThrough: args?.passThrough,
                hideOnHover: args?.hideOnHover
              }
            };
          }
          return command === "sample_pet_cursor_near";
        }
      },
      window: {
        getCurrentWindow() {
          return {
            startDragging() {
              calls.push("startDragging");
            }
          };
        }
      }
    }
  });

  await tauri?.setMode?.("card");
  await tauri?.setSettings?.({ scale_percent: 125, opacity_percent: 80, pass_through: true, hide_on_hover: true });
  await tauri?.startDragging?.();
  assert.equal(await tauri?.sampleCursorNear?.(), true);
  assert.deepEqual(calls, ["set_pet_window_mode:card", "set_pet_window_settings:125", "startDragging", "sample_pet_cursor_near:"]);
});

test("pet window bridge rejects unavailable invoke and maps preferences", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      window: {
        getCurrentWindow() {
          return { label: "pet" };
        }
      }
    }
  });

  assert.equal(bridge?.diagnostics?.invoke_available, false);
  await assert.rejects(
    async () => bridge?.setMode?.("card"),
    /Tauri invoke bridge is unavailable/u
  );
  assert.deepEqual(
    desktopPetWindowSettingsFromPreferences({
      pet_scale_percent: 150,
      pet_opacity_percent: 60,
      pet_pass_through: true,
      pet_hide_on_hover: true
    }),
    { scale_percent: 150, opacity_percent: 60, pass_through: true, hide_on_hover: true }
  );
});
