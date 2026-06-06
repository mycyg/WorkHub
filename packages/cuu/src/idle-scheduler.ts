export type CuuIdleMicroAction =
  | "idle_breathe"
  | "idle_blink"
  | "idle_tail_sway"
  | "look_at_mouse"
  | "sleeping_curl"
  | "wake_up"
  | "drag_hold"
  | "tap_bubble"
  | "wave_hello";

export type CuuIdleInteraction = "hover" | "tap" | "drag" | "release";

export type CuuIdleMicroActionSpec = {
  loop: boolean;
  interruptible: boolean;
  priority: "idle" | "normal";
  suggested_fps: number;
};

export type CuuIdleSchedulerPolicy = {
  breathe_interval_ms: readonly [number, number];
  blink_interval_ms: readonly [number, number];
  tail_interval_ms: readonly [number, number];
  look_interval_ms: readonly [number, number];
  sleep_after_ms: number;
  sleeping_loop_interval_ms: number;
};

export type CuuIdleSchedulerSnapshot = {
  asleep: boolean;
  last_event_ms: number;
  last_interaction_ms: number;
  last_action_ms: number;
  next_breathe_ms: number;
  next_blink_ms: number;
  next_tail_ms: number;
  next_look_ms: number;
  next_sleep_loop_ms: number;
  last_action?: CuuIdleMicroAction;
};

export type CuuIdleSchedulerTickInput = {
  now_ms: number;
  active_card?: boolean;
  cursor_near?: boolean;
  interaction?: CuuIdleInteraction;
  reduced_motion?: boolean;
};

export type CuuIdleSchedulerDecisionReason =
  | "active_card_controls_motion"
  | "reduced_motion_static"
  | "dragging"
  | "tap_feedback"
  | "drag_released"
  | "hover_wakeup"
  | "hover_hello"
  | "sleep_timeout"
  | "sleeping_loop"
  | "cursor_near"
  | "blink_due"
  | "tail_due"
  | "breathe_due"
  | "not_due";

export type CuuIdleSchedulerDecision = {
  action?: CuuIdleMicroAction;
  reason: CuuIdleSchedulerDecisionReason;
  next_due_ms: number;
  snapshot: CuuIdleSchedulerSnapshot;
};

export type CuuIdleScheduler = {
  snapshot: () => CuuIdleSchedulerSnapshot;
  observeWorkEvent: (now_ms: number) => CuuIdleSchedulerSnapshot;
  observeInteraction: (interaction: CuuIdleInteraction, now_ms: number) => CuuIdleSchedulerDecision;
  tick: (input: CuuIdleSchedulerTickInput) => CuuIdleSchedulerDecision;
};

export const cuuIdleMicroActionSpecs: Record<CuuIdleMicroAction, CuuIdleMicroActionSpec> = {
  idle_breathe: { loop: true, interruptible: true, priority: "idle", suggested_fps: 8 },
  idle_blink: { loop: false, interruptible: true, priority: "idle", suggested_fps: 10 },
  idle_tail_sway: { loop: true, interruptible: true, priority: "idle", suggested_fps: 8 },
  look_at_mouse: { loop: false, interruptible: true, priority: "idle", suggested_fps: 10 },
  sleeping_curl: { loop: true, interruptible: true, priority: "idle", suggested_fps: 6 },
  wake_up: { loop: false, interruptible: true, priority: "normal", suggested_fps: 10 },
  drag_hold: { loop: true, interruptible: true, priority: "normal", suggested_fps: 8 },
  tap_bubble: { loop: false, interruptible: true, priority: "normal", suggested_fps: 12 },
  wave_hello: { loop: false, interruptible: true, priority: "normal", suggested_fps: 10 }
};

export const defaultCuuIdleSchedulerPolicy: CuuIdleSchedulerPolicy = {
  breathe_interval_ms: [3000, 6000],
  blink_interval_ms: [8000, 20000],
  tail_interval_ms: [3000, 6000],
  look_interval_ms: [20000, 45000],
  sleep_after_ms: 5 * 60 * 1000,
  sleeping_loop_interval_ms: 12000
};

