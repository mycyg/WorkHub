import type { CuuSpriteAtlasClipState } from "./atlas-manifest.js";

export type CuuLive2DModelStatus = "contract_only" | "prototype_layered" | "cubism_exported";

export type CuuLive2DLayerOrigin = "static_png_crop" | "generated_layer_png" | "psd_layer" | "cubism_artmesh";

export type CuuLive2DParameterId =
  | "ParamAngleX"
  | "ParamAngleY"
  | "ParamAngleZ"
  | "ParamBodyAngleX"
  | "ParamBodyAngleY"
  | "ParamEyeLOpen"
  | "ParamEyeROpen"
  | "ParamEyeBallX"
  | "ParamEyeBallY"
  | "ParamMouthOpenY"
  | "ParamMouthForm"
  | "ParamEarLWiggle"
  | "ParamEarRWiggle"
  | "ParamTailSway"
  | "ParamTailCurl"
  | "ParamBibSway"
  | "ParamBowBounce"
  | "ParamTasselSwingL"
  | "ParamTasselSwingR"
  | "ParamPawTap"
  | "ParamPawHoldDoc";

export type CuuLive2DLayerId =
  | "body_backfur"
  | "tail"
  | "front_paws"
  | "head"
  | "lace_bib"
  | "bow"
  | "tassel_l"
  | "tassel_r";

export type CuuLive2DBoneId =
  | "root"
  | "body"
  | "head"
  | "tail"
  | "front_paws"
  | "lace_bib"
  | "bow"
  | "tassel_l"
  | "tassel_r";

export type CuuLive2DMotionId =
  | "idle"
  | "blink"
  | "look"
  | "thinking"
  | "approval"
  | "review"
  | "worried"
  | "celebrate"
  | "drag"
  | "tap"
  | "offline";

export type CuuLive2DLayer = {
  id: CuuLive2DLayerId;
  origin: CuuLive2DLayerOrigin;
  source_layer: string;
  image_path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pivot_x: number;
  pivot_y: number;
  z_index: number;
  bone: CuuLive2DBoneId;
};

export type CuuLive2DBone = {
  id: CuuLive2DBoneId;
  parent?: CuuLive2DBoneId;
  x: number;
  y: number;
  parameter?: CuuLive2DParameterId;
};

export type CuuLive2DParameter = {
  id: CuuLive2DParameterId;
  min: number;
  max: number;
  default: number;
  description: string;
};

export type CuuLive2DMotion = {
  id: CuuLive2DMotionId;
  loop: boolean;
  priority: "idle" | "normal" | "urgent";
  fallback_sprite_clip: CuuSpriteAtlasClipState;
  parameters: Partial<Record<CuuLive2DParameterId, number>>;
};

export type CuuLive2DModelExport = {
  model3_json: string;
  moc3: string;
  textures: string[];
  physics3_json?: string;
  pose3_json?: string;
  expressions?: string[];
};

export type CuuLive2DManifest = {
  version: 1;
  character: "Cuu";
  artifact: string;
  status: CuuLive2DModelStatus;
  model?: CuuLive2DModelExport;
  source: {
    static_alpha: string;
    layer_manifest: string;
    psd_path: string;
  };
  stage: {
    width: number;
    height: number;
    anchor_x: number;
    anchor_y: number;
  };
  layers: CuuLive2DLayer[];
  bones: CuuLive2DBone[];
  parameters: CuuLive2DParameter[];
  motions: Record<CuuLive2DMotionId, CuuLive2DMotion>;
};

export type CuuLive2DManifestIssue = {
  code:
    | "missing_layer"
    | "duplicate_layer"
    | "missing_bone"
    | "duplicate_bone"
    | "missing_parameter"
    | "duplicate_parameter"
    | "layer_bone_missing"
    | "bone_parent_missing"
    | "bone_parameter_missing"
    | "motion_parameter_missing"
    | "missing_exported_model"
    | "invalid_stage";
  message: string;
};

export const requiredCuuLive2DLayerIds: CuuLive2DLayerId[] = [
  "body_backfur",
  "tail",
  "front_paws",
  "head",
  "lace_bib",
  "bow",
  "tassel_l",
  "tassel_r"
];

export const requiredCuuLive2DParameterIds: CuuLive2DParameterId[] = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamBodyAngleY",
  "ParamEyeLOpen",
  "ParamEyeROpen",
  "ParamEyeBallX",
  "ParamEyeBallY",
  "ParamTailSway",
  "ParamBibSway",
  "ParamBowBounce",
  "ParamTasselSwingL",
  "ParamTasselSwingR",
  "ParamPawTap"
];

