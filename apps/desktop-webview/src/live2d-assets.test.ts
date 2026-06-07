import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateCuuLive2DManifest, type CuuLive2DManifest } from "@workhub/cuu";

import {
  desktopCuuLive2DPrototypeLayerImages,
  desktopCuuLive2DPrototypeManifest,
  desktopCuuLive2DPrototypeManifestUrl,
  desktopCuuLive2DPrototypePreviewUrl,
  validateDesktopCuuLive2DPrototypeManifest
} from "./cuu-live2d-assets.js";

type CuuLive2DLayerManifest = {
  status: string;
  source_art: {
    front_model_concept: string;
    documentation_board: string;
  };
  required_layers: Array<{
    name: string;
    group: string;
    physics?: string;
    parameter?: string;
    paint_behind?: string[];
  }>;
  parameters: string[];
  motions: Record<string, { file: string; loop: boolean; fallback_sprite_clip: string }>;
  qa: {
    psd_checks: string[];
    cubism_checks: string[];
    runtime_checks: string[];
  };
};

function loadManifest(): CuuLive2DLayerManifest {
  return JSON.parse(
    readFileSync(
      new URL("./assets/cuu/live2d/source/cuu-live2d-v0-layer-manifest.json", import.meta.url),
      "utf8"
    )
  ) as CuuLive2DLayerManifest;
}

function motion(manifest: CuuLive2DLayerManifest, key: string) {
  const item = manifest.motions[key];
  assert.ok(item, `missing Live2D motion ${key}`);
  return item;
}

test("Cuu Live2D layer manifest keeps PSD production requirements explicit", () => {
  const manifest = loadManifest();
  const layerNames = manifest.required_layers.map((layer) => layer.name);

  assert.equal(manifest.status, "contract_only");
  assert.match(manifest.source_art.front_model_concept, /cuu-live2d-front-model-concept\.png/u);
  assert.match(manifest.source_art.documentation_board, /cuu-live2d-psd-production-board\.png/u);
  assert.equal(new Set(layerNames).size, layerNames.length);
  assert.ok(layerNames.includes("Head_FaceBase"));
  assert.ok(layerNames.includes("Eye_L_UpperLid"));
  assert.ok(layerNames.includes("Mouth_Inside"));
  assert.ok(layerNames.includes("LaceBib_Front"));
  assert.ok(layerNames.includes("Bow_L_Wing"));
  assert.ok(layerNames.includes("Tassel_R_String_03"));
  assert.ok(layerNames.includes("Tail_Tip"));
  assert.ok(manifest.required_layers.some((layer) => layer.paint_behind?.includes("LaceBib_Front")));
  assert.ok(manifest.required_layers.some((layer) => layer.physics === "tassel_chain_l"));
  assert.ok(manifest.parameters.includes("ParamTasselSwingR"));
});

test("Cuu Live2D motion contract preserves sprite fallback coverage", () => {
  const manifest = loadManifest();

  assert.equal(motion(manifest, "idle").fallback_sprite_clip, "idle_breathe");
  assert.equal(motion(manifest, "approval").fallback_sprite_clip, "asking_approval_bounce");
  assert.equal(motion(manifest, "search").fallback_sprite_clip, "searching_evidence_peek");
  assert.equal(motion(manifest, "carry_doc").fallback_sprite_clip, "carrying_document_step");
  assert.equal(motion(manifest, "offline").fallback_sprite_clip, "offline_sleep");
  assert.ok(manifest.qa.psd_checks.includes("occluded_regions_painted"));
  assert.ok(manifest.qa.cubism_checks.includes("all_motions_have_sprite_fallback"));
  assert.ok(manifest.qa.runtime_checks.includes("fallback_sprite_loads_when_live2d_fails"));
});

test("Cuu generated Live2D PSD draft records source parts and non-final status", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("./assets/cuu/live2d/source/generated-psd-draft-v1/cuu-live2d-generated-psd-draft-v1.manifest.json", import.meta.url),
      "utf8"
    )
  ) as {
    status: string;
    layers: Array<{ name: string; group: string; origin: string; source_board?: string; source_part_id?: number }>;
  };
  const report = JSON.parse(
    readFileSync(
      new URL("./assets/cuu/live2d/source/generated-psd-draft-v1/cuu-live2d-generated-psd-draft-v1-report.json", import.meta.url),
      "utf8"
    )
  ) as {
    result: string;
    layer_count: number;
    generated_layer_count: number;
    origin_counts: Record<string, number>;
  };
  const names = manifest.layers.map((layer) => layer.name);

  assert.equal(manifest.status, "draft_psd_generated_requires_art_review_and_cubism_binding");
  assert.equal(manifest.layers.length, 144);
  assert.equal(new Set(names).size, 144);
  assert.ok(manifest.layers.some((layer) => layer.name === "Head_BaseClean" && layer.source_board?.includes("face-parts")));
  assert.ok(manifest.layers.some((layer) => layer.name === "Tail_Tip" && layer.source_part_id === 23));
  assert.ok(manifest.layers.some((layer) => layer.group === "70_Accessories" && layer.name === "Tassel_L_String_01"));
  assert.ok(manifest.layers.some((layer) => layer.origin === "paint_behind_placeholder"));
  assert.equal(report.result, "draft_created_not_visual_pass");
  assert.equal(report.layer_count, 144);
  assert.equal(report.generated_layer_count, 131);
  assert.equal(report.origin_counts.generated_layer_png, 131);
});

test("Cuu layered Live2D prototype manifest validates against the shared runtime contract", () => {
  const generated = JSON.parse(
    readFileSync(
      new URL("./assets/cuu/live2d/prototype/cuu-layered-rig-v0/cuu-layered-rig-v0.manifest.json", import.meta.url),
      "utf8"
    )
  ) as CuuLive2DManifest;

  assert.deepEqual(validateDesktopCuuLive2DPrototypeManifest(), []);
  assert.deepEqual(validateCuuLive2DManifest(generated), []);
  assert.equal(desktopCuuLive2DPrototypeManifest.status, "prototype_layered");
  assert.equal(generated.status, "prototype_layered");
  assert.equal(desktopCuuLive2DPrototypeManifest.layers.length, 8);
  assert.deepEqual(
    generated.layers.map((layer) => layer.id),
    desktopCuuLive2DPrototypeManifest.layers.map((layer) => layer.id)
  );
  assert.match(desktopCuuLive2DPrototypeManifestUrl, /cuu-layered-rig-v0\.manifest\.json/u);
  assert.match(desktopCuuLive2DPrototypePreviewUrl, /cuu-layered-rig-v0-preview\.png/u);
});

test("Cuu layered Live2D prototype keeps every runtime layer backed by a PNG asset", () => {
  for (const layer of desktopCuuLive2DPrototypeManifest.layers) {
    const image = desktopCuuLive2DPrototypeLayerImages[layer.id];
    assert.ok(image.image_path.endsWith(layer.image_path), `layer ${layer.id} should point at ${layer.image_path}`);
    assert.equal(image.width, layer.width);
    assert.equal(image.height, layer.height);
  }
  assert.equal(desktopCuuLive2DPrototypeManifest.motions.idle.fallback_sprite_clip, "idle_breathe");
  assert.equal(desktopCuuLive2DPrototypeManifest.motions.approval.fallback_sprite_clip, "asking_approval_bounce");
  assert.equal(desktopCuuLive2DPrototypeManifest.motions.worried.fallback_sprite_clip, "worried_ears");
});
