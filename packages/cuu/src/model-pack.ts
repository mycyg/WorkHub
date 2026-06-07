import { allCuuMotionHints } from "./motion.js";
import { cuuIdleMicroActionSpecs, type CuuIdleMicroAction } from "./idle-scheduler.js";
import type { CuuSpriteAtlasClipState } from "./atlas-manifest.js";

export type CuuModelPackRuntimeKind = "bongo_cuu" | "sprite_atlas" | "live2d_cubism";

export type CuuModelPackDefaultStatus = "approved_default" | "experimental" | "blocked";

export type CuuModelPackAssetKind = "procedural_dom" | "sprite_atlas" | "hatch_spritesheet" | "live2d_cubism" | "psd_draft";

export type CuuModelPackSupportLevel = "supported" | "planned" | "unsupported";

export type CuuModelPackWindowAffordance =
  | "transparent_window"
  | "always_on_top"
  | "draggable"
  | "pass_through"
  | "scale"
  | "opacity"
  | "hide_on_hover"
  | "keep_in_screen";

export type CuuModelPackComponent =
  | "body"
  | "head"
  | "ears"
  | "eyes"
  | "tail"
  | "paws"
  | "bib"
  | "bow"
  | "beads"
  | "desk"
  | "document"
  | "search_glass"
  | "sync_ring"
  | "sparks";

export type CuuModelPackVisualGate = {
  low_uncanny: boolean;
  no_psd_default: boolean;
  full_body_visible: boolean;
  stable_identity: boolean;
  no_ai_artifact: boolean;
  alive_motion: boolean;
};

export type CuuModelPackAsset = {
  kind: CuuModelPackAssetKind;
  path?: string;
  note: string;
  default_candidate: boolean;
};

export type CuuModelPackMotionBinding = {
  state: CuuSpriteAtlasClipState;
  renderer_state: string;
  loop: boolean;
  min_visible_components: CuuModelPackComponent[];
};

export type CuuModelPackManifest = {
  version: 1;
  character: "Cuu";
  pack_id: string;
  display_name: string;
  runtime_kind: CuuModelPackRuntimeKind;
  default_policy: {
    allow_as_default: boolean;
    status: CuuModelPackDefaultStatus;
    reason: string;
  };
  visual_gate: CuuModelPackVisualGate;
  source: {
    inspiration: string;
    reference_url?: string;
    assets: CuuModelPackAsset[];
  };
  components: CuuModelPackComponent[];
  motions: Partial<Record<CuuSpriteAtlasClipState, CuuModelPackMotionBinding>>;
  window_affordances: Partial<Record<CuuModelPackWindowAffordance, CuuModelPackSupportLevel>>;
};

export type CuuModelPackValidationOptions = {
  require_default_ready?: boolean;
  require_full_motion_coverage?: boolean;
  require_idle_micro_action_coverage?: boolean;
};

export type CuuModelPackIssue = {
  code:
    | "invalid_version"
    | "invalid_character"
    | "missing_pack_id"
    | "default_blocked"
    | "default_not_approved"
    | "visual_gate_failed"
    | "psd_default_asset"
    | "missing_component"
    | "missing_motion"
    | "missing_window_affordance";
  path: string;
  message: string;
};

export const requiredCuuDefaultModelComponents: CuuModelPackComponent[] = [
  "body",
  "head",
  "eyes",
  "tail",
  "paws"
];

export const requiredCuuDefaultWindowAffordances: CuuModelPackWindowAffordance[] = [
  "transparent_window",
  "always_on_top",
  "draggable",
  "keep_in_screen"
];

export const cuuDefaultModelPackVisualGate: CuuModelPackVisualGate = {
  low_uncanny: true,
  no_psd_default: true,
  full_body_visible: true,
  stable_identity: true,
  no_ai_artifact: true,
  alive_motion: true
};

export const defaultCuuBongoModelPack: CuuModelPackManifest = {
  version: 1,
  character: "Cuu",
  pack_id: "cuu-bongo-p1",
  display_name: "Cuu Bongo P1 low-uncanny runtime",
  runtime_kind: "bongo_cuu",
  default_policy: {
    allow_as_default: true,
    status: "approved_default",
    reason: "Low-uncanny procedural model is the default until Live2D Cubism passes visual QA."
  },
  visual_gate: cuuDefaultModelPackVisualGate,
  source: {
    inspiration: "BongoCat-style input-reactive desktop pet architecture; no copied model assets.",
    reference_url: "https://github.com/ayangweb/BongoCat",
    assets: [
      {
        kind: "procedural_dom",
        note: "DOM/CSS Cuu components with BongoCat-like low-uncanny motion readability.",
        default_candidate: true
      }
    ]
  },
  components: [
    "body",
    "head",
    "ears",
    "eyes",
    "tail",
    "paws",
    "bib",
    "bow",
    "beads",
    "desk",
    "document",
    "search_glass",
    "sync_ring",
    "sparks"
  ],
  motions: createBongoMotionBindings(),
  window_affordances: {
    transparent_window: "supported",
    always_on_top: "supported",
    draggable: "supported",
    pass_through: "supported",
    scale: "supported",
    opacity: "supported",
    hide_on_hover: "planned",
    keep_in_screen: "supported"
  }
};

