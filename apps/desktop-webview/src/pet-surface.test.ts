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
      {
        id: "changes",
        title: "这次改了什么",
        lines: ["更新周报草稿和验收清单", "新增 JSON 配置示例"]
      },
      {
        id: "risk",
        title: "风险与回滚",
        lines: ["低风险，可回滚", "不触碰生产部署"]
      }
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
      {
        id: "minimal",
        label: "轻量方案",
        tone: "success",
        description: "只整理必要字段",
        recommended: true
      },
      {
        id: "complete",
        label: "完整方案",
        tone: "warning",
        description: "覆盖全部材料"
      }
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
  assert.match(idle.html, /data-pet-scale-percent="100"/u);
  assert.match(idle.html, /data-pet-opacity-percent="100"/u);
  assert.match(idle.html, /data-pet-pass-through="false"/u);
  assert.match(idle.html, /data-pet-hide-on-hover="false"/u);
  assert.match(idle.html, /data-pet-hover-hidden="false"/u);
  assert.match(idle.html, /data-pet-window-width="180"/u);
  assert.match(idle.html, /data-pet-window-height="220"/u);
  assert.match(idle.html, /data-pet-cursor-near="false"/u);
  assert.match(idle.html, /data-pet-hovered="false"/u);
  assert.match(idle.html, /data-pet-dragging="false"/u);
  assert.match(idle.html, /data-cuu-idle-action="idle_tail_sway"/u);
  assert.equal(idle.visual_mode, "bongo_cuu");
  assert.equal(idle.bongo.runtime_kind, "bongo_cuu");
  assert.equal(idle.bongo.status, "p1_default_low_uncanny");
  assert.equal(idle.bongo.model_pack_id, "cuu-bongo-p1");
  assert.equal(idle.bongo.motion_state, "idle_tail_sway");
  assert.equal(idle.bongo.component_count, 31);
  assert.equal(idle.sprite.clip.state, "idle_tail_sway");
  assert.match(idle.html, /data-cuu-visual-mode="bongo_cuu"/u);
  assert.match(idle.html, /data-cuu-bongo-runtime="bongo_cuu"/u);
  assert.match(idle.html, /data-cuu-model-pack="cuu-bongo-p1"/u);
  assert.match(idle.html, /data-cuu-default-visual-gate="low_uncanny"/u);
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
  assert.match(card.html, /data-pet-card-kind="approval"/u);
  assert.match(card.html, /data-pet-card-priority="urgent"/u);
  assert.match(card.html, /data-pet-card-has-context="true"/u);
  assert.match(card.html, /data-pet-bubble-kind="approval"/u);
  assert.match(card.html, /class="wh-pet-kind">审批/u);
  assert.match(card.html, /data-pet-section-id="changes"/u);
  assert.match(card.html, /data-pet-section-id="risk"/u);
  assert.match(card.html, /data-pet-evidence-count="2"/u);
  assert.match(card.html, /data-evidence-ref-id="ev-weekly"/u);
  assert.match(card.html, /data-recommended="true"/u);
  assert.match(card.html, /data-cuu-bongo-motion="asking_approval_bounce"/u);
  assert.match(card.html, /data-cuu-bongo-state="asking_approval_bounce"/u);
  assert.match(card.html, /data-cuu-atlas-fallback="false"/u);
  assert.match(card.html, /data-cuu-action-id="approve"/u);
  assert.match(card.html, /data-pet-reason="证据不足"/u);
  assert.doesNotMatch(card.html, /textarea/u);
  assert.match(card.css, /data-pet-window-mode=card.*?\.wh-pet-bubble\{left:calc\(16px \* var\(--wh-pet-scale,1\)\);right:auto;top:calc\(16px \* var\(--wh-pet-scale,1\)\);bottom:auto/u);
  assert.match(card.css, /data-pet-window-mode=card.*?\.wh-pet-bubble\{[^}]*width:calc\(260px \* var\(--wh-pet-scale,1\)\)/u);
});

