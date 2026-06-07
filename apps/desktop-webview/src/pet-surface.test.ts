import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createCuuIdleScheduler,
  cuuMotionForState,
  validateCuuSpriteAtlasManifest,
  type CuuCard,
  type CuuSpriteAtlasManifest
} from "@workhub/cuu";

import {
  desktopCuuP1AtlasManifest,
  desktopCuuP1AtlasManifestUrl,
  desktopCuuP1ClipSheetImages,
  desktopCuuP1StaticFallbackImage,
  validateDesktopCuuP1AtlasManifest
} from "./cuu-atlas-assets.js";
import { renderDesktopCuuAtlasSprite, renderDesktopCuuAtlasState } from "./cuu-atlas-runtime.js";
import { renderDesktopCuuBongoForIdleAction, renderDesktopCuuBongoForMotion } from "./cuu-bongo-runtime.js";
import {
  createDesktopPetIdleScheduler,
  desktopPetAliveIdlePolicy,
  desktopPetInitialIdleAction,
  renderDesktopPetSurface,
  resolveDesktopSurface,
  scheduleDesktopPetFirstPaint
} from "./pet-surface.js";
import { assertDesktopPetVisualQaPass, createDesktopPetVisualQaReport } from "./pet-surface-qa.js";
import { desktopPetWindowModeForCard, resolveDesktopPetWindowBridge } from "./pet-window-bridge.js";

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
    actions: [
      {
        id: "open_settings",
        label: "打开设置",
        tone: "secondary",
        href: "/settings"
      }
    ]
  };
}

test("desktop Cuu P1 atlas manifest points at the generated transparent sample", () => {
  assert.deepEqual(validateDesktopCuuP1AtlasManifest(), []);
  assert.match(desktopCuuP1AtlasManifest.atlas.image_path, /cuu-p1-motion-pack\.png/u);
  assert.match(desktopCuuP1AtlasManifestUrl, /cuu\.sprite\.json/u);
  assert.equal(desktopCuuP1AtlasManifest.clips.idle_breathe?.frames.length, 8);
  assert.equal(desktopCuuP1AtlasManifest.clips.thinking_tail?.frames.at(0)?.y, 1024);
  assert.equal(desktopCuuP1AtlasManifest.clips.asking_approval_bounce?.priority, "urgent");
  assert.equal(desktopCuuP1AtlasManifest.clips.syncing_files_spin?.frames.at(0)?.y, 5464);
  assert.equal(desktopCuuP1AtlasManifest.clips.offline_sleep?.frames.at(0)?.y, 8128);
  assert.equal(desktopCuuP1AtlasManifest.clips.idle_blink?.frames.at(0)?.y, 9016);
  assert.equal(desktopCuuP1AtlasManifest.clips.wave_hello?.frames.at(0)?.y, 15232);
});

test("desktop Cuu JSON sprite manifest validates against the shared atlas schema", () => {
  const manifest = JSON.parse(readFileSync(new URL("./assets/cuu/atlas/cuu.sprite.json", import.meta.url), "utf8")) as CuuSpriteAtlasManifest;

  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest), []);
  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest, { require_full_motion_coverage: true }), []);
  assert.deepEqual(validateCuuSpriteAtlasManifest(manifest, { require_idle_micro_action_coverage: true }), []);
  assert.equal(manifest.atlas.image_path, "cuu-p1-motion-pack.png");
  assert.equal(manifest.clips.idle_breathe?.reduced_motion_frame_id, "idle_breathe-000");
  assert.equal(Object.keys(manifest.clips).length, 18);
  assert.equal(manifest.clips.searching_evidence_peek?.frames.at(0)?.y, 4576);
  assert.equal(manifest.clips.offline_sleep?.priority, "idle");
  assert.equal(manifest.clips.idle_tail_sway?.frames.at(0)?.y, 9904);
  assert.equal(manifest.clips.drag_hold?.priority, "normal");
});

test("desktop Cuu atlas renderer emits keyframes from atlas rectangles", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("idle"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "idle_breathe");
  assert.equal(render.fallback, false);
  assert.equal(render.frame_count, 8);
  assert.match(render.html, /data-cuu-atlas-state="idle_breathe"/u);
  assert.match(render.html, /data-frame-count="8"/u);
  assert.match(render.css, /@keyframes wh-cuu-atlas-idle_breathe/u);
  assert.match(render.css, /background-position:-444px -197px/u);
});