export function validateCuuModelPackManifest(
  manifest: CuuModelPackManifest,
  options: CuuModelPackValidationOptions = {}
): CuuModelPackIssue[] {
  const issues: CuuModelPackIssue[] = [];
  if (manifest.version !== 1) {
    issues.push({ code: "invalid_version", path: "version", message: "Cuu model pack manifest version must be 1." });
  }
  if (manifest.character !== "Cuu") {
    issues.push({ code: "invalid_character", path: "character", message: "Cuu model pack must describe Cuu." });
  }
  if (!manifest.pack_id.trim()) {
    issues.push({ code: "missing_pack_id", path: "pack_id", message: "Cuu model pack needs a stable pack id." });
  }

  const defaultReady = options.require_default_ready || manifest.default_policy.allow_as_default;
  if (defaultReady) {
    validateDefaultReady(issues, manifest);
  }

  if (options.require_full_motion_coverage || defaultReady) {
    for (const state of requiredBusinessMotionStates()) {
      if (!manifest.motions[state]) {
        issues.push({
          code: "missing_motion",
          path: `motions.${state}`,
          message: `Default Cuu model pack must cover business motion ${state}.`
        });
      }
    }
  }

  if (options.require_idle_micro_action_coverage || defaultReady) {
    for (const state of Object.keys(cuuIdleMicroActionSpecs) as CuuIdleMicroAction[]) {
      if (!manifest.motions[state]) {
        issues.push({
          code: "missing_motion",
          path: `motions.${state}`,
          message: `Default Cuu model pack must cover idle micro action ${state}.`
        });
      }
    }
  }

  return issues;
}

export function assertCuuModelPackCanBeDefault(manifest: CuuModelPackManifest): void {
  const issues = validateCuuModelPackManifest(manifest, {
    require_default_ready: true,
    require_full_motion_coverage: true,
    require_idle_micro_action_coverage: true
  });
  if (issues.length) {
    throw new Error(`Cuu model pack cannot be default: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`);
  }
}

export function requiredCuuModelPackMotionStates(): CuuSpriteAtlasClipState[] {
  return [...new Set([...requiredBusinessMotionStates(), ...(Object.keys(cuuIdleMicroActionSpecs) as CuuIdleMicroAction[])])];
}

function validateDefaultReady(issues: CuuModelPackIssue[], manifest: CuuModelPackManifest) {
  if (!manifest.default_policy.allow_as_default || manifest.default_policy.status === "blocked") {
    issues.push({
      code: "default_blocked",
      path: "default_policy",
      message: "Blocked or non-default Cuu model packs cannot be used as the visible default."
    });
  }
  if (manifest.default_policy.status !== "approved_default") {
    issues.push({
      code: "default_not_approved",
      path: "default_policy.status",
      message: "Default Cuu model packs must be explicitly approved."
    });
  }
  for (const [key, passed] of Object.entries(manifest.visual_gate) as [keyof CuuModelPackVisualGate, boolean][]) {
    if (!passed) {
      issues.push({
        code: "visual_gate_failed",
        path: `visual_gate.${key}`,
        message: `Cuu default visual gate ${key} did not pass.`
      });
    }
  }
  if (manifest.source.assets.some((asset) => asset.kind === "psd_draft" && asset.default_candidate)) {
    issues.push({
      code: "psd_default_asset",
      path: "source.assets",
      message: "PSD draft assets may not be marked as Cuu default candidates."
    });
  }
  for (const component of requiredCuuDefaultModelComponents) {
    if (!manifest.components.includes(component)) {
      issues.push({
        code: "missing_component",
        path: `components.${component}`,
        message: `Default Cuu model pack must include ${component}.`
      });
    }
  }
  for (const affordance of requiredCuuDefaultWindowAffordances) {
    if (manifest.window_affordances[affordance] !== "supported") {
      issues.push({
        code: "missing_window_affordance",
        path: `window_affordances.${affordance}`,
        message: `Default Cuu model pack requires supported window affordance ${affordance}.`
      });
    }
  }
}

function requiredBusinessMotionStates(): CuuSpriteAtlasClipState[] {
  return [...new Set(allCuuMotionHints().map((hint) => hint.sprite_state))];
}

function createBongoMotionBindings(): Partial<Record<CuuSpriteAtlasClipState, CuuModelPackMotionBinding>> {
  const motions: Partial<Record<CuuSpriteAtlasClipState, CuuModelPackMotionBinding>> = {};
  for (const state of requiredCuuModelPackMotionStates()) {
    motions[state] = {
      state,
      renderer_state: state,
      loop: state !== "idle_blink" && state !== "tap_bubble" && state !== "wave_hello" && state !== "celebrating_jump",
      min_visible_components: visibleComponentsForState(state)
    };
  }
  return motions;
}

function visibleComponentsForState(state: CuuSpriteAtlasClipState): CuuModelPackComponent[] {
  const base: CuuModelPackComponent[] = ["body", "head", "eyes", "tail", "paws"];
  if (state === "searching_evidence_peek") {
    return [...base, "search_glass"];
  }
  if (state === "syncing_files_spin") {
    return [...base, "sync_ring"];
  }
  if (state === "carrying_document_step" || state === "asking_approval_bounce" || state === "revision_requested_nod") {
    return [...base, "document"];
  }
  if (state === "celebrating_jump") {
    return [...base, "sparks"];
  }
  return base;
}
