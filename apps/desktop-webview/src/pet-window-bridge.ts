import {
  cuuBehaviorStateForState,
  resolveCuuVisibleModelPack,
  type CuuCard,
  type CuuControllerPreferences,
  type CuuIdleInteraction
} from "@workhub/cuu";

export type DesktopPetWindowMode = "body_only" | "card";
export type DesktopPetScalePercent = 75 | 100 | 125 | 150;
export type DesktopPetOpacityPercent = 60 | 80 | 100;

export type DesktopPetWindowSettings = {
  scale_percent: DesktopPetScalePercent;
  opacity_percent: DesktopPetOpacityPercent;
  pass_through: boolean;
  hide_on_hover: boolean;
};

export type DesktopPetPointerSnapshot = {
  cursor_near: boolean;
  hovered: boolean;
  dragging: boolean;
  look_x: number;
  look_y: number;
  avoidance_x: number;
  avoidance_y: number;
  hover_avoidance: "none" | "soft";
  last_pointer_ms?: number;
};

export type DesktopPetPointerSmoothingOptions = {
  smoothing_alpha?: number;
  snap_threshold?: number;
};

export type DesktopPetWindowBridge = {
  setMode?: (mode: DesktopPetWindowMode) => void | Promise<void>;
  setSettings?: (settings: DesktopPetWindowSettings) => void | Promise<void>;
  startDragging?: () => void | Promise<void>;
  savePosition?: () => void | Promise<void>;
  focusMainRoute?: (route: string) => void | Promise<void>;
  showPetWindow?: () => void | Promise<void>;
  hidePetWindow?: () => void | Promise<void>;
  sampleCursorNear?: () => PetCursorSampleResult | Promise<PetCursorSampleResult>;
  // 动态穿透命中测试（仅 pet 窗口可用）：读原生光标在窗口客户区的坐标 + 切换 ignore_cursor_events。
  cursorClientPosition?: () => Promise<PetCursorClientPosition>;
  setClickThrough?: (ignore: boolean) => Promise<void>;
  diagnostics?: DesktopPetWindowBridgeDiagnostics;
};

export type PetCursorClientPosition = {
  x: number;
  y: number;
  inside: boolean;
};

export type DesktopPetWindowBridgeDiagnostics = {
  source: "workhub-pet" | "tauri-global";
  invoke_available: boolean;
  drag_available: boolean;
  missing: string[];
};

export type PetCursorSampleResult =
  | boolean
  | {
      pointer?: {
        insideWindow?: boolean;
        inside_window?: boolean;
        cursorNear?: boolean;
        cursor_near?: boolean;
        distanceToWindowPx?: number;
        distance_to_window_px?: number;
        lookX?: number;
        look_x?: number;
        lookXPercent?: number;
        look_x_percent?: number;
        lookY?: number;
        look_y?: number;
        lookYPercent?: number;
        look_y_percent?: number;
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
    hideOnHover?: boolean;
    hide_on_hover?: boolean;
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

export function desktopPetWindowModeForCard(
  card: Pick<CuuCard, "state" | "motion"> | undefined | null,
  input: { requested_model_pack_id?: string | null | undefined } = {}
): DesktopPetWindowMode {
  if (!card) {
    return "body_only";
  }
  const selection = resolveCuuVisibleModelPack({ requested_pack_id: input.requested_model_pack_id });
  const behavior = cuuBehaviorStateForState(selection.active_pack.behavior_manifest, card.motion.state);
  return behavior.window_mode;
}

export function desktopPetWindowSettingsFromPreferences(
  preferences: Pick<CuuControllerPreferences, "pet_scale_percent" | "pet_opacity_percent" | "pet_pass_through" | "pet_hide_on_hover">
): DesktopPetWindowSettings {
  return {
    scale_percent: preferences.pet_scale_percent,
    opacity_percent: preferences.pet_opacity_percent,
    pass_through: preferences.pet_pass_through,
    hide_on_hover: preferences.pet_hide_on_hover
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
              passThrough: settings.pass_through,
              hideOnHover: settings.hide_on_hover
            });
            assertPetWindowSettingsResult(value, settings);
          },
          savePosition: async () => {
            await invoke("save_pet_window_position");
          },
          focusMainRoute: async (route: string) => {
            await invoke("focus_main_route", { route });
          },
          showPetWindow: async () => {
            await invoke("show_pet_window");
          },
          hidePetWindow: async () => {
            await invoke("hide_pet_window");
          },
          sampleCursorNear: async () => {
            const value = await invoke("sample_pet_cursor_near");
            return readCursorSample(value);
          },
          cursorClientPosition: async () => {
            const value = await invoke("pet_cursor_client_position");
            return readCursorClientPosition(value);
          },
          setClickThrough: async (ignore: boolean) => {
            await invoke("set_pet_window_click_through", { ignore });
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
  let state = normalizeDesktopPetPointerSnapshot({});

  const update = (patch: Partial<DesktopPetPointerSnapshot>) => {
    state = normalizeDesktopPetPointerSnapshot({
      ...state,
      ...patch,
      last_pointer_ms: now()
    });
  };
  const interact = (interaction: CuuIdleInteraction) => {
    input.onInteraction?.(interaction, now());
  };

  const onPointerOver = (event: PointerEvent) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return;
    }
    update(pointerPatchFromEvent(root, event, { cursor_near: true, hovered: true }));
    interact("hover");
  };
  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return;
    }
    // findings[32]：拖拽中指针离开窗口也要落盘窗位——否则这次拖动的新位置丢失（pointerup 才存，但指针已离开不会触发）。
    // 必须在 update() 重置 state 之前读取 wasDragging。leave 的 cursor_near/hovered 仍为 false（与 pointerup 不同）。
    const wasDragging = state.dragging;
    update({ cursor_near: false, hovered: false, dragging: false, look_x: 0, look_y: 0, avoidance_x: 0, avoidance_y: 0, hover_avoidance: "none" });
    interact("release");
    if (wasDragging) {
      void input.bridge?.savePosition?.();
    }
  };
  const onPointerMove = (event: PointerEvent) => {
    update(pointerPatchFromEvent(root, event, { cursor_near: true }));
  };
  const onPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target.closest("[data-pet-drag-handle]") : null;
    if (!target || event.button !== 0) {
      return;
    }
    update(pointerPatchFromEvent(root, event, { cursor_near: true, hovered: true, dragging: true }));
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

