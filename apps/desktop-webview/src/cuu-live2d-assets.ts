import {
  validateCuuLive2DManifest,
  type CuuLive2DLayerId,
  type CuuLive2DManifest,
  type CuuLive2DManifestIssue
} from "@workhub/cuu";

const bodyBackfur = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/body-backfur.png", import.meta.url).href;
const bow = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/bow.png", import.meta.url).href;
const frontPaws = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/front-paws.png", import.meta.url).href;
const head = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/head.png", import.meta.url).href;
const laceBib = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/lace-bib.png", import.meta.url).href;
const tail = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/tail.png", import.meta.url).href;
const tasselL = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/tassel-l.png", import.meta.url).href;
const tasselR = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/tassel-r.png", import.meta.url).href;

export const desktopCuuLive2DPrototypeManifestUrl = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/cuu-layered-rig-v0.manifest.json", import.meta.url).href;
export const desktopCuuLive2DPrototypePreviewUrl = new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/cuu-layered-rig-v0-preview.png", import.meta.url).href;

export type DesktopCuuLive2DLayerImage = {
  image_path: string;
  width: number;
  height: number;
};

export const desktopCuuLive2DPrototypeLayerImages = {
  tail: layerImage(tail, 46, 104),
  body_backfur: layerImage(bodyBackfur, 188, 222),
  front_paws: layerImage(frontPaws, 110, 92),
  head: layerImage(head, 144, 140),
  lace_bib: layerImage(laceBib, 166, 142),
  bow: layerImage(bow, 88, 76),
  tassel_l: layerImage(tasselL, 28, 142),
  tassel_r: layerImage(tasselR, 50, 150)
} satisfies Record<CuuLive2DLayerId, DesktopCuuLive2DLayerImage>;

export const desktopCuuLive2DPrototypeManifest = {
  version: 1,
  character: "Cuu",
  artifact: "cuu-layered-rig-v0",
  status: "prototype_layered",
  source: {
    static_alpha: "apps/desktop-webview/src/assets/cuu/static/cuu-static-fallback-v1-alpha-clean.png",
    layer_manifest: "apps/desktop-webview/src/assets/cuu/live2d/source/cuu-live2d-v0-layer-manifest.json",
    psd_path: "docs/workhub/05-clients/assets/cuu-live2d/cuu-v1.psd"
  },
  stage: {
    width: 340,
    height: 420,
    anchor_x: 170,
    anchor_y: 386
  },
  layers: [
    layer("tail", "Tail_Base", "tail.png", 250, 236, 46, 104, 28, 70, 10, "tail"),
    layer("body_backfur", "Body_BackFur", "body-backfur.png", 108, 144, 188, 222, 112, 206, 20, "body"),
    layer("front_paws", "FrontPaws", "front-paws.png", 108, 274, 110, 92, 54, 86, 30, "front_paws"),
    layer("head", "Head_FaceBase", "head.png", 106, 70, 144, 140, 72, 106, 40, "head"),
    layer("lace_bib", "LaceBib_Front", "lace-bib.png", 100, 154, 166, 142, 76, 28, 50, "lace_bib"),
    layer("bow", "Bow_Center", "bow.png", 102, 174, 88, 76, 44, 28, 60, "bow"),
    layer("tassel_l", "Tassel_L_String_01", "tassel-l.png", 100, 192, 28, 142, 2, 14, 70, "tassel_l"),
    layer("tassel_r", "Tassel_R_String_01", "tassel-r.png", 202, 188, 50, 150, 22, 14, 70, "tassel_r")
  ],
  bones: [
    bone("root", undefined, 170, 386),
    bone("body", "root", 170, 286, "ParamBodyAngleY"),
    bone("tail", "body", 260, 300, "ParamTailSway"),
    bone("front_paws", "body", 164, 332, "ParamPawTap"),
    bone("head", "body", 176, 176, "ParamAngleZ"),
    bone("lace_bib", "body", 178, 202, "ParamBibSway"),
    bone("bow", "lace_bib", 148, 208, "ParamBowBounce"),
    bone("tassel_l", "lace_bib", 102, 208, "ParamTasselSwingL"),
    bone("tassel_r", "lace_bib", 224, 208, "ParamTasselSwingR")
  ],
  parameters: [
    parameter("ParamAngleX", -1, 1, 0, "head horizontal aim"),
    parameter("ParamAngleY", -1, 1, 0, "head vertical aim"),
    parameter("ParamAngleZ", -1, 1, 0, "head tilt"),
    parameter("ParamBodyAngleX", -1, 1, 0, "body horizontal lean"),
    parameter("ParamBodyAngleY", -1, 1, 0, "body vertical lean"),
    parameter("ParamEyeLOpen", 0, 1, 1, "left eye open amount"),
    parameter("ParamEyeROpen", 0, 1, 1, "right eye open amount"),
    parameter("ParamEyeBallX", -1, 1, 0, "eye look x"),
    parameter("ParamEyeBallY", -1, 1, 0, "eye look y"),
    parameter("ParamMouthOpenY", 0, 1, 0, "mouth open amount"),
    parameter("ParamMouthForm", -1, 1, 0, "mouth smile/frown"),
    parameter("ParamEarLWiggle", -1, 1, 0, "left ear wiggle"),
    parameter("ParamEarRWiggle", -1, 1, 0, "right ear wiggle"),
    parameter("ParamTailSway", -1, 1, 0, "tail swaying amplitude"),
    parameter("ParamTailCurl", -1, 1, 0, "tail curl or tuck"),
    parameter("ParamBibSway", -1, 1, 0, "lace bib sway"),
    parameter("ParamBowBounce", -1, 1, 0, "bow bounce"),
    parameter("ParamTasselSwingL", -1, 1, 0, "left tassel swing"),
    parameter("ParamTasselSwingR", -1, 1, 0, "right tassel swing"),
    parameter("ParamPawTap", -1, 1, 0, "front paw tap"),
    parameter("ParamPawHoldDoc", -1, 1, 0, "future document hold pose")
  ],
  motions: {
    idle: motion("idle", true, "idle", "idle_breathe", { ParamTailSway: 0.28, ParamBibSway: 0.12 }),
    blink: motion("blink", false, "idle", "idle_blink", { ParamEyeLOpen: 0, ParamEyeROpen: 0 }),
    look: motion("look", false, "idle", "look_at_mouse", { ParamAngleX: 0.38, ParamEyeBallX: 0.42 }),
    thinking: motion("thinking", true, "normal", "thinking_tail", { ParamAngleZ: -0.12, ParamTailSway: 0.62 }),
    approval: motion("approval", true, "urgent", "asking_approval_bounce", { ParamBowBounce: 0.62, ParamPawTap: 0.42 }),
    review: motion("review", true, "normal", "searching_evidence_peek", { ParamAngleX: -0.24, ParamBibSway: 0.16 }),
    worried: motion("worried", true, "urgent", "worried_ears", { ParamAngleZ: -0.22, ParamTailCurl: 0.38 }),
    celebrate: motion("celebrate", false, "normal", "celebrating_jump", { ParamBowBounce: 0.85, ParamPawTap: 0.72 }),
    drag: motion("drag", true, "normal", "drag_hold", { ParamBodyAngleY: 0.18 }),
    tap: motion("tap", false, "normal", "tap_bubble", { ParamPawTap: 0.78 }),
    offline: motion("offline", true, "idle", "offline_sleep", { ParamEyeLOpen: 0.28, ParamEyeROpen: 0.28 })
  }
} satisfies CuuLive2DManifest;

