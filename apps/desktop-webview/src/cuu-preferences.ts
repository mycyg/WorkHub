import {
  defaultCuuControllerPreferences,
  type CuuController,
  type CuuPetOpacityPercent,
  type CuuPetScalePercent,
  type CuuControllerPreferences,
  type CuuControllerSnapshot
} from "@workhub/cuu";

export const CUU_PREFERENCES_STORAGE_KEY = "workhub_cuu_preferences";

export type CuuPreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export type CuuPreferencePanelBinding = {
  element: HTMLElement;
  toggle: HTMLButtonElement;
  refresh: () => void;
};

const petScaleOptions = [75, 100, 125, 150] as const satisfies readonly CuuPetScalePercent[];
const petOpacityOptions = [60, 80, 100] as const satisfies readonly CuuPetOpacityPercent[];

export const desktopCuuPreferenceCss = [
  ".wh-cuu-pref-button{position:fixed;right:18px;top:78px;z-index:40;border:1px solid rgba(53,92,255,.18);border-radius:8px;background:rgba(255,255,255,.94);box-shadow:0 12px 32px rgba(37,51,79,.12);padding:8px 10px;color:var(--wh-app-blue);font:850 12px/1 \"Aptos\",\"Segoe UI\",sans-serif;cursor:pointer}",
  ".wh-cuu-pref-button[aria-expanded=true]{background:rgba(53,92,255,.08)}",
  ".wh-cuu-preferences{position:fixed;right:18px;top:122px;z-index:40;width:min(340px,calc(100vw - 36px));display:grid;gap:10px;border:1px solid rgba(37,51,79,.12);border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 18px 48px rgba(37,51,79,.14);padding:12px;color:var(--wh-app-ink);font:700 12px/1.25 \"Aptos\",\"Segoe UI\",sans-serif}",
  ".wh-cuu-preferences[hidden]{display:none}.wh-cuu-preferences strong{font-size:13px}.wh-cuu-pref-row{display:grid;gap:6px}.wh-cuu-pref-options{display:flex;gap:6px;flex-wrap:wrap}",
  ".wh-cuu-pref-options button{border:1px solid var(--wh-app-line);border-radius:8px;background:#fff;color:var(--wh-app-ink);padding:7px 9px;font-weight:800;cursor:pointer}",
  ".wh-cuu-pref-options button[aria-pressed=true]{border-color:rgba(53,92,255,.32);background:rgba(53,92,255,.08);color:var(--wh-app-blue)}",
  ".wh-cuu-pref-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--wh-app-line);padding-top:8px}",
  ".wh-cuu-pref-toggle label{display:flex;align-items:center;gap:8px}.wh-cuu-pref-toggle input{width:16px;height:16px;accent-color:var(--wh-app-blue)}",
  ".wh-cuu-pref-queue{display:flex;align-items:center;justify-content:space-between;gap:10px;border-top:1px solid var(--wh-app-line);padding-top:8px}.wh-cuu-pref-queue input{width:64px;border:1px solid var(--wh-app-line);border-radius:8px;padding:6px 8px;font:800 12px/1 \"Aptos\",\"Segoe UI\",sans-serif;color:var(--wh-app-ink)}"
].join("");

export function loadCuuPreferences(storage = defaultStorage()): CuuControllerPreferences {
  const injected = injectedCuuPreferenceOverrides();
  const defaults = normalizeCuuPreferences({
    ...defaultCuuControllerPreferences(),
    ...injected
  });
  if (!storage) {
    return defaults;
  }
  try {
    const raw = storage.getItem(CUU_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    return normalizeCuuPreferences({
      ...(JSON.parse(raw) as Partial<CuuControllerPreferences>),
      ...injected
    });
  } catch {
    return defaults;
  }
}

export function saveCuuPreferences(preferences: CuuControllerPreferences, storage = defaultStorage()) {
  if (!storage) {
    return;
  }
  storage.setItem(CUU_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeCuuPreferences(preferences)));
}