export function normalizeDesktopPetPointerSnapshot(input: Partial<DesktopPetPointerSnapshot>): DesktopPetPointerSnapshot {
  const cursorNear = Boolean(input.cursor_near);
  const hovered = Boolean(input.hovered);
  const dragging = Boolean(input.dragging);
  const lookX = clampPointerAxis(input.look_x ?? 0);
  const lookY = clampPointerAxis(input.look_y ?? 0);
  const hoverAvoidance = !dragging && hovered ? input.hover_avoidance ?? "soft" : "none";
  const fallbackAvoidance = hoverAvoidance === "soft" ? avoidanceFromLook(lookX, lookY) : { x: 0, y: 0 };
  return {
    cursor_near: cursorNear,
    hovered,
    dragging,
    look_x: cursorNear || hovered ? lookX : 0,
    look_y: cursorNear || hovered ? lookY : 0,
    avoidance_x: hoverAvoidance === "soft" ? clampPointerAxis(input.avoidance_x ?? fallbackAvoidance.x) : 0,
    avoidance_y: hoverAvoidance === "soft" ? clampPointerAxis(input.avoidance_y ?? fallbackAvoidance.y) : 0,
    hover_avoidance: hoverAvoidance,
    ...(input.last_pointer_ms !== undefined ? { last_pointer_ms: input.last_pointer_ms } : {})
  };
}

export function desktopPetPointerSnapshotFromSample(
  sample: PetCursorSampleResult | undefined,
  previous: DesktopPetPointerSnapshot,
  options: DesktopPetPointerSmoothingOptions = {}
): DesktopPetPointerSnapshot {
  if (sample === undefined) {
    return normalizeDesktopPetPointerSnapshot(previous);
  }
  if (typeof sample === "boolean") {
    return normalizeDesktopPetPointerSnapshot({
      ...previous,
      cursor_near: sample
    });
  }
  const pointer = sample.pointer;
  if (!pointer) {
    return normalizeDesktopPetPointerSnapshot(previous);
  }
  const insideWindow = pointer.insideWindow ?? pointer.inside_window;
  const cursorNear = pointer.cursorNear ?? pointer.cursor_near ?? previous.cursor_near;
  const lookX = readLookAxis(pointer.lookX ?? pointer.look_x ?? pointer.lookXPercent ?? pointer.look_x_percent);
  const lookY = readLookAxis(pointer.lookY ?? pointer.look_y ?? pointer.lookYPercent ?? pointer.look_y_percent);
  if (previous.dragging || previous.hovered) {
    if (insideWindow === false && cursorNear === false) {
      return normalizeDesktopPetPointerSnapshot({
        cursor_near: false,
        hovered: false,
        dragging: false
      });
    }
    return normalizeDesktopPetPointerSnapshot({
      ...previous,
      cursor_near: cursorNear
    });
  }

  const next = normalizeDesktopPetPointerSnapshot({
    ...previous,
    cursor_near: cursorNear,
    ...(lookX !== undefined ? { look_x: lookX } : cursorNear ? {} : { look_x: 0 }),
    ...(lookY !== undefined ? { look_y: lookY } : cursorNear ? {} : { look_y: 0 })
  });
  return smoothDesktopPetPointerSnapshot(next, previous, options);
}