export function validateDesktopCuuLive2DPrototypeManifest(): CuuLive2DManifestIssue[] {
  return validateCuuLive2DManifest(desktopCuuLive2DPrototypeManifest);
}

function layer(
  id: CuuLive2DManifest["layers"][number]["id"],
  source_layer: string,
  image_path: string,
  x: number,
  y: number,
  width: number,
  height: number,
  pivot_x: number,
  pivot_y: number,
  z_index: number,
  bone: CuuLive2DManifest["layers"][number]["bone"]
): CuuLive2DManifest["layers"][number] {
  return { id, origin: "static_png_crop", source_layer, image_path, x, y, width, height, pivot_x, pivot_y, z_index, bone };
}

function bone(
  id: CuuLive2DManifest["bones"][number]["id"],
  parent: CuuLive2DManifest["bones"][number]["parent"],
  x: number,
  y: number,
  parameter?: CuuLive2DManifest["parameters"][number]["id"]
): CuuLive2DManifest["bones"][number] {
  return {
    id,
    ...(parent ? { parent } : {}),
    x,
    y,
    ...(parameter ? { parameter } : {})
  };
}

function parameter(
  id: CuuLive2DManifest["parameters"][number]["id"],
  min: number,
  max: number,
  defaultValue: number,
  description: string
): CuuLive2DManifest["parameters"][number] {
  return { id, min, max, default: defaultValue, description };
}

function motion(
  id: CuuLive2DManifest["motions"]["idle"]["id"],
  loop: boolean,
  priority: CuuLive2DManifest["motions"]["idle"]["priority"],
  fallback_sprite_clip: CuuLive2DManifest["motions"]["idle"]["fallback_sprite_clip"],
  parameters: CuuLive2DManifest["motions"]["idle"]["parameters"]
): CuuLive2DManifest["motions"]["idle"] {
  return { id, loop, priority, fallback_sprite_clip, parameters };
}

function layerImage(image_path: string, width: number, height: number): DesktopCuuLive2DLayerImage {
  return { image_path, width, height };
}
