import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCuuModelPackCanBeDefault,
  describeCuuModelPackChoices,
  defaultCuuBlackCatLive2DModelPack,
  defaultCuuWhiteCatLive2DModelPack,
  getCuuModelPack,
  listCuuModelPacks,
  normalizeCuuSelectableModelPackId,
  requiredCuuModelPackMotionStates,
  resolveCuuVisibleModelPack,
  validateCuuModelPackManifest
} from "./index.js";

test("Cuu model pack registry only exposes black and white Live2D cats", () => {
  const packs = listCuuModelPacks();

  assert.deepEqual(packs.map((pack) => pack.pack_id), [
    "cuu-hijiki-live2d-cubism2",
    "cuu-tororo-live2d-cubism2"
  ]);
  assert.equal(getCuuModelPack("cuu-hijiki-live2d-cubism2"), defaultCuuBlackCatLive2DModelPack);
  assert.equal(getCuuModelPack("cuu-tororo-live2d-cubism2"), defaultCuuWhiteCatLive2DModelPack);
  assert.equal(getCuuModelPack("cuu-bongo-p1"), undefined);
  assert.equal(getCuuModelPack("cuu-live2d-cubism-v2"), undefined);
});

test("both approved cat model packs can be default-ready choices", () => {
  for (const pack of [defaultCuuBlackCatLive2DModelPack, defaultCuuWhiteCatLive2DModelPack]) {
    assert.deepEqual(validateCuuModelPackManifest(pack, {
      require_default_ready: true,
      require_full_motion_coverage: true,
      require_idle_micro_action_coverage: true
    }), []);
    assert.doesNotThrow(() => assertCuuModelPackCanBeDefault(pack));
    assert.equal(pack.runtime_kind, "live2d_cubism");
    assert.equal(pack.default_policy.status, "approved_default");
    assert.equal(pack.default_policy.allow_as_default, true);
    assert.equal(pack.visual_gate.alive_motion, true);
    assert.equal(pack.window_affordances.transparent_window, "supported");
    assert.equal(pack.window_affordances.draggable, "supported");
    assert.equal(pack.window_affordances.pass_through, "supported");
    assert.equal(pack.window_affordances.scale, "supported");
    assert.equal(pack.window_affordances.opacity, "supported");
    assert.equal(pack.window_affordances.hide_on_hover, "supported");
  }

  assert.match(defaultCuuBlackCatLive2DModelPack.source.reference_url ?? "", /imuncle\/live2d\/tree\/master\/model\/hijiki/u);
  assert.match(defaultCuuWhiteCatLive2DModelPack.source.reference_url ?? "", /imuncle\/live2d\/tree\/master\/model\/tororo/u);
});

test("Cuu defaults to black cat and allows selecting white cat only", () => {
  assert.equal(normalizeCuuSelectableModelPackId("cuu-hijiki-live2d-cubism2"), "cuu-hijiki-live2d-cubism2");
  assert.equal(normalizeCuuSelectableModelPackId("cuu-tororo-live2d-cubism2"), "cuu-tororo-live2d-cubism2");
  assert.equal(normalizeCuuSelectableModelPackId("cuu-bongo-p1"), undefined);
  assert.equal(normalizeCuuSelectableModelPackId("cuu-live2d-cubism-v2"), undefined);
  assert.equal(normalizeCuuSelectableModelPackId("cuu-psd-draft-v1"), undefined);

  const defaultSelection = resolveCuuVisibleModelPack();
  assert.equal(defaultSelection.active_pack.pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(defaultSelection.reason, "registry_default");
  assert.deepEqual(defaultSelection.issues, []);

  const whiteSelection = resolveCuuVisibleModelPack({ requested_pack_id: "cuu-tororo-live2d-cubism2" });
  assert.equal(whiteSelection.active_pack.pack_id, "cuu-tororo-live2d-cubism2");
  assert.equal(whiteSelection.reason, "requested_default_ready");

  const unknownSelection = resolveCuuVisibleModelPack({ requested_pack_id: "cuu-bongo-p1" });
  assert.equal(unknownSelection.active_pack.pack_id, "cuu-hijiki-live2d-cubism2");
  assert.equal(unknownSelection.reason, "unknown_requested_pack");
  assert.equal(unknownSelection.fallback_pack?.pack_id, "cuu-hijiki-live2d-cubism2");
});

test("Cuu model pack choices render as a two-option settings whitelist", () => {
  const choices = describeCuuModelPackChoices({ selected_pack_id: "cuu-tororo-live2d-cubism2" });

  assert.equal(choices.length, 2);
  assert.deepEqual(choices.map((choice) => choice.pack_id), [
    "cuu-hijiki-live2d-cubism2",
    "cuu-tororo-live2d-cubism2"
  ]);
  assert.equal(choices[0]?.selected, false);
  assert.equal(choices[1]?.selected, true);
  for (const choice of choices) {
    assert.equal(choice.can_be_default, true);
    assert.equal(choice.can_select_in_settings, true);
    assert.equal(choice.status, "default_ready");
    assert.deepEqual(choice.issues, []);
  }
});

test("Cuu approved cat packs cover all business and idle actions", () => {
  const states = requiredCuuModelPackMotionStates();

  assert.equal(states.length, 18);
  for (const pack of [defaultCuuBlackCatLive2DModelPack, defaultCuuWhiteCatLive2DModelPack]) {
    for (const state of states) {
      const motion = pack.motions[state];
      assert.equal(motion?.state, state);
      assert.match(motion?.renderer_state ?? "", /^mtn\//u);
      assert.ok(motion?.min_visible_components.includes("head"));
      assert.ok(motion?.min_visible_components.includes("paws"));
    }

    assert.equal(pack.motions.searching_evidence_peek?.renderer_state, "mtn/04.mtn");
    assert.equal(pack.motions.syncing_files_spin?.renderer_state, "mtn/04.mtn");
    assert.equal(pack.motions.celebrating_jump?.renderer_state, "mtn/06.mtn");
  }
});
