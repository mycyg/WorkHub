import { cuuStates, type CuuState } from "@workhub/contracts";
import type { CuuIdleMicroAction } from "./idle-scheduler.js";

export type CuuMotionEmphasis = "calm" | "busy" | "urgent" | "celebratory";
export type CuuBehaviorCoverage = "full" | "partial";
export type CuuBehaviorBubbleMode = "none" | "tip" | "card";
export type CuuBehaviorWindowMode = "body_only" | "card";
export type CuuBehaviorPhase = "enter" | "loop" | "exit" | "idle_random";
export type CuuBehaviorModelPackId =
  | "cuu-hijiki-live2d-cubism2"
  | "cuu-tororo-live2d-cubism2";

export type CuuSpriteState =
  | "idle_breathe"
  | "thinking_tail"
  | "asking_approval_bounce"
  | "carrying_document_step"
  | "searching_evidence_peek"
  | "syncing_files_spin"
  | "worried_ears"
  | "revision_requested_nod"
  | "celebrating_jump"
  | "offline_sleep";

export type CuuMotionClipState = CuuSpriteState | CuuIdleMicroAction;

export type CuuMotionHint = {
  state: CuuState;
  sprite_state: CuuSpriteState;
  emphasis: CuuMotionEmphasis;
  loop: boolean;
  reduced_motion_fallback: string;
};

export type CuuMotionSlot = {
  motion: CuuMotionClipState;
  renderer_state: string;
  expression?: string;
  min_duration_ms?: number;
  max_duration_ms?: number;
  interruptible: boolean;
  loop: boolean;
  coverage: CuuBehaviorCoverage;
};

export type CuuBehaviorState = {
  state: CuuState;
  enter?: CuuMotionSlot;
  loop: CuuMotionSlot[];
  exit?: CuuMotionSlot;
  bubble_mode: CuuBehaviorBubbleMode;
  window_mode: CuuBehaviorWindowMode;
  priority: number;
  coverage: CuuBehaviorCoverage;
};

export type CuuIdleRandomMotionSlot = CuuMotionSlot & {
  action: CuuIdleMicroAction;
  probability: number;
  cooldown_ms: number;
};

export type CuuBehaviorManifest = {
  version: 1;
  model_pack_id: CuuBehaviorModelPackId;
  states: Record<CuuState, CuuBehaviorState>;
  idle_random: CuuIdleRandomMotionSlot[];
};

const motionByState: Record<CuuState, Omit<CuuMotionHint, "state">> = {
  idle: {
    sprite_state: "idle_breathe",
    emphasis: "calm",
    loop: true,
    reduced_motion_fallback: "Cuu 安静待命。"
  },
  thinking: {
    sprite_state: "thinking_tail",
    emphasis: "busy",
    loop: true,
    reduced_motion_fallback: "Cuu 正在思考。"
  },
  asking_approval: {
    sprite_state: "asking_approval_bounce",
    emphasis: "urgent",
    loop: true,
    reduced_motion_fallback: "Cuu 在等你点选。"
  },
  carrying_document: {
    sprite_state: "carrying_document_step",
    emphasis: "busy",
    loop: true,
    reduced_motion_fallback: "Cuu 叼来了变更申请。"
  },
  searching_evidence: {
    sprite_state: "searching_evidence_peek",
    emphasis: "busy",
    loop: true,
    reduced_motion_fallback: "Cuu 正在找证据。"
  },
  syncing_files: {
    sprite_state: "syncing_files_spin",
    emphasis: "busy",
    loop: true,
    reduced_motion_fallback: "Cuu 正在同步文件。"
  },
  worried: {
    sprite_state: "worried_ears",
    emphasis: "urgent",
    loop: true,
    reduced_motion_fallback: "Cuu 提醒你有风险。"
  },
  revision_requested: {
    sprite_state: "revision_requested_nod",
    emphasis: "busy",
    loop: false,
    reduced_motion_fallback: "Cuu 收到修改意见。"
  },
  celebrating: {
    sprite_state: "celebrating_jump",
    emphasis: "celebratory",
    loop: false,
    reduced_motion_fallback: "Cuu 完成了一次交付。"
  },
  offline: {
    sprite_state: "offline_sleep",
    emphasis: "calm",
    loop: true,
    reduced_motion_fallback: "Cuu 离线休息中。"
  }
};

export function cuuMotionForState(state: CuuState): CuuMotionHint {
  return { state, ...motionByState[state] };
}

export function allCuuMotionHints(): CuuMotionHint[] {
  return cuuStates.map((state) => cuuMotionForState(state));
}

export function createCuuBehaviorManifest(input: {
  model_pack_id: CuuBehaviorModelPackId;
  coverage?: CuuBehaviorCoverage;
}): CuuBehaviorManifest {
  const coverage = input.coverage ?? "partial";
  const states = Object.fromEntries(cuuStates.map((state) => [
    state,
    createCuuBehaviorState(state, coverage)
  ])) as Record<CuuState, CuuBehaviorState>;
  return {
    version: 1,
    model_pack_id: input.model_pack_id,
    states,
    idle_random: createCuuIdleRandomMotionSlots(coverage)
  };
}

export function cuuBehaviorStateForState(manifest: CuuBehaviorManifest, state: CuuState): CuuBehaviorState {
  return manifest.states[state];
}

