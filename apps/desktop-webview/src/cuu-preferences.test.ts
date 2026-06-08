import assert from "node:assert/strict";
import test from "node:test";

import { createCuuController } from "@workhub/cuu";

import {
  CUU_PREFERENCES_STORAGE_KEY,
  loadCuuPreferences,
  normalizeCuuPreferences,
  renderCuuPreferencePanel,
  saveCuuPreferences,
  type CuuPreferenceStorage
} from "./cuu-preferences.js";

function memoryStorage(initial: Record<string, string> = {}): CuuPreferenceStorage & { entries: Record<string, string> } {
  const entries = { ...initial };
  return {
    entries,
    getItem(key: string) {
      return entries[key] ?? null;
    },
    setItem(key: string, value: string) {
      entries[key] = value;
    }
  };
}

test("Cuu preferences load defaults when storage is absent or invalid", () => {
  const broken = memoryStorage({ [CUU_PREFERENCES_STORAGE_KEY]: "{" });

  assert.deepEqual(loadCuuPreferences(undefined), {
    attention_mode: "normal",
    sound_mode: "on",
    reduced_motion: false,
    queue_limit: 5,
    pet_scale_percent: 100,
    pet_opacity_percent: 100,
    pet_pass_through: false,
    pet_hide_on_hover: false
  });
  assert.deepEqual(loadCuuPreferences(broken), {
    attention_mode: "normal",
    sound_mode: "on",
    reduced_motion: false,
    queue_limit: 5,
    pet_scale_percent: 100,
    pet_opacity_percent: 100,
    pet_pass_through: false,
    pet_hide_on_hover: false
  });
});

test("Cuu preferences normalize user-editable values before persistence", () => {
  const normalized = normalizeCuuPreferences({
    attention_mode: "quiet",
    sound_mode: "muted",
    reduced_motion: true,
    queue_limit: 42,
    pet_scale_percent: 125,
    pet_opacity_percent: 80,
    pet_pass_through: true,
    pet_hide_on_hover: true,
    pet_model_pack_id: "cuu-tororo-live2d-cubism2"
  });
  const storage = memoryStorage();

  assert.deepEqual(normalized, {
    attention_mode: "quiet",
    sound_mode: "muted",
    reduced_motion: true,
    queue_limit: 12,
    pet_scale_percent: 125,
    pet_opacity_percent: 80,
    pet_pass_through: true,
    pet_hide_on_hover: true,
    pet_model_pack_id: "cuu-tororo-live2d-cubism2"
  });
  saveCuuPreferences(normalized, storage);
  assert.deepEqual(loadCuuPreferences(storage), normalized);
  assert.equal(normalizeCuuPreferences({ pet_model_pack_id: "cuu-bongo-p1" }).pet_model_pack_id, undefined);
  assert.equal(normalizeCuuPreferences({ pet_model_pack_id: "cuu-live2d-cubism-v2" }).pet_model_pack_id, undefined);
});

test("Cuu preferences accept Rust-injected QA overrides", () => {
  const target = globalThis as { __WORKHUB_CUU_PREFERENCES__?: unknown };
  const previous = target.__WORKHUB_CUU_PREFERENCES__;
  try {
    target.__WORKHUB_CUU_PREFERENCES__ = {
      pet_scale_percent: 150,
      pet_opacity_percent: 60,
      pet_pass_through: true,
      pet_hide_on_hover: true,
      pet_model_pack_id: "cuu-tororo-live2d-cubism2",
      queue_limit: 2
    };

    const loaded = loadCuuPreferences(memoryStorage({
      [CUU_PREFERENCES_STORAGE_KEY]: JSON.stringify({
        pet_scale_percent: 75,
        pet_opacity_percent: 100,
        pet_pass_through: false,
        pet_hide_on_hover: false,
        pet_model_pack_id: "cuu-bongo-p1",
        queue_limit: 9
      })
    }));

    assert.equal(loaded.pet_scale_percent, 150);
    assert.equal(loaded.pet_opacity_percent, 60);
    assert.equal(loaded.pet_pass_through, true);
    assert.equal(loaded.pet_hide_on_hover, true);
    assert.equal(loaded.pet_model_pack_id, "cuu-tororo-live2d-cubism2");
    assert.equal(loaded.queue_limit, 2);
  } finally {
    target.__WORKHUB_CUU_PREFERENCES__ = previous;
  }
});

test("Cuu preference panel renders clickable modes and queue state", () => {
  const controller = createCuuController({
    preferences: {
      attention_mode: "do_not_disturb",
      sound_mode: "muted",
      reduced_motion: true,
      queue_limit: 3,
      pet_scale_percent: 150,
      pet_opacity_percent: 60,
      pet_pass_through: true,
      pet_hide_on_hover: true,
      pet_model_pack_id: "cuu-hijiki-live2d-cubism2"
    }
  });
  const html = renderCuuPreferencePanel(controller.snapshot());

  assert.match(html, /data-cuu-model-pack-id="cuu-hijiki-live2d-cubism2"[^>]*aria-pressed="true"/u);
  assert.match(html, /data-cuu-model-pack-id="cuu-tororo-live2d-cubism2"[^>]*aria-pressed="false"/u);
  assert.match(html, /黑猫/u);
  assert.match(html, /白猫/u);
  assert.match(html, /当前默认/u);
  assert.match(html, /可选择/u);
  assert.doesNotMatch(html, /cuu-bongo-p1/u);
  assert.doesNotMatch(html, /cuu-live2d-cubism-v2/u);
  assert.match(html, /data-cuu-attention-mode="normal"/u);
  assert.match(html, /data-cuu-attention-mode="do_not_disturb" aria-pressed="true"/u);
  assert.match(html, /data-cuu-sound-mode="muted" aria-pressed="true"/u);
  assert.match(html, /data-cuu-reduced-motion checked/u);
  assert.match(html, /data-cuu-pet-scale="150" aria-pressed="true"/u);
  assert.match(html, /data-cuu-pet-opacity="60" aria-pressed="true"/u);
  assert.match(html, /data-cuu-pet-pass-through checked/u);
  assert.match(html, /data-cuu-pet-hide-on-hover checked/u);
  assert.match(html, /value="3" data-cuu-queue-limit/u);
  assert.match(html, /150% · 60%/u);
  assert.match(html, /软隐藏/u);
  assert.match(html, /0 条待处理/u);
});

test("Cuu preference panel renders English black and white model-pack copy only", () => {
  const controller = createCuuController();
  const html = renderCuuPreferencePanel(controller.snapshot(), { locale: "en-US" });

  assert.match(html, /Look/u);
  assert.match(html, /Black cat/u);
  assert.match(html, /White cat/u);
  assert.match(html, /Current default/u);
  assert.match(html, /Available/u);
  assert.doesNotMatch(html, /Bongo fallback/u);
  assert.doesNotMatch(html, /Live2D V2/u);
  assert.doesNotMatch(html, /data-cuu-model-pack-selectable="false"[^>]*disabled/u);
  assert.match(html, /Reduce motion/u);
  assert.doesNotMatch(html, /减少动效/u);
});
