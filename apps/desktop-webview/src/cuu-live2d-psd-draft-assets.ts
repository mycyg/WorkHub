import type { CuuLive2DPsdDraftLayer } from "@workhub/cuu";

export type DesktopCuuLive2DPsdDraftLayer = CuuLive2DPsdDraftLayer;

export const desktopCuuLive2DPsdDraftManifestUrl = new URL(
  "./assets/cuu/live2d/source/generated-psd-draft-v1/cuu-live2d-generated-psd-draft-v1.manifest.json",
  import.meta.url
).href;

export const desktopCuuLive2DPsdDraftPreviewUrl = new URL(
  "./assets/cuu/live2d/source/generated-psd-draft-v1/cuu-live2d-generated-psd-draft-v1-preview.png",
  import.meta.url
).href;

export const desktopCuuLive2DPsdDraftReportUrl = new URL(
  "./assets/cuu/live2d/source/generated-psd-draft-v1/cuu-live2d-generated-psd-draft-v1-report.json",
  import.meta.url
).href;

export const desktopCuuLive2DPsdDraftSummary = {
  artifact: "cuu-live2d-generated-psd-draft-v1",
  status: "draft_created_not_visual_pass",
  runtime_kind: "psd_draft_probe",
  canvas: {
    width: 1200,
    height: 1600,
    anchor_x: 600,
    anchor_y: 1216
  },
  layer_count: 144,
  default_visible_layer_count: 65,
  runtime_probe_layer_count: 72
} as const;

