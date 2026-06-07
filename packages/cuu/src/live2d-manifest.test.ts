import assert from "node:assert/strict";
import test from "node:test";

import {
  cuuLive2DMotionForSpriteState,
  validateCuuLive2DManifest,
  type CuuLive2DManifest
} from "./index.js";

const baseManifest = {
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
    layer("tail", "Tail_Base", "tail.png", 234, 222, 90, 122, 20, 72, 10, "tail"),
    layer("body_backfur", "Body_BackFur", "body-backfur.png", 110, 160, 206, 226, 108, 206, 20, "body"),
    layer("front_paws", "FrontPaws", "front-paws.png", 116, 278, 104, 106, 52, 96, 30, "front_paws"),
    layer("head", "Head_FaceBase", "head.png", 82, 44, 186, 196, 96, 150, 40, "head"),
    layer("lace_bib", "LaceBib_Front", "lace-bib.png", 92, 168, 166, 128, 82, 24, 50, "lace_bib"),
    layer("bow", "Bow_Center", "bow.png", 114, 190, 76, 66, 38, 24, 60, "bow"),
    layer("tassel_l", "Tassel_L_String_01", "tassel-l.png", 88, 206, 46, 132, 24, 12, 70, "tassel_l"),
    layer("tassel_r", "Tassel_R_String_01", "tassel-r.png", 204, 206, 48, 132, 20, 12, 70, "tassel_r")
  ],
  bones: [
    bone("root", undefined, 170, 386),
    bone("body", "root", 170, 280, "ParamBodyAngleY"),
    bone("tail", "body", 250, 282, "ParamTailSway"),
    bone("front_paws", "body", 168, 332, "ParamPawTap"),
    bone("head", "body", 178, 178, "ParamAngleZ"),
    bone("lace_bib", "body", 176, 198, "ParamBibSway"),
    bone("bow", "lace_bib", 152, 214, "ParamBowBounce"),
    bone("tassel_l", "lace_bib", 112, 218, "ParamTasselSwingL"),
    bone("tassel_r", "lace_bib", 224, 218, "ParamTasselSwingR")
  ],
  parameters: [
    parameter("ParamAngleX"),
    parameter("ParamAngleY"),
    parameter("ParamAngleZ"),
    parameter("ParamBodyAngleX"),
    parameter("ParamBodyAngleY"),
    parameter("ParamEyeLOpen", 0, 1, 1),
    parameter("ParamEyeROpen", 0, 1, 1),
    parameter("ParamEyeBallX"),
    parameter("ParamEyeBallY"),
    parameter("ParamMouthOpenY", 0, 1, 0),
    parameter("ParamMouthForm"),
    parameter("ParamEarLWiggle"),
    parameter("ParamEarRWiggle"),
    parameter("ParamTailSway"),
    parameter("ParamTailCurl"),
    parameter("ParamBibSway"),
    parameter("ParamBowBounce"),
    parameter("ParamTasselSwingL"),
    parameter("ParamTasselSwingR"),
    parameter("ParamPawTap"),
    parameter("ParamPawHoldDoc")
  ],
  motions: {
    idle: motion("idle", true, "idle", "idle_breathe", { ParamTailSway: 0.4, ParamBibSway: 0.12 }),
    blink: motion("blink", false, "idle", "idle_blink", { ParamEyeLOpen: 0, ParamEyeROpen: 0 }),
    look: motion("look", false, "idle", "look_at_mouse", { ParamAngleX: 0.35, ParamEyeBallX: 0.35 }),
    thinking: motion("thinking", true, "normal", "thinking_tail", { ParamTailSway: 0.7, ParamAngleZ: -0.16 }),
    approval: motion("approval", true, "urgent", "asking_approval_bounce", { ParamBowBounce: 0.55, ParamPawTap: 0.4 }),
    review: motion("review", true, "normal", "searching_evidence_peek", { ParamAngleX: -0.25 }),
    worried: motion("worried", true, "urgent", "worried_ears", { ParamAngleZ: -0.24, ParamTailCurl: 0.3 }),
    celebrate: motion("celebrate", false, "normal", "celebrating_jump", { ParamBowBounce: 0.8, ParamPawTap: 0.8 }),
    drag: motion("drag", true, "normal", "drag_hold", { ParamBodyAngleY: 0.2 }),
    tap: motion("tap", false, "normal", "tap_bubble", { ParamPawTap: 0.7 }),
    offline: motion("offline", true, "idle", "offline_sleep", { ParamEyeLOpen: 0.3, ParamEyeROpen: 0.3 })
  }
} satisfies CuuLive2DManifest;

test("Cuu Live2D manifest validates the same-source layered rig contract", () => {
  assert.deepEqual(validateCuuLive2DManifest(baseManifest), []);
  assert.equal(baseManifest.status, "prototype_layered");
  assert.equal(baseManifest.layers.length, 8);
  assert.equal(baseManifest.bones.at(0)?.id, "root");
  assert.equal(baseManifest.motions.approval.fallback_sprite_clip, "asking_approval_bounce");
});

test("Cuu Live2D manifest rejects missing rig links and incomplete Cubism exports", () => {
  const broken = {
    ...baseManifest,
    status: "cubism_exported",
    model: { model3_json: "", moc3: "", textures: [] },
    layers: baseManifest.layers.filter((layer) => layer.id !== "tail"),
    bones: baseManifest.bones.map((bone) => bone.id === "head" ? { ...bone, parent: "missing" as const } : bone),
    motions: {
      ...baseManifest.motions,
      idle: {
        ...baseManifest.motions.idle,
        parameters: { MissingParam: 1 }
      }
    }
  } as unknown as CuuLive2DManifest;

  const issueCodes = validateCuuLive2DManifest(broken).map((issue) => issue.code);

  assert.ok(issueCodes.includes("missing_layer"));
  assert.ok(issueCodes.includes("bone_parent_missing"));
  assert.ok(issueCodes.includes("motion_parameter_missing"));
  assert.ok(issueCodes.includes("missing_exported_model"));
});

test("Cuu Live2D motion lookup preserves sprite fallback semantics", () => {
  assert.equal(cuuLive2DMotionForSpriteState("idle_tail_sway"), "idle");
  assert.equal(cuuLive2DMotionForSpriteState("idle_blink"), "blink");
  assert.equal(cuuLive2DMotionForSpriteState("asking_approval_bounce"), "approval");
  assert.equal(cuuLive2DMotionForSpriteState("worried_ears"), "worried");
  assert.equal(cuuLive2DMotionForSpriteState("drag_hold"), "drag");
});

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
  bone: CuuLive2DManifest["bones"][number]["id"]
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
  min = -1,
  max = 1,
  defaultValue = 0
): CuuLive2DManifest["parameters"][number] {
  return { id, min, max, default: defaultValue, description: `${id} prototype parameter` };
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