export function cuuDefaultLive2DRendererStateForClip(state: CuuMotionClipState): string {
  if (state === "celebrating_jump" || state === "wave_hello") {
    return "mtn/06.mtn";
  }
  if (state === "asking_approval_bounce" || state === "tap_bubble") {
    return "mtn/01.mtn";
  }
  if (state === "thinking_tail" || state === "searching_evidence_peek" || state === "syncing_files_spin") {
    return "mtn/04.mtn";
  }
  if (state === "worried_ears" || state === "offline_sleep" || state === "sleeping_curl") {
    return "mtn/08.mtn";
  }
  if (state === "drag_hold") {
    return "mtn/05.mtn";
  }
  return "mtn/00_idle.mtn";
}

export function cuuDefaultMotionDurationForClip(state: CuuMotionClipState): number {
  if (state === "celebrating_jump" || state === "wave_hello") {
    return 980;
  }
  if (state === "asking_approval_bounce" || state === "tap_bubble") {
    return 1200;
  }
  if (state === "offline_sleep" || state === "sleeping_curl") {
    return 3200;
  }
  return 2200;
}

export function cuuMotionSlotForClip(
  motion: CuuMotionClipState,
  input: {
    coverage?: CuuBehaviorCoverage;
    interruptible?: boolean;
    loop?: boolean;
    expression?: string;
    min_duration_ms?: number;
    max_duration_ms?: number;
  } = {}
): CuuMotionSlot {
  const duration = cuuDefaultMotionDurationForClip(motion);
  return {
    motion,
    renderer_state: cuuDefaultLive2DRendererStateForClip(motion),
    ...(input.expression ? { expression: input.expression } : {}),
    min_duration_ms: input.min_duration_ms ?? duration,
    max_duration_ms: input.max_duration_ms ?? Math.max(duration, duration * 2),
    interruptible: input.interruptible ?? true,
    loop: input.loop ?? defaultLoopForMotionClip(motion),
    coverage: input.coverage ?? "partial"
  };
}

function createCuuBehaviorState(state: CuuState, coverage: CuuBehaviorCoverage): CuuBehaviorState {
  const hint = cuuMotionForState(state);
  const loopSlot = cuuMotionSlotForClip(hint.sprite_state, {
    coverage,
    loop: hint.loop,
    interruptible: state !== "asking_approval"
  });
  const enter = state === "idle"
    ? undefined
    : cuuMotionSlotForClip(enterMotionForState(state), {
        coverage,
        loop: false,
        interruptible: true,
        max_duration_ms: 1600
      });
  const exit = state === "idle"
    ? undefined
    : cuuMotionSlotForClip("idle_breathe", {
        coverage,
        loop: true,
        interruptible: true,
        min_duration_ms: 900,
        max_duration_ms: 1800
      });
  return {
    state,
    ...(enter ? { enter } : {}),
    loop: [loopSlot],
    ...(exit ? { exit } : {}),
    bubble_mode: bubbleModeForState(state),
    window_mode: windowModeForState(state),
    priority: priorityForState(state),
    coverage
  };
}

function createCuuIdleRandomMotionSlots(coverage: CuuBehaviorCoverage): CuuIdleRandomMotionSlot[] {
  return [
    {
      ...cuuMotionSlotForClip("idle_breathe", { coverage, loop: true }),
      action: "idle_breathe",
      probability: 0.36,
      cooldown_ms: 2800
    },
    {
      ...cuuMotionSlotForClip("idle_blink", { coverage, loop: false, max_duration_ms: 900 }),
      action: "idle_blink",
      probability: 0.22,
      cooldown_ms: 1200
    },
    {
      ...cuuMotionSlotForClip("idle_tail_sway", { coverage, loop: true }),
      action: "idle_tail_sway",
      probability: 0.28,
      cooldown_ms: 2200
    },
    {
      ...cuuMotionSlotForClip("look_at_mouse", { coverage, loop: false }),
      action: "look_at_mouse",
      probability: 0.08,
      cooldown_ms: 3200
    },
    {
      ...cuuMotionSlotForClip("wave_hello", { coverage, loop: false }),
      action: "wave_hello",
      probability: 0.06,
      cooldown_ms: 5200
    }
  ];
}

function enterMotionForState(state: CuuState): CuuMotionClipState {
  if (state === "celebrating") {
    return "wave_hello";
  }
  if (state === "offline") {
    return "worried_ears";
  }
  return cuuMotionForState(state).sprite_state;
}

function bubbleModeForState(state: CuuState): CuuBehaviorBubbleMode {
  switch (state) {
    case "idle":
      return "none";
    case "thinking":
    case "celebrating":
      return "tip";
    case "asking_approval":
    case "carrying_document":
    case "searching_evidence":
    case "syncing_files":
    case "worried":
    case "revision_requested":
    case "offline":
      return "card";
  }
}

function windowModeForState(state: CuuState): CuuBehaviorWindowMode {
  return state === "idle" ? "body_only" : "card";
}

function priorityForState(state: CuuState): number {
  switch (state) {
    case "idle":
      return 0;
    case "thinking":
      return 20;
    case "carrying_document":
    case "searching_evidence":
    case "syncing_files":
      return 40;
    case "offline":
      return 50;
    case "celebrating":
      return 60;
    case "worried":
    case "revision_requested":
      return 70;
    case "asking_approval":
      return 90;
  }
}

function defaultLoopForMotionClip(motion: CuuMotionClipState): boolean {
  return motion !== "idle_blink" &&
    motion !== "tap_bubble" &&
    motion !== "wave_hello" &&
    motion !== "celebrating_jump";
}