export function pointerPatchFromEvent(
  root: HTMLElement,
  event: PointerEvent,
  patch: Partial<DesktopPetPointerSnapshot>
): Partial<DesktopPetPointerSnapshot> {
  const rect = root.getBoundingClientRect();
  const halfWidth = Math.max(rect.width / 2, 1);
  const halfHeight = Math.max(rect.height / 2, 1);
  const lookX = clampPointerAxis((event.clientX - (rect.left + halfWidth)) / halfWidth);
  const lookY = clampPointerAxis((event.clientY - (rect.top + halfHeight)) / halfHeight);
  const dragging = Boolean(patch.dragging);
  const hovered = patch.hovered ?? true;
  const avoidance = !dragging && hovered ? avoidanceFromLook(lookX, lookY) : { x: 0, y: 0 };
  return {
    hovered,
    ...patch,
    look_x: lookX,
    look_y: lookY,
    avoidance_x: avoidance.x,
    avoidance_y: avoidance.y,
    hover_avoidance: !dragging && hovered ? "soft" : "none"
  };
}

function readCursorSample(value: unknown): PetCursorSampleResult {
  if (value === true || value === false) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const sample = value as Extract<PetCursorSampleResult, object>;
  return sample.pointer ? sample : false;
}

function readCursorClientPosition(value: unknown): PetCursorClientPosition {
  if (!value || typeof value !== "object") {
    return { x: 0, y: 0, inside: false };
  }
  const raw = value as { x?: unknown; y?: unknown; inside?: unknown };
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? raw.x : 0;
  const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? raw.y : 0;
  return { x, y, inside: raw.inside === true };
}

function readLookAxis(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return clampPointerAxis(Math.abs(value) > 1 ? value / 100 : value);
}

export function smoothDesktopPetPointerSnapshot(
  next: DesktopPetPointerSnapshot,
  previous: DesktopPetPointerSnapshot,
  options: DesktopPetPointerSmoothingOptions = {}
): DesktopPetPointerSnapshot {
  if (options.smoothing_alpha === undefined || next.hovered || next.dragging || (!next.cursor_near && !previous.cursor_near)) {
    return next;
  }
  const alpha = clampSmoothingAlpha(options.smoothing_alpha);
  const snapThreshold = Math.max(0, options.snap_threshold ?? 0.012);
  const lookX = smoothPointerAxis(previous.look_x, next.look_x, alpha, snapThreshold);
  const lookY = smoothPointerAxis(previous.look_y, next.look_y, alpha, snapThreshold);
  return normalizeDesktopPetPointerSnapshot({
    ...next,
    look_x: lookX,
    look_y: lookY
  });
}

function smoothPointerAxis(previous: number, next: number, alpha: number, snapThreshold: number) {
  const current = clampPointerAxis(previous);
  const target = clampPointerAxis(next);
  const value = current + (target - current) * alpha;
  return Math.abs(target - value) <= snapThreshold ? target : clampPointerAxis(value);
}

function clampSmoothingAlpha(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function avoidanceFromLook(lookX: number, lookY: number) {
  return {
    x: lookX === 0 ? -0.45 : -Math.sign(lookX) * Math.min(0.72, Math.abs(lookX) * 0.58 + 0.18),
    y: lookY === 0 ? -0.28 : -Math.sign(lookY) * Math.min(0.5, Math.abs(lookY) * 0.36 + 0.12)
  };
}

function clampPointerAxis(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, value));
}

function assertPetWindowModeResult(value: unknown, expectedMode: DesktopPetWindowMode) {
  if (!value || typeof value !== "object") {
    throw new Error(`Cuu pet window did not confirm ${expectedMode} mode.`);
  }
  const result = value as PetWindowModeCommandResult;
  const mode = result.placement?.mode;
  const size = result.placement?.size;
  const minWidth = expectedMode === "card" ? 390 : 195;
  const minHeight = expectedMode === "card" ? 540 : 255;
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
  const hideOnHover = settings?.hideOnHover ?? settings?.hide_on_hover;
  if (
    scale !== expected.scale_percent ||
    opacity !== expected.opacity_percent ||
    passThrough !== expected.pass_through ||
    hideOnHover !== expected.hide_on_hover
  ) {
    throw new Error("Cuu pet window returned an invalid settings plan.");
  }
}
