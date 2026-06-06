import type { CuuIdleInteraction } from "@workhub/cuu";

export type DesktopPetWindowMode = "body_only" | "card";

export type DesktopPetPointerSnapshot = {
  cursor_near: boolean;
  hovered: boolean;
  dragging: boolean;
  last_pointer_ms?: number;
};

export type DesktopPetWindowBridge = {
  setMode?: (mode: DesktopPetWindowMode) => void | Promise<void>;
  startDragging?: () => void | Promise<void>;
  savePosition?: () => void | Promise<void>;
  sampleCursorNear?: () => boolean | Promise<boolean>;
};

type PetCursorSampleResult =
  | boolean
  | {
      pointer?: {
        cursorNear?: boolean;
        cursor_near?: boolean;
      };
    };

export type DesktopPetPointerSensor = {
  snapshot: () => DesktopPetPointerSnapshot;
  dispose: () => void;
};

type TauriWindowHandle = {
  startDragging?: () => void | Promise<void>;
};

type TauriGlobal = {
  __WORKHUB_PET__?: DesktopPetWindowBridge;
  __TAURI__?: {
    core?: {
      invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    window?: {
      getCurrentWindow?: () => TauriWindowHandle;
      appWindow?: TauriWindowHandle;
    };
  };
};

export function desktopPetWindowModeForCard(card: unknown): DesktopPetWindowMode {
  return card ? "card" : "body_only";
}

export function resolveDesktopPetWindowBridge(input: unknown = globalThis): DesktopPetWindowBridge | undefined {
  const target = input as TauriGlobal;
  if (target.__WORKHUB_PET__) {
    return target.__WORKHUB_PET__;
  }

  const invoke = target.__TAURI__?.core?.invoke;
  const currentWindow = target.__TAURI__?.window?.getCurrentWindow?.() ?? target.__TAURI__?.window?.appWindow;
  if (!invoke && !currentWindow?.startDragging) {
    return undefined;
  }

  return {
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
            await invoke("set_pet_window_mode", { mode });
          },
          savePosition: async () => {
            await invoke("save_pet_window_position");
          },
          sampleCursorNear: async () => {
            const value = await invoke("sample_pet_cursor_near");
            return readCursorNear(value);
          }
        }
      : {})
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
