import type { CuuControllerPreferences, CuuIdleInteraction } from "@workhub/cuu";

export type DesktopPetWindowMode = "body_only" | "card";
export type DesktopPetScalePercent = 75 | 100 | 125 | 150;
export type DesktopPetOpacityPercent = 60 | 80 | 100;

export type DesktopPetWindowSettings = {
  scale_percent: DesktopPetScalePercent;
  opacity_percent: DesktopPetOpacityPercent;
  pass_through: boolean;
};

export type DesktopPetPointerSnapshot = {
  cursor_near: boolean;
  hovered: boolean;
  dragging: boolean;
  last_pointer_ms?: number;
};

export type DesktopPetWindowBridge = {
  setMode?: (mode: DesktopPetWindowMode) => void | Promise<void>;
  setSettings?: (settings: DesktopPetWindowSettings) => void | Promise<void>;
  startDragging?: () => void | Promise<void>;
  savePosition?: () => void | Promise<void>;
  sampleCursorNear?: () => boolean | Promise<boolean>;
  diagnostics?: DesktopPetWindowBridgeDiagnostics;
};

export type DesktopPetWindowBridgeDiagnostics = {
  source: "workhub-pet" | "tauri-global";
  invoke_available: boolean;
  drag_available: boolean;
  missing: string[];
};

type PetCursorSampleResult =
  | boolean
  | {
      pointer?: {
        cursorNear?: boolean;
        cursor_near?: boolean;
      };
    };

type PetWindowModeCommandResult = {
  placement?: {
    mode?: DesktopPetWindowMode;
    size?: {
      width?: number;
      height?: number;
    };
  };
};

type PetWindowSettingsCommandResult = {
  settings?: {
    scalePercent?: number;
    scale_percent?: number;
    opacityPercent?: number;
    opacity_percent?: number;
    passThrough?: boolean;
    pass_through?: boolean;
  };
};

export type DesktopPetPointerSensor = {
  snapshot: () => DesktopPetPointerSnapshot;
  dispose: () => void;
};

type TauriWindowHandle = {
  label?: string;
  startDragging?: () => void | Promise<void>;
};

