export type CuuLive2DPsdDraftLayer = {
  name: string;
  group: string;
  image_path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  z_index: number;
  default_visible: boolean;
  bind_target?: string;
};

export type CuuLive2DPsdDraftIssue = {
  code:
    | "missing_psd_layer"
    | "duplicate_psd_layer"
    | "invalid_psd_layer_geometry"
    | "invalid_psd_layer_opacity"
    | "missing_default_visible_layer";
  message: string;
};

export const requiredCuuLive2DPsdProbeLayerNames = [
  "Body_BackFur",
  "Body_ChestCream",
  "Head_BaseClean",
  "Ear_L_Outer",
  "Ear_R_Outer",
  "Ear_L_Inner",
  "Ear_R_Inner",
  "Eye_L_White",
  "Eye_R_White",
  "Eye_L_Iris",
  "Eye_R_Iris",
  "Eye_L_Pupil",
  "Eye_R_Pupil",
  "Eye_L_Closed",
  "Eye_R_Closed",
  "Mouth_Line_Closed",
  "Mouth_OpenSmall",
  "Tail_Base",
  "Tail_01",
  "Tail_02",
  "Tail_03",
  "Tail_Tip",
  "LaceBib_Front",
  "Bow_L_Wing",
  "Bow_R_Wing",
  "Bow_Center",
  "Tassel_L_String_01",
  "Tassel_L_String_02",
  "Tassel_L_String_03",
  "Tassel_R_String_01",
  "Tassel_R_String_02",
  "Tassel_R_String_03",
  "Pearl_L_01",
  "Pearl_R_01",
  "RedBead_L_01",
  "RedBead_R_01"
] as const;

export const cuuLive2DPsdProbeExpressionLayerNames = [
  "Eye_L_Closed",
  "Eye_R_Closed",
  "Mouth_OpenSmall",
  "Mouth_Smile",
  "Mouth_Surprised",
  "Eye_L_WorriedLine",
  "Eye_R_WorriedLine"
] as const;

export function validateCuuLive2DPsdDraftLayers(layers: CuuLive2DPsdDraftLayer[]): CuuLive2DPsdDraftIssue[] {
  const issues: CuuLive2DPsdDraftIssue[] = [];
  const byName = new Map<string, CuuLive2DPsdDraftLayer>();
  for (const layer of layers) {
    if (byName.has(layer.name)) {
      issues.push({ code: "duplicate_psd_layer", message: `Duplicate Cuu PSD draft layer ${layer.name}.` });
    }
    byName.set(layer.name, layer);
    if (layer.width <= 0 || layer.height <= 0 || layer.x < 0 || layer.y < 0) {
      issues.push({ code: "invalid_psd_layer_geometry", message: `Invalid Cuu PSD draft geometry for ${layer.name}.` });
    }
    if (layer.opacity < 0 || layer.opacity > 255) {
      issues.push({ code: "invalid_psd_layer_opacity", message: `Invalid Cuu PSD draft opacity for ${layer.name}.` });
    }
    if (layer.default_visible !== layer.opacity > 0) {
      issues.push({ code: "missing_default_visible_layer", message: `Cuu PSD draft layer ${layer.name} has inconsistent visibility metadata.` });
    }
  }

  for (const required of requiredCuuLive2DPsdProbeLayerNames) {
    if (!byName.has(required)) {
      issues.push({ code: "missing_psd_layer", message: `Missing Cuu PSD draft runtime probe layer ${required}.` });
    }
  }

  return issues;
}
