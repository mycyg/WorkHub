import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCuuModelPackCanBeDefault,
  describeCuuModelPackChoices,
  defaultCuuBongoModelPack,
  getCuuModelPack,
  listCuuModelPacks,
  plannedCuuLive2DCubismModelPack,
  requiredCuuModelPackMotionStates,
  resolveCuuVisibleModelPack,
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
  assert.equal(defaultCuuBongoModelPack.window_affordances.hide_on_hover, "supported");
  assert.match(defaultCuuBongoModelPack.source.reference_url ?? "", /ayangweb\/BongoCat/u);
});

test("Cuu model pack registry keeps Bongo as the visible default and Live2D as locked experimental", () => {
  const packs = listCuuModelPacks();

  assert.deepEqual(packs.map((pack) => pack.pack_id), ["cuu-bongo-p1", "cuu-live2d-cubism-v2"]);
  assert.equal(getCuuModelPack("cuu-bongo-p1")?.runtime_kind, "bongo_cuu");
  assert.equal(getCuuModelPack("cuu-live2d-cubism-v2")?.runtime_kind, "live2d_cubism");
  assert.equal(getCuuModelPack("missing-pack"), undefined);

  const defaultSelection = resolveCuuVisibleModelPack();
  assert.equal(defaultSelection.active_pack.pack_id, "cuu-bongo-p1");
  assert.equal(defaultSelection.reason, "registry_default");
  assert.deepEqual(defaultSelection.issues, []);

  const live2dSelection = resolveCuuVisibleModelPack({ requested_pack_id: "cuu-live2d-cubism-v2" });
  assert.equal(live2dSelection.active_pack.pack_id, "cuu-bongo-p1");
  assert.equal(live2dSelection.requested_pack?.pack_id, "cuu-live2d-cubism-v2");
  assert.equal(live2dSelection.fallback_pack?.pack_id, "cuu-bongo-p1");
  assert.equal(live2dSelection.reason, "experimental_locked");
  assert.ok(live2dSelection.issues.some((issue) => issue.code === "visual_gate_failed"));
  assert.ok(live2dSelection.issues.some((issue) => issue.code === "missing_motion"));

  const unknownSelection = resolveCuuVisibleModelPack({ requested_pack_id: "cuu-psd-draft-v1" });
  assert.equal(unknownSelection.active_pack.pack_id, "cuu-bongo-p1");
  assert.equal(unknownSelection.reason, "unknown_requested_pack");
  assert.equal(unknownSelection.fallback_pack?.pack_id, "cuu-bongo-p1");
});

test("Cuu model pack choices are ready for settings UI without allowing PSD-like defaults", () => {
  const choices = describeCuuModelPackChoices({ selected_pack_id: "cuu-live2d-cubism-v2" });
  const bongo = choices.find((choice) => choice.pack_id === "cuu-bongo-p1");
  const live2d = choices.find((choice) => choice.pack_id === "cuu-live2d-cubism-v2");

  assert.equal(bongo?.selected, true);
  assert.equal(bongo?.can_be_default, true);
  assert.equal(bongo?.can_select_in_settings, true);
  assert.equal(bongo?.status, "default_ready");
  assert.match(bongo?.reference_url ?? "", /ayangweb\/BongoCat/u);

  assert.equal(live2d?.selected, false);
  assert.equal(live2d?.can_be_default, false);
  assert.equal(live2d?.can_select_in_settings, false);
  assert.equal(live2d?.status, "experimental_locked");
  assert.match(live2d?.reason ?? "", /locked for the default desktop pet/u);
  assert.ok(live2d?.issues.some((issue) => issue.path === "visual_gate.low_uncanny"));
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

test("planned Cuu Live2D Cubism pack is documented but cannot be default yet", () => {
  assert.equal(plannedCuuLive2DCubismModelPack.pack_id, "cuu-live2d-cubism-v2");
  assert.equal(plannedCuuLive2DCubismModelPack.runtime_kind, "live2d_cubism");
  assert.equal(plannedCuuLive2DCubismModelPack.default_policy.status, "experimental");
  assert.equal(plannedCuuLive2DCubismModelPack.default_policy.allow_as_default, false);
  assert.equal(validateCuuModelPackManifest(plannedCuuLive2DCubismModelPack).length, 0);

  const issueCodes = validateCuuModelPackManifest(plannedCuuLive2DCubismModelPack, {
    require_default_ready: true,
    require_full_motion_coverage: true,
    require_idle_micro_action_coverage: true
  }).map((issue) => issue.code);

  assert.ok(issueCodes.includes("default_blocked"));
  assert.ok(issueCodes.includes("default_not_approved"));
  assert.ok(issueCodes.includes("visual_gate_failed"));
  assert.ok(issueCodes.includes("missing_motion"));
  assert.throws(() => assertCuuModelPackCanBeDefault(plannedCuuLive2DCubismModelPack), /cannot be default/u);
});
