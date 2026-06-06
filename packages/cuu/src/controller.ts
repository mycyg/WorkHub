import type { CuuState } from "@workhub/contracts";

import type { CuuCard } from "./cards.js";

export type CuuAttentionMode = "normal" | "quiet" | "do_not_disturb";
export type CuuSoundMode = "on" | "muted";

export type CuuControllerPreferences = {
  attention_mode: CuuAttentionMode;
  sound_mode: CuuSoundMode;
  reduced_motion: boolean;
  queue_limit: number;
};

export type CuuPresentationSurface = "notice" | "badge" | "none";

export type CuuPresentationInstruction = {
  surface: CuuPresentationSurface;
  timeout_ms: number;
  play_motion: boolean;
  play_sound: boolean;
  os_notification: boolean;
};

export type CuuControllerDecisionOutcome = "show" | "replace" | "queue" | "badge" | "drop" | "idle";

export type CuuControllerDecisionReason =
  | "show_now"
  | "replace_lower_priority"
  | "queued_active_card"
  | "quiet_mode_badge"
  | "do_not_disturb_badge"
  | "low_priority_badge"
  | "duplicate_dropped"
  | "queue_overflow_dropped"
  | "dismissed_current"
  | "removed_queued_card"
  | "nothing_active";

export type CuuControllerSnapshot = {
  active_card?: CuuCard;
  queue: CuuCard[];
  badge_count: number;
  preferences: CuuControllerPreferences;
  idle_state: CuuState;
};

export type CuuControllerDecision = {
  outcome: CuuControllerDecisionOutcome;
  reason: CuuControllerDecisionReason;
  presentation: CuuPresentationInstruction;
  snapshot: CuuControllerSnapshot;
  card?: CuuCard;
  replaced_card?: CuuCard;
  dropped_card?: CuuCard;
};

export type CuuController = {
  snapshot: () => CuuControllerSnapshot;
  enqueue: (card: CuuCard) => CuuControllerDecision;
  dismiss: (cardId?: string) => CuuControllerDecision;
  setPreferences: (input: Partial<CuuControllerPreferences>) => CuuControllerSnapshot;
  clearBadges: () => CuuControllerSnapshot;
};

const defaultPreferences: CuuControllerPreferences = {
  attention_mode: "normal",
  sound_mode: "on",
  reduced_motion: false,
  queue_limit: 5
};

const priorityRank: Record<CuuCard["priority"], number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3
};

export function defaultCuuControllerPreferences(): CuuControllerPreferences {
  return { ...defaultPreferences };
}

export function createCuuController(input: {
  preferences?: Partial<CuuControllerPreferences>;
  idle_state?: CuuState;
} = {}): CuuController {
  let preferences = normalizePreferences(input.preferences);
  const idleState = input.idle_state ?? "idle";
  let activeCard: CuuCard | undefined;
  let badgeCount = 0;
  const queue: CuuCard[] = [];

  const snapshot = (): CuuControllerSnapshot => ({
    ...(activeCard ? { active_card: activeCard } : {}),
    queue: [...queue],
    badge_count: badgeCount,
    preferences: { ...preferences },
    idle_state: idleState
  });

  const decision = (
    outcome: CuuControllerDecisionOutcome,
    reason: CuuControllerDecisionReason,
    inputDecision: {
      card?: CuuCard;
      replaced_card?: CuuCard;
      dropped_card?: CuuCard;
      surface?: CuuPresentationSurface;
    } = {}
  ): CuuControllerDecision => {
    const surface = inputDecision.surface ?? (outcome === "show" || outcome === "replace" ? "notice" : outcome === "badge" ? "badge" : "none");
    return {
      outcome,
      reason,
      presentation: presentationFor(inputDecision.card, surface, preferences),
      snapshot: snapshot(),
      ...(inputDecision.card ? { card: inputDecision.card } : {}),
      ...(inputDecision.replaced_card ? { replaced_card: inputDecision.replaced_card } : {}),
      ...(inputDecision.dropped_card ? { dropped_card: inputDecision.dropped_card } : {})
    };
  };

  const enqueue = (card: CuuCard): CuuControllerDecision => {
    if (hasCard(card.id, activeCard, queue)) {
      return decision("drop", "duplicate_dropped", { card });
    }

    const badgeReason = badgeReasonFor(card, preferences);
    if (badgeReason) {
      badgeCount += 1;
      return decision("badge", badgeReason, { card, surface: "badge" });
    }

    if (!activeCard) {
      activeCard = card;
      return decision("show", "show_now", { card });
    }

    if (shouldReplaceActive(card, activeCard)) {
      const replacedCard = activeCard;
      activeCard = card;
      const droppedCard = pushQueued(replacedCard, queue, preferences.queue_limit);
      return decision("replace", droppedCard ? "queue_overflow_dropped" : "replace_lower_priority", {
        card,
        replaced_card: replacedCard,
        ...(droppedCard ? { dropped_card: droppedCard } : {})
      });
    }

    const droppedCard = pushQueued(card, queue, preferences.queue_limit);
    const incomingWasDropped = droppedCard?.id === card.id;
    return decision(incomingWasDropped ? "drop" : "queue", droppedCard ? "queue_overflow_dropped" : "queued_active_card", {
      card,
      ...(droppedCard ? { dropped_card: droppedCard } : {})
    });
  };

  const dismiss = (cardId = activeCard?.id): CuuControllerDecision => {
    if (!cardId) {
      return decision("idle", "nothing_active");
    }

    if (activeCard?.id === cardId) {
      activeCard = takeHighestPriority(queue);
      if (activeCard) {
        return decision("show", "dismissed_current", { card: activeCard });
      }
      return decision("idle", "dismissed_current");
    }

    const queuedIndex = queue.findIndex((item) => item.id === cardId);
    if (queuedIndex >= 0) {
      const [removed] = queue.splice(queuedIndex, 1);
      return decision("drop", "removed_queued_card", { ...(removed ? { card: removed } : {}) });
    }

    return decision("idle", "nothing_active");
  };

  return {
    snapshot,
    enqueue,
    dismiss,
    setPreferences(inputPreferences) {
      preferences = normalizePreferences({ ...preferences, ...inputPreferences });
      return snapshot();
    },
    clearBadges() {
      badgeCount = 0;
      return snapshot();
    }
  };
}