export const desktopCuuLive2DPsdDraftLayers: DesktopCuuLive2DPsdDraftLayer[] = [
  layer("Shadow_SoftUnderBody", "10_Back", 360, 1132, 450, 96, 90, 10),
  layer("Tail_Base", "30_Tail", 710, 705, 168, 210, 255, 21, "Tail_Base"),
  layer("Tail_01", "30_Tail", 780, 744, 230, 211, 255, 22, "Tail_01"),
  layer("Tail_02", "30_Tail", 850, 790, 224, 204, 255, 23, "Tail_02"),
  layer("Tail_03", "30_Tail", 915, 842, 190, 167, 255, 24, "Tail_03"),
  layer("Tail_Tip", "30_Tail", 960, 878, 174, 136, 255, 25, "Tail_Tip"),
  layer("Body_BackFur", "20_Body", 382, 545, 428, 570, 255, 40, "Body"),
  layer("Body_ChestCream", "20_Body", 440, 634, 335, 526, 255, 41, "Body"),
  layer("Paw_L_FrontUpper", "20_Body", 424, 872, 105, 308, 255, 50, "Paw_L_Front"),
  layer("Paw_R_FrontUpper", "20_Body", 542, 872, 108, 306, 255, 52, "Paw_R_Front"),
  layer("Paw_L_Back", "20_Body", 376, 1058, 82, 61, 255, 54, "Paw_L_Back"),
  layer("Paw_R_Back", "20_Body", 650, 1062, 82, 59, 255, 55, "Paw_R_Back"),
  layer("Head_BaseClean", "40_Head", 250, 86, 580, 495, 255, 80, "Head"),
  layer("Ear_L_Outer", "40_Head", 254, 96, 162, 241, 255, 82, "Ear_L"),
  layer("Ear_R_Outer", "40_Head", 662, 98, 160, 241, 255, 83, "Ear_R"),
  layer("Ear_L_Inner", "40_Head", 290, 132, 106, 190, 255, 84, "Ear_L"),
  layer("Ear_R_Inner", "40_Head", 682, 134, 108, 193, 255, 85, "Ear_R"),
  layer("Ear_L_Inner_Fur_01", "40_Head", 316, 184, 80, 100, 255, 86, "Ear_L"),
  layer("Ear_R_Inner_Fur_01", "40_Head", 698, 184, 80, 100, 255, 88, "Ear_R"),
  layer("FurTuft_Front_01", "40_Head", 420, 120, 86, 38, 255, 89, "Head"),
  layer("FurTuft_Front_02", "40_Head", 540, 118, 86, 38, 255, 90, "Head"),
  layer("Muzzle_Cream", "50_Face", 430, 396, 255, 129, 255, 100, "Muzzle"),
  layer("Eye_L_White", "50_Face", 400, 282, 94, 99, 255, 101, "Eye_L"),
  layer("Eye_R_White", "50_Face", 588, 282, 94, 99, 255, 102, "Eye_R"),
  layer("Eye_L_Iris", "50_Face", 410, 292, 78, 83, 255, 103, "Eye_L"),
  layer("Eye_R_Iris", "50_Face", 598, 292, 79, 83, 255, 104, "Eye_R"),
  layer("Eye_L_Pupil", "50_Face", 424, 306, 54, 58, 255, 105, "Eye_L"),
  layer("Eye_R_Pupil", "50_Face", 612, 306, 58, 59, 255, 106, "Eye_R"),
  layer("Eye_L_Highlight_01", "50_Face", 430, 300, 30, 28, 255, 107, "Eye_L"),
  layer("Eye_R_Highlight_01", "50_Face", 618, 300, 30, 28, 255, 108, "Eye_R"),
  layer("Eye_L_UpperLid", "50_Face", 392, 270, 104, 29, 255, 109, "Eye_L"),
  layer("Eye_R_UpperLid", "50_Face", 582, 270, 102, 30, 255, 110, "Eye_R"),
  layer("Eye_L_LowerLid", "50_Face", 392, 366, 102, 36, 165, 111, "Eye_L"),
  layer("Eye_R_LowerLid", "50_Face", 582, 366, 100, 36, 165, 112, "Eye_R"),
  layer("Nose_Base", "50_Face", 534, 398, 78, 50, 255, 113, "Nose"),
  layer("Mouth_Line_Closed", "50_Face", 524, 464, 84, 17, 255, 114, "Mouth"),
  layer("Whisker_L_01", "50_Face", 294, 424, 190, 70, 255, 117, "Whisker_L"),
  layer("Whisker_R_01", "50_Face", 598, 424, 190, 70, 255, 118, "Whisker_R"),
  layer("Cheek_Blush_L", "50_Face", 358, 394, 112, 62, 255, 119, "Cheek_L"),
  layer("Cheek_Blush_R", "50_Face", 626, 394, 114, 62, 255, 120, "Cheek_R"),
  layer("Eye_L_Closed", "80_Expressions", 400, 318, 82, 35, 0, 130, "Eye_L"),
  layer("Eye_R_Closed", "80_Expressions", 594, 318, 82, 35, 0, 131, "Eye_R"),
  layer("Eye_L_WorriedLine", "80_Expressions", 392, 260, 80, 42, 0, 132, "Eye_L"),
  layer("Eye_R_WorriedLine", "80_Expressions", 604, 260, 78, 42, 0, 133, "Eye_R"),
  layer("Mouth_OpenSmall", "80_Expressions", 540, 458, 44, 53, 0, 134, "Mouth"),
  layer("Mouth_Surprised", "80_Expressions", 532, 450, 58, 68, 0, 135, "Mouth"),
  layer("Mouth_Smile", "80_Expressions", 518, 456, 84, 43, 0, 136, "Mouth"),
  layer("LaceBib_Back", "60_Collar", 314, 492, 520, 224, 255, 150, "LaceBib"),
  layer("LaceBib_Front", "60_Collar", 300, 520, 548, 233, 255, 151, "LaceBib"),
  layer("Bow_L_Wing", "70_Accessories", 350, 514, 152, 239, 255, 180, "Bow_L"),
  layer("Bow_R_Wing", "70_Accessories", 484, 514, 154, 238, 255, 181, "Bow_R"),
  layer("Bow_Center", "70_Accessories", 480, 566, 92, 64, 255, 182, "Bow_Center"),
  layer("Tassel_L_String_01", "70_Accessories", 332, 626, 12, 312, 255, 192, "Tassel_L_01"),
  layer("Tassel_L_String_02", "70_Accessories", 350, 640, 12, 279, 255, 193, "Tassel_L_02"),
  layer("Tassel_L_String_03", "70_Accessories", 372, 704, 12, 250, 255, 194, "Tassel_L_03"),
  layer("Tassel_R_String_01", "70_Accessories", 682, 626, 12, 310, 255, 196, "Tassel_R_01"),
  layer("Tassel_R_String_02", "70_Accessories", 704, 646, 12, 286, 255, 197, "Tassel_R_02"),
  layer("Tassel_R_String_03", "70_Accessories", 724, 710, 12, 246, 255, 198, "Tassel_R_03"),
  layer("Pearl_L_01", "70_Accessories", 326, 850, 48, 49, 255, 210, "Pearl_L"),
  layer("Pearl_L_02", "70_Accessories", 360, 866, 44, 44, 255, 211, "Pearl_L"),
  layer("Pearl_L_03", "70_Accessories", 342, 900, 40, 40, 255, 212, "Pearl_L"),
  layer("RedBead_L_01", "70_Accessories", 314, 820, 32, 32, 255, 213, "RedBead_L"),
  layer("RedBead_L_02", "70_Accessories", 386, 828, 28, 28, 255, 214, "RedBead_L"),
  layer("GoldRing_L_01", "70_Accessories", 328, 806, 34, 34, 255, 215, "GoldRing_L"),
  layer("GoldBead_L_01", "70_Accessories", 344, 940, 26, 38, 255, 216, "GoldBead_L"),
  layer("Pearl_R_01", "70_Accessories", 684, 850, 48, 49, 255, 217, "Pearl_R"),
  layer("Pearl_R_02", "70_Accessories", 718, 866, 44, 44, 255, 218, "Pearl_R"),
  layer("Pearl_R_03", "70_Accessories", 700, 900, 40, 40, 255, 219, "Pearl_R"),
  layer("RedBead_R_01", "70_Accessories", 674, 820, 32, 32, 255, 220, "RedBead_R"),
  layer("RedBead_R_02", "70_Accessories", 746, 828, 28, 28, 255, 221, "RedBead_R"),
  layer("GoldRing_R_01", "70_Accessories", 686, 806, 34, 34, 255, 222, "GoldRing_R"),
  layer("GoldBead_R_01", "70_Accessories", 704, 940, 26, 37, 255, 223, "GoldBead_R")
];

function layer(
  name: string,
  group: string,
  x: number,
  y: number,
  width: number,
  height: number,
  opacity: number,
  z_index: number,
  bind_target?: string
): DesktopCuuLive2DPsdDraftLayer {
  return {
    name,
    group,
    image_path: new URL(`./assets/cuu/live2d/source/generated-psd-draft-v1/layers/${name}.png`, import.meta.url).href,
    x,
    y,
    width,
    height,
    opacity,
    z_index,
    ...(bind_target ? { bind_target } : {}),
    default_visible: opacity > 0
  };
}
