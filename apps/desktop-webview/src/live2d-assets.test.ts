import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
