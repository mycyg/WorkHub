import type { DesktopPetSurfaceRender } from "./pet-surface.js";

export type DesktopPetVisualQaCheckId =
  | "transparent_window"
  | "right_bottom_independent_surface"
  | "pet_body_hit_area"
  | "no_main_shell"
  | "alive_atlas_motion"
  | "card_mode_light_bubble"
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
        "width:180px",
        "height:220px",
        ".wh-pet-surface[data-pet-window-mode=card]",
        "width:380px",
        "height:560px",
        "right:8px",
        "bottom:8px",
        "pointer-events:none"
      ]),
      "Cuu must be anchored inside the local Tauri pet window canvas without depending on the WebView viewport."
    ),
    qaCheck(
      "pet_body_hit_area",
      hasAll(input.idle.css, [".wh-pet-body", "cursor:grab", "pointer-events:auto"]) &&
        hasAll(input.idle.css, [".wh-cuu-atlas", "pointer-events:none"]) &&
        input.idle.html.includes('data-pet-drag-handle="true"'),
      "only the pet body and bubble should receive pointer input; the atlas pixels stay visual-only."
    ),
    qaCheck(
      "no_main_shell",
      !/wh-app-shell|data-wh-surface="main"|textarea|<input\b/iu.test(`${input.idle.html}${input.card.html}`),
      "the pet window must not load the Gold Path shell or free-text-first controls."
    ),
    qaCheck(
      "alive_atlas_motion",
      input.idle.sprite.fallback === false &&
        input.idle.sprite.frame_count >= 4 &&
        input.idle.sprite.duration_ms >= 400 &&
        input.idle.html.includes("data-cuu-atlas-state=") &&
        input.idle.html.includes('data-cuu-image-mode="clip_sheet"') &&
        input.idle.html.includes("cuu.sprite.json"),
      "idle Cuu must render a real multi-frame clip sheet instead of a fallback icon or oversized atlas."
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
    no_main_shell: "no main shell",
    alive_atlas_motion: "alive atlas motion",
    card_mode_light_bubble: "card-mode light bubble",
    option_first_card: "option-first card"
  };
  return labels[id];
}