export function validateCuuLive2DManifest(manifest: CuuLive2DManifest): CuuLive2DManifestIssue[] {
  const issues: CuuLive2DManifestIssue[] = [];
  if (manifest.stage.width <= 0 || manifest.stage.height <= 0 || manifest.stage.anchor_y <= 0) {
    issues.push({ code: "invalid_stage", message: "Cuu Live2D stage must have positive dimensions and anchor." });
  }

  const layerIds = new Set<CuuLive2DLayerId>();
  for (const layer of manifest.layers) {
    if (layerIds.has(layer.id)) {
      issues.push({ code: "duplicate_layer", message: `Duplicate Cuu Live2D layer ${layer.id}.` });
    }
    layerIds.add(layer.id);
  }
  for (const required of requiredCuuLive2DLayerIds) {
    if (!layerIds.has(required)) {
      issues.push({ code: "missing_layer", message: `Missing Cuu Live2D layer ${required}.` });
    }
  }

  const boneIds = new Set<CuuLive2DBoneId>();
  for (const bone of manifest.bones) {
    if (boneIds.has(bone.id)) {
      issues.push({ code: "duplicate_bone", message: `Duplicate Cuu Live2D bone ${bone.id}.` });
    }
    boneIds.add(bone.id);
  }
  if (!boneIds.has("root")) {
    issues.push({ code: "missing_bone", message: "Cuu Live2D rig must include a root bone." });
  }
  for (const bone of manifest.bones) {
    if (bone.parent && !boneIds.has(bone.parent)) {
      issues.push({ code: "bone_parent_missing", message: `Cuu Live2D bone ${bone.id} references missing parent ${bone.parent}.` });
    }
  }
  for (const layer of manifest.layers) {
    if (!boneIds.has(layer.bone)) {
      issues.push({ code: "layer_bone_missing", message: `Cuu Live2D layer ${layer.id} references missing bone ${layer.bone}.` });
    }
  }

  const parameterIds = new Set<CuuLive2DParameterId>();
  for (const parameter of manifest.parameters) {
    if (parameterIds.has(parameter.id)) {
      issues.push({ code: "duplicate_parameter", message: `Duplicate Cuu Live2D parameter ${parameter.id}.` });
    }
    parameterIds.add(parameter.id);
  }
  for (const required of requiredCuuLive2DParameterIds) {
    if (!parameterIds.has(required)) {
      issues.push({ code: "missing_parameter", message: `Missing Cuu Live2D parameter ${required}.` });
    }
  }
  for (const bone of manifest.bones) {
    if (bone.parameter && !parameterIds.has(bone.parameter)) {
      issues.push({ code: "bone_parameter_missing", message: `Cuu Live2D bone ${bone.id} references missing parameter ${bone.parameter}.` });
    }
  }
  for (const motion of Object.values(manifest.motions)) {
    for (const parameter of Object.keys(motion.parameters) as CuuLive2DParameterId[]) {
      if (!parameterIds.has(parameter)) {
        issues.push({ code: "motion_parameter_missing", message: `Cuu Live2D motion ${motion.id} references missing parameter ${parameter}.` });
      }
    }
  }

  if (manifest.status === "cubism_exported" && (!manifest.model?.model3_json || !manifest.model.moc3 || manifest.model.textures.length === 0)) {
    issues.push({ code: "missing_exported_model", message: "Cubism-exported Cuu model must include model3.json, moc3, and at least one texture." });
  }

  return issues;
}

export function cuuLive2DMotionForSpriteState(state: CuuSpriteAtlasClipState): CuuLive2DMotionId {
  const mapping: Partial<Record<CuuSpriteAtlasClipState, CuuLive2DMotionId>> = {
    idle_breathe: "idle",
    idle_blink: "blink",
    idle_tail_sway: "idle",
    look_at_mouse: "look",
    sleeping_curl: "offline",
    wake_up: "idle",
    thinking_tail: "thinking",
    searching_evidence_peek: "review",
    asking_approval_bounce: "approval",
    carrying_document_step: "review",
    syncing_files_spin: "thinking",
    worried_ears: "worried",
    revision_requested_nod: "thinking",
    celebrating_jump: "celebrate",
    offline_sleep: "offline",
    drag_hold: "drag",
    tap_bubble: "tap",
    wave_hello: "celebrate"
  };
  return mapping[state] ?? "idle";
}