test("desktop Cuu atlas renderer uses generated business motion clips", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("thinking"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "thinking_tail");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-requested-state="thinking_tail"/u);
  assert.match(render.html, /data-fallback="false"/u);
});

test("desktop Cuu atlas renderer has business-state full coverage in the P1 pack", () => {
  const render = renderDesktopCuuAtlasSprite(cuuMotionForState("worried"), desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "worried_ears");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-requested-state="worried_ears"/u);
  assert.match(render.html, /data-fallback="false"/u);
});

test("desktop Cuu atlas renderer uses generated idle micro action clips", () => {
  const render = renderDesktopCuuAtlasState("idle_tail_sway", desktopCuuP1AtlasManifest);

  assert.equal(render.clip.state, "idle_tail_sway");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-requested-state="idle_tail_sway"/u);
});

test("desktop Cuu renderer can use per-action clip sheets for the Tauri pet window", () => {
  const render = renderDesktopCuuAtlasState("idle_tail_sway", desktopCuuP1AtlasManifest, {
    clip_images: desktopCuuP1ClipSheetImages,
    prefer_background_clip_sheet: true
  });

  assert.equal(render.clip.state, "idle_tail_sway");
  assert.equal(render.fallback, false);
  assert.match(render.html, /data-cuu-image-mode="clip_sheet"/u);
  assert.match(render.html, /data-cuu-render-mode="background"/u);
  assert.match(render.html, /data-cuu-static-fallback="false"/u);
  assert.match(render.html, /class="wh-cuu-atlas-frame"/u);
  assert.match(render.css, /background-position:0px 0px/u);
  assert.match(render.html, /cuu-idle-tail-sway-sheet-v1-alpha-clean\.png/u);
});

test("desktop Cuu keeps dev-server sprite URLs while relativizing packaged assets", () => {
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  try {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: new URL("http://127.0.0.1:1420/")
    });

    const devRender = renderDesktopCuuAtlasState("idle_tail_sway", desktopCuuP1AtlasManifest, {
      clip_images: {
        idle_tail_sway: {
          ...desktopCuuP1ClipSheetImages.idle_tail_sway,
          image_path: "http://127.0.0.1:1420/src/assets/cuu/alpha/idle_tail_sway/cuu-idle-tail-sway-sheet-v1-alpha-clean.png"
        }
      },
      prefer_background_clip_sheet: true
    });
    const packagedRender = renderDesktopCuuAtlasState("idle_tail_sway", desktopCuuP1AtlasManifest, {
      clip_images: {
        idle_tail_sway: {
          ...desktopCuuP1ClipSheetImages.idle_tail_sway,
          image_path: "http://127.0.0.1:1420/assets/cuu-idle-tail-sway-sheet-v1-alpha-clean.png"
        }
      },
      prefer_background_clip_sheet: true
    });

    assert.match(devRender.html, /url\(&quot;\/src\/assets\/cuu\/alpha\/idle_tail_sway\/cuu-idle-tail-sway-sheet-v1-alpha-clean\.png&quot;\)/u);
    assert.doesNotMatch(devRender.html, /url\(&quot;\.\/assets\/cuu\/alpha\/idle_tail_sway/u);
    assert.match(packagedRender.html, /url\(&quot;\.\/assets\/cuu-idle-tail-sway-sheet-v1-alpha-clean\.png&quot;\)/u);
  } finally {
    if (previousLocation) {
      Object.defineProperty(globalThis, "location", previousLocation);
    } else {
      Reflect.deleteProperty(globalThis, "location");
    }
  }
});