export function normalizeCuuPreferences(input: Partial<CuuControllerPreferences> | undefined): CuuControllerPreferences {
  const defaults = defaultCuuControllerPreferences();
  const attentionMode = input?.attention_mode;
  const soundMode = input?.sound_mode;
  const queueLimit = Number(input?.queue_limit ?? defaults.queue_limit);
  return {
    attention_mode: attentionMode === "quiet" || attentionMode === "do_not_disturb" ? attentionMode : defaults.attention_mode,
    sound_mode: soundMode === "muted" ? "muted" : defaults.sound_mode,
    reduced_motion: input?.reduced_motion === true,
    queue_limit: Math.max(0, Math.min(12, Math.floor(Number.isFinite(queueLimit) ? queueLimit : defaults.queue_limit))),
    pet_scale_percent: normalizePetScalePercent(input?.pet_scale_percent),
    pet_opacity_percent: normalizePetOpacityPercent(input?.pet_opacity_percent),
    pet_pass_through: input?.pet_pass_through === true,
    pet_hide_on_hover: input?.pet_hide_on_hover === true
  };
}

export function renderCuuPreferencePanel(snapshot: CuuControllerSnapshot) {
  const preferences = snapshot.preferences;
  const modeButton = (mode: CuuControllerPreferences["attention_mode"], label: string) =>
    `<button type="button" data-cuu-attention-mode="${mode}" aria-pressed="${preferences.attention_mode === mode ? "true" : "false"}">${label}</button>`;
  const soundButton = (mode: CuuControllerPreferences["sound_mode"], label: string) =>
    `<button type="button" data-cuu-sound-mode="${mode}" aria-pressed="${preferences.sound_mode === mode ? "true" : "false"}">${label}</button>`;
  const scaleButton = (value: CuuPetScalePercent) =>
    `<button type="button" data-cuu-pet-scale="${value}" aria-pressed="${preferences.pet_scale_percent === value ? "true" : "false"}">${value}%</button>`;
  const opacityButton = (value: CuuPetOpacityPercent) =>
    `<button type="button" data-cuu-pet-opacity="${value}" aria-pressed="${preferences.pet_opacity_percent === value ? "true" : "false"}">${value}%</button>`;

  return `<strong>Cuu</strong>
    <div class="wh-cuu-pref-row">
      <span>提醒</span>
      <div class="wh-cuu-pref-options" role="group" aria-label="Cuu 提醒模式">
        ${modeButton("normal", "正常")}
        ${modeButton("quiet", "安静")}
        ${modeButton("do_not_disturb", "勿扰")}
      </div>
    </div>
    <div class="wh-cuu-pref-row">
      <span>声音</span>
      <div class="wh-cuu-pref-options" role="group" aria-label="Cuu 声音">
        ${soundButton("on", "开启")}
        ${soundButton("muted", "静音")}
      </div>
    </div>
    <div class="wh-cuu-pref-toggle">
      <label><input type="checkbox" data-cuu-reduced-motion ${preferences.reduced_motion ? "checked" : ""}>减少动效</label>
      <span>${snapshot.queue.length + snapshot.badge_count} 条待处理</span>
    </div>
    <div class="wh-cuu-pref-row">
      <span>尺寸</span>
      <div class="wh-cuu-pref-options" role="group" aria-label="Cuu 桌宠尺寸">
        ${petScaleOptions.map(scaleButton).join("")}
      </div>
    </div>
    <div class="wh-cuu-pref-row">
      <span>透明度</span>
      <div class="wh-cuu-pref-options" role="group" aria-label="Cuu 桌宠透明度">
        ${petOpacityOptions.map(opacityButton).join("")}
      </div>
    </div>
    <div class="wh-cuu-pref-toggle">
      <label><input type="checkbox" data-cuu-pet-pass-through ${preferences.pet_pass_through ? "checked" : ""}>点击穿透</label>
      <span>${preferences.pet_scale_percent}% · ${preferences.pet_opacity_percent}%</span>
    </div>
    <div class="wh-cuu-pref-toggle">
      <label><input type="checkbox" data-cuu-pet-hide-on-hover ${preferences.pet_hide_on_hover ? "checked" : ""}>悬停避让</label>
      <span>${preferences.pet_hide_on_hover ? "软隐藏" : "常驻"}</span>
    </div>
    <div class="wh-cuu-pref-queue">
      <label for="wh-cuu-queue-limit">队列上限</label>
      <input id="wh-cuu-queue-limit" type="number" min="0" max="12" step="1" value="${preferences.queue_limit}" data-cuu-queue-limit>
    </div>`;
}

