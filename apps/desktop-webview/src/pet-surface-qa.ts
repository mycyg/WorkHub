import type { DesktopPetSurfaceRender } from "./pet-surface.js";

export type DesktopPetVisualQaCheckId =
  | "transparent_window"
  | "right_bottom_independent_surface"
  | "pet_body_hit_area"
  | "pointer_reactive_pose"
  | "bongo_hover_hide_handfeel"
  | "no_main_shell"
  | "bongo_runtime_contract"
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
      hasAll(input.idle.css, ["html,body,#root", "background:transparent", ".wh-pet-surface", "overflow:hidden"]),
      "pet surface root and body must stay transparent for the Tauri pet window."
    ),
    qaCheck(
      "right_bottom_independent_surface",
      hasAll(input.idle.css, [
        ".wh-pet-surface",
        "position:relative",
        "width:var(--wh-pet-window-w,180px)",
        "height:var(--wh-pet-window-h,220px)",
        ".wh-pet-surface[data-pet-window-mode=card]",
        "width:var(--wh-pet-window-w,380px)",
        "height:var(--wh-pet-window-h,560px)",
        "right:calc(8px * var(--wh-pet-scale,1))",
        "bottom:calc(8px * var(--wh-pet-scale,1))",
        "pointer-events:none"
      ]) &&
        input.idle.html.includes('data-pet-scale-percent="100"') &&
        input.idle.html.includes('data-pet-window-width="180"') &&
        input.idle.html.includes('data-pet-window-height="220"'),
      "Cuu must be anchored inside the local Tauri pet window canvas without depending on the WebView viewport."
    ),
    qaCheck(
      "pet_body_hit_area",
      hasAll(input.idle.css, [".wh-pet-body", "cursor:grab", "pointer-events:auto"]) &&
        (hasAll(input.idle.css, [".wh-cuu-live2d", "pointer-events:none"]) ||
          hasAll(input.idle.css, [".wh-cuu-bongo", "pointer-events:none"]) ||
          hasAll(input.idle.css, [".wh-cuu-psd", "pointer-events:none"]) ||
          hasAll(input.idle.css, [".wh-cuu-atlas", "pointer-events:none"])) &&
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
        input.idle.bongo.css.includes("--wh-pet-look-head-x-px") &&
        input.idle.bongo.css.includes("--wh-pet-look-eye-x-px") &&
        input.idle.bongo.css.includes("data-pet-hover-avoidance=soft"),
      "Bongo-style Cuu must expose continuous pointer look variables, smoothing alpha and a hover avoidance pose for screenshot QA."
    ),
    qaCheck(
      "bongo_hover_hide_handfeel",
      input.idle.html.includes('data-pet-hide-on-hover="false"') &&
        input.idle.html.includes('data-pet-hover-hidden="false"') &&
        input.idle.html.includes('data-pet-hover-hide-mode="off"') &&
        input.idle.html.includes("--wh-pet-hide-opacity:1") &&
        input.idle.css.includes("data-pet-hover-hidden=true") &&
        input.idle.css.includes("--wh-pet-hide-x-px"),
      "Bongo-style Cuu must expose a recoverable hover hide/dodge state instead of depending on PSD realism or a full invisible window."
    ),
    qaCheck(
      "no_main_shell",
      !/wh-app-shell|data-wh-surface="main"|textarea|<input\b/iu.test(`${input.idle.html}${input.card.html}`),
      "the pet window must not load the Gold Path shell or free-text-first controls."
    ),
    qaCheck(
      "bongo_runtime_contract",
      input.idle.visual_mode === "bongo_cuu" &&
        input.idle.bongo.runtime_kind === "bongo_cuu" &&
        input.idle.bongo.status === "p1_default_low_uncanny" &&
        input.idle.bongo.component_count >= 20 &&
        input.idle.bongo.duration_ms >= 700 &&
        input.idle.html.includes('data-cuu-bongo-runtime="bongo_cuu"') &&
        input.idle.html.includes('data-cuu-bongo-status="p1_default_low_uncanny"') &&
        input.idle.html.includes('data-cuu-bongo-component-count="31"') &&
        input.idle.html.includes("wh-cuu-bongo-paw") &&
        input.idle.html.includes("wh-cuu-bongo-eye") &&
        input.idle.html.includes("wh-cuu-bongo-tail") &&
        input.idle.html.includes("wh-cuu-bongo-search-glass") &&
        input.idle.html.includes("wh-cuu-bongo-sync-ring") &&
        input.idle.html.includes("wh-cuu-bongo-spark") &&
        !input.idle.html.includes('data-cuu-live2d-runtime="psd_draft_probe"') &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-tail") &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-paw-hit-l") &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-eye-open") &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-wave") &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-search-peek") &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-sync-ring") &&
        input.idle.bongo.css.includes("@keyframes wh-cuu-bongo-revision-nod") &&
        input.idle.bongo.css.includes("prefers-reduced-motion") &&
        input.idle.sprite.fallback === false,
      "idle Cuu must default to a low-uncanny Bongo-style renderer; PSD draft probes stay hidden until Cubism-quality art passes visual QA."
    ),
    qaCheck(
      "card_mode_light_bubble",
      hasAll(input.card.css, [".wh-pet-bubble", "right:132px", "bottom:28px", "width:min(250px,calc(100vw - 148px))"]) &&
        input.card.html.includes('data-pet-window-mode="card"') &&
        input.card.html.includes('data-pet-bubble="true"') &&
        input.card.sprite.fallback === false,
      "expanded mode must remain a small option bubble beside Cuu, not a full application panel."
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
    bongo_hover_hide_handfeel: "Bongo hover-hide handfeel",
    no_main_shell: "no main shell",
    bongo_runtime_contract: "Bongo-style runtime contract",
    card_mode_light_bubble: "card-mode light bubble",
    heavy_card_context: "heavy card context",
    option_first_card: "option-first card"
  };
  return labels[id];
}
