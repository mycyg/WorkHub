import { cuuStates, type CuuState } from "@workhub/contracts";
import type { CuuIdleMicroAction } from "./idle-scheduler.js";

export type CuuMotionEmphasis = "calm" | "busy" | "urgent" | "celebratory";

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