test("desktop Cuu clip sheets hide static fallback once live frames are ready", () => {
  const render = renderDesktopCuuAtlasState("wave_hello", desktopCuuP1AtlasManifest, {
    clip_images: desktopCuuP1ClipSheetImages,
    fallback_image: desktopCuuP1StaticFallbackImage
  });

  assert.equal(render.clip.state, "wave_hello");
  assert.equal(render.clip.loop, false);
  assert.match(render.css, /not\(\[data-frames-ready=true\]\).*?wh-cuu-atlas-img-frame\{animation:none!important/u);
  assert.match(render.css, /data-frames-ready=true.*?wh-cuu-atlas-static-fallback\{opacity:0;animation:none/u);
  assert.match(render.css, /animation-fill-mode:both/u);
  assert.match(render.html, /dataset\.framesReady='true'/u);
  assert.match(render.css, /100%\{opacity:1\}/u);
});

test("desktop surface resolver sends Tauri pet routes to the pet surface", () => {
  assert.equal(resolveDesktopSurface({ pathname: "/pet", search: "" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/index.html", search: "", hash: "#surface=pet" }), "pet");
  assert.equal(resolveDesktopSurface({ pathname: "/", search: "?surface=main" }), "main");
});

test("desktop surface resolver accepts the dedicated pet html entry flag", () => {
  const target = globalThis as typeof globalThis & { __WORKHUB_SURFACE__?: string };
  const previous = target.__WORKHUB_SURFACE__;
  try {
    target.__WORKHUB_SURFACE__ = "pet";
    assert.equal(resolveDesktopSurface({ pathname: "/pet.html", search: "", hash: "" }), "pet");
  } finally {
    if (previous === undefined) {
      delete target.__WORKHUB_SURFACE__;
    } else {
      target.__WORKHUB_SURFACE__ = previous;
    }
  }
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

  assert.deepEqual(calls, []);
  rafCallbacks.shift()?.(0);
  assert.deepEqual(calls, []);
  rafCallbacks.shift()?.(16);
  assert.deepEqual(calls, ["ready"]);
  timeoutCallbacks.shift()?.();
  assert.deepEqual(calls, ["ready"]);
  cancel();
});

test("pet first-paint scheduler still releases hidden webviews through the timeout fallback", () => {
  const calls: string[] = [];
  const timeoutCallbacks: Array<() => void> = [];
  scheduleDesktopPetFirstPaint(() => calls.push("ready"), {
    setTimeout(callback) {
      timeoutCallbacks.push(callback);
      return timeoutCallbacks.length;
    },
    clearTimeout() {}
  });

  assert.deepEqual(calls, []);
  timeoutCallbacks.shift()?.();
  assert.deepEqual(calls, ["ready"]);
});

test("desktop surface resolver treats the Tauri pet window label as the pet surface", () => {
  const target = globalThis as typeof globalThis & { __TAURI__?: unknown };
  const previous = target.__TAURI__;
  try {
    target.__TAURI__ = {
      window: {
        getCurrentWindow() {
          return { label: "pet" };
        }
      }
    };
    assert.equal(resolveDesktopSurface({ pathname: "/", search: "", hash: "" }), "pet");
  } finally {
    if (previous === undefined) {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = previous;
    }
  }
});

test("desktop surface resolver accepts the Tauri v2 webviewWindow label", () => {
  const target = globalThis as typeof globalThis & { __TAURI__?: unknown };
  const previous = target.__TAURI__;
  try {
    target.__TAURI__ = {
      webviewWindow: {
        getCurrentWebviewWindow() {
          return { label: "pet" };
        }
      }
    };
    assert.equal(resolveDesktopSurface({ pathname: "/", search: "", hash: "" }), "pet");
  } finally {
    if (previous === undefined) {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = previous;
    }
  }
});

test("pet surface renders Cuu without the main Gold Path shell", () => {
  const idle = renderDesktopPetSurface({ idle_action: "idle_tail_sway" });
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    status_text: "先点一个原因，Cuu 会带着它继续改。",
    include_reject_reasons: true
  });

  assert.match(idle.html, /data-wh-surface="pet"/u);
  assert.match(idle.html, /data-pet-window-mode="body_only"/u);
  assert.match(idle.html, /data-cuu-idle-action="idle_tail_sway"/u);
  assert.equal(idle.visual_mode, "bongo_cuu");
  assert.equal(idle.bongo.runtime_kind, "bongo_cuu");
  assert.equal(idle.bongo.status, "p1_default_low_uncanny");
  assert.equal(idle.bongo.motion_state, "idle_tail_sway");
  assert.equal(idle.bongo.component_count, 31);
  assert.equal(idle.sprite.clip.state, "idle_tail_sway");
  assert.match(idle.html, /data-cuu-visual-mode="bongo_cuu"/u);
  assert.match(idle.html, /data-cuu-bongo-runtime="bongo_cuu"/u);
  assert.match(idle.html, /data-cuu-bongo-state="idle_tail_sway"/u);
  assert.match(idle.html, /wh-cuu-bongo-paw/u);
  assert.match(idle.html, /wh-cuu-bongo-eye/u);
  assert.match(idle.html, /wh-cuu-bongo-tail/u);
  assert.match(idle.html, /wh-cuu-bongo-search-glass/u);
  assert.match(idle.html, /wh-cuu-bongo-sync-ring/u);
  assert.match(idle.html, /wh-cuu-bongo-spark/u);
  assert.doesNotMatch(idle.html, /data-cuu-live2d-runtime="psd_draft_probe"/u);
  assert.doesNotMatch(idle.html, /data-psd-layer=/u);
  assert.doesNotMatch(idle.html, /class="wh-cuu-atlas-static-fallback"/u);
  assert.match(idle.html, /data-cuu-manifest-url="[^"]*cuu\.sprite\.json/u);
  assert.doesNotMatch(idle.html, /wh-app-shell/u);
  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-pet-window-mode="card"/u);
  assert.match(card.html, /data-cuu-bongo-motion="asking_approval_bounce"/u);
  assert.match(card.html, /data-cuu-bongo-state="asking_approval_bounce"/u);
  assert.match(card.html, /data-cuu-atlas-fallback="false"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.html, /data-pet-reason="证据不足"/u);
  assert.doesNotMatch(card.html, /textarea/u);
  assert.match(card.css, /data-pet-window-mode=card.*?\.wh-pet-bubble\{left:16px;right:auto;top:16px;bottom:auto/u);
  assert.match(card.css, /data-pet-window-mode=card.*?\.wh-pet-bubble\{[^}]*width:260px/u);
});

test("desktop Cuu Bongo renderer makes P1b business and idle actions readable", () => {
  const search = renderDesktopCuuBongoForMotion(cuuMotionForState("searching_evidence"));
  const sync = renderDesktopCuuBongoForMotion(cuuMotionForState("syncing_files"));
  const revise = renderDesktopCuuBongoForMotion(cuuMotionForState("revision_requested"));
  const carry = renderDesktopCuuBongoForMotion(cuuMotionForState("carrying_document"));
  const wave = renderDesktopCuuBongoForIdleAction("wave_hello");
  const drag = renderDesktopCuuBongoForIdleAction("drag_hold");

  assert.equal(search.component_count, 31);
  assert.match(search.html, /data-cuu-bongo-state="searching_evidence_peek"/u);
  assert.match(search.html, /wh-cuu-bongo-search-glass/u);
  assert.match(search.css, /wh-cuu-bongo-search-peek/u);
  assert.match(search.css, /wh-cuu-bongo-search-ray/u);
  assert.match(sync.html, /data-cuu-bongo-state="syncing_files_spin"/u);
  assert.match(sync.css, /wh-cuu-bongo-sync-ring/u);
  assert.match(revise.html, /data-cuu-bongo-state="revision_requested_nod"/u);
  assert.match(revise.css, /wh-cuu-bongo-revision-nod/u);
  assert.match(carry.html, /data-cuu-bongo-state="carrying_document_step"/u);
  assert.match(carry.css, /wh-cuu-bongo-doc-carry/u);
  assert.match(wave.html, /data-cuu-bongo-requested-state="wave_hello"/u);
  assert.match(wave.css, /wh-cuu-bongo-wave/u);
  assert.match(drag.html, /data-cuu-bongo-requested-state="drag_hold"/u);
  assert.match(drag.css, /wh-cuu-bongo-grip/u);
});

test("pet surface starts with a non-static runtime action fixture and fast idle cadence", () => {
  assert.equal(desktopPetInitialIdleAction, "idle_tail_sway");

  const idle = renderDesktopPetSurface({ idle_action: desktopPetInitialIdleAction });
  assert.match(idle.html, /data-cuu-idle-action="idle_tail_sway"/u);
  assert.match(idle.html, /data-cuu-bongo-runtime="bongo_cuu"/u);
  assert.match(idle.html, /data-cuu-bongo-motion="idle_tail_sway"/u);
  assert.equal(idle.sprite.clip.state, "idle_tail_sway");

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
  assert.equal(scheduler.tick({ now_ms: 1800 }).reason, "blink_due");
});

test("pet surface renders a compact fallback while card mode is not confirmed", () => {
  const card = renderDesktopPetSurface({
    card: approvalCard(),
    window_mode_error: "Cannot switch Cuu pet window to card: Tauri invoke bridge is unavailable.",
    window_mode_status: "failed"
  });

  assert.match(card.html, /data-pet-window-mode="body_only"/u);
  assert.match(card.html, /data-pet-card-layout="compact"/u);
  assert.match(card.html, /data-pet-window-mode-status="failed"/u);
  assert.match(card.html, /data-pet-window-mode-error="Cannot switch Cuu pet window/u);
  assert.match(card.html, /data-cuu-card-id="approval-card"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.doesNotMatch(card.html, /点一个选项即可继续。/u);
  assert.doesNotMatch(card.html, /data-cuu-action-id="request_changes"/u);
  assert.doesNotMatch(card.html, /data-pet-reason/u);
});

test("pet surface keeps offline Cuu fully visible in card mode", () => {
  const card = renderDesktopPetSurface({
    card: offlineCard()
  });

  assert.match(card.html, /data-cuu-state="offline"/u);
  assert.match(card.html, /data-cuu-bongo-motion="worried_ears"/u);
  assert.doesNotMatch(card.html, /data-cuu-bongo-motion="offline_sleep"/u);
  assert.equal(card.sprite.clip.state, "worried_ears");
  assert.match(card.html, /--wh-cuu-bongo-w:138px/u);
  assert.match(card.css, /data-pet-window-mode=card.*?\.wh-pet-body\{right:64px;bottom:96px;width:150px;height:210px/u);
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
          calls.push(`${command}:${args?.mode ?? ""}`);
          if (command === "set_pet_window_mode") {
            return {
              placement: {
                mode: args?.mode,
                size: { width: 380, height: 560 }
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
  await tauri?.startDragging?.();
  assert.equal(await tauri?.sampleCursorNear?.(), true);
  assert.deepEqual(calls, ["set_pet_window_mode:card", "startDragging", "sample_pet_cursor_near:"]);
});

test("pet window bridge accepts legacy top-level Tauri invoke for mode switching", async () => {
  const calls: string[] = [];
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      async invoke(command: string, args?: Record<string, unknown>) {
        calls.push(`${command}:${args?.mode ?? ""}`);
        return {
          placement: {
            mode: args?.mode,
            size: { width: 380, height: 560 }
          }
        };
      }
    }
  });

  await bridge?.setMode?.("card");
  assert.equal(bridge?.diagnostics?.invoke_available, true);
  assert.deepEqual(calls, ["set_pet_window_mode:card"]);
});

test("pet window bridge rejects mode switches without a Rust placement plan", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke() {
          return undefined;
        }
      }
    }
  });

  await assert.rejects(
    async () => bridge?.setMode?.("card"),
    /did not confirm card mode/u
  );
});

