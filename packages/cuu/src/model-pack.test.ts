import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCuuModelPackCanBeDefault,
  defaultCuuBongoModelPack,
  requiredCuuModelPackMotionStates,
  validateCuuModelPackManifest,
  type CuuModelPackManifest
} from "./index.js";

test("Cuu Bongo model pack is the approved low-uncanny default", () => {
  assert.deepEqual(validateCuuModelPackManifest(defaultCuuBongoModelPack, {
    require_default_ready: true,
    require_full_motion_coverage: true,
    require_idle_micro_action_coverage: true
  }), []);
  assert.doesNotThrow(() => assertCuuModelPackCanBeDefault(defaultCuuBongoModelPack));
  assert.equal(defaultCuuBongoModelPack.pack_id, "cuu-bongo-p1");
  assert.equal(defaultCuuBongoModelPack.runtime_kind, "bongo_cuu");
  assert.equal(defaultCuuBongoModelPack.default_policy.status, "approved_default");
  assert.equal(defaultCuuBongoModelPack.visual_gate.no_psd_default, true);
  assert.equal(defaultCuuBongoModelPack.window_affordances.transparent_window, "supported");
  assert.equal(defaultCuuBongoModelPack.window_affordances.draggable, "supported");
  assert.equal(defaultCuuBongoModelPack.window_affordances.pass_through, "supported");
  assert.equal(defaultCuuBongoModelPack.window_affordances.scale, "supported");
  assert.equal(defaultCuuBongoModelPack.window_affordances.opacity, "supported");
  assert.match(defaultCuuBongoModelPack.source.reference_url ?? "", /ayangweb\/BongoCat/u);
});

test("Cuu default model pack covers all business and idle actions", () => {
  const states = requiredCuuModelPackMotionStates();

  assert.equal(states.length, 18);
  for (const state of states) {
    const motion = defaultCuuBongoModelPack.motions[state];
    assert.equal(motion?.state, state);
    assert.equal(motion?.renderer_state, state);
    assert.ok(motion?.min_visible_components.includes("head"));
    assert.ok(motion?.min_visible_components.includes("paws"));
  }

  assert.ok(defaultCuuBongoModelPack.motions.searching_evidence_peek?.min_visible_components.includes("search_glass"));
  assert.ok(defaultCuuBongoModelPack.motions.syncing_files_spin?.min_visible_components.includes("sync_ring"));
  assert.ok(defaultCuuBongoModelPack.motions.celebrating_jump?.min_visible_components.includes("sparks"));
});

test("Cuu PSD draft packs are blocked from becoming the default surface", () => {
  const psdDraft = {
    ...defaultCuuBongoModelPack,
    pack_id: "cuu-psd-draft-v1",
    runtime_kind: "live2d_cubism",
    default_policy: {
      allow_as_default: true,
      status: "experimental",
      reason: "Generated PSD draft still has uncanny-valley risk."
    },
    visual_gate: {
      ...defaultCuuBongoModelPack.visual_gate,
      low_uncanny: false,
      no_ai_artifact: false
    },
    source: {
      ...defaultCuuBongoModelPack.source,
      assets: [
        {
          kind: "psd_draft",
          path: "apps/desktop-webview/src/assets/cuu/live2d/source/generated-psd-draft-v1/generated-psd-draft-v1.psd",
          note: "Generated PSD draft probe.",
          default_candidate: true
        }
      ]
    }
  } as CuuModelPackManifest;

  const issueCodes = validateCuuModelPackManifest(psdDraft, { require_default_ready: true }).map((issue) => issue.code);

  assert.ok(issueCodes.includes("default_not_approved"));
  assert.ok(issueCodes.includes("visual_gate_failed"));
  assert.ok(issueCodes.includes("psd_default_asset"));
  assert.throws(() => assertCuuModelPackCanBeDefault(psdDraft), /cannot be default/u);
});