test("pet surface scales Cuu, opacity and pass-through from window settings", () => {
  const surface = renderDesktopPetSurface({
    idle_action: "idle_tail_sway",
    pet_window_settings: {
      scale_percent: 125,
      opacity_percent: 80,
      pass_through: true,
      hide_on_hover: true
    }
  });

  assert.match(surface.html, /style="--wh-pet-scale:1\.25;--wh-pet-opacity:0\.8;--wh-pet-window-w:225px;--wh-pet-window-h:275px/u);
  assert.match(surface.html, /data-pet-scale-percent="125"/u);
  assert.match(surface.html, /data-pet-opacity-percent="80"/u);
  assert.match(surface.html, /data-pet-pass-through="true"/u);
  assert.match(surface.html, /data-pet-hide-on-hover="true"/u);
  assert.match(surface.html, /data-pet-hover-hidden="false"/u);
  assert.match(surface.html, /data-pet-window-width="225"/u);
  assert.match(surface.html, /data-pet-window-height="275"/u);
  assert.match(surface.html, /--wh-cuu-bongo-w:185px/u);
});

test("pet surface soft-hides Bongo-style Cuu on hover when enabled", () => {
  const surface = renderDesktopPetSurface({
    idle_action: "look_at_mouse",
    pet_window_settings: {
      scale_percent: 100,
      opacity_percent: 100,
      pass_through: false,
      hide_on_hover: true
    },
    pointer_snapshot: {
      cursor_near: true,
      hovered: true,
      dragging: false,
      look_x: 0.8,
      look_y: -0.5,
      avoidance_x: -0.64,
      avoidance_y: 0.3,
      hover_avoidance: "soft"
    }
  });

  assert.match(surface.html, /data-pet-hide-on-hover="true"/u);
  assert.match(surface.html, /data-pet-hover-hidden="true"/u);
  assert.match(surface.html, /data-pet-hover-hide-mode="soft"/u);
  assert.match(surface.html, /--wh-pet-hide-opacity:0\.36/u);
  assert.match(surface.html, /--wh-pet-hide-scale:0\.92/u);
  assert.match(surface.html, /--wh-pet-hide-x-px:-26\.88px/u);
  assert.match(surface.css, /data-pet-hover-hidden=true.*?transition-duration:140ms/u);
});

test("pet surface exposes input-reactive pointer state for Bongo-style QA", () => {
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
  assert.match(surface.html, /data-pet-hover-avoidance="none"/u);
  assert.match(surface.html, /data-pet-pointer-smoothing-alpha="0\.58"/u);
  assert.match(surface.html, /data-pet-last-pointer-ms="1234"/u);
  assert.match(surface.html, /--wh-pet-pointer-smoothing-alpha:0\.58/u);
  assert.match(surface.html, /--wh-pet-look-head-x-px:3\.78px/u);
  assert.match(surface.html, /--wh-pet-look-eye-y-px:-0\.72px/u);
  assert.match(surface.html, /data-cuu-idle-action="look_at_mouse"/u);
  assert.match(surface.html, /data-cuu-bongo-requested-state="look_at_mouse"/u);
  assert.match(surface.css, /data-pet-cursor-near=true.*?saturate\(1\.04\)/u);
  assert.match(surface.css, /data-pet-dragging=true.*?cursor:grabbing/u);
  assert.match(surface.css, /data-pet-cursor-near=true.*?--wh-pet-look-head-x-px/u);
  assert.match(surface.css, /data-pet-hover-avoidance=soft.*?transition-duration:120ms/u);
});

test("pet pointer helpers normalize Rust look percent and hover avoidance", () => {
  const previous = defaultDesktopPetPointerSnapshot();
  const sampled = desktopPetPointerSnapshotFromSample(
    {
      pointer: {
        cursor_near: true,
        look_x_percent: 43,
        look_y_percent: -25
      }
    },
    previous
  );

  assert.deepEqual(sampled, {
    cursor_near: true,
    hovered: false,
    dragging: false,
    look_x: 0.43,
    look_y: -0.25,
    avoidance_x: 0,
    avoidance_y: 0,
    hover_avoidance: "none"
  });

  const root = {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 100 };
    }
  } as HTMLElement;
  const patch = pointerPatchFromEvent(root, { clientX: 180, clientY: 20 } as PointerEvent, { cursor_near: true });
  const hovered = normalizeDesktopPetPointerSnapshot({
    ...sampled,
    ...patch
  });

  assert.equal(hovered.look_x, 0.8);
  assert.equal(hovered.look_y, -0.6);
  assert.equal(hovered.hover_avoidance, "soft");
  assert.ok(hovered.avoidance_x < 0);
  assert.ok(hovered.avoidance_y > 0);

  const dragging = normalizeDesktopPetPointerSnapshot({
    ...hovered,
    dragging: true
  });
  assert.equal(dragging.hover_avoidance, "none");
  assert.equal(dragging.avoidance_x, 0);
  assert.equal(dragging.avoidance_y, 0);
});

