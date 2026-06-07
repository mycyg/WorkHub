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
    pet_pass_through: false
  });
  assert.deepEqual(loadCuuPreferences(broken), {
    attention_mode: "normal",
    sound_mode: "on",
    reduced_motion: false,
    queue_limit: 5,
    pet_scale_percent: 100,
    pet_opacity_percent: 100,
    pet_pass_through: false
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
    pet_pass_through: true
  });
  const storage = memoryStorage();

  assert.deepEqual(normalized, {
    attention_mode: "quiet",
    sound_mode: "muted",
    reduced_motion: true,
    queue_limit: 12,
    pet_scale_percent: 125,
    pet_opacity_percent: 80,
    pet_pass_through: true
  });
  saveCuuPreferences(normalized, storage);
  assert.deepEqual(loadCuuPreferences(storage), normalized);
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
      pet_pass_through: true
    }
  });
  const html = renderCuuPreferencePanel(controller.snapshot());

  assert.match(html, /data-cuu-attention-mode="normal"/u);
  assert.match(html, /data-cuu-attention-mode="do_not_disturb" aria-pressed="true"/u);
  assert.match(html, /data-cuu-sound-mode="muted" aria-pressed="true"/u);
  assert.match(html, /data-cuu-reduced-motion checked/u);
  assert.match(html, /data-cuu-pet-scale="150" aria-pressed="true"/u);
  assert.match(html, /data-cuu-pet-opacity="60" aria-pressed="true"/u);
  assert.match(html, /data-cuu-pet-pass-through checked/u);
  assert.match(html, /value="3" data-cuu-queue-limit/u);
  assert.match(html, /150% · 60%/u);
  assert.match(html, /0 条待处理/u);
});
