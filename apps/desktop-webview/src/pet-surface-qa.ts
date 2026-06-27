import type { DesktopPetSurfaceRender } from "./pet-surface.js";

export type DesktopPetVisualQaCheckId =
  | "transparent_window"
  | "right_bottom_independent_surface"
  | "pet_body_hit_area"
  | "pointer_reactive_pose"
  | "image_hover_hide_handfeel"
  | "no_main_shell"
  | "live2d_cat_runtime_contract"
  | "card_mode_light_bubble"
  | "heavy_card_context"
  | "option_first_card";

export type DesktopPetVisualQaCheck = {
  id: DesktopPetVisualQaCheckId;
  label: string;
  passed: boolean;
  detail: string;
};

export type DesktopPetVisualQaReport = {
  passed: boolean;
  checks: DesktopPetVisualQaCheck[];
  failed_checks: DesktopPetVisualQaCheck[];
};

export function createDesktopPetVisualQaReport(input: {
  idle: DesktopPetSurfaceRender;
  card: DesktopPetSurfaceRender;
}): DesktopPetVisualQaReport {
  const checks = [
    qaCheck(
      "transparent_window",
      hasAll(input.idle.css, ["html,body,#root", "background:rgba(0,0,0,0)!important", ".wh-pet-surface", "box-shadow:none", "overflow:hidden"]),
      "pet surface root, body and surface must stay alpha-transparent for the Tauri pet window."
    ),
    qaCheck(
      "right_bottom_independent_surface",
      hasAll(input.idle.css, [
        ".wh-pet-surface",
        "position:relative",
        "width:var(--wh-pet-window-w,260px)",
        "height:var(--wh-pet-window-h,340px)",
        ".wh-pet-surface[data-pet-window-mode=card]",
        "width:var(--wh-pet-window-w,520px)",
        "height:var(--wh-pet-window-h,720px)",
        "right:calc(4px * var(--wh-pet-scale,1))",
        "bottom:calc(4px * var(--wh-pet-scale,1))",
        "pointer-events:none"
      ]) &&
        input.idle.html.includes('data-pet-scale-percent="100"') &&
        input.idle.html.includes('data-pet-window-width="260"') &&
        input.idle.html.includes('data-pet-window-height="340"'),
      "Cuu must be anchored in a full-body transparent Tauri pet window, not a small framed WebView card."
    ),
    qaCheck(
      "pet_body_hit_area",
      hasAll(input.idle.css, [".wh-pet-body", "cursor:grab", "pointer-events:auto"]) &&
        hasAll(input.idle.css, [".wh-cuu-cat-live2d", "pointer-events:none"]) &&
        input.idle.html.includes('data-pet-drag-handle="true"'),
      "only the pet body and bubble should receive pointer input; Cuu visual pixels stay visual-only."
    ),
    qaCheck(
      "pointer_reactive_pose",
      input.idle.html.includes('data-pet-look-x="0"') &&
        input.idle.html.includes('data-pet-hover-avoidance="none"') &&
        input.idle.html.includes('data-pet-pointer-smoothing-alpha="0.58"') &&
        input.idle.html.includes("--wh-pet-look-head-x-px:0px") &&
        input.idle.html.includes("--wh-pet-pointer-smoothing-alpha:0.58") &&
        input.idle.css.includes("--wh-pet-avoid-x-px") &&
        input.idle.css.includes(".wh-pet-surface[data-pet-cursor-near=true] .wh-cuu-cat-live2d") &&
        !input.idle.css.includes(".wh-pet-surface[data-pet-cursor-near=true] .wh-cuu-cat-live2d{transform:"),
      "Cuu must expose pointer look variables without translating or rotating the whole desktop pet body."
    ),
    qaCheck(
      "image_hover_hide_handfeel",
      input.idle.html.includes('data-pet-hide-on-hover="false"') &&
        input.idle.html.includes('data-pet-hover-hidden="false"') &&
        input.idle.html.includes('data-pet-hover-hide-mode="off"') &&
        input.idle.html.includes("--wh-pet-hide-opacity:1") &&
        input.idle.css.includes("data-pet-hover-hidden=true") &&
        input.idle.css.includes("--wh-pet-hide-x-px"),
      "image-based Cuu must expose a recoverable hover hide/dodge state instead of depending on a full invisible window."
    ),
    qaCheck(
      "no_main_shell",
      !/wh-app-shell|data-wh-surface="main"|textarea|<input\b/iu.test(`${input.idle.html}${input.card.html}`),
      "the pet window must not load the Gold Path shell or free-text-first controls."
    ),
    qaCheck(
      "live2d_cat_runtime_contract",
      input.idle.visual_mode === "live2d_cat" &&
        input.idle.live2d.runtime_kind === "live2d_cubism2_cat" &&
        input.idle.live2d.status === "approved_cat_option" &&
        input.idle.live2d.model_pack_id === "cuu-hijiki-live2d-cubism2" &&
        input.idle.html.includes('data-cuu-live2d-runtime="live2d_cubism2_cat"') &&
        input.idle.html.includes('data-cuu-live2d-status="approved_cat_option"') &&
        input.idle.html.includes('data-cuu-live2d-framing="transparent_full_body"') &&
        input.idle.html.includes('data-cuu-live2d-model="hijiki"') &&
        input.idle.html.includes('data-cuu-live2d-appearance="black_cat"') &&
        input.idle.html.includes('data-cuu-live2d-frame-url="./cuu/live2d/hijiki/cuu-hijiki.html"') &&
        input.idle.html.includes('data-cuu-model-pack="cuu-hijiki-live2d-cubism2"') &&
        input.idle.html.includes('data-cuu-model-pack-selection-reason="registry_default"') &&
        input.idle.html.includes('class="wh-cuu-cat-live2d-frame"') &&
        input.idle.css.includes(".wh-cuu-cat-live2d") &&
        !input.idle.html.includes('data-cuu-fallback-visual-mode=') &&
        !input.idle.html.includes('data-cuu-fallback-image-runtime=') &&
        !input.idle.html.includes('data-cuu-image-motion=') &&
        !input.idle.html.includes('class="wh-cuu-atlas') &&
        !input.idle.html.includes("wh-cuu-legacy-paw") &&
        !input.idle.html.includes("wh-cuu-legacy-eye") &&
        !input.idle.html.includes("wh-cuu-legacy-tail") &&
        !input.idle.html.includes('data-cuu-live2d-runtime="experimental_draft_probe"') &&
        input.idle.css.includes("@keyframes wh-cuu-cat-live2d-working") &&
        input.idle.css.includes("prefers-reduced-motion"),
      "idle Cuu must default to the user-approved Hijiki black cat Live2D model; only black/white Live2D cat options may be visible."
    ),
    qaCheck(
      "card_mode_light_bubble",
      hasAll(input.card.css, [
        ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-body{right:calc(72px * var(--wh-pet-scale,1))",
        ".wh-pet-surface[data-pet-window-mode=card] .wh-pet-bubble{left:calc(88px * var(--wh-pet-scale,1));right:auto",
        "bottom:calc(392px * var(--wh-pet-scale,1))",
        "width:calc(300px * var(--wh-pet-scale,1))",
        "max-width:calc(100% - calc(128px * var(--wh-pet-scale,1)))",
        ".wh-pet-surface[data-pet-window-mode=card][data-pet-card-has-context=true] .wh-pet-bubble{left:calc(72px * var(--wh-pet-scale,1));right:auto",
        "bottom:calc(372px * var(--wh-pet-scale,1))",
        "width:calc(328px * var(--wh-pet-scale,1))",
        "max-width:calc(100% - calc(104px * var(--wh-pet-scale,1)))",
        "min-height:0;max-height:calc(336px * var(--wh-pet-scale,1));overflow:hidden;overscroll-behavior:none;scrollbar-width:none",
        "gap:6px;padding:10px 12px",
        ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-title{-webkit-line-clamp:2",
        ".wh-pet-surface[data-pet-card-has-context=true] .wh-pet-section-line,.wh-pet-surface[data-pet-card-has-context=true] .wh-pet-evidence-item{-webkit-line-clamp:1"
      ]) &&
        input.card.html.includes('data-pet-window-mode="card"') &&
        input.card.html.includes('data-pet-bubble="true"'),
      "expanded mode must keep the option bubble inside the transparent-window safe area while staying near Cuu's body."
    ),
    qaCheck(
      "heavy_card_context",
      input.card.html.includes('data-pet-card-has-context="true"') &&
        input.card.html.includes('data-pet-context="true"') &&
        input.card.html.includes("wh-pet-kind") &&
        input.card.html.includes("wh-pet-section") &&
        input.card.html.includes("wh-pet-evidence") &&
        input.card.html.includes("data-pet-evidence-count="),
      "approval, proposal, evidence and budget cards must surface compact context inside the pet bubble instead of dropping PR-like details."
    ),
    qaCheck(
      "option_first_card",
      input.card.html.includes("data-cuu-action-id=") &&
        input.card.html.includes("data-pet-reason=") &&
        input.card.html.includes("wh-pet-actions") &&
        input.card.html.includes("wh-pet-reasons") &&
        !/textarea|<input\b/iu.test(input.card.html),
      "approval and clarification cards must provide clickable options before any free typing escape hatch."
    )
  ];
  const failedChecks = checks.filter((check) => !check.passed);

  return {
    passed: failedChecks.length === 0,
    checks,
    failed_checks: failedChecks
  };
}

export function assertDesktopPetVisualQaPass(report: DesktopPetVisualQaReport): void {
  if (report.passed) {
    return;
  }
  const details = report.failed_checks.map((check) => `${check.id}: ${check.detail}`).join("\n");
  throw new Error(`Desktop pet visual QA failed:\n${details}`);
}

function qaCheck(id: DesktopPetVisualQaCheckId, passed: boolean, detail: string): DesktopPetVisualQaCheck {
  return {
    id,
    label: labelFor(id),
    passed,
    detail
  };
}

function hasAll(value: string, needles: readonly string[]) {
  return needles.every((needle) => value.includes(needle));
}

function labelFor(id: DesktopPetVisualQaCheckId) {
  const labels: Record<DesktopPetVisualQaCheckId, string> = {
    transparent_window: "transparent pet window",
    right_bottom_independent_surface: "right-bottom independent surface",
    pet_body_hit_area: "pet body hit area",
    pointer_reactive_pose: "pointer-reactive pose",
    image_hover_hide_handfeel: "image hover-hide handfeel",
    no_main_shell: "no main shell",
    live2d_cat_runtime_contract: "Live2D cat runtime contract",
    card_mode_light_bubble: "card-mode light bubble",
    heavy_card_context: "heavy card context",
    option_first_card: "option-first card"
  };
  return labels[id];
}