test("pet window bridge reports missing invoke instead of silently dropping setMode", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      window: {
        getCurrentWindow() {
          return {
            startDragging() {}
          };
        }
      }
    }
  });

  assert.equal(bridge?.diagnostics?.invoke_available, false);
  assert.deepEqual(bridge?.diagnostics?.missing, ["__TAURI__.core.invoke"]);
  await assert.rejects(
    async () => bridge?.setMode?.("card"),
    /Tauri invoke bridge is unavailable/u
  );
});

test("pet window bridge treats Rust-injected pet surface without globals as diagnostic mode", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __WORKHUB_SURFACE__: "pet",
    location: { pathname: "/" }
  });

  assert.equal(bridge?.diagnostics?.invoke_available, false);
  assert.equal(bridge?.diagnostics?.drag_available, false);
  await assert.rejects(
    async () => bridge?.setMode?.("card"),
    /Tauri invoke bridge is unavailable/u
  );
});

test("pet window bridge treats Tauri pet window label without invoke as diagnostic mode", async () => {
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
  assert.equal(bridge?.diagnostics?.drag_available, false);
  await assert.rejects(
    async () => bridge?.setMode?.("card"),
    /Tauri invoke bridge is unavailable/u
  );
});

test("pet window bridge can start dragging through the Rust command fallback", async () => {
  const calls: string[] = [];
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string) {
          calls.push(command);
          return false;
        }
      }
    }
  });

  await bridge?.startDragging?.();
  await bridge?.savePosition?.();
  assert.deepEqual(calls, ["start_pet_window_drag", "save_pet_window_position"]);
});

test("pet window bridge accepts the Tauri v2 webviewWindow drag handle", async () => {
  const calls: string[] = [];
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      webviewWindow: {
        getCurrentWebviewWindow() {
          return {
            startDragging() {
              calls.push("webviewWindow.startDragging");
            }
          };
        }
      }
    }
  });

  await bridge?.startDragging?.();
  assert.deepEqual(calls, ["webviewWindow.startDragging"]);
});

test("pet window bridge accepts Rust cursor sample command plans", async () => {
  const bridge = resolveDesktopPetWindowBridge({
    __TAURI__: {
      core: {
        async invoke(command: string) {
          assert.equal(command, "sample_pet_cursor_near");
          return {
            pointer: {
              insideWindow: false,
              cursorNear: true,
              distanceToWindowPx: 24
            }
          };
        }
      }
    }
  });

  assert.equal(await bridge?.sampleCursorNear?.(), true);
});