export function createCuuIdleScheduler(input: {
  now_ms?: number;
  policy?: Partial<CuuIdleSchedulerPolicy>;
  random?: () => number;
} = {}): CuuIdleScheduler {
  const random = input.random ?? Math.random;
  const policy = normalizePolicy(input.policy);
  const now = input.now_ms ?? 0;
  let state: CuuIdleSchedulerSnapshot = {
    asleep: false,
    last_event_ms: now,
    last_interaction_ms: now,
    last_action_ms: now,
    next_breathe_ms: now + interval(policy.breathe_interval_ms, random),
    next_blink_ms: now + interval(policy.blink_interval_ms, random),
    next_tail_ms: now + interval(policy.tail_interval_ms, random),
    next_look_ms: now + interval(policy.look_interval_ms, random),
    next_sleep_loop_ms: now + policy.sleeping_loop_interval_ms,
    last_action: "idle_breathe"
  };

  const snapshot = () => ({ ...state });

  const decide = (
    reason: CuuIdleSchedulerDecisionReason,
    now_ms: number,
    action?: CuuIdleMicroAction
  ): CuuIdleSchedulerDecision => {
    if (action) {
      state = scheduleAfter(action, now_ms, state, policy, random);
    }
    return {
      ...(action ? { action } : {}),
      reason,
      next_due_ms: nextDue(state),
      snapshot: snapshot()
    };
  };

  const wake = (now_ms: number) => {
    state = {
      ...state,
      asleep: false,
      last_interaction_ms: now_ms,
      next_sleep_loop_ms: now_ms + policy.sleeping_loop_interval_ms
    };
  };

  const tick = (inputTick: CuuIdleSchedulerTickInput): CuuIdleSchedulerDecision => {
    const now_ms = inputTick.now_ms;
    if (inputTick.active_card) {
      return decide("active_card_controls_motion", now_ms);
    }
    if (inputTick.reduced_motion) {
      return decide("reduced_motion_static", now_ms);
    }
    if (inputTick.interaction === "drag") {
      state = { ...state, last_interaction_ms: now_ms };
      return decide("dragging", now_ms, "drag_hold");
    }
    if (inputTick.interaction === "release") {
      state = { ...state, last_interaction_ms: now_ms };
      return decide("drag_released", now_ms);
    }
    if (state.asleep) {
      if (inputTick.interaction === "hover" || inputTick.interaction === "tap" || inputTick.cursor_near) {
        wake(now_ms);
        return decide("hover_wakeup", now_ms, "wake_up");
      }
      if (now_ms >= state.next_sleep_loop_ms) {
        return decide("sleeping_loop", now_ms, "sleeping_curl");
      }
      return decide("not_due", now_ms);
    }
    if (inputTick.interaction === "tap") {
      state = { ...state, last_interaction_ms: now_ms };
      return decide("tap_feedback", now_ms, "tap_bubble");
    }
    if (inputTick.interaction === "hover") {
      state = { ...state, last_interaction_ms: now_ms };
      return decide("hover_hello", now_ms, "wave_hello");
    }
    if (now_ms - Math.max(state.last_event_ms, state.last_interaction_ms) >= policy.sleep_after_ms) {
      state = {
        ...state,
        asleep: true,
        next_sleep_loop_ms: now_ms + policy.sleeping_loop_interval_ms
      };
      return decide("sleep_timeout", now_ms, "sleeping_curl");
    }
    if (inputTick.cursor_near && now_ms >= state.next_look_ms) {
      return decide("cursor_near", now_ms, "look_at_mouse");
    }
    if (now_ms >= state.next_blink_ms) {
      return decide("blink_due", now_ms, "idle_blink");
    }
    if (now_ms >= state.next_tail_ms) {
      return decide("tail_due", now_ms, "idle_tail_sway");
    }
    if (now_ms >= state.next_breathe_ms) {
      return decide("breathe_due", now_ms, "idle_breathe");
    }
    return decide("not_due", now_ms);
  };

  return {
    snapshot,
    observeWorkEvent(now_ms) {
      state = {
        ...state,
        asleep: false,
        last_event_ms: now_ms,
        next_sleep_loop_ms: now_ms + policy.sleeping_loop_interval_ms
      };
      return snapshot();
    },
    observeInteraction(interaction, now_ms) {
      return tick({ now_ms, interaction });
    },
    tick
  };
}

function normalizePolicy(input: Partial<CuuIdleSchedulerPolicy> | undefined): CuuIdleSchedulerPolicy {
  return {
    breathe_interval_ms: input?.breathe_interval_ms ?? defaultCuuIdleSchedulerPolicy.breathe_interval_ms,
    blink_interval_ms: input?.blink_interval_ms ?? defaultCuuIdleSchedulerPolicy.blink_interval_ms,
    tail_interval_ms: input?.tail_interval_ms ?? defaultCuuIdleSchedulerPolicy.tail_interval_ms,
    look_interval_ms: input?.look_interval_ms ?? defaultCuuIdleSchedulerPolicy.look_interval_ms,
    sleep_after_ms: input?.sleep_after_ms ?? defaultCuuIdleSchedulerPolicy.sleep_after_ms,
    sleeping_loop_interval_ms: input?.sleeping_loop_interval_ms ?? defaultCuuIdleSchedulerPolicy.sleeping_loop_interval_ms
  };
}

function interval(range: readonly [number, number], random: () => number) {
  const min = Math.max(0, range[0]);
  const max = Math.max(min, range[1]);
  return Math.round(min + (max - min) * clamp01(random()));
}

function scheduleAfter(
  action: CuuIdleMicroAction,
  now_ms: number,
  state: CuuIdleSchedulerSnapshot,
  policy: CuuIdleSchedulerPolicy,
  random: () => number
): CuuIdleSchedulerSnapshot {
  const nextState: CuuIdleSchedulerSnapshot = {
    ...state,
    last_action: action,
    last_action_ms: now_ms
  };
  switch (action) {
    case "idle_breathe":
      return { ...nextState, next_breathe_ms: now_ms + interval(policy.breathe_interval_ms, random) };
    case "idle_blink":
      return { ...nextState, next_blink_ms: now_ms + interval(policy.blink_interval_ms, random) };
    case "idle_tail_sway":
      return { ...nextState, next_tail_ms: now_ms + interval(policy.tail_interval_ms, random) };
    case "look_at_mouse":
      return { ...nextState, next_look_ms: now_ms + interval(policy.look_interval_ms, random) };
    case "sleeping_curl":
      return { ...nextState, next_sleep_loop_ms: now_ms + policy.sleeping_loop_interval_ms };
    case "wake_up":
    case "drag_hold":
    case "tap_bubble":
    case "wave_hello":
      return {
        ...nextState,
        next_breathe_ms: now_ms + interval(policy.breathe_interval_ms, random)
      };
  }
}

function nextDue(state: CuuIdleSchedulerSnapshot) {
  if (state.asleep) {
    return state.next_sleep_loop_ms;
  }
  return Math.min(state.next_breathe_ms, state.next_blink_ms, state.next_tail_ms, state.next_look_ms);
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}