type TauriGlobal = {
  __WORKHUB_PET__?: DesktopPetWindowBridge;
  __WORKHUB_SURFACE__?: string;
  location?: {
    pathname?: string;
  };
  __TAURI__?: {
    invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    core?: {
      invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    window?: {
      getCurrentWindow?: () => TauriWindowHandle;
      appWindow?: TauriWindowHandle;
    };
    webviewWindow?: {
      getCurrentWebviewWindow?: () => TauriWindowHandle;
    };
  };
};

export function desktopPetWindowModeForCard(card: unknown): DesktopPetWindowMode {
  return card ? "card" : "body_only";
}

export function desktopPetWindowSettingsFromPreferences(
  preferences: Pick<CuuControllerPreferences, "pet_scale_percent" | "pet_opacity_percent" | "pet_pass_through">
): DesktopPetWindowSettings {
  return {
    scale_percent: preferences.pet_scale_percent,
    opacity_percent: preferences.pet_opacity_percent,
    pass_through: preferences.pet_pass_through
  };
}

export function resolveDesktopPetWindowBridge(input: unknown = globalThis): DesktopPetWindowBridge | undefined {
  const target = input as TauriGlobal;
  if (target.__WORKHUB_PET__) {
    return target.__WORKHUB_PET__;
  }

  const invoke = target.__TAURI__?.core?.invoke ?? target.__TAURI__?.invoke;
  const currentWindow =
    target.__TAURI__?.window?.getCurrentWindow?.() ??
    target.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.() ??
    target.__TAURI__?.window?.appWindow;
  const injectedPetSurface = target.__WORKHUB_SURFACE__ === "pet" && target.location?.pathname !== "/pet.html";
  const isPetTauriWindow = currentWindow?.label === "pet";
  if (!invoke && !currentWindow?.startDragging && !injectedPetSurface && !isPetTauriWindow) {
    return undefined;
  }

  const diagnostics: DesktopPetWindowBridgeDiagnostics = {
    source: "tauri-global",
    invoke_available: Boolean(invoke),
    drag_available: Boolean(currentWindow?.startDragging),
    missing: [
      ...(invoke ? [] : ["__TAURI__.core.invoke"]),
      ...(currentWindow?.startDragging ? [] : ["currentWindow.startDragging"])
    ]
  };

  return {
    diagnostics,
    ...(currentWindow?.startDragging
      ? {
          startDragging: () => currentWindow.startDragging?.()
        }
      : invoke
        ? {
            startDragging: async () => {
              await invoke("start_pet_window_drag");
            }
          }
      : {}),
    ...(invoke
      ? {
          setMode: async (mode: DesktopPetWindowMode) => {
            const value = await invoke("set_pet_window_mode", { mode });
            assertPetWindowModeResult(value, mode);
          },
          setSettings: async (settings: DesktopPetWindowSettings) => {
            const value = await invoke("set_pet_window_settings", {
              scalePercent: settings.scale_percent,
              opacityPercent: settings.opacity_percent,
              passThrough: settings.pass_through
            });
            assertPetWindowSettingsResult(value, settings);
          },
          savePosition: async () => {
            await invoke("save_pet_window_position");
          },
          sampleCursorNear: async () => {
            const value = await invoke("sample_pet_cursor_near");
            return readCursorNear(value);
          }
        }
      : {
          setMode: async (mode: DesktopPetWindowMode) => {
            throw new Error(`Cannot switch Cuu pet window to ${mode}: Tauri invoke bridge is unavailable.`);
          },
          setSettings: async () => {
            throw new Error("Cannot update Cuu pet window settings: Tauri invoke bridge is unavailable.");
          }
        })
  };
}

export function createDesktopPetPointerSensor(
  root: HTMLElement,
  input: {
    bridge?: DesktopPetWindowBridge | undefined;
    now?: () => number;
    onInteraction?: (interaction: CuuIdleInteraction, nowMs: number) => void;
  } = {}
): DesktopPetPointerSensor {
  const now = input.now ?? Date.now;
  let state: DesktopPetPointerSnapshot = {
    cursor_near: false,
    hovered: false,
    dragging: false
  };

  const update = (patch: Partial<DesktopPetPointerSnapshot>) => {
    state = {
      ...state,
      ...patch,
      last_pointer_ms: now()
    };
  };
  const interact = (interaction: CuuIdleInteraction) => {
    input.onInteraction?.(interaction, now());
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return;
    }
    update({ cursor_near: true, hovered: true });
    interact("hover");
  };
  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return;
    }
    update({ cursor_near: false, hovered: false, dragging: false });
    interact("release");
  };
  const onPointerMove = () => {
    update({ cursor_near: true });
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target.closest("[data-pet-drag-handle]") : null;
    if (!target || event.button !== 0) {
      return;
    }
    update({ cursor_near: true, hovered: true, dragging: true });
    interact("drag");
    void input.bridge?.startDragging?.();
  };
  const onPointerUp = () => {
    if (!state.dragging) {
      return;
    }
    update({ dragging: false, cursor_near: true, hovered: true });
    interact("release");
    void input.bridge?.savePosition?.();
  };

  root.addEventListener("pointerover", onPointerOver);
  root.addEventListener("pointerout", onPointerOut);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);

  return {
    snapshot() {
      return { ...state };
    },
    dispose() {
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
    }
  };
}

function readCursorNear(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const sample = value as Extract<PetCursorSampleResult, object>;
  return sample?.pointer?.cursorNear === true || sample?.pointer?.cursor_near === true;
}

function assertPetWindowModeResult(value: unknown, expectedMode: DesktopPetWindowMode) {
  if (!value || typeof value !== "object") {
    throw new Error(`Cuu pet window did not confirm ${expectedMode} mode.`);
  }
  const result = value as PetWindowModeCommandResult;
  const mode = result.placement?.mode;
  const size = result.placement?.size;
  const minWidth = expectedMode === "card" ? 360 : 160;
  const minHeight = expectedMode === "card" ? 520 : 180;
  if (mode !== expectedMode || typeof size?.width !== "number" || typeof size?.height !== "number" || size.width < minWidth || size.height < minHeight) {
    throw new Error(`Cuu pet window returned an invalid ${expectedMode} placement plan.`);
  }
}

function assertPetWindowSettingsResult(value: unknown, expected: DesktopPetWindowSettings) {
  if (!value || typeof value !== "object") {
    throw new Error("Cuu pet window did not confirm settings.");
  }
  const result = value as PetWindowSettingsCommandResult;
  const settings = result.settings;
  const scale = settings?.scalePercent ?? settings?.scale_percent;
  const opacity = settings?.opacityPercent ?? settings?.opacity_percent;
  const passThrough = settings?.passThrough ?? settings?.pass_through;
  if (scale !== expected.scale_percent || opacity !== expected.opacity_percent || passThrough !== expected.pass_through) {
    throw new Error("Cuu pet window returned an invalid settings plan.");
  }
}