export function bindCuuPreferencePanel(
  shellRoot: HTMLElement,
  controller: CuuController,
  input: {
    storage?: CuuPreferenceStorage | undefined;
    onChange?: (snapshot: CuuControllerSnapshot) => void;
  } = {}
): CuuPreferencePanelBinding {
  const toggle = ensureCuuPreferenceToggle(shellRoot);
  const panel = ensureCuuPreferencePanel(shellRoot);
  const refresh = () => {
    panel.innerHTML = renderCuuPreferencePanel(controller.snapshot());
  };
  const update = (preferences: Partial<CuuControllerPreferences>) => {
    const snapshot = controller.setPreferences(preferences);
    saveCuuPreferences(snapshot.preferences, input.storage);
    refresh();
    input.onChange?.(snapshot);
  };

  panel.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const attentionButton = target?.closest<HTMLButtonElement>("[data-cuu-attention-mode]");
    if (attentionButton) {
      update({ attention_mode: attentionButton.dataset.cuuAttentionMode as CuuControllerPreferences["attention_mode"] });
      return;
    }
    const soundButton = target?.closest<HTMLButtonElement>("[data-cuu-sound-mode]");
    if (soundButton) {
      update({ sound_mode: soundButton.dataset.cuuSoundMode as CuuControllerPreferences["sound_mode"] });
      return;
    }
    const scaleButton = target?.closest<HTMLButtonElement>("[data-cuu-pet-scale]");
    if (scaleButton) {
      update({ pet_scale_percent: Number(scaleButton.dataset.cuuPetScale) as CuuPetScalePercent });
      return;
    }
    const opacityButton = target?.closest<HTMLButtonElement>("[data-cuu-pet-opacity]");
    if (opacityButton) {
      update({ pet_opacity_percent: Number(opacityButton.dataset.cuuPetOpacity) as CuuPetOpacityPercent });
    }
  });

  panel.addEventListener("change", (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    if (!target) {
      return;
    }
    if (target.matches("[data-cuu-reduced-motion]")) {
      update({ reduced_motion: target.checked });
      return;
    }
    if (target.matches("[data-cuu-queue-limit]")) {
      update({ queue_limit: Number(target.value) });
      return;
    }
    if (target.matches("[data-cuu-pet-pass-through]")) {
      update({ pet_pass_through: target.checked });
      return;
    }
    if (target.matches("[data-cuu-pet-hide-on-hover]")) {
      update({ pet_hide_on_hover: target.checked });
    }
  });

  refresh();
  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
  });
  return { element: panel, toggle, refresh };
}

function ensureCuuPreferenceToggle(shellRoot: HTMLElement) {
  const existing = shellRoot.querySelector<HTMLButtonElement>("[data-cuu-preferences-toggle]");
  if (existing) {
    return existing;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "wh-cuu-pref-button";
  button.dataset.cuuPreferencesToggle = "true";
  button.setAttribute("aria-controls", "wh-cuu-preferences-panel");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "Cuu";
  shellRoot.appendChild(button);
  return button;
}

function ensureCuuPreferencePanel(shellRoot: HTMLElement) {
  const existing = shellRoot.querySelector<HTMLElement>("[data-cuu-preferences]");
  if (existing) {
    return existing;
  }
  const panel = document.createElement("section");
  panel.id = "wh-cuu-preferences-panel";
  panel.className = "wh-cuu-preferences";
  panel.dataset.cuuPreferences = "true";
  panel.setAttribute("aria-label", "Cuu 偏好");
  panel.hidden = true;
  shellRoot.appendChild(panel);
  return panel;
}

function defaultStorage(): CuuPreferenceStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function injectedCuuPreferenceOverrides(): Partial<CuuControllerPreferences> | undefined {
  const injected = (globalThis as { __WORKHUB_CUU_PREFERENCES__?: Partial<CuuControllerPreferences> }).__WORKHUB_CUU_PREFERENCES__;
  return injected && typeof injected === "object" ? injected : undefined;
}

function normalizePetScalePercent(value: unknown): CuuPetScalePercent {
  return petScaleOptions.includes(value as CuuPetScalePercent)
    ? value as CuuPetScalePercent
    : defaultCuuControllerPreferences().pet_scale_percent;
}

function normalizePetOpacityPercent(value: unknown): CuuPetOpacityPercent {
  return petOpacityOptions.includes(value as CuuPetOpacityPercent)
    ? value as CuuPetOpacityPercent
    : defaultCuuControllerPreferences().pet_opacity_percent;
}