test("pet pointer helpers smooth Rust cursor samples without overriding local hover and drag", () => {
  assert.equal(desktopPetPointerSmoothingAlpha, 0.58);

  const previous = normalizeDesktopPetPointerSnapshot({
    cursor_near: true,
    look_x: 0,
    look_y: 0
  });
  const smoothed = desktopPetPointerSnapshotFromSample(
    {
      pointer: {
        cursor_near: true,
        look_x_percent: 100,
        look_y_percent: -50
      }
    },
    previous,
    {
      smoothing_alpha: 0.5,
      snap_threshold: 0
    }
  );

  assert.deepEqual(smoothed, {
    cursor_near: true,
    hovered: false,
    dragging: false,
    look_x: 0.5,
    look_y: -0.25,
    avoidance_x: 0,
    avoidance_y: 0,
    hover_avoidance: "none"
  });

  const localDrag = normalizeDesktopPetPointerSnapshot({
    cursor_near: true,
    hovered: true,
    dragging: true,
    look_x: -0.2,
    look_y: 0.1
  });
  const unchanged = desktopPetPointerSnapshotFromSample(
    {
      pointer: {
        cursor_near: true,
        look_x_percent: 95,
        look_y_percent: 95
      }
    },
    localDrag,
    {
      smoothing_alpha: 0.5
    }
  );

  assert.deepEqual(unchanged, localDrag);

  const cleared = desktopPetPointerSnapshotFromSample(
    {
      pointer: {
        inside_window: false,
        cursor_near: false,
        look_x_percent: 90,
        look_y_percent: 90
      }
    },
    normalizeDesktopPetPointerSnapshot({
      cursor_near: true,
      hovered: true,
      look_x: 0.4,
      look_y: -0.2
    }),
    {
      smoothing_alpha: 0.5
    }
  );
  assert.deepEqual(cleared, defaultDesktopPetPointerSnapshot());
});

test("pet surface renders clarification cards as option-first light cards", () => {
  const card = renderDesktopPetSurface({
    card: questionCard()
  });

  assert.match(card.html, /data-pet-card-kind="question"/u);
  assert.match(card.html, /data-pet-card-has-context="true"/u);
  assert.match(card.html, /class="wh-pet-kind">澄清/u);
  assert.match(card.html, /class="wh-pet-progress"/u);
  assert.match(card.html, /data-step-key="scope"/u);
  assert.match(card.html, /data-pet-option-id="minimal"/u);
  assert.match(card.html, /type="button" aria-pressed="false"/u);
  assert.match(card.html, /data-pet-option-first="true"/u);
  assert.match(card.html, /data-pet-input-mode="single_choice"/u);
  assert.match(card.html, /点选项即可，补充文字已折叠/u);
  assert.match(card.html, /data-pet-evidence-count="1"/u);
  assert.match(card.html, /data-cuu-action-id="submit_option"/u);
  assert.doesNotMatch(card.html, /textarea|<input\b/iu);
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
  assert.match(card.css, /data-pet-window-mode=card.*?\.wh-pet-body\{right:calc\(64px \* var\(--wh-pet-scale,1\)\);bottom:calc\(96px \* var\(--wh-pet-scale,1\)\);width:calc\(150px \* var\(--wh-pet-scale,1\)\);height:calc\(210px \* var\(--wh-pet-scale,1\)\)/u);
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
            return {
              placement: {
                mode: args?.mode,
                size: { width: 380, height: 560 }
              }
            };
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

test("pet window bridge rejects settings without a Rust confirmation plan", async () => {
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
    async () => bridge?.setSettings?.({ scale_percent: 125, opacity_percent: 80, pass_through: true, hide_on_hover: true }),
    /did not confirm settings/u
  );
});

test("pet window settings map from Cuu preferences", () => {
  assert.deepEqual(
    desktopPetWindowSettingsFromPreferences({
      pet_scale_percent: 150,
      pet_opacity_percent: 60,
      pet_pass_through: true,
      pet_hide_on_hover: true
    }),
    {
      scale_percent: 150,
      opacity_percent: 60,
      pass_through: true,
      hide_on_hover: true
    }
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
  await assert.rejects(
    async () => bridge?.setSettings?.({ scale_percent: 100, opacity_percent: 100, pass_through: false, hide_on_hover: false }),
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
              distanceToWindowPx: 24,
              lookXPercent: 58,
              lookYPercent: -12
            }
          };
        }
      }
    }
  });

  assert.deepEqual(await bridge?.sampleCursorNear?.(), {
    pointer: {
      insideWindow: false,
      cursorNear: true,
      distanceToWindowPx: 24,
      lookXPercent: 58,
      lookYPercent: -12
    }
  });
});
