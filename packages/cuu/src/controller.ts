import type { CuuState } from "@workhub/contracts";

import type { CuuCard } from "./cards.js";
import { normalizeCuuSelectableModelPackId, type CuuModelPackIdCandidate } from "./model-pack.js";

export type CuuAttentionMode = "normal" | "quiet" | "do_not_disturb";
export type CuuSoundMode = "on" | "muted";
export type CuuPetScalePercent = 75 | 100 | 125 | 150;
export type CuuPetOpacityPercent = 60 | 80 | 100;

export type CuuControllerPreferences = {
  attention_mode: CuuAttentionMode;
  sound_mode: CuuSoundMode;
  reduced_motion: boolean;
  queue_limit: number;
  pet_scale_percent: CuuPetScalePercent;
  pet_opacity_percent: CuuPetOpacityPercent;
  pet_pass_through: boolean;
  pet_hide_on_hover: boolean;
  pet_model_pack_id?: CuuModelPackIdCandidate;
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
  | "bubble_throttled"
  | "dismissed_current"
  | "promoted_badge"
  | "removed_queued_card"
  | "nothing_active";

export type CuuControllerSnapshot = {
  active_card?: CuuCard;
  queue: CuuCard[];
  badges: CuuCard[];
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
  noteExternalCard: (card: CuuCard | undefined) => CuuControllerSnapshot;
};

const defaultPreferences: CuuControllerPreferences = {
  attention_mode: "normal",
  sound_mode: "on",
  reduced_motion: false,
  queue_limit: 5,
  pet_scale_percent: 100,
  pet_opacity_percent: 100,
  pet_pass_through: false,
  pet_hide_on_hover: false
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

// ux-flow-spec §3.7 频率纪律：同一工作项（军团 plan 的宿主）的气泡在 5 分钟窗口内
// 只冒最高优先级一条；后到的同/低优先级气泡降级成角标（决策收件箱仍有卡，不丢决策）。
const BUBBLE_THROTTLE_WINDOW_MS = 5 * 60 * 1000;

export function createCuuController(input: {
  preferences?: Partial<CuuControllerPreferences>;
  idle_state?: CuuState;
  now?: () => number;
} = {}): CuuController {
  let preferences = normalizePreferences(input.preferences);
  const idleState = input.idle_state ?? "idle";
  const now = input.now ?? (() => Date.now());
  let activeCard: CuuCard | undefined;
  const queue: CuuCard[] = [];
  const badges: CuuCard[] = [];
  // 每个节流组（work_item 优先，退化到 source entity）最近一次放行气泡的时间与优先级。
  const bubbleWindow = new Map<string, { at: number; priority: CuuCard["priority"] }>();

  const snapshot = (): CuuControllerSnapshot => ({
    ...(activeCard ? { active_card: activeCard } : {}),
    queue: [...queue],
    badges: [...badges],
    badge_count: badges.length,
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
    if (hasCard(card.id, activeCard, queue, badges)) {
      return decision("drop", "duplicate_dropped", { card });
    }

    // §3.7 气泡节流：同组（同工作项）5 分钟窗口内只放行最高优先级一条；其余降级角标。
    const throttleKey = card.kind === "bubble"
      ? card.source?.work_item_id ?? (card.source ? `${card.source.entity_type}:${card.source.entity_id}` : undefined)
      : undefined;
    if (throttleKey) {
      const at = now();
      const last = bubbleWindow.get(throttleKey);
      if (last && at - last.at < BUBBLE_THROTTLE_WINDOW_MS && priorityRank[card.priority] <= priorityRank[last.priority]) {
        const droppedCard = pushQueued(card, badges, preferences.queue_limit);
        const incomingWasDropped = droppedCard?.id === card.id;
        return decision(incomingWasDropped ? "drop" : "badge", incomingWasDropped ? "queue_overflow_dropped" : "bubble_throttled", {
          card,
          surface: "badge",
          ...(droppedCard ? { dropped_card: droppedCard } : {})
        });
      }
      bubbleWindow.set(throttleKey, { at, priority: card.priority });
    }

    const badgeReason = badgeReasonFor(card, preferences);
    if (badgeReason) {
      const droppedCard = pushQueued(card, badges, preferences.queue_limit);
      const incomingWasDropped = droppedCard?.id === card.id;
      return decision(incomingWasDropped ? "drop" : "badge", droppedCard ? "queue_overflow_dropped" : badgeReason, {
        card,
        surface: "badge",
        ...(droppedCard ? { dropped_card: droppedCard } : {})
      });
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

  const clearBubbleWindowFor = (card: CuuCard | undefined) => {
    if (!card || card.kind !== "bubble") {
      return;
    }
    const key = card.source?.work_item_id ?? (card.source ? `${card.source.entity_type}:${card.source.entity_id}` : undefined);
    if (key) {
      bubbleWindow.delete(key);
    }
  };

  const dismiss = (cardId = activeCard?.id): CuuControllerDecision => {
    if (!cardId) {
      const promoted = takeNextCard(queue, badges);
      if (promoted) {
        activeCard = promoted.card;
        return decision("show", promoted.reason, { card: promoted.card });
      }
      return decision("idle", "nothing_active");
    }

    if (activeCard?.id === cardId) {
      // R9（Cuu 行为链）：被处理/关闭的气泡不该继续占用 5 分钟节流窗——「上一条已被看过并处理」
      // 与「上一条还没人管」要区分开，否则处理完后同组新气泡仍被静音成角标。
      clearBubbleWindowFor(activeCard);
      const promoted = takeNextCard(queue, badges);
      activeCard = promoted?.card;
      if (promoted) {
        return decision("show", promoted.reason, { card: promoted.card });
      }
      return decision("idle", "dismissed_current");
    }

    const queuedIndex = queue.findIndex((item) => item.id === cardId);
    if (queuedIndex >= 0) {
      const [removed] = queue.splice(queuedIndex, 1);
      return decision("drop", "removed_queued_card", { ...(removed ? { card: removed } : {}) });
    }

    const badgeIndex = badges.findIndex((item) => item.id === cardId);
    if (badgeIndex >= 0) {
      const [removed] = badges.splice(badgeIndex, 1);
      return decision("drop", "removed_queued_card", { ...(removed ? { card: removed } : {}) });
    }

    // findings[#low]：此前这里有一个 `if (!activeCard) 提升下一张` 兜底块——但能走到这里
    // 说明 cardId 既不是 active、也不在 queue/badge 里（未知 id）。dismiss(未知 id) 不该
    // 顺手把队列/徽标卡提升上来。删掉该块，直接落到 nothing_active。
    return decision("idle", "nothing_active");
  };

  return {
    snapshot,
    enqueue,
    dismiss,
    // R9（Cuu 行为链 high）：本地动作路径（提交回执/待拍板浮现/恢复）直接换卡不走 enqueue——
    // controller 的 activeCard 与屏上真卡脱节，push 气泡会按「无当前卡」误判直接抢断。
    // 本地换卡后调它对齐单一事实来源；传 undefined 表示屏上已无卡。
    noteExternalCard(card: CuuCard | undefined) {
      // R10：本地换/清卡与 dismiss 同语义——被离开的旧气泡不再占 5 分钟节流窗。
      if (activeCard && activeCard.id !== card?.id) {
        clearBubbleWindowFor(activeCard);
      }
      activeCard = card;
      return snapshot();
    },
    setPreferences(inputPreferences) {
      preferences = normalizePreferences({ ...preferences, ...inputPreferences });
      return snapshot();
    },
    clearBadges() {
      badges.splice(0);
      return snapshot();
    }
  };
}

function normalizePreferences(input: Partial<CuuControllerPreferences> | undefined): CuuControllerPreferences {
  const queueLimit = input?.queue_limit ?? defaultPreferences.queue_limit;
  const modelPackId = normalizeCuuSelectableModelPackId(input?.pet_model_pack_id);
  return {
    attention_mode: input?.attention_mode ?? defaultPreferences.attention_mode,
    sound_mode: input?.sound_mode ?? defaultPreferences.sound_mode,
    reduced_motion: input?.reduced_motion ?? defaultPreferences.reduced_motion,
    queue_limit: Math.max(0, Math.floor(queueLimit)),
    pet_scale_percent: normalizePetScalePercent(input?.pet_scale_percent),
    pet_opacity_percent: normalizePetOpacityPercent(input?.pet_opacity_percent),
    pet_pass_through: input?.pet_pass_through === true,
    pet_hide_on_hover: input?.pet_hide_on_hover === true,
    ...(modelPackId ? { pet_model_pack_id: modelPackId } : {})
  };
}

function normalizePetScalePercent(value: unknown): CuuPetScalePercent {
  return value === 75 || value === 100 || value === 125 || value === 150
    ? value
    : defaultPreferences.pet_scale_percent;
}

function normalizePetOpacityPercent(value: unknown): CuuPetOpacityPercent {
  return value === 60 || value === 80 || value === 100
    ? value
    : defaultPreferences.pet_opacity_percent;
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

function takeNextCard(queue: CuuCard[], badges: CuuCard[]) {
  const queued = takeHighestPriority(queue);
  if (queued) {
    return { card: queued, reason: "dismissed_current" as const };
  }
  const badge = takeHighestPriority(badges);
  if (badge) {
    return { card: badge, reason: "promoted_badge" as const };
  }
  return undefined;
}

function hasCard(cardId: string, activeCard: CuuCard | undefined, queue: CuuCard[], badges: CuuCard[]) {
  return activeCard?.id === cardId || queue.some((item) => item.id === cardId) || badges.some((item) => item.id === cardId);
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