function normalizePreferences(input: Partial<CuuControllerPreferences> | undefined): CuuControllerPreferences {
  const queueLimit = input?.queue_limit ?? defaultPreferences.queue_limit;
  return {
    attention_mode: input?.attention_mode ?? defaultPreferences.attention_mode,
    sound_mode: input?.sound_mode ?? defaultPreferences.sound_mode,
    reduced_motion: input?.reduced_motion ?? defaultPreferences.reduced_motion,
    queue_limit: Math.max(0, Math.floor(queueLimit))
  };
}

function badgeReasonFor(card: CuuCard, preferences: CuuControllerPreferences): CuuControllerDecisionReason | undefined {
  if (preferences.attention_mode === "do_not_disturb") {
    return "do_not_disturb_badge";
  }
  if (card.priority === "low") {
    return "low_priority_badge";
  }
  if (preferences.attention_mode === "quiet" && card.priority !== "urgent") {
    return "quiet_mode_badge";
  }
  return undefined;
}

function shouldReplaceActive(incoming: CuuCard, active: CuuCard) {
  const incomingRank = priorityRank[incoming.priority];
  const activeRank = priorityRank[active.priority];
  return incomingRank >= priorityRank.high && incomingRank > activeRank;
}

function pushQueued(card: CuuCard, queue: CuuCard[], queueLimit: number) {
  if (queueLimit <= 0) {
    return card;
  }
  queue.push(card);
  if (queue.length <= queueLimit) {
    return undefined;
  }
  return queue.shift();
}

function takeHighestPriority(queue: CuuCard[]) {
  if (!queue.length) {
    return undefined;
  }
  let bestIndex = 0;
  for (const [index, card] of queue.entries()) {
    if (priorityRank[card.priority] > priorityRank[queue[bestIndex]!.priority]) {
      bestIndex = index;
    }
  }
  const [next] = queue.splice(bestIndex, 1);
  return next;
}

function hasCard(cardId: string, activeCard: CuuCard | undefined, queue: CuuCard[]) {
  return activeCard?.id === cardId || queue.some((item) => item.id === cardId);
}

function presentationFor(
  card: CuuCard | undefined,
  surface: CuuPresentationSurface,
  preferences: CuuControllerPreferences
): CuuPresentationInstruction {
  if (!card || surface === "none") {
    return {
      surface,
      timeout_ms: 0,
      play_motion: false,
      play_sound: false,
      os_notification: false
    };
  }

  const highSignal = card.priority === "urgent" || card.priority === "high" || card.state === "asking_approval";
  return {
    surface,
    timeout_ms: surface === "notice" ? timeoutFor(card) : 0,
    play_motion: surface === "notice" && !preferences.reduced_motion,
    play_sound: surface === "notice" && preferences.sound_mode === "on" && highSignal,
    os_notification:
      highSignal &&
      (surface === "badge" || preferences.attention_mode === "quiet" || preferences.attention_mode === "do_not_disturb")
  };
}

function timeoutFor(card: CuuCard) {
  if (card.priority === "urgent" || card.state === "asking_approval") {
    return 12000;
  }
  if (card.priority === "high" || card.state === "worried") {
    return 9000;
  }
  return 7200;
}
